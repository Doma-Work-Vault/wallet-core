# Security Audit Report
**Date:** 2024  
**Project:** @bittasker/wallet-core  
**Version:** 0.1.0

## Executive Summary

This security audit identified **2 critical issues**, **3 high-priority issues**, and **3 medium-priority issues** that should be addressed before production deployment. The codebase demonstrates good security practices in many areas (address validation in transaction sending, proper use of crypto.randomBytes, etc.), but several vulnerabilities could lead to application crashes, fund loss, or data exposure.

## Critical Issues 🔴

### 1. WebSocket JSON Parsing Without Error Handling
**Severity:** Critical  
**Location:** `src/swaps/boltz/WebSocketClient.ts:47`

**Issue:**
```typescript
this.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);  // ⚠️ No try-catch
    console.log('📨 Boltz WebSocket message:', data);
    this.handleMessage(data);
};
```

**Risk:** Malformed JSON from WebSocket can crash the application or cause denial of service.

**Recommendation:**
```typescript
this.ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log('📨 Boltz WebSocket message:', data);
        this.handleMessage(data);
    } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        // Optionally: disconnect and reconnect
    }
};
```

---

### 2. Missing Address Validation in Swap Services
**Severity:** Critical  
**Locations:**
- `src/swaps/boltz/ReverseSwapService.ts:177`
- `src/swaps/boltz/ChainSwapService.ts:164`

**Issue:** Addresses (`rbtcAddress`, `claimAddress`) are used directly without validation before being sent to APIs or used in transactions.

**Risk:** Invalid addresses could cause failed transactions, fund loss, or API errors.

**Recommendation:**
```typescript
// In ReverseSwapService.createReverseSwap and ChainSwapService.createChainSwap
if (!ethers.isAddress(params.rbtcAddress)) {
    throw new Error('Invalid RBTC address format');
}
```

---

## High-Priority Issues 🟠

### 3. API Key Exposure in URL Parameters
**Severity:** High  
**Location:** `src/chains/bsc/BSCTransactions.ts:29,96`

**Issue:**
```typescript
const bnbUrl = `${explorerApiUrl}?...&apikey=${apiKey}`;
```

**Risk:** API keys in URL parameters can be:
- Logged in server access logs
- Stored in browser history
- Exposed in HTTP referrer headers
- Visible in network monitoring tools

**Recommendation:** Use Authorization headers instead:
```typescript
const response = await fetch(bnbUrl, {
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        // or 'X-API-Key': apiKey
    }
});
```

---

### 4. Sensitive Data in Console Logs
**Severity:** High  
**Locations:**
- `src/swaps/boltz/ChainSwapService.ts:161` - Logs refund keys
- `src/swaps/boltz/ReverseSwapService.ts:159` - Logs swap details with addresses
- Multiple other locations

**Issue:** Console.log statements expose sensitive information that could be logged in production.

**Risk:** 
- Private keys, addresses, and swap details exposed in logs
- Compliance violations (GDPR, etc.)
- Information leakage to attackers

**Recommendation:**
1. Remove sensitive data from logs
2. Use environment-based logging:
```typescript
if (process.env.NODE_ENV === 'development') {
    console.log('🔍 Refund key:', refundKey);
}
```
3. Consider using a proper logging library with log levels

---

### 5. Missing Input Validation for Swap Amounts
**Severity:** High  
**Locations:**
- `src/swaps/boltz/ReverseSwapService.ts:126`
- `src/swaps/boltz/ChainSwapService.ts:156`

**Issue:** No validation for `amountSats` parameter (could be negative, zero, or extremely large).

**Risk:** Invalid amounts could cause:
- Failed transactions
- Unexpected behavior
- Potential integer overflow issues

**Recommendation:**
```typescript
if (!params.amountSats || params.amountSats <= 0) {
    throw new Error('Amount must be greater than 0');
}
if (params.amountSats > Number.MAX_SAFE_INTEGER) {
    throw new Error('Amount exceeds maximum safe value');
}
// Optionally: Check against swap limits from API
```

