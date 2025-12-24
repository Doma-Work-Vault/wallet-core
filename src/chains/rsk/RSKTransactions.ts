/**
 * RSK Transaction History Module
 * Handles loading and processing transaction history from RSK Explorer API
 */

import type { Transaction } from '../../core/types';
import { getBoltzConfig, getRSKConfig } from '../../utils/networkConfig';
import { ethers } from 'ethers';

export async function getSwapAddress(): Promise<string | null> {
    try {
        const boltzConfig = getBoltzConfig();
        const contractResponse = await fetch(`${boltzConfig.boltzApiUrl}/v2/chain/RBTC/contracts`);

        if (!contractResponse.ok) {
            throw new Error(`API responded with status: ${contractResponse.status}`);
        }

        const contracts = await contractResponse.json();
        return contracts.swapContracts?.EtherSwap?.toLowerCase() || null;
    } catch (error) {
        console.warn('Could not fetch EtherSwap contract address:', error);
        return null;
    }
}

/**
 * Load RSK transaction history using RSK Explorer API
 * Returns raw transaction data as provided by the API
 */
export async function loadRSKTransactions(
    address: string,
    provider: ethers.JsonRpcProvider
): Promise<Transaction[]> {
    try {
        const rskConfig = getRSKConfig();

        try {
            const response = await fetch(`${rskConfig.explorerApiUrl}/v2/addresses/${address}/transactions`);

            if (!response.ok) {
                throw new Error(`API responded with status: ${response.status}`);
            }

            const data = await response.json();

            return Array.isArray(data.items) ? data.items : (data || []);
        } catch (apiError) {
            console.error('Failed to fetch from RSK explorer API:', apiError);

            try {
                const altResponse = await fetch(
                    `${rskConfig.explorerApiUrl}/v2/addresses/${address}/transactions?type=all`
                );

                if (!altResponse.ok) {
                    throw new Error(`API responded with status: ${altResponse.status}`);
                }

                const altData = await altResponse.json();

                return Array.isArray(altData.items) ? altData.items : (altData || []);
            } catch (altError) {
                console.error('Alternative RSK API also failed:', altError);

                try {
                    const v1Response = await fetch(
                        `${rskConfig.explorerApiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc`
                    );

                    if (!v1Response.ok) {
                        throw new Error(`API responded with status: ${v1Response.status}`);
                    }

                    const v1Data = await v1Response.json();

                    // V1 API returns different format
                    return Array.isArray(v1Data.result) ? v1Data.result : (v1Data || []);
                } catch (v1Error) {
                    console.error('V1 RSK API also failed:', v1Error);

                    const txCount = await provider.getTransactionCount(address);

                    if (txCount > 0) {
                        console.warn(`RSK address has ${txCount} transactions, but all APIs are unavailable`);
                    }

                    return [];
                }

            }
        }
    } catch (error) {
        console.error('Failed to load RSK transactions:', error);
        return [];
    }
}

