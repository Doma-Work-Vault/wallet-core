import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvmContractService } from '../../swaps/boltz/EvmContractService';
import { BoltzClient } from '../../swaps/boltz/BoltzClient';

// Mock BoltzClient
vi.mock('./BoltzClient', () => ({
  BoltzClient: vi.fn().mockImplementation(() => ({
    getContractAddresses: vi.fn(),
  })),
}));

// Mock ethers module
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    Contract: vi.fn(),
    Interface: vi.fn(),
  };
});

// Import ethers after mocks are set up
import * as ethers from 'ethers';

describe('EvmContractService', () => {
  let service: EvmContractService;
  let mockBoltzClient: any;
  let mockSigner: any;
  let mockProvider: any;
  let mockContract: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock BoltzClient
    mockBoltzClient = {
      getContractAddresses: vi.fn().mockResolvedValue({
        rsk: {
          swapContracts: {
            EtherSwap: '0x1234567890123456789012345678901234567890'
          }
        }
      }),
    };

    // Create mock provider
    mockProvider = {
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 RBTC
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt('60000000'), // 0.06 gwei
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        hash: '0x' + 'a'.repeat(64),
        logs: [],
      }),
    };

    // Create mock signer
    mockSigner = {
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
      provider: mockProvider,
    };

    // Create mock contract
    const lockMock = vi.fn();
    const claimMock = vi.fn();
    const refundMock = vi.fn();
    
    mockContract = {
      lock: lockMock,
      claim: claimMock,
      refund: refundMock,
      // Support bracket notation for explicit function signatures
      'lock(bytes32,address,uint256)': lockMock,
      'claim(bytes32,uint256,address,uint256)': claimMock,
      'refund(bytes32,uint256,address,uint256)': refundMock,
    };

    // Set up Contract mock to return our mock contract
    (ethers.Contract as any).mockImplementation(() => mockContract);

    service = new EvmContractService(mockBoltzClient);
  });

  describe('Constructor', () => {
    it('should accept BoltzClient', () => {
      const service = new EvmContractService(mockBoltzClient);
      expect(service).toBeDefined();
    });

    it('should create client if not provided', () => {
      const service = new EvmContractService();
      expect(service).toBeDefined();
      // BoltzClient is created internally
    });
  });

  describe('getEtherSwapAddress', () => {
    it('should return contract address', async () => {
      const address = await service.getEtherSwapAddress();
      expect(address).toBe('0x1234567890123456789012345678901234567890');
      expect(mockBoltzClient.getContractAddresses).toHaveBeenCalled();
    });

    it('should handle RBTC key', async () => {
      mockBoltzClient.getContractAddresses.mockResolvedValueOnce({
        RBTC: {
          swapContracts: {
            EtherSwap: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
          }
        }
      });

      const address = await service.getEtherSwapAddress();
      expect(address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });

    it('should handle errors', async () => {
      mockBoltzClient.getContractAddresses.mockRejectedValueOnce(new Error('API error'));

      await expect(service.getEtherSwapAddress()).rejects.toThrow('Failed to get EtherSwap contract address');
    });

    it('should throw if contract address not found', async () => {
      mockBoltzClient.getContractAddresses.mockResolvedValueOnce({
        rsk: {}
      });

      await expect(service.getEtherSwapAddress()).rejects.toThrow('EtherSwap contract address not found');
    });
  });

  describe('lockFunds', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimageHash: 'a'.repeat(64),
      claimAddress: '0x1234567890123456789012345678901234567890',
      timeoutBlockHeight: 12345,
      amountSats: 100000,
    });

    it('should validate signer', async () => {
      const validParams = getValidParams();
      await expect(service.lockFunds({
        ...validParams,
        signer: null as any
      })).rejects.toThrow('Signer is required');
    });

    it('should validate preimage hash length', async () => {
      const validParams = getValidParams();
      await expect(service.lockFunds({
        ...validParams,
        preimageHash: 'short'
      })).rejects.toThrow('Invalid preimage hash');
    });

    it('should validate claim address', async () => {
      const validParams = getValidParams();
      await expect(service.lockFunds({
        ...validParams,
        claimAddress: 'invalid-address'
      })).rejects.toThrow('Invalid claim address');
    });

    it('should validate timeout block height', async () => {
      const validParams = getValidParams();
      await expect(service.lockFunds({
        ...validParams,
        timeoutBlockHeight: 0
      })).rejects.toThrow('Invalid timeout block height');
    });

    it('should validate amount', async () => {
      const validParams = getValidParams();
      await expect(service.lockFunds({
        ...validParams,
        amountSats: 0
      })).rejects.toThrow('Invalid amount');
    });

    it('should lock funds successfully', async () => {
      const validParams = getValidParams();
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0x' + 'b'.repeat(64),
        }),
      };
      mockContract.lock.mockResolvedValue(mockTx);

      const result = await service.lockFunds(validParams);

      expect(result.txHash).toBe('0x' + 'b'.repeat(64));
      expect(result.contractAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(mockContract.lock).toHaveBeenCalled();
    });

    it('should handle preimage hash with 0x prefix', async () => {
      const validParams = getValidParams();
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0x' + 'b'.repeat(64),
        }),
      };
      mockContract.lock.mockResolvedValue(mockTx);

      await service.lockFunds({
        ...validParams,
        preimageHash: 'a'.repeat(64), // 64 hex chars, will add 0x prefix internally
      });

      expect(mockContract.lock).toHaveBeenCalledWith(
        '0x' + 'a'.repeat(64),
        validParams.claimAddress,
        validParams.timeoutBlockHeight,
        expect.objectContaining({
          value: expect.any(BigInt),
        })
      );
    });

    it('should handle errors', async () => {
      const validParams = getValidParams();
      mockContract.lock.mockRejectedValueOnce(new Error('Contract error'));

      await expect(service.lockFunds(validParams)).rejects.toThrow('Failed to lock funds');
    });
  });

  describe('claimFunds', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimage: 'b'.repeat(64),
      refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      timelock: 12345,
      amount: 100000,
    });

    it('should validate signer', async () => {
      const validParams = getValidParams();
      await expect(service.claimFunds({
        ...validParams,
        signer: null as any
      })).rejects.toThrow('Signer is required');
    });

    it('should validate preimage length', async () => {
      const validParams = getValidParams();
      await expect(service.claimFunds({
        ...validParams,
        preimage: 'short'
      })).rejects.toThrow('Invalid preimage');
    });

    it('should validate refund address', async () => {
      const validParams = getValidParams();
      await expect(service.claimFunds({
        ...validParams,
        refundAddress: 'invalid-address'
      })).rejects.toThrow('Invalid refund address');
    });

    it('should validate timelock', async () => {
      const validParams = getValidParams();
      await expect(service.claimFunds({
        ...validParams,
        timelock: 0
      })).rejects.toThrow('Invalid timelock');
    });

    it('should validate amount', async () => {
      const validParams = getValidParams();
      await expect(service.claimFunds({
        ...validParams,
        amount: 0
      })).rejects.toThrow('Invalid amount');
    });

    it('should claim funds successfully', async () => {
      const validParams = getValidParams();
      const OriginalContract = ethers.Contract;
      Object.defineProperty(ethers, 'Contract', {
        value: vi.fn().mockImplementation(() => mockContract),
        writable: true,
        configurable: true,
      });

      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0x' + 'c'.repeat(64),
        }),
      };
      mockContract.claim.mockResolvedValue(mockTx);

      const result = await service.claimFunds(validParams);

      expect(result.txHash).toBe('0x' + 'c'.repeat(64));
      expect(mockContract.claim).toHaveBeenCalled();

      // Restore
      Object.defineProperty(ethers, 'Contract', {
        value: OriginalContract,
        writable: true,
        configurable: true,
      });
    });

    it('should handle "no Ether locked" error', async () => {
      const validParams = getValidParams();
      const error = new Error('swap has no Ether locked');
      mockContract.claim.mockRejectedValueOnce(error);

      await expect(service.claimFunds(validParams)).rejects.toThrow('Failed to claim funds');
    });

    it('should handle errors', async () => {
      const validParams = getValidParams();
      mockContract.claim.mockRejectedValueOnce(new Error('Contract error'));

      await expect(service.claimFunds(validParams)).rejects.toThrow('Failed to claim funds');
    });
  });

  describe('refundFunds', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimageHash: 'c'.repeat(64),
      claimAddress: '0x1234567890123456789012345678901234567890',
      timelock: 12345,
      amount: 100000,
    });

    it('should validate signer', async () => {
      const validParams = getValidParams();
      await expect(service.refundFunds({
        ...validParams,
        signer: null as any
      })).rejects.toThrow('Signer is required');
    });

    it('should validate preimage hash length', async () => {
      const validParams = getValidParams();
      await expect(service.refundFunds({
        ...validParams,
        preimageHash: 'short'
      })).rejects.toThrow('Invalid preimage hash');
    });

    it('should validate claim address', async () => {
      const validParams = getValidParams();
      await expect(service.refundFunds({
        ...validParams,
        claimAddress: 'invalid-address'
      })).rejects.toThrow('Invalid claim address');
    });

    it('should validate timelock', async () => {
      const validParams = getValidParams();
      await expect(service.refundFunds({
        ...validParams,
        timelock: 0
      })).rejects.toThrow('Invalid timelock');
    });

    it('should validate amount', async () => {
      const validParams = getValidParams();
      await expect(service.refundFunds({
        ...validParams,
        amount: 0
      })).rejects.toThrow('Invalid amount');
    });

    it('should refund funds successfully', async () => {
      const validParams = getValidParams();
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0x' + 'd'.repeat(64),
        }),
      };
      mockContract.refund.mockResolvedValue(mockTx);

      const result = await service.refundFunds(validParams);

      expect(result.txHash).toBe('0x' + 'd'.repeat(64));
      expect(mockContract.refund).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const validParams = getValidParams();
      mockContract.refund.mockRejectedValueOnce(new Error('Contract error'));

      await expect(service.refundFunds(validParams)).rejects.toThrow('Failed to refund funds');
    });
  });

  describe('getLockupEventParameters', () => {
    const preimageHash = 'a'.repeat(64);
    const lockupTxHash = '0x' + 'e'.repeat(64);

    it('should return null if receipt not found', async () => {
      mockProvider.getTransactionReceipt.mockResolvedValue(null);

      const result = await service.getLockupEventParameters(
        preimageHash,
        lockupTxHash,
        mockProvider as any
      );

      expect(result).toBeNull();
    }, 30000); // Increased timeout for retry logic

    it('should return null on error', async () => {
      mockProvider.getTransactionReceipt.mockRejectedValue(new Error('RPC error'));

      const result = await service.getLockupEventParameters(
        preimageHash,
        lockupTxHash,
        mockProvider as any
      );

      expect(result).toBeNull();
    }, 30000);

    it('should parse lockup event correctly', async () => {
      // Mock Interface.parseLog
      const mockParsedLog = {
        name: 'Lockup',
        args: [
          '0x' + 'a'.repeat(64),
          BigInt('1000000000000000000'),
          '0x1234567890123456789012345678901234567890',
          '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          BigInt('12345'),
        ],
      };

      const mockInterface = {
        parseLog: vi.fn().mockReturnValue(mockParsedLog),
      };

      (ethers.Interface as any).mockImplementation(() => mockInterface);

      mockProvider.getTransactionReceipt.mockResolvedValue({
        hash: lockupTxHash,
        logs: [{
          address: '0x1234567890123456789012345678901234567890',
          topics: ['0x' + 'f'.repeat(64)],
          data: '0x' + '0'.repeat(64),
        }],
      });

      const result = await service.getLockupEventParameters(
        preimageHash,
        lockupTxHash,
        mockProvider as any
      );

      expect(result).not.toBeNull();
      expect(result?.amount).toBe(BigInt('1000000000000000000'));
      expect(result?.claimAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(result?.refundAddress).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
      expect(result?.timelock).toBe(12345);
    }, 30000);

    it('should return null if no matching event found', async () => {
      const mockInterface = {
        parseLog: vi.fn().mockReturnValue(null),
      };

      (ethers.Interface as any).mockImplementation(() => mockInterface);

      mockProvider.getTransactionReceipt.mockResolvedValue({
        hash: lockupTxHash,
        logs: [{
          address: '0x1234567890123456789012345678901234567890',
          topics: ['0x' + 'f'.repeat(64)],
          data: '0x' + '0'.repeat(64),
        }],
      });

      const result = await service.getLockupEventParameters(
        preimageHash,
        lockupTxHash,
        mockProvider as any
      );

      expect(result).toBeNull();
    }, 30000);
  });

  describe('estimateLockupGas', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimageHash: 'a'.repeat(64),
      claimAddress: '0x1234567890123456789012345678901234567890',
      timeoutBlockHeight: 12345,
      amountSats: 100000,
    });

    it('should return gas estimate', async () => {
      const validParams = getValidParams();
      const estimateGasMock = vi.fn().mockResolvedValue(BigInt('100000'));
      (ethers.Contract as any).mockImplementation(() => ({
        lock: {
          estimateGas: estimateGasMock,
        },
        'lock(bytes32,address,uint256)': {
          estimateGas: estimateGasMock,
        },
      }));

      const estimate = await service.estimateLockupGas(validParams);

      expect(typeof estimate).toBe('bigint');
      expect(estimate).toBeGreaterThan(BigInt(0));
    });

    it('should return conservative estimate on error', async () => {
      const validParams = getValidParams();
      const estimateGasMock = vi.fn().mockRejectedValue(new Error('Estimation failed'));
      (ethers.Contract as any).mockImplementation(() => ({
        lock: {
          estimateGas: estimateGasMock,
        },
        'lock(bytes32,address,uint256)': {
          estimateGas: estimateGasMock,
        },
      }));

      const estimate = await service.estimateLockupGas(validParams);

      expect(estimate).toBe(100000n * 60000000n);
    });
  });

  describe('estimateClaimGas', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimage: 'b'.repeat(64),
      refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      timelock: 12345,
      amount: 100000,
    });

    it('should return gas estimate', async () => {
      const validParams = getValidParams();
      const OriginalContract = ethers.Contract;
      Object.defineProperty(ethers, 'Contract', {
        value: vi.fn().mockImplementation(() => ({
          claim: {
            estimateGas: vi.fn().mockResolvedValue(BigInt('100000')),
          },
        })),
        writable: true,
        configurable: true,
      });

      const estimate = await service.estimateClaimGas(validParams);

      expect(typeof estimate).toBe('bigint');
      expect(estimate).toBeGreaterThan(BigInt(0));
    });

    it('should return conservative estimate on error', async () => {
      const validParams = getValidParams();
      (ethers.Contract as any).mockImplementation(() => ({
        claim: {
          estimateGas: vi.fn().mockRejectedValue(new Error('Estimation failed')),
        },
      }));

      const estimate = await service.estimateClaimGas(validParams);

      expect(estimate).toBe(100000n * 60000000n);
    });
  });

  describe('estimateRefundGas', () => {
    const getValidParams = () => ({
      signer: mockSigner,
      preimageHash: 'c'.repeat(64),
      claimAddress: '0x1234567890123456789012345678901234567890',
      timelock: 12345,
      amount: 100000,
    });

    it('should return gas estimate', async () => {
      const validParams = getValidParams();
      (ethers.Contract as any).mockImplementation(() => ({
        refund: {
          estimateGas: vi.fn().mockResolvedValue(BigInt('100000')),
        },
      }));

      const estimate = await service.estimateRefundGas(validParams);

      expect(typeof estimate).toBe('bigint');
      expect(estimate).toBeGreaterThan(BigInt(0));
    });

    it('should return conservative estimate on error', async () => {
      const validParams = getValidParams();
      (ethers.Contract as any).mockImplementation(() => ({
        refund: {
          estimateGas: vi.fn().mockRejectedValue(new Error('Estimation failed')),
        },
      }));

      const estimate = await service.estimateRefundGas(validParams);

      expect(estimate).toBe(100000n * 60000000n);
    });
  });

  describe('hasSufficientBalance', () => {
    it('should return true if balance is sufficient', async () => {
      mockProvider.getBalance.mockResolvedValue(BigInt('2000000000000000000')); // 2 RBTC

      const result = await service.hasSufficientBalance(mockSigner, 100000);

      expect(result).toBe(true);
    });

    it('should return false if balance is insufficient', async () => {
      // 100000 sats = 0.001 RBTC = 1000000000000000 wei (sats * 10^10)
      // Gas estimate = 100000 * 60000000 = 6000000000000 wei
      // Total required = 1006000000000000 wei
      // Set balance to less than required: 100000000000000 wei (0.0001 RBTC)
      mockProvider.getBalance.mockResolvedValue(BigInt('100000000000000')); // 0.0001 RBTC

      const result = await service.hasSufficientBalance(mockSigner, 100000);

      expect(result).toBe(false);
    });

    it('should include gas estimate in calculation', async () => {
      // Balance should cover amount + gas
      const amountWei = BigInt('100000000000000000'); // 0.1 RBTC
      const gasEstimate = BigInt('6000000000000000'); // ~0.006 RBTC
      const totalRequired = amountWei + gasEstimate;

      mockProvider.getBalance.mockResolvedValue(totalRequired);

      const result = await service.hasSufficientBalance(mockSigner, 10000000); // 0.1 BTC in sats

      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockProvider.getBalance.mockRejectedValue(new Error('RPC error'));

      const result = await service.hasSufficientBalance(mockSigner, 100000);

      expect(result).toBe(false);
    });

    it('should return false if balance is null', async () => {
      mockProvider.getBalance.mockResolvedValue(null);

      const result = await service.hasSufficientBalance(mockSigner, 100000);

      expect(result).toBe(false);
    });
  });
});

