import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockGetAmountsOut = vi.fn().mockResolvedValue([
	BigInt('1000000000000000000'),
	BigInt('990000000')
]);
let mockSwapExactTokensForTokens = vi.fn().mockResolvedValue({
	hash: '0xswap123',
	wait: vi.fn().mockResolvedValue({ hash: '0xswap123' })
});
let mockTokenBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
let mockTokenAllowance = vi.fn().mockResolvedValue(BigInt('0'));
let mockTokenApprove = vi.fn().mockResolvedValue({
	hash: '0xapprove123',
	wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
});

vi.mock('ethers', async () => {
	const actual = await vi.importActual<any>('ethers');
	return {
		...actual,
		ethers: {
			...actual.ethers,
			Contract: vi.fn().mockImplementation((address: string, abi: any[]) => {
				if (abi.some((s: string) => s.includes('swapExactTokensForTokens'))) {
					return {
						getAmountsOut: mockGetAmountsOut,
						swapExactTokensForTokens: mockSwapExactTokensForTokens,
						factory: vi.fn().mockResolvedValue('0xFACTORY'),
						WETH: vi.fn().mockResolvedValue('0xWETH')
					};
				}
				return {
					balanceOf: mockTokenBalanceOf,
					allowance: mockTokenAllowance,
					approve: mockTokenApprove,
					decimals: vi.fn().mockResolvedValue(18)
				};
			})
		}
	};
});

import { RskDexSwapService } from '../../loans/RskDexSwapService';

describe('RskDexSwapService', () => {
	let service: RskDexSwapService;
	let mockSigner: any;
	const ROUTER = '0x98aCE08D2b759a265ae326F010496bcC6Fe06C68';
	const FACTORY = '0x091579DbCC2Bc13B2b8f2E7832Fc9A3a5D8C02D8';
	const DOC = '0xe700691dA7b9851F2F35f8b8182c69c53CcaD9Db';
	const USDT0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAmountsOut = vi.fn().mockResolvedValue([
			BigInt('1000000000000000000'),
			BigInt('990000000')
		]);
		mockSwapExactTokensForTokens = vi.fn().mockResolvedValue({
			hash: '0xswap123',
			wait: vi.fn().mockResolvedValue({ hash: '0xswap123' })
		});
		mockTokenBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
		mockTokenAllowance = vi.fn().mockResolvedValue(BigInt('0'));
		mockTokenApprove = vi.fn().mockResolvedValue({
			hash: '0xapprove123',
			wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
		});

		service = new RskDexSwapService({ routerAddress: ROUTER, factoryAddress: FACTORY });
		mockSigner = {
			address: '0x1234567890123456789012345678901234567890'
		};
	});

	describe('getQuote', () => {
		it('should return swap quote with output amount', async () => {
			const quote = await service.getQuote(DOC, USDT0, '1000000000000000000', mockSigner);
			expect(quote.inputAmount).toBe('1000000000000000000');
			expect(quote.outputAmount).toBe('990000000');
			expect(quote.path).toEqual([DOC, USDT0]);
		});

		it('should throw for zero input amount', async () => {
			await expect(service.getQuote(DOC, USDT0, '0', mockSigner)).rejects.toThrow(
				'Input amount must be greater than zero'
			);
		});
	});

	describe('swap', () => {
		it('should execute swap and return result', async () => {
			const result = await service.swap(DOC, USDT0, '1000000000000000000', '900000000', mockSigner);
			expect(result.txHash).toBe('0xswap123');
			expect(result.inputAmount).toBe('1000000000000000000');
		});

		it('should throw for zero input amount', async () => {
			await expect(service.swap(DOC, USDT0, '0', '0', mockSigner)).rejects.toThrow(
				'Input amount must be greater than zero'
			);
		});

		it('should throw for insufficient balance', async () => {
			mockTokenBalanceOf.mockResolvedValueOnce(BigInt('100'));
			await expect(
				service.swap(DOC, USDT0, '1000000000000000000', '900000000', mockSigner)
			).rejects.toThrow('Insufficient token balance');
		});

		it('should approve if allowance insufficient', async () => {
			await service.swap(DOC, USDT0, '1000000000000000000', '900000000', mockSigner);
			expect(mockTokenApprove).toHaveBeenCalled();
		});
	});

	describe('approve', () => {
		it('should approve router to spend token', async () => {
			const txHash = await service.approve(DOC, '1000000000000000000', mockSigner);
			expect(txHash).toBe('0xapprove123');
		});

		it('should skip if already approved', async () => {
			mockTokenAllowance.mockResolvedValueOnce(BigInt('999999999999999999999'));
			const txHash = await service.approve(DOC, '1000000000000000000', mockSigner);
			expect(txHash).toBe('0x0');
		});
	});

	describe('getRouterAddress', () => {
		it('should return router address', () => {
			expect(service.getRouterAddress()).toBe(ROUTER);
		});
	});
});
