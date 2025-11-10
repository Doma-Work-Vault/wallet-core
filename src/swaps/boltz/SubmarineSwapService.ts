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
	SubmarineRefundResult
} from './types';
import type { SwapStorage } from './storage';
import { ethers } from 'ethers';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { EvmContractService } from './EvmContractService';
import { SubmarineSwapRefundService } from './SubmarineSwapRefundService';

export class SubmarineSwapService {
	private boltzClient: BoltzClient;
	private websocket: BoltzWebSocket;
	private evmContractService: EvmContractService;
	private refundService: SubmarineSwapRefundService;
	private activeSwaps: Map<string, SubmarineSwapData> = new Map();
	private storage?: SwapStorage;

	constructor(storage: SwapStorage, websocket: BoltzWebSocket) {
		this.boltzClient = new BoltzClient();
		this.storage = storage;
		this.evmContractService = new EvmContractService(this.boltzClient);
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

			// Create swap via Boltz API
			const swapResponse = await this.boltzClient.createSubmarineSwap({
				from: params.from,
				to: params.to,
				invoice: params.invoice,
				pairHash: pairInfo.hash,
				refundPublicKey: params.refundPublicKey,
				referralId: params.referralId || ''
			});

			// Decode invoice to get amount
			const invoiceAmount = this.decodeInvoiceAmount(params.invoice);

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
				preimageHash: swapResponse.preimageHash, // Boltz's preimage hash
				swapTree: swapResponse.swapTree, // For BTC/L-BTC
				blindingKey: swapResponse.blindingKey, // For L-BTC
				bip21: swapResponse.bip21 // For BTC/L-BTC
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
				swapData
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
	 * @returns Transaction hash
	 */
	async lockFundsEVM(swapData: SubmarineSwapData, signer: ethers.Signer): Promise<{ txHash: string }> {
		try {
			// Validate swap data
			if (swapData.fromAsset !== 'RBTC') {
				throw new Error('lockFundsEVM is only for RBTC swaps');
			}

			if (!swapData.claimAddress) {
				throw new Error('Missing claim address for RBTC swap');
			}

			if (!swapData.preimageHash) {
				throw new Error('Missing preimage hash for RBTC swap');
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
	 */
	private async handleSwapUpdate(event: SwapEvent): Promise<void> {
		const swapData = this.activeSwaps.get(event.swapId);
		if (!swapData) return;

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
				console.log('✅ Lockup transaction detected in mempool');
				break;

			case 'transaction.confirmed':
				// User's lockup confirmed - Boltz will now pay invoice
				console.log('✅ Lockup transaction confirmed');
				break;

			case 'invoice.paid':
				// Boltz paid the Lightning invoice - swap successful!
				console.log('✅ Lightning invoice paid by Boltz');
				break;

			case 'transaction.claimed':
				// Boltz claimed the on-chain funds
				console.log('✅ Boltz claimed on-chain funds - swap complete');
				break;

			case 'swap.expired':
			case 'transaction.failed':
				console.error('❌ Swap failed:', swapData.id, event.status);
				break;
		}

		// Update storage
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
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

					// Re-subscribe to WebSocket
					this.websocket.subscribeToSwap(swap.id, (event) => this.handleSwapUpdate(event));
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
	 * Decode Lightning invoice amount
	 * Simple decoder - in production, use a proper BOLT11 decoder
	 */
	private decodeInvoiceAmount(invoice: string): number {
		// This is a simplified decoder
		// In production, use bolt11 library or similar
		try {
			// Lightning invoices encode amount in the invoice string
			// Format: ln[network][amount][multiplier]...
			// For now, return 0 and let the API response provide the amount
			return 0;
		} catch (error) {
			console.warn('Failed to decode invoice amount:', error);
			return 0;
		}
	}
}


