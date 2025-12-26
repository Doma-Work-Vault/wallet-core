# Changelog

All notable changes to @bittasker/wallet-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2025-12-26

### Added
- **Event System Refactor**: Replaced `EventEmitter` with `EventBus` for improved pub/sub pattern
  - New `EventBus` class with `on()`, `off()`, `emit()`, `clear()`, and `listenerCount()` methods
  - Better error handling - errors in one listener don't break others
  - Type-safe event handling with generic support
  - Comprehensive test coverage (281 unit tests)
- **Swap Update Events**: All swap services now emit `swap.update` events for real-time monitoring
  - `SwapUpdateEvent` interface includes full swap data, status, timestamp, and transaction details
  - `WalletManager.onSwapUpdate()` convenience method to subscribe to all swap services at once
  - Clients can now monitor swap progress without polling
- **Conditional Storage Saves**: Swap services now only save to storage when actual changes occur
  - Prevents redundant storage writes during WebSocket recovery
  - `skipSave` parameter in `handleSwapUpdate()` for recovery scenarios
  - Tracks previous state to detect meaningful changes

### Changed
- **EventEmitter → EventBus Migration**: 
  - Removed state management from event system (was not being used)
  - Simplified to pure pub/sub pattern more suitable for SDK events
  - Updated all swap services to use `EventBus` instead of internal event handling
- **Liquid URI Format**: Removed `liquidnetwork:` prefix from generated payment URIs
  - Old format: `liquidnetwork:ADDRESS?amount=...`
  - New format: `ADDRESS?amount=...` (BIP21-compatible)
- **Swap Status Consistency**: Standardized claim status to `transaction.claimed` across all services
- **Event Cleanup**: `WalletManager.dispose()` now properly cleans up all event listeners

### Fixed
- **Memory Leaks**: Event listeners are now properly cleaned up on disposal
- **Redundant Storage Writes**: Eliminated unnecessary saves during swap recovery
- **Test Accuracy**: Fixed test expectations to match actual swap status values

### Technical
- Exported `EventCallback` type for type-safe event handling
- Exported `SwapUpdateEvent` type for client implementations
- Updated TEST_PLAN.md to reflect EventBus changes
- All 465+ tests passing with new event system

### Benefits
- **Real-time Updates**: Clients can now react to swap changes immediately via events
- **Better Performance**: Reduced storage I/O with conditional saves
- **Cleaner Architecture**: Separation of concerns between events and state management
- **Developer Experience**: Simple event subscription with automatic cleanup

### Migration Guide
```typescript
// Before (v0.1.5) - EventEmitter with state
import { EventEmitter } from '@bittasker/wallet-core';
const emitter = new EventEmitter({ count: 0 });
const unsubscribe = emitter.subscribe((state) => console.log(state));

// After (v0.1.6) - EventBus for pub/sub
import { EventBus } from '@bittasker/wallet-core';
const bus = new EventBus();
const unsubscribe = bus.on('event', (data) => console.log(data));

// Subscribe to swap updates
const unsubscribe = walletManager.onSwapUpdate((event) => {
  console.log('Swap updated:', event.swapId, event.status);
  // event includes full swapData, no need to fetch separately
});
```

[0.1.6]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.6

## [0.1.5] - 2025-12-19

### Added
- **Complete Transaction Field Mapping**: All fields from Blockscout/BSCScan API responses now preserved in Transaction objects including contract interaction data, EIP-1559 gas pricing, comprehensive metadata, token transfers, exchange rates, and error tracking
- **Comprehensive Test Coverage**: Added 139 unit tests for all swap services (ReverseSwapService, ChainSwapService, SubmarineSwapService, and refund services) - all 465 tests passing
- **Performance Benchmarking**: Added comprehensive benchmarking script with comparison tracking and timestamped logs

### Changed
- **Transaction Interface**: Updated to match complete Blockscout API v2 response structure with `rawInput` replacing `input` field
- **Optimized Wallet Initialization**: Implemented lazy loading for swap services, deferred WebSocket connections, and parallelized wallet initialization
  - Full WalletManager initialization: ~97% faster (735ms → 19ms)
  - RSK Wallet initialization: ~26% faster (719ms → 528ms)
  - BSC Wallet initialization: ~32% faster (433ms → 294ms)
  - Overall average: ~55% faster initialization

### Benefits
- **No Additional API Calls**: Contract detection and enrichment can be done entirely client-side
- **Future-Proof**: All blockchain data preserved for future features
- **Performance**: Single API call provides complete transaction data plus dramatically faster initialization
- **Consistency**: Same comprehensive data structure across RSK and BSC networks
- **Developer Experience**: Consuming applications can detect contract interactions, parse methods, and enrich UIs without re-fetching

### Migration Notes
- Existing code using `input` field should migrate to `rawInput`
- Legacy fields remain available for backward compatibility
- All new fields are mapped from both Blockscout (RSK) and BSCScan (BSC) APIs

[0.1.5]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.5

## [0.1.4] 2025-11-11

### Changed
- **WalletManager as Service Hub**: Refactored `WalletManager` to be the central initialization point for all services
  - `EvmContractService` now initialized in constructor and shared across all swap services
  - `ReverseSwapService`, `ChainSwapService`, and `SubmarineSwapService` now receive shared service instances
  - Exposed `evmContractService` getter for direct access to gas estimation and contract operations
  - Improved dependency injection pattern for better maintainability

