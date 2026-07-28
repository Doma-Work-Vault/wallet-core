/**
 * Boltz Exchange REST API Client
 * 
 * 
 * API ENDPOINTS IMPLEMENTED:
 * ✅ Swap pair information (submarine, reverse, chain)
 * ✅ Swap creation (submarine, chain)
 * ✅ Swap status queries
 * ✅ Invoice payment status checks
 * ✅ Fee estimates and calculations
 * ✅ EVM contract addresses
 * ✅ Partial refund signatures (for L-BTC refund services)
 * 
 * FEATURES:
 * 🔒 Custom BoltzError class with specific error codes
 * 🔒 Advanced rate limiting and retry logic with exponential backoff
 * 🔒 Comprehensive input validation and sanitization
 * 🔒 Network-specific configuration
 * 🔒 Request timeout and abort handling
 * 
 * NOTE: Refund transaction building is handled by dedicated refund services:
 * - ChainSwapRefundService: L-BTC refunds for chain swaps
 * - SubmarineSwapRefundService: BTC/L-BTC/RBTC refunds for submarine swaps
 */

import type { BoltzNetworkConfig } from '../../core/types';
import type {
	SwapFees,
	CreateChainSwapRequest,
	CreateChainSwapResponse,
	SwapStatus,
	SwapPairs,
	RefundSwapRequest,
	RefundSwapResponse,
	ClaimSwapRequest,
	ClaimSwapResponse,
	BroadcastTransactionRequest,
	BroadcastTransactionResponse,
	SubmarineCreatedResponse,
	TransactionInterface
} from './types';
import { Buffer } from 'buffer';
import { Interface, ethers } from 'ethers';
import { getBoltzConfig } from '../../utils/networkConfig';
import EtherSwapArtifact from 'boltz-core/out/EtherSwap.sol/EtherSwap.json';

export class BoltzError extends Error {
	constructor(
		message: string,
		public code: string,
		public statusCode?: number
	) {
		super(message);
		this.name = 'BoltzError';
	}
}

export class BoltzClient {
	private readonly maxRequestsPerSecond = 10;
	private config: BoltzNetworkConfig;
	private requestCount = 0;
	private lastRequestTime = 0;

	constructor() {
		this.config = getBoltzConfig();
	}


	/**
	 * Get available swap pairs and their limits
	 * Returns pairs like RBTC/BTC, BTC/BTC, L-BTC/BTC (where BTC represents Lightning)
	 */
	async getSubmarineSwapPairs(): Promise<SwapPairs> {
		try {
			const response = await this.request('GET', '/v2/swap/submarine');
			return response;
		} catch (error) {
			console.error('Failed to get swap pairs:', error);
			throw new BoltzError(
				'Swap pairs request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'SWAP_PAIRS_ERROR'
			);
		}
	}

	/**
	 * Get reverse swap pairs (Lightning → RBTC)
	 * Returns available reverse swap pairs with limits and fees
	 */
	async getReverseSwapPairs(): Promise<SwapPairs> {
		try {
			const response = await this.request('GET', '/v2/swap/reverse');
			return response;
		} catch (error) {
			console.error('Failed to get reverse swap pairs:', error);
			throw new BoltzError(
				'Reverse swap pairs request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'REVERSE_PAIRS_ERROR'
			);
		}
	}

	/**
	 * Get chain swap pairs (L-BTC → RBTC, etc.)
	 * Returns available chain-to-chain swap pairs with limits and fees
	 */
	async getChainSwapPairs(): Promise<SwapPairs> {
		try {
			const response = await this.request('GET', '/v2/swap/chain');
			return response;
		} catch (error) {
			console.error('Failed to get chain swap pairs:', error);
			throw new BoltzError(
				'Chain swap pairs request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'CHAIN_PAIRS_ERROR'
			);
		}
	}


	/**
	 * Get swap fees for different pair types
	 */
	async getSwapFees(): Promise<SwapFees> {
		try {
			const response = await this.request('GET', '/v2/swap/fees');
			return response;
		} catch (error) {
			console.error('Failed to get swap fees:', error);
			throw new BoltzError(
				'Swap fees request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'SWAP_FEES_ERROR'
			);
		}
	}