---

## Medium-Priority Issues 🟡

### 6. Preimage Storage in Swap Data
**Severity:** Medium  
**Location:** `src/swaps/boltz/types.ts:332,351,398`

**Issue:** Preimages are stored in swap data structures that may be persisted to storage.

**Risk:** If storage is compromised, preimages could be stolen, allowing unauthorized swap claims.

**Recommendation:**
- Encrypt preimages before storage
- Use secure storage mechanisms (hardware security modules, encrypted storage)
- Consider not storing preimages at all if they can be regenerated

---

### 7. Insecure WebSocket in Regtest Config
**Severity:** Medium  
**Location:** `src/utils/networkConfig.ts:96`

**Issue:**
```typescript
boltzWsUrl: 'ws://localhost:9001/v2/ws',  // ⚠️ Not encrypted
```

**Risk:** Acceptable for local development, but should be clearly documented and prevented in production.

**Recommendation:**
- Add runtime check to prevent non-WSS connections in production
- Document that regtest config is development-only

---

### 8. Missing HTTPS Enforcement
**Severity:** Medium  
**Location:** Network configuration

**Issue:** No explicit checks to ensure production uses HTTPS/WSS.

**Risk:** Accidental use of insecure connections in production.

**Recommendation:**
```typescript
if (network === 'mainnet' && !url.startsWith('https://') && !url.startsWith('wss://')) {
    throw new Error('Production network must use HTTPS/WSS');
}
```

---

## Positive Security Practices ✅

The codebase demonstrates several good security practices:

1. ✅ **Proper use of crypto.randomBytes** - Using Node.js crypto module for random number generation
2. ✅ **Address validation in transaction sending** - `RSKWallet.send()` and `BSCWallet.sendBNB()` validate addresses
3. ✅ **Balance checks before transactions** - Checks sufficient balance including gas fees
4. ✅ **Input validation in BoltzClient** - Validates preimage hashes, public keys, etc.
5. ✅ **Rate limiting** - Implements rate limiting for API requests
6. ✅ **Secure key derivation** - Uses HMAC-based key derivation for swap keys
7. ✅ **No hardcoded secrets** - No API keys or private keys hardcoded in source

---

## Recommendations Summary

### Immediate Actions (Before Production):
1. ✅ Fix WebSocket JSON parsing error handling
2. ✅ Add address validation in swap services
3. ✅ Remove sensitive data from console logs
4. ✅ Add input validation for swap amounts
5. ✅ Move API keys from URL params to headers

### Short-term Improvements:
6. ✅ Encrypt preimages before storage
7. ✅ Add HTTPS/WSS enforcement for production
8. ✅ Implement comprehensive logging framework
9. ✅ Add transaction confirmation flows
10. ✅ Consider adding transaction signing callbacks

### Long-term Enhancements:
11. ✅ Security audit by third-party firm
12. ✅ Implement comprehensive test coverage
13. ✅ Add monitoring and alerting for security events
14. ✅ Create security incident response plan
15. ✅ Regular dependency security updates

---

## Testing Recommendations

1. **Fuzz Testing:** Test WebSocket message parsing with malformed inputs
2. **Input Validation Testing:** Test all public methods with invalid inputs
3. **Penetration Testing:** Test swap flows for potential vulnerabilities
4. **Dependency Scanning:** Regularly scan for vulnerable dependencies

---

## Compliance Considerations

- **GDPR:** Ensure no PII is logged without consent
- **Financial Regulations:** Consider regulatory requirements for financial transactions
- **Data Protection:** Encrypt sensitive data at rest and in transit

---

## Conclusion

While the codebase shows good security awareness, the identified issues should be addressed before production deployment, especially the critical WebSocket parsing and address validation issues. The high-priority logging and API key issues should also be fixed promptly to prevent data exposure.

**Overall Security Rating:** 🟡 **Medium** - Good foundation, but needs fixes before production.

---

## Additional Issues Found 🔍

