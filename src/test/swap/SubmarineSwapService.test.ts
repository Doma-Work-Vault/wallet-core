import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubmarineSwapService } from '../../swaps/boltz/SubmarineSwapService';
import { BoltzClient } from '../../swaps/boltz/BoltzClient';
import { BoltzWebSocket } from '../../swaps/boltz/WebSocketClient';
import { EvmContractService } from '../../swaps/boltz/EvmContractService';
import { SubmarineSwapRefundService } from '../../swaps/boltz/SubmarineSwapRefundService';
import type { SwapStorage, SubmarineSwapData, SwapEvent } from '../../swaps/boltz/types';
import * as ethers from 'ethers';

// Mock dependencies
vi.mock('./BoltzClient');
vi.mock('./WebSocketClient');
vi.mock('./EvmContractService');
vi.mock('./SubmarineSwapRefundService', () => ({
  SubmarineSwapRefundService: vi.fn().mockImplementation(() => ({
    setEvmContractService: vi.fn(),
    isSwapRefundable: vi.fn().mockResolvedValue({ refundable: true }),
    refundSubmarineSwap: vi.fn().mockResolvedValue({
      swapData: {} as SubmarineSwapData,
      txHash: '0x' + 'refund'.repeat(16),
    }),
  })),
}));
vi.mock('../../utils/networkConfig', () => ({
  weiToSatoshi: vi.fn((wei: bigint) => Number(wei) / 1e10),
}));

// Mock bolt11
vi.mock('bolt11', () => ({
  default: {
    decode: vi.fn((invoice: string) => ({
      millisatoshis: '100000000', // 100000 sats
      tags: [
        {
          tagName: 'payment_hash',
          data: Buffer.from('e'.repeat(64), 'hex'),
        },
      ],
    })),
  },
}));

