/**
 * BSC Transaction History Module
 * Handles loading and processing transaction history from BSCScan API
 */

import type { Transaction } from '../../core/types';
import { getBSCConfig, getUSDTToken } from '../../utils/networkConfig';

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

        // Get network configuration
        const bscConfig = getBSCConfig();
        const explorerApiUrl = bscConfig.explorerApiUrl;

        // Fetch BNB transactions
        const bnbUrl = `${explorerApiUrl}?chainid=${bscConfig.chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
        const bnbResponse = await fetch(bnbUrl);

        if (!bnbResponse.ok) {
            throw new Error(`API responded with status: ${bnbResponse.status}`);
        }

        const bnbData = await bnbResponse.json();

        // If we have BNB transactions, return them
        if (bnbData.status === '1' && Array.isArray(bnbData.result)) {
            transactions.push(...bnbData.result);
        }

        // Fetch USDT token transactions
        const usdtToken = getUSDTToken();
        if (usdtToken) {
            const usdtUrl = `${explorerApiUrl}?chainid=${bscConfig.chainId}&module=account&action=tokentx&contractaddress=${usdtToken.address}&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
            const usdtResponse = await fetch(usdtUrl);

            if (usdtResponse.ok) {
                const usdtData = await usdtResponse.json();
                if (usdtData.status === '1' && Array.isArray(usdtData.result)) {
                    transactions.push(...usdtData.result);
                }
            }
        }

        return transactions.filter((tx, index, self) => index === self.findIndex(t => t.hash === tx.hash)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (error) {
        console.error('Failed to load BSC transaction history:', error);
        return [];
    }
}

