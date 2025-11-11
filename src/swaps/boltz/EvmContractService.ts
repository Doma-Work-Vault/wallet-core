/**
 * EVM Contract Service
 * Consolidates all EtherSwap contract interactions for Boltz swaps
 * 
 * This service handles:
 * - Lockup: Locking funds in EtherSwap contract (submarine swaps)
 * - Claim: Claiming funds from EtherSwap contract (reverse & chain swaps)
 * - Refund: Refunding locked funds (submarine swaps)
 * - Event parsing: Getting actual lockup parameters from blockchain events
 * - Gas estimation: Estimating gas costs for all operations
 * 
 * NOTE: This replaces EvmLockupHandler and consolidates logic from swap services
 */

import { Contract, ethers, Interface } from 'ethers';
import { BoltzClient } from './BoltzClient';
import { satoshiToWei } from '../../utils/networkConfig';
import EtherSwapArtifact from 'boltz-core/out/EtherSwap.sol/EtherSwap.json';
import type {
	EvmLockupParams as LockupParams,
	EvmLockupResult as LockupResult,
	EvmClaimParams as ClaimParams,
	EvmClaimResult as ClaimResult,
	EvmRefundParams as RefundParams,
	EvmRefundResult as RefundResult,
	LockupEventParams
} from './types';

/**
 * EVM Contract Service
 * Manages all EtherSwap contract interactions for RBTC swaps
 */
export class EvmContractService {
    private boltzClient: BoltzClient;
    constructor(boltzClient?: BoltzClient) {
        this.boltzClient = boltzClient || new BoltzClient();
    }

