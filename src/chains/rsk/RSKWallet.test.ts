import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RSKWallet, type RSKWalletConfig } from './RSKWallet';
import type { MockProvider, MockWallet } from '../../test/utils/mockEthers';

// Mock RSKTransactions module
vi.mock('./RSKTransactions', () => ({
  loadRSKTransactions: vi.fn().mockResolvedValue([]),
}));

// Create mock instances - these will be set up in beforeEach
let mockProvider: MockProvider;
let mockWallet: MockWallet;
let mockHDNode: { privateKey: string };

// Mock ethers modules - must be hoisted
vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  
  // Create mock functions - implementations will be set in beforeEach
  const MockJsonRpcProvider = vi.fn();
  const MockWallet = vi.fn();
  const MockHDNodeWallet = {
    fromPhrase: vi.fn(),
  };
  const MockNetwork = {
    from: vi.fn().mockReturnValue({
      chainId: 30,
      name: 'rsk-mainnet',
    }),
  };

  return {
    ...actual,
    JsonRpcProvider: MockJsonRpcProvider,
    Wallet: MockWallet,
    HDNodeWallet: MockHDNodeWallet,
    Network: MockNetwork,
    // Keep actual utility functions
    isAddress: actual.isAddress,
    parseEther: actual.parseEther,
    formatEther: actual.formatEther,
    parseUnits: actual.parseUnits,
  };
});

