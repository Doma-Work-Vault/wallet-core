# @bittasker/wallet-core

[![npm version](https://img.shields.io/npm/v/@bittasker/wallet-core.svg)](https://www.npmjs.com/package/@bittasker/wallet-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-chain Bitcoin wallet SDK for RSK (Rootstock), BSC (Binance Smart Chain), Lightning swaps (via Boltz), and Liquid swaps (via Boltz).

## Features

- 🔐 **HD Wallet Support**: BIP39/BIP44 mnemonic-based wallets
- ⚡ **Multi-Chain**: RSK, BSC, Lightning, Liquid
- 🔄 **Atomic Swaps**: 
  - Lightning → RBTC (Reverse Swaps)
  - L-BTC → RBTC (Chain Swaps)
  - RBTC/BTC/L-BTC → Lightning (Submarine Swaps)
- 💸 **Gasless Transactions**: RIF Relay integration for zero-gas RBTC claims
- 🌐 **Framework Agnostic**: Pure TypeScript, works with any framework
- 📱 **Mobile Ready**: Optimized for React Native, Capacitor, Ionic
- 🔌 **Extensible**: Custom storage adapters, custom RPC endpoints
- 📦 **Zero Config**: Ethers.js bundled, no peer dependencies

## Installation

```bash
npm install @bittasker/wallet-core
```

## Quick Start

```typescript
import { WalletManager } from '@bittasker/wallet-core';

// Initialize wallet with mnemonic
const walletManager = new WalletManager({
  network: 'testnet',
  mnemonic: 'your twelve word mnemonic phrase here...'
});

await walletManager.initialize();

// Get balances
const balances = await walletManager.getBalances();
console.log('RBTC:', balances.rsk.rbtc);
console.log('BNB:', balances.bsc.bnb);

// Send RBTC transaction
const txHash = await walletManager.rskWallet.send(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  '0.01'
);
console.log('Transaction:', txHash);
```

## Core Concepts

### WalletManager

The main class that orchestrates all wallet operations across chains.

```typescript
import { WalletManager } from '@bittasker/wallet-core';

const walletManager = new WalletManager({
  network: 'testnet', // 'mainnet', 'testnet', or 'regtest'
  mnemonic: 'your mnemonic phrase',
  swapStorage: myStorageAdapter // Optional: for swap persistence
});

await walletManager.initialize();
```

### Network Types

- **mainnet**: Production networks (RSK Mainnet, BSC Mainnet, Bitcoin Mainnet)
- **testnet**: Test networks (RSK Testnet, BSC Testnet, Bitcoin Testnet)
- **regtest**: Local development networks

### Storage Adapters

Implement custom storage for swap data persistence:

```typescript
import { SwapStorage } from '@bittasker/wallet-core';

class MyStorage implements SwapStorage {
  async save(swapId: string, data: any): Promise<void> {
    // Save to your preferred storage
    localStorage.setItem(`swap-${swapId}`, JSON.stringify(data));
  }

  async load(swapId: string): Promise<any | null> {
    const item = localStorage.getItem(`swap-${swapId}`);
    return item ? JSON.parse(item) : null;
  }

  async loadAll(): Promise<any[]> {
    // Load all swaps
    const swaps = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('swap-')) {
        swaps.push(JSON.parse(localStorage.getItem(key)!));
      }
    }
    return swaps;
  }

  async delete(swapId: string): Promise<void> {
    localStorage.removeItem(`swap-${swapId}`);
  }
}

// Use with WalletManager
const walletManager = new WalletManager({
  network: 'testnet',
  mnemonic: 'your mnemonic',
  swapStorage: new MyStorage()
});
```

## Complete Usage Guide

### Initialize Wallet

```typescript
import { WalletManager } from '@bittasker/wallet-core';

// Basic initialization
const walletManager = new WalletManager({
  network: 'testnet',
  mnemonic: await getSecureMnemonic() // Your secure mnemonic retrieval
});

await walletManager.initialize();
```

### Get Wallet Addresses

```typescript
const addresses = walletManager.getAddresses();
console.log('RSK Address:', addresses.rsk);
console.log('BSC Address:', addresses.bsc);
```

### Get Balances

```typescript
// Get all balances
const balances = await walletManager.getBalances();
console.log('RBTC:', balances.rsk.rbtc);
console.log('BNB:', balances.bsc.bnb);

// Get RSK balance directly
const rskBalance = await walletManager.rskWallet.getBalance();
console.log('Balance:', rskBalance.formatted, 'RBTC');
console.log('Raw:', rskBalance.balance.toString(), 'wei');

// Get BSC balances
const bscBalances = await walletManager.bscWallet.getBalances();
console.log('BNB:', bscBalances.bnb.formatted);
console.log('USDT:', bscBalances.usdt.formatted);
```

### Send Transactions

#### Send RBTC

```typescript
try {
  const txHash = await walletManager.rskWallet.send(
    '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    '0.01' // Amount in RBTC
  );
  console.log('Transaction sent:', txHash);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

#### Send BNB

```typescript
const txHash = await walletManager.bscWallet.sendBNB(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  '0.1' // Amount in BNB
);
```

#### Send USDT

```typescript
const txHash = await walletManager.bscWallet.sendUSDT(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  '100' // Amount in USDT
);
```

### Load Transaction History

```typescript
// Load RSK transactions
const rskTxs = await walletManager.rskWallet.loadTransactions();
rskTxs.forEach(tx => {
  console.log('Hash:', tx.hash);
  console.log('From:', tx.from);
  console.log('To:', tx.to);
  console.log('Value:', tx.value);
  console.log('Status:', tx.status);
});

// Load BSC transactions
const bscTxs = await walletManager.bscWallet.loadTransactions();
```

### Lightning Swaps (Reverse Swaps)

Swap Lightning BTC to RBTC:

```typescript
// Create reverse swap
const swap = await walletManager.reverseSwapService.createReverseSwap({
  amountSats: 100000, // Amount in satoshis
  rbtcAddress: walletManager.rskWallet.getAddress(),
  walletSigner: walletManager.rskWallet.getWallet()
});

console.log('Pay this Lightning invoice:', swap.invoice);
console.log('Swap ID:', swap.swapId);

// Monitor swap status
const status = await walletManager.reverseSwapService.getSwapStatus(swap.swapId);
console.log('Status:', status);
```

### Liquid Swaps (Chain Swaps)

Swap Liquid BTC to RBTC:

```typescript
// Create chain swap
const swap = await walletManager.chainSwapService.createChainSwap({
  amountSats: 100000, // Amount in satoshis
  rbtcAddress: walletManager.rskWallet.getAddress(),
  walletSigner: walletManager.rskWallet.getWallet()
});

console.log('Send L-BTC to:', swap.lockupAddress);
console.log('Swap ID:', swap.swapId);

// Monitor swap status
const status = await walletManager.chainSwapService.getSwapStatus(swap.swapId);
```

### Submarine Swaps

Swap RBTC (or BTC/L-BTC) to Lightning:

```typescript
// Get available submarine swap pairs
const pairs = await walletManager.submarineSwapService.getSubmarineSwapPairs();
console.log('Available pairs:', pairs);

// Create submarine swap with Lightning invoice
const invoice = 'lnbc...'; // Lightning invoice to be paid

const { swapId, swapData } = await walletManager.submarineSwapService.createSubmarineSwap({
  from: 'RBTC',
  to: 'BTC', // Lightning (represented as BTC in Boltz API)
  invoice: invoice
});

console.log('Swap created:', swapId);
console.log('Expected amount:', swapData.fromAmount, 'sats');

// Lock RBTC in EtherSwap contract
const rskWallet = walletManager.getRSKWallet();
const { txHash } = await walletManager.submarineSwapService.lockFundsEVM(
  swapData,
  rskWallet
);

console.log('✅ Funds locked! Transaction:', txHash);
console.log('Boltz will now pay the Lightning invoice');

// Monitor swap status
const currentSwap = walletManager.submarineSwapService.getSwap(swapId);
console.log('Current status:', currentSwap?.status);
// Possible statuses:
// - 'swap.created': Waiting for lockup
// - 'transaction.mempool': Lockup detected
// - 'transaction.confirmed': Lockup confirmed
// - 'invoice.paid': Boltz paid the invoice ✅
```

### Get Swap Limits

```typescript
const limits = await walletManager.getSwapLimits();
console.log('Reverse swap (Lightning → RBTC):');
console.log('  Min:', limits.lightning.minimal, 'sats');
console.log('  Max:', limits.lightning.maximal, 'sats');

console.log('Chain swap (L-BTC → RBTC):');
console.log('  Min:', limits.liquid.minimal, 'sats');
console.log('  Max:', limits.liquid.maximal, 'sats');

console.log('Submarine swap (RBTC → Lightning):');
console.log('  Min:', limits.submarine.minimal, 'sats');
console.log('  Max:', limits.submarine.maximal, 'sats');
```

## Network Configuration

### Default Configuration

```typescript
// Uses default RPC endpoints for the network
const walletManager = new WalletManager({
  network: 'mainnet',
  mnemonic: 'your mnemonic'
});
```

### Custom RPC Endpoints

```typescript
const walletManager = new WalletManager({
  network: 'mainnet',
  mnemonic: 'your mnemonic',
  rskConfig: {
    rpcUrl: 'https://custom-rsk-node.com',
    explorerApiUrl: 'https://custom-explorer.com/api'
  },
  bscConfig: {
    rpcUrl: 'https://custom-bsc-node.com',
    explorerApiUrl: 'https://custom-explorer.com/api'
  }
});
```

## Advanced Usage

### Direct Wallet Access

Access underlying ethers.js wallets for advanced operations:

```typescript
// Get RSK wallet (ethers.Wallet)
const rskWallet = walletManager.getRSKWallet();

// Get BSC wallet (ethers.Wallet)
const bscWallet = walletManager.getBSCWallet();

// Use for custom transactions
const tx = await rskWallet.sendTransaction({
  to: '0x...',
  value: ethers.parseEther('0.01'),
  gasLimit: 21000
});
```

### Gas Estimation

```typescript
import { ethers } from 'ethers';

const provider = walletManager.rskWallet.getProvider();
const wallet = walletManager.rskWallet.getWallet();

// Estimate gas for transaction
const gasEstimate = await provider.estimateGas({
  from: wallet.address,
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: ethers.parseEther('0.01')
});

console.log('Estimated gas:', gasEstimate.toString());
```

### Error Handling

```typescript
try {
  const txHash = await walletManager.rskWallet.send(recipientAddress, amount);
  console.log('Success:', txHash);
} catch (error) {
  if (error.message.includes('insufficient funds')) {
    console.error('Not enough balance');
  } else if (error.message.includes('invalid address')) {
    console.error('Invalid recipient address');
  } else {
    console.error('Transaction failed:', error.message);
  }
}
```

## Framework Examples

### Vanilla JavaScript

```javascript
import { WalletManager } from '@bittasker/wallet-core';

const walletManager = new WalletManager({
  network: 'testnet',
  mnemonic: 'your mnemonic'
});

await walletManager.initialize();

// Update UI with balance
const balances = await walletManager.getBalances();
document.getElementById('balance').textContent = balances.rsk.rbtc;
```

### React

```typescript
import { useState, useEffect } from 'react';
import { WalletManager } from '@bittasker/wallet-core';

function WalletComponent() {
  const [balance, setBalance] = useState('0');
  const [walletManager, setWalletManager] = useState<WalletManager | null>(null);

  useEffect(() => {
    async function initWallet() {
      const manager = new WalletManager({
        network: 'testnet',
        mnemonic: await getSecureMnemonic()
      });
      
      await manager.initialize();
      setWalletManager(manager);
      
      const balances = await manager.getBalances();
      setBalance(balances.rsk.rbtc);
    }
    
    initWallet();
  }, []);

  return <div>Balance: {balance} RBTC</div>;
}
```

### Vue

```typescript
import { ref, onMounted } from 'vue';
import { WalletManager } from '@bittasker/wallet-core';

export default {
  setup() {
    const balance = ref('0');
    const walletManager = ref<WalletManager | null>(null);

    onMounted(async () => {
      walletManager.value = new WalletManager({
        network: 'testnet',
        mnemonic: await getSecureMnemonic()
      });
      
      await walletManager.value.initialize();
      
      const balances = await walletManager.value.getBalances();
      balance.value = balances.rsk.rbtc;
    });

    return { balance };
  }
};
```

### Svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { WalletManager } from '@bittasker/wallet-core';

  let balance = $state('0');
  let walletManager: WalletManager | null = $state(null);

  onMount(async () => {
    walletManager = new WalletManager({
      network: 'testnet',
      mnemonic: await getSecureMnemonic()
    });
    
    await walletManager.initialize();
    
    const balances = await walletManager.getBalances();
    balance = balances.rsk.rbtc;
  });
</script>

<div>Balance: {balance} RBTC</div>
```

## API Reference

### WalletManager

Main wallet orchestration class.

**Constructor:**
```typescript
new WalletManager(config: WalletManagerConfig)
```

**Methods:**
- `initialize(): Promise<void>` - Initialize all wallet connections
- `getBalances(): Promise<WalletBalances>` - Get all wallet balances
- `getAddresses(): { rsk: string; bsc: string }` - Get wallet addresses
- `getSwapLimits(): Promise<SwapLimits>` - Get swap limits
- `getRSKWallet(): Signer` - Get RSK wallet for advanced use
- `getBSCWallet(): Signer` - Get BSC wallet for advanced use
- `dispose(): Promise<void>` - Clean up resources

**Properties:**
- `rskWallet: RSKWallet` - RSK wallet instance
- `bscWallet: BSCWallet` - BSC wallet instance
- `reverseSwapService: ReverseSwapService` - Lightning swap service
- `chainSwapService: ChainSwapService` - Liquid swap service

### RSKWallet

Rootstock (RSK) wallet operations.

**Methods:**
- `initialize(mnemonic: string): Promise<void>` - Initialize wallet
- `getAddress(): string` - Get wallet address
- `getBalance(): Promise<{ balance: bigint; formatted: string }>` - Get balance
- `send(to: string, amount: string): Promise<string>` - Send RBTC
- `loadTransactions(): Promise<Transaction[]>` - Load transaction history
- `getProvider(): JsonRpcProvider` - Get ethers provider
- `getWallet(): Wallet` - Get ethers wallet
- `disconnect(): void` - Disconnect wallet

### BSCWallet

Binance Smart Chain wallet operations.

**Methods:**
- `initialize(mnemonic: string): Promise<void>` - Initialize wallet
- `getAddress(): string` - Get wallet address
- `getBalances(): Promise<{ bnb: BalanceInfo; usdt: BalanceInfo }>` - Get balances
- `sendBNB(to: string, amount: string): Promise<string>` - Send BNB
- `sendUSDT(to: string, amount: string): Promise<string>` - Send USDT
- `loadTransactions(): Promise<Transaction[]>` - Load transaction history
- `getProvider(): JsonRpcProvider` - Get ethers provider
- `getWallet(): Wallet` - Get ethers wallet
- `disconnect(): void` - Disconnect wallet

### ReverseSwapService

Lightning Network to RBTC swaps.

**Methods:**
- `createReverseSwap(params): Promise<SwapData>` - Create reverse swap
- `getSwapStatus(swapId: string): Promise<SwapStatus>` - Get swap status
- `getSwapLimits(): Promise<{ minimal: number; maximal: number }>` - Get limits

### ChainSwapService

Liquid Network to RBTC swaps.

**Methods:**
- `createChainSwap(params): Promise<SwapData>` - Create chain swap
- `getSwapStatus(swapId: string): Promise<SwapStatus>` - Get swap status
- `getSwapLimits(): Promise<{ minimal: number; maximal: number }>` - Get limits

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  WalletManagerConfig,
  WalletBalances,
  SwapLimits,
  Transaction,
  NetworkType,
  SwapStorage
} from '@bittasker/wallet-core';
```

## Security Best Practices

### Mnemonic Storage

```typescript
// ❌ BAD: Never hardcode mnemonics
const mnemonic = 'word1 word2 word3...';

// ✅ GOOD: Use secure storage
const mnemonic = await SecureStore.getItemAsync('wallet_mnemonic');

// ✅ GOOD: Use biometric protection
const mnemonic = await getWithBiometric('wallet_mnemonic');
```

### Address Validation

```typescript
import { ethers } from 'ethers';

// Always validate addresses before sending
if (!ethers.isAddress(recipientAddress)) {
  throw new Error('Invalid address');
}

const txHash = await walletManager.rskWallet.send(recipientAddress, amount);
```

### Testing on Testnet

```typescript
// Always test on testnet first
const walletManager = new WalletManager({
  network: 'testnet', // Use testnet for testing
  mnemonic: 'your mnemonic'
});
```

### Key Security Rules

1. **Never expose mnemonics**: Always use secure storage for seed phrases
2. **Validate addresses**: Use `ethers.isAddress()` before sending transactions
3. **Test on testnet**: Always test thoroughly on testnet before mainnet
4. **Backup mnemonics**: Ensure users backup their 12-word recovery phrase
5. **Use hardware wallets**: For production apps with significant funds
6. **Keep dependencies updated**: Regularly update to latest SDK version
7. **Encrypt sensitive data**: Use proper encryption for stored credentials

## Troubleshooting

### RPC Connection Errors

```typescript
// Use custom RPC endpoint
const walletManager = new WalletManager({
  network: 'mainnet',
  mnemonic: 'your mnemonic',
  rskConfig: {
    rpcUrl: 'https://your-custom-rsk-node.com'
  }
});
```

### Transaction Failures

```typescript
try {
  await walletManager.rskWallet.send(to, amount);
} catch (error) {
  if (error.message.includes('insufficient')) {
    console.error('Not enough balance');
  } else if (error.message.includes('gas')) {
    console.error('Gas estimation failed');
  } else {
    console.error('Transaction failed:', error.message);
  }
}
```

### Balance Not Updating

```typescript
// Reload balances after transaction
const txHash = await walletManager.rskWallet.send(to, amount);

// Wait for confirmation
await new Promise(resolve => setTimeout(resolve, 5000));

// Reload balance
const balance = await walletManager.rskWallet.getBalance();
console.log('Updated balance:', balance.formatted);
```

## Network Support

### Mainnet
- RSK Mainnet (Chain ID: 30)
- BSC Mainnet (Chain ID: 56)
- Bitcoin Mainnet
- Liquid Network

### Testnet
- RSK Testnet (Chain ID: 31)
- BSC Testnet (Chain ID: 97)
- Bitcoin Testnet
- Liquid Testnet

### Regtest (Local Development)
- RSK Regtest (Chain ID: 33)
- Bitcoin Regtest
- Liquid Regtest

## Dependencies

- **ethers**: ^6.15.0 (bundled)
- **bitcoinjs-lib**: ^6.1.0
- **boltz-core**: ^3.0.0
- **bip39**: ^3.1.0
- **bip32**: ^4.0.0
- **liquidjs-lib**: ^6.0.2-liquid.37

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security issues, please email security@bittasker.com. See [SECURITY.md](SECURITY.md) for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT © BitTasker

## Links

- **GitLab**: https://gitlab.com/bittasker/wallet-core
- **Issues**: https://gitlab.com/bittasker/wallet-core/-/issues
- **NPM**: https://www.npmjs.com/package/@bittasker/wallet-core

## Support

- GitLab Issues: https://gitlab.com/bittasker/wallet-core/-/issues
- Email: hello@bittasker.com
