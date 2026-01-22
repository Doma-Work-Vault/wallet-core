/**
 * Boltz Submarine Swap Service (Chain → Lightning)
 * Client-side implementation with storage support
 * 
 * Features:
 * - Creates submarine swaps from RBTC, BTC, or L-BTC to Lightning
 * - Stores swap data encrypted in storage (Nostr/IndexedDB/localStorage)
 * - Real-time WebSocket monitoring
 * - Automatic refund handling for expired swaps
 * - Recovery from storage on app restart
 * 
 * ⚠️ CRITICAL: Understanding Submarine Swap Flow
 * ===============================================
 * 
 * In a submarine swap (Chain → Lightning):
 * 
 * 1. **User provides Lightning invoice** they want paid
 * 2. **Boltz creates swap** with lockup address/contract
 * 3. **User locks funds on-chain** (RBTC in EtherSwap, BTC/L-BTC to address)
 * 4. **Boltz detects lockup** (transaction.mempool, then transaction.confirmed)
 * 5. **Boltz pays Lightning invoice** using their node
 * 6. **Boltz claims on-chain funds** using preimage from invoice payment
 * 7. **Swap complete** - atomic and trustless!
 * 
 * The key insight: USER locks funds FIRST, then Boltz pays invoice.
 * This is opposite of reverse swaps. If Boltz doesn't pay, user can refund after timeout.
 * 
 * States we'll see:
 * - swap.created: Swap created, waiting for user's lockup
 * - transaction.mempool: User's lockup tx in mempool
 * - transaction.confirmed: User's lockup confirmed
 * - invoice.paid: Boltz paid the invoice ✅
 * - transaction.claimed: Boltz claimed the on-chain funds
 */

import type {
	SwapEvent,
	SubmarineSwapData,
	SubmarineSwapStatus,
	CreateSubmarineSwapParams,
	SubmarineSwapResult,
	LockupInfo,
	SubmarineRefundParams,
	SubmarineRefundResult,
	SwapUpdateEvent
} from './types';
import type { SwapStorage } from './storage';
import { ethers } from 'ethers';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { EvmContractService } from './EvmContractService';
import { SubmarineSwapRefundService } from './SubmarineSwapRefundService';
import { weiToSatoshi } from '../../utils/networkConfig';
import { EventBus } from '../../core/EventBus';
import bolt11 from 'bolt11';

export class SubmarineSwapService {
	private boltzClient: BoltzClient;
	private websocket: BoltzWebSocket;
	private evmContractService: EvmContractService;
	private refundService: SubmarineSwapRefundService;
	private activeSwaps: Map<string, SubmarineSwapData> = new Map();
	private storage?: SwapStorage;
	
	public events = new EventBus();
	
	constructor(websocket: BoltzWebSocket, boltzClient: BoltzClient, evmContractService: EvmContractService, storage?: SwapStorage) {
		this.boltzClient = boltzClient;
		this.storage = storage;
		this.evmContractService = evmContractService;
		this.refundService = new SubmarineSwapRefundService(this.boltzClient);
		this.refundService.setEvmContractService(this.evmContractService);
		this.websocket = websocket;
	}

