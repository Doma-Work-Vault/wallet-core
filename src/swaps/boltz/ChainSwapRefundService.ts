/**
 * Boltz Chain Swap Refund Service
 * Handles L-BTC refunds for failed/expired chain swaps
 * 
 * IMPORTANT: Refund Responsibility
 * ==================================
 * 
 * For L-BTC → RBTC swaps:
 * - **L-BTC refunds**: OUR responsibility (user sent L-BTC first, we generated refund keys)
 * - **RBTC refunds**: User's wallet responsibility (handled by their wallet, not our app)
 * 
 * Why we need refund implementation:
 * - User pays from external wallet (Aqua, Green, SideSwap, etc.)
 * - We generate and store the refund keys during swap creation
 * - If swap fails/expires, only we can refund because we hold the keys
 * - User's wallet cannot refund because it doesn't have the refund private key
 */

import type { Network as LiquidNetwork } from 'liquidjs-lib/src/networks';
import type { ChainSwapData, ChainSwapRefundCheck, ChainSwapRefundParams, ChainSwapRefundResult } from './types';
import { ECPairFactory } from 'ecpair';
import { BoltzClient } from './BoltzClient';
import { createMusig, tweakMusig, hashForWitnessV1 } from './taproot/musig';
import { OutputType, SwapTreeSerializer, detectSwap, targetFee } from 'boltz-core';
import { Transaction as LiquidTransaction, networks as LiquidNetworks } from 'liquidjs-lib';
import { constructRefundTransaction as liquidConstructRefundTransaction, type LiquidRefundDetails } from 'boltz-core/dist/lib/liquid';
import * as ecc from 'tiny-secp256k1';
import { NetworkType } from '../../core/types';

const ECPair = ECPairFactory(ecc);

/**
 * Chain Swap Refund Handler
 * Manages the entire refund lifecycle for L-BTC → RBTC swaps
 */
export class ChainSwapRefundService {
    private network: NetworkType;
    private boltzClient: BoltzClient;
    private explorerUrl: string;

    constructor(boltzClient: BoltzClient, network: NetworkType) {
        this.network = network;
        this.boltzClient = boltzClient;
        this.explorerUrl = this.network === 'mainnet'
            ? 'https://blockstream.info/liquid/api'
            : 'https://blockstream.info/liquidtestnet/api';
    }

