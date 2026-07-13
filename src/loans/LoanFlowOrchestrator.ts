/**
 * Loan Flow Orchestrator
 *
 * Orchestrates the complete rBTC → USDT0 (Arbitrum) conversion flow:
 *   1. Mint DOC on RSK (rBTC → DOC via MoC)
 *   2. Swap DOC → USDT0 on RSK (via DEX)
 *   3. Bridge USDT0 from RSK to Arbitrum (via LayerZero OFT)
 *
 * Supports two modes:
 *   - Full flow: rBTC → DOC → USDT0 (RSK) → USDT0 (Arbitrum)
 *   - Bridge-only: USDT0 (RSK) → USDT0 (Arbitrum) — for users who already hold USDT0 on RSK
 *
 * Includes state machine with persistence, error recovery, and event emission.
 */

import { ethers } from 'ethers';
import type { LoanPhase, LoanFlowState, LoanFlowStep } from '../core/types';
import { EventBus } from '../core/EventBus';
import { MoCMintingService, MOC_PROXY_ADDRESS } from './MoCMintingService';
import { Usdt0BridgeService, OFT_RSK_ADDRESS } from './Usdt0BridgeService';
import { RskDexSwapService, type RskDexSwapConfig } from './RskDexSwapService';
import {
	LAYERZERO_EIDS,
	getRSKToken
} from '../utils/networkConfig';

export interface LoanFlowConfig {
	rskSigner: ethers.Wallet;
	rskProvider: ethers.JsonRpcProvider;
	arbRecipientAddress: string;
	dexConfig?: RskDexSwapConfig;
	bridgeService?: Usdt0BridgeService;
	mocService?: MoCMintingService;
}

export interface LoanFlowQuote {
	rbtcInputAmount: string;
	estimatedDocOutput: string;
	estimatedUsdt0Output: string;
	estimatedBridgeFee: string;
	estimatedUsdt0OnArbitrum: string;
	steps: string[];
}

export interface LoanFlowResult {
	success: boolean;
	state: LoanFlowState;
	txHashes: {
		docMint?: string;
		dexSwap?: string;
		bridge?: string;
	};
}

type LoanFlowEventListener = (state: LoanFlowState) => void;

/** Default Sovryn router on RSK Mainnet */
const DEFAULT_DEX_ROUTER = '0x98aCE08D2b759a265ae326F010496bcC6Fe06C68';
const DEFAULT_DEX_FACTORY = '0x091579DbCC2Bc13B2b8f2E7832Fc9A3a5D8C02D8';

export class LoanFlowOrchestrator {
	private mocService: MoCMintingService;
	private dexService: RskDexSwapService;
	private bridgeService: Usdt0BridgeService;
	private config: LoanFlowConfig;
	private currentState: LoanFlowState;
	private events = new EventBus();
	private eventListeners: Map<string, LoanFlowEventListener> = new Map();

	constructor(config: LoanFlowConfig) {
		this.config = config;

		// Initialize services with defaults if not provided
		this.mocService = config.mocService ?? new MoCMintingService();
		this.dexService = new RskDexSwapService(
			config.dexConfig ?? {
				routerAddress: DEFAULT_DEX_ROUTER,
				factoryAddress: DEFAULT_DEX_FACTORY
			}
		);

		const usdt0Token = getRSKToken('USDT0');
		this.bridgeService = config.bridgeService ?? new Usdt0BridgeService(
			usdt0Token?.address ?? '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
			OFT_RSK_ADDRESS
		);

		// Initialize state
		this.currentState = this.createInitialState();
	}

	/**
	 * Subscribe to loan flow state changes
	 */
	onStateChange(callback: LoanFlowEventListener): () => void {
		const id = Math.random().toString(36).slice(2);
		this.eventListeners.set(id, callback);
		return () => {
			this.eventListeners.delete(id);
		};
	}

	/**
	 * Get current loan flow state
	 */
	getState(): LoanFlowState {
		return { ...this.currentState };
	}

