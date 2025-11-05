/**
 * BSC Transaction History Module
 * Handles loading and processing transaction history from BSCScan API
 */

import type { Transaction } from '../../core/types';
import { getBSCConfig, getUSDTToken } from '../../utils/networkConfig';
import { ethers } from 'ethers';

/**
 * Load BSC transaction history using BSCScan API
 * Includes both BNB and USDT token transactions
 */
export async function loadBSCTransactions(
    address: string,
    network: 'mainnet' | 'testnet',
    apiKey?: string
): Promise<Transaction[]> {
    try {
        const transactions: Transaction[] = [];
        const addressLower = address.toLowerCase();

        // Get network configuration
        const bscConfig = getBSCConfig();
        const explorerApiUrl = bscConfig.explorerApiUrl;

        try {
            // Fetch BNB transactions
            const bnbUrl = `${explorerApiUrl}?chainid=${bscConfig.chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;

            const bnbResponse = await fetch(bnbUrl);

            if (bnbResponse.ok) {
                const bnbData = await bnbResponse.json();

                if (bnbData.status === '1' && bnbData.result && Array.isArray(bnbData.result)) {
                    for (const tx of bnbData.result.slice(0, 50)) {
                        const isFromUser = tx.from.toLowerCase() === addressLower;
                        const isToUser = tx.to && tx.to.toLowerCase() === addressLower;

                        let transactionType: 'send' | 'receive' | 'contract';
                        if (isFromUser && isToUser) {
                            transactionType = 'send';
                        } else if (isFromUser) {
                            transactionType = 'send';
                        } else if (isToUser) {
                            transactionType = 'receive';
                        } else {
                            transactionType = 'contract';
                        }

                        const amount = parseFloat(ethers.formatEther(tx.value || '0'));

                        let fee: number | undefined;
                        if (tx.gasUsed && tx.gasUsed !== '0' && tx.gasPrice && tx.gasPrice !== '0') {
                            try {
                                const feeWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                                fee = parseFloat(ethers.formatEther(feeWei));
                            } catch (error) {
                                console.debug('Failed to calculate BSC transaction fee:', error);
                            }
                        }

                        transactions.push({
                            hash: tx.hash,
                            from: tx.from,
                            to: tx.to || '0x0000000000000000000000000000000000000000',
                            value: tx.value || '0',
                            gasUsed: tx.gasUsed?.toString() || '0',
                            gasPrice: tx.gasPrice?.toString() || '0',
                            blockNumber: parseInt(tx.blockNumber) || 0,
                            timestamp: parseInt(tx.timeStamp) * 1000,
                            status: tx.isError === '0' ? 'confirmed' : 'failed',
                            type: transactionType,
                            network: 'bsc',
                            id: tx.hash,
                            asset: 'BNB',
                            formattedAmount: `${amount.toFixed(6)} BNB`,
                            description: transactionType === 'send' ? 'BSC BNB sent' : 'BSC BNB received',
                            fee,
                            address: tx.to || '0x0000000000000000000000000000000000000000',
                            txHash: tx.hash
                        });
                    }
                } else if (bnbData.status === '0') {
                    console.warn('BSCScan API returned error for BNB transactions:', bnbData.message || bnbData.result);
                }
            } else {
                console.error('Failed to fetch BNB transactions:', bnbResponse.status, bnbResponse.statusText);
            }

            // Fetch USDT token transactions
            const usdtToken = getUSDTToken();

            if (usdtToken) {
                const usdtUrl = `${explorerApiUrl}?chainid=${bscConfig.chainId}&module=account&action=tokentx&contractaddress=${usdtToken.address}&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;

                const usdtResponse = await fetch(usdtUrl);

                if (usdtResponse.ok) {
                    const usdtData = await usdtResponse.json();

                    if (usdtData.status === '1' && usdtData.result && Array.isArray(usdtData.result)) {
                        for (const tx of usdtData.result.slice(0, 50)) {
                            const isFromUser = tx.from.toLowerCase() === addressLower;
                            const isToUser = tx.to && tx.to.toLowerCase() === addressLower;

                            let transactionType: 'send' | 'receive' | 'contract';
                            if (isFromUser && isToUser) {
                                transactionType = 'send';
                            } else if (isFromUser) {
                                transactionType = 'send';
                            } else if (isToUser) {
                                transactionType = 'receive';
                            } else {
                                transactionType = 'contract';
                            }

                            const tokenSymbol = tx.tokenSymbol || 'USDT';
                            const amount = parseFloat(ethers.formatUnits(tx.value || '0', 18));

                            let fee: number | undefined;
                            if (tx.gasUsed && tx.gasUsed !== '0' && tx.gasPrice && tx.gasPrice !== '0') {
                                try {
                                    const feeWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                                    fee = parseFloat(ethers.formatEther(feeWei));
                                } catch (error) {
                                    console.debug('Failed to calculate BSC USDT transaction fee:', error);
                                }
                            }

                            transactions.push({
                                hash: tx.hash,
                                from: tx.from,
                                to: tx.to || '0x0000000000000000000000000000000000000000',
                                value: tx.value || '0',
                                gasUsed: tx.gasUsed?.toString() || '0',
                                gasPrice: tx.gasPrice?.toString() || '0',
                                blockNumber: parseInt(tx.blockNumber) || 0,
                                timestamp: parseInt(tx.timeStamp) * 1000,
                                status: tx.isError === '0' ? 'confirmed' : 'failed',
                                type: transactionType,
                                network: 'bsc',
                                tokenSymbol,
                                id: tx.hash,
                                asset: tokenSymbol,
                                formattedAmount: `${amount.toFixed(6)} ${tokenSymbol}`,
                                description: transactionType === 'send' ? `BSC ${tokenSymbol} sent` : `BSC ${tokenSymbol} received`,
                                fee,
                                address: tx.to || '0x0000000000000000000000000000000000000000',
                                txHash: tx.hash
                            });
                        }
                    }
                }
            }

        } catch (apiError) {
            console.error('Failed to fetch from BSCScan API:', apiError);
            return [];
        }

        // Sort transactions by timestamp and remove duplicates
        const uniqueTransactions = transactions
            .filter((tx, index, self) =>
                index === self.findIndex(t => t.hash === tx.hash)
            )
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);

        return uniqueTransactions;

    } catch (error) {
        console.error('Failed to load BSC transaction history:', error);
        return [];
    }
}

