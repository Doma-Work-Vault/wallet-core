/**
 * Boltz Reverse Swap Service (Lightning → rBTC)
 * Client-side implementation with Nostr storage
 * 
 * Features:
 * - Creates reverse submarine swaps from Lightning to Rootstock
 * - Stores swap data encrypted in Nostr events (NIP-44)
 * - Real-time WebSocket monitoring
 * - Automatic claim handling
 * - Recovery from Nostr on app restart
 * 
 * ⚠️ CRITICAL: Understanding Reverse Swap Flow
 * ============================================
 * 
 * In a reverse swap (Lightning → On-chain):
 * 
 * 1. **WE generate the preimage** (random 32 bytes)
 * 2. **WE create the preimage hash** (SHA256 of preimage)
 * 3. **Boltz creates a HOLD/HODL invoice** using our hash
 * 4. **User pays the Lightning invoice** (payment is HELD, not settled yet)
 * 5. **Boltz locks RBTC on-chain** using the same hash (in EtherSwap contract)
 * 6. **WE claim the RBTC** by calling the contract's claim() function with our preimage
 * 7. **Boltz sees our preimage** on-chain and can now settle the Lightning invoice
 * 8. **Invoice is settled** - swap complete!
 * 
 * The key insight: The invoice CANNOT be settled until we reveal the preimage by claiming the RBTC.
 * This is what makes it atomic and trustless - neither party can cheat.
 * 
 * States we'll see:
 * - swap.created: Swap created, invoice ready to pay
 * - invoice.set: Invoice paid and held (waiting for our claim)
 * - transaction.mempool: Boltz's lockup tx in mempool (we can claim now!)
 * - transaction.confirmed: Lockup confirmed (safer to claim)
 * - transaction.claim.pending: Our claim tx submitted
 * - invoice.settled: Boltz settled invoice after seeing our preimage ✅
 */

import type { SwapEvent } from './types';
import { crypto } from 'bitcoinjs-lib';
import { randomBytes } from 'crypto';
import { BoltzClient, getLockupEventParameters } from './BoltzClient';
import { BoltzWebSocket } from './WebSocketClient';
import { Contract, ethers } from 'ethers';
import { relayClaimTransaction, getSmartWalletAddress } from '../rif/Signer';
import { satoshiToWei, isRifRelayAvailable, SATOSHI_TO_WEI } from '../../utils/networkConfig';
import EtherSwapArtifact from 'boltz-core/out/EtherSwap.sol/EtherSwap.json';
import type { NetworkType } from '../../core/types';
import type { SwapStorage } from './storage';

// Swap data structure for Nostr storage
export interface BoltzSwapData {
	id: string;
	preimage: string; // Will be encrypted
	preimageHash: string;
	invoice: string;
	amount: number;
	rbtcAddress: string; // User's actual wallet address
	claimAddress?: string; // Address used for claiming (may be Smart Wallet)
	status: string;
	lockupTxHash?: string;
	claimTxHash?: string;
	onchainAmount?: number;
	refundAddress?: string;
	timeoutBlockHeight?: number;
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
	rifRelayUsed?: boolean; // Track if RIF Relay was used for gasless claiming
}

// Reference: https://github.com/BoltzExchange/boltz-core/blob/master/contracts/EtherSwap.sol

export class ReverseSwapService {
	private boltzClient: BoltzClient;
	private websocket: BoltzWebSocket;
	private activeSwaps: Map<string, BoltzSwapData> = new Map();
	private walletGetter: (() => any) | null = null;
	private storage?: SwapStorage;

	constructor(network: NetworkType = 'testnet', storage?: SwapStorage) {
		this.boltzClient = new BoltzClient(network);
		this.storage = storage;
		
		// Initialize WebSocket
		const { getWebSocketEndpoint } = require('../../utils/networkConfig');
		this.websocket = new BoltzWebSocket(getWebSocketEndpoint(network));
	}