	/**
	 * Create a submarine swap (Chain → Lightning)
	 * Supports RBTC, BTC, and L-BTC to Lightning swaps
	 * 
	 * @param params - Swap parameters
	 * @param params.from - Source asset (RBTC, BTC, L-BTC)
	 * @param params.to - Destination asset (BTC for Lightning)
	 * @param params.invoice - Lightning invoice to be paid
	 * @param params.pairHash - Pair hash from getSwapPairs()
	 * @param params.refundPublicKey - Refund public key (required for BTC/L-BTC, optional for RBTC)
	 * @param params.referralId - Optional referral ID
	 */
	async createSubmarineSwap(params: {
		from: string;
		to: string;
		invoice: string;
		pairHash: string;
		refundPublicKey?: string;
		referralId?: string;
	}): Promise<SubmarineCreatedResponse> {
		// Validate inputs
		if (!params.from || !params.to || !params.invoice || !params.pairHash) {
			throw new BoltzError('Missing required parameters for submarine swap', 'INVALID_PARAMS');
		}

		// Validate Lightning invoice
		if (!params.invoice.toLowerCase().startsWith('ln')) {
			throw new BoltzError('Invalid Lightning invoice format', 'INVALID_PARAMS');
		}

		// For UTXO chains (BTC, L-BTC), refund public key is required
		const isUtxoChain = params.from === 'BTC' || params.from === 'L-BTC';
		if (isUtxoChain && !params.refundPublicKey) {
			throw new BoltzError('Refund public key required for UTXO chains', 'INVALID_PARAMS');
		}

		// Validate public key format if provided
		if (params.refundPublicKey) {
			try {
				const pubKeyBuffer = Buffer.from(params.refundPublicKey, 'hex');
				if (pubKeyBuffer.length !== 33 && pubKeyBuffer.length !== 65) {
					throw new BoltzError('Invalid refund public key length', 'INVALID_PARAMS');
				}
			} catch (error) {
				throw new BoltzError('Invalid refund public key format', 'INVALID_PARAMS');
			}
		}

		const requestBody = {
			from: params.from,
			to: params.to,
			invoice: params.invoice,
			pairHash: params.pairHash,
			referralId: params.referralId || '',
			...(params.refundPublicKey && { refundPublicKey: params.refundPublicKey })
		};

		try {
			const response = await this.request('POST', '/v2/swap/submarine', requestBody);

			// Validate response structure
			if (!response.id || !response.expectedAmount || !response.timeoutBlockHeight) {
				throw new BoltzError('Invalid response from Boltz API', 'INVALID_RESPONSE');
			}

			// For EVM chains (RBTC), response includes claimAddress
			// For UTXO chains (BTC, L-BTC), response includes address and swapTree
			if (params.from === 'RBTC' && !response.claimAddress) {
				throw new BoltzError('Missing claimAddress for RBTC swap', 'INVALID_RESPONSE');
			}

			if (isUtxoChain && (!response.address || !response.swapTree)) {
				throw new BoltzError('Missing address or swapTree for UTXO swap', 'INVALID_RESPONSE');
			}

			return response;
		} catch (error) {
			console.error('Failed to create submarine swap:', error);
			if (error instanceof BoltzError) throw error;
			throw new BoltzError(
				'Submarine swap creation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'SUBMARINE_SWAP_ERROR'
			);
		}
	}

