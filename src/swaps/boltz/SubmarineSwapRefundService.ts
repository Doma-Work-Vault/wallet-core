/**
 * Boltz Submarine Swap Refund Service
 * Handles refunds for failed/expired submarine swaps
 * 
 * Submarine swaps are: RBTC/BTC/L-BTC → Lightning
 * User locks funds first, then Boltz pays the Lightning invoice.
 * If Boltz doesn't pay, user can refund after timeout.
 * 
 * REFUND TYPES:
 * - RBTC: Refund via EtherSwap contract (will use EvmContractService)
 * - BTC: Refund via Bitcoin UTXO transaction (Taproot/P2WSH)
 * - L-BTC: Refund via Liquid UTXO transaction (Taproot/P2WSH)
 */

import type { SubmarineSwapData, SubmarineRefundCheck, SubmarineRefundParams, SubmarineRefundResult } from './types';
import { BoltzClient } from './BoltzClient';
import { EvmContractService } from './EvmContractService';
import { getRSKConfig } from '../../utils/networkConfig';

/**
 * Submarine Swap Refund Handler
 * Manages the entire refund lifecycle for RBTC/BTC/L-BTC → Lightning swaps
 */
export class SubmarineSwapRefundService {
    private evmContractService: EvmContractService;

    constructor(boltzClient: BoltzClient) {
        this.evmContractService = new EvmContractService(boltzClient);
    }

    /**
     * Set EVM contract service for RBTC refunds
     * This will be called after EvmContractService is created
     */
    setEvmContractService(evmContractService: EvmContractService): void {
        this.evmContractService = evmContractService;
    }

    /**
     * Check if a swap can be refunded
     * A swap is refundable when:
     * 1. User locked funds (lockupTxHash exists for UTXO chains, or contract lockup for RBTC)
     * 2. Swap failed or expired (invoice not paid)
     * 3. Not already refunded
     * 4. Timeout has passed
     */
    async isSwapRefundable(swapData: SubmarineSwapData): Promise<SubmarineRefundCheck> {
        // Check if already refunded
        if (swapData.refundTxHash) {
            return {
                refundable: false,
                reason: 'Swap already refunded'
            };
        }

        // Check if invoice was paid (swap completed successfully)
        if (swapData.status === 'invoice.paid' || swapData.status === 'transaction.claimed') {
            return {
                refundable: false,
                reason: 'Swap completed successfully - Lightning invoice was paid'
            };
        }

        // For RBTC: Check if funds were locked in contract
        if (swapData.fromAsset === 'RBTC') {
            if (!swapData.lockupTxHash) {
                return {
                    refundable: false,
                    reason: 'No RBTC lockup transaction found'
                };
            }

            // Get current block height from RSK
            try {
                const currentBlockHeight = await this.getRSKBlockHeight();

                // Check if timeout has passed
                if (currentBlockHeight < swapData.timeoutBlockHeight) {
                    const blocksRemaining = swapData.timeoutBlockHeight - currentBlockHeight;
                    const minutesRemaining = blocksRemaining * 0.5; // RSK: ~30 sec blocks

                    return {
                        refundable: false,
                        reason: `Swap timeout not reached yet. ${blocksRemaining} blocks (~${minutesRemaining} minutes) remaining`,
                        currentBlockHeight
                    };
                }

                return {
                    refundable: true,
                    currentBlockHeight
                };
            } catch (error) {
                console.error('Failed to check RBTC refundability:', error);
                return {
                    refundable: false,
                    reason: 'Failed to fetch current block height'
                };
            }
        }

        // For BTC/L-BTC: Check if funds were locked
        if (!swapData.lockupTxHash) {
            return {
                refundable: false,
                reason: `No ${swapData.fromAsset} lockup transaction found`
            };
        }

        // TODO: Implement BTC/L-BTC refundability check
        // Will require fetching current block height from respective networks
        // and comparing with timeoutBlockHeight

        return {
            refundable: false,
            reason: `${swapData.fromAsset} refunds not yet implemented`
        };
    }

