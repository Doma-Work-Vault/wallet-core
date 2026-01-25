/**
 * RIF Relay Claim Service
 * Handles gasless RBTC claiming via RIF Relay for reverse and chain swaps
 * 
 * This service consolidates the RIF Relay claiming logic that was duplicated
 * in ReverseSwapService and ChainSwapService.
 * 
 * RIF Relay allows users to claim RBTC without having gas by:
 * 1. Deploying a Smart Wallet (if needed)
 * 2. Executing the claim transaction FROM the Smart Wallet
 * 3. RIF Relay paymaster pays the gas fees
 */

import type { RifRelayClaimParams } from './types';
import { Contract, ethers } from 'ethers';
import { isRifRelayAvailable } from '../../utils/networkConfig';
import { relayClaimTransaction } from '../rif/Signer';
import EtherSwapArtifact from 'boltz-core/out/EtherSwap.sol/EtherSwap.json';

/**
 * RIF Relay Claim Service
 * Provides gasless RBTC claiming functionality
 */
export class RifRelayClaimService {
    /**
     * Claim RBTC via RIF Relay (gasless)
     * 
     * This method uses Boltz's proven RIF Relay implementation to claim RBTC
     * without requiring the user to have gas. The transaction is executed FROM
     * a Smart Wallet (deployed if needed). RIF Relay pays the gas fees.
     * 
     * @param params - Claim parameters
     * @returns Transaction hash
     */
    async claimViaRifRelay(params: RifRelayClaimParams): Promise<string> {
        try {
            // Validate required parameters
            if (!params.walletSigner) {
                throw new Error('Wallet signer is required');
            }

            if (!params.contractAddress || !ethers.isAddress(params.contractAddress.toLowerCase())) {
                throw new Error('Invalid contract address');
            }

            if (!params.preimage || params.preimage.length !== 64) {
                throw new Error('Invalid preimage: must be 32 bytes (64 hex characters)');
            }

            if (!params.refundAddress || !ethers.isAddress(params.refundAddress.toLowerCase())) {
                throw new Error('Invalid refund address');
            }

            if (!params.amount || params.amount <= 0) {
                throw new Error('Invalid amount: must be greater than 0');
            }

            if (!params.timelock || params.timelock <= 0) {
                throw new Error('Invalid timelock');
            }

            // Check RIF Relay availability
            if (!isRifRelayAvailable()) {
                throw new Error('RIF Relay is not available on this network');
            }

            // Create EtherSwap contract instance
            const etherSwapContract = new Contract(
                params.contractAddress,
                EtherSwapArtifact.abi,
                params.walletSigner
            );

            // Use RIF Relay to execute gasless claim
            // This will:
            // 1. Deploy Smart Wallet if needed
            // 2. Encode the claim transaction
            // 3. Submit to RIF Relay network
            // 4. Paymaster pays gas fees
            // 5. Transaction executes from Smart Wallet
            const txHash = await relayClaimTransaction(
                params.walletSigner,
                etherSwapContract as any,
                params.preimage,
                params.amount,
                params.refundAddress,
                params.timelock
            );

            return txHash;
        } catch (error) {
            console.error('❌ RIF Relay claim failed:', error);
            throw new Error('Failed to claim via RIF Relay: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Wait for RIF Relay transaction confirmation
     * 
     * @param txHash - Transaction hash
     * @param provider - Ethers provider
     * @returns Transaction receipt
     */
    async waitForConfirmation(
        txHash: string,
        provider: ethers.Provider
    ): Promise<ethers.TransactionReceipt | null> {
        try {
            const receipt = await provider.waitForTransaction(txHash);
            return receipt;
        } catch (error) {
            console.error('Failed to wait for RIF Relay confirmation:', error);
            return null;
        }
    }
}

