/**
 * USDT0 Cross-Chain Bridge Service
 *
 * Handles USDT0 bridging between RSK (Rootstock) and Arbitrum using the
 * LayerZero OFT (Omnichain Fungible Token) standard.
 *
 * OFT contracts:
 *   RSK:       0x1a594d5d5d1c426281C1064B07f23F57B2716B61
 *   Arbitrum:  0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92
 */

import { ethers } from 'ethers';

// OFT (Omnichain Fungible Token) ABI — LayerZero send/quote/retry
const OFT_ABI = [
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), bool payInLzToken) payable returns (tuple(uint256 nativeFee, uint256 lzTokenFee))',
	'function send(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), tuple(uint256 nativeFee, uint256 lzTokenFee), address refundAddress) payable returns (tuple(bytes32 guid, uint64 nonce, tuple(uint256 nativeFee, uint256 lzTokenFee) fee))',
	'function retryMessage(address token, bytes memory message, bool payInLzToken) external payable'
];

// USDT0 ERC-20 ABI — minimal subset for balance, approval
const USDT0_ERC20_ABI = [
	'function balanceOf(address owner) view returns (uint256)',
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function decimals() view returns (uint8)'
];

/** Address of the USDT0 OFT contract on RSK */
export const OFT_RSK_ADDRESS = '0x1a594d5d5d1c426281C1064B07f23F57B2716B61';

/** Address of the USDT0 OFT contract on Arbitrum */
export const OFT_ARBITRUM_ADDRESS = '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92';

/** Auto-approve buffer for bridge transactions (approve amount * 1.01, never MAX_UINT256) */
export const AUTO_APPROVE_BUFFER = 1.01;

export class Usdt0BridgeService {
	private readonly usdt0Address: string;
	private readonly oftAddress: string;

	/**
	 * @param usdt0Address - Address of USDT0 token on the source chain
	 * @param oftAddress - Address of the OFT bridge contract
	 */
	constructor(usdt0Address: string, oftAddress: string) {
		this.usdt0Address = usdt0Address;
		this.oftAddress = oftAddress;
	}

	/**
	 * Get OFT contract instance (always creates fresh to use correct signer)
	 * @param signer - Connected wallet signer
	 */
	getOFTContract(signer: ethers.Wallet): ethers.Contract {
		return new ethers.Contract(this.oftAddress, OFT_ABI, signer);
	}

	/**
	 * Get USDT0 token contract instance (always creates fresh to use correct signer)
	 * @param signer - Connected wallet signer
	 */
	getUSDT0Contract(signer: ethers.Wallet): ethers.Contract {
		return new ethers.Contract(this.usdt0Address, USDT0_ERC20_ABI, signer);
	}

