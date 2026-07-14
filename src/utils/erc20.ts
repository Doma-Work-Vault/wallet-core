/**
 * ERC-20 Utility Functions
 *
 * Generic utilities for interacting with ERC-20 tokens across all chains.
 * These are pure functions or small helpers that any dApp would need:
 * - Encode transfer calldata
 * - Encode approve calldata
 * - Poll for balance changes
 * - USD to ERC-20 wei conversion
 * - Check and wait for allowance
 */

import { ethers } from 'ethers';
import { ERC20_ABI } from './networkConfig';

/**
 * Encode an ERC-20 `transfer(to, amount)` call.
 *
 * @param to - Recipient address
 * @param amount - Amount in smallest unit (wei-equivalent for the token's decimals)
 * @returns Hex-encoded calldata
 */
export function encodeERC20Transfer(to: string, amount: string | bigint): string {
	const iface = new ethers.Interface(ERC20_ABI);
	return iface.encodeFunctionData('transfer', [to, BigInt(amount)]);
}

/**
 * Encode an ERC-20 `approve(spender, amount)` call.
 *
 * @param spender - Address to approve
 * @param amount - Amount to approve in smallest unit
 * @returns Hex-encoded calldata
 */
export function encodeERC20Approve(spender: string, amount: string | bigint): string {
	const iface = new ethers.Interface(ERC20_ABI);
	return iface.encodeFunctionData('approve', [spender, BigInt(amount)]);
}

/**
 * Encode an ERC-20 `balanceOf(owner)` call.
 *
 * @param owner - Address to check balance for
 * @returns Hex-encoded calldata
 */
export function encodeERC20BalanceOf(owner: string): string {
	const iface = new ethers.Interface(ERC20_ABI);
	return iface.encodeFunctionData('balanceOf', [owner]);
}

/**
 * Encode an ERC-20 `allowance(owner, spender)` call.
 *
 * @param owner - Token owner address
 * @param spender - Approved spender address
 * @returns Hex-encoded calldata
 */
export function encodeERC20Allowance(owner: string, spender: string): string {
	const iface = new ethers.Interface(ERC20_ABI);
	return iface.encodeFunctionData('allowance', [owner, spender]);
}

/**
 * Decode an ERC-20 `balanceOf` return value.
 *
 * @param data - Hex-encoded return data from `balanceOf` call
 * @returns Balance as bigint
 */
export function decodeERC20Balance(data: string): bigint {
	const iface = new ethers.Interface(ERC20_ABI);
	const decoded = iface.decodeFunctionResult('balanceOf', data);
	return BigInt(decoded[0].toString());
}

/**
 * Options for `waitForERC20Balance`
 */
