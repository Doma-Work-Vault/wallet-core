/**
 * Boltz Exchange API Types
 * Type definitions for Boltz REST API v2 and swap operations
 * 
 * Based on boltz-web-app implementation
 * @see https://api.docs.boltz.exchange/api-v2.html
 */

import type { Signer } from 'ethers';

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
// Submarine Swap Types (Chain → Lightning)
// ============================================================================

/**
 * Submarine swap status type
 * User locks funds on-chain FIRST, then Boltz pays Lightning invoice
 */
export type SubmarineSwapStatus =
	| 'swap.created'              // Swap created, waiting for user lockup
	| 'transaction.mempool'       // User's lockup in mempool
	| 'transaction.confirmed'     // User's lockup confirmed
	| 'invoice.pending'           // Boltz paying invoice
	| 'invoice.paid'              // Invoice paid successfully
	| 'transaction.claimed'       // Boltz claimed funds
	| 'swap.expired'              // Timeout reached
	| 'swap.refunded'             // User refunded
	| 'transaction.failed';       // Swap failed

/**
 * Submarine swap data for storage and tracking
 * Supports RBTC, BTC, and L-BTC to Lightning swaps
 */
export interface SubmarineSwapData {
	id: string;
	type: 'submarine';

	// Invoice details
	invoice: string;
	invoiceAmount: number;

	// Lockup details (chain-specific)
	fromAsset: 'RBTC' | 'BTC' | 'L-BTC';
	fromAmount: number;
	lockupAddress: string;
	lockupTxHash?: string;

	// Refund details
	refundPublicKey?: string; // For BTC/L-BTC
	refundPrivateKey?: string; // Encrypted, for BTC/L-BTC
	refundTxHash?: string; // Refund transaction hash
	timeoutBlockHeight: number;

	// EVM-specific (RBTC)
	claimAddress?: string; // Boltz's claim address (only for RBTC)
	
	/**
	 * Payment hash from the Lightning invoice
	 * NOT returned by Boltz API - must be decoded from the invoice using BOLT11 decoder
	 * Optional because it needs to be extracted after swap creation
	 */
	preimageHash?: string;

	// UTXO-specific (BTC/L-BTC)
	swapTree?: any; // For Taproot swaps

	// Status tracking
	status: SubmarineSwapStatus;
	createdAt: number;
	updatedAt: number;
	expiresAt: number;

	// Metadata
	expectedAmount: number;
	acceptZeroConf: boolean;
	blindingKey?: string; // For L-BTC
	bip21?: string; // Payment URI for UTXO chains
	rifRelayUsed?: boolean; // Track if RIF Relay was used for gasless refunds (RBTC only)
}

/**
 * Parameters for creating a submarine swap
 */
export interface CreateSubmarineSwapParams {
	// Asset pair
	from: 'RBTC' | 'BTC' | 'L-BTC';
	to: 'BTC'; // Lightning (represented as BTC in Boltz API)

	// Invoice to be paid
	invoice: string;

	// Refund key (required for BTC/L-BTC, not for RBTC)
	refundPublicKey?: string;

	// Optional referral ID
	referralId?: string;

	// Optional signer for gas estimation (RBTC only)
	// If provided, the service will estimate gas costs and include in result
	signer?: any; // ethers.Signer
}

/**
 * Result from creating a submarine swap
 */
export interface SubmarineSwapResult {
	swapId: string;
	swapData: SubmarineSwapData;
	// For RBTC: user needs to call lockFundsEVM()
	// For BTC/L-BTC: user needs to send to lockupAddress
	
	/** Gas estimation for RBTC lockup (only for RBTC swaps) */
	estimatedGas?: {
		/** Estimated gas cost in wei */
		costWei: bigint;
		/** Estimated gas cost in satoshis (for user display) */
		costSats: number;
		/** Total amount user needs including gas (fromAmount + gas) in satoshis */
		totalRequired: number;
	};
}

/**
 * Submarine swap pairs from Boltz API
 */
export interface SwapPairs {
	[fromAsset: string]: {
		[toAsset: string]: {
			hash: string;
			rate: number;
			limits: {
				minimal: number;
				maximal: number;
				maximalZeroConf: number;
			};
			fees: {
				minerFees: number;
				percentage: number;
			};
		};
	};
}

/**
 * Lockup information for UTXO chains (BTC, L-BTC)
 */
export interface LockupInfo {
	address: string;
	amount: number;
	bip21?: string;
	blindingKey?: string; // For L-BTC
	timeoutBlockHeight: number;
}

// ============================================================================
// Boltz API Response Types
// ============================================================================

/**
 * Transaction interface for Bitcoin/Liquid transactions
 * Used in refund/claim operations
 * TODO: Replace Transaction | LiquidTransaction
 */
export type TransactionInterface = any;

/**
 * Swap tree structure for Taproot swaps
 */
export interface SwapTreeLeaf {
	output: string;
	version: number;
}

export interface SwapTree {
	claimLeaf: SwapTreeLeaf;
	refundLeaf: SwapTreeLeaf;
}