	/**
	 * Get swap limits for a specific pair
	 * 
	 * @param from - Source asset (RBTC, BTC, L-BTC)
	 * @param to - Destination asset (BTC for Lightning)
	 * @returns Minimal and maximal amounts in satoshis
	 */
	async getSwapLimits(from: string, to: string = 'BTC'): Promise<{ minimal: number; maximal: number }> {
		try {
			const pairs = await this.boltzClient.getSubmarineSwapPairs();

			// API returns nested structure: pairs[from][to]
			const pairInfo = pairs?.[from]?.[to];

			if (!pairInfo || !pairInfo.limits) {
				console.warn('Could not find pair limits in response:', pairs);
				throw new Error(`Submarine swap pair ${from}/${to} not available`);
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
	 * Create a submarine swap (Chain → Lightning)
	 * 
	 * This creates the swap on Boltz's side and returns the lockup details.
	 * For RBTC: User must call lockFundsEVM() to lock funds in EtherSwap contract
	 * For BTC/L-BTC: User must send funds to the returned lockup address
	 * 
	 * @param params - Swap creation parameters
	 * @returns Swap ID and swap data
	 */
	async createSubmarineSwap(params: CreateSubmarineSwapParams): Promise<SubmarineSwapResult> {
		try {
			// Validate invoice
			if (!params.invoice || !params.invoice.toLowerCase().startsWith('ln')) {
				throw new Error('Invalid Lightning invoice format');
			}

			// Get submarine swap pairs to validate and get pairHash
			const pairs = await this.boltzClient.getSubmarineSwapPairs();
			const pairInfo = pairs?.[params.from]?.[params.to];

			if (!pairInfo) {
				throw new Error(`Submarine swap pair ${params.from}/${params.to} not available`);
			}

			// Try to create swap via Boltz API
			let swapResponse;
			try {
				swapResponse = await this.boltzClient.createSubmarineSwap({
					from: params.from,
					to: params.to,
					invoice: params.invoice,
					pairHash: pairInfo.hash,
					refundPublicKey: params.refundPublicKey,
					referralId: params.referralId || ''
				});
			} catch (error) {
				// Check if error is due to duplicate invoice
				if (error instanceof Error && error.message.includes('swap with this invoice exists already')) {					
					// Try to find and return existing swap
					const existingSwap = await this.findSwapByInvoice(params.invoice);
					
					if (existingSwap) {
						return await this.prepareExistingSwapResult(existingSwap, params);
					}
					
					// If we couldn't find the swap, re-throw the original error
					throw new Error(
						'A swap with this invoice already exists on Boltz, but could not be found. ' +
						'Please use a new Lightning invoice or wait for the existing swap to complete/expire.'
					);
				}
				
				// Re-throw other errors
				throw error;
			}

			// Decode the invoice to extract amount and payment hash
			const decodedInvoice = bolt11.decode(params.invoice);

			// Extract amount from invoice (in millisatoshis)
			const invoiceAmount = decodedInvoice.millisatoshis
				? Math.floor(Number(decodedInvoice.millisatoshis) / 1000) // Convert to satoshis
				: 0; // Some invoices may not have an amount (amount-less invoices)

			// Extract the payment hash (preimage hash)
			const paymentHashTag = decodedInvoice.tags.find((tag) => tag.tagName === 'payment_hash');

			if (!paymentHashTag) {
				throw new Error('Invoice does not contain payment hash');
			}

			// Convert the payment hash to hex string
			const preimageHash = Buffer.from(paymentHashTag.data as string, 'hex').toString('hex');

			// Calculate expiration time based on timeout block height
			// RBTC: ~30s blocks, BTC: ~10min blocks, L-BTC: ~1min blocks
			const blockTime = params.from === 'RBTC' ? 30 : params.from === 'L-BTC' ? 60 : 600;
			const expiresAt = Date.now() + (swapResponse.timeoutBlockHeight * blockTime * 1000);

			// Prepare swap data
			const swapData: SubmarineSwapData = {
				id: swapResponse.id,
				type: 'submarine',
				invoice: params.invoice,
				invoiceAmount: invoiceAmount,
				fromAsset: params.from as 'RBTC' | 'BTC' | 'L-BTC',
				fromAmount: swapResponse.expectedAmount,
				lockupAddress: swapResponse.address || swapResponse.claimAddress || '',
				status: 'swap.created',
				expectedAmount: swapResponse.expectedAmount,
				acceptZeroConf: swapResponse.acceptZeroConf || false,
				timeoutBlockHeight: swapResponse.timeoutBlockHeight,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				expiresAt,
				// Chain-specific fields
				refundPublicKey: params.refundPublicKey,
				claimAddress: swapResponse.claimAddress, // For RBTC
				preimageHash,
				swapTree: swapResponse.swapTree, // For BTC/L-BTC
				blindingKey: swapResponse.blindingKey, // For L-BTC
				bip21: swapResponse.bip21, // For BTC/L-BTC
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

			// Estimate gas for RBTC swaps if signer is provided
			let estimatedGas: SubmarineSwapResult['estimatedGas'];
			if (params.from === 'RBTC' && params.signer && swapData.claimAddress && swapData.preimageHash) {
				try {
					const gasWei = await this.evmContractService.estimateLockupGas({
						signer: params.signer,
						preimageHash: swapData.preimageHash,
						claimAddress: swapData.claimAddress,
						timeoutBlockHeight: swapData.timeoutBlockHeight,
						amountSats: swapData.fromAmount
					});

					const gasSats = weiToSatoshi(gasWei);
					estimatedGas = {
						costWei: gasWei,
						costSats: gasSats,
						totalRequired: swapData.fromAmount + gasSats
					};
				} catch (error) {
					console.warn('⚠️ Failed to estimate gas for submarine swap:', error);
					// Continue without gas estimation - non-critical
				}
			}

			return {
				swapId: swapResponse.id,
				swapData,
				estimatedGas
			};
		} catch (error) {
			console.error('Failed to create submarine swap:', error);
			throw error;
		}
	}

	/**
	 * Lock funds in EtherSwap contract for RBTC submarine swaps
	 * 
	 * This is the critical step where the user locks RBTC on-chain.
	 * After this, Boltz will pay the Lightning invoice and claim the RBTC.
	 * 
	 * @param swapData - Submarine swap data
	 * @param signer - User's wallet signer
	 * @param preimageHash - Payment hash from the Lightning invoice (32 bytes hex)
	 * @returns Transaction hash
	 */
	async lockFundsEVM(
		swapData: SubmarineSwapData,
		signer: ethers.Signer
	): Promise<{ txHash: string }> {
		try {
			// Validate swap data
			if (swapData.fromAsset !== 'RBTC') {
				throw new Error('lockFundsEVM is only for RBTC swaps');
			}

			if (!swapData.claimAddress) {
				throw new Error('Missing claim address for RBTC swap');
			}

			if (!swapData.preimageHash) {
				throw new Error('Missing preimage hash');
			}

			// Validate preimage hash format
			if (!/^[0-9a-fA-F]{64}$/.test(swapData.preimageHash)) {
				throw new Error('Invalid preimage hash format: must be 64 hex characters (32 bytes)');
			}

			// Check if already locked
			if (swapData.lockupTxHash) {
				throw new Error('Funds already locked for this swap');
			}

			// Lock funds via EVM contract service
			const result = await this.evmContractService.lockFunds({
				signer,
				preimageHash: swapData.preimageHash,
				claimAddress: swapData.claimAddress,
				timeoutBlockHeight: swapData.timeoutBlockHeight,
				amountSats: swapData.fromAmount
			});

			// Update swap data
			swapData.lockupTxHash = result.txHash;
			swapData.status = 'transaction.mempool';
			swapData.updatedAt = Date.now();

			// Save to storage
			if (this.storage) {
				await this.storage.save(swapData.id, swapData);
			}

			return { txHash: result.txHash };
		} catch (error) {
			console.error('Failed to lock funds:', error);
			throw error;
		}
	}

	/**
	 * Get lockup information for UTXO chains (BTC, L-BTC)
	 * 
	 * Returns the address and amount the user needs to send to.
	 * User should use their Bitcoin/Liquid wallet to send funds.
	 * 
	 * @param swapData - Submarine swap data
	 * @returns Lockup information
	 */
	getLockupInfo(swapData: SubmarineSwapData): LockupInfo {
		if (swapData.fromAsset === 'RBTC') {
			throw new Error('Use lockFundsEVM() for RBTC swaps');
		}

		return {
			address: swapData.lockupAddress,
			amount: swapData.fromAmount,
			bip21: swapData.bip21,
			blindingKey: swapData.blindingKey,
			timeoutBlockHeight: swapData.timeoutBlockHeight
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
		swapData.status = event.status as SubmarineSwapStatus;
		swapData.updatedAt = Date.now();

		if (event.transaction) {
			swapData.lockupTxHash = event.transaction.id;
		}

		// Handle different states
		switch (event.status) {
			case 'swap.created':
				// Swap created, waiting for user lockup
				break;

			case 'transaction.mempool':
				// User's lockup transaction is in mempool
				break;

			case 'transaction.confirmed':
				// User's lockup confirmed - Boltz will now pay invoice
				break;

			case 'invoice.paid':
				// Boltz paid the Lightning invoice - swap successful!
				break;

			case 'transaction.claimed':
				// Boltz claimed the on-chain funds
				break;

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
	 * Refund a submarine swap (if expired or failed)
	 * 
	 * For RBTC: Refunds via EtherSwap contract (can use RIF Relay for gasless)
	 * For BTC/L-BTC: Creates refund transaction using refund key
	 * 
	 * @param params - Refund parameters
	 * @returns Refund transaction hash
	 */
	async refundSubmarineSwap(params: SubmarineRefundParams): Promise<SubmarineRefundResult> {
		const swapData = this.activeSwaps.get(params.swapId);
		if (!swapData) {
			throw new Error(`Swap ${params.swapId} not found`);
		}

		// Use refund service to handle the refund
		const result = await this.refundService.refundSubmarineSwap(swapData, params);

		// Update local state
		this.activeSwaps.set(params.swapId, result.swapData);

		// Save to storage
		if (this.storage) {
			await this.storage.save(result.swapData.id, result.swapData);
		}

		return result;
	}

	/**
	 * Recover pending submarine swaps from storage
	 */
	async recoverPendingSwaps(): Promise<SubmarineSwapData[]> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot recover swaps');
				return [];
			}

			const swaps = await this.storage.loadAll();
			const submarineSwaps: SubmarineSwapData[] = [];

			for (const swap of swaps) {
				// Filter for submarine swaps only
				if (swap.type === 'submarine') {
					// Store in memory
					this.activeSwaps.set(swap.id, swap as SubmarineSwapData);
					submarineSwaps.push(swap as SubmarineSwapData);

					// Re-subscribe to WebSocket with skipSave = true to avoid re-saving during recovery
					this.websocket.subscribeToSwap(swap.id, (event) => this.handleSwapUpdate(event, true));
				}
			}

			return submarineSwaps;
		} catch (error) {
			console.error('❌ Failed to recover submarine swaps from storage:', error);
			return [];
		}
	}

	/**
	 * Get active submarine swaps
	 */
	getActiveSwaps(): SubmarineSwapData[] {
		return Array.from(this.activeSwaps.values());
	}

	/**
	 * Get submarine swap by ID
	 */
	getSwap(swapId: string): SubmarineSwapData | undefined {
		return this.activeSwaps.get(swapId);
	}

	/**
	 * Delete all submarine swaps from storage
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
				if (swap.type === 'submarine') {
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
	 * Delete a single submarine swap from storage
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
	 * Find a submarine swap by invoice
	 * Checks both active swaps and storage
	 * 
	 * @param invoice - Lightning invoice to search for
	 * @returns Existing swap data or undefined
	 */
	private async findSwapByInvoice(invoice: string): Promise<SubmarineSwapData | undefined> {
		// Check active swaps first (faster, in-memory)
		const activeSwap = Array.from(this.activeSwaps.values()).find(
			swap => swap.invoice === invoice
		);
		
		if (activeSwap) {
			return activeSwap;
		}
		
		// Check storage (slower, but catches recovered swaps)
		if (this.storage) {
			try {
				const allSwaps = await this.storage.loadAll();
				const storedSwap = allSwaps.find(
					swap => swap.type === 'submarine' && (swap as SubmarineSwapData).invoice === invoice
				);
				
				if (storedSwap) {
					return storedSwap as SubmarineSwapData;
				}
			} catch (error) {
				console.warn('⚠️ Failed to check storage for existing swap:', error);
			}
		}
		
		return undefined;
	}

	/**
	 * Prepare result for existing swap
	 * Ensures swap is in activeSwaps, resubscribes to WebSocket, and recalculates gas if needed
	 * 
	 * @param existingSwap - The existing swap data
	 * @param params - Original creation parameters (for gas estimation)
	 * @returns Swap result ready for user to complete payment
	 */
	private async prepareExistingSwapResult(
		existingSwap: SubmarineSwapData,
		params: CreateSubmarineSwapParams
	): Promise<SubmarineSwapResult> {
		// Check if swap is still valid (not expired, not failed, not completed)
		const now = Date.now();
		const isExpired = existingSwap.expiresAt < now;
		const isFailed = existingSwap.status === 'transaction.failed' || existingSwap.status === 'swap.expired';
		const isCompleted = existingSwap.status === 'invoice.paid' || existingSwap.status === 'transaction.claimed';
		
		if (isExpired) {
			throw new Error(
				`Cannot reuse this invoice - the previous swap has expired. ` +
				`Please generate a new Lightning invoice.`
			);
		}
		
		if (isFailed) {
			throw new Error(
				`Cannot reuse this invoice - the previous swap has failed. ` +
				`Please generate a new Lightning invoice.`
			);
		}
		
		if (isCompleted) {
			throw new Error(
				`This invoice has already been paid (swap ${existingSwap.id}). ` +
				`Please generate a new Lightning invoice.`
			);
		}
		
		// Swap is still active and can be completed		
		// Make sure it's in activeSwaps
		if (!this.activeSwaps.has(existingSwap.id)) {
			this.activeSwaps.set(existingSwap.id, existingSwap);
		}
		
		// Re-subscribe to WebSocket updates
		this.websocket.subscribeToSwap(existingSwap.id, async (event) => {
			await this.handleSwapUpdate(event);
		});
		
		// Recalculate gas estimate if needed (for RBTC)
		let estimatedGas: SubmarineSwapResult['estimatedGas'];
		if (params.from === 'RBTC' && params.signer && existingSwap.claimAddress && existingSwap.preimageHash) {
			try {
				const gasWei = await this.evmContractService.estimateLockupGas({
					signer: params.signer,
					preimageHash: existingSwap.preimageHash,
					claimAddress: existingSwap.claimAddress,
					timeoutBlockHeight: existingSwap.timeoutBlockHeight,
					amountSats: existingSwap.fromAmount
				});

				const gasSats = weiToSatoshi(gasWei);
				estimatedGas = {
					costWei: gasWei,
					costSats: gasSats,
					totalRequired: existingSwap.fromAmount + gasSats
				};
			} catch (error) {
				console.warn('⚠️ Failed to estimate gas for existing swap:', error);
			}
		}
		
		// Return the existing swap - user can proceed to lock funds
		return {
			swapId: existingSwap.id,
			swapData: existingSwap,
			estimatedGas
		};
	}
}


