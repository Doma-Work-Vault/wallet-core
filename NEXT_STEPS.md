# Next Steps to Complete the SDK

## Summary of Current Status

### ✅ What's Complete (MVP Ready)
The SDK has a solid foundation with working RSK and BSC wallets:

1. **Core Infrastructure** ✅
   - EventEmitter for framework-agnostic state management
   - Complete TypeScript type definitions
   - Network configurations for all chains

2. **RSK Chain** ✅
   - Full wallet implementation (send, receive, balance)
   - Transaction history with explorer API integration
   - Swap transaction detection

3. **BSC Chain** ✅
   - Complete BNB and USDT support
   - EIP-7702 Paymaster for gasless transactions
   - Transaction history with BSCScan API

4. **Documentation** ✅
   - Comprehensive README with examples
   - API reference for current modules
   - TypeScript support documentation

### ⏳ What's Missing (Critical)
The main missing pieces are:

1. **Boltz Swap Integration** (5 files, ~3600 lines)
2. **RIF Relay for Gasless Claims** (4 files, ~1050 lines)
3. **WalletManager** to coordinate everything (~800 lines)

## Step-by-Step Completion Guide

### Step 1: Copy Boltz Integration Files (Highest Priority)

Navigate to BitTasker directory and copy files:

```bash
cd E:\projects\upw\BitTasker

# Copy Boltz types (no changes needed)
copy src\lib\integrations\boltz\types.ts bittasker-wallet\src\swaps\boltz\types.ts

# Copy WebSocket client (no changes needed)
copy src\lib\integrations\boltz\websocket.ts bittasker-wallet\src\swaps\boltz\WebSocketClient.ts
```

For the following files, you'll need to make changes:

#### 1.1 BoltzClient.ts
**Source**: `src/lib/integrations/boltz/client.ts`
**Target**: `bittasker-wallet/src/swaps/boltz/BoltzClient.ts`

**Changes**:
- Remove: `import { getBoltzConfig } from '$lib/utils/wallet/networkConfig';`
- Add: `import { getBoltzConfig } from '../../utils/networkConfig';`
- Remove: `import type { BoltzNetworkConfig, NetworkType } from '$lib/types/wallet';`
- Add: `import type { BoltzNetworkConfig, NetworkType } from '../../core/types';`
- Remove any other `$lib/` imports

#### 1.2 ReverseSwapService.ts
**Source**: `src/lib/integrations/boltz/reverseSwapService.ts`
**Target**: `bittasker-wallet/src/swaps/boltz/ReverseSwapService.ts`

**Changes**:
1. Remove Nostr storage imports:
   ```typescript
   // DELETE these lines:
   import { saveSwapToNostr, recoverPendingSwaps } from './pendingSwaps';
   ```

2. Add SwapStorage interface:
   ```typescript
   // ADD at the top:
   export interface SwapStorage {
     save(swapId: string, data: any): Promise<void>;
     load(swapId: string): Promise<any | null>;
     loadAll(): Promise<any[]>;
     delete(swapId: string): Promise<void>;
   }
   ```

3. Update constructor:
   ```typescript
   // CHANGE from:
   constructor(network: NetworkType) {
     // ...
   }

   // TO:
   constructor(network: NetworkType, storage?: SwapStorage) {
     this.storage = storage;
     // ...
   }
   ```

4. Replace all `saveSwapToNostr()` calls:
   ```typescript
   // CHANGE from:
   await saveSwapToNostr(swapData, nsec, 'boltz-swap-reverse');

   // TO:
   await this.storage?.save(swapId, swapData);
   ```

5. Fix import paths (replace `$lib/` with relative paths)

#### 1.3 ChainSwapService.ts
**Same changes as ReverseSwapService.ts**

### Step 2: Copy RIF Relay Directory

```bash
cd E:\projects\upw\BitTasker

# Copy entire RIF directory
xcopy /E /I src\lib\integrations\boltz\rif bittasker-wallet\src\swaps\rif
```

**Changes needed in all files**:
- Replace `$lib/` imports with relative imports
- Example: `import { ... } from '$lib/types/wallet'` → `import { ... } from '../../core/types'`

### Step 3: Create WalletManager

Create `bittasker-wallet/src/core/WalletManager.ts`:

```typescript
import { EventEmitter } from './EventEmitter';
import type { WalletState, WalletConfig, WalletDependencies } from './types';
import { RSKWallet } from '../chains/rsk/RSKWallet';
import { BSCWallet } from '../chains/bsc/BSCWallet';

export class WalletManager extends EventEmitter<WalletState> {
  private rskWallet: RSKWallet;
  private bscWallet: BSCWallet;
  private config: WalletConfig;
  private dependencies: WalletDependencies;

  constructor(config: WalletConfig, dependencies: WalletDependencies) {
    // Initialize with empty state
    super(initialState);
    this.config = config;
    this.dependencies = dependencies;
    this.rskWallet = new RSKWallet({ network: config.network });
    this.bscWallet = new BSCWallet({ network: config.network as 'mainnet' | 'testnet' });
  }

  async initialize(): Promise<void> {
    // Get mnemonic
    const mnemonic = await this.dependencies.mnemonicProvider();

    // Initialize wallets
    await Promise.all([
      this.rskWallet.initialize(mnemonic),
      this.bscWallet.initialize(mnemonic)
    ]);

    // Update state
    this.setState({
      isConnected: true,
      // ... update with wallet data
    });
  }

  async sendRBTC(to: string, amount: string): Promise<string> {
    return await this.rskWallet.send(to, amount);
  }

  async sendBSCUSDT(to: string, amount: string): Promise<string> {
    return await this.bscWallet.sendUSDT(to, amount);
  }

  // Add more methods as needed
}
```

