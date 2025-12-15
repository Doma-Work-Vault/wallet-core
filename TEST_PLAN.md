# Unit Test Suite Implementation Plan

## Overview

This document outlines a comprehensive plan to implement a full unit test suite for `@bittasker/wallet-core`. Tests are organized into groups that build upon each other, ensuring dependencies are tested before dependent components.

## Test Framework Setup

- **Framework**: Vitest (already in devDependencies)
- **Coverage Tool**: Vitest built-in coverage
- **Mocking**: Vitest mocks + manual mocks for external dependencies
- **Test Location**: `src/**/*.test.ts` (co-located with source files)

## Test Groups (Sequential Implementation)

### ✅ Group 1: Foundation & Utilities (No Dependencies)
**Status**: Must complete before moving to Group 2

**Files to Test:**
- `src/core/EventEmitter.ts`
- `src/core/types.ts` (type validation tests)
- `src/swaps/boltz/storage.ts` (InMemorySwapStorage)

**Test Coverage:**
1. **EventEmitter**
   - ✅ Constructor with initial state
   - ✅ `getState()` returns current state
   - ✅ `setState()` with partial update
   - ✅ `setState()` with updater function
   - ✅ `subscribe()` adds listener and calls immediately
   - ✅ `subscribe()` returns unsubscribe function
   - ✅ Unsubscribe removes listener
   - ✅ State changes notify all listeners
   - ✅ Multiple listeners receive updates
   - ✅ Unsubscribed listeners don't receive updates

2. **Types** (Type validation/guards if any)
   - ✅ NetworkType validation
   - ✅ Type exports are correct

3. **InMemorySwapStorage**
   - ✅ Constructor initializes empty storage
   - ✅ `save()` stores swap data
   - ✅ `get()` retrieves swap data
   - ✅ `get()` returns null for non-existent swap
   - ✅ `getAll()` returns all swaps
   - ✅ `delete()` removes swap
   - ✅ `clear()` removes all swaps

**Dependencies to Mock:**
- None (pure TypeScript/JavaScript)

**Success Criteria:**
- All tests pass
- 100% code coverage for these files
- No test failures or warnings

---

### ✅ Group 2: Network Configuration (Depends on Group 1)
**Status**: Must complete before moving to Group 3

**Files to Test:**
- `src/utils/networkConfig.ts`

**Test Coverage:**
1. **Network Getter Functions**
   - ✅ `setNetworkGetter()` sets the getter
   - ✅ `getNetwork()` returns current network
   - ✅ `getNetwork()` defaults to 'testnet' if getter not set
   - ✅ `getNetwork()` warns when getter not set

2. **RSK Network Configuration**
   - ✅ `getRSKConfig()` returns correct config for mainnet
   - ✅ `getRSKConfig()` returns correct config for testnet
   - ✅ `getRSKConfig()` returns correct config for regtest
   - ✅ `RSK_NETWORKS` has all required properties

3. **BSC Network Configuration**
   - ✅ `getBSCConfig()` returns correct config for mainnet
   - ✅ `getBSCConfig()` returns correct config for testnet
   - ✅ `getBSCConfig()` maps regtest to testnet
   - ✅ `BSC_NETWORKS` has all required properties

4. **Boltz Network Configuration**
   - ✅ `getBoltzConfig()` returns correct config for mainnet
   - ✅ `getBoltzConfig()` returns correct config for regtest
   - ✅ `getBoltzConfig()` falls back to regtest for testnet
   - ✅ `BOLTZ_NETWORKS` has all required properties

5. **Helper Functions**
   - ✅ `getUSDTToken()` returns USDT token for BSC
   - ✅ `getMulticallAddress()` returns correct address
   - ✅ `isRifRelayAvailable()` returns correct availability
   - ✅ `getWebSocketEndpoint()` returns correct endpoint
   - ✅ `satoshiToWei()` converts correctly
   - ✅ `weiToSatoshi()` converts correctly
   - ✅ `getLiquidAssetId()` returns correct asset IDs

