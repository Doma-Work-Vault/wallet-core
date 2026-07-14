/**
 * Boltz Reverse Swap Service (Lightning → rBTC)
 * Client-side implementation with Nostr storage
 * 
 * Features:
 * - Creates reverse submarine swaps from Lightning to Rootstock
 * - Stores swap data encrypted in Nostr events (NIP-44)
 * - Real-time WebSocket monitoring
 * - Automatic claim handling
 * - Recovery from Nostr on app restart
 * 
 * ⚠️ CRITICAL: Understanding Reverse Swap Flow
 * ============================================
 * 
 * In a reverse swap (Lightning → On-chain):
 * 
 * 1. **WE generate the preimage** (random 32 bytes)
 * 2. **WE create the preimage hash** (SHA256 of preimage)
 * 3. **Boltz creates a HOLD/HODL invoice** using our hash
 * 4. **User pays the Lightning invoice** (payment is HELD, not settled yet)
 * 5. **Boltz locks RBTC on-chain** using the same hash (in EtherSwap contract)
 * 6. **WE claim the RBTC** by calling the contract's claim() function with our preimage
 * 7. **Boltz sees our preimage** on-chain and can now settle the Lightning invoice
 * 8. **Invoice is settled** - swap complete!
 * 
 * The key insight: The invoice CANNOT be settled until we reveal the preimage by claiming the RBTC.
 * This is what makes it atomic and trustless - neither party can cheat.
 * 
 * States we'll see:
 * - swap.created: Swap created, invoice ready to pay
 * - invoice.set: Invoice paid and held (waiting for our claim)
 * - transaction.mempool: Boltz's lockup tx in mempool (we can claim now!)
 * - transaction.confirmed: Lockup confirmed (safer to claim)
 * - transaction.claim.pending: Our claim tx submitted
 * - invoice.settled: Boltz settled invoice after seeing our preimage ✅
 */

import type { SwapStorage } from './storage';
import type { SwapEvent, BoltzSwapData, SwapUpdateEvent } from './types';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';
import { crypto } from 'bitcoinjs-lib';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { getSmartWalletAddress } from '../rif/Signer';
import { getRSKConfig, isRifRelayAvailable, weiToSatoshi } from '../../utils/networkConfig';
import { areSameRskAddress, isValidRskAddress, normalizeRskAddress, toEip55ChecksumAddress } from '../../utils/rskAddress';
import { EvmContractService } from './EvmContractService';
import { RifRelayClaimService } from './RifRelayClaimService';
import { EventBus } from '../../core/EventBus';


// Reference: https://github.com/BoltzExchange/boltz-core/blob/master/contracts/EtherSwap.sol

export class ReverseSwapService {
	private boltzClient: BoltzClient;
	private evmContractService: EvmContractService;
	private rifRelayService: RifRelayClaimService;
	private websocket: BoltzWebSocket;
	private activeSwaps: Map<string, BoltzSwapData> = new Map();
	private walletGetter: (() => any) | null = null;
	private storage?: SwapStorage;
	private claimingSwaps: Set<string> = new Set();

	public events = new EventBus();