	/**
	 * Get a quote for the full loan flow
	 *
	 * @param rbtcAmount - rBTC amount in wei to convert
	 * @returns Quote with estimated outputs at each step
	 */
	async getQuote(rbtcAmount: string): Promise<LoanFlowQuote> {
		try {
			this.updatePhase('QUOTING');

			// Step 1: Estimate DOC output from MoC
			this.mocService.getMoCContract(this.config.rskSigner);
			const docEstimate = await this.mocService.estimateDocMint(rbtcAmount);

			// Step 2: Estimate USDT0 output from DEX
			const docToken = getRSKToken('DOC');
			const usdt0Token = getRSKToken('USDT0');

			let estimatedUsdt0 = docEstimate.docAmount;
			let estimatedBridgeFee = '0';
			const steps: string[] = ['Mint DOC from rBTC'];

			if (docToken && usdt0Token) {
				try {
					const swapQuote = await this.dexService.getQuote(
						docToken.address,
						usdt0Token.address,
						docEstimate.docAmount,
						this.config.rskSigner
					);
					estimatedUsdt0 = swapQuote.outputAmount;
					steps.push('Swap DOC → USDT0 on RSK DEX');
				} catch {
					// DEX might not have liquidity; use 1:1 estimate
					steps.push('Swap DOC → USDT0 on RSK DEX (estimate unavailable)');
				}
			}

			// Step 3: Estimate bridge fee
			try {
				const bridgeQuote = await this.bridgeService.quoteBridge(
					estimatedUsdt0,
					LAYERZERO_EIDS.ROOTSTOCK,
					LAYERZERO_EIDS.ARBITRUM,
					this.config.rskSigner
				);
				estimatedBridgeFee = bridgeQuote.nativeFee.toString();
			} catch {
				estimatedBridgeFee = '0';
			}
			steps.push('Bridge USDT0 to Arbitrum via LayerZero');

			this.updatePhase('IDLE');

			return {
				rbtcInputAmount: rbtcAmount,
				estimatedDocOutput: docEstimate.docAmount,
				estimatedUsdt0Output: estimatedUsdt0,
				estimatedBridgeFee,
				estimatedUsdt0OnArbitrum: estimatedUsdt0,
				steps
			};
		} catch (error) {
			this.updatePhase('IDLE');
			throw new Error(
				`Failed to get loan flow quote: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Execute the full loan flow: rBTC → DOC → USDT0 (RSK) → USDT0 (Arbitrum)
	 *
	 * @param rbtcAmount - rBTC amount in wei to convert
	 * @param slippagePercent - Maximum slippage for DEX swap (default 1%)
	 * @returns Result with transaction hashes and final state
	 */
	async executeFullFlow(
		rbtcAmount: string,
		slippagePercent: number = 1
	): Promise<LoanFlowResult> {
		const txHashes: LoanFlowResult['txHashes'] = {};

		try {
			// Initialize
			this.currentState = this.createInitialState();
			this.currentState.rbtcAmount = rbtcAmount;
			this.updatePhase('COLLECTING_INPUT');

			// Validate
			const validation = await this.validatePreconditions(rbtcAmount);
			if (!validation.valid) {
				throw new Error(validation.reason);
			}

			// ── Step 1: Mint DOC ──
			this.updatePhase('MINTING_DOC');
			this.addStep('mint-doc', 'Mint DOC from rBTC', 'active');

			this.mocService.getMoCContract(this.config.rskSigner);
			const mintResult = await this.mocService.mintDoc(rbtcAmount, this.config.rskSigner);
			txHashes.docMint = mintResult.txHash;
			this.currentState.docAmount = mintResult.docMinted;
			this.completeStep('mint-doc', mintResult.txHash);

			// ── Step 2: Swap DOC → USDT0 ──
			this.updatePhase('SWAPPING_DOC_TO_USDT0');
			this.addStep('swap-doc-usdt0', 'Swap DOC → USDT0 on RSK', 'active');

			const docToken = getRSKToken('DOC');
			const usdt0Token = getRSKToken('USDT0');

			if (!docToken || !usdt0Token) {
				throw new Error('DOC or USDT0 token not configured for current network');
			}

			// Get quote for slippage protection
			const swapQuote = await this.dexService.getQuote(
				docToken.address,
				usdt0Token.address,
				mintResult.docMinted,
				this.config.rskSigner
			);

			const minOutput = BigInt(swapQuote.outputAmount);
			const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 10));
			const minOutputWithSlippage = (minOutput * slippageMultiplier) / BigInt(1000);

			const swapResult = await this.dexService.swap(
				docToken.address,
				usdt0Token.address,
				mintResult.docMinted,
				minOutputWithSlippage.toString(),
				this.config.rskSigner
			);
			txHashes.dexSwap = swapResult.txHash;
			this.currentState.usdt0RskAmount = swapResult.outputAmount;
			this.completeStep('swap-doc-usdt0', swapResult.txHash);

			// ── Step 3: Bridge USDT0 to Arbitrum ──
			this.updatePhase('BRIDGING_TO_ARBITRUM');
			this.addStep('bridge-usdt0', 'Bridge USDT0 to Arbitrum', 'active');

			const bridgeResult = await this.executeBridge(swapResult.outputAmount);
			txHashes.bridge = bridgeResult.txHash;
			this.currentState.usdt0ArbAmount = swapResult.outputAmount;
			this.completeStep('bridge-usdt0', bridgeResult.txHash);

			// ── Complete ──
			this.updatePhase('COMPLETE');

			return {
				success: true,
				state: this.getState(),
				txHashes
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.currentState.phase = 'FAILED';
			this.failCurrentStep(errorMsg);

			return {
				success: false,
				state: this.getState(),
				txHashes
			};
		}
	}

	/**
	 * Execute bridge-only flow: USDT0 (RSK) → USDT0 (Arbitrum)
	 * For users who already hold USDT0 on RSK.
	 *
	 * @param usdt0Amount - USDT0 amount in smallest unit (6 decimals)
	 * @returns Result with transaction hash
	 */
	async executeBridgeOnly(usdt0Amount: string): Promise<LoanFlowResult> {
		const txHashes: LoanFlowResult['txHashes'] = {};

		try {
			this.currentState = this.createInitialState();
			this.currentState.usdt0RskAmount = usdt0Amount;
			this.updatePhase('COLLECTING_INPUT');

			// Validate USDT0 balance
			const balance = await this.bridgeService.getUSDT0Balance(this.config.rskSigner);
			if (balance < BigInt(usdt0Amount)) {
				throw new Error(
					`Insufficient USDT0 balance: have ${balance.toString()}, need ${usdt0Amount}`
				);
			}

			// Bridge
			this.updatePhase('BRIDGING_TO_ARBITRUM');
			this.addStep('bridge-usdt0', 'Bridge USDT0 to Arbitrum', 'active');

			const bridgeResult = await this.executeBridge(usdt0Amount);
			txHashes.bridge = bridgeResult.txHash;
			this.currentState.usdt0ArbAmount = usdt0Amount;
			this.completeStep('bridge-usdt0', bridgeResult.txHash);

			this.updatePhase('COMPLETE');

			return {
				success: true,
				state: this.getState(),
				txHashes
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.currentState.phase = 'FAILED';
			this.failCurrentStep(errorMsg);

			return {
				success: false,
				state: this.getState(),
				txHashes
			};
		}
	}

	/**
	 * Recover a previously interrupted loan flow from saved state
	 */
	async recover(savedState: LoanFlowState): Promise<void> {
		this.currentState = { ...savedState };
		this.updatePhase('RECOVERING');

		// Determine where to resume based on completed steps
		const completedSteps = new Set(
			savedState.steps.filter(s => s.status === 'complete').map(s => s.id)
		);

		if (!completedSteps.has('mint-doc') && savedState.rbtcAmount) {
			await this.executeFullFlow(savedState.rbtcAmount);
		} else if (!completedSteps.has('swap-doc-usdt0') && savedState.docAmount) {
			await this.resumeFromDocSwap(savedState.docAmount);
		} else if (!completedSteps.has('bridge-usdt0') && savedState.usdt0RskAmount) {
			await this.executeBridgeOnly(savedState.usdt0RskAmount);
		} else {
			this.updatePhase('COMPLETE');
		}
	}

	// ── Private helpers ──

	private async executeBridge(amount: string): Promise<{ txHash: string }> {
		// Ensure approval
		await this.bridgeService.approveBridge(amount, this.config.rskSigner);

		// Execute bridge
		const result = await this.bridgeService.bridge(
			amount,
			LAYERZERO_EIDS.ROOTSTOCK,
			LAYERZERO_EIDS.ARBITRUM,
			this.config.rskSigner,
			this.config.arbRecipientAddress
		);

		return { txHash: result.txHash };
	}

	private async resumeFromDocSwap(docAmount: string): Promise<void> {
		try {
			this.updatePhase('SWAPPING_DOC_TO_USDT0');
			this.addStep('swap-doc-usdt0', 'Swap DOC → USDT0 on RSK', 'active');

			const docToken = getRSKToken('DOC');
			const usdt0Token = getRSKToken('USDT0');

			if (!docToken || !usdt0Token) {
				throw new Error('DOC or USDT0 token not configured');
			}

			const swapQuote = await this.dexService.getQuote(
				docToken.address,
				usdt0Token.address,
				docAmount,
				this.config.rskSigner
			);

			const swapResult = await this.dexService.swap(
				docToken.address,
				usdt0Token.address,
				docAmount,
				swapQuote.minOutputAmount,
				this.config.rskSigner
			);
			this.currentState.usdt0RskAmount = swapResult.outputAmount;
			this.completeStep('swap-doc-usdt0', swapResult.txHash);

			// Continue to bridge
			this.updatePhase('BRIDGING_TO_ARBITRUM');
			this.addStep('bridge-usdt0', 'Bridge USDT0 to Arbitrum', 'active');

			const bridgeResult = await this.executeBridge(swapResult.outputAmount);
			this.currentState.usdt0ArbAmount = swapResult.outputAmount;
			this.completeStep('bridge-usdt0', bridgeResult.txHash);

			this.updatePhase('COMPLETE');
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.currentState.phase = 'FAILED';
			this.failCurrentStep(errorMsg);
		}
	}

	private async validatePreconditions(rbtcAmount: string): Promise<{ valid: boolean; reason?: string }> {
		const rbtcWei = BigInt(rbtcAmount);
		if (rbtcWei <= BigInt(0)) {
			return { valid: false, reason: 'rBTC amount must be greater than zero' };
		}

		// Check rBTC balance
		const balance = await this.config.rskProvider.getBalance(this.config.rskSigner.address);
		if (balance < rbtcWei) {
			return { valid: false, reason: `Insufficient rBTC balance: have ${balance.toString()}, need ${rbtcWei.toString()}` };
		}

		// Check MoC is not paused
		try {
			this.mocService.getMoCContract(this.config.rskSigner);
			const isPaused = await this.mocService.isPaused();
			if (isPaused) {
				return { valid: false, reason: 'MoC protocol is currently paused' };
			}
		} catch {
			return { valid: false, reason: 'Failed to check MoC protocol status' };
		}

		// Check coverage ratio
		try {
			const coverage = await this.mocService.getGlobalCoverageRatio();
			if (coverage < 4) {
				return { valid: false, reason: `MoC coverage ratio too low: ${coverage.toFixed(2)} (minimum: 4)` };
			}
		} catch {
			return { valid: false, reason: 'Failed to check MoC coverage ratio' };
		}

		return { valid: true };
	}

	private createInitialState(): LoanFlowState {
		return {
			phase: 'IDLE',
			steps: [],
			inputAmount: '',
			rbtcAmount: '',
			docAmount: '',
			usdt0RskAmount: '',
			usdt0ArbAmount: '',
			createdAt: Date.now()
		};
	}

	private updatePhase(phase: LoanPhase): void {
		this.currentState.phase = phase;
		this.emitStateChange();
	}

	private addStep(id: string, label: string, status: LoanFlowStep['status']): void {
		const existing = this.currentState.steps.find(s => s.id === id);
		if (existing) {
			existing.status = status;
		} else {
			this.currentState.steps.push({ id, label, status });
		}
		this.emitStateChange();
	}

	private completeStep(id: string, txHash: string): void {
		const step = this.currentState.steps.find(s => s.id === id);
		if (step) {
			step.status = 'complete';
			step.txHash = txHash;
		}
		this.emitStateChange();
	}

	private failCurrentStep(error: string): void {
		const activeStep = this.currentState.steps.find(s => s.status === 'active');
		if (activeStep) {
			activeStep.status = 'failed';
			activeStep.error = error;
		}
		this.emitStateChange();
	}

	private emitStateChange(): void {
		const state = this.getState();
		this.eventListeners.forEach(callback => {
			try {
				callback(state);
			} catch {
				// Don't let listener errors break the flow
			}
		});
		this.events.emit('stateChange', state);
	}
}
