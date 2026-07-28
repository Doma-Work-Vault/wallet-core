/**
 * Boltz Chain Swap Service (L-BTC → RBTC)
 * Client-side implementation with Nostr storage
 * 
 * Features:
 * - Creates chain-to-chain swaps from Liquid Bitcoin to Rootstock
 * - Stores swap data encrypted in Nostr events (NIP-44)
 * - Real-time WebSocket monitoring
 * - Automatic claim handling via RIF Relay
 * - Recovery from Nostr on app restart
 * 
 * ⚠️ CRITICAL: Understanding Chain Swap Flow
 * ==========================================
 * 
 * In a chain swap (L-BTC → RBTC):
 * 
 * 1. **WE generate the preimage** (random 32 bytes)
 * 2. **WE create the preimage hash** (SHA256 of preimage)
 * 3. **WE generate refund key** (needed for L-BTC refunds if swap fails)
 * 4. **Boltz creates the swap** with L-BTC lockup address and RBTC claim details
 * 5. **User sends L-BTC** to lockup address (using Liquid wallet like Aqua/Green)
 * 6. **Boltz detects L-BTC** (transaction.mempool, then transaction.confirmed)
 * 7. **Boltz locks RBTC** on-chain using the same hash (in EtherSwap contract)
 * 8. **WE claim the RBTC** by calling the contract's claim() function with our preimage
 * 9. **Boltz sees our preimage** on-chain and can now claim the L-BTC
 * 10. **Swap complete** - atomic and trustless!
 * 
 * The key difference from reverse swaps: USER locks funds FIRST (L-BTC), then Boltz locks RBTC.
 * This is why we need a refund key - if Boltz doesn't lock RBTC, we can refund our L-BTC.
 * 
 * States we'll see:
 * - swap.created: Swap created, waiting for user's L-BTC
 * - transaction.mempool: User's L-BTC tx in mempool
 * - transaction.confirmed: User's L-BTC confirmed
 * - transaction.server.mempool: Boltz's RBTC lockup tx in mempool
 * - transaction.server.confirmed: Boltz's RBTC confirmed (we can claim now!)
 * - transaction.claimed: We claimed RBTC ✅
 */

import type { SwapStorage } from './storage';
import type { SwapEvent, ChainSwapStatus, ChainSwapData, SwapUpdateEvent } from './types';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import { crypto } from 'bitcoinjs-lib';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { getSmartWalletAddress } from '../rif/Signer';
import { EvmContractService } from './EvmContractService';
import { RifRelayClaimService } from './RifRelayClaimService';
import { ChainSwapRefundService } from './ChainSwapRefundService';
import { getLiquidAssetId, getRSKConfig, isRifRelayAvailable, weiToSatoshi } from '../../utils/networkConfig';
import { isValidRskAddress, normalizeRskAddress, toEip55ChecksumAddress } from '../../utils/rskAddress';
import { EventBus } from '../../core/EventBus';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

export class ChainSwapService {
	private boltzClient: BoltzClient;
	private evmContractService: EvmContractService;
	private rifRelayService: RifRelayClaimService;
	private refundService: ChainSwapRefundService;
	private websocket: BoltzWebSocket;
	private activeSwaps: Map<string, ChainSwapData> = new Map();
	private walletGetter: (() => any) | null = null;
	private storage?: SwapStorage;
	private claimingSwaps: Set<string> = new Set();
	
	public events = new EventBus();
	
	constructor(websocket: BoltzWebSocket, boltzClient: BoltzClient, evmContractService: EvmContractService, storage?: SwapStorage) {
		this.boltzClient = boltzClient;
		this.evmContractService = evmContractService;
		this.rifRelayService = new RifRelayClaimService();
		this.refundService = new ChainSwapRefundService(this.boltzClient);
		this.storage = storage;
		this.websocket = websocket;
	}

	/**
	 * Set the wallet getter function
	 * This should be called before creating swaps to enable automatic claiming
	 */
	setWalletGetter(getter: () => any): void {
		this.walletGetter = getter;
	}