export interface WaitForBalanceOptions {
	/** Polling interval in ms (default: 3000) */
	intervalMs?: number;
	/** Timeout in ms (default: 120000 = 2 minutes) */
	timeoutMs?: number;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

/**
 * Poll an ERC-20 token balance until it reaches or exceeds the target amount.
 * Useful after submitting a transfer/swap and waiting for the tokens to arrive.
 *
 * @param provider - Ethers JSON-RPC provider
 * @param tokenAddress - ERC-20 token contract address
 * @param owner - Address to check balance for
 * @param targetAmount - Minimum balance to wait for (in smallest unit)
 * @param options - Polling options
 * @returns The final balance when the target is reached
 * @throws On timeout or abort
 */
export async function waitForERC20Balance(
	provider: ethers.Provider,
	tokenAddress: string,
	owner: string,
	targetAmount: bigint,
	options: WaitForBalanceOptions = {}
): Promise<bigint> {
	const { intervalMs = 3000, timeoutMs = 120_000, signal } = options;
	const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
	const deadline = Date.now() + timeoutMs;

	// Check immediately before polling
	const initialBalance: bigint = await contract.balanceOf(owner);
	if (initialBalance >= targetAmount) {
		return initialBalance;
	}

	return new Promise<bigint>((resolve, reject) => {
		let settled = false;
		let intervalId: ReturnType<typeof setInterval> | null = null;

		const cleanup = () => {
			if (intervalId !== null) {
				clearInterval(intervalId);
				intervalId = null;
			}
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
		};

		const onAbort = () => {
			if (!settled) {
				settled = true;
				cleanup();
				reject(new Error('waitForERC20Balance aborted'));
			}
		};

		if (signal) {
			signal.addEventListener('abort', onAbort);
		}

		intervalId = setInterval(async () => {
			if (settled) return;

			if (Date.now() > deadline) {
				settled = true;
				cleanup();
				reject(new Error(
					`waitForERC20Balance timed out after ${timeoutMs}ms. ` +
					`Target: ${targetAmount.toString()}, Token: ${tokenAddress}, Owner: ${owner}`
				));
				return;
			}

			try {
				const balance: bigint = await contract.balanceOf(owner);
				if (balance >= targetAmount) {
					settled = true;
					cleanup();
					resolve(balance);
				}
			} catch {
				// Ignore transient RPC errors during polling
			}
		}, intervalMs);
	});
}

/**
 * Wait for an ERC-20 allowance to reach a minimum amount.
 * Useful after submitting an approve tx and waiting for confirmation.
 *
 * @param provider - Ethers JSON-RPC provider
 * @param tokenAddress - ERC-20 token contract address
 * @param owner - Token owner address
 * @param spender - Approved spender address
 * @param minAllowance - Minimum allowance to wait for
 * @param options - Polling options
 * @returns The final allowance when the target is reached
 */
export async function waitForERC20Allowance(
	provider: ethers.Provider,
	tokenAddress: string,
	owner: string,
	spender: string,
	minAllowance: bigint,
	options: WaitForBalanceOptions = {}
): Promise<bigint> {
	const { intervalMs = 3000, timeoutMs = 60_000, signal } = options;
	const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
	const deadline = Date.now() + timeoutMs;

	// Check immediately
	const initialAllowance: bigint = await contract.allowance(owner, spender);
	if (initialAllowance >= minAllowance) {
		return initialAllowance;
	}

	return new Promise<bigint>((resolve, reject) => {
		let settled = false;
		let intervalId: ReturnType<typeof setInterval> | null = null;

		const cleanup = () => {
			if (intervalId !== null) {
				clearInterval(intervalId);
				intervalId = null;
			}
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
		};

		const onAbort = () => {
			if (!settled) {
				settled = true;
				cleanup();
				reject(new Error('waitForERC20Allowance aborted'));
			}
		};

		if (signal) {
			signal.addEventListener('abort', onAbort);
		}

		intervalId = setInterval(async () => {
			if (settled) return;

			if (Date.now() > deadline) {
				settled = true;
				cleanup();
				reject(new Error(
					`waitForERC20Allowance timed out after ${timeoutMs}ms. ` +
					`MinAllowance: ${minAllowance.toString()}, Token: ${tokenAddress}`
				));
				return;
			}

			try {
				const allowance: bigint = await contract.allowance(owner, spender);
				if (allowance >= minAllowance) {
					settled = true;
					cleanup();
					resolve(allowance);
				}
			} catch {
				// Ignore transient RPC errors
			}
		}, intervalMs);
	});
}

/**
 * Convert a USD amount to ERC-20 token wei given the token's decimals.
 * This is a pure math utility — no oracle dependency.
 *
 * @param usdAmount - Amount in USD (e.g. 50.00)
 * @param decimals - Token decimals (e.g. 6 for USDT, 18 for DOC)
 * @returns Amount in smallest token unit as bigint
 *
 * @example
 * // $50 → 50_000_000 (USDT has 6 decimals)
 * usdToTokenWei(50, 6) → 50000000n
 *
 * // $50 → 50000000000000000000 (DOC has 18 decimals)
 * usdToTokenWei(50, 18) → 50000000000000000000n
 */
export function usdToTokenWei(usdAmount: number, decimals: number): bigint {
	if (usdAmount < 0) {
		throw new Error('USD amount must be non-negative');
	}
	if (!Number.isFinite(usdAmount)) {
		throw new Error('USD amount must be finite');
	}
	if (decimals < 0 || !Number.isInteger(decimals)) {
		throw new Error('Decimals must be a non-negative integer');
	}

	// Use string manipulation to avoid floating-point precision issues
	// Split into integer and fractional parts
	const str = usdAmount.toFixed(decimals);
	const [intPart, fracPart = ''] = str.split('.');
	const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
	const rawStr = intPart + paddedFrac;

	return BigInt(rawStr);
}

/**
 * Convert ERC-20 token wei to a USD amount given the token's decimals.
 * Inverse of `usdToTokenWei`. Pure math utility.
 *
 * @param tokenWei - Amount in smallest token unit
 * @param decimals - Token decimals
 * @returns USD amount as number
 */
export function tokenWeiToUsd(tokenWei: bigint, decimals: number): number {
	const divisor = 10 ** decimals;
	return Number(tokenWei) / divisor;
}

/**
 * Format an ERC-20 token amount from smallest unit to human-readable string.
 *
 * @param amount - Amount in smallest unit (bigint or string)
 * @param decimals - Token decimals
 * @param displayDecimals - Number of decimal places to show (default: 6)
 * @returns Formatted string (e.g. "50.000000")
 */
export function formatTokenAmount(
	amount: bigint | string,
	decimals: number,
	displayDecimals: number = 6
): string {
	const value = Number(BigInt(amount)) / (10 ** decimals);
	return value.toFixed(displayDecimals);
}
