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

import type { SwapEvent, ChainSwapStatus, ChainSwapData } from './types';
import { crypto } from 'bitcoinjs-lib';
import { randomBytes } from 'crypto';
import { BoltzClient, getLockupEventParameters } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { Contract } from 'ethers';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { relayClaimTransaction, getSmartWalletAddress } from '../rif/Signer';
import { isRifRelayAvailable, getLiquidAssetId } from '../../utils/networkConfig';
import EtherSwapArtifact from 'boltz-core/out/EtherSwap.sol/EtherSwap.json';
import type { NetworkType } from '../../core/types';
import type { SwapStorage } from './storage';
// Note: Refund service not yet migrated - L-BTC refunds require liquidjs-lib which has browser compatibility issues

const ECPair = ECPairFactory(ecc);

export class ChainSwapService {
	private boltzClient: BoltzClient;
	// private refundService: ChainSwapRefundService;
	private refundService: any;
	private websocket: BoltzWebSocket;
	private activeSwaps: Map<string, ChainSwapData> = new Map();
	private walletGetter: (() => any) | null = null;
	private storage?: SwapStorage;

	constructor(network: NetworkType = 'testnet', storage?: SwapStorage, websocket?: BoltzWebSocket) {
		this.boltzClient = new BoltzClient(network);
		this.storage = storage;
		// this.refundService = new ChainSwapRefundService(network, this.boltzClient);

		// Use provided WebSocket or create a new one (for backwards compatibility)
		if (websocket) {
			this.websocket = websocket;
		} else {
			const { getWebSocketEndpoint } = require('../../utils/networkConfig');
			this.websocket = new BoltzWebSocket(getWebSocketEndpoint(network));
		}
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
	 * Format: liquidnetwork:ADDRESS?amount=AMOUNT&assetid=ASSETID&blindingkey=KEY
	 */
	private generateLiquidPaymentUri(
		lockupAddress: string,
		amountSats: number,
		blindingKey: string
	): string {
		const amountBTC = amountSats / 100000000;
		// Get L-BTC asset ID for current network
		const lbtcAssetId = getLiquidAssetId('LBTC');
		return `liquidnetwork:${lockupAddress}?amount=${amountBTC}&assetid=${lbtcAssetId}&blindingkey=${blindingKey}`;
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
		walletSigner?: any; // Optional: wallet signer to check balance and compute Smart Wallet
	}): Promise<{ swapId: string; liquidUri: string; swapData: ChainSwapData }> {
		// Generate preimage and hash
		const preimage = randomBytes(32);
		const preimageHash = crypto.sha256(preimage).toString('hex');

		// Generate refund key for L-BTC
		const refundKey = this.generateRefundKey();
		console.log('🔍 Refund key:', refundKey);

		// Determine which address to use for claiming RBTC
		let claimAddress = params.rbtcAddress; // Default to user's wallet
		let useSmartWallet = false;

		// Check if we should use Smart Wallet (gasless via RIF Relay)
		if (isRifRelayAvailable() && params.walletSigner) {
			try {
				// Check user's gas balance
				const balance = await params.walletSigner.provider.getBalance(params.rbtcAddress);
				const gasEstimate = 100000n * 60000000n; // ~100k gas @ 0.06 gwei

				if (balance < gasEstimate) {
					// User has insufficient gas - use Smart Wallet for gasless claim
					const smartWallet = await getSmartWalletAddress(params.walletSigner);
					claimAddress = smartWallet.address;
					useSmartWallet = true;
					console.log('🔧 User has insufficient gas, using Smart Wallet for gasless claim');
					console.log('📍 Smart Wallet address:', claimAddress);
				} else {
					console.log('💰 User has sufficient gas, using direct wallet address');
				}
			} catch (error) {
				console.warn('⚠️ Could not check balance, defaulting to wallet address:', error);
			}
		}

		console.log('🔧 Creating chain swap:', {
			fromAmount: params.amountSats,
			userWallet: params.rbtcAddress,
			claimAddress: claimAddress,
			useSmartWallet
		});

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

		// Create chain swap via Boltz API
		const swapResponse = await this.boltzClient.createChainSwap({
			from: 'L-BTC',
			to: 'RBTC',
			userLockAmount: params.amountSats,
			preimageHash,
			claimAddress,
			refundPublicKey: refundKey.publicKey,
			pairHash: pairInfo.hash,
			referralId: ''
		});

		console.log('✅ Chain swap created:', swapResponse.id);

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
			rifRelayUsed: useSmartWallet
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
	 */
	private async handleSwapUpdate(event: SwapEvent): Promise<void> {
		const swapData = this.activeSwaps.get(event.swapId);
		if (!swapData) {
			console.warn('⚠️ Received update for unknown swap:', event.swapId);
			return;
		}

		const oldStatus = swapData.status;
		swapData.status = event.status as ChainSwapStatus;
		swapData.updatedAt = Date.now();

		console.log(`🔄 Chain swap ${event.swapId} status: ${oldStatus} → ${event.status}`);

		// Handle different status transitions
		switch (event.status) {
			case 'swap.created':
				console.log('📝 Chain swap created, waiting for user to send L-BTC');
				break;

			case 'transaction.mempool':
				console.log('🔍 User\'s L-BTC transaction detected in mempool');
				if (event.transaction?.id) {
					swapData.lockupTxHash = event.transaction.id;
				}
				break;

			case 'transaction.confirmed':
				console.log('✅ User\'s L-BTC transaction confirmed, waiting for Boltz to lock RBTC');
				break;

			case 'transaction.server.mempool':
				console.log('🔍 Boltz\'s RBTC lockup transaction detected in mempool');
				// Store the RBTC lockup tx hash - we need it for claiming!
				if (event.transaction?.id) {
					swapData.serverLockupTxHash = event.transaction.id;
				}
				break;

			case 'transaction.server.confirmed':
				console.log('✅ Boltz\'s RBTC lockup confirmed! Ready to claim RBTC');
				// Store the RBTC lockup tx hash if not already set
				if (event.transaction?.id && !swapData.serverLockupTxHash) {
					swapData.serverLockupTxHash = event.transaction.id;
				}
				// NOW we can claim RBTC!
				await this.attemptClaim(swapData);
				break;

			case 'transaction.claimed':
				console.log('🎉 RBTC claimed successfully!');
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

		// Update Nostr storage using shared module
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
	}

	/**
	 * Attempt to claim RBTC
	 * This is called when Boltz has locked RBTC (transaction.server.confirmed)
	 */
	private async attemptClaim(swapData: ChainSwapData): Promise<void> {
		const wallet = this.walletGetter?.();
		if (!wallet) {
			console.warn('⚠️ No wallet available for auto-claim');
			return;
		}

		try {
			// Check if should use RIF Relay
			if (swapData.rifRelayUsed || await this.shouldUseRifRelay(wallet)) {
				console.log('🔧 Using RIF Relay for gasless claim');
				await this.claimRBTCViaRifRelay(swapData, wallet);
			} else {
				console.log('💰 Using direct claim');
				await this.claimRBTC(swapData, wallet);
			}
		} catch (error) {
			console.error('❌ Failed to claim RBTC:', error);
			// Update status and save to Nostr
			swapData.status = 'transaction.failed';
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}
		}
	}

	/**
	 * Determine if RIF Relay should be used
	 */
	private async shouldUseRifRelay(wallet: any): Promise<boolean> {
		if (!isRifRelayAvailable()) return false;

		try {
			const balance = await wallet.provider.getBalance(wallet.address);
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
		wallet: any
	): Promise<void> {
		try {
			console.log('🚀 Starting gasless RBTC claim via RIF Relay');

			// Get preimage
			const preimage = swapData.preimage;

			// Get EtherSwap contract address from Boltz API
			const contracts = await this.boltzClient.getContractAddresses();
			const etherSwapAddress = (contracts as any).rsk?.swapContracts?.EtherSwap;

			if (!etherSwapAddress) {
				console.error('❌ Contract addresses:', contracts);
				throw new Error('RBTC EtherSwap contract address not found');
			}

			const etherSwapContract = new Contract(etherSwapAddress, EtherSwapArtifact.abi, wallet);

			// Get ACTUAL lockup parameters from blockchain transaction
			// This is MORE RELIABLE than API values
			let amount: number;
			let refundAddress: string;
			let timelock: number;

			if (swapData.serverLockupTxHash) {
				console.log('🔍 Fetching actual lockup parameters from blockchain...');
				const eventParams = await getLockupEventParameters(
					etherSwapAddress,
					swapData.preimageHash,
					swapData.serverLockupTxHash,
					wallet.provider
				);

				if (eventParams) {
					console.log('✅ Using actual Lockup event parameters:', {
						amount: eventParams.amount.toString() + ' wei',
						claimAddress: eventParams.claimAddress,
						refundAddress: eventParams.refundAddress,
						timelock: eventParams.timelock
					});

					// Convert from wei to sats for RIF Relay
					amount = Number(eventParams.amount / 10000000000n);
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

			// Use RIF Relay to claim
			const claimTxHash = await relayClaimTransaction(
				wallet,
				etherSwapContract as any,
				preimage,
				amount,
				refundAddress,
				timelock
			);

			console.log('✅ Transaction relayed:', claimTxHash);

			// Update swap data - PENDING status
			swapData.claimTxHash = claimTxHash;
			swapData.status = 'transaction.claim.pending';
			swapData.rifRelayUsed = true;
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			// Wait for confirmation
			const receipt = await wallet.provider.waitForTransaction(claimTxHash);

			console.log({ receipt });

			// Now mark as claimed
			swapData.status = 'transaction.claimed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			console.log('🎉 Successfully claimed via RIF Relay!');
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
		wallet: any
	): Promise<void> {
		console.log('🚀 Starting direct RBTC claim');

		// Get preimage
		const preimage = Buffer.from(swapData.preimage, 'hex');

		// Get EtherSwap contract address from Boltz API
		const contracts = await this.boltzClient.getContractAddresses();
		const contractAddress = (contracts as any).rsk?.swapContracts?.EtherSwap;

		if (!contractAddress) {
			console.error('❌ Contract addresses:', contracts);
			throw new Error('RBTC EtherSwap contract address not found');
		}

		// Get ACTUAL lockup parameters from blockchain transaction
		// This is MORE RELIABLE than API values
		let amountWei: bigint;
		let refundAddress: string;
		let timelock: number;

		if (swapData.serverLockupTxHash) {
			console.log('🔍 Fetching actual lockup parameters from blockchain...');
			const eventParams = await getLockupEventParameters(
				contractAddress,
				swapData.preimageHash,
				swapData.serverLockupTxHash,
				wallet.provider
			);

			if (eventParams) {
				console.log('✅ Using actual Lockup event parameters:', {
					amount: eventParams.amount.toString() + ' wei',
					claimAddress: eventParams.claimAddress,
					refundAddress: eventParams.refundAddress,
					timelock: eventParams.timelock
				});

				amountWei = eventParams.amount;
				refundAddress = eventParams.refundAddress;
				timelock = eventParams.timelock;
			} else {
				console.warn('⚠️ Lockup event not found, using API values (may fail)');
				amountWei = BigInt(swapData.toAmount) * BigInt(10000000000); // sats to wei
				refundAddress = swapData.refundAddress;
				timelock = swapData.claimTimeoutBlockHeight;
			}
		} else {
			console.warn('⚠️ No lockup TX hash, using API values (may fail)');
			amountWei = BigInt(swapData.toAmount) * BigInt(10000000000); // sats to wei
			refundAddress = swapData.refundAddress;
			timelock = swapData.claimTimeoutBlockHeight;
		}

		// Create contract instance
		const contract = new Contract(contractAddress, EtherSwapArtifact.abi, wallet);

		// Call claim function
		console.log('📝 Submitting claim transaction...');
		const tx = await contract.claim(
			`0x${preimage.toString('hex')}`,
			amountWei,
			refundAddress,
			timelock
		);

		console.log('⏳ Waiting for claim transaction confirmation...');
		const receipt = await tx.wait();
		console.log('✅ Claim transaction confirmed:', receipt.hash);

		// Update swap data
		swapData.claimTxHash = receipt.hash;
		swapData.status = 'transaction.claimed';
		swapData.updatedAt = Date.now();

		// Save to Nostr using shared module
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

					// Re-subscribe to WebSocket
					this.websocket.subscribeToSwap(swap.id, (event) => this.handleSwapUpdate(event));
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
}

// Example usage:
// import { ChainSwapService } from '@bittasker/wallet-core';
// const chainSwapService = new ChainSwapService('testnet', myStorageAdapter);

