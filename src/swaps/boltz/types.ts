/**
 * Boltz Exchange API Types
 * Type definitions for Boltz REST API v2 and swap operations
 * 
 * @see https://api.docs.boltz.exchange/api-v2.html
 */

/**
 * All possible swap status states from Boltz API
 */
export type SwapStatusType =
	// Creation states
	| 'swap.created'
	| 'swap.expired'

	// Invoice states  
	| 'invoice.set'
	| 'invoice.paid'
	| 'invoice.pending'
	| 'invoice.settled'
	| 'invoice.expired'
	| 'invoice.failedToPay'

	// Transaction states
	| 'transaction.mempool'
	| 'transaction.confirmed'
	| 'transaction.failed'
	| 'transaction.lockupFailed'
	| 'transaction.refunded'

	// Chain swap specific - server side transactions
	| 'transaction.server.mempool'
	| 'transaction.server.confirmed'

	// Claim states
	| 'transaction.claim.pending'
	| 'transaction.claim.failed'
	| 'transaction.claimed'

	// Refund states
	| 'swap.refunded';

export interface SwapStatus {
	status: SwapStatusType;
	transaction?: {
		id: string;
		hex?: string;
		eta?: number;
	};
	failureReason?: string;
}

// ============================================================================
// Swap Creation Types
// ============================================================================

export interface SwapLimits {
	minimal: number;
	maximal: number;
}

export interface SwapPairs {
	[pair: string]: SwapLimits;
}

export interface SwapFees {
	percentage: number;
	miner: {
		normal: number;
		reverse: {
			lockup: number;
			claim: number;
		};
	};
}

// ============================================================================
// Submarine Swap Types (Lightning → Bitcoin)
// ============================================================================

export interface CreateSwapRequest {
	type: 'submarine';
	pairId: string;
	orderSide: 'sell';
	invoice: string;
	refundPublicKey: string;
	referralId?: string;
}

export interface CreateSwapResponse {
	id: string;
	address: string;
	redeemScript: string;
	acceptZeroConf: boolean;
	expectedAmount: number;
	timeoutBlockHeight: number;
	blindingKey?: string; // For Liquid
}

// ============================================================================
// Reverse Swap Types (Bitcoin → Lightning)
// ============================================================================

export interface CreateReverseSwapRequest {
	type: 'reversesubmarine';
	pairId: string;
	orderSide: 'buy';
	invoiceAmount: number;
	preimageHash: string;
	claimPublicKey: string;
	referralId?: string;
	claimAddress?: string; // Optional RBTC address for direct claiming
}

export interface CreateReverseSwapResponse {
	id: string;
	invoice: string;
	redeemScript: string;
	lockupAddress: string;
	onchainAmount: number;
	timeoutBlockHeight: number;
	blindingKey?: string; // For Liquid
}

// ============================================================================
// Chain Swap Types (L-BTC → RBTC)
// ============================================================================

/**
 * Chain swap request for L-BTC to RBTC swaps
 * 
 * Note: Chain swaps are different from reverse swaps:
 * - User locks L-BTC first (not Lightning payment)
 * - Requires refund key for L-BTC side
 * - No claim public key for RBTC (uses address)
 */
export interface CreateChainSwapRequest {
	from: 'L-BTC';
	to: 'RBTC';
	userLockAmount?: number; // Amount user will send in sats (optional)
	serverLockAmount?: number; // Amount user will receive in sats (optional)
	preimageHash: string;
	claimPublicKey?: undefined; // Not used for RBTC (uses address)
	refundPublicKey: string; // For L-BTC refunds if swap fails
	claimAddress: string; // RBTC address (or Smart Wallet)
	pairHash: string;
	referralId?: string;
}

/**
 * Chain swap response from Boltz API
 * Contains both L-BTC lockup details and RBTC claim details
 */
export interface CreateChainSwapResponse {
	id: string;
	// User sends L-BTC here
	lockupDetails: {
		lockupAddress: string; // L-BTC address
		amount: number; // Amount to send in sats
		blindingKey: string; // Liquid confidential tx blinding key
		swapTree: any; // Swap tree data for refunds
		serverPublicKey: string; // Boltz public key
		timeoutBlockHeight: number; // Liquid block height for refund
	};
	// User receives RBTC from here
	claimDetails: {
		lockupAddress: string; // RBTC EtherSwap contract address
		amount: number; // Amount to receive in sats
		refundAddress: string; // Boltz's RBTC refund address
		timeoutBlockHeight: number; // RSK block height for claim timeout
	};
}

