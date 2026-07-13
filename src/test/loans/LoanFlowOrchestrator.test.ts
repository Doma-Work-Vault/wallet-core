import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock networkConfig to return mainnet tokens
vi.mock('../../utils/networkConfig', async () => {
	const actual = await vi.importActual<any>('../../utils/networkConfig');
	return {
		...actual,
		getRSKToken: vi.fn().mockImplementation((symbol: string) => {
			if (symbol === 'DOC') {
				return { address: '0xe700691dA7b9851F2F35f8b8182c69c53CcaD9Db', symbol: 'DOC', name: 'Dollar on Chain', decimals: 18 };
			}
			if (symbol === 'USDT0') {
				return { address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', symbol: 'USDT0', name: 'USDT0 on Rootstock', decimals: 6 };
			}
			return undefined;
		}),
		LAYERZERO_EIDS: { ROOTSTOCK: 30333, ARBITRUM: 30110, ETHEREUM: 30101 }
	};
});

let mockMintDoc = Object.assign(
	vi.fn().mockResolvedValue({
		hash: '0xmint123',
		wait: vi.fn().mockResolvedValue({ hash: '0xmint123' })
	}),
	{ staticCall: vi.fn().mockResolvedValue(BigInt('500000000000000000000')) }
);
let mockGlobalCoverage = vi.fn().mockResolvedValue(BigInt('5000000000000000000'));
let mockPaused = vi.fn().mockResolvedValue(false);
let mockGetDocEmission = vi.fn().mockResolvedValue(BigInt('500000000000000000000'));
let mockDocToken = vi.fn().mockResolvedValue('0xDOC');

let mockGetAmountsOut = vi.fn().mockResolvedValue([
	BigInt('500000000000000000000'),
	BigInt('495000000')
]);
let mockSwapExactTokensForTokens = vi.fn().mockResolvedValue({
	hash: '0xswap123',
	wait: vi.fn().mockResolvedValue({ hash: '0xswap123' })
});

let mockQuoteSend = vi.fn().mockResolvedValue({
	nativeFee: BigInt('500000000000000'),
	lzTokenFee: BigInt('0')
});
let mockSend = vi.fn().mockResolvedValue({
	hash: '0xbridge123',
	wait: vi.fn().mockResolvedValue({
		hash: '0xbridge123',
		logs: [{ topics: ['0x0', '0xGUID'] }]
	})
});
let mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999999'));

let mockTokenBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
let mockTokenApprove = vi.fn().mockResolvedValue({
	hash: '0xapprove123',
	wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
});

vi.mock('ethers', async () => {
	const actual = await vi.importActual<any>('ethers');
	return {
		...actual,
		ethers: {
			...actual.ethers,
			Contract: vi.fn().mockImplementation((address: string, abi: any[]) => {
				if (abi.some((s: string) => s.includes('mintDoc'))) {
					return {
						mintDoc: mockMintDoc,
						globalCoverage: mockGlobalCoverage,
						paused: mockPaused,
						docToken: mockDocToken,
						getDocEmission: mockGetDocEmission
					};
				}
				if (abi.some((s: string) => s.includes('swapExactTokensForTokens'))) {
					return {
						getAmountsOut: mockGetAmountsOut,
						swapExactTokensForTokens: mockSwapExactTokensForTokens
					};
				}
				if (abi.some((s: string) => s.includes('quoteSend'))) {
					return {
						quoteSend: mockQuoteSend,
						send: mockSend,
						allowance: mockAllowance,
						retryMessage: vi.fn()
					};
				}
				return {
					balanceOf: mockTokenBalanceOf,
					allowance: mockAllowance,
					approve: mockTokenApprove,
					decimals: vi.fn().mockResolvedValue(6)
				};
			})
		}
	};
});

import { LoanFlowOrchestrator } from '../../loans/LoanFlowOrchestrator';

describe('LoanFlowOrchestrator', () => {
	let orchestrator: LoanFlowOrchestrator;
	let mockSigner: any;
	let mockProvider: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockMintDoc = Object.assign(
			vi.fn().mockResolvedValue({
				hash: '0xmint123',
				wait: vi.fn().mockResolvedValue({ hash: '0xmint123' })
			}),
			{ staticCall: vi.fn().mockResolvedValue(BigInt('500000000000000000000')) }
		);
		mockGlobalCoverage = vi.fn().mockResolvedValue(BigInt('5000000000000000000'));
		mockPaused = vi.fn().mockResolvedValue(false);
		mockGetDocEmission = vi.fn().mockResolvedValue(BigInt('500000000000000000000'));
		mockDocToken = vi.fn().mockResolvedValue('0xDOC');
		mockGetAmountsOut = vi.fn().mockResolvedValue([
			BigInt('500000000000000000000'),
			BigInt('495000000')
		]);
		mockSwapExactTokensForTokens = vi.fn().mockResolvedValue({
			hash: '0xswap123',
			wait: vi.fn().mockResolvedValue({ hash: '0xswap123' })
		});
		mockQuoteSend = vi.fn().mockResolvedValue({
			nativeFee: BigInt('500000000000000'),
			lzTokenFee: BigInt('0')
		});
		mockSend = vi.fn().mockResolvedValue({
			hash: '0xbridge123',
			wait: vi.fn().mockResolvedValue({
				hash: '0xbridge123',
				logs: [{ topics: ['0x0', '0xGUID'] }]
			})
		});
		mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999999'));
		mockTokenBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
		mockTokenApprove = vi.fn().mockResolvedValue({
			hash: '0xapprove123',
			wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
		});

		mockSigner = {
			address: '0x1234567890123456789012345678901234567890',
			provider: {
				getBalance: vi.fn().mockResolvedValue(BigInt('10000000000000000000'))
			}
		};
		mockProvider = {
			getBalance: vi.fn().mockResolvedValue(BigInt('10000000000000000000'))
		};

		orchestrator = new LoanFlowOrchestrator({
			rskSigner: mockSigner,
			rskProvider: mockProvider,
			arbRecipientAddress: '0xABC123'
		});
	});

	describe('Constructor', () => {
		it('should initialize with IDLE state', () => {
			const state = orchestrator.getState();
			expect(state.phase).toBe('IDLE');
			expect(state.steps).toEqual([]);
		});
	});

	describe('getState', () => {
		it('should return a copy of state', () => {
			const state1 = orchestrator.getState();
			const state2 = orchestrator.getState();
			expect(state1).toEqual(state2);
			expect(state1).not.toBe(state2);
		});
	});

	describe('onStateChange', () => {
		it('should return unsubscribe function', () => {
			const callback = vi.fn();
			const unsubscribe = orchestrator.onStateChange(callback);
			expect(typeof unsubscribe).toBe('function');
		});
	});

	describe('executeFullFlow', () => {
		it('should execute complete flow with all steps', async () => {
			const result = await orchestrator.executeFullFlow('1000000000000000000');

			// Check the phase - if FAILED, log the error for debugging
			if (result.state.phase === 'FAILED') {
				const failedStep = result.state.steps.find(s => s.status === 'failed');
				console.error('Flow failed:', failedStep?.error);
			}

			expect(result.success).toBe(true);
			expect(result.txHashes.docMint).toBe('0xmint123');
			expect(result.txHashes.dexSwap).toBe('0xswap123');
			expect(result.txHashes.bridge).toBe('0xbridge123');
			expect(result.state.phase).toBe('COMPLETE');
		});

		it('should track steps through the flow', async () => {
			const result = await orchestrator.executeFullFlow('1000000000000000000');

			if (result.state.phase === 'FAILED') {
				const failedStep = result.state.steps.find(s => s.status === 'failed');
				console.error('Flow failed:', failedStep?.error);
			}

			const stepIds = result.state.steps.map(s => s.id);
			expect(stepIds).toContain('mint-doc');
			expect(stepIds).toContain('swap-doc-usdt0');
			expect(stepIds).toContain('bridge-usdt0');
			result.state.steps.forEach(step => {
				expect(step.status).toBe('complete');
				expect(step.txHash).toBeDefined();
			});
		});

		it('should fail with zero rBTC amount', async () => {
			const result = await orchestrator.executeFullFlow('0');
			expect(result.success).toBe(false);
			expect(result.state.phase).toBe('FAILED');
		});

		it('should fail with insufficient rBTC balance', async () => {
			mockProvider.getBalance.mockResolvedValueOnce(BigInt('100'));
			const result = await orchestrator.executeFullFlow('1000000000000000000');
			expect(result.success).toBe(false);
			expect(result.state.phase).toBe('FAILED');
		});
	});

	describe('executeBridgeOnly', () => {
		it('should execute bridge-only flow', async () => {
			const result = await orchestrator.executeBridgeOnly('10000000');
			expect(result.success).toBe(true);
			expect(result.txHashes.bridge).toBe('0xbridge123');
			expect(result.state.phase).toBe('COMPLETE');
		});
	});

	describe('recover', () => {
		it('should recover from saved state', async () => {
			const savedState = {
				phase: 'FAILED' as const,
				steps: [
					{ id: 'mint-doc', label: 'Mint DOC', status: 'complete' as const, txHash: '0xmint123' }
				],
				inputAmount: '',
				rbtcAmount: '1000000000000000000',
				docAmount: '500000000000000000000',
				usdt0RskAmount: '',
				usdt0ArbAmount: '',
				createdAt: Date.now()
			};

			await orchestrator.recover(savedState);
			const state = orchestrator.getState();
			expect(state.phase).toBe('COMPLETE');
		});
	});
});
