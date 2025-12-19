/**
 * BSC Wallet Module
 * Handles BSC (Binance Smart Chain) wallet operations including BNB and USDT
 */

import { ethers } from 'ethers';
import type { NetworkType } from '../../core/types';
import { BSC_NETWORKS, ERC20_ABI, getBSCPaymasterConfig, getUSDTToken } from '../../utils/networkConfig';
import { BSCPaymasterContract } from './BSCPaymaster';
import { loadBSCTransactions } from './BSCTransactions';

export interface BSCWalletConfig {
    network: Extract<NetworkType, 'mainnet' | 'testnet'>;
    rpcUrl?: string;
    pollingInterval?: number;
    bscscanApiKey?: string;
}

export class BSCWallet {
    private provider: ethers.JsonRpcProvider | null = null;
    private wallet: ethers.Wallet | null = null;
    private usdtContract: ethers.Contract | null = null;
    private paymasterContract: BSCPaymasterContract | null = null;
    private config: BSCWalletConfig;
    private blockListeners: ((blockNumber: number) => void)[] = [];

    constructor(config: BSCWalletConfig) {
        this.config = config;
    }

    /**
     * Initialize BSC wallet from mnemonic
     * Note: RPC connection test is deferred for faster initialization
     */
    async initialize(mnemonic: string): Promise<void> {
        try {
            if (!mnemonic) {
                throw new Error('No mnemonic provided');
            }

            // Get network config
            const networkConfig = BSC_NETWORKS[this.config.network];
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

            // Create wallet from mnemonic with BSC/Ethereum derivation path
            const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0");
            this.wallet = new ethers.Wallet(hdNode.privateKey, this.provider);

            // Initialize USDT contract
            const usdtToken = getUSDTToken();
            if (usdtToken) {
                this.usdtContract = new ethers.Contract(usdtToken.address, ERC20_ABI, this.wallet);
            }

            // Initialize paymaster contract if available
            const paymasterConfig = getBSCPaymasterConfig();
            if (paymasterConfig.address && paymasterConfig.address !== '0x0000000000000000000000000000000000000000') {
                this.paymasterContract = new BSCPaymasterContract(
                    paymasterConfig.address,
                    this.provider,
                    this.wallet,
                    paymasterConfig
                );
            }
        } catch (error) {
            throw new Error(`BSC wallet initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
     * Get BNB balance
     */
    async getBNBBalance(): Promise<{ balance: bigint; formatted: string }> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        const balance = await this.provider.getBalance(this.wallet.address);
        const formatted = parseFloat(ethers.formatEther(balance)).toFixed(6);

        return { balance, formatted };
    }

    /**
     * Get USDT balance
     */
    async getUSDTBalance(): Promise<{ balance: bigint; formatted: string }> {
        if (!this.usdtContract) {
            return { balance: BigInt(0), formatted: '0.00' };
        }

        try {
            const balance = await this.usdtContract.balanceOf(this.wallet!.address);
            const decimals = await this.usdtContract.decimals();
            const formatted = parseFloat(ethers.formatUnits(balance, decimals)).toFixed(6);

            return { balance, formatted };
        } catch (error) {
            console.error('Failed to get USDT balance:', error);
            return { balance: BigInt(0), formatted: '0.00' };
        }
    }

    /**
     * Get both BNB and USDT balances
     */
    async getBalances(): Promise<{
        bnb: { balance: bigint; formatted: string };
        usdt: { balance: bigint; formatted: string };
    }> {
        const [bnb, usdt] = await Promise.all([
            this.getBNBBalance(),
            this.getUSDTBalance()
        ]);

        return { bnb, usdt };
    }

    /**
     * Send BNB transaction
     */
    async sendBNB(to: string, amount: string): Promise<string> {
        if (!this.provider || !this.wallet) {
            throw new Error('Wallet not initialized');
        }

        try {
            if (!ethers.isAddress(to)) {
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
            const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');
            const gasCost = gasEstimate * gasPrice;

            if (balance < amountWei + gasCost) {
                throw new Error('Insufficient BNB balance for transaction and gas fees');
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
            throw new Error(`Failed to send BNB: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Send USDT transaction
     */
    async sendUSDT(to: string, amount: string): Promise<string> {
        if (!this.usdtContract || !this.wallet) {
            throw new Error('USDT contract not initialized');
        }

        try {
            if (!ethers.isAddress(to)) {
                throw new Error('Invalid recipient address');
            }

            const decimals = await this.usdtContract.decimals();
            const amountUnits = ethers.parseUnits(amount, decimals);

            // Check USDT balance
            const balance = await this.usdtContract.balanceOf(this.wallet.address);
            if (balance < amountUnits) {
                throw new Error('Insufficient USDT balance');
            }

            // Check BNB balance for gas
            const bnbBalance = await this.provider!.getBalance(this.wallet.address);
            const minGasFee = ethers.parseEther('0.001'); // Minimum 0.001 BNB for gas

            if (bnbBalance < minGasFee) {
                throw new Error('Insufficient BNB balance for gas fees');
            }

            // Send transaction
            const tx = await this.usdtContract.transfer(to, amountUnits);
            await tx.wait();

            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to send USDT: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Estimate gas for BNB transaction
     */
    async estimateGasForBNB(to: string, amount: string): Promise<{
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
            const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');
            const totalCost = gasLimit * gasPrice;

            return {
                gasLimit,
                gasPrice,
                totalCost,
                totalCostFormatted: ethers.formatEther(totalCost)
            };
        } catch (error) {
            throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
     * Load transaction history
     */
    async loadTransactions() {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }

        return await loadBSCTransactions(
            this.wallet.address,
            this.config.bscscanApiKey
        );
    }

    /**
     * Get paymaster contract
     */
    getPaymaster(): BSCPaymasterContract | null {
        return this.paymasterContract;
    }

    /**
     * Check if paymaster can pay fees in USDT
     */
    async canPayFeesInUsdt(): Promise<boolean> {
        if (!this.paymasterContract) {
            return false;
        }

        try {
            return await this.paymasterContract.canPayFeesInUsdt();
        } catch (error) {
            console.error('Failed to check USDT payment capability:', error);
            return false;
        }
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
            this.blockListeners = this.blockListeners.filter(cb => cb !== callback);
            if (this.provider) {
                this.provider.off('block', callback);
            }
        };
    }

    /**
     * Pause provider polling
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
            this.blockListeners.forEach(callback => {
                if (this.provider) {
                    this.provider.off('block', callback);
                }
            });
            this.blockListeners = [];

            this.provider.destroy();
            this.provider = null;
        }
        this.wallet = null;
        this.usdtContract = null;
        this.paymasterContract = null;
    }

    /**
     * Get provider instance
     */
    getProvider(): ethers.JsonRpcProvider {
        if (!this.provider) {
            throw new Error('Provider not initialized');
        }
        return this.provider;
    }

    /**
     * Get wallet instance
     */
    getWallet(): ethers.Wallet {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }
        return this.wallet;
    }

    /**
     * Get USDT contract instance
     */
    getUSDTContract(): ethers.Contract | null {
        return this.usdtContract;
    }

    /**
     * Check if wallet is initialized
     */
    isInitialized(): boolean {
        return this.provider !== null && this.wallet !== null;
    }
}

