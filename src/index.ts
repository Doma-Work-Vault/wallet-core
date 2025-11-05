/**
 * @bittasker/wallet-core
 * Multi-chain Bitcoin wallet SDK
 */

// Core exports
export { EventEmitter } from './core/EventEmitter';
export type {
    WalletState,
    WalletConfig,
    WalletDependencies,
    Transaction,
    NetworkType,
    ERC20Token,
    PaymasterConfig,
    WalletAsset,
    GasEstimation,
    TokenBalance,
    BoltzNetworkConfig
} from './core/types';

// Chain wallets
export { RSKWallet } from './chains/rsk/RSKWallet';
export { loadRSKTransactions } from './chains/rsk/RSKTransactions';
export { BSCWallet } from './chains/bsc/BSCWallet';
export { loadBSCTransactions } from './chains/bsc/BSCTransactions';
export { BSCPaymasterContract, PostOpMode } from './chains/bsc/BSCPaymaster';

// Network configuration
export {
    RSK_NETWORKS,
    BSC_NETWORKS,
    BOLTZ_NETWORKS,
    ERC20_ABI,
    PAYMASTER_ABI,
    FEE_TIERS,
    getBoltzConfig,
    getRSKConfig,
    getBSCConfig,
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

// Wallet Manager - Main orchestration class
export { WalletManager } from './core/WalletManager';
export type { WalletManagerConfig, WalletBalances, SwapLimits } from './core/WalletManager';

// Boltz swap services
export { BoltzClient, getLockupEventParameters } from './swaps/boltz/BoltzClient';
export { ReverseSwapService } from './swaps/boltz/ReverseSwapService';
export { ChainSwapService } from './swaps/boltz/ChainSwapService';
export { BoltzWebSocket } from './swaps/boltz/WebSocketClient';
export type { SwapStorage } from './swaps/boltz/storage';

// Boltz types
export type {
    SwapStatus,
    ChainSwapStatus,
    SwapEvent,
    CreateSwapResponse,
    ContractAddresses
} from './swaps/boltz/types';

// RIF Relay - Gasless transactions
export { relayClaimTransaction, getSmartWalletAddress } from './swaps/rif/Signer';
export { getForwarder, getSmartWalletFactory } from './swaps/rif/Contracts';
export { estimate, relay, getChainInfo } from './swaps/rif/Relay';
export type { Metadata } from './swaps/rif/Relay';
export type { EnvelopingRequest } from './swaps/rif/types/TypedRequestData';