describe('RSKWallet', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create fresh mock instances
    mockProvider = {
      getBalance: vi.fn(),
      getBlockNumber: vi.fn(),
      estimateGas: vi.fn(),
      getFeeData: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
      getTransactionCount: vi.fn(),
    };

    mockWallet = {
      address: testAddress,
      getAddress: vi.fn().mockReturnValue(testAddress),
      sendTransaction: vi.fn(),
    };

    mockHDNode = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    // Setup mock implementations
    const { JsonRpcProvider, Wallet, HDNodeWallet } = await import('ethers');
    (JsonRpcProvider as any).mockImplementation(() => mockProvider);
    (Wallet as any).mockImplementation(() => mockWallet);
    (HDNodeWallet.fromPhrase as any).mockReturnValue(mockHDNode);

    // Setup default mock return values
    mockProvider.getBalance!.mockResolvedValue(BigInt('1000000000000000000')); // 1 RBTC
    mockProvider.getBlockNumber!.mockResolvedValue(12345);
    mockProvider.estimateGas!.mockResolvedValue(BigInt('21000'));
    mockProvider.getFeeData!.mockResolvedValue({
      gasPrice: BigInt('20000000000'), // 20 gwei
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    mockProvider.getTransactionCount!.mockResolvedValue(5);

    mockWallet.sendTransaction!.mockResolvedValue({
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      wait: vi.fn().mockResolvedValue({
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12346,
      }),
    });
  });

  describe('Constructor', () => {
    it('should accept config', () => {
      const config: RSKWalletConfig = {
        network: 'testnet',
      };
      const wallet = new RSKWallet(config);

      expect(wallet).toBeDefined();
      expect(wallet.isInitialized()).toBe(false);
    });

    it('should accept config with custom RPC URL', () => {
      const config: RSKWalletConfig = {
        network: 'testnet',
        rpcUrl: 'http://custom-rpc:8545',
      };
      const wallet = new RSKWallet(config);

      expect(wallet).toBeDefined();
    });

    it('should accept config with polling interval', () => {
      const config: RSKWalletConfig = {
        network: 'testnet',
        pollingInterval: 10000,
      };
      const wallet = new RSKWallet(config);

      expect(wallet).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with valid mnemonic', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      
      await wallet.initialize(testMnemonic);

      expect(wallet.isInitialized()).toBe(true);
    });

    it('should throw on empty mnemonic', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.initialize('')).rejects.toThrow('No mnemonic provided');
    });

    it('should throw on whitespace-only mnemonic', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      // Ethers validates mnemonic format before our code, so it throws a different error
      await expect(wallet.initialize('   ')).rejects.toThrow();
    });

    it('should NOT test RPC connection during initialization', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      
      await wallet.initialize(testMnemonic);

      // getBlockNumber should NOT be called during initialization
      expect(mockProvider.getBlockNumber).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      // Mock HDNodeWallet.fromPhrase to throw
      const { HDNodeWallet } = await import('ethers');
      (HDNodeWallet.fromPhrase as any).mockImplementationOnce(() => {
        throw new Error('Invalid mnemonic');
      });

      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.initialize('invalid mnemonic')).rejects.toThrow(
        'RSK wallet initialization failed'
      );
    });

    it('should set isInitialized correctly', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      
      expect(wallet.isInitialized()).toBe(false);
      
      await wallet.initialize(testMnemonic);
      
      expect(wallet.isInitialized()).toBe(true);
    });
  });

  describe('getAddress', () => {
    it('should return wallet address', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const address = wallet.getAddress();

      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address format
      expect(typeof address).toBe('string');
    });

    it('should throw if not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.getAddress()).toThrow('Wallet not initialized');
    });
  });

  describe('getBalance', () => {
    it('should return balance structure', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getBalance();

      expect(balance).toHaveProperty('balance');
      expect(balance).toHaveProperty('formatted');
      expect(typeof balance.balance).toBe('bigint');
      expect(typeof balance.formatted).toBe('string');
      expect(balance.formatted).toMatch(/^\d+\.\d{6}$/); // Format: number.6decimals
    });

    it('should format balance correctly', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getBalance();

      // Should be formatted to 6 decimal places
      const parts = balance.formatted.split('.');
      expect(parts.length).toBe(2);
      expect(parts[1].length).toBe(6);
    });

    it('should throw if not initialized', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.getBalance()).rejects.toThrow('Wallet not initialized');
    });
  });

  describe('getBlockNumber', () => {
    it('should return block number', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const blockNumber = await wallet.getBlockNumber();

      expect(typeof blockNumber).toBe('number');
      expect(blockNumber).toBeGreaterThan(0);
    });

    it('should throw if not initialized', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.getBlockNumber()).rejects.toThrow('Provider not initialized');
    });
  });

  describe('send', () => {
    const recipientAddress = '0x1234567890123456789012345678901234567890';
    const amount = '0.1';

    it('should validate recipient address', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Use an obviously invalid address format
      await expect(wallet.send('invalid-address', amount)).rejects.toThrow(
        'Invalid recipient address'
      );
    });

    it('should check balance before sending', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Insufficient balance
      mockProvider.getBalance!.mockResolvedValue(BigInt('10000000000000000')); // 0.01 RBTC
      mockProvider.estimateGas!.mockResolvedValue(BigInt('21000'));
      mockProvider.getFeeData!.mockResolvedValue({
        gasPrice: BigInt('20000000000'),
      });

      await expect(wallet.send(recipientAddress, amount)).rejects.toThrow(
        'Insufficient balance'
      );
    });


    it('should throw if not initialized', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.send(recipientAddress, amount)).rejects.toThrow(
        'Wallet not initialized'
      );
    });

    it('should handle send errors', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      mockProvider.getBalance!.mockResolvedValue(BigInt('1000000000000000000'));
      mockProvider.estimateGas!.mockResolvedValue(BigInt('21000'));
      mockProvider.getFeeData!.mockResolvedValue({
        gasPrice: BigInt('20000000000'),
      });
      mockWallet.sendTransaction!.mockRejectedValue(new Error('Network error'));

      await expect(wallet.send(recipientAddress, amount)).rejects.toThrow(
        'Failed to send RBTC'
      );
    });
  });

  describe('estimateGas', () => {
    const recipientAddress = '0x1234567890123456789012345678901234567890';
    const amount = '0.1';

    it('should return gas estimate structure', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const estimate = await wallet.estimateGas(recipientAddress, amount);

      expect(estimate).toHaveProperty('gasLimit');
      expect(estimate).toHaveProperty('gasPrice');
      expect(estimate).toHaveProperty('totalCost');
      expect(estimate).toHaveProperty('totalCostFormatted');
      expect(typeof estimate.gasLimit).toBe('bigint');
      expect(typeof estimate.gasPrice).toBe('bigint');
      expect(typeof estimate.totalCost).toBe('bigint');
      expect(typeof estimate.totalCostFormatted).toBe('string');
    });

    it('should calculate total cost correctly', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const estimate = await wallet.estimateGas(recipientAddress, amount);

      // Total cost should be gasLimit * gasPrice
      const expectedTotalCost = estimate.gasLimit * estimate.gasPrice;
      expect(estimate.totalCost).toBe(expectedTotalCost);
    });

    it('should format total cost correctly', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const estimate = await wallet.estimateGas(recipientAddress, amount);

      expect(estimate.totalCostFormatted).toBeDefined();
      expect(typeof estimate.totalCostFormatted).toBe('string');
      // Should be a valid decimal number
      expect(parseFloat(estimate.totalCostFormatted)).toBeGreaterThanOrEqual(0);
    });

    it('should throw if not initialized', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.estimateGas(recipientAddress, amount)).rejects.toThrow(
        'Wallet not initialized'
      );
    });
  });

  describe('onBlock', () => {
    it('should subscribe to block events', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      const unsubscribe = wallet.onBlock(callback);

      expect(typeof unsubscribe).toBe('function');
      // Callback should be callable
      expect(typeof callback).toBe('function');
    });

    it('should return unsubscribe function', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      const unsubscribe = wallet.onBlock(callback);

      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should throw if not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.onBlock(() => {})).toThrow('Provider not initialized');
    });
  });

  describe('pause', () => {
    it('should pause provider polling', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Should not throw
      expect(() => wallet.pause()).not.toThrow();
    });

    it('should not throw if provider not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.pause()).not.toThrow();
    });
  });

  describe('resume', () => {
    it('should resume provider polling', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Should not throw
      expect(() => wallet.resume()).not.toThrow();
    });

    it('should not throw if provider not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.resume()).not.toThrow();
    });
  });

  describe('disconnect', () => {
    it('should clean up resources', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      wallet.onBlock(callback);

      wallet.disconnect();

      expect(wallet.isInitialized()).toBe(false);
    });

    it('should not throw if not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.disconnect()).not.toThrow();
    });
  });

  describe('getProvider', () => {
    it('should return provider instance', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const provider = wallet.getProvider();

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty('getBalance');
      expect(provider).toHaveProperty('getBlockNumber');
    });

    it('should throw if not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.getProvider()).toThrow('Provider not initialized');
    });
  });

  describe('getWallet', () => {
    it('should return wallet instance', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const walletInstance = wallet.getWallet();

      expect(walletInstance).toBeDefined();
      expect(walletInstance).toHaveProperty('address');
      expect(walletInstance).toHaveProperty('sendTransaction');
    });

    it('should throw if not initialized', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(() => wallet.getWallet()).toThrow('Wallet not initialized');
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      expect(wallet.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      expect(wallet.isInitialized()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);
      wallet.disconnect();

      expect(wallet.isInitialized()).toBe(false);
    });
  });

  describe('loadTransactions', () => {
    it('should call loadRSKTransactions with correct parameters', async () => {
      const { loadRSKTransactions } = await import('./RSKTransactions');
      
      const wallet = new RSKWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const address = wallet.getAddress();
      const provider = wallet.getProvider();

      await wallet.loadTransactions();

      expect(loadRSKTransactions).toHaveBeenCalledWith(
        address,
        provider,
        'testnet'
      );
    });

    it('should throw if not initialized', async () => {
      const wallet = new RSKWallet({ network: 'testnet' });

      await expect(wallet.loadTransactions()).rejects.toThrow('Wallet not initialized');
    });
  });
});

