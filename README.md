# @bittasker/wallet-core

Multi-chain Bitcoin wallet SDK for RSK (Rootstock), BSC (Binance Smart Chain), Lightning swaps (via Boltz), and Liquid swaps (via Boltz).

## Features

- 🔐 **HD Wallet Support**: BIP39/BIP44 mnemonic-based wallets
- ⚡ **Multi-Chain**: RSK, BSC, Lightning, Liquid
- 🔄 **Atomic Swaps**: Lightning ↔ RBTC, L-BTC ↔ RBTC via Boltz
- 💸 **Gasless Transactions**: RIF Relay integration for zero-gas RBTC claims
- 🌐 **Framework Agnostic**: Pure TypeScript, works with any framework
- 📱 **Mobile Ready**: Optimized for React Native, Capacitor, Ionic
- 🔌 **Extensible**: Optional price feeds, storage adapters, custom RPC endpoints

## Installation

```bash
npm install @bittasker/wallet-core ethers
```

## Quick Start

```typescript
import { WalletManager } from '@bittasker/wallet-core';

// Initialize wallet
const wallet = new WalletManager(
  { network: 'testnet' },
  {
    mnemonicProvider: async () => {
      // Your secure mnemonic retrieval
      return 'your twelve word mnemonic phrase here...';
    }
  }
);

await wallet.initialize();

// Get balance
const state = wallet.getState();
console.log('RSK Balance:', state.rsk.formattedBalance, 'RBTC');
console.log('BSC USDT:', state.bsc.formattedUsdtBalance, 'USDT');

// Send RBTC
const txHash = await wallet.sendRBTC('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', '0.01');
console.log('Transaction:', txHash);

// Subscribe to state changes
const unsubscribe = wallet.subscribe((state) => {
  console.log('Wallet updated:', state);
});
```

## Configuration

### Network Configuration

```typescript
const wallet = new WalletManager(
  {
    network: 'mainnet', // or 'testnet', 'regtest'
    rsk: {
      rpcUrl: 'https://custom-rsk-node.com', // Optional
      explorerApiUrl: 'https://custom-explorer.com/api' // Optional
    },
    bsc: {
      rpcUrl: 'https://custom-bsc-node.com', // Optional
      explorerApiUrl: 'https://custom-explorer.com/api' // Optional
    }
  },
  {
    mnemonicProvider: getMnemonic,
    priceService: {
      getCurrentPrice: async (symbol) => {
        // Fetch price from your preferred source
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`);
        const data = await res.json();
        return data[symbol].usd;
      },
      getExchangeRate: async (from, to) => {
        // Return exchange rate between two assets
        return 1.0;
      }
    }
  }
);
```

### Price Service (Optional)

The wallet can work without price feeds. USD values will simply be omitted.

```typescript
// Without price service
const wallet = new WalletManager(
  { network: 'testnet' },
  { mnemonicProvider: getMnemonic }
);

// Balances will be in native units only
console.log(wallet.getState().rsk.formattedBalance); // "0.500000 RBTC"
```

## API Reference

### WalletManager

Main wallet class that coordinates RSK, BSC, and swap operations.

#### Constructor

```typescript
constructor(
  config: WalletConfig,
  dependencies: WalletDependencies
)
```

#### Methods

**`initialize(): Promise<void>`**
Initialize all wallet connections (RSK, BSC).

**`sendRBTC(to: string, amount: string): Promise<string>`**
Send RBTC on Rootstock network.

**`sendBSCUSDT(to: string, amount: string): Promise<string>`**
Send USDT on BSC network.

**`sendBSCBNB(to: string, amount: string): Promise<string>`**
Send BNB on BSC network.

**`getState(): WalletState`**
Get current wallet state snapshot.

**`subscribe(listener: (state: WalletState) => void): () => void`**
Subscribe to state changes. Returns unsubscribe function.

**`disconnect(): void`**
Disconnect all wallet connections and clean up.

### RSKWallet

Standalone RSK (Rootstock) wallet module.

```typescript
import { RSKWallet } from '@bittasker/wallet-core';

const rskWallet = new RSKWallet({ network: 'testnet' });
await rskWallet.initialize(mnemonic);

// Send RBTC
const txHash = await rskWallet.send('0x...', '0.01');

// Get balance
const { balance, formatted } = await rskWallet.getBalance();

// Load transactions
const transactions = await rskWallet.loadTransactions();

// Subscribe to blocks
const unsubscribe = rskWallet.onBlock((blockNumber) => {
  console.log('New block:', blockNumber);
});
```

### BSCWallet

Standalone BSC wallet module with USDT and BNB support.

```typescript
import { BSCWallet } from '@bittasker/wallet-core';

const bscWallet = new BSCWallet({ network: 'testnet' });
await bscWallet.initialize(mnemonic);

