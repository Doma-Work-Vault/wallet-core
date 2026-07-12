/**
 * Arbitrum Wallet Module
 * Handles Arbitrum (One/Sepolia) wallet operations including ETH and all configured ERC-20 tokens
 * (USDT0, WBTC, tBTC).
 */

import { ethers } from 'ethers';
import type { NetworkType, ERC20Token, TokenBalance } from '../../core/types';
import { ARB_NETWORKS, ERC20_ABI } from '../../utils/networkConfig';

export interface ArbitrumWalletConfig {
	network: Extract<NetworkType, 'mainnet' | 'testnet'>;
	rpcUrl?: string;
	pollingInterval?: number;
	arbiscanApiKey?: string;
}

export class ArbitrumWallet {
	private provider: ethers.JsonRpcProvider | null = null;
	private wallet: ethers.Wallet | null = null;
	private tokenContracts: Map<string, ethers.Contract> = new Map();
	private tokenConfigs: Map<string, ERC20Token> = new Map();
	private config: ArbitrumWalletConfig;
	private blockListeners: ((blockNumber: number) => void)[] = [];

	constructor(config: ArbitrumWalletConfig) {
		this.config = config;
	}

	/**
	 * Initialize Arbitrum wallet from mnemonic
	 * Note: RPC connection test is deferred for faster initialization
	 */
	async initialize(mnemonic: string): Promise<void> {
		try {
			if (!mnemonic) {
				throw new Error('No mnemonic provided');
			}

			// Get network config
			const networkConfig = ARB_NETWORKS[this.config.network];
			const rpcUrl = this.config.rpcUrl || networkConfig.rpcUrl;

			// Create provider with explicit network configuration
			const ethersNetwork = ethers.Network.from({
				name: networkConfig.name.toLowerCase().replace(' ', '-'),
				chainId: networkConfig.chainId
			});

			this.provider = new ethers.JsonRpcProvider(rpcUrl, ethersNetwork, {
				staticNetwork: ethersNetwork,
				batchMaxCount: 1,
				pollingInterval: this.config.pollingInterval || 30000
			});

			// Create wallet from mnemonic with Ethereum derivation path
			const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0");
			this.wallet = new ethers.Wallet(hdNode.privateKey, this.provider);

			// Initialize contracts for ALL configured tokens
			this.tokenContracts.clear();
			this.tokenConfigs.clear();
			for (const token of networkConfig.tokens) {
				const contract = new ethers.Contract(token.address, ERC20_ABI, this.wallet);
				this.tokenContracts.set(token.symbol.toUpperCase(), contract);
				this.tokenConfigs.set(token.symbol.toUpperCase(), token as ERC20Token);
			}
		} catch (error) {
			throw new Error(
				`Arbitrum wallet initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get wallet address
	 */
	getAddress(): string {
		if (!this.wallet) {
			throw new Error('Wallet not initialized');
		}
		return this.wallet.address;
	}

	/**
	 * Get list of supported token symbols for the current network
	 */
	getSupportedTokens(): string[] {
		return Array.from(this.tokenConfigs.keys());
	}

	/**
	 * Get the ERC-20 contract instance for a token (or null if not supported)
	 */
	getTokenContract(symbol: string): ethers.Contract | null {
		return this.tokenContracts.get(symbol.toUpperCase()) ?? null;
	}

	/**
	 * Get balance for any supported token by symbol
	 * @param symbol - Token symbol (e.g. 'USDT0', 'WBTC', 'TBTC')
	 */
	async getTokenBalance(symbol: string): Promise<TokenBalance> {
		if (!this.provider || !this.wallet) {
			throw new Error('Wallet not initialized');
		}

		const key = symbol.toUpperCase();
		const tokenConfig = this.tokenConfigs.get(key);
		const contract = this.tokenContracts.get(key);

		if (!tokenConfig || !contract) {
			throw new Error(`Unsupported token: ${symbol}. Supported: ${this.getSupportedTokens().join(', ')}`);
		}

		try {
			const balance: bigint = await contract.balanceOf(this.wallet.address);
			const decimals: number = await contract.decimals();
			const formatted = parseFloat(ethers.formatUnits(balance, decimals)).toFixed(6);

			return {
				token: tokenConfig,
				balance,
				formattedBalance: formatted
			};
		} catch (error) {
			throw new Error(
				`Failed to get ${symbol} balance: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get USDT0 balance (backward-compatible — delegates to getTokenBalance)
	 */
	async getUSDT0Balance(): Promise<{ balance: bigint; formatted: string }> {
		const hasUSDT0 = this.tokenConfigs.has('USDT0');
		if (!hasUSDT0) {
			return { balance: BigInt(0), formatted: '0.000000' };
		}

		const result = await this.getTokenBalance('USDT0');
		return { balance: result.balance, formatted: result.formattedBalance };
	}

	/**
	 * Get ETH balance (native Arbitrum currency)
	 */
	async getETHBalance(): Promise<{ balance: bigint; formatted: string }> {
		if (!this.provider || !this.wallet) {
			throw new Error('Wallet not initialized');
		}

		const balance = await this.provider.getBalance(this.wallet.address);
		const formatted = parseFloat(ethers.formatEther(balance)).toFixed(6);

		return { balance, formatted };
	}

	/**
	 * Get balances for all configured tokens
	 */
	async getAllTokenBalances(): Promise<TokenBalance[]> {
		const symbols = this.getSupportedTokens();
		const balances = await Promise.all(symbols.map((s) => this.getTokenBalance(s)));
		return balances;
	}

	/**
	 * Get both ETH and USDT0 balances (backward-compatible)
	 */
	async getBalances(): Promise<{
		eth: { balance: bigint; formatted: string };
		usdt0: { balance: bigint; formatted: string };
	}> {
		const [eth, usdt0] = await Promise.all([this.getETHBalance(), this.getUSDT0Balance()]);

		return { eth, usdt0 };
	}

	/**
	 * Send ETH transaction
	 */
	async send(to: string, amount: string): Promise<string> {
		if (!this.provider || !this.wallet) {
			throw new Error('Wallet not initialized');
		}

		try {
			if (!ethers.isAddress(to.toLowerCase())) {
				throw new Error('Invalid recipient address');
			}

			const amountWei = ethers.parseEther(amount);
			const balance = await this.provider.getBalance(this.wallet.address);

			// Estimate gas
			const gasEstimate = await this.provider.estimateGas({
				from: this.wallet.address,
				to,
				value: amountWei
			});

			const feeData = await this.provider.getFeeData();
			const gasPrice = feeData.gasPrice || ethers.parseUnits('0.1', 'gwei');
			const gasCost = gasEstimate * gasPrice;

			if (balance < amountWei + gasCost) {
				throw new Error('Insufficient ETH balance for transaction and gas fees');
			}

			const tx = await this.wallet.sendTransaction({
				to,
				value: amountWei,
				gasLimit: gasEstimate,
				gasPrice
			});

			await tx.wait();
			return tx.hash;
		} catch (error) {
			throw new Error(
				`Failed to send ETH: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Send any supported ERC-20 token by symbol
	 * @param symbol - Token symbol (e.g. 'USDT0', 'WBTC', 'TBTC')
	 * @param to - Recipient address
	 * @param amount - Amount in human-readable units (e.g. '100.5')
	 */
	async sendToken(symbol: string, to: string, amount: string): Promise<string> {
		if (!this.wallet) {
			throw new Error('Wallet not initialized');
		}

		const key = symbol.toUpperCase();
		const contract = this.tokenContracts.get(key);
		const tokenConfig = this.tokenConfigs.get(key);

		if (!contract || !tokenConfig) {
			throw new Error(`Unsupported token: ${symbol}. Supported: ${this.getSupportedTokens().join(', ')}`);
		}

		try {
			if (!ethers.isAddress(to.toLowerCase())) {
				throw new Error('Invalid recipient address');
			}

			const decimals: number = await contract.decimals();
			const amountUnits = ethers.parseUnits(amount, decimals);

			// Check token balance
			const balance: bigint = await contract.balanceOf(this.wallet.address);
			if (balance < amountUnits) {
				throw new Error(`Insufficient ${symbol} balance`);
			}

			// Check ETH balance for gas
			const ethBalance = await this.provider!.getBalance(this.wallet.address);
			const minGasFee = ethers.parseEther('0.0001');

			if (ethBalance < minGasFee) {
				throw new Error('Insufficient ETH balance for gas fees');
			}

			// Send transaction
			const tx = await contract.transfer(to, amountUnits);
			await tx.wait();

			return tx.hash;
		} catch (error) {
			throw new Error(
				`Failed to send ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Send USDT0 transaction (backward-compatible — delegates to sendToken)
	 */
	async sendUSDT0(to: string, amount: string): Promise<string> {
		return this.sendToken('USDT0', to, amount);
	}

	/**
	 * Estimate gas for ETH transaction
	 */
	async estimateGas(
		to: string,
		amount: string
	): Promise<{
		gasLimit: bigint;
		gasPrice: bigint;
		totalCost: bigint;
		totalCostFormatted: string;
	}> {
		if (!this.provider || !this.wallet) {
			throw new Error('Wallet not initialized');
		}

		try {
			const amountWei = ethers.parseEther(amount);

			const gasLimit = await this.provider.estimateGas({
				from: this.wallet.address,
				to,
				value: amountWei
			});

			const feeData = await this.provider.getFeeData();
			const gasPrice = feeData.gasPrice || ethers.parseUnits('0.1', 'gwei');
			const totalCost = gasLimit * gasPrice;

			return {
				gasLimit,
				gasPrice,
				totalCost,
				totalCostFormatted: ethers.formatEther(totalCost)
			};
		} catch (error) {
			throw new Error(
				`Failed to estimate gas: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get current block number
	 */
	async getBlockNumber(): Promise<number> {
		if (!this.provider) {
			throw new Error('Provider not initialized');
		}
		return await this.provider.getBlockNumber();
	}

	/**
	 * Subscribe to new blocks
	 */
	onBlock(callback: (blockNumber: number) => void): () => void {
		if (!this.provider) {
			throw new Error('Provider not initialized');
		}

		this.blockListeners.push(callback);
		this.provider.on('block', callback);

		return () => {
			this.blockListeners = this.blockListeners.filter((cb) => cb !== callback);
			if (this.provider) {
				this.provider.off('block', callback);
			}
		};
	}

	/**
	 * Pause provider polling (for background operation)
	 */
	pause(): void {
		if (this.provider) {
			this.provider.pause(true);
		}
	}

	/**
	 * Resume provider polling
	 */
	resume(): void {
		if (this.provider) {
			this.provider.resume();
		}
	}

	/**
	 * Disconnect and clean up
	 */
	disconnect(): void {
		if (this.provider) {
			this.blockListeners.forEach((callback) => {
				if (this.provider) {
					this.provider.off('block', callback);
				}
			});
			this.blockListeners = [];

			this.provider.destroy();
			this.provider = null;
		}
		this.wallet = null;
		this.tokenContracts.clear();
		this.tokenConfigs.clear();
	}

	/**
	 * Get provider instance (for advanced usage)
	 */
	getProvider(): ethers.JsonRpcProvider {
		if (!this.provider) {
			throw new Error('Provider not initialized');
		}
		return this.provider;
	}

	/**
	 * Get wallet instance (for advanced usage)
	 */
	getWallet(): ethers.Wallet {
		if (!this.wallet) {
			throw new Error('Wallet not initialized');
		}
		return this.wallet;
	}

	/**
	 * Get USDT0 contract instance (backward-compatible)
	 */
	getUSDT0Contract(): ethers.Contract | null {
		return this.tokenContracts.get('USDT0') ?? null;
	}

	/**
	 * Check if wallet is initialized
	 */
	isInitialized(): boolean {
		return this.provider !== null && this.wallet !== null;
	}
}
