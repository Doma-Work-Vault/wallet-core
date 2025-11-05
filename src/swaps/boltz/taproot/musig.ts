/**
 * MuSig2 utilities for Taproot swaps
 * Based on Boltz web app implementation
 * 
 * MuSig2 is used for Taproot key path spending (cooperative spending)
 * Allows both parties to create a single aggregated signature
 */

import type { ECPairInterface } from 'ecpair';
import type { Taptree } from 'bitcoinjs-lib/src/types';
import type { Network, Transaction } from 'bitcoinjs-lib';
import type { RefundDetails, ClaimDetails } from 'boltz-core';
import type { Transaction as LiquidTransaction } from 'liquidjs-lib';
import type { Network as LiquidNetwork } from 'liquidjs-lib/src/networks';
import type { LiquidRefundDetails, LiquidClaimDetails } from 'boltz-core/dist/lib/liquid';
import { Buffer } from 'buffer';
import { randomBytes } from 'crypto';
import { Musig, TaprootUtils } from 'boltz-core';
import { TaprootUtils as LiquidTaprootUtils } from 'boltz-core/dist/lib/liquid';

// Lazy load secp256k1-zkp
let secpZkpInstance: any = null;

async function getSecp() {
	if (!secpZkpInstance) {
		const zkp = (await import('@vulpemventures/secp256k1-zkp')).default;
		secpZkpInstance = await zkp();
	}
	return { secpZkp: secpZkpInstance };
}

/**
 * Create a MuSig2 instance for cooperative signing
 * The public keys are aggregated to create a single public key
 * Boltz's public key always comes first in the aggregation
 */
export const createMusig = async (
    ourKeys: ECPairInterface,
    theirPublicKey: Buffer
): Promise<Musig> => {
    // Initialize secp256k1-zkp (required for MuSig2)
    const { secpZkp } = await getSecp();

    return new Musig(secpZkp, ourKeys, randomBytes(32), [
        // The key of Boltz always comes first
        theirPublicKey,
        Buffer.from(ourKeys.publicKey)
    ]);
};

/**
 * Tweak the MuSig2 aggregated key with the Taptree
 * This allows the key to commit to script paths while maintaining key path spending
 */
export const tweakMusig = (asset: string, musig: Musig, tree: Taptree): Buffer => {
    const utils = asset === 'L-BTC' ? LiquidTaprootUtils : TaprootUtils;
    return utils.tweakMusig(musig, tree);
};

/**
 * Hash the transaction for witness v1 (Taproot) signing
 * Used for both claim and refund transactions
 */
export const hashForWitnessV1 = (
    asset: string,
    network: Network | LiquidNetwork,
    inputs: RefundDetails[] | ClaimDetails[] | LiquidRefundDetails[] | LiquidClaimDetails[],
    tx: Transaction | LiquidTransaction,
    index: number,
    leafHash?: Buffer
): Buffer => {
    if (asset === 'L-BTC') {
        return LiquidTaprootUtils.hashForWitnessV1(
            network as LiquidNetwork,
            inputs as LiquidRefundDetails[] | LiquidClaimDetails[],
            tx as LiquidTransaction,
            index,
            leafHash
        );
    } else {
        return TaprootUtils.hashForWitnessV1(
            inputs as RefundDetails[] | ClaimDetails[],
            tx as Transaction,
            index,
            leafHash
        );
    }
};