### Step 4: Update Public API

Update `src/index.ts` to include:

```typescript
// Add these exports:
export { WalletManager } from './core/WalletManager';

// Boltz exports
export { BoltzClient } from './swaps/boltz/BoltzClient';
export { ReverseSwapService } from './swaps/boltz/ReverseSwapService';
export { ChainSwapService } from './swaps/boltz/ChainSwapService';
export { boltzWebSocket } from './swaps/boltz/WebSocketClient';
export type * from './swaps/boltz/types';

// RIF Relay exports
export { relayClaimTransaction, getSmartWalletAddress } from './swaps/rif/Signer';
```

### Step 5: Build and Test

```bash
cd E:\projects\upw\BitTasker\bittasker-wallet

# Install dependencies
npm install

# Build
npm run build

# Fix any TypeScript errors that appear

# Pack for testing
npm pack
```

### Step 6: Test in BitTasker

```bash
cd E:\projects\upw\BitTasker

# Install local package
npm install ./bittasker-wallet/@bittasker-wallet-core-0.1.0.tgz

# Create NostrSwapStorage adapter (see below)
```

#### Create NostrSwapStorage Adapter

Create `src/lib/integrations/boltz/NostrSwapStorage.ts` in BitTasker:

```typescript
import type { SwapStorage } from '@bittasker/wallet-core';
import { saveSwapToNostr, recoverPendingSwaps, deleteSwapEvent } from './pendingSwaps';

export class NostrSwapStorage implements SwapStorage {
  constructor(private nsec: string, private swapType: string) {}

  async save(swapId: string, data: any): Promise<void> {
    await saveSwapToNostr(data, this.nsec, this.swapType);
  }

  async load(swapId: string): Promise<any | null> {
    const swaps = await this.loadAll();
    return swaps.find(s => s.id === swapId) || null;
  }

  async loadAll(): Promise<any[]> {
    return await recoverPendingSwaps(this.nsec, this.swapType);
  }

  async delete(swapId: string): Promise<void> {
    await deleteSwapEvent(this.nsec, swapId, this.swapType);
  }
}
```

### Step 7: Migrate BitTasker wallet.store.ts

Replace wallet.store.ts content with:

```typescript
import { WalletManager } from '@bittasker/wallet-core';
import { getMnemonic } from '$lib/utils/helpers/mnemonic';
import cryptoPriceService from '$lib/api/services/crypto-price.service';
import { writable } from 'svelte/store';

const walletManager = new WalletManager(
  { 
    network: import.meta.env.VITE_RSK_NETWORK || 'testnet'
  },
  {
    mnemonicProvider: getMnemonic,
    priceService: {
      getCurrentPrice: (symbol) => cryptoPriceService.getCurrentPrice(symbol),
      getExchangeRate: (from, to) => cryptoPriceService.getExchangeRate(from, to)
    }
  }
);

// Wrap in Svelte store for reactivity
export const walletStore = writable(walletManager.getState());

// Subscribe to SDK state changes
walletManager.subscribe((state) => {
  walletStore.set(state);
});

// Re-export manager for imperative operations
export { walletManager };

// Re-export initialization function
export async function initializeWallet() {
  await walletManager.initialize();
}
```

### Step 8: Publish to npm

```bash
cd E:\projects\upw\BitTasker\bittasker-wallet

# Login to npm
npm login

# Publish
npm publish --access public

# Tag release
git tag v0.1.0
git push origin v0.1.0
```

## Time Estimates

- **Step 1** (Boltz files): 2-3 hours
- **Step 2** (RIF Relay): 30 minutes
- **Step 3** (WalletManager): 2-3 hours
- **Step 4** (Public API): 15 minutes
- **Step 5** (Build/Test): 1 hour
- **Step 6-7** (BitTasker Integration): 2-3 hours
- **Step 8** (Publish): 30 minutes

**Total**: ~10-12 hours of focused work

## Quick Wins for Friday Demo

If time is limited, prioritize:

1. ✅ **Already Done**: RSK + BSC wallets (working!)
2. Copy Boltz types.ts (no changes needed)
3. Skip RIF Relay for now (can add later)
4. Create minimal WalletManager (just RSK + BSC, no swaps)
5. Build and publish as v0.1.0-beta
6. Document "Swaps coming in v0.2.0"

This gives you a functional multi-chain wallet SDK to demo!

## Need Help?

Check these files for reference:
- `PROGRESS.md` - Current status
- `README.md` - API documentation
- `package.json` - Dependencies
- `src/index.ts` - Public exports

All source files have extensive comments and JSDoc.

