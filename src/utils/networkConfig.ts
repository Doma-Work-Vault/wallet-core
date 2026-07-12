/**
 * Network Configuration
 *
 * This file centralizes ALL network endpoints, RPC URLs, API URLs, and blockchain explorers
 * for RSK, BSC, Boltz, Liquid, and related services.
 *
 * Features:
 * - RSK (Rootstock) wallet configuration
 * - BSC (Binance Smart Chain) wallet configuration
 * - Boltz swap API endpoints
 * - RIF Relay gasless transaction endpoints
 * - Liquid Network API endpoints
 * - Blockchain explorer URLs
 * - Fee tier configurations
 */

import type { ERC20Token, NetworkType, PaymasterConfig, BoltzNetworkConfig } from '../core/types';
import { ethers } from 'ethers';

/**
 * Global network state
 * Set by WalletManager during initialization
 */
let _networkGetter: (() => NetworkType) | null = null;

/**
 * Set the network getter function (called by WalletManager)
 * @internal
 */
export function setNetworkGetter(getter: () => NetworkType): void {
	_networkGetter = getter;
}

/**
 * Get the current network
 * @internal
 */
export function getNetwork(): NetworkType {
	if (!_networkGetter) {
		console.warn('Network getter not set, defaulting to testnet');
		return 'testnet';
	}
	return _networkGetter();
}

// Fee tier configurations
export const FEE_TIERS = {
	1: { percentage: 250, label: '2.5%' },
	2: { percentage: 200, label: '2.0%' },
	3: { percentage: 150, label: '1.5%' }
} as const;

export type FeeTier = keyof typeof FEE_TIERS;

// Timelock constants (in seconds)
export const TIMELOCK_PERIODS = {
	COMPLETION: 7 * 24 * 60 * 60, // 7 days
	DISPUTE: 14 * 24 * 60 * 60 // 14 days
} as const;

