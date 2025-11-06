# Changelog

All notable changes to @bittasker/wallet-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-XX

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

