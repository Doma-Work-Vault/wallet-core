/**
 * @bittasker/wallet-core
 * Multi-chain Bitcoin wallet SDK
 */

// Core exports
export { EventBus } from './core/EventBus';
export type { EventCallback } from './core/EventBus';
export type {
	WalletState,
	Transaction,
	NetworkType,
	ERC20Token,
	PaymasterConfig,
	WalletAsset,
	GasEstimation,
	TokenBalance,
	BoltzNetworkConfig,
	MoCMintParams,
	Usdt0BridgeParams,
	LoanFlowStep,
	LoanPhase,
	LoanFlowState,
	ArbitrumNetworkConfig
} from './core/types';

// Chain wallets
export { RSKWallet } from './chains/rsk/RSKWallet';
export { loadRSKTransactions, getSwapAddress } from './chains/rsk/RSKTransactions';
export { BSCWallet } from './chains/bsc/BSCWallet';
export { loadBSCTransactions } from './chains/bsc/BSCTransactions';
export { BSCPaymasterContract, PostOpMode } from './chains/bsc/BSCPaymaster';
export { ArbitrumWallet } from './chains/arbitrum/ArbitrumWallet';
export type { ArbitrumWalletConfig } from './chains/arbitrum/ArbitrumWallet';

// Network configuration
export {
	RSK_NETWORKS,
	BSC_NETWORKS,
	ARB_NETWORKS,
	ARB_TOKEN_ADDRESSES,
	LAYERZERO_EIDS,
	RSK_TOKENS,
	BOLTZ_NETWORKS,
	ERC20_ABI,
	PAYMASTER_ABI,
	FEE_TIERS,
	getBoltzConfig,
	getRSKConfig,
	getBSCConfig,
	getArbConfig,
	getRSKToken,
	getBSCPaymasterConfig,
	getUSDTToken,
	getMulticallAddress,
	isRifRelayAvailable,
	satoshiToWei,
	weiToSatoshi,
	getWebSocketEndpoint,
	SATOSHI_TO_WEI
} from './utils/networkConfig';

export type { RSKNetwork, FeeTier } from './utils/networkConfig';

// RSK address utilities (EIP-1191)
export {
	toEip1191ChecksumAddress,
	isValidRskAddress,
	normalizeRskAddress,
	areSameRskAddress,
	toEip55ChecksumAddress
} from './utils/rskAddress';

// Wallet Manager - Main orchestration class
export { WalletManager } from './core/WalletManager';
export type { WalletManagerConfig, WalletBalances, SwapLimits } from './core/WalletManager';

// Boltz swap services
export { BoltzClient, getLockupEventParameters } from './swaps/boltz/BoltzClient';
export { ReverseSwapService } from './swaps/boltz/ReverseSwapService';
export { ChainSwapService } from './swaps/boltz/ChainSwapService';
export { SubmarineSwapService } from './swaps/boltz/SubmarineSwapService';
export { BoltzWebSocket } from './swaps/boltz/WebSocketClient';
export { InMemorySwapStorage } from './swaps/boltz/storage';
export type { SwapStorage } from './swaps/boltz/storage';

// Refund services
export { ChainSwapRefundService } from './swaps/boltz/ChainSwapRefundService';
export { SubmarineSwapRefundService } from './swaps/boltz/SubmarineSwapRefundService';

export { EvmContractService } from './swaps/boltz/EvmContractService';
export type {
	// Chain refund service
	ChainSwapRefundCheck,
	ChainSwapRefundParams,
	ChainSwapRefundResult,

	// Submarine refund service
	SubmarineRefundCheck,
	SubmarineRefundParams,
	SubmarineRefundResult,

	// Evm contract service
	EvmLockupParams,
	EvmLockupResult,
	EvmClaimParams,
	EvmClaimResult,
	EvmRefundParams,
	EvmRefundResult,
	LockupEventParams,

	// RIF Relay service
	RifRelayClaimParams,

	// Boltz swap types
	BoltzSwapData,
	ChainSwapData,
	SubmarineSwapData,
	SwapStatus,
	ChainSwapStatus,
	SubmarineSwapStatus,
	SwapEvent,
	SwapUpdateEvent,
	ContractAddresses,
	CreateSubmarineSwapParams,
	SubmarineSwapResult,
	SwapPairs,
	LockupInfo
} from './swaps/boltz/types';

// RIF Relay gasless claiming service
export { RifRelayClaimService } from './swaps/boltz/RifRelayClaimService';

// RIF Relay - Gasless transactions
export { relayClaimTransaction, getSmartWalletAddress } from './swaps/rif/Signer';
export { getForwarder, getSmartWalletFactory } from './swaps/rif/Contracts';
export { estimate, relay, getChainInfo } from './swaps/rif/Relay';
export type { Metadata } from './swaps/rif/Relay';
export type { EnvelopingRequest } from './swaps/rif/types/TypedRequestData';

// Loan services — RBTC-backed USDT0 on Arbitrum
export { MoCMintingService, MOC_PROXY_ADDRESS } from './loans/MoCMintingService';
export {
	Usdt0BridgeService,
	OFT_RSK_ADDRESS,
	OFT_ARBITRUM_ADDRESS,
	AUTO_APPROVE_BUFFER
} from './loans/Usdt0BridgeService';