6. **Constants**
   - ✅ `FEE_TIERS` has correct structure
   - ✅ `TIMELOCK_PERIODS` has correct values
   - ✅ `ERC20_ABI` is valid ABI array
   - ✅ `PAYMASTER_ABI` is valid ABI array

**Dependencies to Mock:**
- None (pure configuration)

**Success Criteria:**
- All tests pass
- 100% code coverage
- Network getter state is properly isolated between tests

---

### ✅ Group 3: Chain Wallets - RSK (Depends on Groups 1-2)
**Status**: Must complete before moving to Group 4

**Files to Test:**
- `src/chains/rsk/RSKWallet.ts`
- `src/chains/rsk/RSKTransactions.ts` (if testable utilities)

**Test Coverage:**
1. **Constructor & Initialization**
   - ✅ Constructor accepts config
   - ✅ Constructor sets config correctly
   - ✅ `initialize()` with valid mnemonic succeeds
   - ✅ `initialize()` throws on empty mnemonic
   - ✅ `initialize()` creates provider with correct network
   - ✅ `initialize()` creates wallet with RSK derivation path
   - ✅ `initialize()` does NOT test RPC connection (performance optimization)
   - ✅ `isInitialized()` returns false before init
   - ✅ `isInitialized()` returns true after init

2. **Wallet Address**
   - ✅ `getAddress()` returns correct address
   - ✅ `getAddress()` throws if not initialized

3. **Balance Operations**
   - ✅ `getBalance()` returns balance structure
   - ✅ `getBalance()` formats balance correctly
   - ✅ `getBalance()` throws if not initialized

4. **Block Operations**
   - ✅ `getBlockNumber()` returns block number
   - ✅ `getBlockNumber()` throws if not initialized
   - ✅ `onBlock()` subscribes to block events
   - ✅ `onBlock()` returns unsubscribe function
   - ✅ Unsubscribe stops receiving events

5. **Transaction Operations**
   - ✅ `send()` validates recipient address
   - ✅ `send()` validates amount
   - ✅ `send()` checks balance before sending
   - ✅ `send()` estimates gas correctly
   - ✅ `send()` throws on insufficient balance
   - ✅ `estimateGas()` returns gas estimate
   - ✅ `estimateGas()` throws if not initialized

6. **Provider Management**
   - ✅ `pause()` pauses provider polling
   - ✅ `resume()` resumes provider polling
   - ✅ `disconnect()` cleans up resources
   - ✅ `getProvider()` returns provider instance
   - ✅ `getWallet()` returns wallet instance

**Dependencies to Mock:**
- `ethers` (JsonRpcProvider, Wallet, HDNodeWallet, Network)
- RPC endpoints (mock HTTP responses)

**Success Criteria:**
- All tests pass
- 95%+ code coverage
- RPC calls are properly mocked
- No actual network calls during tests

---

### ✅ Group 4: Chain Wallets - BSC (Depends on Groups 1-3)
**Status**: Must complete before moving to Group 5

**Files to Test:**
- `src/chains/bsc/BSCWallet.ts`
- `src/chains/bsc/BSCPaymaster.ts`
- `src/chains/bsc/BSCTransactions.ts` (if testable utilities)

**Test Coverage:**
1. **Constructor & Initialization**
   - ✅ Constructor accepts config
   - ✅ `initialize()` with valid mnemonic succeeds
   - ✅ `initialize()` creates provider with correct network
   - ✅ `initialize()` creates wallet with BSC derivation path
   - ✅ `initialize()` does NOT test RPC connection (performance optimization)
   - ✅ `initialize()` initializes USDT contract if available
   - ✅ `initialize()` initializes paymaster contract if available
   - ✅ `isInitialized()` returns correct state

2. **Wallet Address**
   - ✅ `getAddress()` returns correct address
   - ✅ `getAddress()` throws if not initialized