	/**
	 * Get USDT0 balance for the given signer's address
	 * @param signer - Connected wallet signer
	 */
	async getUSDT0Balance(signer: ethers.Wallet): Promise<bigint> {
		try {
			const usdt0Contract = this.getUSDT0Contract(signer);
			const balance: bigint = await usdt0Contract.balanceOf(signer.address);
			return balance;
		} catch (error) {
			throw new Error(
				`Failed to get USDT0 balance: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Quote bridge costs and expected received amount
	 *
	 * @param amount - USDT0 amount in smallest unit (6 decimals) as string
	 * @param fromDstEid - Source chain LayerZero EID (e.g. 30333 for RSK)
	 * @param toDstEid - Destination chain LayerZero EID (e.g. 30110 for Arbitrum)
	 * @param signer - Connected wallet signer
	 * @returns Native fee, LZ token fee, and expected received amount
	 */
	async quoteBridge(
		amount: string,
		fromDstEid: number,
		toDstEid: number,
		signer: ethers.Wallet
	): Promise<{
		nativeFee: bigint;
		lzTokenFee: bigint;
		receivedAmount: string;
	}> {
		try {
			const oftContract = this.getOFTContract(signer);
			const amountLD = BigInt(amount);

			// Convert recipient address to bytes32 (pad address to 32 bytes)
			const recipientBytes32 = ethers.zeroPadValue(signer.address, 32);

			const sendParam = {
				dstEid: toDstEid,
				to: recipientBytes32,
				amountLD,
				minAmountLD: amountLD,
				extraOptions: '0x',
				composeMsg: '0x',
				oftCmd: '0x'
			};

			const quoteResult = await oftContract.quoteSend(sendParam, false);

			return {
				nativeFee: quoteResult?.nativeFee ? BigInt(quoteResult.nativeFee.toString()) : BigInt(0),
				lzTokenFee: quoteResult?.lzTokenFee ? BigInt(quoteResult.lzTokenFee.toString()) : BigInt(0),
				receivedAmount: amount
			};
		} catch (error) {
			throw new Error(
				`Failed to quote bridge: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Bridge USDT0 from source chain to destination chain
	 *
	 * @param amount - USDT0 amount in smallest unit (6 decimals) as string
	 * @param fromDstEid - Source chain LayerZero EID
	 * @param toDstEid - Destination chain LayerZero EID
	 * @param signer - Connected wallet signer
	 * @param recipientAddress - Destination wallet address (20-byte hex)
	 * @param minAmountLD - Minimum amount to receive on destination (for slippage protection)
	 * @returns Transaction hash and LayerZero GUID
	 */
	async bridge(
		amount: string,
		fromDstEid: number,
		toDstEid: number,
		signer: ethers.Wallet,
		recipientAddress: string,
		minAmountLD?: string
	): Promise<{ txHash: string; guid: string }> {
		try {
			const oftContract = this.getOFTContract(signer);
			const usdt0Contract = this.getUSDT0Contract(signer);
			const amountLD = BigInt(amount);

			// Validate preconditions
			const preconditions = await this.validateSendPreconditions(amount, signer);
			if (!preconditions.allowed) {
				throw new Error(preconditions.reason ?? 'Bridge preconditions not met');
			}

			// Ensure OFT contract has approval to spend USDT0
			const requiredAllowance = amountLD;
			const currentAllowance: bigint = await usdt0Contract.allowance(signer.address, this.oftAddress);
			if (currentAllowance < requiredAllowance) {
				throw new Error(
					`Insufficient USDT0 allowance for OFT bridge. ` +
					`Have: ${currentAllowance.toString()}, Need: ${requiredAllowance.toString()}. ` +
					`Call approveBridge() first.`
				);
			}

			// Convert recipient to bytes32
			const recipientBytes32 = ethers.zeroPadValue(recipientAddress, 32);

			// Default minAmountLD to 98% of amount if not specified (2% slippage)
			const minAmount = minAmountLD ? BigInt(minAmountLD) : (amountLD * BigInt(98)) / BigInt(100);

			const sendParam = {
				dstEid: toDstEid,
				to: recipientBytes32,
				amountLD,
				minAmountLD: minAmount,
				extraOptions: '0x',
				composeMsg: '0x',
				oftCmd: '0x'
			};

			// Quote fees first
			const quoteResult = await oftContract.quoteSend(sendParam, false);
			const fee = {
				nativeFee: quoteResult?.nativeFee ?? BigInt(0),
				lzTokenFee: quoteResult?.lzTokenFee ?? BigInt(0)
			};

			// Execute send with fee
			const tx = await oftContract.send(sendParam, fee, signer.address, { value: fee.nativeFee });

			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			// Extract GUID from LayerZero PacketSent event logs
			const PACKET_SENT_TOPIC = ethers.id('PacketSent(bytes,bytes,address)');
			let guid = '0x';
			for (const log of receipt.logs) {
				if (log.topics[0] === PACKET_SENT_TOPIC) {
					guid = log.topics?.[1] ?? '0x';
					break;
				}
			}

			return {
				txHash: receipt.hash,
				guid
			};
		} catch (error) {
			throw new Error(
				`Failed to bridge USDT0: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Approve OFT contract to spend USDT0
	 * Uses AUTO_APPROVE_BUFFER (1.01x) — never approves MAX_UINT256
	 *
	 * @param amount - USDT0 amount in smallest unit as string
	 * @param signer - Connected wallet signer
	 * @returns Transaction hash
	 */
	async approveBridge(amount: string, signer: ethers.Wallet): Promise<string> {
		try {
			const usdt0Contract = this.getUSDT0Contract(signer);
			const amountLD = BigInt(amount);

			// Calculate approval amount with 1% buffer (never MAX_UINT256)
			const bufferNumerator = BigInt(Math.floor(AUTO_APPROVE_BUFFER * 100));
			const bufferDenominator = BigInt(100);
			const approveAmount = (amountLD * bufferNumerator) / bufferDenominator;

			// Check existing allowance
			const currentAllowance: bigint = await usdt0Contract.allowance(
				signer.address,
				this.oftAddress
			);
			if (currentAllowance >= approveAmount) {
				return '0x0';
			}

			const tx = await usdt0Contract.approve(this.oftAddress, approveAmount.toString());
			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			return receipt.hash;
		} catch (error) {
			throw new Error(
				`Failed to approve bridge: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Retry a failed bridge message via LayerZero.
	 *
	 * The `retryMessage` function on the OFT contract requires the original
	 * LayerZero packet payload, not just the GUID. The caller must provide the
	 * original message bytes retrieved from the failed transaction's calldata
	 * or from LayerZero Scan.
	 *
	 * @param token - Address of the token being bridged (OFT contract)
	 * @param message - The original LayerZero message payload bytes
	 * @param signer - Connected wallet signer
	 * @param payInLzToken - Whether to pay retry fee in LZ token (default false)
	 * @returns Transaction hash
	 */
	async retryBridge(
		token: string,
		message: string,
		signer: ethers.Wallet,
		payInLzToken: boolean = false
	): Promise<string> {
		try {
			const oftContract = this.getOFTContract(signer);

			const tx = await oftContract.retryMessage(token, message, payInLzToken);
			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			return receipt.hash;
		} catch (error) {
			throw new Error(
				`Failed to retry bridge: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Validate all preconditions before bridging
	 * Checks: balance sufficiency, amount validity
	 * Note: Allowance is checked separately in bridge() since it requires the exact amount
	 */
	async validateSendPreconditions(
		amount: string,
		signer: ethers.Wallet
	): Promise<{ allowed: boolean; reason?: string }> {
		try {
			const amountLD = BigInt(amount);
			if (amountLD <= BigInt(0)) {
				return { allowed: false, reason: 'Amount must be greater than zero' };
			}

			// Check USDT0 balance
			const balance = await this.getUSDT0Balance(signer);
			if (balance < amountLD) {
				return {
					allowed: false,
					reason: `Insufficient USDT0 balance: have ${balance.toString()}, need ${amountLD.toString()}`
				};
			}

			// Check ETH balance for gas fees
			if (!signer.provider) {
				return { allowed: false, reason: 'Signer has no provider' };
			}
			const ethBalance = await signer.provider.getBalance(signer.address);
			if (ethBalance === BigInt(0)) {
				return { allowed: false, reason: 'Insufficient ETH balance for gas fees' };
			}

			return { allowed: true };
		} catch (error) {
			return {
				allowed: false,
				reason: error instanceof Error ? error.message : 'Unknown error during validation'
			};
		}
	}

	/**
	 * Get the USDT0 token address
	 */
	getUSDT0Address(): string {
		return this.usdt0Address;
	}

	/**
	 * Get the OFT contract address
	 */
	getOFTAddress(): string {
		return this.oftAddress;
	}

	/**
	 * Multi-hop bridge: Route USDT0 through an intermediate chain.
	 *
	 * Uses LayerZero compose messages to forward tokens from an intermediate
	 * chain to the final destination. The flow is:
	 *   Source → Intermediate (via send with composeMsg)
	 *   Intermediate → Destination (automatic via MultiHop Composer)
	 *
	 * The composeMsg encodes the final destination so the intermediate OFT
	 * knows where to forward the tokens.
	 *
	 * @param amount - USDT0 amount in smallest unit (6 decimals) as string
	 * @param fromDstEid - Source chain LayerZero EID
	 * @param intermediateDstEid - Intermediate chain LayerZero EID
	 * @param finalDstEid - Final destination chain LayerZero EID
	 * @param signer - Connected wallet signer
	 * @param finalRecipientAddress - Final recipient address on destination chain
	 * @param minAmountLD - Minimum amount to receive on destination
	 * @returns Transaction hash and LayerZero GUID
	 */
	async bridgeMultiHop(
		amount: string,
		fromDstEid: number,
		intermediateDstEid: number,
		finalDstEid: number,
		signer: ethers.Wallet,
		finalRecipientAddress: string,
		minAmountLD?: string
	): Promise<{ txHash: string; guid: string }> {
		try {
			const oftContract = this.getOFTContract(signer);
			const usdt0Contract = this.getUSDT0Contract(signer);
			const amountLD = BigInt(amount);

			// Validate preconditions
			const preconditions = await this.validateSendPreconditions(amount, signer);
			if (!preconditions.allowed) {
				throw new Error(preconditions.reason ?? 'Bridge preconditions not met');
			}

			// Ensure OFT contract has approval to spend USDT0
			const currentAllowance: bigint = await usdt0Contract.allowance(signer.address, this.oftAddress);
			if (currentAllowance < amountLD) {
				throw new Error(
					`Insufficient USDT0 allowance for OFT bridge. ` +
					`Have: ${currentAllowance.toString()}, Need: ${amountLD.toString()}. ` +
					`Call approveBridge() first.`
				);
			}

			// Encode compose message for the intermediate hop
			// The composeMsg tells the intermediate chain's OFT where to forward the tokens
			const finalRecipientBytes32 = ethers.zeroPadValue(finalRecipientAddress, 32);
			const composeMsg = ethers.AbiCoder.defaultAbiCoder().encode(
				['uint32', 'bytes32', 'uint256'],
				[finalDstEid, finalRecipientBytes32, amountLD]
			);

			// The intermediate chain receives tokens, then forwards to final destination
			const intermediateRecipientBytes32 = ethers.zeroPadValue(this.oftAddress, 32);

			// Default minAmountLD to 96% for multi-hop (more slippage tolerance)
			const minAmount = minAmountLD ? BigInt(minAmountLD) : (amountLD * BigInt(96)) / BigInt(100);

			const sendParam = {
				dstEid: intermediateDstEid,
				to: intermediateRecipientBytes32,
				amountLD,
				minAmountLD: minAmount,
				extraOptions: '0x',
				composeMsg,
				oftCmd: '0x'
			};

			// Quote fees (includes both hops)
			const quoteResult = await oftContract.quoteSend(sendParam, false);
			const fee = {
				nativeFee: quoteResult?.nativeFee ?? BigInt(0),
				lzTokenFee: quoteResult?.lzTokenFee ?? BigInt(0)
			};

			// Execute send with compose message
			const tx = await oftContract.send(sendParam, fee, signer.address, { value: fee.nativeFee });

			const receipt = await tx.wait();
			if (!receipt) {
				throw new Error('Transaction receipt is null');
			}

			// Extract GUID from LayerZero PacketSent event logs
			const PACKET_SENT_TOPIC = ethers.id('PacketSent(bytes,bytes,address)');
			let guid = '0x';
			for (const log of receipt.logs) {
				if (log.topics[0] === PACKET_SENT_TOPIC) {
					guid = log.topics?.[1] ?? '0x';
					break;
				}
			}

			return {
				txHash: receipt.hash,
				guid
			};
		} catch (error) {
			throw new Error(
				`Failed to multi-hop bridge USDT0: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}
}
