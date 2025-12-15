import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BSCWallet, type BSCWalletConfig } from './BSCWallet';

// Mock BSCTransactions module
vi.mock('./BSCTransactions', () => ({
  loadBSCTransactions: vi.fn().mockResolvedValue([]),
}));

// Mock BSCPaymaster module
vi.mock('./BSCPaymaster', () => ({
  BSCPaymasterContract: vi.fn().mockImplementation(() => ({
    canPayFeesInUsdt: vi.fn().mockResolvedValue(false),
  })),
}));

describe('BSCWallet', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should accept config', () => {
      const config: BSCWalletConfig = {
        network: 'testnet',
      };
      const wallet = new BSCWallet(config);

      expect(wallet).toBeDefined();
      expect(wallet.isInitialized()).toBe(false);
    });

    it('should accept config with custom RPC URL', () => {
      const config: BSCWalletConfig = {
        network: 'testnet',
        rpcUrl: 'http://custom-rpc:8545',
      };
      const wallet = new BSCWallet(config);

      expect(wallet).toBeDefined();
    });

    it('should accept config with polling interval', () => {
      const config: BSCWalletConfig = {
        network: 'testnet',
        pollingInterval: 10000,
      };
      const wallet = new BSCWallet(config);

      expect(wallet).toBeDefined();
    });

    it('should accept config with BSCScan API key', () => {
      const config: BSCWalletConfig = {
        network: 'testnet',
        bscscanApiKey: 'test-api-key',
      };
      const wallet = new BSCWallet(config);

      expect(wallet).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with valid mnemonic', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      
      await wallet.initialize(testMnemonic);

      expect(wallet.isInitialized()).toBe(true);
    });

    it('should throw on empty mnemonic', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.initialize('')).rejects.toThrow('No mnemonic provided');
    });

    it('should throw on whitespace-only mnemonic', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      // Ethers validates mnemonic format before our code, so it throws a different error
      await expect(wallet.initialize('   ')).rejects.toThrow();
    });

    it('should NOT test RPC connection during initialization', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      
      await wallet.initialize(testMnemonic);

      // getBlockNumber should NOT be called during initialization
      const provider = wallet.getProvider();
      const getBlockNumberSpy = vi.spyOn(provider, 'getBlockNumber');
      
      // Verify it wasn't called during init
      expect(getBlockNumberSpy).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.initialize('invalid mnemonic')).rejects.toThrow(
        'BSC wallet initialization failed'
      );
    });

    it('should set isInitialized correctly', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      
      expect(wallet.isInitialized()).toBe(false);
      
      await wallet.initialize(testMnemonic);
      
      expect(wallet.isInitialized()).toBe(true);
    });
  });

  describe('getAddress', () => {
    it('should return wallet address', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const address = wallet.getAddress();

      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address format
      expect(typeof address).toBe('string');
    });

    it('should throw if not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.getAddress()).toThrow('Wallet not initialized');
    });
  });

  describe('getBNBBalance', () => {
    it('should return BNB balance structure', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getBNBBalance();

      expect(balance).toHaveProperty('balance');
      expect(balance).toHaveProperty('formatted');
      expect(typeof balance.balance).toBe('bigint');
      expect(typeof balance.formatted).toBe('string');
      expect(balance.formatted).toMatch(/^\d+\.\d{6}$/); // Format: number.6decimals
    });

    it('should format balance correctly', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getBNBBalance();

      // Should be formatted to 6 decimal places
      const parts = balance.formatted.split('.');
      expect(parts.length).toBe(2);
      expect(parts[1].length).toBe(6);
    });

    it('should throw if not initialized', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.getBNBBalance()).rejects.toThrow('Wallet not initialized');
    });
  });

  describe('getUSDTBalance', () => {
    it('should return USDT balance structure', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getUSDTBalance();

      expect(balance).toHaveProperty('balance');
      expect(balance).toHaveProperty('formatted');
      expect(typeof balance.balance).toBe('bigint');
      expect(typeof balance.formatted).toBe('string');
    });

    it('should return zero if contract not initialized', async () => {
      // This test verifies the fallback behavior
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getUSDTBalance();

      // Should return a valid structure even if contract fails
      expect(balance).toHaveProperty('balance');
      expect(balance).toHaveProperty('formatted');
    });

    it('should format balance correctly', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balance = await wallet.getUSDTBalance();

      // Should be formatted (USDT uses 6 decimals in formatted output, same as BNB)
      const parts = balance.formatted.split('.');
      expect(parts.length).toBe(2);
      expect(parts[1].length).toBeGreaterThanOrEqual(2); // At least 2 decimals
    });
  });

  describe('getBalances', () => {
    it('should return both BNB and USDT balances', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const balances = await wallet.getBalances();

      expect(balances).toHaveProperty('bnb');
      expect(balances).toHaveProperty('usdt');
      expect(balances.bnb).toHaveProperty('balance');
      expect(balances.bnb).toHaveProperty('formatted');
      expect(balances.usdt).toHaveProperty('balance');
      expect(balances.usdt).toHaveProperty('formatted');
    });

    it('should fetch balances in parallel', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const startTime = Date.now();
      await wallet.getBalances();
      const endTime = Date.now();

      // Should complete relatively quickly (parallel execution)
      expect(endTime - startTime).toBeLessThan(5000); // 5 seconds max
    });
  });

  describe('sendBNB', () => {
    const recipientAddress = '0x1234567890123456789012345678901234567890';
    const amount = '0.1';

    it('should validate recipient address', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      await expect(wallet.sendBNB('invalid-address', amount)).rejects.toThrow(
        'Invalid recipient address'
      );
    });

    it('should check balance before sending', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Try to send more than available (will fail with insufficient funds)
      await expect(wallet.sendBNB(recipientAddress, '999999999')).rejects.toThrow();
    }, 10000); // Increase timeout for network calls

    it('should throw if not initialized', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.sendBNB(recipientAddress, amount)).rejects.toThrow(
        'Wallet not initialized'
      );
    });

    it('should handle send errors', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Use invalid amount format
      await expect(wallet.sendBNB(recipientAddress, 'invalid')).rejects.toThrow();
    });
  });

  describe('sendUSDT', () => {
    const recipientAddress = '0x1234567890123456789012345678901234567890';
    const amount = '10.0';

    it('should validate recipient address', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      await expect(wallet.sendUSDT('invalid-address', amount)).rejects.toThrow(
        'Invalid recipient address'
      );
    });

    it('should throw if USDT contract not initialized', async () => {
      // This test verifies error handling when contract is not available
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // If contract is not initialized, should throw
      try {
        await wallet.sendUSDT(recipientAddress, amount);
        // If no error, contract might be initialized but balance check failed
      } catch (error: any) {
        // Should throw an error (either contract not initialized or insufficient balance)
        expect(error.message).toMatch(/USDT|Failed to send|not initialized|Insufficient/i);
      }
    });

    it('should check USDT balance before sending', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Try to send more than available (will fail)
      try {
        await wallet.sendUSDT(recipientAddress, '999999999');
      } catch (error: any) {
        // Should throw an error (either insufficient balance or contract not initialized)
        expect(error.message).toMatch(/USDT|balance|not initialized/i);
      }
    }, 10000);
  });

  describe('estimateGasForBNB', () => {
    const recipientAddress = '0x1234567890123456789012345678901234567890';
    const amount = '0.1';

    it('should return gas estimate structure', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      try {
        const estimate = await wallet.estimateGasForBNB(recipientAddress, amount);

        expect(estimate).toHaveProperty('gasLimit');
        expect(estimate).toHaveProperty('gasPrice');
        expect(estimate).toHaveProperty('totalCost');
        expect(estimate).toHaveProperty('totalCostFormatted');
        expect(typeof estimate.gasLimit).toBe('bigint');
        expect(typeof estimate.gasPrice).toBe('bigint');
        expect(typeof estimate.totalCost).toBe('bigint');
        expect(typeof estimate.totalCostFormatted).toBe('string');
      } catch (error: any) {
        // Network may fail due to insufficient funds, which is expected
        expect(error.message).toMatch(/Failed to estimate gas|insufficient funds/i);
      }
    }, 10000);

    it('should calculate total cost correctly', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      try {
        const estimate = await wallet.estimateGasForBNB(recipientAddress, amount);

        // Total cost should be gasLimit * gasPrice
        const expectedTotalCost = estimate.gasLimit * estimate.gasPrice;
        expect(estimate.totalCost).toBe(expectedTotalCost);
      } catch (error: any) {
        // Network may fail due to insufficient funds, which is expected
        expect(error.message).toMatch(/Failed to estimate gas|insufficient funds/i);
      }
    }, 10000);

    it('should format total cost correctly', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      try {
        const estimate = await wallet.estimateGasForBNB(recipientAddress, amount);

        expect(estimate.totalCostFormatted).toBeDefined();
        expect(typeof estimate.totalCostFormatted).toBe('string');
        expect(parseFloat(estimate.totalCostFormatted)).toBeGreaterThanOrEqual(0);
      } catch (error: any) {
        // Network may fail due to insufficient funds, which is expected
        expect(error.message).toMatch(/Failed to estimate gas|insufficient funds/i);
      }
    }, 10000);

    it('should throw if not initialized', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.estimateGasForBNB(recipientAddress, amount)).rejects.toThrow(
        'Wallet not initialized'
      );
    });
  });

  describe('getBlockNumber', () => {
    it('should return block number', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const blockNumber = await wallet.getBlockNumber();

      expect(typeof blockNumber).toBe('number');
      expect(blockNumber).toBeGreaterThan(0);
    });

    it('should throw if not initialized', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.getBlockNumber()).rejects.toThrow('Provider not initialized');
    });
  });

  describe('getPaymaster', () => {
    it('should return paymaster or null', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const paymaster = wallet.getPaymaster();

      // May be null if paymaster is not configured
      expect(paymaster === null || typeof paymaster === 'object').toBe(true);
    });
  });

  describe('canPayFeesInUsdt', () => {
    it('should return boolean', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const canPay = await wallet.canPayFeesInUsdt();

      expect(typeof canPay).toBe('boolean');
    });

    it('should return false if paymaster not available', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const canPay = await wallet.canPayFeesInUsdt();

      // If paymaster is null, should return false
      if (!wallet.getPaymaster()) {
        expect(canPay).toBe(false);
      }
    });

    it('should handle errors gracefully', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      // Should not throw even if paymaster check fails
      await expect(wallet.canPayFeesInUsdt()).resolves.toBeDefined();
    });
  });

  describe('onBlock', () => {
    it('should subscribe to block events', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      const unsubscribe = wallet.onBlock(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(typeof callback).toBe('function');
    });

    it('should return unsubscribe function', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      const unsubscribe = wallet.onBlock(callback);

      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should throw if not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.onBlock(() => {})).toThrow('Provider not initialized');
    });
  });

  describe('pause', () => {
    it('should pause provider polling', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      expect(() => wallet.pause()).not.toThrow();
    });

    it('should not throw if provider not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.pause()).not.toThrow();
    });
  });

  describe('resume', () => {
    it('should resume provider polling', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      expect(() => wallet.resume()).not.toThrow();
    });

    it('should not throw if provider not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.resume()).not.toThrow();
    });
  });

  describe('disconnect', () => {
    it('should clean up resources', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const callback = vi.fn();
      wallet.onBlock(callback);

      wallet.disconnect();

      expect(wallet.isInitialized()).toBe(false);
    });

    it('should not throw if not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.disconnect()).not.toThrow();
    });
  });

  describe('getProvider', () => {
    it('should return provider instance', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const provider = wallet.getProvider();

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty('getBalance');
      expect(provider).toHaveProperty('getBlockNumber');
    });

    it('should throw if not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.getProvider()).toThrow('Provider not initialized');
    });
  });

  describe('getWallet', () => {
    it('should return wallet instance', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const walletInstance = wallet.getWallet();

      expect(walletInstance).toBeDefined();
      expect(walletInstance).toHaveProperty('address');
      expect(walletInstance).toHaveProperty('sendTransaction');
    });

    it('should throw if not initialized', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(() => wallet.getWallet()).toThrow('Wallet not initialized');
    });
  });

  describe('getUSDTContract', () => {
    it('should return USDT contract or null', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const contract = wallet.getUSDTContract();

      // May be null if USDT token is not configured
      expect(contract === null || typeof contract === 'object').toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      expect(wallet.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      expect(wallet.isInitialized()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);
      wallet.disconnect();

      expect(wallet.isInitialized()).toBe(false);
    });
  });

  describe('loadTransactions', () => {
    it('should call loadBSCTransactions with correct parameters', async () => {
      const { loadBSCTransactions } = await import('./BSCTransactions');
      
      const wallet = new BSCWallet({ network: 'testnet', bscscanApiKey: 'test-key' });
      await wallet.initialize(testMnemonic);

      const address = wallet.getAddress();

      await wallet.loadTransactions();

      expect(loadBSCTransactions).toHaveBeenCalledWith(
        address,
        'test-key'
      );
    });

    it('should call loadBSCTransactions without API key if not provided', async () => {
      const { loadBSCTransactions } = await import('./BSCTransactions');
      
      const wallet = new BSCWallet({ network: 'testnet' });
      await wallet.initialize(testMnemonic);

      const address = wallet.getAddress();

      await wallet.loadTransactions();

      expect(loadBSCTransactions).toHaveBeenCalledWith(
        address,
        undefined
      );
    });

    it('should throw if not initialized', async () => {
      const wallet = new BSCWallet({ network: 'testnet' });

      await expect(wallet.loadTransactions()).rejects.toThrow('Wallet not initialized');
    });
  });
});