### 9. Race Condition in Concurrent Swap Claims
**Severity:** High  
**Location:** `src/swaps/boltz/ChainSwapService.ts:343`, `src/swaps/boltz/ReverseSwapService.ts:296-348`

**Issue:** Multiple WebSocket events (`transaction.confirmed`, `transaction.server.confirmed`) can trigger concurrent claim attempts for the same swap. No locking mechanism prevents simultaneous claim transactions.

**Risk:** 
- Multiple claim transactions could be submitted
- Wasted gas fees
- Potential transaction failures
- Race conditions in status updates

**Recommendation:**
```typescript
private claimingSwaps: Set<string> = new Set();

private async attemptClaim(swapData: ChainSwapData): Promise<void> {
    // Prevent concurrent claims
    if (this.claimingSwaps.has(swapData.id)) {
        console.warn('⚠️ Claim already in progress for swap:', swapData.id);
        return;
    }
    
    this.claimingSwaps.add(swapData.id);
    try {
        // ... existing claim logic ...
    } finally {
        this.claimingSwaps.delete(swapData.id);
    }
}
```

---

### 10. Memory Leak in WebSocket Reconnection
**Severity:** Medium  
**Location:** `src/swaps/boltz/WebSocketClient.ts:195`

**Issue:** `setTimeout` in `handleReconnect()` is not tracked or cleared if WebSocket is closed/disconnected before timeout fires.

**Risk:** 
- Memory leaks in long-running applications
- Orphaned timers continue running
- Potential reconnection attempts after cleanup

**Recommendation:**
```typescript
private reconnectTimeoutId: NodeJS.Timeout | null = null;

private handleReconnect(): void {
    // Clear existing timeout if any
    if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
    }
    
    // ... existing logic ...
    
    this.reconnectTimeoutId = setTimeout(async () => {
        this.reconnectTimeoutId = null;
        // ... rest of logic ...
    }, delay);
}

disconnect(): void {
    if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
    }
    // ... existing disconnect logic ...
}
```

---

### 11. Missing Error Handling in JSON Response Parsing
**Severity:** Medium  
**Location:** `src/swaps/rif/Relay.ts:45-52`

**Issue:** `handleResponse` doesn't handle JSON parsing errors or non-JSON responses.

**Risk:** 
- Application crashes on malformed responses
- No graceful error handling
- Potential DoS from malformed API responses

**Recommendation:**
```typescript
const handleResponse = async <T>(res: Response): Promise<T> => {
    let json;
    try {
        json = await res.json();
    } catch (error) {
        throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    if ('error' in json) {
        throw json.error;
    }
    
    return json as T;
};
```

---

### 12. Excessive Use of `any` Type Reduces Type Safety
**Severity:** Medium  
**Locations:** Multiple files (80+ instances)

**Issue:** Extensive use of `any` type throughout the codebase reduces TypeScript's type safety benefits.

**Risk:**
- Runtime errors that could be caught at compile time
- Reduced IDE autocomplete and error detection
- Harder to maintain and refactor code
- Potential type-related bugs

**Examples:**
- `src/swaps/boltz/ChainSwapService.ts:153` - `walletSigner?: any`
- `src/swaps/boltz/storage.ts:15` - `save(swapId: string, data: any)`
- `src/swaps/boltz/BoltzClient.ts:1595` - `body?: any`

**Recommendation:** Replace `any` with proper types:
```typescript
// Instead of:
walletSigner?: any

// Use:
walletSigner?: ethers.Signer

// Instead of:
save(swapId: string, data: any)

// Use:
save(swapId: string, data: SwapData)
```

---

### 13. No Protection Against Double Claiming
**Severity:** Medium  
**Location:** `src/swaps/boltz/ReverseSwapService.ts:565`, `src/swaps/boltz/ChainSwapService.ts:527`

**Issue:** Claim methods don't check if swap was already claimed before attempting to claim again.

**Risk:**
- Unnecessary transaction attempts
- Wasted gas fees
- Confusing error messages for users