	/**
	 * Create a chain swap (L-BTC → RBTC)
	 * User sends L-BTC first, then receives RBTC
	 * 
	 * IMPORTANT: Chain swaps require a refund key for L-BTC side
	 * Unlike reverse swaps, user locks funds first!
	 */
	async createChainSwap(params: {
		from: 'L-BTC';
		to: 'RBTC';
		userLockAmount: number;
		preimageHash: string;
		claimAddress: string;
		refundPublicKey: string;
		pairHash: string;
		referralId?: string;
	}): Promise<CreateChainSwapResponse> {
		// Validate inputs
		if (!params.from || !params.to || !params.preimageHash || !params.claimAddress || !params.refundPublicKey || !params.pairHash) {
			throw new BoltzError('Missing required parameters for chain swap', 'INVALID_PARAMS');
		}

		if (params.userLockAmount <= 0) {
			throw new BoltzError('Invalid user lock amount: must be greater than 0', 'INVALID_PARAMS');
		}

		// Validate preimage hash
		try {
			const hashBuffer = Buffer.from(params.preimageHash, 'hex');
			if (hashBuffer.length !== 32) {
				throw new BoltzError('Invalid preimage hash length: must be 32 bytes', 'INVALID_PARAMS');
			}
		} catch (error) {
			throw new BoltzError('Invalid preimage hash format', 'INVALID_PARAMS');
		}

		// Validate refund public key
		try {
			const pubKeyBuffer = Buffer.from(params.refundPublicKey, 'hex');
			if (pubKeyBuffer.length !== 33 && pubKeyBuffer.length !== 65) {
				throw new BoltzError('Invalid refund public key length', 'INVALID_PARAMS');
			}
		} catch (error) {
			throw new BoltzError('Invalid refund public key format', 'INVALID_PARAMS');
		}

		const request: CreateChainSwapRequest = {
			from: params.from,
			to: params.to,
			userLockAmount: params.userLockAmount,
			preimageHash: params.preimageHash,
			claimPublicKey: undefined, // Not used for RBTC
			refundPublicKey: params.refundPublicKey,
			claimAddress: params.claimAddress,
			pairHash: params.pairHash,
			referralId: params.referralId || ''
		};

		try {
			const response = await this.request('POST', '/v2/swap/chain', request);

			// Validate response structure
			if (!response.id || !response.lockupDetails || !response.claimDetails) {
				throw new BoltzError('Invalid response from Boltz API', 'INVALID_RESPONSE');
			}

			// Validate lockup details
			if (!response.lockupDetails.lockupAddress || !response.lockupDetails.blindingKey) {
				throw new BoltzError('Missing lockup details in response', 'INVALID_RESPONSE');
			}

			// Validate claim details
			if (!response.claimDetails.lockupAddress || !response.claimDetails.refundAddress) {
				throw new BoltzError('Missing claim details in response', 'INVALID_RESPONSE');
			}

			return response;
		} catch (error) {
			console.error('Failed to create chain swap:', error);
			if (error instanceof BoltzError) throw error;
			throw new BoltzError(
				'Chain swap creation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'CHAIN_SWAP_ERROR'
			);
		}
	}

	/**
	 * Get swap status by ID
	 * According to Boltz API v2 docs, there's no dedicated status endpoint.
	 * Status updates should be received via WebSocket subscription.
	 * This is a fallback that tries common endpoint patterns.
	 */
	async getSwapStatus(swapId: string, isReverse: boolean = false): Promise<SwapStatus> {
		if (!swapId || swapId.trim() === '') {
			throw new Error('Swap ID is required');
		}

		try {
			// Try the generic swap endpoint first (most likely to work)
			const response = await this.request('GET', `/v2/swap/${swapId}`);

			// Validate response has required status field
			if (!response.status) {
				throw new Error('Invalid status response from Boltz API');
			}

			return response;
		} catch (error) {
			console.error(`Failed to get swap status for ${swapId}:`, error);
			throw new Error('Failed to get swap status: ' + (error instanceof Error ? error.message : 'Unknown error'));
		}
	}