/**
 * Submarine swap creation response from Boltz API
 * This is what the API actually returns - NOT our internal storage type
 * 
 * IMPORTANT: preimageHash is NOT returned by the API!
 * It must be decoded from the Lightning invoice using BOLT11 decoder
 */
export interface SubmarineCreatedResponse {
	id: string;
	acceptZeroConf: boolean;
	expectedAmount: number;
	timeoutBlockHeight: number;
	
	// For UTXO chains (BTC, L-BTC) - Taproot swaps
	address: string;
	bip21: string;
	swapTree: SwapTree;
	claimPublicKey: string;
	blindingKey?: string; // For L-BTC only
	
	// For EVM chains (RBTC)
	claimAddress?: string;
}
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
// Boltz Swap Types
// ============================================================================

export interface BoltzSwapData {
	id: string;
	preimage: string; // Will be encrypted
	preimageHash: string;
	invoice: string;
	amount: number;
	rbtcAddress: string; // User's actual wallet address
	claimAddress?: string; // Address used for claiming (may be Smart Wallet)
	status: string;
	lockupTxHash?: string;
	claimTxHash?: string;
	onchainAmount?: number;
	refundAddress?: string;
	timeoutBlockHeight?: number;
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
	rifRelayUsed?: boolean; // Track if RIF Relay was used for gasless claiming
}

export interface ChainSwapData {
	id: string;
	type: 'chain';
	preimage: string; // Encrypted
	preimageHash: string;

	// L-BTC side (user sends)
	fromAsset: 'L-BTC';
	fromAmount: number; // sats
	lockupAddress: string; // L-BTC address
	blindingKey: string;
	liquidUri: string; // Full payment URI
	lockupTxHash?: string;
	lockupTimeoutBlockHeight: number;
	swapTree?: string; // Taproot swap tree for refunds (from API response)
	serverPublicKey?: string; // Boltz's public key for refunds (from API response)

	// Refund key (REQUIRED for chain swaps)
	refundPublicKey: string;
	refundPrivateKey: string; // Encrypted in Nostr
	refundTxHash?: string; // L-BTC refund transaction hash

	// RBTC side (user receives)
	toAsset: 'RBTC';
	toAmount: number; // sats
	rbtcAddress: string; // User's actual wallet address
	claimAddress?: string; // Address used for claiming (may be Smart Wallet)
	claimTimeoutBlockHeight: number;
	serverLockupTxHash?: string; // Boltz's RBTC lockup transaction hash
	claimTxHash?: string;
	refundAddress: string; // Boltz's refund address

	// Status
	status: ChainSwapStatus;
	createdAt: number;
	updatedAt: number;
	expiresAt: number;
	rifRelayUsed?: boolean; // Track if RIF Relay was used for gasless claiming
}

// ============================================================================
// EVM Contract Service Types
// ============================================================================

export interface EvmLockupParams {
	signer: Signer;
	preimageHash: string;
	claimAddress: string;
	timeoutBlockHeight: number;
	amountSats: number;
}

export interface EvmLockupResult {
	txHash: string;
	contractAddress: string;
}

export interface EvmClaimParams {
	signer: Signer;
	preimage: string;
	amount: number; // in satoshis
	refundAddress: string;
	timelock: number;
}

export interface EvmClaimResult {
	txHash: string;
}

export interface EvmRefundParams {
	signer: Signer;
	preimageHash: string;
	amount: number; // in satoshis
	claimAddress: string;
	timelock: number;
}

export interface EvmRefundResult {
	txHash: string;
}

export interface LockupEventParams {
	amount: bigint;
	claimAddress: string;
	refundAddress: string;
	timelock: number;
}

// ============================================================================
// Chain Swap Refund Types
// ============================================================================

export interface ChainSwapRefundCheck {
	refundable: boolean;
	reason?: string;
	currentBlockHeight?: number;
}

export interface ChainSwapRefundParams {
	swapId: string;
	refundAddress: string; // L-BTC address to send refund to
}

export interface ChainSwapRefundResult {
	txHash: string;
	swapData: ChainSwapData;
}

// ============================================================================
// Submarine Swap Refund Types
// ============================================================================

export interface SubmarineRefundCheck {
	refundable: boolean;
	reason?: string;
	currentBlockHeight?: number;
}

export interface SubmarineRefundParams {
	swapId: string;
	refundAddress?: string; // Optional: For BTC/L-BTC. For RBTC, uses wallet address
	signer?: Signer; // Required for RBTC refunds
}

export interface SubmarineRefundResult {
	txHash: string;
	swapData: SubmarineSwapData;
}

// ============================================================================
// RIF Relay Types
// ============================================================================

export interface RifRelayClaimParams {
	// Wallet signer (EOA that owns the Smart Wallet)
	walletSigner: Signer;

	// EtherSwap contract address
	contractAddress: string;

	// Swap parameters (from Lockup event or API)
	preimage: string;
	amount: number; // in satoshis
	refundAddress: string;
	timelock: number;
}