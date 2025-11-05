/**
 * BSC Paymaster Contract for EIP-7702 Gas Fee Abstraction
 * Allows users to pay gas fees in USDT instead of BNB
 */

import { ethers } from 'ethers';
import type { PaymasterConfig } from '../../core/types';
import { PAYMASTER_ABI } from '../../utils/networkConfig';

export enum PostOpMode {
    opSucceeded = 0,
    opReverted = 1,
    postOpReverted = 2
}

export class BSCPaymasterContract {
    private contract: ethers.Contract;
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private config: PaymasterConfig;

    constructor(
        contractAddress: string,
        provider: ethers.JsonRpcProvider,
        wallet: ethers.Wallet,
        config: PaymasterConfig
    ) {
        this.contract = new ethers.Contract(contractAddress, PAYMASTER_ABI, wallet);
        this.provider = provider;
        this.wallet = wallet;
        this.config = config;
    }

    /**
     * Check if paymaster has sufficient deposit
     */
    async hasSufficientDeposit(): Promise<boolean> {
        try {
            const deposit = await this.contract.getDeposit();
            return deposit >= this.config.minDeposit;
        } catch (error) {
            console.error('Failed to check paymaster deposit:', error);
            return false;
        }
    }

    /**
     * Get current deposit amount
     */
    async getDeposit(): Promise<bigint> {
        try {
            return await this.contract.getDeposit();
        } catch (error) {
            console.error('Failed to get deposit:', error);
            return BigInt(0);
        }
    }

    /**
     * Deposit BNB to paymaster
     */
    async deposit(amount: bigint): Promise<string> {
        try {
            const tx = await this.contract.deposit({ value: amount });
            await tx.wait();
            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to deposit: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Withdraw BNB from paymaster
     */
    async withdraw(amount: bigint): Promise<string> {
        try {
            const tx = await this.contract.withdrawTo(this.wallet.address, amount);
            await tx.wait();
            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to withdraw: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get current USDT price in BNB
     */
    async getUsdtPrice(): Promise<bigint> {
        try {
            return await this.contract.getUsdtPrice();
        } catch (error) {
            console.error('Failed to get USDT price:', error);
            return ethers.parseEther('0.0003');
        }
    }

    /**
     * Convert USDT amount to BNB equivalent
     */
    async convertUsdtToBnb(usdtAmount: bigint): Promise<bigint> {
        try {
            return await this.contract.convertUsdtToBnb(usdtAmount);
        } catch (error) {
            console.error('Failed to convert USDT to BNB:', error);
            const price = await this.getUsdtPrice();
            return (usdtAmount * price) / ethers.parseUnits('1', 18);
        }
    }

    /**
     * Estimate USDT cost for a transaction
     */
    async estimateUsdtCost(gasLimit: bigint, gasPrice: bigint): Promise<bigint> {
        try {
            const bnbCost = gasLimit * gasPrice;
            const usdtPrice = await this.getUsdtPrice();
            return (bnbCost * ethers.parseUnits('1', 18)) / usdtPrice;
        } catch (error) {
            console.error('Failed to estimate USDT cost:', error);
            const bnbCost = gasLimit * gasPrice;
            return (bnbCost * ethers.parseUnits('1', 18)) / ethers.parseEther('0.0003');
        }
    }

    /**
     * Check if user can pay fees in USDT
     */
    async canPayFeesInUsdt(): Promise<boolean> {
        try {
            const hasDeposit = await this.hasSufficientDeposit();
            if (!hasDeposit) return false;

            // Check if user has sufficient USDT balance
            const usdtContract = new ethers.Contract(
                this.config.usdtTokenAddress,
                ['function balanceOf(address owner) view returns (uint256)'],
                this.provider
            );

            const balance = await usdtContract.balanceOf(this.wallet.address);
            const minUsdtBalance = ethers.parseUnits('10', 18);

            return balance >= minUsdtBalance;
        } catch (error) {
            console.error('Failed to check USDT payment capability:', error);
            return false;
        }
    }

    /**
     * Get paymaster status and capabilities
     */
    async getStatus(): Promise<{
        hasDeposit: boolean;
        depositAmount: bigint;
        canPayInUsdt: boolean;
        usdtPrice: bigint;
        minDeposit: bigint;
    }> {
        try {
            const [hasDeposit, depositAmount, canPayInUsdt, usdtPrice] = await Promise.all([
                this.hasSufficientDeposit(),
                this.getDeposit(),
                this.canPayFeesInUsdt(),
                this.getUsdtPrice()
            ]);

            return {
                hasDeposit,
                depositAmount,
                canPayInUsdt,
                usdtPrice,
                minDeposit: this.config.minDeposit
            };
        } catch (error) {
            console.error('Failed to get paymaster status:', error);
            return {
                hasDeposit: false,
                depositAmount: BigInt(0),
                canPayInUsdt: false,
                usdtPrice: ethers.parseEther('0.0003'),
                minDeposit: this.config.minDeposit
            };
        }
    }
}

