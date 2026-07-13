/**
 * Money on Chain (MoC) DOC Minting Service
 *
 * Handles DOC token minting using the MoC Core v2 protocol on RSK (Rootstock).
 * User sends rBTC as collateral → mints DOC stablecoins.
 *
 * MoC Core v2 proxy address: 0xf773B590aF754D597770937Fa8ea7AbDf2668370
 */

import { ethers } from 'ethers';

// MoC Core v2 ABI — minimal functional subset for minting/redeeming DOC
const MOC_ABI = [
	'function mintDoc(uint256 btcToMint) external payable returns (uint256)',
	'function redeemDoc(uint256 docAmount) external returns (uint256)',
	'function globalCoverage() external view returns (uint256)',
	'function paused() external view returns (bool)',
	'function state() external view returns (uint8)',
	'function docToken() external view returns (address)',
	'function getDocEmission(uint256 amountToMint) external view returns (uint256)'
];

// DOC ERC-20 ABI — minimal subset for balance, approval
const DOC_ERC20_ABI = [
	'function balanceOf(address owner) view returns (uint256)',
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function decimals() view returns (uint8)'
];

/** MoC Core v2 proxy contract address on RSK */
export const MOC_PROXY_ADDRESS = '0xf773B590aF754D597770937Fa8ea7AbDf2668370';

/** Coverage ratio threshold — minting requires ratio > 4 */
const MIN_COVERAGE_RATIO = 4;

export class MoCMintingService {
	private mocContract: ethers.Contract | null = null;
	private docContract: ethers.Contract | null = null;

	/**
	 * Get MoC contract instance (lazy init)
	 * @param signer - Connected RSK wallet signer
	 */
	getMoCContract(signer: ethers.Wallet): ethers.Contract {
		if (!this.mocContract) {
			this.mocContract = new ethers.Contract(MOC_PROXY_ADDRESS, MOC_ABI, signer);
		}
		return this.mocContract;
	}

	/**
	 * Get DOC token contract instance (lazy init)
	 * @param signer - Connected RSK wallet signer
	 */
	async getDocContract(signer: ethers.Wallet): Promise<ethers.Contract> {
		if (!this.docContract) {
			const mocContract = this.getMoCContract(signer);
			const docAddress: string = await mocContract.docToken();
			this.docContract = new ethers.Contract(docAddress, DOC_ERC20_ABI, signer);
		}
		return this.docContract;
	}