3. **Balance Operations**
   - ✅ `getBNBBalance()` returns BNB balance
   - ✅ `getUSDTBalance()` returns USDT balance
   - ✅ `getUSDTBalance()` returns zero if contract not initialized
   - ✅ `getBalances()` returns both balances
   - ✅ All balance methods format correctly

4. **Transaction Operations**
   - ✅ `sendBNB()` validates inputs
   - ✅ `sendBNB()` checks balance
   - ✅ `sendBNB()` estimates gas
   - ✅ `sendUSDT()` validates inputs
   - ✅ `sendUSDT()` checks USDT balance
   - ✅ `sendUSDT()` checks BNB for gas
   - ✅ `estimateGasForBNB()` returns estimate

5. **Paymaster Operations**
   - ✅ `getPaymaster()` returns paymaster or null
   - ✅ `canPayFeesInUsdt()` returns correct value
   - ✅ `canPayFeesInUsdt()` handles errors gracefully

6. **Provider Management**
   - ✅ `pause()`, `resume()`, `disconnect()` work correctly
   - ✅ `getProvider()`, `getWallet()`, `getUSDTContract()` work correctly

**Dependencies to Mock:**
- `ethers` (JsonRpcProvider, Wallet, Contract, HDNodeWallet)
- RPC endpoints
- ERC20 contract calls

**Success Criteria:**
- All tests pass
- 95%+ code coverage
- Contract interactions are mocked
- No actual network calls

---

### ✅ Group 5: Boltz Client & WebSocket (Depends on Groups 1-2)
**Status**: Must complete before moving to Group 6

**Files to Test:**
- `src/swaps/boltz/BoltzClient.ts`
- `src/swaps/boltz/WebSocketClient.ts`

**Test Coverage:**
1. **BoltzClient - Constructor & Configuration**
   - ✅ Constructor initializes with correct config
   - ✅ `getBoltzConfig()` returns correct network config

2. **BoltzClient - Rate Limiting**
   - ✅ Rate limiting enforces max requests per second
   - ✅ Rate limiting resets counter after 1 second

3. **BoltzClient - Swap Pairs**
   - ✅ `getSubmarineSwapPairs()` returns pairs
   - ✅ `getReverseSwapPairs()` returns pairs
   - ✅ `getChainSwapPairs()` returns pairs
   - ✅ All pair methods handle errors correctly

4. **BoltzClient - Swap Creation**
   - ✅ `createSubmarineSwap()` validates inputs
   - ✅ `createSubmarineSwap()` validates Lightning invoice format
   - ✅ `createSubmarineSwap()` requires refund key for UTXO chains
   - ✅ `createSubmarineSwap()` creates swap successfully
   - ✅ `createChainSwap()` validates inputs
   - ✅ `createChainSwap()` validates preimage hash
   - ✅ `createChainSwap()` creates swap successfully

5. **BoltzClient - Swap Status**
   - ✅ `getSwapStatus()` returns status
   - ✅ `checkInvoicePaymentStatus()` returns payment status
   - ✅ Status methods handle errors correctly

6. **BoltzClient - Contract Operations**
   - ✅ `getContractAddresses()` returns addresses
   - ✅ `getContractAddresses()` handles errors

7. **BoltzClient - Error Handling**
   - ✅ `BoltzError` has correct structure
   - ✅ HTTP errors are properly converted to BoltzError
   - ✅ Retry logic works correctly
   - ✅ Timeout handling works

8. **WebSocketClient - Connection**
   - ✅ Constructor accepts endpoint
   - ✅ `connect()` establishes connection
   - ✅ `connect()` handles connection errors
   - ✅ `disconnect()` closes connection

9. **WebSocketClient - Subscription**
   - ✅ `subscribeToSwap()` subscribes to swap updates
   - ✅ `subscribeToSwap()` throws if not connected
   - ✅ `unsubscribeFromSwap()` removes subscription
   - ✅ `ping()` sends ping message

10. **WebSocketClient - Message Handling**
    - ✅ Handles swap update messages
    - ✅ Calls registered callbacks
    - ✅ Handles reconnection logic
    - ✅ Re-subscribes after reconnection

