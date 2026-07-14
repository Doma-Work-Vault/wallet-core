import { describe, it, expect } from 'vitest';
import {
	USDT_ADDRESSES,
	WBTC_ADDRESSES,
	TBTC_ADDRESSES,
	DOC_ADDRESSES,
	OFT_ADDRESSES,
	LZ_EIDS,
	USDT0_DECIMALS,
	WBTC_DECIMALS,
	TBTC_DECIMALS,
	DOC_DECIMALS,
	getUsdtToken,
	getWbtcToken,
	getTbtcToken,
	getTokensForChain,
	getUsdtAddressByChainId,
	getUsdtDecimalsByChainId
} from '../../tokens/registry';

describe('Multi-Chain Token Registry', () => {
	describe('USDT_ADDRESSES', () => {
		it('should have RSK USDT0 address', () => {
			expect(USDT_ADDRESSES['rsk']).toBe('0x779Ded0c9e1022225f8E0630b35a9b54bE713736');
		});

		it('should have Arbitrum USDT0 address', () => {
			expect(USDT_ADDRESSES['arbitrum']).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
		});

		it('should have BSC USDT address', () => {
			expect(USDT_ADDRESSES['bsc']).toBe('0x55d398326f99059fF775485246999027B3197955');
		});

		it('should have Ethereum USDT address', () => {
			expect(USDT_ADDRESSES['ethereum']).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
		});

		it('should have null for testnet USDT0 (not deployed)', () => {
			expect(USDT_ADDRESSES['rsk-testnet']).toBeNull();
			expect(USDT_ADDRESSES['arbitrum-sepolia']).toBeNull();
		});

		it('should have BSC testnet USDT address', () => {
			expect(USDT_ADDRESSES['bsc-testnet']).toBe('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd');
		});
	});

	describe('WBTC_ADDRESSES', () => {
		it('should have Arbitrum WBTC address', () => {
			expect(WBTC_ADDRESSES['arbitrum']).toBe('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
		});

		it('should have null for RSK (no WBTC on RSK)', () => {
			expect(WBTC_ADDRESSES['rsk']).toBeNull();
		});
	});

	describe('TBTC_ADDRESSES', () => {
		it('should have Arbitrum tBTC address', () => {
			expect(TBTC_ADDRESSES['arbitrum']).toBe('0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40');
		});
	});

	describe('DOC_ADDRESSES', () => {
		it('should have RSK DOC address', () => {
			expect(DOC_ADDRESSES['rsk']).toBe('0xe700691dA7b9851F2F35f8b8182c69c53CcaD9Db');
		});

		it('should have RSK testnet DOC address', () => {
			expect(DOC_ADDRESSES['rsk-testnet']).toBe('0xcb440023442e4A51A67Df905b5C76126F6866090');
		});
	});

	describe('OFT_ADDRESSES', () => {
		it('should have RSK OFT address', () => {
			expect(OFT_ADDRESSES.rsk).toBe('0x1a594d5d5d1c426281C1064B07f23F57B2716B61');
		});

		it('should have Arbitrum OFT address', () => {
			expect(OFT_ADDRESSES.arbitrum).toBe('0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92');
		});
	});

	describe('LZ_EIDS', () => {
		it('should have correct LayerZero endpoint IDs', () => {
			expect(LZ_EIDS.ROOTSTOCK).toBe(30333);
			expect(LZ_EIDS.ARBITRUM).toBe(30110);
			expect(LZ_EIDS.ETHEREUM).toBe(30101);
		});
	});

	describe('Decimal constants', () => {
		it('should have correct decimal values', () => {
			expect(USDT0_DECIMALS).toBe(6);
			expect(WBTC_DECIMALS).toBe(8);
			expect(TBTC_DECIMALS).toBe(18);
			expect(DOC_DECIMALS).toBe(18);
		});
	});

	describe('getUsdtToken', () => {
		it('should return RSK USDT0 token config', () => {
			const token = getUsdtToken('rsk');
			expect(token).not.toBeNull();
			expect(token!.symbol).toBe('USDT0');
			expect(token!.decimals).toBe(6);
			expect(token!.address).toBe('0x779Ded0c9e1022225f8E0630b35a9b54bE713736');
		});

		it('should return Arbitrum USDT0 token config', () => {
			const token = getUsdtToken('arbitrum');
			expect(token).not.toBeNull();
			expect(token!.symbol).toBe('USDT0');
			expect(token!.decimals).toBe(6);
		});

		it('should return BSC USDT with 18 decimals', () => {
			const token = getUsdtToken('bsc');
			expect(token).not.toBeNull();
			expect(token!.symbol).toBe('USDT');
			expect(token!.decimals).toBe(18);
		});

		it('should return null for RSK testnet (not deployed)', () => {
			const token = getUsdtToken('rsk-testnet');
			expect(token).toBeNull();
		});

		it('should return null for Arbitrum Sepolia (not deployed)', () => {
			const token = getUsdtToken('arbitrum-sepolia');
			expect(token).toBeNull();
		});
	});

	describe('getWbtcToken', () => {
		it('should return Arbitrum WBTC token config', () => {
			const token = getWbtcToken('arbitrum');
			expect(token).not.toBeNull();
			expect(token!.symbol).toBe('WBTC');
			expect(token!.decimals).toBe(8);
		});

		it('should return null for RSK (no WBTC)', () => {
			const token = getWbtcToken('rsk');
			expect(token).toBeNull();
		});
	});

	describe('getTbtcToken', () => {
		it('should return Arbitrum tBTC token config', () => {
			const token = getTbtcToken('arbitrum');
			expect(token).not.toBeNull();
			expect(token!.symbol).toBe('TBTC');
			expect(token!.decimals).toBe(18);
		});
	});

	describe('getTokensForChain', () => {
		it('should return RSK tokens (USDT0 + DOC)', () => {
			const tokens = getTokensForChain('rsk');
			expect(tokens.length).toBe(2);
			expect(tokens.some(t => t.symbol === 'USDT0')).toBe(true);
			expect(tokens.some(t => t.symbol === 'DOC')).toBe(true);
		});

		it('should return Arbitrum tokens (USDT0 + WBTC + tBTC)', () => {
			const tokens = getTokensForChain('arbitrum');
			expect(tokens.length).toBe(3);
			expect(tokens.some(t => t.symbol === 'USDT0')).toBe(true);
			expect(tokens.some(t => t.symbol === 'WBTC')).toBe(true);
			expect(tokens.some(t => t.symbol === 'TBTC')).toBe(true);
		});

		it('should return RSK testnet tokens (DOC only, no USDT0)', () => {
			const tokens = getTokensForChain('rsk-testnet');
			expect(tokens.length).toBe(1);
			expect(tokens[0].symbol).toBe('DOC');
		});

		it('should return BSC tokens (USDT)', () => {
			const tokens = getTokensForChain('bsc');
			expect(tokens.some(t => t.symbol === 'USDT')).toBe(true);
		});

		it('should return empty array for Arbitrum Sepolia', () => {
			const tokens = getTokensForChain('arbitrum-sepolia');
			expect(tokens.length).toBe(0);
		});
	});

	describe('getUsdtAddressByChainId', () => {
		it('should return RSK USDT0 for chainId 30', () => {
			expect(getUsdtAddressByChainId(30)).toBe('0x779Ded0c9e1022225f8E0630b35a9b54bE713736');
		});

		it('should return Arbitrum USDT0 for chainId 42161', () => {
			expect(getUsdtAddressByChainId(42161)).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
		});

		it('should return BSC USDT for chainId 56', () => {
			expect(getUsdtAddressByChainId(56)).toBe('0x55d398326f99059fF775485246999027B3197955');
		});

		it('should return Ethereum USDT for chainId 1', () => {
			expect(getUsdtAddressByChainId(1)).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
		});

		it('should return null for unknown chain ID', () => {
			expect(getUsdtAddressByChainId(999)).toBeNull();
		});
	});

	describe('getUsdtDecimalsByChainId', () => {
		it('should return 6 for RSK (USDT0)', () => {
			expect(getUsdtDecimalsByChainId(30)).toBe(6);
		});

		it('should return 6 for Arbitrum (USDT0)', () => {
			expect(getUsdtDecimalsByChainId(42161)).toBe(6);
		});

		it('should return 18 for BSC (legacy USDT)', () => {
			expect(getUsdtDecimalsByChainId(56)).toBe(18);
		});

		it('should return null for unknown chain', () => {
			expect(getUsdtDecimalsByChainId(999)).toBeNull();
		});
	});
});