    /**
     * Get EtherSwap contract address from Boltz API
     * 
     * @returns EtherSwap contract address for RBTC
     */
    async getEtherSwapAddress(): Promise<string> {
        try {
            const contracts = await this.boltzClient.getContractAddresses();

            // Boltz API returns contracts per chain
            // For RBTC, we look for 'rsk' or 'RBTC' key
            const rskContracts = (contracts as any).rsk || (contracts as any).RBTC;

            if (!rskContracts || !rskContracts.swapContracts || !rskContracts.swapContracts.EtherSwap) {
                throw new Error('EtherSwap contract address not found for RBTC');
            }

            return rskContracts.swapContracts.EtherSwap;
        } catch (error) {
            console.error('Failed to get EtherSwap address:', error);
            throw new Error('Failed to get EtherSwap contract address: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Lock funds in EtherSwap contract (Submarine swaps)
     * 
     * User locks RBTC on-chain, which Boltz will claim after paying Lightning invoice.
     * 
     * @param params - Lockup parameters
     * @returns Transaction hash and contract address
     */
    async lockFunds(params: LockupParams): Promise<LockupResult> {
        try {
            // Validate parameters
            if (!params.signer) {
                throw new Error('Signer is required');
            }

            if (!params.preimageHash || params.preimageHash.length !== 64) {
                throw new Error('Invalid preimage hash: must be 32 bytes (64 hex characters)');
            }

            if (!params.claimAddress || !ethers.isAddress(params.claimAddress)) {
                throw new Error('Invalid claim address');
            }

            if (!params.timeoutBlockHeight || params.timeoutBlockHeight <= 0) {
                throw new Error('Invalid timeout block height');
            }

            if (!params.amountSats || params.amountSats <= 0) {
                throw new Error('Invalid amount: must be greater than 0');
            }

            // Get EtherSwap contract address
            const contractAddress = await this.getEtherSwapAddress();

            // Create contract instance
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);

            // Convert amount from satoshis to wei
            const amountWei = satoshiToWei(params.amountSats);

            // Ensure preimageHash has 0x prefix
            const preimageHashWithPrefix = params.preimageHash.startsWith('0x')
                ? params.preimageHash
                : '0x' + params.preimageHash;

            // Call EtherSwap.lock() function
            // function lock(bytes32 preimageHash, address claimAddress, uint timelock) external payable
            const tx = await etherSwap.lock(
                preimageHashWithPrefix,
                params.claimAddress,
                params.timeoutBlockHeight,
                {
                    value: amountWei
                }
            );

            // Wait for transaction confirmation
            const receipt = await tx.wait();

            return {
                txHash: receipt.hash,
                contractAddress
            };
        } catch (error) {
            console.error('❌ Failed to lock funds:', error);
            throw new Error('Failed to lock funds in EtherSwap: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Claim funds from EtherSwap contract (Reverse & Chain swaps)
     * 
     * User provides preimage to claim RBTC that Boltz locked on-chain.
     * 
     * @param params - Claim parameters
     * @returns Transaction hash
     */
    async claimFunds(params: ClaimParams): Promise<ClaimResult> {
        try {
            // Validate parameters
            if (!params.signer) {
                throw new Error('Signer is required');
            }

            if (!params.preimage || params.preimage.length !== 64) {
                throw new Error('Invalid preimage: must be 32 bytes (64 hex characters)');
            }

            if (!params.refundAddress || !ethers.isAddress(params.refundAddress)) {
                throw new Error('Invalid refund address');
            }

            if (!params.timelock || params.timelock <= 0) {
                throw new Error('Invalid timelock');
            }

            if (!params.amount || params.amount <= 0) {
                throw new Error('Invalid amount: must be greater than 0');
            }

            // Get EtherSwap contract address
            const contractAddress = await this.getEtherSwapAddress();

            // Create contract instance
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);

            // Convert amount from satoshis to wei
            const amountWei = satoshiToWei(params.amount);

            // Ensure preimage has 0x prefix
            const preimageWithPrefix = params.preimage.startsWith('0x')
                ? params.preimage
                : '0x' + params.preimage;

            // Call EtherSwap.claim() function
            // function claim(bytes32 preimage, uint amount, address refundAddress, uint timelock) external
            const tx = await etherSwap.claim(
                preimageWithPrefix,
                amountWei,
                params.refundAddress,
                params.timelock
            );

            // Wait for transaction confirmation
            const receipt = await tx.wait();

            return {
                txHash: receipt.hash
            };
        } catch (error) {
            console.error('❌ Failed to claim funds:', error);

            if (error instanceof Error && error.message.includes('swap has no Ether locked')) {
                console.error('💡 Swap not found. Reasons: \n\n 1) TX not confirmed, \n\n 2) Wrong parameters, \n\n 3) Already claimed');
            }

            throw new Error('Failed to claim funds from EtherSwap: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Refund locked funds from EtherSwap contract (Submarine swaps)
     * 
     * User can refund RBTC if Boltz failed to pay Lightning invoice and timeout passed.
     * 
     * @param params - Refund parameters
     * @returns Transaction hash
     */
    async refundFunds(params: RefundParams): Promise<RefundResult> {
        try {
            // Validate parameters
            if (!params.signer) {
                throw new Error('Signer is required');
            }

            if (!params.preimageHash || params.preimageHash.length !== 64) {
                throw new Error('Invalid preimage hash: must be 32 bytes (64 hex characters)');
            }

            if (!params.claimAddress || !ethers.isAddress(params.claimAddress)) {
                throw new Error('Invalid claim address');
            }

            if (!params.timelock || params.timelock <= 0) {
                throw new Error('Invalid timelock');
            }

            if (!params.amount || params.amount <= 0) {
                throw new Error('Invalid amount: must be greater than 0');
            }

            // Get EtherSwap contract address
            const contractAddress = await this.getEtherSwapAddress();

            // Create contract instance
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);

            // Convert amount from satoshis to wei
            const amountWei = satoshiToWei(params.amount);

            // Ensure preimageHash has 0x prefix
            const preimageHashWithPrefix = params.preimageHash.startsWith('0x')
                ? params.preimageHash
                : '0x' + params.preimageHash;

            // Call EtherSwap.refund() function
            // function refund(bytes32 preimageHash, uint amount, address claimAddress, uint timelock) external
            const tx = await etherSwap.refund(
                preimageHashWithPrefix,
                amountWei,
                params.claimAddress,
                params.timelock
            );

            // Wait for transaction confirmation
            const receipt = await tx.wait();

            return {
                txHash: receipt.hash
            };
        } catch (error) {
            console.error('❌ Failed to refund funds:', error);
            throw new Error('Failed to refund funds from EtherSwap: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Get actual lockup parameters from the Lockup event in the blockchain transaction
     * 
     * CRITICAL: The Boltz API response may have different values than what's actually locked.
     * Always use the values from the Lockup event for claiming/refunding.
     * 
     * The Lockup event contains:
     * event Lockup(bytes32 indexed preimageHash, uint256 amount, address claimAddress, address indexed refundAddress, uint256 timelock)
     * 
     * @param preimageHash - Preimage hash to match the event
     * @param lockupTxHash - Transaction hash of the lockup
     * @param provider - Ethers provider to query the blockchain
     * @returns Lockup event parameters or null if not found
     */
    async getLockupEventParameters(
        preimageHash: string,
        lockupTxHash: string,
        provider: ethers.Provider,
        contractAddress?: string
    ): Promise<LockupEventParams | null> {
        try {
            // Get EtherSwap contract address
            contractAddress = contractAddress || await this.getEtherSwapAddress();

            // Wait for the transaction receipt with retry logic
            let receipt = null;
            const maxRetries = 10;
            const retryDelay = 2000; // 2 seconds

            for (let i = 0; i < maxRetries; i++) {
                receipt = await provider.getTransactionReceipt(lockupTxHash);

                if (receipt) {
                    break;
                }

                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }

            if (!receipt) {
                console.error('❌ Transaction receipt not found after', maxRetries, 'attempts');
                return null;
            }

            // Create contract interface to parse events
            const iface = new Interface(EtherSwapArtifact.abi);

            // Ensure preimageHash has 0x prefix for comparison
            const preimageHashWithPrefix = preimageHash.startsWith('0x') ? preimageHash : '0x' + preimageHash;

            // Find the Lockup event in the logs
            for (const log of receipt.logs) {
                // Check if this log is from our contract
                if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
                    continue;
                }

                try {
                    const parsed = iface.parseLog({
                        topics: [...log.topics],
                        data: log.data
                    });

                    if (parsed?.name === 'Lockup') {
                        // Event structure: Lockup(bytes32 indexed preimageHash, uint256 amount, address claimAddress, address indexed refundAddress, uint256 timelock)
                        const eventPreimageHash = parsed.args[0];

                        // Check if this is the event for our swap
                        if (eventPreimageHash.toLowerCase() === preimageHashWithPrefix.toLowerCase()) {
                            return {
                                amount: parsed.args[1],
                                claimAddress: parsed.args[2],
                                refundAddress: parsed.args[3],
                                timelock: Number(parsed.args[4])
                            };
                        }
                    }
                } catch (e) {
                    // Not a Lockup event or failed to parse, continue
                    console.error('⚠️ Failed to parse log:', e);
                }
            }

            console.warn('⚠️ No matching Lockup event found in transaction');
            return null;
        } catch (error) {
            console.error('❌ Failed to get lockup event parameters:', error);
            return null;
        }
    }

    /**
     * Estimate gas for lockup transaction
     * 
     * @param params - Lockup parameters
     * @returns Estimated gas cost in wei
     */
    async estimateLockupGas(params: LockupParams): Promise<bigint> {
        try {
            const contractAddress = await this.getEtherSwapAddress();
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);
            const amountWei = satoshiToWei(params.amountSats);
            const preimageHashWithPrefix = params.preimageHash.startsWith('0x')
                ? params.preimageHash
                : '0x' + params.preimageHash;

            const gasEstimate = await etherSwap.lock.estimateGas(
                preimageHashWithPrefix,
                params.claimAddress,
                params.timeoutBlockHeight,
                {
                    value: amountWei
                }
            );

            // Get current gas price
            const feeData = await params.signer.provider?.getFeeData();
            const gasPrice = feeData?.gasPrice || 60000000n; // Default to 0.06 gwei

            return gasEstimate * gasPrice;
        } catch (error) {
            console.error('Failed to estimate lockup gas:', error);
            // Return a conservative estimate
            return 100000n * 60000000n; // ~100k gas @ 0.06 gwei
        }
    }

    /**
     * Estimate gas for claim transaction
     * 
     * @param params - Claim parameters
     * @returns Estimated gas cost in wei
     */
    async estimateClaimGas(params: ClaimParams): Promise<bigint> {
        try {
            const contractAddress = await this.getEtherSwapAddress();
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);
            const amountWei = satoshiToWei(params.amount);
            const preimageWithPrefix = params.preimage.startsWith('0x')
                ? params.preimage
                : '0x' + params.preimage;

            const gasEstimate = await etherSwap.claim.estimateGas(
                preimageWithPrefix,
                amountWei,
                params.refundAddress,
                params.timelock
            );

            // Get current gas price
            const feeData = await params.signer.provider?.getFeeData();
            const gasPrice = feeData?.gasPrice || 60000000n; // Default to 0.06 gwei

            return gasEstimate * gasPrice;
        } catch (error) {
            console.error('Failed to estimate claim gas:', error);
            // Return a conservative estimate
            return 100000n * 60000000n; // ~100k gas @ 0.06 gwei
        }
    }

    /**
     * Estimate gas for refund transaction
     * 
     * @param params - Refund parameters
     * @returns Estimated gas cost in wei
     */
    async estimateRefundGas(params: RefundParams): Promise<bigint> {
        try {
            const contractAddress = await this.getEtherSwapAddress();
            const etherSwap = new Contract(contractAddress, EtherSwapArtifact.abi, params.signer);
            const amountWei = satoshiToWei(params.amount);
            const preimageHashWithPrefix = params.preimageHash.startsWith('0x')
                ? params.preimageHash
                : '0x' + params.preimageHash;

            const gasEstimate = await etherSwap.refund.estimateGas(
                preimageHashWithPrefix,
                amountWei,
                params.claimAddress,
                params.timelock
            );

            // Get current gas price
            const feeData = await params.signer.provider?.getFeeData();
            const gasPrice = feeData?.gasPrice || 60000000n; // Default to 0.06 gwei

            return gasEstimate * gasPrice;
        } catch (error) {
            console.error('Failed to estimate refund gas:', error);
            // Return a conservative estimate
            return 100000n * 60000000n; // ~100k gas @ 0.06 gwei
        }
    }

    /**
     * Check if user has sufficient balance for lockup
     * 
     * @param signer - User's wallet signer
     * @param amountSats - Amount to lock in satoshis
     * @returns True if user has sufficient balance
     */
    async hasSufficientBalance(signer: ethers.Signer, amountSats: number): Promise<boolean> {
        try {
            const address = await signer.getAddress();
            const balance = await signer.provider?.getBalance(address);

            if (!balance) {
                return false;
            }

            const amountWei = satoshiToWei(amountSats);
            const gasEstimate = 100000n * 60000000n; // Conservative gas estimate
            const totalRequired = amountWei + gasEstimate;

            return balance >= totalRequired;
        } catch (error) {
            console.error('Failed to check balance:', error);
            return false;
        }
    }
}