	/**
	 * Get global coverage ratio from MoC contract
	 * @returns Coverage ratio (e.g. 5.2 = 520% collateralization)
	 */
	async getGlobalCoverageRatio(): Promise<number> {
		try {
			const mocContract = this.mocContract;
			if (!mocContract) {
				throw new Error('MoC contract not initialized. Call getMoCContract() first.');
			}
			const ratio: bigint = await mocContract.globalCoverage();
			return parseFloat(ethers.formatUnits(ratio, 18));
		} catch (error) {
			throw new Error(
				`Failed to get coverage ratio: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Check if MoC protocol is paused
	 */
	async isPaused(): Promise<boolean> {
		try {
			const mocContract = this.mocContract;
			if (!mocContract) {
				throw new Error('MoC contract not initialized. Call getMoCContract() first.');
			}
			return (await mocContract.paused()) as boolean;
		} catch (error) {
			throw new Error(
				`Failed to check pause state: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Estimate DOC mint output for a given rBTC input amount
	 * @param rbtcAmount - rBTC amount to send in wei (18 decimals string)
	 * @returns Estimated DOC output, rBTC cost, and coverage ratio
	 */
	async estimateDocMint(rbtcAmount: string): Promise<{
		docAmount: string;
		rbtcCost: string;
		coverageRatio: number;
	}> {
		try {
			const mocContract = this.mocContract;
			if (!mocContract) {
				throw new Error('MoC contract not initialized. Call getMoCContract() first.');
			}

			const coverageRatio = await this.getGlobalCoverageRatio();

			if (coverageRatio < MIN_COVERAGE_RATIO) {
				throw new Error(
					`Coverage ratio too low for minting: ${coverageRatio.toFixed(2)} (minimum: ${MIN_COVERAGE_RATIO})`
				);
			}

			const docAmount: bigint = await mocContract.getDocEmission(rbtcAmount);

			return {
				docAmount: docAmount.toString(),
				rbtcCost: rbtcAmount,
				coverageRatio
			};
		} catch (error) {
			throw new Error(
				`Failed to estimate DOC mint: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Mint DOC by sending rBTC to the MoC contract
	 * Uses msg.value to send rBTC with the transaction
	 *
	 * @param rbtcAmount - Amount of rBTC to send as wei string
	 * @param signer - Connected RSK wallet signer
	 * @returns Transaction hash and amount of DOC minted
	 */
	async mintDoc(
		rbtcAmount: string,
		signer: ethers.Wallet
	): Promise<{ txHash: string; docMinted: string }> {
		try {
			const mocContract = this.getMoCContract(signer);

			// Validate mint preconditions
			const preconditions = await this.validateMintPreconditions();
			if (!preconditions.allowed) {
				throw new Error(preconditions.reason ?? 'Minting preconditions not met');
			}

			const rbtcWei = BigInt(rbtcAmount);
			if (rbtcWei <= BigInt(0)) {
				throw new Error('rBTC amount must be greater than zero');
			}

			// Check balance
			const provider = signer.provider;
			if (!provider) {
				throw new Error('Signer has no provider');
			}
			const balance = await provider.getBalance(signer.address);
			if (balance < rbtcWei) {
				throw new Error('Insufficient rBTC balance for minting');
			}

			// Estimate DOC output before executing
			const estimatedDoc: bigint = await mocContract.getDocEmission(rbtcAmount);

			// Execute mintDoc with value
			const tx = await mocContract.mintDoc(rbtcAmount, {
				value: rbtcAmount
			});

			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			return {
				txHash: receipt.hash,
				docMinted: estimatedDoc.toString()
			};
		} catch (error) {
			throw new Error(
				`Failed to mint DOC: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Redeem DOC for rBTC (reverse operation)
	 * @param docAmount - Amount of DOC to redeem in wei (18 decimals)
	 * @param signer - Connected RSK wallet signer
	 * @returns Transaction hash and amount of rBTC received
	 */
	async redeemDoc(
		docAmount: string,
		signer: ethers.Wallet
	): Promise<{ txHash: string; rbtcReceived: string }> {
		try {
			const mocContract = this.getMoCContract(signer);

			const docWei = BigInt(docAmount);
			if (docWei <= BigInt(0)) {
				throw new Error('DOC amount must be greater than zero');
			}

			// Check DOC balance
			const docContract = await this.getDocContract(signer);
			const balance: bigint = await docContract.balanceOf(signer.address);
			if (balance < docWei) {
				throw new Error('Insufficient DOC balance');
			}

			// Check allowance
			const allowance: bigint = await docContract.allowance(signer.address, MOC_PROXY_ADDRESS);
			if (allowance < docWei) {
				// Approve MoC to spend DOC
				const approveTx = await docContract.approve(MOC_PROXY_ADDRESS, docAmount);
				await approveTx.wait();
			}

			// Estimate rBTC output via static call before executing
			let estimatedRbtc: string;
			try {
				const rbtcResult: bigint = await mocContract.redeemDoc.staticCall(docAmount);
				estimatedRbtc = rbtcResult.toString();
			} catch {
				estimatedRbtc = '0';
			}

			const tx = await mocContract.redeemDoc(docAmount);
			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			return {
				txHash: receipt.hash,
				rbtcReceived: estimatedRbtc
			};
		} catch (error) {
			throw new Error(
				`Failed to redeem DOC: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Validate all preconditions before minting DOC
	 * Checks: coverage ratio, pause state, contract status
	 */
	async validateMintPreconditions(): Promise<{ allowed: boolean; reason?: string }> {
		try {
			if (!this.mocContract) {
				return { allowed: false, reason: 'MoC contract not initialized' };
			}

			// Check if paused
			const paused: boolean = await this.mocContract.paused();
			if (paused) {
				return { allowed: false, reason: 'MoC protocol is paused' };
			}

			// Check coverage ratio
			const coverageRatio = await this.getGlobalCoverageRatio();
			if (coverageRatio < MIN_COVERAGE_RATIO) {
				return {
					allowed: false,
					reason: `Coverage ratio too low: ${coverageRatio.toFixed(2)} (minimum: ${MIN_COVERAGE_RATIO})`
				};
			}

			return { allowed: true };
		} catch (error) {
			return {
				allowed: false,
				reason: error instanceof Error ? error.message : 'Unknown error during validation'
			};
		}
	}
}