    /**
     * Refund funds from a failed/expired submarine swap
     * 
     * For RBTC: Calls EtherSwap.refund()
     * For BTC: Creates and broadcasts Bitcoin refund transaction
     * For L-BTC: Creates and broadcasts Liquid refund transaction
     */
    async refundSubmarineSwap(
        swapData: SubmarineSwapData,
        params: SubmarineRefundParams
    ): Promise<SubmarineRefundResult> {
        console.log(`🔄 Starting ${swapData.fromAsset} submarine swap refund for swap:`, params.swapId);

        // Check if refundable
        const refundCheck = await this.isSwapRefundable(swapData);
        if (!refundCheck.refundable) {
            throw new Error(`Swap not refundable: ${refundCheck.reason}`);
        }

        console.log('✅ Swap is refundable');

        // Route to appropriate refund handler
        if (swapData.fromAsset === 'RBTC') {
            return await this.refundRBTC(swapData, params);
        } else if (swapData.fromAsset === 'BTC') {
            return await this.refundBTC(swapData, params);
        } else if (swapData.fromAsset === 'L-BTC') {
            return await this.refundLBTC(swapData, params);
        } else {
            throw new Error(`Unsupported asset for refund: ${swapData.fromAsset}`);
        }
    }

    /**
     * Refund RBTC via EtherSwap contract
     * Uses EvmContractService to call the refund function
     */
    private async refundRBTC(
        swapData: SubmarineSwapData,
        params: SubmarineRefundParams
    ): Promise<SubmarineRefundResult> {
        if (!params.signer) {
            throw new Error('Signer is required for RBTC refunds');
        }

        if (!swapData.preimageHash) {
            throw new Error('Missing preimage hash for RBTC refund');
        }

        if (!swapData.claimAddress) {
            throw new Error('Missing claim address for RBTC refund');
        }

        console.log('🔧 Refunding RBTC via EtherSwap contract...');

        // Call EtherSwap.refund() via EvmContractService
        const result = await this.evmContractService.refundFunds({
            signer: params.signer,
            preimageHash: swapData.preimageHash,
            amount: swapData.fromAmount,
            claimAddress: swapData.claimAddress,
            timelock: swapData.timeoutBlockHeight
        });

        // Update swap data
        swapData.refundTxHash = result.txHash;
        swapData.status = 'swap.refunded';
        swapData.updatedAt = Date.now();

        return {
            txHash: result.txHash,
            swapData
        };
    }

    /**
     * Refund BTC via Bitcoin UTXO transaction
     * Creates and broadcasts a refund transaction using refund key
     */
    private async refundBTC(
        swapData: SubmarineSwapData,
        params: SubmarineRefundParams
    ): Promise<SubmarineRefundResult> {
        if (!params.refundAddress) {
            throw new Error('Refund address is required for BTC refunds');
        }

        console.log('🔧 Refunding BTC via Bitcoin transaction...');

        // TODO: Implement Bitcoin refund transaction building
        // Similar to ChainSwapRefundService but for Bitcoin network
        // Steps:
        // 1. Parse refund private key from swapData
        // 2. Fetch Bitcoin UTXOs for swap address
        // 3. Build refund transaction (Taproot if available, otherwise P2WSH)
        // 4. Try cooperative refund first (get Boltz signature)
        // 5. Fall back to timelock refund if cooperative fails
        // 6. Broadcast transaction
        // 7. Update swap data

        throw new Error('BTC refunds not yet implemented - will be added when needed');
    }

    /**
     * Refund L-BTC via Liquid UTXO transaction
     * Similar to ChainSwapRefundService but for submarine swaps
     */
    private async refundLBTC(
        swapData: SubmarineSwapData,
        params: SubmarineRefundParams
    ): Promise<SubmarineRefundResult> {
        if (!params.refundAddress) {
            throw new Error('Refund address is required for L-BTC refunds');
        }

        console.log('🔧 Refunding L-BTC via Liquid transaction...');

        // TODO: Implement L-BTC refund transaction building
        // Can reuse much of ChainSwapRefundService logic
        // The main difference is the swap data structure and address derivation
        // Steps:
        // 1. Parse refund private key from swapData
        // 2. Fetch Liquid UTXOs for swap address
        // 3. Build refund transaction using boltz-core (Taproot)
        // 4. Try cooperative refund first (get Boltz signature)
        // 5. Fall back to timelock refund if cooperative fails
        // 6. Broadcast transaction
        // 7. Update swap data

        throw new Error('L-BTC refunds not yet implemented - will be added when needed');
    }

    /**
     * Get current RSK block height
     */
    private async getRSKBlockHeight(): Promise<number> {
        const rpcUrl = getRSKConfig().rpcUrl;

        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch block height: ${response.status}`);
            }

            const result = await response.json();
            return parseInt(result.result, 16);
        } catch (error) {
            console.error('Failed to get RSK block height:', error);
            throw error;
        }
    }
}