	/**
	 * Get swap limits from Boltz API
	 * Returns minimal and maximal amounts for L-BTC → RBTC swaps
	 */
	async getSwapLimits(): Promise<{ minimal: number; maximal: number }> {
		try {
			// Get chain swap pairs
			const chainPairs = await this.boltzClient.getChainSwapPairs();

			// API returns nested structure: chainPairs['L-BTC']['RBTC']
			const pairInfo = chainPairs?.['L-BTC']?.['RBTC'];

			if (!pairInfo || !pairInfo.limits) {
				console.warn('Could not find pair limits in response:', chainPairs);
				throw new Error('Chain swap pair limits not available');
			}

			return {
				minimal: pairInfo.limits.minimal,
				maximal: pairInfo.limits.maximal
			};
		} catch (error) {
			console.error('Failed to get chain swap limits:', error);
			throw error;
		}
	}

	/**
	 * Generate L-BTC refund key pair
	 * This is needed to refund L-BTC if swap expires or fails
	 */
	private generateRefundKey(): { publicKey: string; privateKey: string } {
		const keyPair = ECPair.makeRandom();

		return {
			publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
			privateKey: Buffer.from(keyPair.privateKey!).toString('hex')
		};
	}

	/**
	 * Generate Liquid payment URI (BIP21 format)
	 * Format: ADDRESS?amount=AMOUNT&assetid=ASSETID&blindingkey=KEY
	 */
	private generateLiquidPaymentUri(
		lockupAddress: string,
		amountSats: number,
		blindingKey: string
	): string {
		const amountBTC = amountSats / 100000000;
		// Get L-BTC asset ID for current network
		const lbtcAssetId = getLiquidAssetId('LBTC');
		return `${lockupAddress}?amount=${amountBTC}&assetid=${lbtcAssetId}&blindingkey=${blindingKey}`;
	}

