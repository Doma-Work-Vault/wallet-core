# Contributing to @bittasker/wallet-core

Thank you for your interest in contributing to BitTasker's multi-chain wallet SDK!

## Development Setup

1. Clone the repository:
```bash
git clone https://gitlab.com/bittasker/wallet-core.git
cd wallet-core
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Development Workflow

- **Build**: `npm run build` - Compiles TypeScript to JavaScript
- **Watch mode**: `npm run dev` - Auto-rebuild on file changes

## Code Standards

- Use TypeScript for all code
- Follow existing code style and conventions
- Add JSDoc comments for public APIs
- Maintain backward compatibility
- Update README for new features

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes with clear, descriptive commits
4. Ensure build passes: `npm run build`
5. Update documentation as needed
6. Submit a pull request to the `main` branch

## Commit Message Convention

Use conventional commits format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test updates

Example: `feat: add support for custom RPC endpoints`

## Reporting Issues

Please use GitLab Issues with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Relevant error messages or logs

## Feature Requests

We welcome feature requests! Please:

- Check existing issues first to avoid duplicates
- Clearly describe the use case
- Explain why this would be valuable
- Provide examples if possible

## Testing Contributions

We're building a comprehensive test suite for v0.2.0. If you'd like to contribute tests:

- Write unit tests for utilities and formatters
- Create integration tests for wallet operations (using testnet)
- Mock external dependencies (RPC providers, Boltz API)

## Questions?

- Open a discussion in GitLab Issues
- Join our Discord: https://discord.gg/bittasker
- Email: developers@bittasker.com

Thank you for contributing to the Bitcoin economy!