	/**
	 * Check if invoices have been paid for a reverse swap
	 * Used to manually verify payment status when WebSocket updates are missed
	 */
	async checkInvoicePaymentStatus(swapId: string): Promise<{
		mainInvoicePaid: boolean;
		serviceFeeInvoicePaid?: boolean;
		status: string;
	}> {
		if (!swapId || swapId.trim() === '') {
			throw new BoltzError('Swap ID is required', 'INVALID_PARAMS');
		}

		try {
			const response = await this.request('GET', `/v2/swap/reverse/${swapId}`);

			if (!response.status) {
				throw new BoltzError('Invalid status response', 'INVALID_RESPONSE');
			}

			// Determine if main invoice has been paid based on status
			// invoice.set, transaction.mempool, or transaction.confirmed indicate payment
			const mainInvoicePaid = ['invoice.set', 'transaction.mempool', 'transaction.confirmed', 'invoice.settled'].includes(response.status);

			return {
				mainInvoicePaid,
				serviceFeeInvoicePaid: response.serviceFeeInvoicePaid,
				status: response.status
			};
		} catch (error) {
			console.error(`Failed to check invoice payment status for ${swapId}:`, error);
			throw new BoltzError(
				'Invoice payment status check failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'PAYMENT_STATUS_ERROR'
			);
		}
	}

	/**
	 * Refund a failed swap
	 */
	async refundSwap(
		swapId: string,
		params: RefundSwapRequest
	): Promise<RefundSwapResponse> {
		return await this.request('POST', `/v2/swap/${swapId}/refund`, params);
	}

	/**
	 * Claim a reverse swap
	 */
	async claimSwap(
		swapId: string,
		params: ClaimSwapRequest
	): Promise<ClaimSwapResponse> {
		return await this.request('POST', `/v2/swap/${swapId}/claim`, params);
	}

	/**
	 * Broadcast a transaction
	 */
	async broadcastTransaction(
		params: BroadcastTransactionRequest
	): Promise<BroadcastTransactionResponse> {
		try {
			const response = await this.request('POST', '/v2/chain/broadcast', params);

			if (!response.transactionId) {
				throw new BoltzError('Invalid broadcast response', 'INVALID_RESPONSE');
			}

			return response;
		} catch (error) {
			console.error('Failed to broadcast transaction:', error);
			throw new BoltzError(
				'Transaction broadcast failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'BROADCAST_ERROR'
			);
		}
	}

	/**
	 * Get EVM contract addresses for swap contracts
	 * Used for EVM chain swaps (Rootstock, Ethereum, Polygon, etc.)
	 */
	async getContractAddresses(): Promise<{
		[chain: string]: {
			erc20Swap: string;
			etherSwap: string;
		};
	}> {
		try {
			const response = await this.request('GET', '/v2/chain/contracts');

			if (!response) {
				throw new BoltzError('Invalid contracts response', 'INVALID_RESPONSE');
			}

			return response;
		} catch (error) {
			console.error('Failed to get contract addresses:', error);
			throw new BoltzError(
				'Contract addresses request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'CONTRACTS_ERROR'
			);
		}
	}

	/**
	 * Calculate swap amounts including fees
	 */
	async calculateSwapAmount(
		pairId: string,
		amount: number,
		isReverse: boolean = false
	): Promise<{
		sendAmount: number;
		receiveAmount: number;
		fee: number;
		minerFee: number;
	}> {
		// Validate inputs
		if (!pairId || pairId.trim() === '') {
			throw new Error('Pair ID is required');
		}

		if (amount <= 0) {
			throw new Error('Amount must be greater than 0');
		}

		const endpoint = isReverse ? '/v2/swap/reverse/quote' : '/v2/swap/submarine/quote';

		try {
			const response = await this.request('POST', endpoint, {
				pairId,
				amount
			});

			// Validate response structure and ensure numeric values
			const result = {
				sendAmount: Number(response.sendAmount) || amount,
				receiveAmount: Number(response.receiveAmount) || 0,
				fee: Number(response.fee) || 0,
				minerFee: Number(response.minerFee) || 0
			};

			// Validate that the calculation makes sense
			if (result.receiveAmount <= 0) {
				throw new Error('Invalid quote: receive amount must be greater than 0');
			}

			return result;
		} catch (error) {
			console.error('Failed to calculate swap amount:', error);
			throw new BoltzError(
				'Swap amount calculation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'SWAP_CALCULATION_ERROR'
			);
		}
	}

