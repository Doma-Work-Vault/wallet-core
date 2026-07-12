import { describe, it, expect, beforeEach, vi } from 'vitest';

// Store token balances keyed by lowercase address
const TOKEN_BALANCES: Record<string, { balance: bigint; decimals: number }> = {
	'0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { balance: BigInt('1000000000'), decimals: 6 },  // USDT0
	'0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { balance: BigInt('50000000'), decimals: 8 },     // WBTC
	'0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40': { balance: BigInt('100000000000000000'), decimals: 18 }, // tBTC
};

// Mock ethers before importing ArbitrumWallet
vi.mock('ethers', () => {
	const formatUnits = (value: bigint, decimals: number): string => {
		const divisor = BigInt(10) ** BigInt(decimals);
		const whole = value / divisor;
		const frac = value % divisor;
		return `${whole}.${frac.toString().padStart(decimals, '0')}`;
	};
	const formatEther = (value: bigint): string => formatUnits(value, 18);
	const parseEther = (value: string): bigint => {
		const [whole, frac = ''] = value.split('.');
		return BigInt(whole + frac.padEnd(18, '0').slice(0, 18));
	};
	const parseUnits = (value: string, decimals: number): bigint => {
		const [whole, frac = ''] = value.split('.');
		return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
	};
	const isAddress = (addr: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(addr);

	return {
		ethers: {
			JsonRpcProvider: vi.fn().mockImplementation(() => ({
				getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
				getBlockNumber: vi.fn().mockResolvedValue(12345),
				getFeeData: vi.fn().mockResolvedValue({ gasPrice: BigInt('20000000000') }),
				estimateGas: vi.fn().mockResolvedValue(BigInt('21000')),
				on: vi.fn(),
				off: vi.fn(),
				pause: vi.fn(),
				resume: vi.fn(),
				destroy: vi.fn(),
			})),
			Wallet: vi.fn().mockImplementation(() => ({
				address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
				sendTransaction: vi.fn().mockResolvedValue({
					hash: '0xabc123',
					wait: vi.fn().mockResolvedValue({ hash: '0xabc123', blockNumber: 12346 }),
				}),
			})),
			HDNodeWallet: {
				fromPhrase: vi.fn().mockReturnValue({
					privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
				}),
			},
			Network: {
				from: vi.fn().mockReturnValue({ chainId: 42161, name: 'arbitrum-one' }),
			},
			Contract: vi.fn().mockImplementation((address: string) => {
				const key = address.toLowerCase();
				const tokenData = TOKEN_BALANCES[key] || { balance: BigInt(0), decimals: 18 };
				return {
					balanceOf: vi.fn().mockResolvedValue(tokenData.balance),
					decimals: vi.fn().mockResolvedValue(tokenData.decimals),
					transfer: vi.fn().mockResolvedValue({
						hash: '0xabc123',
						wait: vi.fn().mockResolvedValue({ hash: '0xabc123', blockNumber: 12346 }),
					}),
				};
			}),
			formatUnits,
			formatEther,
			parseEther,
			parseUnits,
			isAddress,
		},
	};
});

import { ArbitrumWallet, type ArbitrumWalletConfig } from '../../../chains/arbitrum/ArbitrumWallet';

describe('ArbitrumWallet', () => {
	const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Constructor', () => {
		it('should accept config', () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			expect(wallet).toBeDefined();
			expect(wallet.isInitialized()).toBe(false);
		});

		it('should accept config with custom RPC URL', () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet', rpcUrl: 'https://custom-rpc.example.com' });
			expect(wallet).toBeDefined();
		});
	});

	describe('initialize', () => {
		it('should initialize with valid mnemonic', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);
			expect(wallet.isInitialized()).toBe(true);
		});

		it('should throw on empty mnemonic', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await expect(wallet.initialize('')).rejects.toThrow('No mnemonic provided');
		});

		it('should initialize token contracts for all configured tokens', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const supportedTokens = wallet.getSupportedTokens();
			expect(supportedTokens).toContain('USDT0');
			expect(supportedTokens).toContain('WBTC');
			expect(supportedTokens).toContain('TBTC');
		});
	});

	describe('getTokenBalance', () => {
		it('should return USDT0 balance', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const result = await wallet.getTokenBalance('USDT0');
			expect(result.balance).toBe(BigInt('1000000000'));
			expect(result.formattedBalance).toBe('1000.000000');
			expect(result.token.symbol).toBe('USDT0');
			expect(result.token.decimals).toBe(6);
		});

		it('should return WBTC balance', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const result = await wallet.getTokenBalance('WBTC');
			expect(result.balance).toBe(BigInt('50000000'));
			expect(result.token.symbol).toBe('WBTC');
			expect(result.token.decimals).toBe(8);
		});

		it('should return tBTC balance', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const result = await wallet.getTokenBalance('TBTC');
			expect(result.balance).toBe(BigInt('100000000000000000'));
			expect(result.token.symbol).toBe('TBTC');
			expect(result.token.decimals).toBe(18);
		});

		it('should throw for unsupported token', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			await expect(wallet.getTokenBalance('DOGE')).rejects.toThrow('Unsupported token: DOGE');
		});

		it('should throw if not initialized', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await expect(wallet.getTokenBalance('USDT0')).rejects.toThrow('Wallet not initialized');
		});
	});

	describe('getUSDT0Balance (backward compatibility)', () => {
		it('should still work via legacy method', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const result = await wallet.getUSDT0Balance();
			expect(result.balance).toBe(BigInt('1000000000'));
			expect(result.formatted).toBeDefined();
		});
	});

	describe('getAllTokenBalances', () => {
		it('should return balances for all configured tokens', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const balances = await wallet.getAllTokenBalances();
			expect(balances).toHaveLength(3);

			const usdt0 = balances.find((b) => b.token.symbol === 'USDT0');
			const wbtc = balances.find((b) => b.token.symbol === 'WBTC');
			const tbtc = balances.find((b) => b.token.symbol === 'TBTC');

			expect(usdt0).toBeDefined();
			expect(wbtc).toBeDefined();
			expect(tbtc).toBeDefined();
		});
	});

	describe('getBalances (backward compatibility)', () => {
		it('should return ETH and USDT0 balances', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const balances = await wallet.getBalances();
			expect(balances.eth).toBeDefined();
			expect(balances.usdt0).toBeDefined();
			expect(balances.eth.balance).toBe(BigInt('1000000000000000000'));
			expect(balances.usdt0.balance).toBe(BigInt('1000000000'));
		});
	});

	describe('getSupportedTokens', () => {
		it('should return empty array before initialization', () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			expect(wallet.getSupportedTokens()).toEqual([]);
		});

		it('should return all configured token symbols after init', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const tokens = wallet.getSupportedTokens();
			expect(tokens).toContain('USDT0');
			expect(tokens).toContain('WBTC');
			expect(tokens).toContain('TBTC');
		});
	});

	describe('getTokenContract', () => {
		it('should return contract for supported token', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const contract = wallet.getTokenContract('WBTC');
			expect(contract).not.toBeNull();
		});

		it('should return null for unsupported token', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const contract = wallet.getTokenContract('DOGE');
			expect(contract).toBeNull();
		});
	});

	describe('sendToken', () => {
		it('should send WBTC transfer', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			const txHash = await wallet.sendToken('WBTC', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', '0.001');
			expect(txHash).toBe('0xabc123');
		});

		it('should throw for unsupported token', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			await expect(wallet.sendToken('DOGE', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', '1')).rejects.toThrow(
				'Unsupported token: DOGE'
			);
		});

		it('should throw for invalid recipient', async () => {
			const wallet = new ArbitrumWallet({ network: 'mainnet' });
			await wallet.initialize(testMnemonic);

			await expect(wallet.sendToken('USDT0', 'not-an-address', '1')).rejects.toThrow('Invalid recipient address');
		});
	});

	describe('testnet (no tokens configured)', () => {
		it('should have empty supported tokens on testnet', async () => {
			const wallet = new ArbitrumWallet({ network: 'testnet' });
			await wallet.initialize(testMnemonic);

			const tokens = wallet.getSupportedTokens();
			expect(tokens).toEqual([]);
		});

		it('should throw for unconfigured token on testnet', async () => {
			const wallet = new ArbitrumWallet({ network: 'testnet' });
			await wallet.initialize(testMnemonic);

			await expect(wallet.getTokenBalance('USDT0')).rejects.toThrow('Unsupported token: USDT0');
		});

		it('should return zero via getUSDT0Balance on testnet (backward compat)', async () => {
			const wallet = new ArbitrumWallet({ network: 'testnet' });
			await wallet.initialize(testMnemonic);

			const result = await wallet.getUSDT0Balance();
			expect(result.balance).toBe(BigInt(0));
			expect(result.formatted).toBe('0.000000');
		});
	});
});
