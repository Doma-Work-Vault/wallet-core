# Changelog

All notable changes to @bittasker/wallet-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] 2025-11-11

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

[0.1.3]: https://gitlab.com/bittasker/wallet-core/-/tags/v0.1.3

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

