import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReverseSwapService } from './ReverseSwapService';
import { BoltzClient } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { EvmContractService } from './EvmContractService';
import { RifRelayClaimService } from './RifRelayClaimService';
import type { SwapStorage, BoltzSwapData, SwapEvent } from './types';
import * as ethers from 'ethers';

// Note: ethers.isAddress is used directly, so we need to ensure it works
// The actual ethers module will be imported and used

// Mock dependencies
vi.mock('./BoltzClient');
vi.mock('./WebSocketClient');
vi.mock('./EvmContractService');
vi.mock('./RifRelayClaimService');
vi.mock('../rif/Signer', () => ({
  getSmartWalletAddress: vi.fn().mockResolvedValue({
    address: '0xSmartWallet123456789012345678901234567890',
  }),
}));
vi.mock('../../utils/networkConfig', () => ({
  isRifRelayAvailable: vi.fn().mockReturnValue(true),
  weiToSatoshi: vi.fn((wei: bigint) => Number(wei) / 1e10),
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

// Mock fetch
global.fetch = vi.fn();

describe('ReverseSwapService', () => {
  let service: ReverseSwapService;
  let mockBoltzClient: any;
  let mockWebSocket: any;
  let mockEvmContractService: any;
  let mockRifRelayService: any;
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
    mockSigner = {
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
      provider: mockProvider,
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    // Create mock wallet
    mockWallet = {
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      provider: mockProvider,
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
    };

    // Create mock BoltzClient
    mockBoltzClient = {
      getReverseSwapPairs: vi.fn().mockResolvedValue({
        BTC: {
          RBTC: {
            limits: {
              minimal: 10000,
              maximal: 1000000000,
            },
          },
        },
      }),
      getSwapStatus: vi.fn().mockResolvedValue({
        status: 'swap.created',
      }),
      checkInvoicePaymentStatus: vi.fn().mockResolvedValue({
        mainInvoicePaid: false,
        status: 'swap.created',
      }),
      config: {
        boltzApiUrl: 'https://api.testnet.boltz.exchange',
      },
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

    // Create mock RifRelayClaimService
    // The mock is set up at module level, so we can access it via the service instance
    mockRifRelayService = {
      claimViaRifRelay: vi.fn().mockResolvedValue('0x' + 'r'.repeat(64)),
      waitForConfirmation: vi.fn().mockResolvedValue(undefined),
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
    service = new ReverseSwapService(
      mockWebSocket,
      mockBoltzClient,
      mockEvmContractService,
      mockStorage
    );
    
    // Get the RifRelayService instance from the service and spy on its methods
    mockRifRelayService = (service as any).rifRelayService;
    if (mockRifRelayService) {
      vi.spyOn(mockRifRelayService, 'claimViaRifRelay').mockResolvedValue('0x' + 'r'.repeat(64));
      vi.spyOn(mockRifRelayService, 'waitForConfirmation').mockResolvedValue(undefined);
    }
  });

  describe('Constructor', () => {
    it('should accept dependencies', () => {
      const service = new ReverseSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService,
        mockStorage
      );
      expect(service).toBeDefined();
    });

    it('should work without storage', () => {
      const service = new ReverseSwapService(
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
      expect(mockBoltzClient.getReverseSwapPairs).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockBoltzClient.getReverseSwapPairs.mockRejectedValueOnce(new Error('API error'));
      await expect(service.getSwapLimits()).rejects.toThrow('API error');
    });

    it('should throw if limits not found', async () => {
      mockBoltzClient.getReverseSwapPairs.mockResolvedValueOnce({});
      await expect(service.getSwapLimits()).rejects.toThrow('Reverse swap pair limits not available');
    });
  });

  describe('createReverseSwap', () => {
    const validParams = {
      amountSats: 100000,
      rbtcAddress: '0x1234567890123456789012345678901234567890', // Valid address
    };

    beforeEach(() => {
      // Reset fetch mock
      (global.fetch as any).mockClear();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'swap-123',
          invoice: 'lnbc1...',
          onchainAmount: 100000,
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          timeoutBlockHeight: 12345,
        }),
      });
    });

    it('should validate RBTC address', async () => {
      await expect(service.createReverseSwap({
        ...validParams,
        rbtcAddress: 'invalid-address',
      })).rejects.toThrow('Invalid RBTC address format');
    });

    it('should validate amount', async () => {
      // Don't need fetch mock since validation happens before API call
      await expect(service.createReverseSwap({
        ...validParams,
        amountSats: 0,
      })).rejects.toThrow('Amount must be greater than 0');
    });

    it('should validate amount against limits', async () => {
      // Don't need fetch mock since validation happens before API call
      await expect(service.createReverseSwap({
        ...validParams,
        amountSats: 5, // Below minimum
      })).rejects.toThrow('Amount too small');
    });

    it('should create swap successfully', async () => {
      // Reset fetch mock for this test
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'swap-123',
          invoice: 'lnbc1...',
          onchainAmount: 100000,
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          timeoutBlockHeight: 12345,
        }),
      });

      const result = await service.createReverseSwap(validParams);

      expect(result.swapId).toBe('swap-123');
      expect(result.invoice).toBe('lnbc1...');
      expect(result.swapData.id).toBe('swap-123');
      expect(result.swapData.status).toBe('swap.created');
      expect(mockStorage.save).toHaveBeenCalled();
      expect(mockWebSocket.subscribeToSwap).toHaveBeenCalled();
    });

    it('should use Smart Wallet if user has no gas', async () => {
      mockProvider.getBalance.mockResolvedValueOnce(BigInt('1000000')); // Very low balance
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'swap-123',
          invoice: 'lnbc1...',
          onchainAmount: 100000,
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          timeoutBlockHeight: 12345,
        }),
      });

      const result = await service.createReverseSwap({
        ...validParams,
        walletSigner: mockSigner,
      });

      expect(result.swapData.claimAddress).toBe('0xSmartWallet123456789012345678901234567890');
      expect(result.swapData.rifRelayUsed).toBe(true);
    });

    it('should use wallet address if user has gas', async () => {
      mockProvider.getBalance.mockResolvedValueOnce(BigInt('1000000000000000000')); // 1 RBTC
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'swap-123',
          invoice: 'lnbc1...',
          onchainAmount: 100000,
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          timeoutBlockHeight: 12345,
        }),
      });

      const result = await service.createReverseSwap({
        ...validParams,
        walletSigner: mockSigner,
      });

      expect(result.swapData.claimAddress).toBe(validParams.rbtcAddress);
      expect(result.swapData.rifRelayUsed).toBe(false);
    });

    it('should handle API errors', async () => {
      // Reset fetch mock completely
      (global.fetch as any).mockReset();
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue('Bad request'),
      });

      await expect(service.createReverseSwap(validParams)).rejects.toThrow('Failed to create reverse swap');
    });
  });

  describe('handleSwapUpdate', () => {
    let swapData: BoltzSwapData;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };
      service['activeSwaps'].set('swap-123', swapData);
    });

    it('should update status to invoice.set', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'invoice.set',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('invoice.set');
      expect(mockStorage.save).toHaveBeenCalled();
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

    it('should attempt claim on transaction.confirmed', async () => {
      // Ensure swapData is set up for direct claim (claimAddress === rbtcAddress)
      swapData.claimAddress = swapData.rbtcAddress;
      swapData.rifRelayUsed = false;
      
      // Create a fresh wallet for this test
      const testWallet = {
        address: swapData.rbtcAddress,
        provider: {
          getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
        },
        getAddress: vi.fn().mockResolvedValue(swapData.rbtcAddress),
      };
      
      service.setWalletGetter(() => testWallet);
      // Mock estimateClaimGas to return a value less than balance
      mockEvmContractService.estimateClaimGas.mockResolvedValueOnce(BigInt('500000000000000000'));
      // Mock claimFunds to succeed
      mockEvmContractService.claimFunds.mockResolvedValueOnce({
        txHash: '0x' + 'c'.repeat(64),
      });
      // Ensure swap is not already in claiming set
      service['claimingSwaps'].delete('swap-123');
      
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.confirmed',
        transaction: {
          id: '0x' + 't'.repeat(64),
        },
      };

      await service['handleSwapUpdate'](event);

      // Should attempt to estimate gas and claim
      expect(mockEvmContractService.estimateClaimGas).toHaveBeenCalled();
      // Claim should be attempted (either direct or RIF Relay)
      expect(mockEvmContractService.claimFunds).toHaveBeenCalled();
    });

    it('should not claim if wallet getter not set', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'transaction.confirmed',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('transaction.confirmed');
      expect(mockEvmContractService.claimFunds).not.toHaveBeenCalled();
    });

    it('should update status to invoice.settled', async () => {
      const event: SwapEvent = {
        swapId: 'swap-123',
        status: 'invoice.settled',
      };

      await service['handleSwapUpdate'](event);

      expect(swapData.status).toBe('invoice.settled');
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

  describe('claimRBTC', () => {
    let swapData: BoltzSwapData;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'transaction.confirmed',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
        lockupTxHash: '0x' + 't'.repeat(64),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };
    });

    it('should claim RBTC successfully', async () => {
      const result = await service.claimRBTC(swapData, mockSigner);

      expect(result.txHash).toBe('0x' + 'c'.repeat(64));
      expect(swapData.status).toBe('claimed');
      expect(swapData.claimTxHash).toBe('0x' + 'c'.repeat(64));
      expect(mockEvmContractService.claimFunds).toHaveBeenCalled();
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should use event parameters if available', async () => {
      await service.claimRBTC(swapData, mockSigner);

      expect(mockEvmContractService.getLockupEventParameters).toHaveBeenCalledWith(
        swapData.preimageHash,
        swapData.lockupTxHash,
        mockSigner.provider
      );
      expect(mockEvmContractService.claimFunds).toHaveBeenCalled();
    });

    it('should throw if already claimed', async () => {
      swapData.status = 'claimed';
      await expect(service.claimRBTC(swapData, mockSigner)).rejects.toThrow('Swap already claimed');
    });

    it('should throw if signer not provided', async () => {
      await expect(service.claimRBTC(swapData)).rejects.toThrow('RSK wallet not connected');
    });

    it('should throw if missing required data', async () => {
      delete swapData.preimage;
      await expect(service.claimRBTC(swapData, mockSigner)).rejects.toThrow('Missing required swap data');
    });

    it('should handle claim errors', async () => {
      mockEvmContractService.claimFunds.mockRejectedValueOnce(new Error('Claim failed'));
      await expect(service.claimRBTC(swapData, mockSigner)).rejects.toThrow('Claim failed');
      expect(swapData.status).toBe('transaction.claim.failed');
    });
  });

  describe('claimRBTCViaRifRelay', () => {
    let swapData: BoltzSwapData;

    beforeEach(() => {
      swapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0xSmartWallet123456789012345678901234567890',
        status: 'transaction.confirmed',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
        lockupTxHash: '0x' + 't'.repeat(64),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: true,
      };
    });

    it('should claim via RIF Relay successfully', async () => {
      // Get the RifRelayService instance and spy on it
      const rifRelayService = (service as any).rifRelayService;
      const claimSpy = vi.spyOn(rifRelayService, 'claimViaRifRelay').mockResolvedValue('0x' + 'r'.repeat(64));
      const waitSpy = vi.spyOn(rifRelayService, 'waitForConfirmation').mockResolvedValue(undefined);
      
      // Ensure provider is available
      mockSigner.provider = mockProvider;
      
      const result = await service.claimRBTCViaRifRelay(swapData, mockSigner);

      expect(result.txHash).toBe('0x' + 'r'.repeat(64));
      expect(swapData.status).toBe('claimed');
      expect(swapData.claimTxHash).toBe('0x' + 'r'.repeat(64));
      expect(claimSpy).toHaveBeenCalled();
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should throw if missing required data', async () => {
      delete swapData.preimage;
      await expect(service.claimRBTCViaRifRelay(swapData, mockSigner)).rejects.toThrow('Missing required swap data');
    });

    it('should handle errors', async () => {
      // Ensure mockRifRelayService is set up
      if (!mockRifRelayService) {
        mockRifRelayService = (service as any).rifRelayService;
      }
      vi.spyOn(mockRifRelayService, 'claimViaRifRelay').mockRejectedValueOnce(new Error('RIF Relay failed'));
      
      await expect(service.claimRBTCViaRifRelay(swapData, mockSigner)).rejects.toThrow();
      expect(swapData.status).toBe('transaction.claim.failed');
    });
  });

  describe('checkInvoicePaymentStatus', () => {
    it('should check invoice payment status', async () => {
      const result = await service.checkInvoicePaymentStatus('swap-123');
      expect(result.mainInvoicePaid).toBe(false);
      expect(result.status).toBe('swap.created');
      expect(mockBoltzClient.checkInvoicePaymentStatus).toHaveBeenCalledWith('swap-123');
    });
  });

  describe('updateSwapData', () => {
    it('should update swap data in storage', async () => {
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      await service.updateSwapData(swapData);
      expect(mockStorage.save).toHaveBeenCalledWith('swap-123', swapData);
    });
  });

  describe('recoverPendingSwaps', () => {
    it('should recover swaps from storage', async () => {
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
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
      const serviceNoStorage = new ReverseSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const swaps = await serviceNoStorage.recoverPendingSwaps();
      expect(swaps).toEqual([]);
    });
  });

  describe('getSwap', () => {
    it('should get swap by ID', () => {
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
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

  describe('getAllSwaps', () => {
    it('should return all active swaps', () => {
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        rifRelayUsed: false,
      };

      service['activeSwaps'].set('swap-123', swapData);

      const swaps = service.getAllSwaps();
      expect(swaps).toHaveLength(1);
      expect(swaps[0].id).toBe('swap-123');
    });
  });

  describe('checkSwapStatus', () => {
    it('should check swap status', async () => {
      const status = await service.checkSwapStatus('swap-123');
      expect(status).toBe('swap.created');
      expect(mockBoltzClient.getSwapStatus).toHaveBeenCalledWith('swap-123', true);
    });
  });

  describe('deleteAllSwaps', () => {
    it('should delete all swaps', async () => {
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
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
      const serviceNoStorage = new ReverseSwapService(
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
      const swapData: BoltzSwapData = {
        id: 'swap-123',
        preimage: 'a'.repeat(64),
        preimageHash: 'b'.repeat(64),
        invoice: 'lnbc1...',
        amount: 100000,
        rbtcAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb',
        claimAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'swap.created',
        onchainAmount: 100000,
        refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        timeoutBlockHeight: 12345,
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
      const serviceNoStorage = new ReverseSwapService(
        mockWebSocket,
        mockBoltzClient,
        mockEvmContractService
      );

      const result = await serviceNoStorage.deleteSwap('swap-123');
      expect(result).toBe(false);
    });
  });
});

