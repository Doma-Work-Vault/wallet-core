# Changelog

All notable changes to @bittasker/wallet-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2025-01-07

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

## [0.1.0] - 2025-01-06

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

