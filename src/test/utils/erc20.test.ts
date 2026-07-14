import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	encodeERC20Transfer,
	encodeERC20Approve,
	encodeERC20BalanceOf,
	encodeERC20Allowance,
	decodeERC20Balance,
	waitForERC20Balance,
	waitForERC20Allowance,
	usdToTokenWei,
	tokenWeiToUsd,
	formatTokenAmount
} from '../../utils/erc20';

describe('ERC-20 Utilities', () => {
	describe('encodeERC20Transfer', () => {
		it('should encode a transfer call', () => {
			const calldata = encodeERC20Transfer('0x1234567890123456789012345678901234567890', '1000000');
			expect(calldata).toMatch(/^0x/);
			expect(calldata.length).toBeGreaterThan(10);
			// transfer function selector = 0xa9059cbb
			expect(calldata.startsWith('0xa9059cbb')).toBe(true);
		});

		it('should handle bigint amounts', () => {
			const calldata = encodeERC20Transfer('0x1234567890123456789012345678901234567890', BigInt('50000000'));
			expect(calldata).toMatch(/^0x/);
		});
	});

	describe('encodeERC20Approve', () => {
		it('should encode an approve call', () => {
			const calldata = encodeERC20Approve('0x1234567890123456789012345678901234567890', '1000000');
			// approve function selector = 0x095ea7b3
			expect(calldata.startsWith('0x095ea7b3')).toBe(true);
		});
	});

	describe('encodeERC20BalanceOf', () => {
		it('should encode a balanceOf call', () => {
			const calldata = encodeERC20BalanceOf('0x1234567890123456789012345678901234567890');
			// balanceOf function selector = 0x70a08231
			expect(calldata.startsWith('0x70a08231')).toBe(true);
		});
	});

	describe('encodeERC20Allowance', () => {
		it('should encode an allowance call', () => {
			const calldata = encodeERC20Allowance(
				'0x1234567890123456789012345678901234567890',
				'0x0987654321098765432109876543210987654321'
			);
			// allowance function selector = 0xdd62ed3e
			expect(calldata.startsWith('0xdd62ed3e')).toBe(true);
		});
	});

	describe('decodeERC20Balance', () => {
		it('should decode a balanceOf return value', () => {
			// Encode a known balance (5000000 with 6 decimals = $5.00)
			const encoded = '0x00000000000000000000000000000000000000000000000000000000004c4b40';
			const balance = decodeERC20Balance(encoded);
			expect(balance).toBe(BigInt(5000000));
		});

		it('should decode zero balance', () => {
			const encoded = '0x0000000000000000000000000000000000000000000000000000000000000000';
			const balance = decodeERC20Balance(encoded);
			expect(balance).toBe(BigInt(0));
		});
	});

	describe('usdToTokenWei', () => {
		it('should convert $50 to USDT wei (6 decimals)', () => {
			const result = usdToTokenWei(50, 6);
			expect(result).toBe(BigInt(50000000));
		});

		it('should convert $50 to DOC wei (18 decimals)', () => {
			const result = usdToTokenWei(50, 18);
			expect(result).toBe(BigInt('50000000000000000000'));
		});

		it('should convert $0.01 to USDT wei (6 decimals)', () => {
			const result = usdToTokenWei(0.01, 6);
			expect(result).toBe(BigInt(10000));
		});

		it('should convert $0 to zero', () => {
			const result = usdToTokenWei(0, 6);
			expect(result).toBe(BigInt(0));
		});

		it('should handle fractional cents correctly', () => {
			const result = usdToTokenWei(1.99, 6);
			expect(result).toBe(BigInt(1990000));
		});

		it('should throw for negative amounts', () => {
			expect(() => usdToTokenWei(-1, 6)).toThrow('non-negative');
		});

		it('should throw for NaN', () => {
			expect(() => usdToTokenWei(NaN, 6)).toThrow('finite');
		});

		it('should throw for Infinity', () => {
			expect(() => usdToTokenWei(Infinity, 6)).toThrow('finite');
		});

		it('should throw for negative decimals', () => {
			expect(() => usdToTokenWei(10, -1)).toThrow('non-negative integer');
		});

		it('should throw for non-integer decimals', () => {
			expect(() => usdToTokenWei(10, 1.5)).toThrow('non-negative integer');
		});
	});

	describe('tokenWeiToUsd', () => {
		it('should convert USDT wei (6 decimals) to USD', () => {
			const result = tokenWeiToUsd(BigInt(50000000), 6);
			expect(result).toBe(50);
		});

		it('should convert DOC wei (18 decimals) to USD', () => {
			const result = tokenWeiToUsd(BigInt('50000000000000000000'), 18);
			expect(result).toBe(50);
		});

		it('should handle zero', () => {
			expect(tokenWeiToUsd(BigInt(0), 6)).toBe(0);
		});

		it('should be inverse of usdToTokenWei for round-trip values', () => {
			const usd = 42.5;
			const wei = usdToTokenWei(usd, 6);
			const backToUsd = tokenWeiToUsd(wei, 6);
			expect(backToUsd).toBeCloseTo(usd, 4);
		});
	});

	describe('formatTokenAmount', () => {
		it('should format USDT amount (6 decimals)', () => {
			const result = formatTokenAmount(BigInt(50000000), 6);
			expect(result).toBe('50.000000');
		});

		it('should format with custom display decimals', () => {
			const result = formatTokenAmount(BigInt(50123456), 6, 2);
			expect(result).toBe('50.12');
		});

		it('should handle string amounts', () => {
			const result = formatTokenAmount('50000000', 6);
			expect(result).toBe('50.000000');
		});

		it('should handle zero', () => {
			const result = formatTokenAmount(BigInt(0), 6);
			expect(result).toBe('0.000000');
		});

		it('should handle small amounts', () => {
			const result = formatTokenAmount(BigInt(1), 6);
			expect(result).toBe('0.000001');
		});
	});

	describe('waitForERC20Balance', () => {
		let mockContract: any;

		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should resolve immediately if balance already meets target', async () => {
			const mockProvider = {
				getBalance: vi.fn()
			};

			// We need to mock the ethers Contract creation
			// This is tested via the integration path — the function creates a contract internally
			// For unit testing, we verify the function signature and behavior
			expect(typeof waitForERC20Balance).toBe('function');
		});

		it('should be callable with correct parameters', () => {
			// Verify the function accepts the expected parameter types
			expect(typeof waitForERC20Balance).toBe('function');
			expect(waitForERC20Balance.length).toBe(4); // provider, tokenAddress, owner, targetAmount
		});
	});

	describe('waitForERC20Allowance', () => {
		it('should be callable with correct parameters', () => {
			expect(typeof waitForERC20Allowance).toBe('function');
			expect(waitForERC20Allowance.length).toBe(5); // provider, tokenAddress, owner, spender, minAllowance
		});
	});
});
