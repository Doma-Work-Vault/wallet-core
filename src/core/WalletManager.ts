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
import { setNetworkGetter, getWebSocketEndpoint } from '../utils/networkConfig';
import { RSKWallet } from '../chains/rsk/RSKWallet';
import { BSCWallet } from '../chains/bsc/BSCWallet';
import { ChainSwapService } from '../swaps/boltz/ChainSwapService';
import { ReverseSwapService } from '../swaps/boltz/ReverseSwapService';
import { SubmarineSwapService } from '../swaps/boltz/SubmarineSwapService';
import { BoltzWebSocket } from '../swaps/boltz/WebSocketClient';
import { EvmContractService } from '../swaps/boltz/EvmContractService';
import { BoltzClient } from '../swaps/boltz/BoltzClient';

export interface WalletManagerConfig {
	/** Network type: 'mainnet' or 'testnet' */
	network: NetworkType;
	
	/** Wallet mnemonic phrase (12 or 24 words) */
	mnemonic: string;
	
	/** Optional RSK wallet configuration overrides */
	rskConfig?: Partial<RSKWalletConfig>;
	
	/** Optional BSC wallet configuration overrides */
	bscConfig?: Partial<BSCWalletConfig>;
	
	/** 
	 * Optional swap storage adapter (e.g., Nostr, IndexedDB, localStorage)
	 * If provided, all swap services will use this storage.
	 * For separate storage per service, use swapStorages instead.
	 */
	swapStorage?: SwapStorage;
	
	/**
	 * Optional separate storage for each swap service
	 * If provided, this takes precedence over swapStorage
	 */
	swapStorages?: {
		reverse?: SwapStorage;
		submarine?: SwapStorage;
		chain?: SwapStorage;
	};
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
	submarine: {
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
	private _websocket: BoltzWebSocket | null = null;
	private _boltzClient: BoltzClient | null = null;
	private _evmContractService: EvmContractService | null = null;
	private _reverseSwapService: ReverseSwapService | null = null;
	private _chainSwapService: ChainSwapService | null = null;
	private _submarineSwapService: SubmarineSwapService | null = null;
	constructor(config: WalletManagerConfig) {
		this.config = config;
		
		// Set global network getter so all SDK functions can access the network
		setNetworkGetter(() => this.config.network);
		
		// Initialize WebSocket for swap monitoring (uses global network getter)
		this._websocket = new BoltzWebSocket(getWebSocketEndpoint());
		
		// Initialize Boltz client
		this._boltzClient = new BoltzClient();

		// Initialize shared EVM contract service
		this._evmContractService = new EvmContractService(this._boltzClient);
		
		// Initialize services (storage is optional)
		this._reverseSwapService = new ReverseSwapService(
			this._websocket,
			this._boltzClient,
			this._evmContractService,
			config.swapStorages?.reverse || config.swapStorage
		);
		
		this._chainSwapService = new ChainSwapService(
			this._websocket,
			this._boltzClient,
			this._evmContractService,
			config.swapStorages?.chain || config.swapStorage
		);
		
		this._submarineSwapService = new SubmarineSwapService(
			this._websocket,
			this._boltzClient,
			this._evmContractService,
			config.swapStorages?.submarine || config.swapStorage
		);
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
		if (this._reverseSwapService) {
			this._reverseSwapService.setWalletGetter(() => this._rskWallet!.getWallet());
		}
		
		if (this._chainSwapService) {
			this._chainSwapService.setWalletGetter(() => this._rskWallet!.getWallet());
		}
		
		// Connect WebSocket for swap monitoring
		await this.connectWebSocket();
		
		// Recover pending swaps
		// await this.recoverPendingSwaps();
	}
	
	/**
	 * Connect WebSocket for real-time swap monitoring
	 */
	private async connectWebSocket(): Promise<void> {
		try {
			if (this._websocket) {
				await this._websocket.connect();
			}
		} catch (error) {
			console.warn('⚠️ Failed to connect WebSocket for swap monitoring:', error);
		}
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
	 * Get Boltz client instance
	 */
	get boltzClient(): BoltzClient {
		if (!this._boltzClient) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._boltzClient;
	}
	
	/**
	 * Get reverse swap service (Lightning → RBTC)
	 */
	get reverseSwapService(): ReverseSwapService {
		if (!this._reverseSwapService) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._reverseSwapService;
	}
	
	/**
	 * Get chain swap service (L-BTC → RBTC)
	 */
	get chainSwapService(): ChainSwapService {
		if (!this._chainSwapService) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._chainSwapService;
	}
	
	/**
	 * Get submarine swap service (RBTC/BTC/L-BTC → Lightning)
	 */
	get submarineSwapService(): SubmarineSwapService {
		if (!this._submarineSwapService) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._submarineSwapService;
	}
	
	/**
	 * Get EVM contract service for direct contract interactions
	 * Useful for gas estimation and advanced contract operations
	 */
	get evmContractService(): EvmContractService {
		if (!this._evmContractService) {
			throw new Error('WalletManager not initialized. Call initialize() first.');
		}
		return this._evmContractService;
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
		const submarineLimits = await this.submarineSwapService.getSwapLimits('RBTC', 'BTC');
		
		return {
			lightning: lightningLimits,
			liquid: liquidLimits,
			submarine: submarineLimits
		};
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

