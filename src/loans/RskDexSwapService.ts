/**
 * RSK DEX Swap Service (DOC → USDT0)
 *
 * Handles token swaps on RSK using Uniswap V2 compatible DEX routers
 * (e.g., Sovryn, Trove). Used as step 2 of the loan flow to convert
 * DOC stablecoins into USDT0 before bridging to Arbitrum.
 *
 * Supports any DEX that implements the standard Uniswap V2 Router interface.
 */

import { ethers } from 'ethers';

// Uniswap V2 Router ABI — minimal subset for swaps and quoting
const UNISWAP_V2_ROUTER_ABI = [
	'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
	'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
	'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
	'function factory() external pure returns (address)',
	'function WETH() external pure returns (address)'
];

// Uniswap V2 Factory ABI — for pair discovery
const UNISWAP_V2_FACTORY_ABI = [
	'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

// Uniswap V2 Pair ABI — for reserves
const UNISWAP_V2_PAIR_ABI = [
	'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
	'function token0() external view returns (address)',
	'function token1() external view returns (address)'
];

// ERC-20 ABI for approvals
const ERC20_APPROVE_ABI = [
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function balanceOf(address owner) view returns (uint256)',
	'function decimals() view returns (uint8)'
];

export interface RskDexSwapConfig {
	routerAddress: string;
	factoryAddress?: string;
}

export interface SwapQuote {
	inputAmount: string;
	outputAmount: string;
	path: string[];
	priceImpact: string;
	minOutputAmount: string;
}

export interface SwapResult {
	txHash: string;
	inputAmount: string;
	outputAmount: string;
}

export class RskDexSwapService {
	private readonly routerAddress: string;
	private readonly factoryAddress: string | undefined;
	private routerContract: ethers.Contract | null = null;

	constructor(config: RskDexSwapConfig) {
		this.routerAddress = config.routerAddress;
		this.factoryAddress = config.factoryAddress;
	}

	/**
	 * Get router contract instance
	 */
	getRouterContract(signer: ethers.Wallet): ethers.Contract {
		if (!this.routerContract || this.routerContract.runner !== signer) {
			this.routerContract = new ethers.Contract(
				this.routerAddress,
				UNISWAP_V2_ROUTER_ABI,
				signer
			);
		}
		return this.routerContract;
	}

	/**
	 * Get a swap quote for exact input amount
	 *
	 * @param inputToken - Address of input token (e.g., DOC)
	 * @param outputToken - Address of output token (e.g., USDT0)
	 * @param inputAmount - Amount of input token in smallest unit
	 * @param signer - Connected wallet signer
	 * @returns Quote with expected output, path, and price impact
	 */
	async getQuote(
		inputToken: string,
		outputToken: string,
		inputAmount: string,
		signer: ethers.Wallet
	): Promise<SwapQuote> {
		try {
			const router = this.getRouterContract(signer);
			const path = [inputToken, outputToken];
			const inputAmountBN = BigInt(inputAmount);

			if (inputAmountBN <= BigInt(0)) {
				throw new Error('Input amount must be greater than zero');
			}

			const amountsOut: bigint[] = await router.getAmountsOut(inputAmountBN, path);
			const outputAmount = amountsOut[amountsOut.length - 1];

			// Calculate price impact using reserves if available
			let priceImpact = '0';
			if (this.factoryAddress) {
				try {
					const impact = await this.calculatePriceImpact(
						inputToken,
						outputToken,
						inputAmountBN,
						signer
					);
					priceImpact = impact;
				} catch {
					priceImpact = 'unknown';
				}
			}

			// Calculate minimum output with default 0.5% slippage
			const minOutput = (outputAmount * BigInt(995)) / BigInt(1000);

			return {
				inputAmount: inputAmount,
				outputAmount: outputAmount.toString(),
				path,
				priceImpact,
				minOutputAmount: minOutput.toString()
			};
		} catch (error) {
			throw new Error(
				`Failed to get swap quote: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Execute a token swap
	 *
	 * @param inputToken - Address of input token
	 * @param outputToken - Address of output token
	 * @param inputAmount - Amount of input token in smallest unit
	 * @param minOutputAmount - Minimum acceptable output (slippage protection)
	 * @param signer - Connected wallet signer
	 * @param deadlineSeconds - Seconds until swap expires (default: 20 minutes)
	 * @returns Transaction hash and amounts
	 */
	async swap(
		inputToken: string,
		outputToken: string,
		inputAmount: string,
		minOutputAmount: string,
		signer: ethers.Wallet,
		deadlineSeconds: number = 1200
	): Promise<SwapResult> {
		try {
			const router = this.getRouterContract(signer);
			const inputAmountBN = BigInt(inputAmount);
			const minOutputBN = BigInt(minOutputAmount);

			if (inputAmountBN <= BigInt(0)) {
				throw new Error('Input amount must be greater than zero');
			}

			if (minOutputBN < BigInt(0)) {
				throw new Error('Minimum output amount must be non-negative');
			}

			// Validate balance
			const tokenContract = new ethers.Contract(inputToken, ERC20_APPROVE_ABI, signer);
			const balance: bigint = await tokenContract.balanceOf(signer.address);
			if (balance < inputAmountBN) {
				throw new Error(
					`Insufficient token balance: have ${balance.toString()}, need ${inputAmountBN.toString()}`
				);
			}

			// Check and set approval
			const currentAllowance: bigint = await tokenContract.allowance(
				signer.address,
				this.routerAddress
			);
			if (currentAllowance < inputAmountBN) {
				const approveTx = await tokenContract.approve(this.routerAddress, inputAmount);
				await approveTx.wait();
			}

			const path = [inputToken, outputToken];
			const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;

			const tx = await router.swapExactTokensForTokens(
				inputAmountBN,
				minOutputBN,
				path,
				signer.address,
				deadline
			);

			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			// Get actual output from the getAmountsOut estimate (actual output may differ slightly)
			let actualOutput = minOutputAmount;
			try {
				const amounts: bigint[] = await router.getAmountsOut(inputAmountBN, path);
				actualOutput = amounts[amounts.length - 1].toString();
			} catch {
				actualOutput = minOutputAmount;
			}

			return {
				txHash: receipt.hash,
				inputAmount: inputAmount,
				outputAmount: actualOutput
			};
		} catch (error) {
			throw new Error(
				`Failed to execute swap: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Approve the DEX router to spend a token
	 *
	 * @param tokenAddress - Address of the token to approve
	 * @param amount - Amount to approve in smallest unit
	 * @param signer - Connected wallet signer
	 * @returns Transaction hash or '0x0' if already approved
	 */
	async approve(
		tokenAddress: string,
		amount: string,
		signer: ethers.Wallet
	): Promise<string> {
		try {
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, signer);
			const amountBN = BigInt(amount);

			// Check existing allowance
			const currentAllowance: bigint = await tokenContract.allowance(
				signer.address,
				this.routerAddress
			);
			if (currentAllowance >= amountBN) {
				return '0x0';
			}

			const tx = await tokenContract.approve(this.routerAddress, amount);
			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			return receipt.hash;
		} catch (error) {
			throw new Error(
				`Failed to approve token: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get the router address
	 */
	getRouterAddress(): string {
		return this.routerAddress;
	}

	/**
	 * Calculate price impact of a swap using pair reserves
	 */
	private async calculatePriceImpact(
		inputToken: string,
		outputToken: string,
		inputAmount: bigint,
		signer: ethers.Wallet
	): Promise<string> {
		if (!this.factoryAddress) {
			return 'unknown';
		}

		const factory = new ethers.Contract(
			this.factoryAddress,
			UNISWAP_V2_FACTORY_ABI,
			signer
		);

		const pairAddress: string = await factory.getPair(inputToken, outputToken);
		if (pairAddress === ethers.ZeroAddress) {
			return 'unknown';
		}

		const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, signer);
		const [reserve0, reserve1] = await pair.getReserves();
		const token0: string = await pair.token0();

		const isToken0Input = token0.toLowerCase() === inputToken.toLowerCase();
		const inputReserve = isToken0Input ? reserve0 : reserve1;
		const outputReserve = isToken0Input ? reserve1 : reserve0;

		// Price impact = inputAmount / (inputReserve + inputAmount)
		const impactNumerator = inputAmount * BigInt(10000);
		const impactDenominator = inputReserve + inputAmount;
		const impactBps = impactNumerator / impactDenominator;

		return (Number(impactBps) / 100).toFixed(2);
	}
}
