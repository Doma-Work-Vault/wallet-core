import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubmarineSwapRefundService } from './SubmarineSwapRefundService';
import { BoltzClient } from './BoltzClient';
import { EvmContractService } from './EvmContractService';
import type { SubmarineSwapData, SubmarineRefundParams } from './types';

// Mock dependencies
vi.mock('./BoltzClient');
vi.mock('./EvmContractService');
vi.mock('../../utils/networkConfig', () => ({
  getRSKConfig: vi.fn(() => ({
    rpcUrl: 'https://testnet.rsk.co',
  })),
}));

// Mock fetch for RSK API calls
global.fetch = vi.fn();

describe('SubmarineSwapRefundService', () => {
  let service: SubmarineSwapRefundService;
  let mockBoltzClient: any;
  let mockEvmContractService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock BoltzClient
    mockBoltzClient = {};

    // Create mock EvmContractService
    mockEvmContractService = {
      refundFunds: vi.fn().mockResolvedValue({
        txHash: '0x' + 'refund'.repeat(16),
      }),
    };

    // Create service instance
    service = new SubmarineSwapRefundService(mockBoltzClient);
    service.setEvmContractService(mockEvmContractService);

    // Mock fetch for RSK block height
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: '0x' + (1000000).toString(16), // Block height
      }),
    });
  });

  describe('Constructor', () => {
    it('should accept BoltzClient', () => {
      const service = new SubmarineSwapRefundService(mockBoltzClient);
      expect(service).toBeDefined();
    });
  });

  describe('setEvmContractService', () => {
    it('should set EVM contract service', () => {
      const newService = new SubmarineSwapRefundService(mockBoltzClient);
      newService.setEvmContractService(mockEvmContractService);
      expect(newService).toBeDefined();
    });
  });

  describe('isSwapRefundable', () => {
    let swapData: SubmarineSwapData;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        type: 'submarine',
        invoice: 'lnbc1u1p3example...',
        invoiceAmount: 100000,
        fromAsset: 'RBTC',
        fromAmount: 100000,
        lockupAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        claimAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        expectedAmount: 100000,
        acceptZeroConf: false,
        timeoutBlockHeight: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        refundPublicKey: 'refund-pubkey',
        preimageHash: 'e'.repeat(64),
      };
    });

    it('should return false if already refunded', async () => {
      swapData.refundTxHash = '0x' + 'r'.repeat(64);
      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('already refunded');
    });

    it('should return false if invoice was paid', async () => {
      swapData.status = 'invoice.paid';
      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('completed successfully');
    });

    it('should return false if no lockup transaction for RBTC', async () => {
      delete swapData.lockupTxHash;
      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('No RBTC lockup transaction');
    });

    it('should return false if timeout not reached for RBTC', async () => {
      swapData.lockupTxHash = '0x' + 't'.repeat(64);
      swapData.timeoutBlockHeight = 1000000; // Very high timeout
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: '0x' + (100).toString(16), // Current block height much lower
        }),
      });

      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('timeout not reached');
    });

    it('should return true if refundable for RBTC', async () => {
      swapData.lockupTxHash = '0x' + 't'.repeat(64);
      swapData.timeoutBlockHeight = 100; // Low timeout
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: '0x' + (1000000).toString(16), // Current block height much higher
        }),
      });

      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(true);
    });

    it('should return false for BTC (not implemented)', async () => {
      swapData.fromAsset = 'BTC';
      swapData.lockupTxHash = '0x' + 't'.repeat(64);
      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('not yet implemented');
    });

    it('should return false for L-BTC (not implemented)', async () => {
      swapData.fromAsset = 'L-BTC';
      swapData.lockupTxHash = '0x' + 't'.repeat(64);
      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('not yet implemented');
    });

    it('should handle API errors gracefully', async () => {
      swapData.lockupTxHash = '0x' + 't'.repeat(64);
      (global.fetch as any).mockRejectedValueOnce(new Error('API error'));

      const result = await service.isSwapRefundable(swapData);
      expect(result.refundable).toBe(false);
      expect(result.reason).toContain('Failed to fetch');
    });
  });

  describe('refundSubmarineSwap', () => {
    let swapData: SubmarineSwapData;
    let refundParams: SubmarineRefundParams;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        type: 'submarine',
        invoice: 'lnbc1u1p3example...',
        invoiceAmount: 100000,
        fromAsset: 'RBTC',
        fromAmount: 100000,
        lockupAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        claimAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        lockupTxHash: '0x' + 't'.repeat(64),
        status: 'swap.created',
        expectedAmount: 100000,
        acceptZeroConf: false,
        timeoutBlockHeight: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        refundPublicKey: 'refund-pubkey',
        preimageHash: 'e'.repeat(64),
      };

      refundParams = {
        signer: {} as any,
      };

      // Mock isSwapRefundable to return refundable
      vi.spyOn(service, 'isSwapRefundable').mockResolvedValue({
        refundable: true,
        currentBlockHeight: 1000000,
      });
    });

    it('should throw if swap not refundable', async () => {
      vi.spyOn(service, 'isSwapRefundable').mockResolvedValueOnce({
        refundable: false,
        reason: 'Not refundable',
      });

      await expect(service.refundSubmarineSwap(swapData, refundParams)).rejects.toThrow('Swap not refundable');
    });

    it('should refund RBTC successfully', async () => {
      const result = await service.refundSubmarineSwap(swapData, refundParams);

      expect(result.txHash).toBeDefined();
      expect(result.swapData.refundTxHash).toBeDefined();
      expect(result.swapData.status).toBe('swap.refunded');
      expect(mockEvmContractService.refundFunds).toHaveBeenCalled();
    });

    it('should throw for unsupported assets', async () => {
      swapData.fromAsset = 'UNSUPPORTED' as any;
      await expect(service.refundSubmarineSwap(swapData, refundParams)).rejects.toThrow('Unsupported asset');
    });
  });
});