### Added
- **Lightning Invoice Decoding**: `SubmarineSwapService` now decodes Lightning invoices (bolt11)
  - Extracts invoice amount in satoshis
  - Extracts payment hash (preimage hash) from invoice
  - Validates invoice format and required fields
- **Gas Estimation for Submarine Swaps**: Added comprehensive gas cost estimation
  - `createSubmarineSwap()` now returns `estimatedGas` with lockup cost breakdown
  - Includes `costWei`, `costSats`, and `totalRequired` (amount + gas) in response
  - Non-blocking: continues if estimation fails (logs warning)
- **Public Gas Estimation Methods**: `EvmContractService` now exposes gas estimation utilities
  - `estimateLockupGas()`: Estimate gas for submarine swap lockups
  - `estimateClaimGas()`: Estimate gas for reverse/chain swap claims
  - `estimateRefundGas()`: Estimate gas for submarine swap refunds
  - `hasSufficientBalance()`: Check if user has enough RBTC for operations

### Technical
- Centralized service initialization improves code reusability
- All swap services now share single `EvmContractService` instance
- Better separation of concerns between WalletManager and individual services

[0.1.4]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.4

## [0.1.2] - 2025-11-10

### Added
- **Submarine Swap Support**: Pay Lightning invoices using on-chain RBTC
- `SubmarineSwapService`: Complete lifecycle management for RBTC → Lightning swaps
- `SubmarineSwapRefundService`: Refund handling for expired or failed submarine swaps
- Support for RBTC, BTC, and L-BTC submarine swaps (RBTC fully tested)
- Automatic swap recovery from storage on app restart
- Real-time WebSocket monitoring for submarine swap status updates
- EVM lockup functionality via `lockFundsEVM()` for RBTC swaps
- Comprehensive swap status tracking: created → lockup → confirmed → invoice paid → claimed

### Features
- **Submarine Swap Flow**: User locks RBTC first, then Boltz pays Lightning invoice
- **Trustless Refunds**: Automatic refund support if Boltz fails to pay invoice
- **RIF Relay Integration**: Gasless RBTC refunds for failed submarine swaps
- **Storage Persistence**: Swap data persists across app restarts
- **Multi-Asset Support**: RBTC (EVM), BTC, and L-BTC submarine swaps
- Invoice amount validation and swap limit checking
- Lockup information helper for UTXO chains (BTC/L-BTC)

### Changed
- Consolidated all type definitions into centralized `types.ts` file
- Improved type safety across swap services
- Enhanced error handling with descriptive validation messages
- Optimized type exports (removed 10 unused type definitions)

### Removed
- Unused Bitcoin UTXO cooperative claim/refund types (not needed for RBTC)
- Duplicate submarine refund type definitions
- Legacy `LockFundsParams` and `LockFundsResult` types

### Technical
- Reuses existing `EvmContractService` for RBTC lockups
- Integrates with `BoltzClient` and `BoltzWebSocket` infrastructure
- Storage-agnostic design (works with Nostr/IndexedDB/localStorage)
- TypeScript strict mode compliance

[0.1.2]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.2

## [0.1.1] - 2025-11-07

### Security
- **CRITICAL**: Added address validation in swap services to prevent invalid addresses
- **CRITICAL**: Added comprehensive amount validation for all swap operations
- **CRITICAL**: Implemented race condition protection for concurrent swap claims
- **CRITICAL**: Fixed memory leak in WebSocket reconnection handling
- **HIGH**: Added double-claim protection checks in all claim methods
- Audited all console logs to ensure no sensitive data exposure

### Changed
- Improved type safety by replacing `any` types with proper `ethers.Signer` types
- Enhanced error handling with better validation messages
- Updated swap services with better null checks and error boundaries

### Fixed
- WebSocket reconnection timeout now properly cleaned up on disconnect
- Concurrent claim attempts now properly prevented with locking mechanism
- Swap claim methods now validate status before attempting claims

[0.1.1]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.1

## [0.1.0] - 2025-11-06

### Added
- Initial release of @bittasker/wallet-core
- RSK (Rootstock) wallet support with RBTC transactions
- BSC (Binance Smart Chain) wallet support with BNB and USDT
- Lightning Network swaps via Boltz (reverse swaps: Lightning → RBTC)
- Liquid Network swaps via Boltz (chain swaps: L-BTC → RBTC)
- RIF Relay integration for gasless RBTC transactions on mainnet
- WebSocket monitoring for real-time swap status updates
- Multi-network support (mainnet, testnet, regtest)
- HD wallet support (BIP39/BIP44)
- Transaction history loading for RSK and BSC
- TypeScript support with comprehensive type definitions
- Custom storage adapter support for swap persistence
- Framework-agnostic design (works with any JavaScript framework)
- Ethers.js bundled as dependency for seamless installation

### Features
- WalletManager class for unified multi-chain operations
- RSKWallet for Rootstock-specific operations
- BSCWallet for BSC-specific operations
- ReverseSwapService for Lightning → RBTC swaps
- ChainSwapService for L-BTC → RBTC swaps
- BoltzWebSocket for real-time swap monitoring
- Network configuration utilities
- Gas estimation for transactions
- Balance queries with formatted outputs

### Security
- Client-side key management
- No private keys exposed to external services
- Secure mnemonic handling
- BIP39/BIP44 standard compliance

### Note
- Initial release without test coverage - tests planned for v0.2.0

[0.1.0]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.0

