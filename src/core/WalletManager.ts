/**
 * WalletManager - Central orchestration for multi-chain wallet operations
 * 
 * This class provides a unified interface for:
 * - RSK (Rootstock) chain operations
 * - BSC (Binance Smart Chain) operations
 * - Boltz Lightning/Liquid swaps (via ReverseSwapService and ChainSwapService)
 * - RIF Relay gasless transactions
 * 
 * It handles wallet initialization, transaction management, and cross-chain interactions.
 */

import type { Signer } from 'ethers';
import type { NetworkType } from './types';
import type { SwapStorage } from '../swaps/boltz/storage';
import type { RSKWalletConfig } from '../chains/rsk/RSKWallet';
import type { BSCWalletConfig } from '../chains/bsc/BSCWallet';
import { setNetworkGetter } from '../utils/networkConfig';
import { RSKWallet } from '../chains/rsk/RSKWallet';
import { BSCWallet } from '../chains/bsc/BSCWallet';
import { ChainSwapService } from '../swaps/boltz/ChainSwapService';
import { ReverseSwapService } from '../swaps/boltz/ReverseSwapService';

export interface WalletManagerConfig {
	/** Network type: 'mainnet' or 'testnet' */
	network: NetworkType;
	
	/** Wallet mnemonic phrase (12 or 24 words) */
	mnemonic: string;
	
	/** Optional RSK wallet configuration overrides */
	rskConfig?: Partial<RSKWalletConfig>;
	
	/** Optional BSC wallet configuration overrides */
	bscConfig?: Partial<BSCWalletConfig>;
	
	/** Optional swap storage adapter (e.g., Nostr, IndexedDB, localStorage) */
	swapStorage?: SwapStorage;
}

export interface WalletBalances {
	rsk: {
		rbtc: string;
		tokens: Record<string, string>;
	};
	bsc: {
		bnb: string;
		tokens: Record<string, string>;
	};
}

export interface SwapLimits {
	lightning: {
		minimal: number;
		maximal: number;
	};
	liquid: {
		minimal: number;
		maximal: number;
	};
}

/**
 * Main wallet manager class
 */
export class WalletManager {
	private config: WalletManagerConfig;
	private _rskWallet: RSKWallet | null = null;
	private _bscWallet: BSCWallet | null = null;
	private _reverseSwapService: ReverseSwapService | null = null;
	private _chainSwapService: ChainSwapService | null = null;
	
	constructor(config: WalletManagerConfig) {
		this.config = config;
		
		// Set global network getter so all SDK functions can access the network
		setNetworkGetter(() => this.config.network);
		
		// Initialize swap services if storage is provided
		if (config.swapStorage) {
			this._reverseSwapService = new ReverseSwapService(config.network, config.swapStorage);
			this._chainSwapService = new ChainSwapService(config.network, config.swapStorage);
		}
	}
	
	/**
	 * Initialize all wallet components
	 * This should be called after construction
	 */
	async initialize(): Promise<void> {
		// Initialize RSK wallet
		this._rskWallet = new RSKWallet({
			network: this.config.network,
			...this.config.rskConfig
		});
		await this._rskWallet.initialize(this.config.mnemonic);
		
		// Initialize BSC wallet (BSC only supports mainnet/testnet)
		const bscNetwork = (this.config.network === 'regtest' ? 'testnet' : this.config.network) as 'mainnet' | 'testnet';
		this._bscWallet = new BSCWallet({
			network: bscNetwork,
			...this.config.bscConfig
		});
		await this._bscWallet.initialize(this.config.mnemonic);
		
		// Set wallet getter for swap services (for automatic claiming)
		if (this._reverseSwapService && this._rskWallet) {
			this._reverseSwapService.setWalletGetter(() => this._rskWallet!.getWallet());
		}
		
		if (this._chainSwapService && this._rskWallet) {
			this._chainSwapService.setWalletGetter(() => this._rskWallet!.getWallet());
		}
		
		// Recover pending swaps
		await this.recoverPendingSwaps();
	}
	
	/**
	 * Get RSK wallet instance
	 */
	get rskWallet(): RSKWallet {
		if (!this._rskWallet) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._rskWallet;
	}
	
	/**
	 * Get BSC wallet instance
	 */
	get bscWallet(): BSCWallet {
		if (!this._bscWallet) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._bscWallet;
	}
	
	/**
	 * Get reverse swap service (Lightning → RBTC)
	 */
	get reverseSwapService(): ReverseSwapService {
		if (!this._reverseSwapService) {
			throw new Error('Swap storage not configured. Provide swapStorage in config.');
		}
		return this._reverseSwapService;
	}
	
	/**
	 * Get chain swap service (L-BTC → RBTC)
	 */
	get chainSwapService(): ChainSwapService {
		if (!this._chainSwapService) {
			throw new Error('Swap storage not configured. Provide swapStorage in config.');
		}
		return this._chainSwapService;
	}
	
	/**
	 * Get all wallet balances
	 */
	async getBalances(): Promise<WalletBalances> {
		const rskBalance = await this.rskWallet.getBalance();
		const bscBalances = await this.bscWallet.getBalances();
		
		return {
			rsk: {
				rbtc: rskBalance.formatted,
				tokens: {} // TODO: Add token balance support
			},
			bsc: {
				bnb: bscBalances.bnb.formatted,
				tokens: {} // TODO: Add token balance support
			}
		};
	}
	
	/**
	 * Get swap limits for all swap types
	 */
	async getSwapLimits(): Promise<SwapLimits> {
		const lightningLimits = await this.reverseSwapService.getSwapLimits();
		const liquidLimits = await this.chainSwapService.getSwapLimits();
		
		return {
			lightning: lightningLimits,
			liquid: liquidLimits
		};
	}
	
	/**
	 * Recover pending swaps from storage
	 */
	private async recoverPendingSwaps(): Promise<void> {
		if (!this.config.swapStorage) {
			return;
		}
		
		try {
			// Recover reverse swaps (Lightning → RBTC)
			if (this._reverseSwapService) {
				const reverseSwaps = await this._reverseSwapService.recoverPendingSwaps();
				console.log(`Recovered ${reverseSwaps.length} pending Lightning → RBTC swaps`);
			}
			
			// Recover chain swaps (L-BTC → RBTC)
			if (this._chainSwapService) {
				const chainSwaps = await this._chainSwapService.recoverPendingSwaps();
				console.log(`Recovered ${chainSwaps.length} pending L-BTC → RBTC swaps`);
			}
		} catch (error) {
			console.error('Failed to recover pending swaps:', error);
		}
	}
	
	/**
	 * Get wallet addresses
	 */
	getAddresses(): {
		rsk: string;
		bsc: string;
	} {
		return {
			rsk: this.rskWallet.getAddress(),
			bsc: this.bscWallet.getAddress()
		};
	}
	
	/**
	 * Get RSK wallet (ethers.Wallet) for advanced use cases
	 */
	getRSKWallet(): Signer {
		return this.rskWallet.getWallet();
	}
	
	/**
	 * Get BSC wallet (ethers.Wallet) for advanced use cases
	 */
	getBSCWallet(): Signer {
		return this.bscWallet.getWallet();
	}
	
	/**
	 * Clean up resources
	 */
	async dispose(): Promise<void> {
		// Clean up wallets
		if (this._rskWallet) {
			// RSKWallet cleanup if needed
		}
		
		if (this._bscWallet) {
			// BSCWallet cleanup if needed
		}
		
		// Clean up swap services
		// WebSocket connections are managed by services themselves
	}
}