	/**
	 * Create a chain swap (L-BTC → RBTC)
	 * 
	 * IMPORTANT: Determines claim address based on user's gas balance
	 * - If user has gas: Use their wallet address (direct claim)
	 * - If user has no gas: Use Smart Wallet address (RIF Relay gasless claim)
	 */
	async createChainSwap(params: {
		amountSats: number;
		rbtcAddress: string;
		walletSigner?: ethers.Signer; // Optional: wallet signer to check balance and compute Smart Wallet
		description?: string;
	}): Promise<{ swapId: string; liquidUri: string; swapData: ChainSwapData }> {
		// Validate RBTC address
		const chainId = getRSKConfig().chainId;
		if (!params.rbtcAddress || !isValidRskAddress(params.rbtcAddress, chainId)) {
			throw new Error('Invalid RBTC address format');
		}
		const normalizedRbtcAddress = normalizeRskAddress(params.rbtcAddress);

		// Generate preimage and hash
		const preimage = randomBytes(32);
		const preimageHash = crypto.sha256(preimage).toString('hex');

		// Generate refund key for L-BTC
		const refundKey = this.generateRefundKey();

		// Determine which address to use for claiming RBTC
		let claimAddress = params.rbtcAddress; // Default to user's wallet
		let useSmartWallet = false;

		// Check if we should use Smart Wallet (gasless via RIF Relay)
		if (isRifRelayAvailable() && params.walletSigner && params.walletSigner.provider) {
			try {
				// Check user's gas balance
				const balance = await params.walletSigner.provider.getBalance(normalizedRbtcAddress);
				const gasEstimate = 100000n * 60000000n; // ~100k gas @ 0.06 gwei

				if (balance < gasEstimate) {
					// User has insufficient gas - use Smart Wallet for gasless claim
					const smartWallet = await getSmartWalletAddress(params.walletSigner);
					claimAddress = smartWallet.address;
					useSmartWallet = true;
				}
			} catch (error) {
				console.warn('⚠️ Could not check balance, defaulting to wallet address:', error);
			}
		}

		// Get chain swap pairs to get pairHash
		const chainPairs = await this.boltzClient.getChainSwapPairs();

		// API returns nested structure: chainPairs['L-BTC']['RBTC']
		const pairInfo = chainPairs?.['L-BTC']?.['RBTC'];

		if (!pairInfo) {
			throw new Error('Chain swap pair L-BTC → RBTC not available');
		}

		// Validate amount against pair limits
		if (params.amountSats < pairInfo.limits.minimal) {
			throw new Error(`Amount too small. Minimum: ${pairInfo.limits.minimal} sats (${pairInfo.limits.minimal / 100000000} BTC)`);
		}
		if (params.amountSats > pairInfo.limits.maximal) {
			throw new Error(`Amount too large. Maximum: ${pairInfo.limits.maximal} sats (${pairInfo.limits.maximal / 100000000} BTC)`);
		}

		// Convert claimAddress to EIP-55 format for Boltz API compatibility
		// Boltz expects standard Ethereum checksum (EIP-55), not RSK chain-aware (EIP-1191)
		const claimAddressEip55 = toEip55ChecksumAddress(claimAddress.toLowerCase());

		// Create chain swap via Boltz API
		const swapResponse = await this.boltzClient.createChainSwap({
			from: 'L-BTC',
			to: 'RBTC',
			userLockAmount: params.amountSats,
			preimageHash,
			claimAddress: claimAddressEip55,
			refundPublicKey: refundKey.publicKey,
			pairHash: pairInfo.hash,
			referralId: ''
		});

		// Generate Liquid payment URI
		const liquidUri = this.generateLiquidPaymentUri(
			swapResponse.lockupDetails.lockupAddress,
			swapResponse.lockupDetails.amount,
			swapResponse.lockupDetails.blindingKey
		);

		// Calculate expiration time based on timeout block heights
		// Liquid: ~10min blocks, Rootstock: ~30s blocks
		// Use the shorter timeout (L-BTC lockup) for expiration
		const expiresAt = Date.now() + (swapResponse.lockupDetails.timeoutBlockHeight * 10 * 60 * 1000);

		// Create swap data object
		const swapData: ChainSwapData = {
			id: swapResponse.id,
			type: 'chain',
			preimage: preimage.toString('hex'),
			preimageHash,

			// L-BTC side
			fromAsset: 'L-BTC',
			fromAmount: swapResponse.lockupDetails.amount,
			lockupAddress: swapResponse.lockupDetails.lockupAddress,
			blindingKey: swapResponse.lockupDetails.blindingKey,
			liquidUri,
			lockupTimeoutBlockHeight: swapResponse.lockupDetails.timeoutBlockHeight,
			swapTree: swapResponse.lockupDetails.swapTree, // Store for refunds
			serverPublicKey: swapResponse.lockupDetails.serverPublicKey, // Store for refunds

			// Refund key
			refundPublicKey: refundKey.publicKey,
			refundPrivateKey: refundKey.privateKey,

			// RBTC side
			toAsset: 'RBTC',
			toAmount: swapResponse.claimDetails.amount,
			rbtcAddress: params.rbtcAddress,
			claimAddress: claimAddress,
			claimTimeoutBlockHeight: swapResponse.claimDetails.timeoutBlockHeight,
			refundAddress: swapResponse.claimDetails.refundAddress,

			// Status
			status: 'swap.created',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			expiresAt,
			rifRelayUsed: useSmartWallet,
			description: params.description
		};

		// Store in active swaps
		this.activeSwaps.set(swapData.id, swapData);

		// Save to Nostr (encrypted) using shared module
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

		// Subscribe to WebSocket updates
		this.websocket.subscribeToSwap(swapData.id, (event) => this.handleSwapUpdate(event));

		return {
			swapId: swapData.id,
			liquidUri,
			swapData
		};
	}