	/**
	 * Set the wallet getter function
	 * This should be called before creating swaps to enable automatic claiming
	 */
	setWalletGetter(getter: () => any): void {
		this.walletGetter = getter;
	}

	/**
	 * Get swap limits from Boltz API
	 * Returns minimal and maximal amounts for Lightning → RBTC swaps
	 */
	async getSwapLimits(): Promise<{ minimal: number; maximal: number }> {
		try {
			// Get reverse swap pairs
			const reversePairs = await this.boltzClient.getReverseSwapPairs();
			console.log({ reversePairs })

			// API returns flat structure: { 'BTC': {...}, 'RBTC': {...}, 'L-BTC': {...} }
			// For Lightning → RBTC swaps, we use RBTC limits
			const pairInfo = reversePairs?.['BTC']?.['RBTC'];

			if (!pairInfo || !pairInfo.limits) {
				console.warn('Could not find RBTC pair limits in response:', reversePairs);
				throw new Error('Reverse swap pair limits not available');
			}

			console.log('✅ Found RBTC reverse swap limits:', pairInfo.limits);

			return {
				minimal: pairInfo.limits.minimal,
				maximal: pairInfo.limits.maximal
			};
		} catch (error) {
			console.error('Failed to get swap limits:', error);
			throw error;
		}
	}