**Dependencies to Mock:**
- `fetch` API (for HTTP requests)
- `WebSocket` (for WebSocket connections)
- Network responses

**Success Criteria:**
- All tests pass
- 90%+ code coverage
- All HTTP/WebSocket calls are mocked
- Error scenarios are tested

---

### ✅ Group 6: EVM Contract Service (Depends on Groups 1-2, 5)
**Status**: ✅ Completed (44/44 tests passing)

**Files to Test:**
- `src/swaps/boltz/EvmContractService.ts`

**Test Coverage:**
1. **Constructor & Initialization**
   - ✅ Constructor accepts BoltzClient
   - ✅ Constructor creates client if not provided

2. **Contract Address**
   - ✅ `getEtherSwapAddress()` returns address
   - ✅ `getEtherSwapAddress()` handles errors

3. **Lockup Operations**
   - ✅ `lockFunds()` validates parameters
   - ✅ `lockFunds()` converts satoshis to wei
   - ✅ `lockFunds()` calls contract lock function
   - ✅ `lockFunds()` returns transaction hash
   - ✅ `estimateLockupGas()` returns estimate

4. **Claim Operations**
   - ✅ `claimFunds()` validates parameters
   - ✅ `claimFunds()` calls contract claim function
   - ✅ `claimFunds()` handles "no Ether locked" error
   - ✅ `estimateClaimGas()` returns estimate

5. **Refund Operations**
   - ✅ `refundFunds()` validates parameters
   - ✅ `refundFunds()` calls contract refund function
   - ✅ `estimateRefundGas()` returns estimate

6. **Event Parsing**
   - ✅ `getLockupEventParameters()` parses events correctly
   - ✅ `getLockupEventParameters()` handles missing receipt
   - ✅ `getLockupEventParameters()` handles missing event

7. **Balance Checks**
   - ✅ `hasSufficientBalance()` checks balance correctly
   - ✅ `hasSufficientBalance()` includes gas estimate

**Dependencies to Mock:**
- `ethers` (Contract, Interface, Provider)
- BoltzClient (for contract addresses)
- Contract method calls
- Transaction receipts and events

**Success Criteria:**
- All tests pass
- 90%+ code coverage
- Contract interactions are mocked
- Event parsing is tested thoroughly

---

### ✅ Group 7: Swap Services (Depends on Groups 1-6)
**Status**: ✅ COMPLETED

**Files to Test:**
- `src/swaps/boltz/ReverseSwapService.ts`
- `src/swaps/boltz/ChainSwapService.ts`
- `src/swaps/boltz/SubmarineSwapService.ts`
- `src/swaps/boltz/ChainSwapRefundService.ts`
- `src/swaps/boltz/SubmarineSwapRefundService.ts`
- `src/swaps/boltz/RifRelayClaimService.ts`

**Test Coverage:**

#### ReverseSwapService
1. **Initialization**
   - ✅ Constructor accepts dependencies
   - ✅ `setWalletGetter()` sets getter

2. **Swap Creation**
   - ✅ `createSwap()` generates preimage and hash
   - ✅ `createSwap()` creates swap with Boltz
   - ✅ `createSwap()` stores swap data
   - ✅ `createSwap()` subscribes to updates

3. **Swap Limits**
   - ✅ `getSwapLimits()` returns limits

4. **Swap Monitoring**
   - ✅ Handles swap status updates
   - ✅ Auto-claims when lockup detected
   - ✅ Handles invoice settlement

#### ChainSwapService
1. **Initialization**
   - ✅ Constructor accepts dependencies
   - ✅ `setWalletGetter()` sets getter

2. **Swap Creation**
   - ✅ `createSwap()` validates inputs
   - ✅ `createSwap()` creates swap with Boltz
   - ✅ `createSwap()` stores swap data

3. **Swap Limits**
   - ✅ `getSwapLimits()` returns limits