	/**
	 * Handle swap status updates from WebSocket
	 * @param event - Swap event from WebSocket
	 * @param skipSave - If true, skip saving to storage (used during recovery)
	 */
	private async handleSwapUpdate(event: SwapEvent, skipSave = false): Promise<void> {
		const swapData = this.activeSwaps.get(event.swapId);
		if (!swapData) {
			console.warn('⚠️ Received update for unknown swap:', event.swapId);
			return;
		}

		// Track changes for conditional saving
		const previousStatus = swapData.status;
		const hadLockupTx = !!swapData.lockupTxHash;
		const hadServerLockupTx = !!swapData.serverLockupTxHash;
		const hadClaimTx = !!swapData.claimTxHash;

		swapData.status = event.status as ChainSwapStatus;
		swapData.updatedAt = Date.now();

		// Handle different status transitions
		switch (event.status) {
			case 'swap.created':
				break;

			case 'transaction.mempool':
				if (event.transaction?.id) {
					swapData.lockupTxHash = event.transaction.id;
				}
				break;

			case 'transaction.confirmed':
				break;

			case 'transaction.server.mempool':
				// Store the RBTC lockup tx hash - we need it for claiming!
				if (event.transaction?.id) {
					swapData.serverLockupTxHash = event.transaction.id;
				}
				break;

			case 'transaction.server.confirmed':
				// Store the RBTC lockup tx hash if not already set
				if (event.transaction?.id && !swapData.serverLockupTxHash) {
					swapData.serverLockupTxHash = event.transaction.id;
				}
				// NOW we can claim RBTC!
				await this.attemptClaim(swapData);
				break;

			case 'transaction.claimed':
				if (event.transaction?.id) {
					swapData.claimTxHash = event.transaction.id;
				}
				break;

			case 'swap.expired':
				console.warn('⏰ Chain swap expired');
				break;

			case 'transaction.failed':
				console.error('❌ Chain swap failed:', event.failureReason);
				break;
		}

		// Determine if we should save to storage
		const hasChanges = 
			previousStatus !== swapData.status || 
			(!hadLockupTx && swapData.lockupTxHash) ||
			(!hadServerLockupTx && swapData.serverLockupTxHash) ||
			(!hadClaimTx && swapData.claimTxHash);

		// Save to storage only if there are changes and not skipped
		if (this.storage && !skipSave && hasChanges) {
			await this.storage.save(swapData.id, swapData);
		}

		// Emit event to clients
		this.events.emit('swap.update', {
			swapId: event.swapId,
			status: event.status,
			timestamp: new Date(),
			swapData: swapData,
			transaction: event.transaction,
			failureReason: event.failureReason
		} as SwapUpdateEvent);
	}

