/**
 * Core type definitions for BitTasker Wallet SDK
 */

import type { ethers } from 'ethers';

export type RSKUnit = 'rbtc' | 'wei';
export type BSCUnit = 'usdt' | 'wei';
export type NetworkType = 'mainnet' | 'testnet' | 'regtest';

// ERC-20 Token Configuration for all networks (RSK, BSC)
export interface ERC20Token {
	address: string;
	symbol: string;
	name: string;
	decimals: number;
	logoUrl?: string;
}

// Paymaster configuration interface
export interface PaymasterConfig {
	address: string;
	usdtTokenAddress: string;
	minDeposit: bigint;
	maxGasPrice: bigint;
	usdtPriceOracle: string;
}

// Address entity from RSK Explorer API
export interface AddressEntity {
	ens_domain_name: string | null;
	hash: string;
	implementations: any[];
	is_contract: boolean;
	is_scam: boolean;
	is_verified: boolean;
	metadata: any | null;
	name: string | null;
	private_tags: string[];
	proxy_type: string | null;
	public_tags: string[];
	reputation: string;
	watchlist_names: string[];
}

// Decoded input parameter from Explorer API
export interface DecodedInputParameter {
	name: string;
	type: string;
	value: string | number | boolean;
}

// Decoded input from Explorer API
export interface DecodedInput {
	method_call: string;
	method_id: string;
	parameters: DecodedInputParameter[];
}

// Explorer API Transaction Response
export interface Transaction {
	hash: string;
	from: AddressEntity;
	to: AddressEntity;
	value: string;
	gas_used: string;
	gas_price: string;
	gas_limit: string;
	block_number: number;
	timestamp: string; // ISO 8601 format
	status: string; // "ok" or error status
	nonce: number;
	position: number;
	confirmations: number;

	// Contract interaction data
	raw_input: string; // raw_input from API - contract function call data
	method: string | null; // method selector from API (first 4 bytes of input)
	decoded_input: DecodedInput | null;
	transaction_types: string[]; // transaction_types from API (e.g., ["coin_transfer", "contract_call"])
	token_transfers: any[] | null; // token_transfers from API (for ERC-20/token txs)

	// Gas pricing data (EIP-1559)
	max_fee_per_gas: string | null;
	max_priority_fee_per_gas: string | null;
	base_fee_per_gas: string | null;
	priority_fee: string | null;
	transaction_burnt_fee: string | null;

	// Additional metadata
	result: string; // result: "success" or error message
	revert_reason: string | null; // revert_reason if transaction failed
	created_contract: string | null; // created_contract address if this tx deployed a contract
	is_pending_update: boolean;
	type: number; // 0 (legacy), 1 (EIP-2930), 2 (EIP-1559)
	has_error_in_internal_transactions: boolean;

	// Fee information
	fee: {
		type: string; // "actual" or "maximum"
		value: string; // fee in wei
	};

	// Exchange rates
	exchange_rate: string | null; // exchange_rate at current time
	historic_exchange_rate: string | null; // historic_exchange_rate at transaction time

	// Additional fields
	confirmation_duration: [number, number] | null; // confirmation_duration [seconds, milliseconds]
	token_transfers_overflow: boolean | null;
	transaction_tag: string | null;
	authorization_list: any[];
	actions: any[];
}

// Gas estimation result
export interface GasEstimation {
	gasLimit: string;
	gasPrice: string;
	totalCost: string;
	totalCostFormatted: string;
	usdtCost?: string;
}

// Contract transaction result
export interface ContractTransactionResult {
	hash: string;
	escrowId?: string;
	gasUsed?: string;
	status: 'pending' | 'confirmed' | 'failed';
}

// Token balance interface
export interface TokenBalance {
	token: ERC20Token;
	balance: bigint;
	formattedBalance: string;
	usdValue?: number;
}

// Contract configuration interface
export interface ContractConfig {
	address: string;
	abi: any[];
	network: NetworkType;
}

// Asset metadata
export interface AssetMetadata {
	assetId: string;
	name: string;
	ticker: string;
	precision: number;
	icon: string;
	fiatId?: string;
}

// Wallet asset interface
export interface WalletAsset extends AssetMetadata {
	balance: number;
	usdValue: number;
	formattedBalance: string;
	network: 'Liquid' | 'Bitcoin' | 'RSK' | 'BSC';
}

