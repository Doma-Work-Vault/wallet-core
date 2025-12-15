import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChainSwapService } from './ChainSwapService';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { EvmContractService } from './EvmContractService';
import { RifRelayClaimService } from './RifRelayClaimService';
import { ChainSwapRefundService } from './ChainSwapRefundService';
import type { SwapStorage, ChainSwapData, SwapEvent } from './types';
import * as ethers from 'ethers';

// Mock dependencies
vi.mock('./BoltzClient');
vi.mock('./WebSocketClient');
vi.mock('./EvmContractService');
vi.mock('./RifRelayClaimService', () => ({
  RifRelayClaimService: vi.fn().mockImplementation(() => ({
    claimViaRifRelay: vi.fn().mockResolvedValue('0x' + 'r'.repeat(64)),
    waitForConfirmation: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('./ChainSwapRefundService', () => ({
  ChainSwapRefundService: vi.fn().mockImplementation(() => ({
    isSwapRefundable: vi.fn().mockResolvedValue({ refundable: true }),
    refundChainSwap: vi.fn().mockResolvedValue({
      swapData: {} as ChainSwapData,
      txHash: '0x' + 'refund'.repeat(16),
    }),
  })),
}));
vi.mock('../rif/Signer', () => ({
  getSmartWalletAddress: vi.fn().mockResolvedValue({
    address: '0xSmartWallet123456789012345678901234567890',
  }),
}));
vi.mock('../../utils/networkConfig', () => ({
  isRifRelayAvailable: vi.fn().mockReturnValue(true),
  weiToSatoshi: vi.fn((wei: bigint) => Number(wei) / 1e10),
  getLiquidAssetId: vi.fn(() => '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d'),
}));

// Mock crypto and bitcoinjs-lib
vi.mock('crypto', () => ({
  randomBytes: vi.fn((size: number) => Buffer.from('a'.repeat(size))),
}));

vi.mock('bitcoinjs-lib', () => ({
  crypto: {
    sha256: vi.fn((data: Buffer) => Buffer.from('b'.repeat(64), 'hex')),
  },
}));

// Mock ecpair
vi.mock('ecpair', () => ({
  ECPairFactory: vi.fn(() => ({
    makeRandom: vi.fn(() => ({
      publicKey: Buffer.from('c'.repeat(33)),
      privateKey: Buffer.from('d'.repeat(32)),
    })),
  })),
}));

vi.mock('tiny-secp256k1', () => ({}));

describe('ChainSwapService', () => {
  let service: ChainSwapService;
  let mockBoltzClient: any;
  let mockWebSocket: any;
  let mockEvmContractService: any;
  let mockRifRelayService: any;
  let mockRefundService: any;
  let mockStorage: SwapStorage;
  let mockWallet: any;
  let mockSigner: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 RBTC
    };

    // Create mock signer
    const validAddress = '0x1234567890123456789012345678901234567890';
    mockSigner = {
      getAddress: vi.fn().mockResolvedValue(validAddress),
      provider: mockProvider,
      address: validAddress,
    };

    // Create mock wallet
    mockWallet = {
      address: validAddress,
      provider: mockProvider,
      getAddress: vi.fn().mockResolvedValue(validAddress),
    };

    // Create mock BoltzClient
    mockBoltzClient = {
      getChainSwapPairs: vi.fn().mockResolvedValue({
        'L-BTC': {
          RBTC: {
            limits: {
              minimal: 10000,
              maximal: 1000000000,
            },
            hash: 'pair-hash-123',
          },
        },
      }),
      createChainSwap: vi.fn().mockResolvedValue({
        id: 'swap-123',
        lockupDetails: {
          lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
          amount: 100000,
          blindingKey: 'blinding-key-123',
          timeoutBlockHeight: 100,
          swapTree: 'swap-tree-123',
          serverPublicKey: 'server-pubkey-123',
        },
        claimDetails: {
          amount: 100000,
          timeoutBlockHeight: 200,
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
      }),
    };

    // Create mock WebSocket
    mockWebSocket = {
      subscribeToSwap: vi.fn(),
    };

    // Create mock EvmContractService
    mockEvmContractService = {
      getEtherSwapAddress: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      estimateClaimGas: vi.fn().mockResolvedValue(BigInt('6000000000000')),
      getLockupEventParameters: vi.fn().mockResolvedValue({
        amount: BigInt('1000000000000000000'),
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timelock: 12345,
      }),
      claimFunds: vi.fn().mockResolvedValue({
        txHash: '0x' + 'c'.repeat(64),
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
    service = new ChainSwapService(
      mockWebSocket,
      mockBoltzClient,
      mockEvmContractService,
      mockStorage
    );

    // Get the service instances
    mockRifRelayService = (service as any).rifRelayService;
    mockRefundService = (service as any).refundService;
    if (mockRifRelayService) {
      vi.spyOn(mockRifRelayService, 'claimViaRifRelay').mockResolvedValue('0x' + 'r'.repeat(64));
      vi.spyOn(mockRifRelayService, 'waitForConfirmation').mockResolvedValue(undefined);
    }
  });

  describe('Constructor', () => {
    it('should accept dependencies', () => {
      const service = new ChainSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService,
        mockStorage
      );
      expect(service).toBeDefined();
    });

    it('should work without storage', () => {
      const service = new ChainSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );
      expect(service).toBeDefined();
    });
  });

  describe('setWalletGetter', () => {
    it('should set wallet getter', () => {
      const getter = vi.fn().mockReturnValue(mockWallet);
      service.setWalletGetter(getter);
      expect(service).toBeDefined();
    });
  });

  describe('getSwapLimits', () => {
    it('should return swap limits', async () => {
      const limits = await service.getSwapLimits();
      expect(limits.minimal).toBe(10000);
      expect(limits.maximal).toBe(1000000000);
      expect(mockBoltzClient.getChainSwapPairs).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockBoltzClient.getChainSwapPairs.mockRejectedValueOnce(new Error('API error'));
      await expect(service.getSwapLimits()).rejects.toThrow('API error');
    });

    it('should throw if limits not found', async () => {
      mockBoltzClient.getChainSwapPairs.mockResolvedValueOnce({});
      await expect(service.getSwapLimits()).rejects.toThrow('Chain swap pair limits not available');
    });
  });

  describe('createChainSwap', () => {
    const validParams = {
      amountSats: 100000,
      rbtcAddress: '0x1234567890123456789012345678901234567890',
    };

    it('should validate RBTC address', async () => {
      await expect(service.createChainSwap({
        ...validParams,
        rbtcAddress: 'invalid-address',
      })).rejects.toThrow('Invalid RBTC address format');
    });

    it('should validate amount against limits', async () => {
      await expect(service.createChainSwap({
        ...validParams,
        amountSats: 5, // Below minimum
      })).rejects.toThrow('Amount too small');
    });

    it('should create swap successfully', async () => {
      const result = await service.createChainSwap(validParams);

      expect(result.swapId).toBe('swap-123');
      expect(result.liquidUri).toContain('liquidnetwork:');
      expect(result.swapData.id).toBe('swap-123');
      expect(result.swapData.status).toBe('swap.created');
      expect(result.swapData.type).toBe('chain');
      expect(mockStorage.save).toHaveBeenCalled();
      expect(mockWebSocket.subscribeToSwap).toHaveBeenCalled();
    });

    it('should use Smart Wallet if user has no gas', async () => {
      mockProvider.getBalance.mockResolvedValueOnce(BigInt('1000000')); // Very low balance

      const result = await service.createChainSwap({
        ...validParams,
        walletSigner: mockSigner,
      });

      expect(result.swapData.claimAddress).toBe('0xSmartWallet123456789012345678901234567890');
      expect(result.swapData.rifRelayUsed).toBe(true);
    });

    it('should use wallet address if user has gas', async () => {
      mockProvider.getBalance.mockResolvedValueOnce(BigInt('1000000000000000000')); // 1 RBTC

      const result = await service.createChainSwap({
        ...validParams,
        walletSigner: mockSigner,
      });

      expect(result.swapData.claimAddress).toBe(validParams.rbtcAddress);
      expect(result.swapData.rifRelayUsed).toBe(false);
    });

    it('should generate refund key', async () => {
      const result = await service.createChainSwap(validParams);

      expect(result.swapData.refundPublicKey).toBeDefined();
      expect(result.swapData.refundPrivateKey).toBeDefined();
    });
  });

  describe('handleSwapUpdate', () => {
    let swapData: ChainSwapData;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };
      service['activeSwaps'].set('swap-123', swapData);
      service['claimingSwaps'].clear();
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

    it('should update status to transaction.server.confirmed and attempt claim', async () => {
      service.setWalletGetter(() => mockWallet);
      swapData.claimAddress = swapData.rbtcAddress;
      swapData.rifRelayUsed = false;
      
      mockEvmContractService.claimFunds.mockResolvedValueOnce({
        txHash: '0x' + 'c'.repeat(64),
      });

      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.server.confirmed',
        transaction: {
          id: '0x' + 's'.repeat(64),
        },
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.serverLockupTxHash).toBe('0x' + 's'.repeat(64));
      expect(mockEvmContractService.claimFunds).toHaveBeenCalled();
    });

    it('should update status to transaction.claimed', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.claimed',
        transaction: {
          id: '0x' + 'c'.repeat(64),
        },
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.claimed');
      expect(swapData.claimTxHash).toBe('0x' + 'c'.repeat(64));
    });

    it('should handle swap failures', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.failed',
        failureReason: 'Swap failed',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.failed');
    });
  });

  describe('recoverPendingSwaps', () => {
    it('should recover swaps from storage', async () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      mockStorage.loadAll.mockResolvedValueOnce([swapData]);

      const swaps = await service.recoverPendingSwaps();

      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
      expect(mockWebSocket.subscribeToSwap).toHaveBeenCalled();
    });

    it('should return empty array if no storage', async () => {
      const serviceNoStorage = new ChainSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const swaps = await serviceNoStorage.recoverPendingSwaps();
      expect(swaps).toEqual([]);
    });

    it('should filter for chain swaps only', async () => {
      const chainSwap: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      const otherSwap = { id: 'other-swap', type: 'submarine' };

      mockStorage.loadAll.mockResolvedValueOnce([chainSwap, otherSwap]);

      const swaps = await service.recoverPendingSwaps();

      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
    });
  });

  describe('getActiveSwaps', () => {
    it('should return all active swaps', () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      service['activeSwaps'].set('swap-123', swapData);

      const swaps = service.getActiveSwaps();
      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
    });
  });

  describe('getSwap', () => {
    it('should get swap by ID', () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
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
    it('should delete all chain swaps', async () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      mockStorage.loadAll.mockResolvedValueOnce([swapData]);
      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.deleteAllSwaps();

      expect(result.count).toBe(1);
      expect(mockStorage.delete).toHaveBeenCalledWith('swap-123');
      expect(service['activeSwaps'].size).toBe(0);
    });

    it('should return count 0 if no storage', async () => {
      const serviceNoStorage = new ChainSwapService(
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
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.deleteSwap('swap-123');

      expect(result).toBe(true);
      expect(mockStorage.delete).toHaveBeenCalledWith('swap-123');
      expect(service['activeSwaps'].has('swap-123')).toBe(false);
    });

    it('should return false if no storage', async () => {
      const serviceNoStorage = new ChainSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const result = await serviceNoStorage.deleteSwap('swap-123');
      expect(result).toBe(false);
    });
  });

  describe('isSwapRefundable', () => {
    it('should check if swap is refundable', async () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      const result = await service.isSwapRefundable(swapData);

      expect(result.refundable).toBe(true);
      expect(mockRefundService.isSwapRefundable).toHaveBeenCalledWith(swapData);
    });
  });

  describe('refundChainSwap', () => {
    it('should refund a chain swap', async () => {
      const swapData: ChainSwapData = {
        id: 'swap-123',
        type: 'chain',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        fromAsset: 'L-BTC',
        fromAmount: 100000,
        lockupAddress: 'VJLKJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
        blindingKey: 'blinding-key-123',
        liquidUri: 'liquidnetwork:...',
        lockupTimeoutBlockHeight: 100,
        swapTree: 'swap-tree-123',
        serverPublicKey: 'server-pubkey-123',
        refundPublicKey: 'refund-pubkey-123',
        refundPrivateKey: 'refund-privkey-123',
        toAsset: 'RBTC',
        toAmount: 100000,
        rbtcAddress: '0x1234567890123456789012345678901234567890',
        claimAddress: '0x1234567890123456789012345678901234567890',
        claimTimeoutBlockHeight: 200,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'swap.created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      service['activeSwaps'].set('swap-123', swapData);

      const result = await service.refundChainSwap({ swapId: 'swap-123' });

      expect(result.txHash).toBeDefined();
      expect(mockRefundService.refundChainSwap).toHaveBeenCalled();
    });

    it('should throw if swap not found', async () => {
      await expect(service.refundChainSwap({ swapId: 'non-existent' })).rejects.toThrow('Swap non-existent not found');
    });
  });
});