	/**
	 * Attempt to claim RBTC
	 * This is called when Boltz has locked RBTC (transaction.server.confirmed)
	 */
	private async attemptClaim(swapData: ChainSwapData): Promise<void> {
		// Prevent concurrent claims
		if (this.claimingSwaps.has(swapData.id)) {
			console.warn('⚠️ Claim already in progress for swap:', swapData.id);
			return;
		}

		const wallet = this.walletGetter?.();
		if (!wallet) {
			console.warn('⚠️ No wallet available for auto-claim');
			return;
		}

		// Add to claiming set
		this.claimingSwaps.add(swapData.id);

		try {
			// Check if should use RIF Relay
			if (swapData.rifRelayUsed || await this.shouldUseRifRelay(wallet)) {
				await this.claimRBTCViaRifRelay(swapData, wallet);
			} else {
				await this.claimRBTC(swapData, wallet);
			}
		} catch (error) {
			console.error('❌ Failed to claim RBTC:', error);
			// Update status and save to Nostr
			swapData.status = 'transaction.failed';
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}
		} finally {
			// Always remove from claiming set
			this.claimingSwaps.delete(swapData.id);
		}
	}

	/**
	 * Determine if RIF Relay should be used
	 */
	private async shouldUseRifRelay(wallet: ethers.Signer): Promise<boolean> {
		if (!isRifRelayAvailable() || !wallet.provider) return false;

		try {
			const address = await wallet.getAddress();
			const balance = await wallet.provider.getBalance(address);
			const gasEstimate = 100000n * 60000000n; // ~100k gas @ 0.06 gwei
			return balance < gasEstimate;
		} catch (error) {
			console.warn('⚠️ Could not check balance for RIF Relay decision:', error);
			return false;
		}
	}

	/**
	 * Claim RBTC using RIF Relay (gasless)
	 * Reuses the RIF Relay infrastructure from reverseSwapService
	 */
	private async claimRBTCViaRifRelay(
		swapData: ChainSwapData,
		wallet: ethers.Signer
	): Promise<void> {
		try {
			// Check if already claimed
			if (swapData.status === 'transaction.claimed') {
				throw new Error('Swap already claimed');
			}

			if (swapData.claimTxHash) {
				throw new Error(`Swap already claimed in transaction: ${swapData.claimTxHash}`);
			}

			// Prevent claim pending state
			if (swapData.status === 'transaction.claim.pending') {
				throw new Error('Claim already in progress');
			}

			// Get EtherSwap contract address
			const etherSwapAddress = await this.evmContractService.getEtherSwapAddress();

			// Get ACTUAL lockup parameters from blockchain transaction
			// This is MORE RELIABLE than API values
			let amount: number;
			let refundAddress: string;
			let timelock: number;

			if (swapData.serverLockupTxHash && wallet.provider) {
				const eventParams = await this.evmContractService.getLockupEventParameters(
					swapData.preimageHash,
					swapData.serverLockupTxHash,
					wallet.provider,
					etherSwapAddress
				);

				if (eventParams) {
					// Convert from wei to sats
					amount = weiToSatoshi(eventParams.amount);
					refundAddress = eventParams.refundAddress;
					timelock = eventParams.timelock;
				} else {
					console.warn('⚠️ Lockup event not found, using API values (may fail)');
					amount = swapData.toAmount;
					refundAddress = swapData.refundAddress;
					timelock = swapData.claimTimeoutBlockHeight;
				}
			} else {
				console.warn('⚠️ No lockup TX hash, using API values (may fail)');
				amount = swapData.toAmount;
				refundAddress = swapData.refundAddress;
				timelock = swapData.claimTimeoutBlockHeight;
			}

			// Validate refundAddress before calling RIF Relay claim
			if (!refundAddress || !ethers.isAddress(refundAddress?.toLowerCase?.() ?? '')) {
				console.warn(
					'⚠️ RIF Relay: refundAddress is invalid:',
					JSON.stringify(refundAddress),
					'(type:', typeof refundAddress, ')'
				);

				// Try to fetch fresh claim details from Boltz API
				if (swapData.id) {
					try {
						const statusResult = await this.boltzClient.getSwapStatus(swapData.id);
						const apiRefund = (statusResult as any)?.claimDetails?.refundAddress;
						if (apiRefund && ethers.isAddress(apiRefund.toLowerCase())) {
							console.log('✅ RIF Relay: Recovered refundAddress from Boltz API');
							refundAddress = apiRefund;
						}
					} catch (apiError) {
						console.error('❌ RIF Relay: Failed to fetch refund address from Boltz API:', apiError);
					}
				}

				if (!refundAddress || !ethers.isAddress(refundAddress?.toLowerCase?.() ?? '')) {
					throw new Error(
						`Cannot claim via RIF Relay: refundAddress is invalid. ` +
						`swapData.refundAddress="${swapData.refundAddress}", swapId="${swapData.id}"`
					);
				}
			}

			// Use RifRelayClaimService for gasless claim
			const txHash = await this.rifRelayService.claimViaRifRelay({
				walletSigner: wallet,
				contractAddress: etherSwapAddress,
				preimage: swapData.preimage,
				amount,
				refundAddress,
				timelock
			});

			// Update swap data - PENDING status
			swapData.claimTxHash = txHash;
			swapData.status = 'transaction.claim.pending';
			swapData.rifRelayUsed = true;
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			// Wait for confirmation
			if (wallet.provider) {
				await this.rifRelayService.waitForConfirmation(txHash, wallet.provider);
			}

			// Now mark as claimed
			swapData.status = 'transaction.claimed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}
		} catch (error) {
			console.error('❌ RIF Relay claim failed:', error);
			swapData.status = 'transaction.failed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			throw error;
		}
	}

	/**
	 * Claim RBTC directly (user pays gas)
	 */
	private async claimRBTC(
		swapData: ChainSwapData,
		wallet: ethers.Signer
	): Promise<void> {
		// Check if already claimed
		if (swapData.status === 'transaction.claimed') {
			throw new Error('Swap already claimed');
		}

		if (swapData.claimTxHash) {
			throw new Error(`Swap already claimed in transaction: ${swapData.claimTxHash}`);
		}

		// Prevent claim pending state
		if (swapData.status === 'transaction.claim.pending') {
			throw new Error('Claim already in progress');
		}

		// Get ACTUAL lockup parameters from blockchain transaction
		// This is MORE RELIABLE than API values
		let amount: number;
		let refundAddress: string;
		let timelock: number;

		if (swapData.serverLockupTxHash && wallet.provider) {
			const eventParams = await this.evmContractService.getLockupEventParameters(
				swapData.preimageHash,
				swapData.serverLockupTxHash,
				wallet.provider
			);

			if (eventParams) {
				amount = weiToSatoshi(eventParams.amount);
				refundAddress = eventParams.refundAddress;
				timelock = eventParams.timelock;
			} else {
				console.warn('⚠️ Lockup event not found, using API values (may fail)');
				amount = swapData.toAmount; // in satoshis
				refundAddress = swapData.refundAddress;
				timelock = swapData.claimTimeoutBlockHeight;
			}
		} else {
			console.warn('⚠️ No lockup TX hash, using API values (may fail)');
			amount = swapData.toAmount;
			refundAddress = swapData.refundAddress;
			timelock = swapData.claimTimeoutBlockHeight;
		}

		// Validate refundAddress before calling claimFunds
		// If invalid, try to fetch from Boltz API as last resort
		if (!refundAddress || !ethers.isAddress(refundAddress?.toLowerCase?.() ?? '')) {
			console.warn(
				'⚠️ refundAddress is invalid or missing:',
				JSON.stringify(refundAddress),
				'(type:', typeof refundAddress, ')'
			);
			console.warn('swapData.refundAddress:', JSON.stringify(swapData.refundAddress));

			// Try to fetch fresh claim details from Boltz API
			if (swapData.id) {
				try {
					const statusResult = await this.boltzClient.getSwapStatus(swapData.id);
					const apiRefund = (statusResult as any)?.claimDetails?.refundAddress;
					if (apiRefund && ethers.isAddress(apiRefund.toLowerCase())) {
						console.log('✅ Recovered refundAddress from Boltz API:', apiRefund.substring(0, 10) + '...');
						refundAddress = apiRefund;
					} else {
						console.error('❌ Boltz API also returned invalid refundAddress:', JSON.stringify(apiRefund));
					}
				} catch (apiError) {
					console.error('❌ Failed to fetch refund address from Boltz API:', apiError);
				}
			}

			// Final validation — if still invalid, abort with detailed error
			if (!refundAddress || !ethers.isAddress(refundAddress?.toLowerCase?.() ?? '')) {
				throw new Error(
					`Cannot claim: refundAddress is invalid after all fallbacks. ` +
					`swapData.refundAddress="${swapData.refundAddress}", ` +
					`swapId="${swapData.id}", ` +
					`The user's rBTC is locked in the EtherSwap contract and can be recovered ` +
					`by calling refund() after the RSK timelock expires (${swapData.claimTimeoutBlockHeight}).`
				);
			}
		}

		// Use EvmContractService to claim funds
		const result = await this.evmContractService.claimFunds({
			signer: wallet,
			preimage: swapData.preimage,
			amount,
			refundAddress,
			timelock
		});

		// Update swap data
		swapData.claimTxHash = result.txHash;
		swapData.status = 'transaction.claimed';
		swapData.updatedAt = Date.now();

		// Save to storage
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
	}

	/**
	 * Recover pending chain swaps from storage
	 */
	async recoverPendingSwaps(): Promise<ChainSwapData[]> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot recover swaps');
				return [];
			}

			const swaps = await this.storage.loadAll();
			const chainSwaps: ChainSwapData[] = [];

			for (const swap of swaps) {
				// Filter for chain swaps only
				if (swap.type === 'chain') {
					// Store in memory
					this.activeSwaps.set(swap.id, swap as ChainSwapData);
					chainSwaps.push(swap as ChainSwapData);

					// Re-subscribe to WebSocket with skipSave = true to avoid re-saving during recovery
					this.websocket.subscribeToSwap(swap.id, (event) => this.handleSwapUpdate(event, true));
				}
			}

			return chainSwaps;
		} catch (error) {
			console.error('❌ Failed to recover chain swaps from storage:', error);
			return [];
		}
	}

	/**
	 * Get active chain swaps
	 */
	getActiveSwaps(): ChainSwapData[] {
		return Array.from(this.activeSwaps.values());
	}

	/**
	 * Get chain swap by ID
	 */
	getSwap(swapId: string): ChainSwapData | undefined {
		return this.activeSwaps.get(swapId);
	}

	/**
	 * Delete all chain swaps from storage
	 */
	async deleteAllSwaps(): Promise<{ count: number }> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swaps');
				return { count: 0 };
			}

			const swaps = await this.storage.loadAll();
			let count = 0;

			for (const swap of swaps) {
				if (swap.type === 'chain') {
					await this.storage.delete(swap.id);
					count++;
				}
			}

			this.activeSwaps.clear();
			return { count };
		} catch (error) {
			console.error('Failed to delete swaps:', error);
			throw error;
		}
	}

	/**
	 * Delete a single chain swap from storage
	 */
	async deleteSwap(swapId: string): Promise<boolean> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swap');
				return false;
			}

			await this.storage.delete(swapId);
			this.activeSwaps.delete(swapId);
			return true;
		} catch (error) {
			console.error('Failed to delete swap:', error);
			return false;
		}
	}

	/**
	 * Check if a swap can be refunded
	 */
	// async isSwapRefundable(swapData: ChainSwapData): Promise<RefundCheck> {
	async isSwapRefundable(swapData: ChainSwapData): Promise<any> {
		return this.refundService.isSwapRefundable(swapData);
	}

	/**
	 * Refund L-BTC from a failed/expired chain swap
	 * 
	 * IMPORTANT: This only works for L-BTC → RBTC swaps where the user sent L-BTC first
	 * RBTC refunds are handled by the user's wallet (not our responsibility)
	 */
	// async refundChainSwap(params: RefundParams): Promise<RefundResult> {
	async refundChainSwap(params: any): Promise<any> {
		const swapData = this.activeSwaps.get(params.swapId);
		if (!swapData) {
			throw new Error(`Swap ${params.swapId} not found`);
		}

		// Delegate to refund service
		const result = await this.refundService.refundChainSwap(swapData, params);

		// Update active swaps map
		this.activeSwaps.set(result.swapData.id, result.swapData);

		return result;
	}

	/**
	 * Check if a chain swap can be renegotiated
	 * 
	 * According to Boltz API documentation, a swap can be renegotiated if ALL of:
	 * - Status is transaction.lockupFailed
	 * - Failure was due to overpayment or underpayment
	 * - No refund signature has been created yet
	 * - Actual amount is within pair limits (checked by Boltz API)
	 * - At least 60 minutes remaining until expiry
	 * 
	 * Source: https://api.docs.boltz.exchange/lifecycle.html#chain-swaps
	 * 
	 * @param swapData - Chain swap data
	 * @returns True if swap can be renegotiated
	 */
	canRenegotiate(swapData: ChainSwapData): boolean {
		// Check if status is lockupFailed
		if (swapData.status !== 'transaction.lockupFailed') {
			return false;
		}

		// Check if swap has expired (need at least 60 minutes)
		const now = Date.now();
		const timeRemaining = swapData.expiresAt - now;
		const sixtyMinutes = 60 * 60 * 1000;
		
		if (timeRemaining < sixtyMinutes) {
			return false;
		}

		// Check if refund transaction has been created
		if (swapData.refundTxHash) {
			return false;
		}

		return true;
	}

	/**
	 * Get renegotiation quote for a failed chain swap
	 * 
	 * Calls Boltz API: GET /v2/swap/chain/{id}/quote
	 * Returns a new quote based on the actual amount the user locked.
	 * 
	 * The quote is only valid if the swap is eligible for renegotiation.
	 * Boltz validates:
	 * - Failure reason is overpayment/underpayment
	 * - Actual amount is within pair limits
	 * - Sufficient liquidity available
	 * 
	 * Source: https://api.docs.boltz.exchange/lifecycle.html#chain-swaps
	 * 
	 * @param swapId - Chain swap ID
	 * @returns New quote with adjusted amount in satoshis
	 * @throws Error if swap cannot be renegotiated or API call fails
	 */
	async getRenegotiationQuote(swapId: string): Promise<{ amount: number }> {
		const swapData = this.activeSwaps.get(swapId);
		if (!swapData) {
			throw new Error(`Swap ${swapId} not found`);
		}

		if (!this.canRenegotiate(swapData)) {
			throw new Error('Swap is not eligible for renegotiation');
		}

		const apiUrl = this.boltzClient['config'].boltzApiUrl;

		try {
			const response = await fetch(`${apiUrl}/v2/swap/chain/${swapId}/quote`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Boltz API error: ${response.status} ${errorText}`);
			}

			const data = await response.json();

			if (typeof data.amount !== 'number' || data.amount <= 0) {
				throw new Error('Invalid renegotiation quote response');
			}

			return { amount: data.amount };
		} catch (error) {
			console.error('Failed to get renegotiation quote:', error);
			throw error;
		}
	}

	/**
	 * Accept renegotiation quote for a failed chain swap
	 * 
	 * Calls Boltz API: POST /v2/swap/chain/{id}/quote
	 * Accepts the new quote and allows the swap to continue with adjusted amount.
	 * 
	 * After accepting:
	 * - Boltz validates the quote hasn't changed
	 * - Boltz validates sufficient liquidity
	 * - Boltz locks the adjusted amount on destination chain
	 * - Swap continues normally (transaction.server.mempool → transaction.server.confirmed)
	 * 
	 * Source: https://api.docs.boltz.exchange/lifecycle.html#chain-swaps
	 * 
	 * @param swapId - Chain swap ID
	 * @param amount - The quoted amount to accept (from getRenegotiationQuote)
	 * @throws Error if swap cannot be renegotiated, amount is invalid, or API call fails
	 */
	async acceptRenegotiation(swapId: string, amount: number): Promise<void> {
		const swapData = this.activeSwaps.get(swapId);
		if (!swapData) {
			throw new Error(`Swap ${swapId} not found`);
		}

		if (!this.canRenegotiate(swapData)) {
			throw new Error('Swap is not eligible for renegotiation');
		}

		if (typeof amount !== 'number' || amount <= 0) {
			throw new Error('Valid amount is required');
		}

		const apiUrl = this.boltzClient['config'].boltzApiUrl;

		try {
			const response = await fetch(`${apiUrl}/v2/swap/chain/${swapId}/quote`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ amount })
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Boltz API error: ${response.status} ${errorText}`);
			}

			// Update local swap data with new expected amount
			swapData.toAmount = amount;
			swapData.updatedAt = Date.now();

			// Save to storage
			if (this.storage) {
				await this.storage.save(swapId, swapData);
			}

			console.log(`✅ Renegotiation accepted for swap ${swapId}. New amount: ${amount} sats`);
		} catch (error) {
			console.error('Failed to accept renegotiation:', error);
			throw error;
		}
	}
}
