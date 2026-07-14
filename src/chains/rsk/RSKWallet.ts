/**
 * RSK Wallet Module
 * Handles RSK (Rootstock) wallet operations including initialization, balance, and transactions
 */

import type { GasEstimation, NetworkType } from '../../core/types';
import { ethers } from 'ethers';
import { RSK_NETWORKS, ERC20_ABI } from '../../utils/networkConfig';
import { isValidRskAddress, normalizeRskAddress, toEip1191ChecksumAddress } from '../../utils/rskAddress';
import { loadRSKTransactions } from './RSKTransactions';

export interface RSKWalletConfig {
    network: NetworkType;
    rpcUrl?: string;
    pollingInterval?: number;
}

export class RSKWallet {
    private provider: ethers.JsonRpcProvider | null = null;
    private wallet: ethers.Wallet | null = null;
    private config: RSKWalletConfig;
    private blockListeners: ((blockNumber: number) => void)[] = [];

    constructor(config: RSKWalletConfig) {
        this.config = config;
    }

    /**
     * Initialize RSK wallet from mnemonic
     * Note: RPC connection test is deferred for faster initialization
     */
    async initialize(mnemonic: string): Promise<void> {
        try {
            if (!mnemonic) {
                throw new Error('No mnemonic provided');
            }

            // Get network config
            const networkConfig = RSK_NETWORKS[this.config.network];
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

            // Create wallet from mnemonic with RSK derivation path
            const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/137'/0'/0/0");
            this.wallet = new ethers.Wallet(hdNode.privateKey, this.provider);
       } catch (error) {
            throw new Error(`RSK wallet initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get wallet address
     */
    getAddress(): string {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }
        const chainId = RSK_NETWORKS[this.config.network].chainId;
        return toEip1191ChecksumAddress(this.wallet.address, chainId);
    }

    /**
     * Get current balance
     */
    async getBalance(): Promise<{ balance: bigint; formatted: string }> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        const balance = await this.provider.getBalance(this.wallet.address);
        const formatted = parseFloat(ethers.formatEther(balance)).toFixed(6);

        return { balance, formatted };
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
     * Send RBTC transaction
     */
    async send(to: string, amount: string): Promise<string> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        try {
            const chainId = RSK_NETWORKS[this.config.network].chainId;

            // Validate address (EIP-1191 for RSK)
            if (!isValidRskAddress(to, chainId)) {
                throw new Error('Invalid recipient address');
            }
            const normalizedTo = normalizeRskAddress(to);

            // Parse amount
            const amountWei = ethers.parseEther(amount);

            // Get current balance
            const balance = await this.provider.getBalance(this.wallet.address);

            // Estimate gas
            const gasEstimate = await this.provider.estimateGas({
                from: this.wallet.address,
                to: normalizedTo,
                value: amountWei
            });

            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
            const gasCost = gasEstimate * gasPrice;

            // Check if enough balance for amount + gas
            if (balance < amountWei + gasCost) {
                throw new Error('Insufficient balance for transaction and gas fees');
            }

            // Send transaction
            const tx = await this.wallet.sendTransaction({
                to: normalizedTo,
                value: amountWei,
                gasLimit: gasEstimate,
                gasPrice
            });

            // Wait for confirmation
            await tx.wait();

            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to send RBTC: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Send ERC-20 token on RSK (e.g., USDT0, DOC)
     * @param tokenAddress - ERC-20 contract address
     * @param to - Recipient address
     * @param amount - Amount in human-readable units (e.g., "10.50" for 10.5 USDT0)
     * @param decimals - Token decimals (default 6 for USDT0)
     */
    async sendToken(tokenAddress: string, to: string, amount: string, decimals: number = 6): Promise<string> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        try {
            const chainId = RSK_NETWORKS[this.config.network].chainId;
            if (!isValidRskAddress(to, chainId)) {
                throw new Error('Invalid recipient address');
            }
            if (!ethers.isAddress(tokenAddress)) {
                throw new Error('Invalid token address');
            }
            const normalizedTo = normalizeRskAddress(to);

            // Check RBTC balance for gas
            const rbtcBalance = await this.provider.getBalance(this.wallet.address);
            if (rbtcBalance === BigInt(0)) {
                throw new Error('Insufficient RBTC balance for gas fees');
            }

            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            const amountWei = ethers.parseUnits(amount, decimals);

            const tx = await tokenContract.transfer(normalizedTo, amountWei);
            await tx.wait();

            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to send token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Estimate gas for transaction
     */
    async estimateGas(to: string, amount: string): Promise<GasEstimation> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        try {
            const chainId = RSK_NETWORKS[this.config.network].chainId;
            if (!isValidRskAddress(to, chainId)) {
                throw new Error('Invalid recipient address');
            }
            const normalizedTo = normalizeRskAddress(to);
            const amountWei = ethers.parseEther(amount);

            const gasLimit = await this.provider.estimateGas({
                from: this.wallet.address,
                to: normalizedTo,
                value: amountWei
            });

            // Get gas price
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
            
            // Calculate total cost
            const totalCost = gasLimit * gasPrice;

            return {
                gasLimit: gasLimit.toString(),
                gasPrice: gasPrice.toString(),
                totalCost: totalCost.toString(),
                totalCostFormatted: ethers.formatEther(totalCost)
            };
        } catch (error) {
            throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Load transaction history
     */
    async loadTransactions() {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        return await loadRSKTransactions(
            this.wallet.address,
            this.provider
        );
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

        // Return unsubscribe function
        return () => {
            this.blockListeners = this.blockListeners.filter(cb => cb !== callback);
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
            // Remove all listeners
            this.blockListeners.forEach(callback => {
                if (this.provider) {
                    this.provider.off('block', callback);
                }
            });
            this.blockListeners = [];

            // Destroy provider
            this.provider.destroy();
            this.provider = null;
        }
        this.wallet = null;
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
     * Check if wallet is initialized
     */
    isInitialized(): boolean {
        return this.provider !== null && this.wallet !== null;
    }
}