	/**
	 * Get recommended fee rates
	 */
	async getFeeRates(): Promise<{
		BTC: { normal: number; slow: number; fast: number };
		LTC?: { normal: number; slow: number; fast: number };
	}> {
		try {
			const response = await this.request('GET', '/v2/chain/fees');

			// Validate response structure
			if (!response.BTC || typeof response.BTC.normal !== 'number') {
				throw new BoltzError('Invalid fee rates response', 'INVALID_RESPONSE');
			}

			return response;
		} catch (error) {
			console.error('Failed to get fee rates:', error);
			throw new BoltzError(
				'Fee rates request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'FEE_RATES_ERROR'
			);
		}
	}


	/**
	 * Get partial refund signature from Boltz for cooperative refunds
	 * Used for Taproot swaps (Submarine and Chain) to enable key path spending
	 */
	async getPartialRefundSignature(
		swapId: string,
		swapType: 'submarine' | 'chain',
		publicNonce: Buffer,
		refundTransaction: TransactionInterface,
		index: number
	): Promise<{
		pubNonce: Buffer;
		signature: Buffer;
	}> {
		if (!swapId || !publicNonce || !refundTransaction) {
			throw new BoltzError('Swap ID, public nonce, and refund transaction are required', 'INVALID_PARAMS');
		}

		const endpoint = swapType === 'chain'
			? `/v2/swap/chain/${swapId}/refund`
			: `/v2/swap/submarine/${swapId}/refund`;

		try {
			const response = await this.request('POST', endpoint, {
				index,
				pubNonce: publicNonce.toString('hex'),
				transaction: refundTransaction.toHex()
			});

			if (!response.pubNonce || !response.partialSignature) {
				throw new BoltzError('Invalid partial refund signature response', 'INVALID_RESPONSE');
			}

			return {
				pubNonce: Buffer.from(response.pubNonce, 'hex'),
				signature: Buffer.from(response.partialSignature, 'hex')
			};
		} catch (error) {
			console.error(`Failed to get partial refund signature for ${swapId}:`, error);
			throw new BoltzError(
				'Partial refund signature request failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
				'PARTIAL_REFUND_SIGNATURE_ERROR'
			);
		}
	}


	/**
	 * Rate limiting helper
	 */
	private async enforceRateLimit(): Promise<void> {
		const now = Date.now();

		// Reset counter every second
		if (now - this.lastRequestTime >= 1000) {
			this.requestCount = 0;
			this.lastRequestTime = now;
		}

		// Check rate limit
		if (this.requestCount >= this.maxRequestsPerSecond) {
			const waitTime = 1000 - (now - this.lastRequestTime);
			if (waitTime > 0) {
				await this.delay(waitTime);
				return this.enforceRateLimit();
			}
		}

		this.requestCount++;
	}

	/**
	 * Make HTTP request to Boltz API with production-ready error handling
	 */
	private async request(
		method: 'GET' | 'POST',
		endpoint: string,
		body?: any
	): Promise<any> {
		// Enforce rate limiting
		await this.enforceRateLimit();

		const url = `${this.config.boltzApiUrl}${endpoint}`;
		const timeout = 30000;
		const maxRetries = 3;
		let retryCount = 0;

		while (retryCount < maxRetries) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			try {
				const response = await fetch(url, {
					method,
					headers: {
						'Content-Type': 'application/json',
						'User-Agent': 'BitTasker/1.0',
						'Accept': 'application/json'
					},
					body: body ? JSON.stringify(body) : undefined,
					signal: controller.signal
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					const errorText = await response.text();

					// Handle specific HTTP status codes
					switch (response.status) {
						case 429:
							throw new Error('Rate limit exceeded - please try again later');
						case 400:
							throw new Error(`Bad request: ${errorText}`);
						case 401:
							throw new Error('Unauthorized - check API credentials');
						case 403:
							throw new Error('Forbidden - insufficient permissions');
						case 404:
							throw new Error(`Endpoint not found: ${endpoint}`);
						case 500:
							throw new Error('Boltz server error - please try again later');
						case 503:
							throw new Error('Boltz service unavailable - please try again later');
						default:
							throw new Error(`Boltz API error: ${response.status} ${errorText}`);
					}
				}

				const contentType = response.headers.get('content-type');
				if (!contentType || !contentType.includes('application/json')) {
					throw new Error('Invalid response content type');
				}

				const result = await response.json();

				// Validate that we got a valid JSON response
				if (result === null || result === undefined) {
					throw new Error('Empty response from Boltz API');
				}

				return result;
			} catch (error) {
				clearTimeout(timeoutId);

				if (error instanceof Error && error.name === 'AbortError') {
					throw new Error(`Boltz API request timeout after ${timeout}ms`);
				}

				// Retry on network errors (but not on API errors)
				if (retryCount < maxRetries - 1 &&
					(error instanceof TypeError ||
						(error instanceof Error && error.message.includes('fetch')))) {
					retryCount++;
					console.warn(`Boltz API request failed, retrying (${retryCount}/${maxRetries}):`, error.message);
					await this.delay(1000 * retryCount); // Exponential backoff
					continue;
				}

				throw error;
			}
		}

		throw new Error('Max retries exceeded for Boltz API request');
	}