4. **Claiming**
   - ✅ `claimSwap()` uses RIF Relay if available
   - ✅ `claimSwap()` falls back to direct claim
   - ✅ `claimSwap()` handles errors

#### SubmarineSwapService
1. **Initialization**
   - ✅ Constructor accepts dependencies

2. **Swap Creation**
   - ✅ `createSwap()` validates invoice
   - ✅ `createSwap()` creates swap with Boltz
   - ✅ `createSwap()` stores swap data

3. **Swap Limits**
   - ✅ `getSwapLimits()` returns limits

#### Refund Services
1. **ChainSwapRefundService**
   - ✅ `checkRefundability()` checks if refundable
   - ✅ `refund()` builds refund transaction
   - ✅ `refund()` handles errors

2. **SubmarineSwapRefundService**
   - ✅ `checkRefundability()` checks if refundable
   - ✅ `refund()` builds refund transaction
   - ✅ Handles RBTC, BTC, and L-BTC refunds

**Dependencies to Mock:**
- BoltzClient
- WebSocketClient
- EvmContractService
- Wallet/Signer
- Storage adapters
- External libraries (boltz-core, liquidjs-lib, bitcoinjs-lib)

**Success Criteria:**
- All tests pass
- 85%+ code coverage
- Complex swap flows are tested
- Error scenarios are covered

---

### ✅ Group 8: RIF Relay Services (Depends on Groups 1-2, 5-6)
**Status**: Must complete before moving to Group 9

**Files to Test:**
- `src/swaps/rif/Signer.ts`
- `src/swaps/rif/Contracts.ts`
- `src/swaps/rif/Relay.ts`
- `src/swaps/rif/Utils.ts`

**Test Coverage:**
1. **Signer**
   - ✅ `getSmartWalletAddress()` calculates address
   - ✅ `relayClaimTransaction()` signs transaction

2. **Contracts**
   - ✅ `getForwarder()` returns forwarder contract
   - ✅ `getSmartWalletFactory()` returns factory contract

3. **Relay**
   - ✅ `estimate()` estimates gas
   - ✅ `relay()` relays transaction
   - ✅ `getChainInfo()` returns chain info

4. **Utils**
   - ✅ Utility functions work correctly

**Dependencies to Mock:**
- `ethers` (Contract, Provider)
- RIF Relay API endpoints
- Contract calls

**Success Criteria:**
- All tests pass
- 85%+ code coverage
- API calls are mocked

---

### ✅ Group 9: WalletManager Integration (Depends on All Groups)
**Status**: Final integration tests

**Files to Test:**
- `src/core/WalletManager.ts`

**Test Coverage:**
1. **Constructor**
   - ✅ Constructor accepts config
   - ✅ Constructor sets network getter
   - ✅ Constructor creates WebSocket instance (lightweight)
   - ✅ Constructor does NOT create swap services (lazy loading)

2. **Initialization**
   - ✅ `initialize()` initializes RSK wallet
   - ✅ `initialize()` initializes BSC wallet in parallel
   - ✅ `initialize()` does NOT connect WebSocket (deferred)
   - ✅ `initialize()` handles initialization errors
   - ✅ Parallel initialization improves performance

3. **Lazy Loading**
   - ✅ `boltzClient` getter creates client on first access
   - ✅ `evmContractService` getter creates service on first access
   - ✅ `reverseSwapService` getter creates service on first access
   - ✅ `chainSwapService` getter creates service on first access
   - ✅ `submarineSwapService` getter creates service on first access
   - ✅ Services connect WebSocket when created
   - ✅ Services set wallet getters if wallets initialized

4. **Wallet Access**
   - ✅ `rskWallet` getter returns wallet
   - ✅ `rskWallet` getter throws if not initialized
   - ✅ `bscWallet` getter returns wallet
   - ✅ `bscWallet` getter throws if not initialized
   - ✅ `getRSKWallet()` returns signer
   - ✅ `getBSCWallet()` returns signer

5. **Balance Operations**
   - ✅ `getBalances()` returns all balances
   - ✅ `getBalances()` formats correctly

