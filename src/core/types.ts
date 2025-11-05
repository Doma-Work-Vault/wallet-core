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

// Transaction types
export interface Transaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    gasUsed: string;
    gasPrice: string;
    blockNumber: number;
    timestamp: number;
    status: 'pending' | 'confirmed' | 'failed';
    type: 'send' | 'receive' | 'contract' | 'swap';
    network: 'rsk' | 'bsc';
    tokenSymbol?: string;
    swapType?: 'chain' | 'reverse';
    description?: string;
    formattedAmount?: string;
    fee?: number;
    asset?: string;
    id?: string;
    address?: string;
    txHash?: string;
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
    isConnecting: boolean;
    hasAnyConnection: boolean;
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
    activeTab: 'balance' | 'send' | 'receive' | 'transactions' | 'buy-sell' | 'swap';
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

/**
 * Wallet configuration options
 */
export interface WalletConfig {
  network: NetworkType;
  rsk?: {
    rpcUrl?: string;
    explorerApiUrl?: string;
  };
  bsc?: {
    rpcUrl?: string;
    explorerApiUrl?: string;
  };
}

/**
 * External dependencies injected into wallet
 */
export interface WalletDependencies {
  mnemonicProvider: () => Promise<string>;
  priceService?: {
    getCurrentPrice: (symbol: string) => Promise<number>;
    getExchangeRate: (from: string, to: string) => Promise<number>;
  };
}

