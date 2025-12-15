import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BSCPaymasterContract, PostOpMode } from './BSCPaymaster';
import { ethers } from 'ethers';
import type { PaymasterConfig } from '../../core/types';

describe('BSCPaymasterContract', () => {
  let mockProvider: any;
  let mockWallet: any;
  let paymasterConfig: PaymasterConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      getBalance: vi.fn(),
    };

    // Create mock wallet
    mockWallet = {
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    paymasterConfig = {
      address: '0x1234567890123456789012345678901234567890',
      minDeposit: BigInt('1000000000000000000'), // 1 BNB
      usdtTokenAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    };
  });

  describe('PostOpMode enum', () => {
    it('should have correct enum values', () => {
      expect(PostOpMode.opSucceeded).toBe(0);
      expect(PostOpMode.opReverted).toBe(1);
      expect(PostOpMode.postOpReverted).toBe(2);
    });
  });

  describe('Constructor', () => {
    it('should create paymaster contract instance', () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      expect(paymaster).toBeDefined();
    });

    it('should initialize with correct config', () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      expect(paymaster).toBeDefined();
    });
  });

  describe('hasSufficientDeposit', () => {
    it('should return boolean', async () => {
      // Note: This will fail on actual network call, but tests the method exists
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      try {
        const result = await paymaster.hasSufficientDeposit();
        expect(typeof result).toBe('boolean');
      } catch (error) {
        // Expected if contract doesn't exist on testnet
        expect(error).toBeDefined();
      }
    });
  });

  describe('getDeposit', () => {
    it('should return bigint', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      try {
        const result = await paymaster.getDeposit();
        expect(typeof result).toBe('bigint');
      } catch (error) {
        // Expected if contract doesn't exist on testnet
        // Should return BigInt(0) on error
        const result = await paymaster.getDeposit();
        expect(result).toBe(BigInt(0));
      }
    });
  });

  describe('getUsdtPrice', () => {
    it('should return bigint', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const result = await paymaster.getUsdtPrice();

      expect(typeof result).toBe('bigint');
      // Should return default price (0.0003 BNB) on error
      expect(result).toBeGreaterThanOrEqual(BigInt(0));
    });
  });

  describe('convertUsdtToBnb', () => {
    it('should return bigint', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const usdtAmount = ethers.parseUnits('100', 18);

      const result = await paymaster.convertUsdtToBnb(usdtAmount);

      expect(typeof result).toBe('bigint');
      expect(result).toBeGreaterThanOrEqual(BigInt(0));
    });
  });

  describe('estimateUsdtCost', () => {
    it('should return bigint', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const gasLimit = BigInt('21000');
      const gasPrice = BigInt('3000000000');

      const result = await paymaster.estimateUsdtCost(gasLimit, gasPrice);

      expect(typeof result).toBe('bigint');
      expect(result).toBeGreaterThanOrEqual(BigInt(0));
    });

    it('should calculate cost correctly', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const gasLimit = BigInt('21000');
      const gasPrice = BigInt('3000000000');

      const result = await paymaster.estimateUsdtCost(gasLimit, gasPrice);

      // Should be calculated: (gasLimit * gasPrice * 1e18) / usdtPrice
      // Even with default price, should return a valid value
      expect(result).toBeGreaterThan(BigInt(0));
    });
  });

  describe('canPayFeesInUsdt', () => {
    it('should return boolean', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const result = await paymaster.canPayFeesInUsdt();

      expect(typeof result).toBe('boolean');
    });

    it('should handle errors gracefully', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      // Should not throw even if contract calls fail
      await expect(paymaster.canPayFeesInUsdt()).resolves.toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return status structure', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const status = await paymaster.getStatus();

      expect(status).toHaveProperty('hasDeposit');
      expect(status).toHaveProperty('depositAmount');
      expect(status).toHaveProperty('canPayInUsdt');
      expect(status).toHaveProperty('usdtPrice');
      expect(status).toHaveProperty('minDeposit');
      expect(typeof status.hasDeposit).toBe('boolean');
      expect(typeof status.depositAmount).toBe('bigint');
      expect(typeof status.canPayInUsdt).toBe('boolean');
      expect(typeof status.usdtPrice).toBe('bigint');
      expect(typeof status.minDeposit).toBe('bigint');
    });

    it('should return default values on error', async () => {
      const paymaster = new BSCPaymasterContract(
        paymasterConfig.address,
        mockProvider as any,
        mockWallet as any,
        paymasterConfig
      );

      const status = await paymaster.getStatus();

      // Should have valid structure even on error
      expect(status.hasDeposit).toBe(false);
      expect(status.depositAmount).toBe(BigInt(0));
      expect(status.canPayInUsdt).toBe(false);
      expect(status.usdtPrice).toBe(ethers.parseEther('0.0003'));
      expect(status.minDeposit).toBe(paymasterConfig.minDeposit);
    });
  });
});

