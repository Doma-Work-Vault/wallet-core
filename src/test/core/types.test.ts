import { describe, it, expect } from 'vitest';
import type {
  NetworkType,
  RSKUnit,
  BSCUnit,
  ERC20Token,
  PaymasterConfig,
  Transaction,
  WalletState,
  BoltzNetworkConfig,
} from '../../core/types';

describe('Core Types', () => {
  describe('NetworkType', () => {
    it('should accept valid network types', () => {
      const mainnet: NetworkType = 'mainnet';
      const testnet: NetworkType = 'testnet';
      const regtest: NetworkType = 'regtest';

      expect(mainnet).toBe('mainnet');
      expect(testnet).toBe('testnet');
      expect(regtest).toBe('regtest');
    });
  });

  describe('RSKUnit', () => {
    it('should accept valid RSK units', () => {
      const rbtc: RSKUnit = 'rbtc';
      const wei: RSKUnit = 'wei';

      expect(rbtc).toBe('rbtc');
      expect(wei).toBe('wei');
    });
  });

  describe('BSCUnit', () => {
    it('should accept valid BSC units', () => {
      const usdt: BSCUnit = 'usdt';
      const wei: BSCUnit = 'wei';

      expect(usdt).toBe('usdt');
      expect(wei).toBe('wei');
    });
  });

  describe('ERC20Token', () => {
    it('should have required properties', () => {
      const token: ERC20Token = {
        address: '0x123',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 18,
      };

      expect(token.address).toBe('0x123');
      expect(token.symbol).toBe('USDT');
      expect(token.name).toBe('Tether USD');
      expect(token.decimals).toBe(18);
    });

    it('should allow optional logoUrl', () => {
      const token: ERC20Token = {
        address: '0x123',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 18,
        logoUrl: 'https://example.com/logo.png',
      };

      expect(token.logoUrl).toBe('https://example.com/logo.png');
    });
  });

  describe('PaymasterConfig', () => {
    it('should have required properties', () => {
      const config: PaymasterConfig = {
        address: '0x123',
        usdtTokenAddress: '0x456',
        minDeposit: BigInt('1000000000000000000'),
        maxGasPrice: BigInt('50000000000'),
        usdtPriceOracle: '0x789',
      };

      expect(config.address).toBe('0x123');
      expect(config.usdtTokenAddress).toBe('0x456');
      expect(config.minDeposit).toBe(BigInt('1000000000000000000'));
      expect(config.maxGasPrice).toBe(BigInt('50000000000'));
      expect(config.usdtPriceOracle).toBe('0x789');
    });
  });

  describe('Transaction', () => {
    it('should have required properties', () => {
      const tx: Transaction = {
        hash: '0xabc',
        from: '0x123',
        to: '0x456',
        value: '1000000000000000000',
        gasUsed: '21000',
        gasPrice: '20000000000',
        blockNumber: 12345,
        timestamp: Date.now(),
        status: 'confirmed',
        type: 'send',
        network: 'rsk',
      };

      expect(tx.hash).toBe('0xabc');
      expect(tx.status).toBe('confirmed');
      expect(tx.type).toBe('send');
      expect(tx.network).toBe('rsk');
    });

    it('should allow optional properties', () => {
      const tx: Transaction = {
        hash: '0xabc',
        from: '0x123',
        to: '0x456',
        value: '1000000000000000000',
        gasUsed: '21000',
        gasPrice: '20000000000',
        blockNumber: 12345,
        timestamp: Date.now(),
        status: 'pending',
        type: 'swap',
        network: 'bsc',
        tokenSymbol: 'USDT',
        swapType: 'reverse',
        description: 'Test transaction',
        formattedAmount: '1.0',
        fee: 0.001,
      };

      expect(tx.tokenSymbol).toBe('USDT');
      expect(tx.swapType).toBe('reverse');
      expect(tx.description).toBe('Test transaction');
    });
  });

  describe('BoltzNetworkConfig', () => {
    it('should have required properties', () => {
      const config: BoltzNetworkConfig = {
        boltzApiUrl: 'https://api.boltz.exchange',
        boltzWsUrl: 'wss://api.boltz.exchange/v2/ws',
        rskRpcUrl: 'https://public-node.rsk.co',
        rskChainId: 30,
        rskExplorerUrl: 'https://explorer.rsk.co',
        rskExplorerApiUrl: 'https://rootstock.blockscout.com/api',
        rifRelayServerUrl: 'https://relay.example.com',
        rifRelayEnabled: true,
        contracts: {
          deployHeight: 1000000,
          smartWalletFactory: '0x123',
          deployVerifier: '0x456',
        },
      };

      expect(config.boltzApiUrl).toBe('https://api.boltz.exchange');
      expect(config.rifRelayEnabled).toBe(true);
      expect(config.contracts.deployHeight).toBe(1000000);
    });
  });

  describe('Type Exports', () => {
    it('should export all required types', () => {
      // This test ensures types are properly exported
      // TypeScript compiler will fail if types are missing
      const types = {
        NetworkType: 'mainnet' as NetworkType,
        RSKUnit: 'rbtc' as RSKUnit,
        BSCUnit: 'usdt' as BSCUnit,
        ERC20Token: {} as ERC20Token,
        PaymasterConfig: {} as PaymasterConfig,
        Transaction: {} as Transaction,
        BoltzNetworkConfig: {} as BoltzNetworkConfig,
      };

      expect(types).toBeDefined();
    });
  });
});