describe('SubmarineSwapService', () => {
  let service: SubmarineSwapService;
  let mockBoltzClient: any;
  let mockWebSocket: any;
  let mockEvmContractService: any;
  let mockRefundService: any;
  let mockStorage: SwapStorage;
  let mockSigner: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
    };

    // Create mock signer
    const validAddress = '0x1234567890123456789012345678901234567890';
    mockSigner = {
      getAddress: vi.fn().mockResolvedValue(validAddress),
      provider: mockProvider,
      address: validAddress,
    };

    // Create mock BoltzClient
    mockBoltzClient = {
      getSubmarineSwapPairs: vi.fn().mockResolvedValue({
        RBTC: {
          BTC: {
            limits: {
              minimal: 10000,
              maximal: 1000000000,
            },
            hash: 'pair-hash-123',
          },
        },
      }),
      createSubmarineSwap: vi.fn().mockResolvedValue({
        id: 'swap-123',
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        claimAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        expectedAmount: 100000,
        timeoutBlockHeight: 100,
        acceptZeroConf: false,
        swapTree: 'swap-tree-123',
        blindingKey: 'blinding-key-123',
        bip21: 'bitcoin:...',
      }),
    };

    // Create mock WebSocket
    mockWebSocket = {
      subscribeToSwap: vi.fn(),
    };

    // Create mock EvmContractService
    mockEvmContractService = {
      estimateLockupGas: vi.fn().mockResolvedValue(BigInt('6000000000000')),
      lockFunds: vi.fn().mockResolvedValue({
        txHash: '0x' + 'l'.repeat(64),
      }),
    };

    // Create mock storage
    mockStorage = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      loadAll: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    // Create service instance
    service = new SubmarineSwapService(
      mockWebSocket,
      mockBoltzClient,
      mockEvmContractService,
      mockStorage
    );

    // Get the refund service instance
    mockRefundService = (service as any).refundService;
    if (mockRefundService) {
      vi.spyOn(mockRefundService, 'isSwapRefundable').mockResolvedValue({ refundable: true });
      vi.spyOn(mockRefundService, 'refundSubmarineSwap').mockResolvedValue({
        swapData: {} as SubmarineSwapData,
        txHash: '0x' + 'refund'.repeat(16),
      });
    }
  });

  describe('Constructor', () => {
    it('should accept dependencies', () => {
      const service = new SubmarineSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService,
        mockStorage
      );
      expect(service).toBeDefined();
    });

    it('should work without storage', () => {
      const service = new SubmarineSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );
      expect(service).toBeDefined();
    });
  });

  describe('getSwapLimits', () => {
    it('should return swap limits', async () => {
      const limits = await service.getSwapLimits('RBTC', 'BTC');
      expect(limits.minimal).toBe(10000);
      expect(limits.maximal).toBe(1000000000);
      expect(mockBoltzClient.getSubmarineSwapPairs).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockBoltzClient.getSubmarineSwapPairs.mockRejectedValueOnce(new Error('API error'));
      await expect(service.getSwapLimits('RBTC', 'BTC')).rejects.toThrow('API error');
    });

    it('should throw if pair not found', async () => {
      mockBoltzClient.getSubmarineSwapPairs.mockResolvedValueOnce({});
      await expect(service.getSwapLimits('RBTC', 'BTC')).rejects.toThrow('Submarine swap pair RBTC/BTC not available');
    });
  });

  describe('createSubmarineSwap', () => {
    const validInvoice = 'lnbc1u1p3example...';

    it('should validate invoice format', async () => {
      await expect(service.createSubmarineSwap({
        from: 'RBTC',
        to: 'BTC',
        invoice: 'invalid-invoice',
        refundPublicKey: 'refund-pubkey',
      })).rejects.toThrow('Invalid Lightning invoice format');
    });

    it('should create swap successfully', async () => {
      const result = await service.createSubmarineSwap({
        from: 'RBTC',
        to: 'BTC',
        invoice: validInvoice,
        refundPublicKey: 'refund-pubkey',
      });

      expect(result.swapId).toBe('swap-123');
      expect(result.swapData.id).toBe('swap-123');
      expect(result.swapData.status).toBe('swap.created');
      expect(result.swapData.type).toBe('submarine');
      expect(mockStorage.save).toHaveBeenCalled();
      expect(mockWebSocket.subscribeToSwap).toHaveBeenCalled();
    });

    it('should estimate gas for RBTC swaps', async () => {
      const result = await service.createSubmarineSwap({
        from: 'RBTC',
        to: 'BTC',
        invoice: validInvoice,
        refundPublicKey: 'refund-pubkey',
        signer: mockSigner,
      });

      expect(result.estimatedGas).toBeDefined();
      expect(result.estimatedGas?.costWei).toBeDefined();
      expect(mockEvmContractService.estimateLockupGas).toHaveBeenCalled();
    });

    it('should handle gas estimation errors gracefully', async () => {
      mockEvmContractService.estimateLockupGas.mockRejectedValueOnce(new Error('Gas estimation failed'));

      const result = await service.createSubmarineSwap({
        from: 'RBTC',
        to: 'BTC',
        invoice: validInvoice,
        refundPublicKey: 'refund-pubkey',
        signer: mockSigner,
      });

      // Should still create swap without gas estimation
      expect(result.swapId).toBe('swap-123');
      expect(result.estimatedGas).toBeUndefined();
    });

    it('should throw if pair not available', async () => {
      mockBoltzClient.getSubmarineSwapPairs.mockResolvedValueOnce({});
      await expect(service.createSubmarineSwap({
        from: 'RBTC',
        to: 'BTC',
        invoice: validInvoice,
        refundPublicKey: 'refund-pubkey',
      })).rejects.toThrow('Submarine swap pair RBTC/BTC not available');
    });
  });

  describe('lockFundsEVM', () => {
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
        preimageHash: 'e'.repeat(64),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        refundPublicKey: 'refund-pubkey',
      };
    });

    it('should lock funds successfully', async () => {
      const result = await service.lockFundsEVM(swapData, mockSigner);

      expect(result.txHash).toBe('0x' + 'l'.repeat(64));
      expect(swapData.lockupTxHash).toBe('0x' + 'l'.repeat(64));
      expect(swapData.status).toBe('transaction.mempool');
      expect(mockEvmContractService.lockFunds).toHaveBeenCalled();
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should throw if not RBTC swap', async () => {
      swapData.fromAsset = 'BTC';
      await expect(service.lockFundsEVM(swapData, mockSigner)).rejects.toThrow('lockFundsEVM is only for RBTC swaps');
    });

    it('should throw if missing claim address', async () => {
      delete swapData.claimAddress;
      await expect(service.lockFundsEVM(swapData, mockSigner)).rejects.toThrow('Missing claim address for RBTC swap');
    });

    it('should throw if missing preimage hash', async () => {
      delete swapData.preimageHash;
      await expect(service.lockFundsEVM(swapData, mockSigner)).rejects.toThrow('Missing preimage hash');
    });

    it('should throw if already locked', async () => {
      swapData.lockupTxHash = '0x' + 'existing'.repeat(8);
      await expect(service.lockFundsEVM(swapData, mockSigner)).rejects.toThrow('Funds already locked');
    });

    it('should validate preimage hash format', async () => {
      swapData.preimageHash = 'invalid';
      await expect(service.lockFundsEVM(swapData, mockSigner)).rejects.toThrow('Invalid preimage hash format');
    });
  });

  describe('getLockupInfo', () => {
    it('should return lockup info for BTC swaps', () => {
      const swapData: SubmarineSwapData = {
        id: 'swap-123',
        type: 'submarine',
        invoice: 'lnbc1u1p3example...',
        invoiceAmount: 100000,
        fromAsset: 'BTC',
        fromAmount: 100000,
        lockupAddress: 'bc1q...',
        status: 'swap.created',
        expectedAmount: 100000,
        acceptZeroConf: false,
        timeoutBlockHeight: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        refundPublicKey: 'refund-pubkey',
        bip21: 'bitcoin:...',
      };

      const info = service.getLockupInfo(swapData);

      expect(info.address).toBe('bc1q...');
      expect(info.amount).toBe(100000);
      expect(info.bip21).toBe('bitcoin:...');
    });

    it('should throw for RBTC swaps', () => {
      const swapData: SubmarineSwapData = {
        id: 'swap-123',
        type: 'submarine',
        invoice: 'lnbc1u1p3example...',
        invoiceAmount: 100000,
        fromAsset: 'RBTC',
        fromAmount: 100000,
        lockupAddress: '0x...',
        status: 'swap.created',
        expectedAmount: 100000,
        acceptZeroConf: false,
        timeoutBlockHeight: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        refundPublicKey: 'refund-pubkey',
      };

      expect(() => service.getLockupInfo(swapData)).toThrow('Use lockFundsEVM() for RBTC swaps');
    });
  });

  describe('handleSwapUpdate', () => {
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
      };
      service['activeSwaps'].set('swap-123', swapData);
    });

    it('should update status to transaction.mempool', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.mempool',
        transaction: {
          id: '0x' + 't'.repeat(64),
        },
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.mempool');
      expect(swapData.lockupTxHash).toBe('0x' + 't'.repeat(64));
    });

    it('should update status to transaction.confirmed', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.confirmed',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.confirmed');
    });

    it('should update status to invoice.paid', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'invoice.paid',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('invoice.paid');
    });

    it('should update status to transaction.claimed', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.claimed',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.claimed');
    });

    it('should handle swap failures', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.failed',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.failed');
    });
  });

  describe('refundSubmarineSwap', () => {
    it('should refund a swap', async () => {
      const swapData: SubmarineSwapData = {
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
        lockupTxHash: '0x' + 'l'.repeat(64), // Add lockup transaction hash
      };

      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.refundSubmarineSwap({ swapId: 'swap-123' });

      expect(result.txHash).toBeDefined();
      expect(mockRefundService.refundSubmarineSwap).toHaveBeenCalled();
    });

    it('should throw if swap not found', async () => {
      await expect(service.refundSubmarineSwap({ swapId: 'non-existent' })).rejects.toThrow('Swap non-existent not found');
    });
  });

  describe('recoverPendingSwaps', () => {
    it('should recover swaps from storage', async () => {
      const swapData: SubmarineSwapData = {
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
      };

      mockStorage.loadAll.mockResolvedValueOnce([swapData]);

      const swaps = await service.recoverPendingSwaps();

      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
      expect(mockWebSocket.subscribeToSwap).toHaveBeenCalled();
    });

    it('should return empty array if no storage', async () => {
      const serviceNoStorage = new SubmarineSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const swaps = await serviceNoStorage.recoverPendingSwaps();
      expect(swaps).toEqual([]);
    });

    it('should filter for submarine swaps only', async () => {
      const submarineSwap: SubmarineSwapData = {
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
      };

      const otherSwap = { id: 'other-swap', type: 'chain' };

      mockStorage.loadAll.mockResolvedValueOnce([submarineSwap, otherSwap]);

      const swaps = await service.recoverPendingSwaps();

      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
    });
  });

  describe('getActiveSwaps', () => {
    it('should return all active swaps', () => {
      const swapData: SubmarineSwapData = {
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
      };

      service['activeSwaps'].set('swap-123', swapData);

      const swaps = service.getActiveSwaps();
      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
    });
  });

  describe('getSwap', () => {
    it('should get swap by ID', () => {
      const swapData: SubmarineSwapData = {
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
      };

      service['activeSwaps'].set('swap-123', swapData);

      const swap = service.getSwap('swap-123');
      expect(swap).toBeDefined();
      expect(swap?.id).toBe('swap-123');
    });

    it('should return undefined if swap not found', () => {
      const swap = service.getSwap('non-existent');
      expect(swap).toBeUndefined();
    });
  });

  describe('deleteAllSwaps', () => {
    it('should delete all submarine swaps', async () => {
      const swapData: SubmarineSwapData = {
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
      };

      mockStorage.loadAll.mockResolvedValueOnce([swapData]);
      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.deleteAllSwaps();

      expect(result.count).toBe(1);
      expect(mockStorage.delete).toHaveBeenCalledWith('swap-123');
      expect(service['activeSwaps'].size).toBe(0);
    });

    it('should return count 0 if no storage', async () => {
      const serviceNoStorage = new SubmarineSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const result = await serviceNoStorage.deleteAllSwaps();
      expect(result.count).toBe(0);
    });
  });

  describe('deleteSwap', () => {
    it('should delete a single swap', async () => {
      const swapData: SubmarineSwapData = {
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
      };

      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.deleteSwap('swap-123');

      expect(result).toBe(true);
      expect(mockStorage.delete).toHaveBeenCalledWith('swap-123');
      expect(service['activeSwaps'].has('swap-123')).toBe(false);
    });

    it('should return false if no storage', async () => {
      const serviceNoStorage = new SubmarineSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const result = await serviceNoStorage.deleteSwap('swap-123');
      expect(result).toBe(false);
    });
  });
});