**Recommendation:**
```typescript
async claimRBTC(swapData: BoltzSwapData, walletSigner?: any): Promise<{ txHash: string }> {
    // Check if already claimed
    if (swapData.status === 'claimed' || swapData.status === 'transaction.claimed') {
        throw new Error('Swap already claimed');
    }
    
    if (swapData.claimTxHash) {
        throw new Error(`Swap already claimed in transaction: ${swapData.claimTxHash}`);
    }
    
    // ... rest of claim logic ...
}
```

---

### 14. Missing Input Validation in API Response Handling
**Severity:** Low  
**Location:** `src/swaps/boltz/ReverseSwapService.ts:186`, `src/chains/rsk/RSKTransactions.ts:49`

**Issue:** API responses are used without validating structure or required fields.

**Risk:**
- Runtime errors from unexpected response formats
- Potential crashes if API changes
- Hard to debug issues

**Recommendation:** Add response validation:
```typescript
const swapResponse = await response.json();

// Validate response structure
if (!swapResponse.id || !swapResponse.invoice || !swapResponse.onchainAmount) {
    throw new Error('Invalid swap response structure');
}
```

---

### 15. Potential Integer Overflow in Amount Calculations
**Severity:** Low  
**Location:** `src/swaps/boltz/ChainSwapService.ts:156`, `src/swaps/boltz/ReverseSwapService.ts:126`

**Issue:** `amountSats` is a `number` type which can only safely represent integers up to `Number.MAX_SAFE_INTEGER` (2^53 - 1). Large satoshi amounts could lose precision.

**Risk:**
- Precision loss for very large amounts
- Incorrect swap amounts
- Potential fund loss

**Recommendation:** Use `bigint` for amounts:
```typescript
async createChainSwap(params: {
    amountSats: bigint; // Instead of number
    rbtcAddress: string;
    walletSigner?: ethers.Signer;
}): Promise<{ swapId: string; liquidUri: string; swapData: ChainSwapData }> {
    if (params.amountSats <= 0n) {
        throw new Error('Amount must be greater than 0');
    }
    // ... rest of logic ...
}
```

---

### 16. Missing Cleanup in Error Scenarios
**Severity:** Low  
**Location:** Multiple swap service files

**Issue:** When errors occur during swap operations, some resources (WebSocket subscriptions, timers, etc.) may not be properly cleaned up.

**Risk:**
- Resource leaks
- Memory accumulation over time
- Orphaned subscriptions

**Recommendation:** Ensure cleanup in finally blocks:
```typescript
try {
    // ... swap operation ...
} catch (error) {
    // Handle error
} finally {
    // Cleanup resources
    if (needsCleanup) {
        this.cleanup();
    }
}
```

---

## Code Quality Issues 📝

### 17. Inconsistent Error Messages
**Severity:** Low  
**Location:** Throughout codebase

**Issue:** Error messages vary in format and detail level, making debugging harder.

**Recommendation:** Standardize error messages and use custom error classes consistently.

---

### 18. Missing JSDoc Documentation
**Severity:** Low  
**Location:** Many public methods

**Issue:** Some public methods lack comprehensive JSDoc comments explaining parameters, return values, and potential errors.

**Recommendation:** Add JSDoc comments to all public APIs.

---

### 19. No Unit Tests
**Severity:** Medium  
**Location:** Project-wide

**Issue:** No test files found in the codebase. While `vitest` is in devDependencies, no tests are implemented.

**Risk:**
- No regression testing
- Hard to verify fixes
- No confidence in refactoring

**Recommendation:** Add comprehensive unit tests, especially for:
- Swap creation and claiming logic
- Address validation
- Error handling
- WebSocket message parsing

---

## Summary of Additional Issues

- **High Priority:** 1 issue (race condition in claims)
- **Medium Priority:** 5 issues (memory leaks, type safety, error handling)
- **Low Priority:** 4 issues (validation, cleanup, documentation)

**Total Additional Issues:** 10

---

*This audit was performed automatically. For a comprehensive security review, consider engaging a professional security audit firm.*