	/**
	 * Create a reverse swap (Lightning → rBTC)
	 * 
	 * IMPORTANT: Determines claim address based on user's gas balance
	 * - If user has gas: Use their wallet address (direct claim)
	 * - If user has no gas: Use Smart Wallet address (RIF Relay gasless claim)
	 */
	async createReverseSwap(params: {
		amountSats: number;
		rbtcAddress: string;
		description?: string;
		walletSigner?: any; // Optional: wallet signer to check balance and compute Smart Wallet
	}): Promise<{ swapId: string; invoice: string; swapData: BoltzSwapData }> {
		// Generate preimage and hash
		const preimage = randomBytes(32);
		const preimageHash = crypto.sha256(preimage).toString('hex');

		// For EVM chains like RBTC, we use the REST API directly since the client
		// method expects claimPublicKey but EVM swaps use claimAddress
		const apiUrl = this.boltzClient['config'].boltzApiUrl;

		// Determine which address to use for claiming
		let claimAddress = params.rbtcAddress; // Default to user's wallet
		let useSmartWallet = false;

		// Check if we should use Smart Wallet (gasless via RIF Relay)
		if (isRifRelayAvailable() && params.walletSigner) {
			try {
				// Check user's gas balance
				const balance = await params.walletSigner.provider.getBalance(params.rbtcAddress);
				const gasEstimate = 100000n * 60000000n; // ~100k gas @ 0.06 gwei

				if (balance < gasEstimate) {
					// User has insufficient gas - use Smart Wallet for gasless claim
					const smartWallet = await getSmartWalletAddress(params.walletSigner);
					claimAddress = smartWallet.address;
					useSmartWallet = true;
					console.log('🔧 User has insufficient gas, using Smart Wallet for gasless claim');
					console.log('📍 Smart Wallet address:', claimAddress);
				} else {
					console.log('💰 User has sufficient gas, using direct wallet address');
				}
			} catch (error) {
				console.warn('⚠️ Could not check balance, defaulting to wallet address:', error);
			}
		}

		console.log('🔧 Creating reverse swap:', {
			amount: params.amountSats,
			userWallet: params.rbtcAddress,
			claimAddress: claimAddress,
			usingSmartWallet: useSmartWallet,
			rifRelayAvailable: isRifRelayAvailable()
		});

		const response = await fetch(`${apiUrl}/v2/swap/reverse`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: 'BTC',
				to: 'RBTC',
				invoiceAmount: params.amountSats,
				preimageHash,
				claimAddress: claimAddress // Use computed claim address
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to create reverse swap: ${response.status} ${errorText}`);
		}

		const swapResponse = await response.json();

		console.log('✅ Swap created:', {
			id: swapResponse.id,
			invoice: swapResponse.invoice,
			claimAddress: claimAddress,
			usingSmartWallet: useSmartWallet
		});

		// Prepare swap data
		const swapData: BoltzSwapData = {
			id: swapResponse.id,
			preimage: preimage.toString('hex'),
			preimageHash,
			invoice: swapResponse.invoice,
			amount: params.amountSats,
			rbtcAddress: params.rbtcAddress, // User's actual wallet
			claimAddress: claimAddress, // Address used for claiming (may be Smart Wallet)
			status: 'swap.created',
			onchainAmount: swapResponse.onchainAmount,
			refundAddress: swapResponse.refundAddress,
			timeoutBlockHeight: swapResponse.timeoutBlockHeight,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
			rifRelayUsed: useSmartWallet // If Smart Wallet used, RIF Relay will be used
		};

		// Store in memory
		this.activeSwaps.set(swapResponse.id, swapData);

		// Save swap data to storage if available
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

		// Subscribe to WebSocket updates
		this.websocket.subscribeToSwap(swapResponse.id, async (event) => {
			await this.handleSwapUpdate(event);
		});

		return {
			swapId: swapResponse.id,
			invoice: swapResponse.invoice,
			swapData
		};
	}

	/**
	 * Handle swap status updates from WebSocket
	 */
	private async handleSwapUpdate(event: SwapEvent): Promise<void> {
		const swapData = this.activeSwaps.get(event.swapId);
		if (!swapData) return;

		// Update swap data
		swapData.status = event.status;
		swapData.updatedAt = Date.now();

		if (event.transaction) {
			console.log('📝 Transaction update:', event.transaction);
			swapData.lockupTxHash = event.transaction.id;
		}

		// Handle different states
		switch (event.status) {
			case 'invoice.set':
				// Invoice has been paid and is on hold - waiting for our claim
				console.log('⚡ Invoice paid and held, waiting for RBTC claim...');
				swapData.status = 'invoice.set';
				break;

			case 'transaction.mempool':
				// Boltz's lockup transaction is in mempool
				// ⚠️ IMPORTANT: We should NOT attempt to claim yet because the lockup
				// transaction hasn't been mined. The contract doesn't have the swap data yet.
				console.log('🔒 Lockup transaction in mempool, waiting for confirmation...');
				console.log('⏳ Swap will be ready to claim once the lockup transaction is confirmed');
				swapData.status = 'transaction.mempool';
				break;

			case 'transaction.confirmed':
				// Boltz has confirmed the lockup transaction - now we can claim!
				console.log('✅ Lockup confirmed! - 📋 Swap parameters:', {
					id: swapData.id,
					amount: swapData.onchainAmount,
					userWallet: swapData.rbtcAddress,
					claimAddress: swapData.claimAddress || swapData.rbtcAddress,
					refundAddress: swapData.refundAddress,
					timelock: swapData.timeoutBlockHeight,
					rifRelayPreselected: swapData.rifRelayUsed
				});

				// Get wallet for claiming
				const wallet = this.walletGetter?.();

				if (!wallet) {
					console.warn('⚠️ No wallet connected - manual claim required');
					swapData.status = 'transaction.confirmed';
					if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
					break;
				}

				// Strategy: Use the claim method that matches how the swap was created
				// - If swap was created with Smart Wallet address → MUST use RIF Relay
				// - If swap was created with user's wallet → can use direct claim or RIF Relay fallback
				let claimSuccessful = false;

				try {
					const wasCreatedForSmartWallet = swapData.claimAddress &&
						swapData.claimAddress !== swapData.rbtcAddress;

					if (wasCreatedForSmartWallet) {
						// Swap was created with Smart Wallet address - MUST use RIF Relay
						if (isRifRelayAvailable()) {
							try {
								await this.claimRBTCViaRifRelay(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ RIF Relay claim failed:', error);
							}
						} else {
							console.error('❌ RIF Relay not available');
						}
					} else {
						// Swap was created with user's wallet - try direct claim first
						const balance = await wallet.provider.getBalance(wallet.address);
						const gasEstimate = await this.estimateClaimGas(swapData);
						const hasGas = balance >= gasEstimate;

						if (hasGas) {
							console.log('💰 User has sufficient RBTC for gas');
							console.log('📊 Balance:', ethers.formatEther(balance), 'RBTC');
							try {
								await this.claimRBTC(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ Direct claim failed:', error);
							}
						}

						// Try RIF Relay if direct claim failed or no gas
						if (!claimSuccessful && isRifRelayAvailable()) {
							console.log('🌐 Attempting gasless claim via RIF Relay...');
							try {
								await this.claimRBTCViaRifRelay(swapData, wallet);
								claimSuccessful = true;
							} catch (error) {
								console.error('❌ RIF Relay claim failed:', error);
							}
						}
					}

					if (!claimSuccessful) {
						console.warn('⚠️ All claim methods failed');
						swapData.status = 'transaction.confirmed';
					}
				} catch (err) {
					console.error('❌ Claim process failed:', err);
					swapData.status = 'transaction.confirmed';
				}
				break;

			case 'invoice.settled':
				console.log('🎉 Swap complete! RBTC credited to wallet', swapData.id);
				swapData.status = 'invoice.settled';
				break;

			case 'invoice.expired':
			case 'swap.expired':
			case 'transaction.failed':
				console.error('❌ Swap failed:', swapData.id, event.status);
				swapData.status = event.status;
				break;
		}

		// Update Nostr storage using shared module
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
	}


	/**
	 * Claim RBTC via RIF Relay (gasless)
	 * 
	 * This method uses Boltz's proven RIF Relay implementation to claim RBTC
	 * without requiring the user to have gas. The transaction is executed FROM
	 * a Smart Wallet (deployed if needed). RIF Relay pays the gas fees.
	 * 
	 * @param swapData - Swap data with preimage and parameters
	 * @param walletSigner - User's EOA wallet (owns Smart Wallet)
	 * @returns Transaction hash
	 */
	async claimRBTCViaRifRelay(
		swapData: BoltzSwapData,
		walletSigner: any
	): Promise<{ txHash: string }> {
		try {
			console.log('🌐 Gasless claim via RIF Relay...');

			// Validate required data
			if (
				!swapData.preimage ||
				!swapData.onchainAmount ||
				!swapData.refundAddress ||
				!swapData.timeoutBlockHeight
			) {
				throw new Error('Missing required swap data for claiming');
			}

			// Check RIF Relay availability
			if (!isRifRelayAvailable()) {
				throw new Error('RIF Relay is not available');
			}

			// Get EtherSwap contract using Boltz's official ABI
			const etherSwapAddress = await this.getEtherSwapAddress();
			const etherSwapContract = new Contract(etherSwapAddress, EtherSwapArtifact.abi, walletSigner);

			// Get actual lockup parameters from event
			let amount: number;
			let refundAddress: string;
			let timelock: number;

			if (swapData.lockupTxHash) {
				const eventParams = await getLockupEventParameters(
					etherSwapAddress,
					swapData.preimageHash,
					swapData.lockupTxHash,
					walletSigner.provider
				);

				if (eventParams) {
					amount = Number(eventParams.amount / SATOSHI_TO_WEI);
					refundAddress = eventParams.refundAddress;
					timelock = eventParams.timelock;
				} else {
					amount = swapData.onchainAmount;
					refundAddress = swapData.refundAddress;
					timelock = swapData.timeoutBlockHeight;
				}
			} else {
				amount = swapData.onchainAmount;
				refundAddress = swapData.refundAddress;
				timelock = swapData.timeoutBlockHeight;
			}

			// Use RIF Relay to execute gasless claim
			const txHash = await relayClaimTransaction(
				walletSigner,
				etherSwapContract as any,
				swapData.preimage,
				amount,
				refundAddress,
				timelock
			);

			console.log('✅ Transaction relayed:', txHash);

			// Update swap data
			swapData.claimTxHash = txHash;
			swapData.status = 'transaction.claim.pending';
			swapData.rifRelayUsed = true;
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

			// Wait for confirmation
			const receipt = await walletSigner.provider.waitForTransaction(txHash);

			console.log({ receipt });

			swapData.status = 'claimed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

			console.log('🎉 Successfully claimed via RIF Relay!');
			return { txHash };
		} catch (error) {
			console.error('❌ RIF Relay claim failed:', error);
			swapData.status = 'transaction.claim.failed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
			throw error;
		}
	}


	/**
	 * Get EtherSwap contract address from Boltz API
	 */
	private async getEtherSwapAddress(): Promise<string> {
		const response = await fetch(
			`${this.boltzClient['config'].boltzApiUrl}/v2/chain/RBTC/contracts`
		);

		if (!response.ok) {
			throw new Error(`Failed to fetch contract addresses`);
		}

		const contracts = await response.json();
		const address = contracts.swapContracts?.EtherSwap;

		if (!address) {
			throw new Error('EtherSwap contract address not found');
		}

		return address;
	}

	/**
	 * TODO: Make gas cost dynamic based on the network and the gas price
	 * Estimate gas needed for direct claim
	 * 
	 * @returns Estimated gas cost in wei
	 */
	private async estimateClaimGas(swapData: BoltzSwapData): Promise<bigint> {
		// Typical claim transaction uses ~100,000 gas
		// At 0.06 gwei (RSK typical), that's ~0.000006 RBTC
		const gasLimit = 100000n;
		const gasPrice = 60000000n; // 0.06 gwei in wei
		return gasLimit * gasPrice;
	}

	/**
	 * Claim RBTC with automatic method selection
	 * 
	 * This method automatically selects between:
	 * - Cooperative claim (gasless via Boltz RIF Relay) - when user has insufficient gas
	 * - Direct claim (user pays gas) - when user has sufficient gas
	 * 
	 * Falls back to direct claim if cooperative fails and wallet has gas.
	 * 
	 * @param swapData - The swap data
	 * @param walletSigner - User's wallet signer (optional, for direct claim)
	 * @returns Transaction hash
	 */
	async checkInvoicePaymentStatus(swapId: string): Promise<{
		mainInvoicePaid: boolean;
		serviceFeeInvoicePaid?: boolean;
		status: string;
	}> {
		return await this.boltzClient.checkInvoicePaymentStatus(swapId);
	}

	/**
	 * Update swap data and save to Nostr
	 * Used by the UI to update swap state
	 */
	async updateSwapData(swapData: BoltzSwapData): Promise<void> {
		if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}
	}


	/**
	 * Claim rBTC from EtherSwap contract (Direct method - requires gas)
	 * 
	 * IMPORTANT: EtherSwap contract structure (from EtherSwap.sol):
	 * - Contract uses keccak256 hash of ALL parameters to index swaps
	 * - The claim() function auto-uses msg.sender as claimAddress
	 * - We don't need to query the contract - just call claim() directly
	 * - If swap doesn't exist or already claimed, the contract will revert
	 * 
	 * NOTE: This method requires the user to have RBTC for gas fees.
	 * For gasless claiming, use claimRBTCViaRifRelay() instead.
	 * 
	 * This method is called when swap reaches 'transaction.confirmed' status
	 * and user has sufficient gas balance.
	 */
	async claimRBTC(
		swapData: BoltzSwapData,
		walletSigner?: any
	): Promise<{ txHash: string }> {
		try {
			if (!walletSigner) {
				throw new Error('RSK wallet not connected. Please connect your wallet to claim funds.');
			}

			// Validate required swap data
			if (!swapData.preimage || !swapData.onchainAmount || !swapData.refundAddress || !swapData.timeoutBlockHeight) {
				throw new Error('Missing required swap data for claiming. Data: ' + JSON.stringify({
					hasPreimage: !!swapData.preimage,
					onchainAmount: swapData.onchainAmount,
					refundAddress: swapData.refundAddress,
					timeoutBlockHeight: swapData.timeoutBlockHeight
				}));
			}

			// Get EtherSwap contract address from Boltz API
			const contractsResponse = await fetch(
				`${this.boltzClient['config'].boltzApiUrl}/v2/chain/RBTC/contracts`
			);

			if (!contractsResponse.ok) {
				throw new Error(`Failed to fetch contract addresses: ${contractsResponse.statusText}`);
			}

			const contracts = await contractsResponse.json();
			console.log('📋 Boltz contracts response:', contracts);

			const etherSwapAddress = contracts.swapContracts?.EtherSwap;

			if (!etherSwapAddress) {
				throw new Error('EtherSwap contract address not found in Boltz response');
			}

			console.log('📍 Using EtherSwap contract:', etherSwapAddress);

			// Create contract instance with Boltz's official ABI
			const etherSwapContract = new Contract(etherSwapAddress, EtherSwapArtifact.abi, walletSigner);

			// CRITICAL: Get the ACTUAL parameters from the Lockup event
			// The API response may have different values than what was actually locked
			let amountWei: bigint;
			let refundAddress: string;
			let timelock: number;

			if (swapData.lockupTxHash) {
				const eventParams = await getLockupEventParameters(
					etherSwapAddress,
					swapData.preimageHash,
					swapData.lockupTxHash,
					walletSigner.provider
				);

				if (eventParams) {
					console.log('✅ Using Lockup event parameters:', {
						amount: eventParams.amount.toString() + ' wei',
						claimAddress: eventParams.claimAddress,
						refundAddress: eventParams.refundAddress,
						timelock: eventParams.timelock
					});

					amountWei = eventParams.amount;
					refundAddress = eventParams.refundAddress;
					timelock = eventParams.timelock;
				} else {
					console.warn('⚠️ Lockup event not found, using API values (may fail)');
					amountWei = satoshiToWei(swapData.onchainAmount);
					refundAddress = swapData.refundAddress!;
					timelock = swapData.timeoutBlockHeight!;
				}
			} else {
				console.warn('⚠️ No lockup TX hash, using API values (may fail)');
				amountWei = satoshiToWei(swapData.onchainAmount);
				refundAddress = swapData.refundAddress!;
				timelock = swapData.timeoutBlockHeight!;
			}

			// Prepare claim parameters
			const preimageBytes32 = '0x' + swapData.preimage;

			console.log('🎯 Claiming with parameters:', {
				preimage: preimageBytes32.slice(0, 20) + '...',
				amount: `${amountWei.toString()} wei (${Number(amountWei / SATOSHI_TO_WEI)} sats)`,
				refundAddress: refundAddress,
				timelock: timelock,
				claimAddress: swapData.rbtcAddress + ' (auto from msg.sender)'
			});

			// Call claim function directly
			// The EtherSwap contract will:
			// 1. Hash the preimage with SHA256
			// 2. Compute swap hash using hashValues(preimageHash, amount, msg.sender, refundAddress, timelock)
			// 3. Check if swap exists and is locked
			// 4. Transfer funds to msg.sender (our wallet)
			console.log('🚀 Calling EtherSwap.claim()...');
			const tx = await etherSwapContract.claim(
				preimageBytes32,
				amountWei,
				refundAddress,
				timelock
			);

			console.log('✅ Claim transaction sent:', tx.hash);
			console.log('⏳ Waiting for transaction confirmation...');

			// Update swap data with claim transaction hash
			swapData.claimTxHash = tx.hash;
			swapData.status = 'transaction.claim.pending';
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

			// Wait for transaction confirmation
			const receipt = await tx.wait();
			console.log('✅ Claim transaction confirmed! 📋 Receipt:', {
				transactionHash: receipt.hash,
				blockNumber: receipt.blockNumber,
				gasUsed: receipt.gasUsed?.toString(),
				status: receipt.status
			});

			swapData.status = 'claimed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

			console.log('✅ Successfully claimed', swapData.onchainAmount, 'sats');

			return { txHash: tx.hash };
		} catch (error) {
			console.error('❌ Claim failed:', error);

			if (error instanceof Error && error.message.includes('swap has no Ether locked')) {
				console.error('💡 Swap not found. Reasons: \n\n 1) TX not confirmed, \n\n 2) Wrong parameters, \n\n 3) Already claimed');
				console.error('📊 Swap:', {
					id: swapData.id,
					amount: swapData.onchainAmount,
					claimAddress: swapData.rbtcAddress,
					refundAddress: swapData.refundAddress,
					timelock: swapData.timeoutBlockHeight,
					lockupTx: swapData.lockupTxHash
				});
			}

			// Update swap status to show claim failed
			swapData.status = 'transaction.claim.failed';
			swapData.updatedAt = Date.now();
			if (this.storage) {
			await this.storage.save(swapData.id, swapData);
		}

			throw error;
		}
	}

	/**
	 * Recover pending swaps from storage on app startup
	 */
	async recoverPendingSwaps(): Promise<BoltzSwapData[]> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot recover swaps');
				return [];
			}

			const swaps = await this.storage.loadAll();

			// Store in memory and resubscribe to WebSocket
			for (const swap of swaps) {
				this.activeSwaps.set(swap.id, swap as BoltzSwapData);

				// Resubscribe to WebSocket
				this.websocket.subscribeToSwap(swap.id, async (event) => {
					await this.handleSwapUpdate(event);
				});
			}

			return swaps as BoltzSwapData[];
		} catch (error) {
			console.error('Failed to recover swaps from storage:', error);
			return [];
		}
	}

	/**
	 * Get swap by ID
	 */
	getSwap(swapId: string): BoltzSwapData | undefined {
		return this.activeSwaps.get(swapId);
	}

	/**
	 * Get all active swaps
	 */
	getAllSwaps(): BoltzSwapData[] {
		return Array.from(this.activeSwaps.values());
	}

	/**
	 * Check swap status from Boltz API
	 */
	async checkSwapStatus(swapId: string): Promise<string> {
		const status = await this.boltzClient.getSwapStatus(swapId, true); // true = reverse swap
		return status.status;
	}

	/**
	 * Delete all reverse swap events from storage
	 * Useful for clearing test data
	 */
	async deleteAllSwaps(): Promise<{ count: number }> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swaps');
				return { count: 0 };
			}

			const swaps = await this.storage.loadAll();
			
			for (const swap of swaps) {
				await this.storage.delete(swap.id);
			}

			// Clear active swaps from memory
			this.activeSwaps.clear();

			return { count: swaps.length };
		} catch (error) {
			console.error('Failed to delete swaps:', error);
			throw error;
		}
	}

	/**
	 * Delete a single swap from storage
	 */
	async deleteSwap(swapId: string): Promise<boolean> {
		try {
			if (!this.storage) {
				console.warn('No storage configured - cannot delete swap');
				return false;
			}

			await this.storage.delete(swapId);

			// Remove from memory
			this.activeSwaps.delete(swapId);

			return true;
		} catch (error) {
			console.error('Failed to delete swap:', error);
			return false;
		}
	}
}

// Example usage:
// import { ReverseSwapService } from '@bittasker/wallet-core';
// const reverseSwapService = new ReverseSwapService('testnet', myStorageAdapter);