	constructor(websocket: BoltzWebSocket, boltzClient: BoltzClient, evmContractService: EvmContractService, storage?: SwapStorage) {
		this.boltzClient = boltzClient;
		this.evmContractService = evmContractService;
		this.rifRelayService = new RifRelayClaimService();
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
	 * Returns minimal and maximal amounts for Lightning → RBTC swaps
	 */
	async getSwapLimits(): Promise<{ minimal: number; maximal: number }> {
		try {
			// Get reverse swap pairs
			const reversePairs = await this.boltzClient.getReverseSwapPairs();

			// API returns flat structure: { 'BTC': {...}, 'RBTC': {...}, 'L-BTC': {...} }
			// For Lightning → RBTC swaps, we use RBTC limits
			const pairInfo = reversePairs?.['BTC']?.['RBTC'];

			if (!pairInfo || !pairInfo.limits) {
				console.warn('Could not find RBTC pair limits in response:', reversePairs);
				throw new Error('Reverse swap pair limits not available');
			}

			return {
				minimal: pairInfo.limits.minimal,
				maximal: pairInfo.limits.maximal
			};
		} catch (error) {
			console.error('Failed to get swap limits:', error);
			throw error;
		}
	}

	/**
	 * Create a reverse swap (Lightning → rBTC)
	 * 
	 * IMPORTANT: Determines claim address based on user's gas balance
	 * - If user has gas: Use their wallet address (direct claim)
	 * - If user has no gas: Use Smart Wallet address (RIF Relay gasless claim)
	 */
	async createReverseSwap(params: {
		amountSats: number;
		rbtcAddress: string;
		description?: string;
		walletSigner?: ethers.Signer; // Optional: wallet signer to check balance and compute Smart Wallet
	}): Promise<{ swapId: string; invoice: string; swapData: BoltzSwapData }> {
		// Validate RBTC address
		const chainId = getRSKConfig().chainId;
		if (!params.rbtcAddress || !isValidRskAddress(params.rbtcAddress, chainId)) {
			throw new Error('Invalid RBTC address format');
		}
		const normalizedRbtcAddress = normalizeRskAddress(params.rbtcAddress);

		// Validate amount
		if (!params.amountSats || params.amountSats <= 0) {
			throw new Error('Amount must be greater than 0');
		}
		if (params.amountSats > Number.MAX_SAFE_INTEGER) {
			throw new Error('Amount exceeds maximum safe value');
		}

		// Validate against swap limits
		const limits = await this.getSwapLimits();
		if (params.amountSats < limits.minimal) {
			throw new Error(`Amount too small. Minimum: ${limits.minimal} sats (${(limits.minimal / 100000000).toFixed(8)} BTC)`);
		}
		if (params.amountSats > limits.maximal) {
			throw new Error(`Amount too large. Maximum: ${limits.maximal} sats (${(limits.maximal / 100000000).toFixed(8)} BTC)`);
		}

		// Generate preimage and hash
		const preimage = randomBytes(32);
		const preimageHash = crypto.sha256(preimage).toString('hex');

		// For EVM chains like RBTC, we use the REST API directly since the client
		// method expects claimPublicKey but EVM swaps use claimAddress
		const apiUrl = this.boltzClient['config'].boltzApiUrl;

		// Determine which address to use for claiming
		let claimAddress = params.rbtcAddress; // Default to user's wallet
		let useSmartWallet = false;

		// Check if we should use Smart Wallet (gasless via RIF Relay)
		if (isRifRelayAvailable() && params.walletSigner) {
			try {
				// Check user's gas balance
				const balance = await params.walletSigner.provider?.getBalance(normalizedRbtcAddress);
				const gasEstimate = 100000n * 60000000n; // ~100k gas @ 0.06 gwei

				if (!balance || balance < gasEstimate) {
					// User has insufficient gas - use Smart Wallet for gasless claim
					const smartWallet = await getSmartWalletAddress(params.walletSigner);
					claimAddress = smartWallet.address;
					useSmartWallet = true;
				}
			} catch (error) {
				console.warn('⚠️ Could not check balance, defaulting to wallet address:', error);
			}
		}

		// Convert claimAddress to EIP-55 format for Boltz API compatibility
		// Boltz expects standard Ethereum checksum (EIP-55), not RSK chain-aware (EIP-1191)
		const claimAddressEip55 = toEip55ChecksumAddress(claimAddress.toLowerCase());

		const response = await fetch(`${apiUrl}/v2/swap/reverse`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: 'BTC',
				to: 'RBTC',
				invoiceAmount: params.amountSats,
				preimageHash,
				claimAddress: claimAddressEip55 // Use EIP-55 format for API compatibility
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to create reverse swap: ${response.status} ${errorText}`);
		}

		const swapResponse = await response.json();

		// Prepare swap data
		const swapData: BoltzSwapData = {
			id: swapResponse.id,
			preimage: preimage.toString('hex'),
			preimageHash,
			invoice: swapResponse.invoice,
			amount: params.amountSats,
			rbtcAddress: params.rbtcAddress, // User's actual wallet
			claimAddress: claimAddress, // Address used for claiming (may be Smart Wallet)
			status: 'swap.created',
			onchainAmount: swapResponse.onchainAmount,
			refundAddress: swapResponse.refundAddress,
			timeoutBlockHeight: swapResponse.timeoutBlockHeight,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
			rifRelayUsed: useSmartWallet, // If Smart Wallet used, RIF Relay will be used
			description: params.description
		};

		// Store in memory
		this.activeSwaps.set(swapResponse.id, swapData);

		// Save swap data to storage if available
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

		// Subscribe to WebSocket updates
		this.websocket.subscribeToSwap(swapResponse.id, async (event) => {
			await this.handleSwapUpdate(event);
		});

		return {
			swapId: swapResponse.id,
			invoice: swapResponse.invoice,
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
		if (!swapData) return;

		// Track changes for conditional saving
		const previousStatus = swapData.status;
		const hadLockupTx = !!swapData.lockupTxHash;

		// Update swap data
		swapData.status = event.status;
		swapData.updatedAt = Date.now();

		if (event.transaction) {
			swapData.lockupTxHash = event.transaction.id;
		}

		// Handle different states
		switch (event.status) {
			case 'invoice.set':
				// Invoice has been paid and is on hold - waiting for our claim
				break;

			case 'transaction.mempool':
				// Boltz's lockup transaction is in mempool
				// ⚠️ IMPORTANT: We should NOT attempt to claim yet because the lockup
				// transaction hasn't been mined. The contract doesn't have the swap data yet.
				break;

			case 'transaction.confirmed':
				// Boltz has confirmed the lockup transaction - now we can claim!
				// Prevent concurrent claims
				if (this.claimingSwaps.has(swapData.id)) {
					console.warn('⚠️ Claim already in progress for swap:', swapData.id);
					break;
				}

				// Get wallet for claiming
				const wallet = this.walletGetter?.();

				if (!wallet) {
					// No wallet available - save state and wait
					if (this.storage && !skipSave) {
						await this.storage.save(swapData.id, swapData);
					}
					break;
				}

				// Add to claiming set
				this.claimingSwaps.add(swapData.id);

				// Strategy: Use the claim method that matches how the swap was created
				// - If swap was created with Smart Wallet address → MUST use RIF Relay
				// - If swap was created with user's wallet → can use direct claim or RIF Relay fallback
				let claimSuccessful = false;

				try {
					const wasCreatedForSmartWallet = swapData.claimAddress &&
						!areSameRskAddress(swapData.claimAddress, swapData.rbtcAddress);

					if (wasCreatedForSmartWallet) {
						// Swap was created with Smart Wallet address - MUST use RIF Relay
						if (isRifRelayAvailable()) {
							try {
								await this.claimRBTCViaRifRelay(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ RIF Relay claim failed:', error);
							}
						} else {
							console.error('❌ RIF Relay not available');
						}
					} else {
						// Swap was created with user's wallet - try direct claim first
						const balance = await wallet.provider.getBalance(wallet.address);
						const gasEstimate = await this.evmContractService.estimateClaimGas({
							signer: wallet,
							preimage: swapData.preimage,
							amount: swapData.onchainAmount || swapData.amount,
							refundAddress: swapData.refundAddress || swapData.rbtcAddress,
							timelock: swapData.timeoutBlockHeight || 0
						});
						const hasGas = balance >= gasEstimate;

						if (hasGas) {
							try {
								await this.claimRBTC(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ Direct claim failed:', error);
							}
						}

						// Try RIF Relay if direct claim failed or no gas
						if (!claimSuccessful && isRifRelayAvailable()) {
							try {
								await this.claimRBTCViaRifRelay(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ RIF Relay claim failed:', error);
							}
						}
					}

					if (!claimSuccessful) {
						console.warn('⚠️ All claim methods failed');
					}
				} catch (err) {
					console.error('❌ Claim process failed:', err);
				} finally {
					// Always remove from claiming set
					this.claimingSwaps.delete(swapData.id);
				}
				break;

			case 'invoice.settled':
				break;

			case 'invoice.expired':
			case 'swap.expired':
			case 'transaction.failed':
				console.error('❌ Swap failed:', swapData.id, event.status);
				break;
		}

		// Determine if we should save to storage
		const hasChanges =
			previousStatus !== swapData.status ||
			(!hadLockupTx && swapData.lockupTxHash);

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
	 * Claim RBTC via RIF Relay (gasless)
	 * 
	 * This method uses Boltz's proven RIF Relay implementation to claim RBTC
	 * without requiring the user to have gas. The transaction is executed FROM
	 * a Smart Wallet (deployed if needed). RIF Relay pays the gas fees.
	 * 
	 * @param swapData - Swap data with preimage and parameters
	 * @param walletSigner - User's EOA wallet (owns Smart Wallet)
	 * @returns Transaction hash
	 */
	async claimRBTCViaRifRelay(
		swapData: BoltzSwapData,
		walletSigner: ethers.Signer
	): Promise<{ txHash: string }> {
		try {
			// Validate required data
			if (
				!swapData.preimage ||
				!swapData.onchainAmount ||
				!swapData.refundAddress ||
				!swapData.timeoutBlockHeight
			) {
				throw new Error('Missing required swap data for claiming');
			}

			// Get EtherSwap contract address
			const etherSwapAddress = await this.evmContractService.getEtherSwapAddress();

			// Get actual lockup parameters from event
			let amount: number;
			let refundAddress: string;
			let timelock: number;

			if (swapData.lockupTxHash && walletSigner.provider) {
				const eventParams = await this.evmContractService.getLockupEventParameters(
					swapData.preimageHash,
					swapData.lockupTxHash,
					walletSigner.provider,
					etherSwapAddress
				);

				if (eventParams) {
					amount = weiToSatoshi(eventParams.amount);
					refundAddress = eventParams.refundAddress;
					timelock = eventParams.timelock;
				} else {
					amount = swapData.onchainAmount;
					refundAddress = swapData.refundAddress;
					timelock = swapData.timeoutBlockHeight;
				}
			} else {
				amount = swapData.onchainAmount;
				refundAddress = swapData.refundAddress;
				timelock = swapData.timeoutBlockHeight;
			}

			// Use RifRelayClaimService for gasless claim
			const txHash = await this.rifRelayService.claimViaRifRelay({
				walletSigner,
				contractAddress: etherSwapAddress,
				preimage: swapData.preimage,
				amount,
				refundAddress,
				timelock
			});

			// Update swap data
			swapData.claimTxHash = txHash;
			swapData.status = 'transaction.claim.pending';
			swapData.rifRelayUsed = true;
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			// Wait for confirmation
			if (walletSigner.provider) {
				await this.rifRelayService.waitForConfirmation(txHash, walletSigner.provider);
			}

			swapData.status = 'transaction.claimed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			return { txHash };
		} catch (error) {
			console.error('❌ RIF Relay claim failed:', error);
			swapData.status = 'transaction.claim.failed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			throw error;
		}
	}

	/**
	 * Claim RBTC with automatic method selection
	 * 
	 * This method automatically selects between:
	 * - Cooperative claim (gasless via Boltz RIF Relay) - when user has insufficient gas
	 * - Direct claim (user pays gas) - when user has sufficient gas
	 * 
	 * Falls back to direct claim if cooperative fails and wallet has gas.
	 * 
	 * @param swapData - The swap data
	 * @param walletSigner - User's wallet signer (optional, for direct claim)
	 * @returns Transaction hash
	 */
	async checkInvoicePaymentStatus(swapId: string): Promise<{
		mainInvoicePaid: boolean;
		serviceFeeInvoicePaid?: boolean;
		status: string;
	}> {
		return await this.boltzClient.checkInvoicePaymentStatus(swapId);
	}

	/**
	 * Update swap data and save to Nostr
	 * Used by the UI to update swap state
	 */
	async updateSwapData(swapData: BoltzSwapData): Promise<void> {
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
	}


	/**
	 * Claim rBTC from EtherSwap contract (Direct method - requires gas)
	 * 
	 * IMPORTANT: EtherSwap contract structure (from EtherSwap.sol):
	 * - Contract uses keccak256 hash of ALL parameters to index swaps
	 * - The claim() function auto-uses msg.sender as claimAddress
	 * - We don't need to query the contract - just call claim() directly
	 * - If swap doesn't exist or already claimed, the contract will revert
	 * 
	 * NOTE: This method requires the user to have RBTC for gas fees.
	 * For gasless claiming, use claimRBTCViaRifRelay() instead.
	 * 
	 * This method is called when swap reaches 'transaction.confirmed' status
	 * and user has sufficient gas balance.
	 */
	async claimRBTC(
		swapData: BoltzSwapData,
		walletSigner?: ethers.Signer
	): Promise<{ txHash: string }> {
		try {
			// Check if already claimed
			if (swapData.status === 'claimed' || swapData.status === 'transaction.claimed') {
				throw new Error('Swap already claimed');
			}

			if (swapData.claimTxHash) {
				throw new Error(`Swap already claimed in transaction: ${swapData.claimTxHash}`);
			}

			// Prevent claim pending state
			if (swapData.status === 'transaction.claim.pending') {
				throw new Error('Claim already in progress');
			}

			if (!walletSigner) {
				throw new Error('RSK wallet not connected. Please connect your wallet to claim funds.');
			}

			// Validate required swap data
			if (!swapData.preimage || !swapData.onchainAmount || !swapData.refundAddress || !swapData.timeoutBlockHeight) {
				throw new Error('Missing required swap data for claiming. Data: ' + JSON.stringify({
					hasPreimage: !!swapData.preimage,
					onchainAmount: swapData.onchainAmount,
					refundAddress: swapData.refundAddress,
					timeoutBlockHeight: swapData.timeoutBlockHeight
				}));
			}

			// CRITICAL: Get the ACTUAL parameters from the Lockup event
			// The API response may have different values than what was actually locked
			let amount: number;
			let refundAddress: string;
			let timelock: number;

			if (swapData.lockupTxHash && walletSigner.provider) {
				const eventParams = await this.evmContractService.getLockupEventParameters(
					swapData.preimageHash,
					swapData.lockupTxHash,
					walletSigner.provider
				);

				if (eventParams) {
					amount = weiToSatoshi(eventParams.amount);
					refundAddress = eventParams.refundAddress;
					timelock = eventParams.timelock;
				} else {
					console.warn('⚠️ Lockup event not found, using API values (may fail)');
					amount = swapData.onchainAmount; // in satoshis
					refundAddress = swapData.refundAddress!;
					timelock = swapData.timeoutBlockHeight!;
				}
			} else {
				console.warn('⚠️ No lockup TX hash, using API values (may fail)');
				amount = swapData.onchainAmount; // in satoshis
				refundAddress = swapData.refundAddress!;
				timelock = swapData.timeoutBlockHeight!;
			}

			// Use EvmContractService to claim funds
			const result = await this.evmContractService.claimFunds({
				signer: walletSigner,
				preimage: swapData.preimage,
				amount,
				refundAddress,
				timelock
			});

			// Update swap data with claim transaction hash
			swapData.claimTxHash = result.txHash;
			swapData.status = 'transaction.claimed';
			swapData.updatedAt = Date.now();

			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			return { txHash: result.txHash };
		} catch (error) {
			console.error('❌ Claim failed:', error);

			if (error instanceof Error && error.message.includes('swap has no Ether locked')) {
				console.error('💡 Swap not found. Reasons: \n\n 1) TX not confirmed, \n\n 2) Wrong parameters, \n\n 3) Already claimed');
				console.error('📊 Swap:', {
					id: swapData.id,
					amount: swapData.onchainAmount,
					claimAddress: swapData.rbtcAddress,
					refundAddress: swapData.refundAddress,
					timelock: swapData.timeoutBlockHeight,
					lockupTx: swapData.lockupTxHash
				});
			}

			// Update swap status to show claim failed
			swapData.status = 'transaction.claim.failed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			throw error;
		}
	}

	/**
	 * Recover pending swaps from storage on app startup
	 */
	async recoverPendingSwaps(): Promise<BoltzSwapData[]> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot recover swaps');
				return [];
			}

			const swaps = await this.storage.loadAll();

			// Store in memory and resubscribe to WebSocket
			for (const swap of swaps) {
				this.activeSwaps.set(swap.id, swap as BoltzSwapData);

				// Resubscribe to WebSocket with skipSave = true to avoid re-saving during recovery
				this.websocket.subscribeToSwap(swap.id, async (event) => {
					await this.handleSwapUpdate(event, true);
				});
			}

			return swaps as BoltzSwapData[];
		} catch (error) {
			console.error('Failed to recover swaps from storage:', error);
			return [];
		}
	}

	/**
	 * Get swap by ID
	 */
	getSwap(swapId: string): BoltzSwapData | undefined {
		return this.activeSwaps.get(swapId);
	}

	/**
	 * Get all active swaps
	 */
	getAllSwaps(): BoltzSwapData[] {
		return Array.from(this.activeSwaps.values());
	}

	/**
	 * Check swap status from Boltz API
	 */
	async checkSwapStatus(swapId: string): Promise<string> {
		const status = await this.boltzClient.getSwapStatus(swapId, true); // true = reverse swap
		return status.status;
	}

	/**
	 * Delete all reverse swap events from storage
	 * Useful for clearing test data
	 */
	async deleteAllSwaps(): Promise<{ count: number }> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swaps');
				return { count: 0 };
			}

			const swaps = await this.storage.loadAll();

			for (const swap of swaps) {
				await this.storage.delete(swap.id);
			}

			// Clear active swaps from memory
			this.activeSwaps.clear();

			return { count: swaps.length };
		} catch (error) {
			console.error('Failed to delete swaps:', error);
			throw error;
		}
	}

	/**
	 * Delete a single swap from storage
	 */
	async deleteSwap(swapId: string): Promise<boolean> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swap');
				return false;
			}

			await this.storage.delete(swapId);

			// Remove from memory
			this.activeSwaps.delete(swapId);

			return true;
		} catch (error) {
			console.error('Failed to delete swap:', error);
			return false;
		}
	}
}