// Send BNB
const txHash1 = await bscWallet.sendBNB('0x...', '0.1');

// Send USDT
const txHash2 = await bscWallet.sendUSDT('0x...', '100');

// Get balances
const { bnb, usdt } = await bscWallet.getBalances();
```

### Boltz Swaps

#### Reverse Swap (Lightning → RBTC)

```typescript
import { ReverseSwapService } from '@bittasker/wallet-core';

const swapService = new ReverseSwapService('testnet');

// Create swap
const swap = await swapService.createReverseSwap({
  amountSats: 100000,
  rbtcAddress: '0x...'
});

console.log('Pay this invoice:', swap.invoice);
console.log('Swap ID:', swap.swapId);

// Monitor swap status
const status = await swapService.getSwapStatus(swap.swapId);
console.log('Status:', status);
```

#### Chain Swap (L-BTC → RBTC)

```typescript
import { ChainSwapService } from '@bittasker/wallet-core';

const chainSwap = new ChainSwapService('mainnet');

// Create swap
const swap = await chainSwap.createChainSwap({
  amountSats: 100000,
  rbtcAddress: '0x...'
});

console.log('Send L-BTC to:', swap.lockupAddress);
```

### Storage Adapter (Optional)

Persist swap data with custom storage implementation:

```typescript
import { SwapStorage } from '@bittasker/wallet-core';

class MyStorage implements SwapStorage {
  async save(swapId: string, data: any): Promise<void> {
    // Save to your preferred storage (localStorage, IndexedDB, etc.)
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

// Use custom storage
const swapService = new ReverseSwapService('testnet', new MyStorage());
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

## RIF Relay (Gasless Transactions)

RIF Relay enables gasless RBTC transactions on mainnet:

```typescript
// Automatically uses RIF Relay when available on mainnet
const wallet = new WalletManager(
  { network: 'mainnet' },
  { mnemonicProvider: getMnemonic }
);

// Claims use Smart Wallet with gasless transactions
await wallet.initialize();
```

## Dependencies

- **ethers**: ^6.15.0 (peer dependency)
- **bitcoinjs-lib**: ^6.1.0
- **boltz-core**: ^3.0.0
- **ecpair**: ^3.0.0
- **tiny-secp256k1**: ^2.2.4

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  WalletState,
  WalletConfig,
  WalletDependencies,
  Transaction,
  NetworkType
} from '@bittasker/wallet-core';
```

## Security

### Best Practices

1. **Never expose mnemonics**: Always use secure storage
2. **Validate addresses**: Use `ethers.isAddress()` before sending
3. **Test on testnet**: Always test on testnet before mainnet
4. **Backup mnemonics**: Ensure users backup their 12-word phrase
5. **Use hardware wallets**: For production apps, integrate hardware wallet support

### Mnemonic Storage

```typescript
// ❌ BAD: Never hardcode mnemonics
const mnemonic = 'word1 word2 word3...';

// ✅ GOOD: Use secure storage
const mnemonic = await SecureStore.getItemAsync('wallet_mnemonic');

// ✅ GOOD: Use biometric protection
const mnemonic = await getWithBiometric('wallet_mnemonic');
```

## Examples

### React Native

```typescript
import { WalletManager } from '@bittasker/wallet-core';
import * as SecureStore from 'expo-secure-store';

const wallet = new WalletManager(
  { network: 'mainnet' },
  {
    mnemonicProvider: async () => {
      return await SecureStore.getItemAsync('wallet_mnemonic');
    }
  }
);
```

### Svelte

```typescript
import { WalletManager } from '@bittasker/wallet-core';
import { writable } from 'svelte/store';

const wallet = new WalletManager(/* ... */);
export const walletState = writable(wallet.getState());

wallet.subscribe((state) => {
  walletState.set(state);
});
```

### Vue

```typescript
import { WalletManager } from '@bittasker/wallet-core';
import { ref } from 'vue';

const wallet = new WalletManager(/* ... */);
const walletState = ref(wallet.getState());

wallet.subscribe((state) => {
  walletState.value = state;
});
```

## Troubleshooting

### RPC Connection Errors

```typescript
// Use custom RPC endpoint
const wallet = new WalletManager(
  {
    network: 'mainnet',
    rsk: {
      rpcUrl: 'https://your-custom-rsk-node.com'
    }
  },
  dependencies
);
```

### Transaction Failures

```typescript
try {
  await wallet.sendRBTC(to, amount);
} catch (error) {
  if (error.message.includes('insufficient')) {
    console.error('Not enough balance');
  } else if (error.message.includes('gas')) {
    console.error('Gas estimation failed');
  }
}
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © BitTasker

## Support

- GitHub Issues: https://github.com/bittasker/bittasker-wallet/issues
- Documentation: https://docs.bittasker.com/wallet-sdk
- Discord: https://discord.gg/bittasker