    /**
     * Check if a swap can be refunded
     * A swap is refundable when:
     * 1. User sent L-BTC (lockupTxHash exists)
     * 2. Swap expired (past timeout block height)
     * 3. Not already refunded
     * 4. Not already completed
     */
    async isSwapRefundable(swapData: ChainSwapData): Promise<ChainSwapRefundCheck> {
        // Check if user sent L-BTC
        if (!swapData.lockupTxHash) {
            return {
                refundable: false,
                reason: 'No L-BTC lockup transaction found'
            };
        }

        // Check if already refunded
        if (swapData.refundTxHash) {
            return {
                refundable: false,
                reason: 'Swap already refunded'
            };
        }

        // Check if already completed
        if (swapData.status === 'transaction.claimed') {
            return {
                refundable: false,
                reason: 'Swap already completed successfully'
            };
        }

        // Get current block height from Liquid network
        try {
            const currentBlockHeight = await this.getLiquidBlockHeight();

            // Check if timeout has passed
            if (currentBlockHeight < swapData.lockupTimeoutBlockHeight) {
                const blocksRemaining = swapData.lockupTimeoutBlockHeight - currentBlockHeight;
                const minutesRemaining = blocksRemaining * 1; // Liquid: ~1 min blocks

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
            console.error('Failed to check refundability:', error);
            return {
                refundable: false,
                reason: 'Failed to fetch current block height'
            };
        }
    }

    /**
     * Refund L-BTC from a failed/expired chain swap
     * 
     * This constructs and broadcasts a refund transaction to claim back the locked L-BTC
     * Supports both cooperative (with Boltz signature) and uncooperative (timelock) refunds
     * 
     * IMPORTANT: This only works for L-BTC → RBTC swaps where the user sent L-BTC first
     */
    async refundChainSwap(
        swapData: ChainSwapData,
        params: ChainSwapRefundParams
    ): Promise<ChainSwapRefundResult> {
        // Check if refundable
        const refundCheck = await this.isSwapRefundable(swapData);
        if (!refundCheck.refundable) {
            throw new Error(`Swap not refundable: ${refundCheck.reason}`);
        }

        // Validate refund address is different from lockup address
        if (params.refundAddress === swapData.lockupAddress) {
            throw new Error('Refund address cannot be the same as lockup address');
        }

        // Get Liquid network
        const liquidNetwork = this.network === 'mainnet'
            ? LiquidNetworks.liquid
            : LiquidNetworks.testnet;

        // Parse and decode refund address
        const { address: LiquidAddress } = await import('liquidjs-lib');
        let outputScript: Buffer;
        let blindingKey: Buffer | undefined;

        try {
            // Check if confidential address
            const decoded = LiquidAddress.fromConfidential(params.refundAddress);
            outputScript = LiquidAddress.toOutputScript(params.refundAddress, liquidNetwork as LiquidNetwork);
            blindingKey = decoded.blindingKey;
        } catch {
            // Non-confidential address
            outputScript = LiquidAddress.toOutputScript(params.refundAddress, liquidNetwork as LiquidNetwork);
        }

        // Get UTXOs
        const utxos = await this.getLiquidUTXOs(swapData);

        // Parse refund private key
        const refundKeyPair = ECPair.fromPrivateKey(Buffer.from(swapData.refundPrivateKey, 'hex'));

        // Build refund transaction
        let refundTx: LiquidTransaction;

        // Check if Taproot (modern) or legacy
        if (swapData.swapTree && swapData.serverPublicKey) {
            refundTx = await this.constructTaprootRefund(
                swapData,
                utxos,
                refundKeyPair,
                outputScript,
                liquidNetwork as LiquidNetwork,
                blindingKey
            );
        } else {
            throw new Error('Legacy refunds not implemented - all new swaps use Taproot');
        }

        // Broadcast refund transaction
        const txHash = await this.broadcastLiquidTransaction(refundTx.toHex());

        // Update swap data
        swapData.refundTxHash = txHash;
        swapData.status = 'swap.refunded';
        swapData.updatedAt = Date.now();

        return {
            txHash,
            swapData
        };
    }

    /**
     * Construct Taproot refund transaction
     * 
     * Attempts cooperative refund first (with Boltz's signature for key path spending)
     * Falls back to uncooperative refund (script path spending with timelock) if cooperative fails
     */
    private async constructTaprootRefund(
        swapData: ChainSwapData,
        utxos: { hex: string; timeoutBlockHeight: number }[],
        refundKeyPair: ReturnType<typeof ECPair.fromPrivateKey>,
        outputScript: Buffer,
        liquidNetwork: LiquidNetwork,
        blindingKey?: Buffer
    ): Promise<LiquidTransaction> {
        // Parse server public key
        const serverPublicKey = Buffer.from(swapData.serverPublicKey!, 'hex');

        // Deserialize swap tree
        const swapTree = SwapTreeSerializer.deserializeSwapTree(swapData.swapTree!);

        // Create MuSig2 aggregated key
        const musig = await createMusig(refundKeyPair, serverPublicKey);
        const tweakedKey = tweakMusig('L-BTC', musig, swapTree.tree);

        // Build refund details for each UTXO
        const refundDetails: LiquidRefundDetails[] = [];

        for (const utxo of utxos) {
            const lockupTx = LiquidTransaction.fromHex(utxo.hex);
            const swapOutput = detectSwap(tweakedKey, lockupTx);

            if (!swapOutput) {
                console.warn('⚠️ Could not detect swap output in UTXO');
                continue;
            }

            refundDetails.push({
                ...swapOutput,
                cooperative: true, // Try cooperative first
                swapTree,
                keys: refundKeyPair,
                type: OutputType.Taproot,
                txHash: lockupTx.getHash(),
                blindingPrivateKey: Buffer.from(swapData.blindingKey, 'hex'),
                internalKey: musig.getAggregatedPublicKey()
            } as LiquidRefundDetails);
        }

        // Get fee estimate (sat/vbyte)
        const feePerVbyte = await this.getLiquidFeeEstimate();

        // Construct refund transaction using boltz-core
        const refundTx = await targetFee(
            feePerVbyte,
            (fee) => liquidConstructRefundTransaction(
                refundDetails,
                outputScript,
                swapData.lockupTimeoutBlockHeight,
                fee,
                true, // Enable RBF
                liquidNetwork,
                blindingKey
            ),
            true
        );

        // Try cooperative refund (get partial signature from Boltz)
        try {
            // Get partial signature from Boltz for each input
            for (let i = 0; i < refundTx.ins.length; i++) {
                const freshMusig = await createMusig(refundKeyPair, serverPublicKey);
                const boltzSig = await this.boltzClient.getPartialRefundSignature(
                    swapData.id,
                    'chain',
                    Buffer.from(freshMusig.getPublicNonce()),
                    refundTx,
                    i
                );

                freshMusig.aggregateNonces([[serverPublicKey, boltzSig.pubNonce]]);
                tweakMusig('L-BTC', freshMusig, swapTree.tree);
                freshMusig.initializeSession(
                    hashForWitnessV1(
                        'L-BTC',
                        liquidNetwork,
                        refundDetails,
                        refundTx,
                        i
                    )
                );
                freshMusig.signPartial();
                freshMusig.addPartial(serverPublicKey, boltzSig.signature);

                refundTx.ins[i].witness = [freshMusig.aggregatePartials()];
            }

            return refundTx;
        } catch (error) {
            console.warn('⚠️ Cooperative refund failed, falling back to uncooperative:', error);

            // Reconstruct with uncooperative path (script path spending)
            const uncoopDetails = refundDetails.map(detail => ({
                ...detail,
                cooperative: false
            }));

            const uncoopTx = await targetFee(
                feePerVbyte,
                (fee) => liquidConstructRefundTransaction(
                    uncoopDetails,
                    outputScript,
                    swapData.lockupTimeoutBlockHeight,
                    fee,
                    true,
                    liquidNetwork,
                    blindingKey
                ),
                true
            );

            return uncoopTx;
        }
    }

    /**
     * Get current Liquid block height from explorer API
     */
    private async getLiquidBlockHeight(): Promise<number> {
        try {
            const response = await fetch(`${this.explorerUrl}/blocks/tip/height`);
            if (!response.ok) {
                throw new Error(`Failed to fetch block height: ${response.status}`);
            }
            const height = await response.text();
            return parseInt(height, 10);
        } catch (error) {
            console.error('Failed to get Liquid block height:', error);
            throw error;
        }
    }

    /**
     * Fetch L-BTC UTXOs for a swap's lockup address
     */
    private async getLiquidUTXOs(swapData: ChainSwapData): Promise<{ hex: string; timeoutBlockHeight: number }[]> {
        try {
            // Get UTXOs for the lockup address
            const utxosResponse = await fetch(`${this.explorerUrl}/address/${swapData.lockupAddress}/utxo`);
            if (!utxosResponse.ok) {
                throw new Error(`Failed to fetch UTXOs: ${utxosResponse.status}`);
            }

            const utxos = await utxosResponse.json() as Array<{ txid: string; vout: number }>;

            if (utxos.length === 0) {
                throw new Error('No UTXOs found for lockup address');
            }

            // Fetch raw transaction hex for each UTXO
            const rawTxs: { hex: string; timeoutBlockHeight: number }[] = [];
            for (const utxo of utxos) {
                const txResponse = await fetch(`${this.explorerUrl}/tx/${utxo.txid}/hex`);
                if (!txResponse.ok) {
                    console.warn(`Failed to fetch tx ${utxo.txid}:`, txResponse.status);
                    continue;
                }
                const hex = await txResponse.text();
                rawTxs.push({
                    hex,
                    timeoutBlockHeight: swapData.lockupTimeoutBlockHeight
                });
            }

            return rawTxs;
        } catch (error) {
            console.error('Failed to get Liquid UTXOs:', error);
            throw error;
        }
    }

    /**
     * Get Liquid fee estimate from explorer API
     */
    private async getLiquidFeeEstimate(): Promise<number> {
        try {
            const response = await fetch(`${this.explorerUrl}/fee-estimates`);
            if (!response.ok) {
                throw new Error(`Failed to fetch fee estimate: ${response.status}`);
            }
            const estimates = await response.json() as Record<string, number>;
            // Use 3 block target
            return estimates['3'] || 0.1;
        } catch (error) {
            console.warn('Failed to get fee estimate, using default:', error);
            return 0.1; // Default to 0.1 sat/vbyte
        }
    }

    /**
     * Broadcast Liquid transaction to the network
     */
    private async broadcastLiquidTransaction(txHex: string): Promise<string> {
        try {
            const response = await fetch(`${this.explorerUrl}/tx`, {
                method: 'POST',
                body: txHex,
                headers: {
                    'Content-Type': 'text/plain'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Broadcast failed: ${response.status} - ${errorText}`);
            }

            return await response.text();
        } catch (error) {
            console.error('Failed to broadcast Liquid transaction:', error);
            throw error;
        }
    }
}

