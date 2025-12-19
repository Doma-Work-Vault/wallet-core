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
                            gasLimit: tx.gas?.toString() || '0',
                            blockNumber: parseInt(tx.blockNumber) || 0,
                            timestamp: parseInt(tx.timeStamp) * 1000,
                            status: tx.isError === '0' ? 'confirmed' : 'failed',
                            type: transactionType,
                            network: 'bsc',
                            nonce: parseInt(tx.nonce) || 0,
                            position: parseInt(tx.transactionIndex) || 0,
                            confirmations: parseInt(tx.confirmations) || 0,
                            
                            // Contract interaction data
                            rawInput: tx.input || '',
                            method: tx.methodId || null,
                            isContract: tx.isContract === '1',
                            transactionTypes: tx.transactionTypes || (tx.input && tx.input !== '0x' ? ['contract_call'] : ['coin_transfer']),
                            decodedInput: tx.decodedInput || null,
                            tokenTransfers: tx.tokenTransfers || null,
                            
                            // Gas pricing data (EIP-1559)
                            maxFeePerGas: tx.maxFeePerGas || null,
                            maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null,
                            baseFeePerGas: tx.baseFeePerGas || null,
                            priorityFee: tx.priorityFee || null,
                            
                            // Additional metadata
                            result: tx.isError === '0' ? 'success' : 'failed',
                            revertReason: tx.revertReason || null,
                            createdContract: tx.contractAddress || null,
                            isPendingUpdate: false,
                            transactionType: tx.type ? parseInt(tx.type) : 0,
                            hasErrorInInternalTransactions: false,
                            
                            // Fee information
                            fee: {
                                type: 'actual',
                                value: (BigInt(tx.gasUsed || 0) * BigInt(tx.gasPrice || 0)).toString()
                            },
                            transactionBurntFee: tx.burntFees || null,
                            
                            // Exchange rates
                            exchangeRate: null,
                            historicExchangeRate: null,
                            
                            // Additional fields
                            confirmationDuration: null,
                            tokenTransfersOverflow: null,
                            transactionTag: null,
                            authorizationList: [],
                            actions: [],
                            
                            // Legacy/backward compatibility fields
                            id: tx.hash,
                            asset: 'BNB',
                            formattedAmount: `${amount.toFixed(6)} BNB`,
                            description: transactionType === 'send' ? 'BSC BNB sent' : 'BSC BNB received',
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
                                gasLimit: tx.gas?.toString() || '0',
                                blockNumber: parseInt(tx.blockNumber) || 0,
                                timestamp: parseInt(tx.timeStamp) * 1000,
                                status: tx.isError === '0' ? 'confirmed' : 'failed',
                                type: transactionType,
                                network: 'bsc',
                                nonce: parseInt(tx.nonce) || 0,
                                position: parseInt(tx.transactionIndex) || 0,
                                confirmations: parseInt(tx.confirmations) || 0,
                                
                                // Contract interaction data
                                rawInput: tx.input || '',
                                method: tx.methodId || null,
                                isContract: true, // Token transactions are always to contracts
                                transactionTypes: tx.transactionTypes || ['token_transfer'],
                                decodedInput: tx.decodedInput || null,
                                tokenTransfers: tx.tokenTransfers || null,
                                
                                // Gas pricing data (EIP-1559)
                                maxFeePerGas: tx.maxFeePerGas || null,
                                maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null,
                                baseFeePerGas: tx.baseFeePerGas || null,
                                priorityFee: tx.priorityFee || null,
                                
                                // Additional metadata
                                result: tx.isError === '0' ? 'success' : 'failed',
                                revertReason: tx.revertReason || null,
                                createdContract: tx.contractAddress || null,
                                isPendingUpdate: false,
                                transactionType: tx.type ? parseInt(tx.type) : 0,
                                hasErrorInInternalTransactions: false,
                                
                                // Fee information
                                fee: {
                                    type: 'actual',
                                    value: (BigInt(tx.gasUsed || 0) * BigInt(tx.gasPrice || 0)).toString()
                                },
                                transactionBurntFee: tx.burntFees || null,
                                
                                // Exchange rates
                                exchangeRate: null,
                                historicExchangeRate: null,
                                
                                // Additional fields
                                confirmationDuration: null,
                                tokenTransfersOverflow: null,
                                transactionTag: null,
                                authorizationList: [],
                                actions: [],
                                
                                // Legacy/backward compatibility fields
                                tokenSymbol,
                                id: tx.hash,
                                asset: tokenSymbol,
                                formattedAmount: `${amount.toFixed(6)} ${tokenSymbol}`,
                                description: transactionType === 'send' ? `BSC ${tokenSymbol} sent` : `BSC ${tokenSymbol} received`,
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