	/**
	 * Utility delay function
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * Get actual lockup parameters from the Lockup event in the blockchain transaction
 * This is CRITICAL because the Boltz API response may have different values than what's actually locked
 * 
 * The Lockup event contains the EXACT parameters that were used:
 * event Lockup(bytes32 indexed preimageHash, uint256 amount, address claimAddress, address indexed refundAddress, uint256 timelock)
 */
export async function getLockupEventParameters(
	contractAddress: string,
	preimageHash: string,
	lockupTxHash: string,
	provider: ethers.Provider
): Promise<{
	amount: bigint;
	claimAddress: string;
	refundAddress: string;
	timelock: number;
} | null> {
	try {

		// Wait for the transaction receipt with retry logic
		// RSK blocks are ~30s, so we need enough retries to cover multiple blocks
		let receipt = null;
		const maxRetries = 30; // 30 retries × 3s = 90s (covers 3 RSK blocks)
		const retryDelay = 3000; // 3 seconds

		for (let i = 0; i < maxRetries; i++) {
			receipt = await provider.getTransactionReceipt(lockupTxHash);

			if (receipt) {
				break;
			}

			if (i < maxRetries - 1) {
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}

		if (!receipt) {
			console.error('❌ Transaction receipt not found after', maxRetries, 'attempts (', (maxRetries * retryDelay) / 1000, 's total)');
			return null;
		}

		// Create contract interface to parse events
		const iface = new Interface(EtherSwapArtifact.abi);

		// The preimageHash should be 0x-prefixed for comparison
		const preimageHashWithPrefix = preimageHash.startsWith('0x') ? preimageHash : '0x' + preimageHash;

		// Find the Lockup event in the logs
		for (const log of receipt.logs) {
			// Check if this log is from our contract
			if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
				continue;
			}

			try {
				const parsed = iface.parseLog({
					topics: [...log.topics],
					data: log.data
				});

				if (parsed?.name === 'Lockup') {
					// Event structure: Lockup(bytes32 indexed preimageHash, uint256 amount, address claimAddress, address indexed refundAddress, uint256 timelock)
					const eventPreimageHash = parsed.args[0];

					// Check if this is the event for our swap
					if (eventPreimageHash.toLowerCase() === preimageHashWithPrefix.toLowerCase()) {
						return {
							amount: parsed.args[1],
							claimAddress: parsed.args[2],
							refundAddress: parsed.args[3],
							timelock: Number(parsed.args[4])
						};
					}
				}
			} catch (e) {
				// Not a Lockup event or failed to parse, continue
				console.error('⚠️ Failed to parse log:', e);
			}
		}

		console.warn('⚠️ No matching Lockup event found in transaction');
		return null;
	} catch (error) {
		console.error('❌ Failed to get lockup event parameters:', error);
		return null;
	}
}