/**
 * RSK Transaction History Module
 * Handles loading and processing transaction history from RSK Explorer API
 */

import type { Transaction, NetworkType } from '../../core/types';
import { getBoltzConfig, getRSKConfig } from '../../utils/networkConfig';
import { ethers } from 'ethers';

/**
 * Load RSK transaction history using RSK Explorer API
 * Identifies and includes swap transactions (EtherSwap contract interactions)
 */
export async function loadRSKTransactions(
    address: string,
    provider: ethers.JsonRpcProvider,
    network: NetworkType
): Promise<Transaction[]> {
    try {
        const transactions: Transaction[] = [];
        const addressLower = address.toLowerCase();

        // Get network configurations
        const boltzConfig = getBoltzConfig();
        const rskConfig = getRSKConfig();

        // Get EtherSwap contract address for swap detection
        let etherSwapAddress: string | null = null;
        try {
            const contractResponse = await fetch(`${boltzConfig.boltzApiUrl}/v2/chain/RBTC/contracts`);
            if (contractResponse.ok) {
                const contracts = await contractResponse.json();
                etherSwapAddress = contracts.swapContracts?.EtherSwap?.toLowerCase() || null;
            }
        } catch (error) {
            console.warn('Could not fetch EtherSwap contract address:', error);
        }

        const explorerApiUrl = rskConfig.explorerApiUrl;

        try {
            // Fetch transactions from RSK Explorer API
            const response = await fetch(`${explorerApiUrl}/v2/addresses/${address}/transactions`);

            if (!response.ok) {
                throw new Error(`API responded with status: ${response.status}`);
            }

            const data = await response.json();

            if (data.items && Array.isArray(data.items)) {
                for (const tx of data.items.slice(0, 50)) {
                    const txTo = (tx.to?.hash || tx.to || '').toLowerCase();
                    const txFrom = (tx.from?.hash || tx.from || '').toLowerCase();
                    const txMethod = tx.method?.toLowerCase() || '';

                    // Check if this is a swap transaction
                    const isSwapClaim =
                        etherSwapAddress &&
                        txTo === etherSwapAddress &&
                        txFrom === addressLower &&
                        (txMethod === 'claim' || txMethod.includes('claim'));

                    if (isSwapClaim) {
                        // Swap transaction
                        const amount = parseFloat(ethers.formatEther(tx.value || '0'));
                        const swapType: 'chain' | 'reverse' = 'reverse';

                        let fee: number | undefined;
                        if (tx.gas_used && tx.gas_used !== '0' && tx.gas_price && tx.gas_price !== '0') {
                            try {
                                const feeWei = BigInt(tx.gas_used) * BigInt(tx.gas_price);
                                fee = parseFloat(ethers.formatEther(feeWei));
                            } catch (error) {
                                console.debug('Failed to calculate swap fee:', error);
                            }
                        }

                        transactions.push({
                            hash: tx.hash,
                            from: txFrom,
                            to: txTo,
                            value: tx.value || '0',
                            gasUsed: tx.gas_used?.toString() || '0',
                            gasPrice: tx.gas_price?.toString() || '0',
                            blockNumber: parseInt(tx.block_number) || 0,
                            timestamp: new Date(tx.timestamp).getTime(),
                            status: tx.status === 'ok' ? 'confirmed' : 'failed',
                            type: 'swap',
                            network: 'rsk',
                            tokenSymbol: 'rBTC',
                            swapType,
                            id: tx.hash,
                            asset: 'rBTC',
                            formattedAmount: `${amount.toFixed(6)} rBTC`,
                            description: 'Swap claimed',
                            fee,
                            address: txTo,
                            txHash: tx.hash
                        });
                    } else {
                        // Regular RSK transaction
                        const amount = parseFloat(ethers.formatEther(tx.value || '0'));
                        const txType = tx.from.hash.toLowerCase() === addressLower ? 'send' : 'receive';

                        let fee: number | undefined;
                        if (tx.gas_used && tx.gas_used !== '0' && tx.gas_price && tx.gas_price !== '0') {
                            try {
                                const feeWei = BigInt(tx.gas_used) * BigInt(tx.gas_price);
                                fee = parseFloat(ethers.formatEther(feeWei));
                            } catch (error) {
                                console.debug('Failed to calculate transaction fee:', error);
                            }
                        }

                        transactions.push({
                            hash: tx.hash,
                            from: tx.from.hash,
                            to: tx.to?.hash || '0x0000000000000000000000000000000000000000',
                            value: tx.value || '0',
                            gasUsed: tx.gas_used?.toString() || '0',
                            gasPrice: tx.gas_price?.toString() || '0',
                            blockNumber: parseInt(tx.block_number) || 0,
                            timestamp: new Date(tx.timestamp).getTime(),
                            status: tx.status === 'ok' ? 'confirmed' : 'failed',
                            type: txType,
                            network: 'rsk',
                            id: tx.hash,
                            asset: 'rBTC',
                            formattedAmount: `${amount.toFixed(6)} rBTC`,
                            description: txType === 'send' ? 'RSK transaction sent' : 'RSK payment received',
                            fee,
                            address: tx.to?.hash || '0x0000000000000000000000000000000000000000',
                            txHash: tx.hash
                        });
                    }
                }
            }
        } catch (apiError) {
            console.error('Failed to fetch from RSK explorer API:', apiError);

            // Try alternative API endpoint
            try {
                const altResponse = await fetch(
                    `${explorerApiUrl}/v2/addresses/${address}/transactions?type=all`
                );

                if (altResponse.ok) {
                    const altData = await altResponse.json();

                    if (altData.items && Array.isArray(altData.items)) {
                        for (const tx of altData.items.slice(0, 50)) {
                            const amount = parseFloat(ethers.formatEther(tx.value || '0'));
                            const txType = (tx.from?.hash || tx.from)?.toLowerCase() === addressLower ? 'send' : 'receive';

                            let fee: number | undefined;
                            if (tx.gas_used && tx.gas_used !== '0' && tx.gas_price && tx.gas_price !== '0') {
                                try {
                                    const feeWei = BigInt(tx.gas_used) * BigInt(tx.gas_price);
                                    fee = parseFloat(ethers.formatEther(feeWei));
                                } catch (error) {
                                    console.debug('Failed to calculate transaction fee:', error);
                                }
                            }

                            transactions.push({
                                hash: tx.hash,
                                from: tx.from?.hash || tx.from,
                                to: tx.to?.hash || tx.to || '0x0000000000000000000000000000000000000000',
                                value: tx.value || '0',
                                gasUsed: tx.gas_used?.toString() || '0',
                                gasPrice: tx.gas_price?.toString() || '0',
                                blockNumber: parseInt(tx.block_number) || 0,
                                timestamp: new Date(tx.timestamp).getTime(),
                                status: tx.status === 'ok' ? 'confirmed' : 'failed',
                                type: txType,
                                network: 'rsk',
                                id: tx.hash,
                                asset: 'rBTC',
                                formattedAmount: `${amount.toFixed(6)} rBTC`,
                                description: txType === 'send' ? 'RSK transaction sent' : 'RSK payment received',
                                fee,
                                address: tx.to?.hash || tx.to || '0x0000000000000000000000000000000000000000',
                                txHash: tx.hash
                            });
                        }
                    }
                }
            } catch (altError) {
                console.error('Alternative RSK API also failed:', altError);

                // Try v1 API as final fallback
                try {
                    const v1Response = await fetch(
                        `${explorerApiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc`
                    );

                    if (v1Response.ok) {
                        const v1Data = await v1Response.json();

                        if (v1Data.result && Array.isArray(v1Data.result)) {
                            for (const tx of v1Data.result.slice(0, 50)) {
                                const amount = parseFloat(ethers.formatEther(tx.value || '0'));
                                const txType = tx.from.toLowerCase() === addressLower ? 'send' : 'receive';

                                let fee: number | undefined;
                                if (tx.gasUsed && tx.gasUsed !== '0' && tx.gasPrice && tx.gasPrice !== '0') {
                                    try {
                                        const feeWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                                        fee = parseFloat(ethers.formatEther(feeWei));
                                    } catch (error) {
                                        console.debug('Failed to calculate transaction fee:', error);
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
                                    type: txType,
                                    network: 'rsk',
                                    id: tx.hash,
                                    asset: 'rBTC',
                                    formattedAmount: `${amount.toFixed(6)} rBTC`,
                                    description: txType === 'send' ? 'RSK transaction sent' : 'RSK payment received',
                                    fee,
                                    address: tx.to || '0x0000000000000000000000000000000000000000',
                                    txHash: tx.hash
                                });
                            }
                        }
                    }
                } catch (v1Error) {
                    console.error('V1 RSK API also failed:', v1Error);

                    // Final fallback: Check transaction count
                    const txCount = await provider.getTransactionCount(address);

                    if (txCount > 0) {
                        console.warn(`RSK address has ${txCount} transactions, but all APIs are unavailable`);
                    }
                }
            }
        }

        return transactions;
    } catch (error) {
        console.error('Failed to load RSK transactions:', error);
        return [];
    }
}