6. **Address Operations**
   - ✅ `getAddresses()` returns RSK and BSC addresses

7. **Swap Operations**
   - ✅ `getSwapLimits()` returns limits for all swap types
   - ✅ `getSwapLimits()` lazy-loads services

8. **WebSocket Connection**
   - ✅ `connectSwapMonitoring()` connects WebSocket
   - ✅ WebSocket connects lazily when services accessed

9. **Cleanup**
   - ✅ `dispose()` cleans up resources

10. **Error Handling**
    - ✅ Handles wallet initialization errors
    - ✅ Handles service creation errors
    - ✅ Handles WebSocket connection errors

**Dependencies to Mock:**
- All previous dependencies
- RSKWallet
- BSCWallet
- All swap services
- WebSocketClient

**Success Criteria:**
- All tests pass
- 90%+ code coverage
- Integration flows work correctly
- Lazy loading is verified
- Performance optimizations are validated

---

## Test Infrastructure

### Setup Files
- `vitest.config.ts` - Vitest configuration
- `src/test/setup.ts` - Test setup and global mocks
- `src/test/mocks/` - Mock implementations
  - `ethers.ts` - Ethers.js mocks
  - `websocket.ts` - WebSocket mocks
  - `fetch.ts` - Fetch API mocks

### Test Utilities
- `src/test/utils/` - Test helper functions
  - `createMockProvider.ts` - Mock ethers provider
  - `createMockWallet.ts` - Mock ethers wallet
  - `createMockBoltzClient.ts` - Mock Boltz client
  - `testHelpers.ts` - Common test utilities

### Coverage Configuration
- Minimum coverage: 85% overall
- Critical paths: 95%+ coverage
- Branch coverage: 80%+

## Implementation Checklist

### Phase 1: Setup (Before Group 1)
- [ ] Create `vitest.config.ts`
- [ ] Create `src/test/setup.ts`
- [ ] Create mock utilities
- [ ] Add test script to `package.json`
- [ ] Verify vitest runs successfully

### Phase 2: Foundation Tests (Groups 1-2)
- [ ] Complete Group 1 tests
- [ ] Verify all Group 1 tests pass
- [ ] Complete Group 2 tests
- [ ] Verify all Group 2 tests pass

### Phase 3: Chain Wallet Tests (Groups 3-4)
- [ ] Complete Group 3 tests
- [ ] Verify all Group 3 tests pass
- [ ] Complete Group 4 tests
- [ ] Verify all Group 4 tests pass

### Phase 4: Boltz & EVM Tests (Groups 5-6)
- [ ] Complete Group 5 tests
- [ ] Verify all Group 5 tests pass
- [ ] Complete Group 6 tests
- [ ] Verify all Group 6 tests pass

### Phase 5: Swap Service Tests (Group 7)
- [ ] Complete Group 7 tests
- [ ] Verify all Group 7 tests pass

### Phase 6: RIF Relay Tests (Group 8)
- [ ] Complete Group 8 tests
- [ ] Verify all Group 8 tests pass

### Phase 7: Integration Tests (Group 9)
- [ ] Complete Group 9 tests
- [ ] Verify all Group 9 tests pass
- [ ] Run full test suite
- [ ] Verify coverage targets met

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- src/core/EventEmitter.test.ts

# Run tests for a specific group
npm test -- src/core/
```

## Success Metrics

- ✅ All test groups pass 100%
- ✅ Overall code coverage ≥ 85%
- ✅ Critical path coverage ≥ 95%
- ✅ No flaky tests
- ✅ Tests run in < 30 seconds
- ✅ All mocks are properly isolated
- ✅ No actual network calls during tests

## Notes

- Each group must be fully tested and passing before moving to the next
- Mock all external dependencies (ethers, WebSocket, fetch, etc.)
- Use test fixtures for consistent test data
- Test both success and error paths
- Verify performance optimizations (lazy loading, parallel init) work correctly
- Keep tests isolated and independent