// ERC-20 ABI (minimal for basic operations)
export const ERC20_ABI = [
	'function name() view returns (string)',
	'function symbol() view returns (string)',
	'function decimals() view returns (uint8)',
	'function totalSupply() view returns (uint256)',
	'function balanceOf(address owner) view returns (uint256)',
	'function transfer(address to, uint256 amount) returns (bool)',
	'function transferFrom(address from, address to, uint256 amount) returns (bool)',
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'event Transfer(address indexed from, address indexed to, uint256 value)',
	'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

// EIP-7702 Paymaster ABI
export const PAYMASTER_ABI = [
	'function validatePaymasterUserOp(UserOperation userOp, bytes32 userOpHash, uint256 maxCost) external view returns (bytes memory context, uint256 validationData)',
	'function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) external',
	'function deposit() external payable',
	'function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external',
	'function getDeposit() external view returns (uint256)',
	'function payForTransaction(address user, bytes calldata transaction) external payable',
	'function convertUsdtToBnb(uint256 usdtAmount) external view returns (uint256 bnbAmount)',
	'function getUsdtPrice() external view returns (uint256 price)',
	'event Deposit(address indexed account, uint256 totalDeposit)',
	'event Withdraw(address indexed account, uint256 withdrawAmount)',
	'event GasPaidInUsdt(address indexed user, uint256 usdtAmount, uint256 bnbEquivalent)',
	'event PriceUpdated(uint256 oldPrice, uint256 newPrice)'
];

export const BOLTZ_NETWORKS = {
	regtest: {
		// Local Boltz regtest environment
		boltzApiUrl: 'http://localhost:9001',
		boltzWsUrl: 'ws://localhost:9001/v2/ws',

		// Local RSK node (Anvil/Hardhat)
		rskRpcUrl: 'http://localhost:8545',
		rskChainId: 33,
		rskExplorerUrl: 'http://localhost:4002',
		rskExplorerApiUrl: 'http://localhost:4002/api',

		// RIF Relay (deprecated on regtest)
		rifRelayServerUrl: 'http://localhost:8090',
		rifRelayEnabled: false,
		contracts: {
			deployHeight: 0,
			smartWalletFactory: '0x59b670e9fA9D0A427751Af201D676719a970857b',
			deployVerifier: '0x0000000000000000000000000000000000000000'
		}
	},

	mainnet: {
		// Boltz production API
		boltzApiUrl: 'https://api.boltz.exchange',
		boltzWsUrl: 'wss://api.boltz.exchange/v2/ws',

		// RSK mainnet
		rskRpcUrl: 'https://public-node.rsk.co',
		rskChainId: 30,
		rskExplorerUrl: 'https://explorer.rsk.co',
		rskExplorerApiUrl: 'https://rootstock.blockscout.com/api',

		// RIF Relay (Boltz-hosted for mainnet)
		rifRelayServerUrl: 'https://boltz.mainnet.relay.rifcomputing.net',
		rifRelayEnabled: true,
		contracts: {
			deployHeight: 6747215,
			smartWalletFactory: '0x44944a80861120B58cc48B066d57cDAf5eC213dd',
			deployVerifier: '0xc0F5bEF6b20Be41174F826684c663a8635c6A081'
		}
	}
};

/**
 * RSK Network Configuration
 */
export const RSK_NETWORKS = {
	mainnet: {
		name: 'RSK Mainnet',
		chainId: 30,
		rpcUrl: 'https://public-node.rsk.co',
		explorerUrl: 'https://explorer.rsk.co',
		explorerApiUrl: 'https://rootstock.blockscout.com/api',
		currency: {
			name: 'Smart Bitcoin',
			symbol: 'RBTC',
			decimals: 18
		},
		multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11'
	},
	testnet: {
		name: 'RSK Testnet',
		chainId: 31,
		rpcUrl: 'https://public-node.testnet.rsk.co',
		explorerUrl: 'https://explorer.testnet.rsk.co',
		explorerApiUrl: 'https://rootstock-testnet.blockscout.com/api',
		currency: {
			name: 'Testnet Smart Bitcoin',
			symbol: 'tRBTC',
			decimals: 18
		},
		multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11'
	},
	regtest: {
		name: 'RSK Regtest (Local)',
		chainId: 33,
		rpcUrl: 'http://localhost:8545',
		explorerUrl: 'http://localhost:4002',
		explorerApiUrl: 'http://localhost:4002/api',
		currency: {
			name: 'Regtest Smart Bitcoin',
			symbol: 'rRBTC',
			decimals: 18
		},
		multicallAddress: null
	}
} as const;

export type RSKNetwork = keyof typeof RSK_NETWORKS;

/**
 * BSC Network Configuration
 */
export const BSC_NETWORKS = {
	mainnet: {
		name: 'BSC Mainnet',
		chainId: 56,
		rpcUrl: 'https://bsc-rpc.publicnode.com',
		explorerUrl: 'https://bscscan.com',
		explorerApiUrl: 'https://api.etherscan.io/v2/api',
		currency: {
			name: 'BNB',
			symbol: 'BNB',
			decimals: 18
		},
		tokens: [
			{
				address: '0x55d398326f99059fF775485246999027B3197955',
				symbol: 'USDT',
				name: 'Tether USD',
				decimals: 18
			},
			{
				address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
				symbol: 'USDC',
				name: 'USD Coin',
				decimals: 18
			},
			{
				address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
				symbol: 'WBNB',
				name: 'Wrapped BNB',
				decimals: 18
			}
		] as ERC20Token[]
	},
	testnet: {
		name: 'BSC Testnet',
		chainId: 97,
		rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
		explorerUrl: 'https://testnet.bscscan.com',
		explorerApiUrl: 'https://api.etherscan.io/v2/api',
		currency: {
			name: 'tBNB',
			symbol: 'tBNB',
			decimals: 18
		},
		tokens: [
			{
				address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
				symbol: 'tUSDT',
				name: 'Testnet Tether USD',
				decimals: 18
			},
			{
				address: '0x64544969ed7EBf5f083679233325356EbE738930',
				symbol: 'tUSDC',
				name: 'Testnet USD Coin',
				decimals: 18
			}
		] as ERC20Token[]
	}
} as const;

// Arbitrum token addresses (canonical, exported for app-level usage)
export const ARB_TOKEN_ADDRESSES = {
	USDT0: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
	WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
	TBTC: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
} as const;

// Arbitrum Network Configuration
export const ARB_NETWORKS = {
	mainnet: {
		name: 'Arbitrum One',
		chainId: 42161,
		rpcUrl: 'https://arb1.arbitrum.io/rpc',
		explorerUrl: 'https://arbiscan.io',
		explorerApiUrl: 'https://api.arbiscan.io/api',
		currency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
		tokens: [
			{
				address: ARB_TOKEN_ADDRESSES.USDT0,
				symbol: 'USDT0',
				name: 'USDT0 (Tether USD on Arbitrum)',
				decimals: 6
			},
			{
				address: ARB_TOKEN_ADDRESSES.WBTC,
				symbol: 'WBTC',
				name: 'Wrapped Bitcoin',
				decimals: 8
			},
			{
				address: ARB_TOKEN_ADDRESSES.TBTC,
				symbol: 'TBTC',
				name: 'tBTC v2',
				decimals: 18
			}
		] as ERC20Token[]
	},
	testnet: {
		name: 'Arbitrum Sepolia',
		chainId: 421614,
		rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
		explorerUrl: 'https://sepolia.arbiscan.io',
		explorerApiUrl: 'https://api-sepolia.arbiscan.io/api',
		currency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
		tokens: [] as ERC20Token[]
	}
} as const;

// LayerZero EID constants
export const LAYERZERO_EIDS = {
	ROOTSTOCK: 30333,
	ARBITRUM: 30110,
	ETHEREUM: 30101
} as const;

// RSK Token Configurations (DOC, USDT0)
export const RSK_TOKENS = {
	mainnet: [
		{
			address: '0xe700691dA7b9851F2F35f8b8182c69c53CcaD9Db',
			symbol: 'DOC',
			name: 'Dollar on Chain',
			decimals: 18
		},
		{
			address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
			symbol: 'USDT0',
			name: 'USDT0 on Rootstock',
			decimals: 6
		}
	] as ERC20Token[],
	testnet: [] as ERC20Token[]
} as const;

/**
 * BSC Paymaster Contract configurations
 */
export const BSC_PAYMASTER_CONFIGS: Record<NetworkType, PaymasterConfig> = {
	mainnet: {
		address: '0x0000000000000000000000000000000000000000',
		usdtTokenAddress: '0x55d398326f99059fF775485246999027B3197955',
		minDeposit: ethers.parseEther('1'),
		maxGasPrice: ethers.parseUnits('50', 'gwei'),
		usdtPriceOracle: '0x0000000000000000000000000000000000000000'
	},
	testnet: {
		address: '0x0000000000000000000000000000000000000000',
		usdtTokenAddress: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
		minDeposit: ethers.parseEther('0.1'),
		maxGasPrice: ethers.parseUnits('20', 'gwei'),
		usdtPriceOracle: '0x0000000000000000000000000000000000000000'
	},
	regtest: {
		address: '0x0000000000000000000000000000000000000000',
		usdtTokenAddress: '0x0000000000000000000000000000000000000000',
		minDeposit: ethers.parseEther('0.01'),
		maxGasPrice: ethers.parseUnits('10', 'gwei'),
		usdtPriceOracle: '0x0000000000000000000000000000000000000000'
	}
};

/**
 * Liquid Network Asset IDs
 * These are well-known asset IDs that never change on the Liquid Network
 */
export const LIQUID_ASSET_IDS = {
	mainnet: {
		// L-BTC (Liquid Bitcoin) - the native asset of Liquid Network
		LBTC: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
		// Tether USD on Liquid
		USDT: 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2'
	},
	testnet: {
		// Testnet L-BTC
		LBTC: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
		// Testnet USDT
		USDT: 'b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73'
	},
	regtest: {
		// Use testnet IDs for regtest
		LBTC: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
		USDT: 'b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73'
	}
} as const;

/**
 * Helper functions to get network-specific configurations
 */

export function getBoltzConfig(): BoltzNetworkConfig {
	const network = getNetwork();
	const env = network as Extract<NetworkType, 'regtest' | 'mainnet'>;

	if (!BOLTZ_NETWORKS[env]) {
		console.warn(`Unknown Boltz network: ${env}, falling back to regtest`);
		return BOLTZ_NETWORKS.regtest;
	}

	return BOLTZ_NETWORKS[env];
}

export function getRSKConfig() {
	const network = getNetwork();
	return RSK_NETWORKS[network] || RSK_NETWORKS.testnet;
}

export function getBSCConfig() {
	const network = getNetwork();
	const env =
		network === 'regtest' ? 'testnet' : (network as Extract<NetworkType, 'mainnet' | 'testnet'>);
	return BSC_NETWORKS[env] || BSC_NETWORKS.testnet;
}

export function getBSCPaymasterConfig(): PaymasterConfig {
	const network = getNetwork();
	return BSC_PAYMASTER_CONFIGS[network];
}

export function getUSDTToken(): ERC20Token | undefined {
	const networkConfig = getBSCConfig();
	return networkConfig.tokens.find((token) => token.symbol === 'USDT' || token.symbol === 'tUSDT');
}

export function getMulticallAddress(): string | null {
	const network = getNetwork();
	return RSK_NETWORKS[network].multicallAddress || null;
}

/**
 * Check if RIF Relay is available for current environment
 * @returns True if RIF Relay is available
 */
export function isRifRelayAvailable(): boolean {
	const config = getBoltzConfig();
	return config.rifRelayEnabled;
}

/**
 * Get Liquid asset ID for current network
 */
export function getLiquidAssetId(asset: 'LBTC' | 'USDT'): string {
	const network = getNetwork();
	return LIQUID_ASSET_IDS[network][asset];
}

/**
 * Conversion factor: 1 satoshi = 10^10 wei on RSK
 */
export const SATOSHI_TO_WEI = 10n ** 10n;

/**
 * Convert satoshis to wei
 */
export function satoshiToWei(sats: number | bigint): bigint {
	return BigInt(sats) * SATOSHI_TO_WEI;
}

/**
 * Convert wei to satoshis
 */
export function weiToSatoshi(wei: bigint): number {
	return Number(wei / SATOSHI_TO_WEI);
}

/**
 * Get WebSocket endpoint for Boltz API
 */
export function getWebSocketEndpoint(): string {
	const config = getBoltzConfig();
	return config.boltzWsUrl;
}

/**
 * Get Arbitrum network config for current network
 */
export function getArbConfig() {
	const network = getNetwork();
	const env =
		network === 'regtest' ? 'testnet' : (network as Extract<NetworkType, 'mainnet' | 'testnet'>);
	return ARB_NETWORKS[env] || ARB_NETWORKS.testnet;
}

/**
 * Get RSK token config by symbol (DOC or USDT0)
 */
export function getRSKToken(symbol: 'DOC' | 'USDT0'): ERC20Token | undefined {
	const network = getNetwork();
	const env = network === 'regtest' ? 'testnet' : (network as 'mainnet' | 'testnet');
	return RSK_TOKENS[env]?.find((token) => token.symbol === symbol);
}