// Combined wallet state
export interface WalletState {
	// Connection status
	isInitializing: boolean;
	isConnected: boolean;
	error: string | null;

	// Network states
	rsk: {
		connected: boolean;
		connecting: boolean;
		error: string | null;
		address: string | null;
		balance: string;
		formattedBalance: string;
		blockNumber: number | null;
		provider: ethers.JsonRpcProvider | null;
		wallet: ethers.Wallet | null;
		contractAddress?: string;
		contractConnected?: boolean;
	};
	bsc: {
		connected: boolean;
		connecting: boolean;
		error: string | null;
		address: string | null;
		bnbBalance: string;
		formattedBnbBalance: string;
		usdtBalance: string;
		formattedUsdtBalance: string;
		blockNumber: number | null;
		provider: ethers.JsonRpcProvider | null;
		wallet: ethers.Wallet | null;
		usdtContract: ethers.Contract | null;
		paymasterContract: any | null;
		paymasterConnected: boolean;
		paymasterAddress: string | null;
		canPayFeesInUsdt: boolean;
	};

	// Combined data
	assets: WalletAsset[];
	transactions: Transaction[];
	totalBalances: {
		usd: number;
		sats: number;
		rbtc: number;
		usdt: number;
		bnb: number;
	};

	// Exchange rates
	rbtcToBtcRate: number;
	rbtcRateError: boolean;

	// UI state
	activeNetwork: 'liquid' | 'rsk' | 'bsc';
	selectedAsset: string;
}

/**
 * Boltz and RIF Relay Configuration
 */
export interface BoltzNetworkConfig {
	boltzApiUrl: string;
	boltzWsUrl: string;
	rskRpcUrl: string;
	rskChainId: number;
	rskExplorerUrl: string;
	rskExplorerApiUrl: string;
	rifRelayServerUrl: string;
	rifRelayEnabled: boolean;
	contracts: {
		deployHeight: number;
		smartWalletFactory: string;
		deployVerifier: string;
	};
}

// --- Loan Flow Types ---
export interface MoCMintParams {
	rbtcAmount: string; // in wei (18 decimals)
	expectedDocAmount: string; // in wei (18 decimals)
	slippagePercent: number; // e.g. 0.5 = 0.5%
}

export interface Usdt0BridgeParams {
	amount: string; // USDT0 amount in smallest unit (6 decimals)
	fromChainId: number; // e.g. 30 (RSK)
	toChainId: number; // e.g. 42161 (Arbitrum)
	recipientAddress: string;
	minAmountLD: string; // minimum to receive on destination
}

export interface LoanFlowStep {
	id: string;
	label: string;
	status: 'pending' | 'active' | 'complete' | 'failed';
	txHash?: string;
	error?: string;
}

export type LoanPhase =
	| 'IDLE'
	| 'COLLECTING_INPUT'
	| 'QUOTING'
	| 'AWAITING_CONFIRMATION'
	| 'MINTING_DOC'
	| 'WAITING_DOC_MINT'
	| 'APPROVING_DOC'
	| 'SWAPPING_DOC_TO_USDT0'
	| 'WAITING_SWAP'
	| 'APPROVING_USDT0'
	| 'BRIDGING_TO_ARBITRUM'
	| 'WAITING_BRIDGE'
	| 'BRIDGING_TIMED_OUT'
	| 'COMPLETE'
	| 'FAILED'
	| 'PAUSED_DOC'
	| 'PAUSED_USDT0_RSK'
	| 'RECOVERING';

export interface LoanFlowState {
	phase: LoanPhase;
	steps: LoanFlowStep[];
	inputAmount: string; // user-entered USD amount
	rbtcAmount: string; // rBTC to send (wei)
	docAmount: string; // DOC to mint (18 decimals wei)
	usdt0RskAmount: string; // USDT0 on RSK after swap (6 decimal units)
	usdt0ArbAmount: string; // USDT0 on Arbitrum after bridge (6 decimal units)
	createdAt: number;
}

export interface ArbitrumNetworkConfig {
	chainId: number;
	name: string;
	rpcUrl: string;
	explorerUrl: string;
	explorerApiUrl: string;
	currency: { name: string; symbol: string; decimals: number };
	tokens: ERC20Token[];
}
