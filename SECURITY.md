# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in @bittasker/wallet-core, please report it responsibly.

### How to Report

**DO NOT** open a public issue for security vulnerabilities.

Instead, please email: **security@bittasker.com**

Include in your report:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Affected versions
- Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity (critical issues prioritized)

### Security Best Practices

When using this SDK:

1. **Never expose mnemonics**: Always use secure storage for seed phrases
2. **Validate addresses**: Use `ethers.isAddress()` before sending transactions
3. **Test on testnet**: Always test thoroughly on testnet before mainnet
4. **Backup mnemonics**: Ensure users backup their 12-word recovery phrase
5. **Use hardware wallets**: For production apps with significant funds
6. **Keep dependencies updated**: Regularly update to latest SDK version
7. **Encrypt sensitive data**: Use proper encryption for stored credentials

### Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ Yes             |

### Known Security Considerations

- This SDK handles private keys and mnemonics - implement proper key management
- WebSocket connections to Boltz are not encrypted by default - ensure TLS in production
- RIF Relay transactions are gasless but require proper authorization
- Always validate transaction parameters before signing

### Security Audit

This package has not yet undergone a formal security audit. Use at your own risk and consider a professional audit before using in production with significant funds.

### Disclosure Policy

- We will acknowledge receipt of your report within 48 hours
- We will provide regular updates on our progress
- We will credit researchers who report valid vulnerabilities (unless they prefer to remain anonymous)
- Once a fix is available, we will coordinate disclosure timing with the reporter

Thank you for helping keep @bittasker/wallet-core and the Bitcoin economy secure!

