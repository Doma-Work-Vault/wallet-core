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

		this._websocket = new BoltzWebSocket(getWebSocketEndpoint());
	}

	/**
	 * Initialize all wallet components
	 * This should be called after construction
	 */
	async initialize(): Promise<void> {
		// Initialize wallets in parallel for better performance
		const bscNetwork = (this.config.network === 'regtest' ? 'testnet' : this.config.network) as 'mainnet' | 'testnet';

		const [rskWallet, bscWallet] = await Promise.all([
			(async () => {
				const wallet = new RSKWallet({
					network: this.config.network,
					...this.config.rskConfig
				});
				await wallet.initialize(this.config.mnemonic);
				return wallet;
			})(),
			(async () => {
				const wallet = new BSCWallet({
					network: bscNetwork,
					...this.config.bscConfig
				});
				await wallet.initialize(this.config.mnemonic);
				return wallet;
			})()
		]);

		this._rskWallet = rskWallet;
		this._bscWallet = bscWallet;

		// Websocket connection is required for swap monitoring 
		// Lazy loading won't work for wallet getters (asynchronous limitation)
		await this.connectWebSocket();
	}

	/**
	 * Connect WebSocket for real-time swap monitoring
	 * This is called lazily when swap services are accessed
	 */
	private async connectWebSocket(): Promise<void> {
		try {
			if (this._websocket) {
				// Try to connect - WebSocket will handle reconnection if already connected
				await this._websocket.connect();
			}
		} catch (error) {
			// Silently fail - connection will be retried when needed
			// This allows initialization to proceed even if WebSocket is unavailable
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
	 * Get Boltz client instance (lazy-loaded)
	 */
	get boltzClient(): BoltzClient {
		if (!this._boltzClient) {
			this._boltzClient = new BoltzClient();
		}
		return this._boltzClient;
	}

	/**
	 * Get reverse swap service (Lightning → RBTC) - lazy-loaded
	 */
	get reverseSwapService(): ReverseSwapService {
		if (!this._reverseSwapService) {
			// Ensure WebSocket is connected
			this.connectWebSocket();
			if (!this._websocket) throw new Error('WebSocket not connected');

			// Lazy-load EVM contract service if needed
			if (!this._evmContractService) {
				this._evmContractService = new EvmContractService(this.boltzClient);
			}

			this._reverseSwapService = new ReverseSwapService(
				this._websocket,
				this.boltzClient,
				this._evmContractService,
				this.config.swapStorages?.reverse || this.config.swapStorage
			);
			// Set wallet getter if wallet is initialized
			if (this.rskWallet) {
				this._reverseSwapService.setWalletGetter(() => this.rskWallet.getWallet());
			}
		}
		return this._reverseSwapService;
	}

	/**
	 * Get chain swap service (L-BTC → RBTC) - lazy-loaded
	 */
	get chainSwapService(): ChainSwapService {
		if (!this._chainSwapService) {
			// Ensure WebSocket is connected
			this.connectWebSocket();
			if (!this._websocket) throw new Error('WebSocket not connected');

			// Lazy-load EVM contract service if needed
			if (!this._evmContractService) {
				this._evmContractService = new EvmContractService(this.boltzClient);
			}

			this._chainSwapService = new ChainSwapService(
				this._websocket,
				this.boltzClient,
				this._evmContractService,
				this.config.swapStorages?.chain || this.config.swapStorage
			);
			// Set wallet getter if wallet is initialized
			if (this.rskWallet) {
				this._chainSwapService.setWalletGetter(() => this.rskWallet.getWallet());
			}
		}
		return this._chainSwapService;
	}

	/**
	 * Get submarine swap service (RBTC/BTC/L-BTC → Lightning) - lazy-loaded
	 */
	get submarineSwapService(): SubmarineSwapService {
		if (!this._submarineSwapService) {
			// Connect WebSocket asynchronously (non-blocking)
			this.connectWebSocket();
			if (!this._websocket) throw new Error('WebSocket not connected');

			// Lazy-load EVM contract service if needed
			if (!this._evmContractService) {
				this._evmContractService = new EvmContractService(this.boltzClient);
			}

			this._submarineSwapService = new SubmarineSwapService(
				this._websocket,
				this.boltzClient,
				this._evmContractService,
				this.config.swapStorages?.submarine || this.config.swapStorage
			);
		}
		return this._submarineSwapService;
	}

	/**
	 * Get EVM contract service for direct contract interactions - lazy-loaded
	 * Useful for gas estimation and advanced contract operations
	 */
	get evmContractService(): EvmContractService {
		if (!this._evmContractService) {
			this._evmContractService = new EvmContractService(this.boltzClient);
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
		if (this._rskWallet) this._rskWallet.disconnect();
		if (this._bscWallet) this._bscWallet.disconnect();

		// Clean up WebSocket
		if (this._websocket) this._websocket.disconnect();
	}
}