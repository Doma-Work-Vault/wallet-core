/**
 * Arbitrum Transaction History Module
 * Handles loading and processing transaction history from Arbiscan API
 *
 * Uses the Etherscan-compatible v2 API (same as BSCTransactions).
 */

import type { Transaction } from '../../core/types';
import { getArbConfig, ARB_TOKEN_ADDRESSES } from '../../utils/networkConfig';

/**
 * Load Arbitrum transaction history using Arbiscan API
 * Includes ETH and ERC-20 token transactions (USDT0, WBTC, tBTC)
 *
 * @param address - Wallet address to load transactions for
 * @param apiKey - Optional Arbiscan API key for higher rate limits
 * @returns Array of transactions (deduplicated and sorted by timestamp)
 */
export async function loadArbitrumTransactions(
	address: string,
	apiKey?: string
): Promise<Transaction[]> {
	try {
		const arbConfig = getArbConfig();
		const explorerApiUrl = arbConfig.explorerApiUrl;
		const transactions: Transaction[] = [];

		// Fetch ETH transactions
		const ethUrl = `${explorerApiUrl}?chainid=${arbConfig.chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
		const ethResponse = await fetch(ethUrl);

		if (!ethResponse.ok) {
			throw new Error(`API responded with status: ${ethResponse.status}`);
		}

		const ethData = await ethResponse.json();

		if (ethData.status === '1' && Array.isArray(ethData.result)) {
			transactions.push(...ethData.result);
		}

		// Fetch ERC-20 token transfers for each configured token
		const tokenAddresses = [
			ARB_TOKEN_ADDRESSES.USDT0,
			ARB_TOKEN_ADDRESSES.WBTC,
			ARB_TOKEN_ADDRESSES.TBTC
		];

		for (const contractAddress of tokenAddresses) {
			try {
				const tokenUrl = `${explorerApiUrl}?chainid=${arbConfig.chainId}&module=account&action=tokentx&contractaddress=${contractAddress}&address=${address}&startblock=0&endblock=99999999&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
				const tokenResponse = await fetch(tokenUrl);

				if (tokenResponse.ok) {
					const tokenData = await tokenResponse.json();
					if (tokenData.status === '1' && Array.isArray(tokenData.result)) {
						transactions.push(...tokenData.result);
					}
				}
			} catch {
				// Non-critical: skip if individual token fetch fails
			}
		}

		// Deduplicate by hash and sort by timestamp descending
		return transactions
			.filter((tx, index, self) => index === self.findIndex(t => t.hash === tx.hash))
			.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
	} catch (error) {
		console.error('Failed to load Arbitrum transaction history:', error);
		return [];
	}
}
