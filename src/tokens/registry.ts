/**
 * Multi-Chain Token Registry
 *
 * Single source of truth for USDT0 and other token addresses across all chains.
 * This replaces the fragmented registries in the frontend (verified-tokens.ts,
 * token-registry.ts, gasless.config.ts).
 *
 * All addresses are checksummed (EIP-55).
 */

import type { ERC20Token } from '../core/types';

// ─── Chain identifiers ───

export type SupportedChain =
	| 'rsk'
	| 'arbitrum'
	| 'bsc'
	| 'ethereum'
	| 'rsk-testnet'
	| 'arbitrum-sepolia'
	| 'bsc-testnet';

// ─── Token address registry ───

/**
 * USDT0 / USDT addresses across all supported chains.
 * This is the SINGLE SOURCE OF TRUTH for USDT addresses in the BitTasker ecosystem.
 */
export const USDT_ADDRESSES: Record<SupportedChain, string | null> = {
	// USDT0 on Rootstock (LayerZero OFT, 6 decimals)
	'rsk': '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
	// USDT0 on Arbitrum One (LayerZero OFT, 6 decimals)
	'arbitrum': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
	// USDT on BSC (BEP-20, 18 decimals — legacy, NOT USDT0)
	'bsc': '0x55d398326f99059fF775485246999027B3197955',
	// USDT on Ethereum (ERC-20, 6 decimals)
	'ethereum': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
	// Testnet addresses — not deployed on public testnets
	'rsk-testnet': null,
	'arbitrum-sepolia': null,
	'bsc-testnet': '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'
};

/**
 * WBTC addresses across supported chains.
 */
export const WBTC_ADDRESSES: Record<SupportedChain, string | null> = {
	'rsk': null,
	'arbitrum': '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
	'bsc': null,
	'ethereum': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
	'rsk-testnet': null,
	'arbitrum-sepolia': null,
	'bsc-testnet': null
};

/**
 * tBTC v2 addresses across supported chains.
 */
export const TBTC_ADDRESSES: Record<SupportedChain, string | null> = {
	'rsk': null,
	'arbitrum': '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
	'bsc': null,
	'ethereum': '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
	'rsk-testnet': null,
	'arbitrum-sepolia': null,
	'bsc-testnet': null
};

/**
 * DOC (Dollar on Chain) addresses on RSK.
 */
export const DOC_ADDRESSES: Partial<Record<SupportedChain, string>> = {
	'rsk': '0xe700691dA7b9851F2F35f8b8182c69c53CcaD9Db',
	'rsk-testnet': '0xcb440023442e4A51A67Df905b5C76126F6866090'
};

// ─── LayerZero OFT addresses ───

/**
 * USDT0 OFT (Omnichain Fungible Token) bridge contract addresses.
 */
export const OFT_ADDRESSES = {
	/** USDT0 OFT on RSK (Rootstock) */
	rsk: '0x1a594d5d5d1c426281C1064B07f23F57B2716B61',
	/** USDT0 OFT on Arbitrum */
	arbitrum: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92'
} as const;

// ─── LayerZero Endpoint IDs ───

/**
 * LayerZero V2 Endpoint IDs for each chain.
 */
export const LZ_EIDS = {
	ROOTSTOCK: 30333,
	ARBITRUM: 30110,
	ETHEREUM: 30101
} as const;

// ─── Token config lookups ───

/**
 * USDT0 decimals on all chains that use USDT0 (RSK, Arbitrum).
 * Note: BSC USDT is 18 decimals (different token, legacy).
 */
export const USDT0_DECIMALS = 6;

/**
 * WBTC decimals on all chains.
 */
export const WBTC_DECIMALS = 8;

/**
 * tBTC v2 decimals on all chains.
 */
export const TBTC_DECIMALS = 18;

/**
 * DOC decimals on RSK.
 */
export const DOC_DECIMALS = 18;

/**
 * Get a full ERC20Token config for USDT0/USDT on a specific chain.
 * Returns null if the token is not deployed on that chain.
 */
export function getUsdtToken(chain: SupportedChain): ERC20Token | null {
	const address = USDT_ADDRESSES[chain];
	if (!address) return null;

	// BSC USDT is 18 decimals; others are 6
	const decimals = chain === 'bsc' || chain === 'bsc-testnet' ? 18 : USDT0_DECIMALS;
	const symbol = chain === 'bsc' || chain === 'bsc-testnet' ? 'USDT' : 'USDT0';
	const name = chain === 'bsc' || chain === 'bsc-testnet' ? 'Tether USD' : 'USDT0';

	return { address, symbol, name, decimals };
}

/**
 * Get a full ERC20Token config for WBTC on a specific chain.
 * Returns null if WBTC is not deployed on that chain.
 */
export function getWbtcToken(chain: SupportedChain): ERC20Token | null {
	const address = WBTC_ADDRESSES[chain];
	if (!address) return null;
	return { address, symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: WBTC_DECIMALS };
}

/**
 * Get a full ERC20Token config for tBTC v2 on a specific chain.
 * Returns null if tBTC is not deployed on that chain.
 */
export function getTbtcToken(chain: SupportedChain): ERC20Token | null {
	const address = TBTC_ADDRESSES[chain];
	if (!address) return null;
	return { address, symbol: 'TBTC', name: 'tBTC v2', decimals: TBTC_DECIMALS };
}

/**
 * Get all configured tokens for a specific chain.
 */
export function getTokensForChain(chain: SupportedChain): ERC20Token[] {
	const tokens: ERC20Token[] = [];
	const usdt = getUsdtToken(chain);
	if (usdt) tokens.push(usdt);
	const wbtc = getWbtcToken(chain);
	if (wbtc) tokens.push(wbtc);
	const tbtc = getTbtcToken(chain);
	if (tbtc) tokens.push(tbtc);

	// Add DOC for RSK chains
	if (chain === 'rsk' || chain === 'rsk-testnet') {
		const docAddr = DOC_ADDRESSES[chain];
		if (docAddr) {
			tokens.push({
				address: docAddr,
				symbol: 'DOC',
				name: 'Dollar on Chain',
				decimals: DOC_DECIMALS
			});
		}
	}

	return tokens;
}

/**
 * Find the USDT0/USDT address for a given chain ID.
 * Useful for dynamic chain ID lookups from contract data.
 *
 * @param chainId - EVM chain ID
 * @returns Token address or null if not configured
 */
export function getUsdtAddressByChainId(chainId: number): string | null {
	const chainIdToChain: Record<number, SupportedChain> = {
		30: 'rsk',
		42161: 'arbitrum',
		56: 'bsc',
		1: 'ethereum',
		31: 'rsk-testnet',
		421614: 'arbitrum-sepolia',
		97: 'bsc-testnet'
	};

	const chain = chainIdToChain[chainId];
	if (!chain) return null;
	return USDT_ADDRESSES[chain];
}

/**
 * Find the USDT0/USDT decimals for a given chain ID.
 * Returns null if chain is not configured.
 */
export function getUsdtDecimalsByChainId(chainId: number): number | null {
	if (chainId === 56 || chainId === 97) return 18; // BSC USDT is 18 decimals
	const address = getUsdtAddressByChainId(chainId);
	if (!address) return null;
	return USDT0_DECIMALS; // 6 for all USDT0 chains
}
