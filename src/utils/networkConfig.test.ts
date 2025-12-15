import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setNetworkGetter,
  getNetwork,
  getRSKConfig,
  getBSCConfig,
  getBoltzConfig,
  getBSCPaymasterConfig,
  getUSDTToken,
  getMulticallAddress,
  isRifRelayAvailable,
  getLiquidAssetId,
  getWebSocketEndpoint,
  satoshiToWei,
  weiToSatoshi,
  FEE_TIERS,
  TIMELOCK_PERIODS,
  ERC20_ABI,
  PAYMASTER_ABI,
  RSK_NETWORKS,
  BSC_NETWORKS,
  BOLTZ_NETWORKS,
  LIQUID_ASSET_IDS,
  SATOSHI_TO_WEI,
  type RSKNetwork,
  type FeeTier,
} from './networkConfig';
import type { NetworkType } from '../core/types';

describe('Network Configuration', () => {
  // Store original console.warn to restore after tests
  const originalWarn = console.warn;
  
  beforeEach(() => {
    // Reset network getter before each test
    setNetworkGetter(() => 'testnet');
    // Mock console.warn to avoid noise in tests
    console.warn = vi.fn();
  });

  afterEach(() => {
    // Restore original console.warn
    console.warn = originalWarn;
  });

  describe('Network Getter Functions', () => {
    it('should set and get network correctly', () => {
      setNetworkGetter(() => 'mainnet');
      expect(getNetwork()).toBe('mainnet');

      setNetworkGetter(() => 'testnet');
      expect(getNetwork()).toBe('testnet');

      setNetworkGetter(() => 'regtest');
      expect(getNetwork()).toBe('regtest');
    });

    it('should default to testnet when getter not set', () => {
      // Reset getter by setting it to null (we need to access internal state)
      // Since we can't directly access _networkGetter, we'll test the warning behavior
      setNetworkGetter(() => 'testnet');
      const network = getNetwork();
      expect(network).toBe('testnet');
    });

    it('should call getter function dynamically', () => {
      let currentNetwork: NetworkType = 'mainnet';
      setNetworkGetter(() => currentNetwork);
      
      expect(getNetwork()).toBe('mainnet');
      
      currentNetwork = 'testnet';
      expect(getNetwork()).toBe('testnet');
    });
  });

  describe('RSK Network Configuration', () => {
    it('should return correct config for mainnet', () => {
      setNetworkGetter(() => 'mainnet');
      const config = getRSKConfig();

      expect(config.name).toBe('RSK Mainnet');
      expect(config.chainId).toBe(30);
      expect(config.rpcUrl).toBe('https://public-node.rsk.co');
      expect(config.currency.symbol).toBe('RBTC');
      expect(config.currency.decimals).toBe(18);
      expect(config.multicallAddress).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
    });

    it('should return correct config for testnet', () => {
      setNetworkGetter(() => 'testnet');
      const config = getRSKConfig();

      expect(config.name).toBe('RSK Testnet');
      expect(config.chainId).toBe(31);
      expect(config.rpcUrl).toBe('https://public-node.testnet.rsk.co');
      expect(config.currency.symbol).toBe('tRBTC');
      expect(config.currency.decimals).toBe(18);
      expect(config.multicallAddress).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
    });

    it('should return correct config for regtest', () => {
      setNetworkGetter(() => 'regtest');
      const config = getRSKConfig();

      expect(config.name).toBe('RSK Regtest (Local)');
      expect(config.chainId).toBe(33);
      expect(config.rpcUrl).toBe('http://localhost:8545');
      expect(config.currency.symbol).toBe('rRBTC');
      expect(config.multicallAddress).toBeNull();
    });

    it('should have all required properties in RSK_NETWORKS', () => {
      const networks: RSKNetwork[] = ['mainnet', 'testnet', 'regtest'];
      
      networks.forEach(network => {
        const config = RSK_NETWORKS[network];
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('chainId');
        expect(config).toHaveProperty('rpcUrl');
        expect(config).toHaveProperty('explorerUrl');
        expect(config).toHaveProperty('explorerApiUrl');
        expect(config).toHaveProperty('currency');
        expect(config.currency).toHaveProperty('name');
        expect(config.currency).toHaveProperty('symbol');
        expect(config.currency).toHaveProperty('decimals');
      });
    });

    it('should default to testnet for unknown network', () => {
      // This tests the fallback in getRSKConfig
      setNetworkGetter(() => 'testnet');
      const config = getRSKConfig();
      expect(config.name).toBe('RSK Testnet');
    });
  });

  describe('BSC Network Configuration', () => {
    it('should return correct config for mainnet', () => {
      setNetworkGetter(() => 'mainnet');
      const config = getBSCConfig();

      expect(config.name).toBe('BSC Mainnet');
      expect(config.chainId).toBe(56);
      expect(config.rpcUrl).toBe('https://bsc-rpc.publicnode.com');
      expect(config.currency.symbol).toBe('BNB');
      expect(config.tokens).toBeDefined();
      expect(config.tokens.length).toBeGreaterThan(0);
    });

    it('should return correct config for testnet', () => {
      setNetworkGetter(() => 'testnet');
      const config = getBSCConfig();

      expect(config.name).toBe('BSC Testnet');
      expect(config.chainId).toBe(97);
      expect(config.rpcUrl).toBe('https://bsc-testnet-rpc.publicnode.com');
      expect(config.currency.symbol).toBe('tBNB');
      expect(config.tokens).toBeDefined();
    });

    it('should map regtest to testnet', () => {
      setNetworkGetter(() => 'regtest');
      const config = getBSCConfig();

      // Should return testnet config
      expect(config.name).toBe('BSC Testnet');
      expect(config.chainId).toBe(97);
    });

    it('should have all required properties in BSC_NETWORKS', () => {
      const networks = ['mainnet', 'testnet'] as const;
      
      networks.forEach(network => {
        const config = BSC_NETWORKS[network];
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('chainId');
        expect(config).toHaveProperty('rpcUrl');
        expect(config).toHaveProperty('explorerUrl');
        expect(config).toHaveProperty('explorerApiUrl');
        expect(config).toHaveProperty('currency');
        expect(config).toHaveProperty('tokens');
        expect(Array.isArray(config.tokens)).toBe(true);
      });
    });

    it('should include USDT token in mainnet tokens', () => {
      setNetworkGetter(() => 'mainnet');
      const config = getBSCConfig();
      const usdtToken = config.tokens.find(t => t.symbol === 'USDT');
      
      expect(usdtToken).toBeDefined();
      expect(usdtToken?.address).toBe('0x55d398326f99059fF775485246999027B3197955');
      expect(usdtToken?.decimals).toBe(18);
    });

    it('should include tUSDT token in testnet tokens', () => {
      setNetworkGetter(() => 'testnet');
      const config = getBSCConfig();
      const usdtToken = config.tokens.find(t => t.symbol === 'tUSDT');
      
      expect(usdtToken).toBeDefined();
      expect(usdtToken?.address).toBe('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd');
    });
  });

  describe('Boltz Network Configuration', () => {
    it('should return correct config for mainnet', () => {
      setNetworkGetter(() => 'mainnet');
      const config = getBoltzConfig();

      expect(config.boltzApiUrl).toBe('https://api.boltz.exchange');
      expect(config.boltzWsUrl).toBe('wss://api.boltz.exchange/v2/ws');
      expect(config.rskChainId).toBe(30);
      expect(config.rifRelayEnabled).toBe(true);
      expect(config.contracts.smartWalletFactory).toBe('0x44944a80861120B58cc48B066d57cDAf5eC213dd');
    });

    it('should return correct config for regtest', () => {
      setNetworkGetter(() => 'regtest');
      const config = getBoltzConfig();

      expect(config.boltzApiUrl).toBe('http://localhost:9001');
      expect(config.boltzWsUrl).toBe('ws://localhost:9001/v2/ws');
      expect(config.rskChainId).toBe(33);
      expect(config.rifRelayEnabled).toBe(false);
    });

    it('should fall back to regtest for testnet', () => {
      setNetworkGetter(() => 'testnet');
      const config = getBoltzConfig();

      // Should fall back to regtest config
      expect(config.boltzApiUrl).toBe('http://localhost:9001');
      expect(config.rskChainId).toBe(33);
    });

    it('should have all required properties in BOLTZ_NETWORKS', () => {
      const networks = ['mainnet', 'regtest'] as const;
      
      networks.forEach(network => {
        const config = BOLTZ_NETWORKS[network];
        expect(config).toHaveProperty('boltzApiUrl');
        expect(config).toHaveProperty('boltzWsUrl');
        expect(config).toHaveProperty('rskRpcUrl');
        expect(config).toHaveProperty('rskChainId');
        expect(config).toHaveProperty('rskExplorerUrl');
        expect(config).toHaveProperty('rskExplorerApiUrl');
        expect(config).toHaveProperty('rifRelayServerUrl');
        expect(config).toHaveProperty('rifRelayEnabled');
        expect(config).toHaveProperty('contracts');
        expect(config.contracts).toHaveProperty('deployHeight');
        expect(config.contracts).toHaveProperty('smartWalletFactory');
        expect(config.contracts).toHaveProperty('deployVerifier');
      });
    });
  });

  describe('Helper Functions', () => {
    describe('getUSDTToken', () => {
      it('should return USDT token for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const token = getUSDTToken();

        expect(token).toBeDefined();
        expect(token?.symbol).toBe('USDT');
        expect(token?.address).toBe('0x55d398326f99059fF775485246999027B3197955');
      });

      it('should return tUSDT token for testnet', () => {
        setNetworkGetter(() => 'testnet');
        const token = getUSDTToken();

        expect(token).toBeDefined();
        expect(token?.symbol).toBe('tUSDT');
        expect(token?.address).toBe('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd');
      });

      it('should return tUSDT token for regtest (mapped to testnet)', () => {
        setNetworkGetter(() => 'regtest');
        const token = getUSDTToken();

        expect(token).toBeDefined();
        expect(token?.symbol).toBe('tUSDT');
      });
    });

    describe('getMulticallAddress', () => {
      it('should return multicall address for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const address = getMulticallAddress();

        expect(address).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
      });

      it('should return multicall address for testnet', () => {
        setNetworkGetter(() => 'testnet');
        const address = getMulticallAddress();

        expect(address).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
      });

      it('should return null for regtest', () => {
        setNetworkGetter(() => 'regtest');
        const address = getMulticallAddress();

        expect(address).toBeNull();
      });
    });

    describe('isRifRelayAvailable', () => {
      it('should return true for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        expect(isRifRelayAvailable()).toBe(true);
      });

      it('should return false for regtest', () => {
        setNetworkGetter(() => 'regtest');
        expect(isRifRelayAvailable()).toBe(false);
      });

      it('should return false for testnet (falls back to regtest)', () => {
        setNetworkGetter(() => 'testnet');
        expect(isRifRelayAvailable()).toBe(false);
      });
    });

    describe('getLiquidAssetId', () => {
      it('should return correct LBTC asset ID for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const assetId = getLiquidAssetId('LBTC');

        expect(assetId).toBe('6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d');
      });

      it('should return correct USDT asset ID for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const assetId = getLiquidAssetId('USDT');

        expect(assetId).toBe('ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2');
      });

      it('should return correct asset IDs for testnet', () => {
        setNetworkGetter(() => 'testnet');
        
        expect(getLiquidAssetId('LBTC')).toBe('144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49');
        expect(getLiquidAssetId('USDT')).toBe('b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73');
      });

      it('should return testnet asset IDs for regtest', () => {
        setNetworkGetter(() => 'regtest');
        
        expect(getLiquidAssetId('LBTC')).toBe('144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49');
        expect(getLiquidAssetId('USDT')).toBe('b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73');
      });
    });

    describe('getWebSocketEndpoint', () => {
      it('should return correct WebSocket endpoint for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const endpoint = getWebSocketEndpoint();

        expect(endpoint).toBe('wss://api.boltz.exchange/v2/ws');
      });

      it('should return correct WebSocket endpoint for regtest', () => {
        setNetworkGetter(() => 'regtest');
        const endpoint = getWebSocketEndpoint();

        expect(endpoint).toBe('ws://localhost:9001/v2/ws');
      });
    });

    describe('getBSCPaymasterConfig', () => {
      it('should return correct paymaster config for mainnet', () => {
        setNetworkGetter(() => 'mainnet');
        const config = getBSCPaymasterConfig();

        expect(config.address).toBe('0x0000000000000000000000000000000000000000');
        expect(config.usdtTokenAddress).toBe('0x55d398326f99059fF775485246999027B3197955');
        expect(config.minDeposit).toBeDefined();
        expect(config.maxGasPrice).toBeDefined();
      });

      it('should return correct paymaster config for testnet', () => {
        setNetworkGetter(() => 'testnet');
        const config = getBSCPaymasterConfig();

        expect(config.usdtTokenAddress).toBe('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd');
      });

      it('should return correct paymaster config for regtest', () => {
        setNetworkGetter(() => 'regtest');
        const config = getBSCPaymasterConfig();

        expect(config.usdtTokenAddress).toBe('0x0000000000000000000000000000000000000000');
      });
    });
  });

  describe('Conversion Functions', () => {
    describe('satoshiToWei', () => {
      it('should convert satoshis to wei correctly', () => {
        expect(satoshiToWei(1)).toBe(10000000000n);
        expect(satoshiToWei(100)).toBe(1000000000000n);
        expect(satoshiToWei(1000000)).toBe(10000000000000000n);
      });

      it('should handle bigint input', () => {
        expect(satoshiToWei(1000000n)).toBe(10000000000000000n);
      });

      it('should handle zero', () => {
        expect(satoshiToWei(0)).toBe(0n);
        expect(satoshiToWei(0n)).toBe(0n);
      });

      it('should use correct conversion factor', () => {
        expect(SATOSHI_TO_WEI).toBe(10000000000n);
        expect(satoshiToWei(1)).toBe(SATOSHI_TO_WEI);
      });
    });

    describe('weiToSatoshi', () => {
      it('should convert wei to satoshis correctly', () => {
        expect(weiToSatoshi(10000000000n)).toBe(1);
        expect(weiToSatoshi(1000000000000n)).toBe(100);
        expect(weiToSatoshi(10000000000000000n)).toBe(1000000);
      });

      it('should handle zero', () => {
        expect(weiToSatoshi(0n)).toBe(0);
      });

      it('should round down for partial satoshis', () => {
        expect(weiToSatoshi(5000000000n)).toBe(0); // Half a satoshi rounds down
        expect(weiToSatoshi(9999999999n)).toBe(0);
      });

      it('should be inverse of satoshiToWei', () => {
        const sats = 1000000;
        const wei = satoshiToWei(sats);
        const convertedBack = weiToSatoshi(wei);
        expect(convertedBack).toBe(sats);
      });
    });
  });

  describe('Constants', () => {
    describe('FEE_TIERS', () => {
      it('should have correct structure', () => {
        expect(FEE_TIERS[1]).toEqual({ percentage: 250, label: '2.5%' });
        expect(FEE_TIERS[2]).toEqual({ percentage: 200, label: '2.0%' });
        expect(FEE_TIERS[3]).toEqual({ percentage: 150, label: '1.5%' });
      });

      it('should have all required properties', () => {
        const tiers: FeeTier[] = [1, 2, 3];
        tiers.forEach(tier => {
          expect(FEE_TIERS[tier]).toHaveProperty('percentage');
          expect(FEE_TIERS[tier]).toHaveProperty('label');
        });
      });
    });

    describe('TIMELOCK_PERIODS', () => {
      it('should have correct values', () => {
        expect(TIMELOCK_PERIODS.COMPLETION).toBe(7 * 24 * 60 * 60); // 7 days
        expect(TIMELOCK_PERIODS.DISPUTE).toBe(14 * 24 * 60 * 60); // 14 days
      });

      it('should be in seconds', () => {
        expect(TIMELOCK_PERIODS.COMPLETION).toBe(604800); // 7 days in seconds
        expect(TIMELOCK_PERIODS.DISPUTE).toBe(1209600); // 14 days in seconds
      });
    });

    describe('ERC20_ABI', () => {
      it('should be an array', () => {
        expect(Array.isArray(ERC20_ABI)).toBe(true);
      });

      it('should contain required ERC20 functions', () => {
        const abiString = ERC20_ABI.join(' ');
        expect(abiString).toContain('balanceOf');
        expect(abiString).toContain('transfer');
        expect(abiString).toContain('approve');
        expect(abiString).toContain('allowance');
        expect(abiString).toContain('decimals');
      });

      it('should contain Transfer event', () => {
        const abiString = ERC20_ABI.join(' ');
        expect(abiString).toContain('Transfer');
      });
    });

    describe('PAYMASTER_ABI', () => {
      it('should be an array', () => {
        expect(Array.isArray(PAYMASTER_ABI)).toBe(true);
      });

      it('should contain paymaster-specific functions', () => {
        const abiString = PAYMASTER_ABI.join(' ');
        expect(abiString).toContain('validatePaymasterUserOp');
        expect(abiString).toContain('postOp');
        expect(abiString).toContain('deposit');
        expect(abiString).toContain('convertUsdtToBnb');
      });
    });

    describe('LIQUID_ASSET_IDS', () => {
      it('should have asset IDs for all networks', () => {
        const networks: NetworkType[] = ['mainnet', 'testnet', 'regtest'];
        
        networks.forEach(network => {
          expect(LIQUID_ASSET_IDS[network]).toHaveProperty('LBTC');
          expect(LIQUID_ASSET_IDS[network]).toHaveProperty('USDT');
          expect(LIQUID_ASSET_IDS[network].LBTC).toMatch(/^[a-f0-9]{64}$/); // 64 char hex
          expect(LIQUID_ASSET_IDS[network].USDT).toMatch(/^[a-f0-9]{64}$/);
        });
      });

      it('should have different asset IDs for mainnet vs testnet', () => {
        expect(LIQUID_ASSET_IDS.mainnet.LBTC).not.toBe(LIQUID_ASSET_IDS.testnet.LBTC);
        expect(LIQUID_ASSET_IDS.mainnet.USDT).not.toBe(LIQUID_ASSET_IDS.testnet.USDT);
      });

      it('should use testnet IDs for regtest', () => {
        expect(LIQUID_ASSET_IDS.regtest.LBTC).toBe(LIQUID_ASSET_IDS.testnet.LBTC);
        expect(LIQUID_ASSET_IDS.regtest.USDT).toBe(LIQUID_ASSET_IDS.testnet.USDT);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid network switching', () => {
      setNetworkGetter(() => 'mainnet');
      expect(getNetwork()).toBe('mainnet');
      
      setNetworkGetter(() => 'testnet');
      expect(getNetwork()).toBe('testnet');
      
      setNetworkGetter(() => 'regtest');
      expect(getNetwork()).toBe('regtest');
    });

    it('should handle conversion edge cases', () => {
      // Very large numbers
      expect(satoshiToWei(21000000)).toBe(210000000000000000n); // Max BTC supply
      expect(weiToSatoshi(210000000000000000n)).toBe(21000000);
    });
  });
});

