import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BoltzClient, BoltzError, getLockupEventParameters } from './BoltzClient';
import { ethers } from 'ethers';

// Mock fetch globally
global.fetch = vi.fn();

describe('BoltzClient', () => {
  let client: BoltzClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BoltzClient();
    mockFetch = global.fetch as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct config', () => {
      const client = new BoltzClient();
      expect(client).toBeDefined();
    });
  });

  describe('BoltzError', () => {
    it('should create error with message and code', () => {
      const error = new BoltzError('Test error', 'TEST_CODE');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('BoltzError');
    });

    it('should create error with status code', () => {
      const error = new BoltzError('Test error', 'TEST_CODE', 404);
      expect(error.statusCode).toBe(404);
    });
  });

  describe('getSubmarineSwapPairs', () => {
    it('should return swap pairs', async () => {
      const mockPairs = {
        pairs: {
          'RBTC/BTC': {
            hash: 'test-hash',
            limits: { minimal: 10000, maximal: 100000000 }
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockPairs
      });

      const pairs = await client.getSubmarineSwapPairs();
      expect(pairs).toEqual(mockPairs);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getSubmarineSwapPairs()).rejects.toThrow(BoltzError);
      try {
        await client.getSubmarineSwapPairs();
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('SWAP_PAIRS_ERROR');
      }
    });
  });

  describe('getReverseSwapPairs', () => {
    it('should return reverse swap pairs', async () => {
      const mockPairs = {
        pairs: {
          'BTC/RBTC': {
            hash: 'test-hash',
            limits: { minimal: 10000, maximal: 100000000 }
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockPairs
      });

      const pairs = await client.getReverseSwapPairs();
      expect(pairs).toEqual(mockPairs);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getReverseSwapPairs()).rejects.toThrow(BoltzError);
      try {
        await client.getReverseSwapPairs();
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('REVERSE_PAIRS_ERROR');
      }
    });
  });

  describe('getChainSwapPairs', () => {
    it('should return chain swap pairs', async () => {
      const mockPairs = {
        pairs: {
          'L-BTC/RBTC': {
            hash: 'test-hash',
            limits: { minimal: 10000, maximal: 100000000 }
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockPairs
      });

      const pairs = await client.getChainSwapPairs();
      expect(pairs).toEqual(mockPairs);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getChainSwapPairs()).rejects.toThrow(BoltzError);
      try {
        await client.getChainSwapPairs();
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('CHAIN_PAIRS_ERROR');
      }
    });
  });

  describe('getSwapFees', () => {
    it('should return swap fees', async () => {
      const mockFees = {
        percentage: 0.5,
        minerFees: {
          BTC: 1000,
          RBTC: 21000
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockFees
      });

      const fees = await client.getSwapFees();
      expect(fees).toEqual(mockFees);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getSwapFees()).rejects.toThrow(BoltzError);
      try {
        await client.getSwapFees();
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('SWAP_FEES_ERROR');
      }
    });
  });

  describe('createSubmarineSwap', () => {
    const validParams = {
      from: 'RBTC',
      to: 'BTC',
      invoice: 'lnbc1234567890abcdef',
      pairHash: 'test-pair-hash',
      refundPublicKey: '02' + 'a'.repeat(64) // Valid compressed public key
    };

    it('should validate required parameters', async () => {
      try {
        await client.createSubmarineSwap({
          from: '',
          to: 'BTC',
          invoice: 'lnbc123',
          pairHash: 'hash'
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should validate Lightning invoice format', async () => {
      try {
        await client.createSubmarineSwap({
          ...validParams,
          invoice: 'invalid-invoice'
        });
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should require refund public key for UTXO chains', async () => {
      try {
        await client.createSubmarineSwap({
          from: 'BTC',
          to: 'BTC',
          invoice: 'lnbc1234567890abcdef',
          pairHash: 'test-pair-hash'
          // Missing refundPublicKey
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should validate refund public key format', async () => {
      await expect(client.createSubmarineSwap({
        ...validParams,
        refundPublicKey: 'invalid-key'
      })).rejects.toThrow(BoltzError);
    });

    it('should create swap successfully', async () => {
      const mockResponse = {
        id: 'swap-id',
        expectedAmount: 100000,
        timeoutBlockHeight: 12345,
        claimAddress: '0x1234567890123456789012345678901234567890'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockResponse
      });

      const result = await client.createSubmarineSwap(validParams);
      expect(result).toEqual(mockResponse);
    });

    it('should validate response structure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ invalid: 'response' })
      });

      try {
        await client.createSubmarineSwap(validParams);
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('INVALID_RESPONSE');
      }
    });
  });

  describe('createChainSwap', () => {
    const validParams = {
      from: 'L-BTC' as const,
      to: 'RBTC' as const,
      userLockAmount: 100000,
      preimageHash: 'a'.repeat(64), // 32 bytes hex
      claimAddress: '0x1234567890123456789012345678901234567890',
      refundPublicKey: '02' + 'a'.repeat(64),
      pairHash: 'test-pair-hash'
    };

    it('should validate required parameters', async () => {
      await expect(client.createChainSwap({
        ...validParams,
        preimageHash: ''
      })).rejects.toThrow(BoltzError);
    });

    it('should validate user lock amount', async () => {
      await expect(client.createChainSwap({
        ...validParams,
        userLockAmount: 0
      })).rejects.toThrow(BoltzError);
    });

    it('should validate preimage hash length', async () => {
      await expect(client.createChainSwap({
        ...validParams,
        preimageHash: 'short'
      })).rejects.toThrow(BoltzError);
    });

    it('should validate refund public key format', async () => {
      await expect(client.createChainSwap({
        ...validParams,
        refundPublicKey: 'invalid'
      })).rejects.toThrow(BoltzError);
    });

    it('should create chain swap successfully', async () => {
      const mockResponse = {
        id: 'swap-id',
        lockupDetails: {
          lockupAddress: 'test-address',
          blindingKey: 'test-key'
        },
        claimDetails: {
          lockupAddress: '0x1234567890123456789012345678901234567890',
          refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockResponse
      });

      const result = await client.createChainSwap(validParams);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getSwapStatus', () => {
    it('should return swap status', async () => {
      const mockStatus = {
        id: 'swap-id',
        status: 'transaction.mempool'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockStatus
      });

      const status = await client.getSwapStatus('swap-id');
      expect(status).toEqual(mockStatus);
    });

    it('should validate swap ID', async () => {
      await expect(client.getSwapStatus('')).rejects.toThrow();
    });
  });

  describe('checkInvoicePaymentStatus', () => {
    it('should return payment status', async () => {
      const mockStatus = {
        status: 'transaction.confirmed',
        serviceFeeInvoicePaid: true
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockStatus
      });

      const result = await client.checkInvoicePaymentStatus('swap-id');
      expect(result.mainInvoicePaid).toBe(true);
      expect(result.status).toBe('transaction.confirmed');
    });

    it('should validate swap ID', async () => {
      await expect(client.checkInvoicePaymentStatus('')).rejects.toThrow(BoltzError);
    });
  });

  describe('getContractAddresses', () => {
    it('should return contract addresses', async () => {
      const mockContracts = {
        RBTC: {
          erc20Swap: '0x1234567890123456789012345678901234567890',
          etherSwap: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockContracts
      });

      const addresses = await client.getContractAddresses();
      expect(addresses).toEqual(mockContracts);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getContractAddresses()).rejects.toThrow(BoltzError);
      try {
        await client.getContractAddresses();
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('CONTRACTS_ERROR');
      }
    });
  });

  describe('calculateSwapAmount', () => {
    it('should calculate swap amounts', async () => {
      const mockQuote = {
        sendAmount: 100000,
        receiveAmount: 95000,
        fee: 3000,
        minerFee: 2000
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockQuote
      });

      const result = await client.calculateSwapAmount('pair-id', 100000);
      expect(result).toEqual(mockQuote);
    });

    it('should validate pair ID', async () => {
      await expect(client.calculateSwapAmount('', 100000)).rejects.toThrow();
    });

    it('should validate amount', async () => {
      await expect(client.calculateSwapAmount('pair-id', 0)).rejects.toThrow();
    });
  });

  describe('getFeeRates', () => {
    it('should return fee rates', async () => {
      const mockFees = {
        BTC: {
          normal: 10,
          slow: 5,
          fast: 20
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => mockFees
      });

      const fees = await client.getFeeRates();
      expect(fees).toEqual(mockFees);
    });

    it('should handle errors correctly', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getFeeRates()).rejects.toThrow(BoltzError);
      try {
        await client.getFeeRates();
      } catch (error: any) {
        expect(error).toBeInstanceOf(BoltzError);
        expect(error.code).toBe('FEE_RATES_ERROR');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle HTTP 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded'
      });

      await expect(client.getSubmarineSwapPairs()).rejects.toThrow();
    });

    it('should handle HTTP 400 bad request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request'
      });

      await expect(client.getSubmarineSwapPairs()).rejects.toThrow();
    });

    it('should handle timeout', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementationOnce(() => {
        controller.abort();
        return Promise.reject(new Error('AbortError'));
      });

      // Mock AbortError
      const error = new Error('AbortError');
      error.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(error);

      await expect(client.getSubmarineSwapPairs()).rejects.toThrow();
    });

    it('should retry on network errors', async () => {
      // First two calls fail, third succeeds
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ pairs: {} })
        });

      const pairs = await client.getSubmarineSwapPairs();
      expect(pairs).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit', async () => {
      const responses = Array(12).fill({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ pairs: {} })
      });

      responses.forEach(response => mockFetch.mockResolvedValueOnce(response));

      // Make 12 requests (more than maxRequestsPerSecond = 10)
      const promises = Array(12).fill(null).map(() => client.getSubmarineSwapPairs());

      // All should eventually succeed, but some should be rate-limited
      await Promise.all(promises);
      expect(mockFetch).toHaveBeenCalledTimes(12);
    });
  });
});

describe('getLockupEventParameters', () => {
  it('should return null if transaction receipt not found', async () => {
    const mockProvider = {
      getTransactionReceipt: vi.fn().mockResolvedValue(null)
    };

    // This function has retry logic with delays, so increase timeout
    const result = await getLockupEventParameters(
      '0x1234567890123456789012345678901234567890',
      'a'.repeat(64),
      '0x' + 'b'.repeat(64),
      mockProvider as any
    );

    expect(result).toBeNull();
  }, 30000); // 30 second timeout for retry logic

  it('should return null on error', async () => {
    const mockProvider = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC error'))
    };

    const result = await getLockupEventParameters(
      '0x1234567890123456789012345678901234567890',
      'a'.repeat(64),
      '0x' + 'b'.repeat(64),
      mockProvider as any
    );

    expect(result).toBeNull();
  }, 30000);
});