/**
 * Chain swap status type
 * Distinct from reverse swaps - includes transaction.server.* events
 */
export type ChainSwapStatus = 
	| 'swap.created'                  // Swap created, waiting for user's L-BTC
	| 'transaction.mempool'           // User's L-BTC tx in mempool
	| 'transaction.confirmed'         // User's L-BTC confirmed
	| 'transaction.server.mempool'    // Boltz's RBTC tx in mempool
	| 'transaction.server.confirmed'  // Boltz's RBTC confirmed, ready to claim!
	| 'transaction.claim.pending'     // Claim transaction submitted, waiting for confirmation
	| 'transaction.claimed'           // User claimed RBTC successfully
	| 'swap.expired'                  // Timeout reached
	| 'swap.refunded'                 // L-BTC refunded back to user
	| 'transaction.failed';           // Swap failed

// ============================================================================
// Claim & Refund Types
// ============================================================================

export interface RefundSwapRequest {
	address: string;
	feePerVbyte?: number;
}

export interface RefundSwapResponse {
	transactionId: string;
	transactionHex: string;
}

export interface ClaimSwapRequest {
	preimage: string;
	address: string;
	feePerVbyte?: number;
}

export interface ClaimSwapResponse {
	transactionId: string;
	transactionHex: string;
}

// ============================================================================
// Transaction Broadcasting Types
// ============================================================================

export interface BroadcastTransactionRequest {
	transactionHex: string;
}

export interface BroadcastTransactionResponse {
	transactionId: string;
}

export interface SwapTransaction {
	id: string;
	hex: string;
	eta?: number;
}

// ============================================================================
// EVM Contract Types
// ============================================================================

/**
 * Contract addresses for EVM chains (RBTC, Ethereum, etc.)
 */
export interface ContractAddresses {
	[chain: string]: {
		erc20Swap: string;
		etherSwap: string;
	};
}

// ============================================================================
// Event & Monitoring Types
// ============================================================================

/**
 * Swap monitoring interface for active swap tracking
 */
export interface SwapMonitor {
	swapId: string;
	type: 'submarine' | 'reversesubmarine';
	status: SwapStatusType;
	createdAt: Date;
	updatedAt: Date;
	pairId: string;
	amount: number;
	onchainAddress?: string;
	invoice?: string;
	preimageHash?: string;
	timeoutBlockHeight: number;
	failureReason?: string;
}

/**
 * Event emitted when swap status changes
 */
export interface SwapEvent {
	swapId: string;
	status: SwapStatusType;
	timestamp: Date;
	transaction?: SwapTransaction;
	failureReason?: string;
}

/**
 * Callback type for swap event listeners
 */
export type SwapEventCallback = (event: SwapEvent) => void;

// ============================================================================
// Taproot/MuSig2 Types (Bitcoin UTXO swaps only, not used for RBTC)
// ============================================================================

/**
 * Cooperative claim details for Taproot swaps
 * 
 * Note: These types are for Bitcoin UTXO swaps. RBTC uses EtherSwap contracts.
 */
export interface CooperativeClaimDetails {
	musig: any;
	transaction: any;
	partialSignature?: string;
}

export interface CooperativeClaimRequest {
	partialSignature: string;
	preimage?: string;
	transaction?: any;
}

export interface CooperativeClaimResponse {
	transactionId: string;
	transactionHex: string;
}

export interface CooperativeRefundRequest {
	transaction: any;
}

export interface CooperativeRefundResponse {
	partialSignature: string;
}

// ============================================================================
// Emergency Recovery Types (Bitcoin UTXO only)
// ============================================================================

/**
 * Refund file data for emergency recovery
 * 
 * Note: Used for Bitcoin UTXO swaps, not applicable to RBTC/EVM swaps
 */
export interface RefundFileData {
	id: string;
	currency: string;
	redeemScript: string;
	privateKey: string;
	timeoutBlockHeight: number;
}

export interface EmergencyRefundParams {
	refundData: RefundFileData;
	destinationAddress: string;
	feeRate: number;
	lockupTransaction: any;
	outputIndex: number;
}

export interface PreimageClaimParams {
	swapId: string;
	preimage: string;
	destinationAddress: string;
	lockupTransaction: any;
	outputIndex: number;
	redeemScript: string;
	claimPrivateKey: string;
	feeRate: number;
}