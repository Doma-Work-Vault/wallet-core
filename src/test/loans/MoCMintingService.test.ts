import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockMintDoc = Object.assign(
	vi.fn().mockResolvedValue({
		hash: '0xmint123',
		wait: vi.fn().mockResolvedValue({ hash: '0xmint123' })
	}),
	{ staticCall: vi.fn().mockResolvedValue(BigInt('500000000000000000000')) }
);
let mockRedeemDoc = Object.assign(
	vi.fn().mockResolvedValue({
		hash: '0xredeem123',
		wait: vi.fn().mockResolvedValue({ hash: '0xredeem123' })
	}),
	{ staticCall: vi.fn().mockResolvedValue(BigInt('1000000000000000000')) }
);
let mockGlobalCoverage = vi.fn().mockResolvedValue(BigInt('5000000000000000000'));
let mockPaused = vi.fn().mockResolvedValue(false);
let mockDocToken = vi.fn().mockResolvedValue('0xDOC_ADDRESS');
let mockGetDocEmission = vi.fn().mockResolvedValue(BigInt('500000000000000000000'));
let mockBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
let mockApprove = vi.fn().mockResolvedValue({
	hash: '0xapprove123',
	wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
});
let mockAllowance = vi.fn().mockResolvedValue(BigInt('0'));

vi.mock('ethers', async () => {
	const actual = await vi.importActual<any>('ethers');
	return {
		...actual,
		ethers: {
			...actual.ethers,
			Contract: vi.fn().mockImplementation(() => ({
				mintDoc: mockMintDoc,
				redeemDoc: mockRedeemDoc,
				globalCoverage: mockGlobalCoverage,
				paused: mockPaused,
				state: vi.fn().mockResolvedValue(0),
				docToken: mockDocToken,
				getDocEmission: mockGetDocEmission,
				balanceOf: mockBalanceOf,
				approve: mockApprove,
				allowance: mockAllowance,
				decimals: vi.fn().mockResolvedValue(18)
			}))
		}
	};
});

import { MoCMintingService, MOC_PROXY_ADDRESS } from '../../loans/MoCMintingService';

describe('MoCMintingService', () => {
	let service: MoCMintingService;
	let mockSigner: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockMintDoc = Object.assign(
			vi.fn().mockResolvedValue({
				hash: '0xmint123',
				wait: vi.fn().mockResolvedValue({ hash: '0xmint123' })
			}),
			{ staticCall: vi.fn().mockResolvedValue(BigInt('500000000000000000000')) }
		);
		mockRedeemDoc = Object.assign(
			vi.fn().mockResolvedValue({
				hash: '0xredeem123',
				wait: vi.fn().mockResolvedValue({ hash: '0xredeem123' })
			}),
			{ staticCall: vi.fn().mockResolvedValue(BigInt('1000000000000000000')) }
		);
		mockGlobalCoverage = vi.fn().mockResolvedValue(BigInt('5000000000000000000'));
		mockPaused = vi.fn().mockResolvedValue(false);
		mockGetDocEmission = vi.fn().mockResolvedValue(BigInt('500000000000000000000'));
		mockBalanceOf = vi.fn().mockResolvedValue(BigInt('1000000000000000000000'));
		mockAllowance = vi.fn().mockResolvedValue(BigInt('0'));

		service = new MoCMintingService();
		mockSigner = {
			address: '0x1234567890123456789012345678901234567890',
			provider: {
				getBalance: vi.fn().mockResolvedValue(BigInt('10000000000000000000'))
			}
		};
	});

	describe('getMoCContract', () => {
		it('should create contract with correct address', () => {
			const contract = service.getMoCContract(mockSigner);
			expect(contract).toBeDefined();
		});

		it('should return cached contract on subsequent calls', () => {
			const contract1 = service.getMoCContract(mockSigner);
			const contract2 = service.getMoCContract(mockSigner);
			expect(contract1).toBe(contract2);
		});
	});

	describe('estimateDocMint', () => {
		it('should return estimated DOC amount', async () => {
			service.getMoCContract(mockSigner);
			const result = await service.estimateDocMint('1000000000000000000');
			expect(result.docAmount).toBe('500000000000000000000');
			expect(result.rbtcCost).toBe('1000000000000000000');
			expect(result.coverageRatio).toBe(5);
		});

		it('should throw if contract not initialized', async () => {
			await expect(service.estimateDocMint('1000000000000000000')).rejects.toThrow(
				'MoC contract not initialized'
			);
		});

		it('should throw if coverage ratio too low', async () => {
			service.getMoCContract(mockSigner);
			mockGlobalCoverage.mockResolvedValueOnce(BigInt('3000000000000000000'));
			await expect(service.estimateDocMint('1000000000000000000')).rejects.toThrow(
				'Coverage ratio too low'
			);
		});
	});

	describe('mintDoc', () => {
		it('should mint DOC and return estimated output (bug 6.1 fix)', async () => {
			service.getMoCContract(mockSigner);
			const result = await service.mintDoc('1000000000000000000', mockSigner);
			expect(result.txHash).toBe('0xmint123');
			// Bug 6.1 fix: should return estimated DOC amount, not rBTC input
			expect(result.docMinted).toBe('500000000000000000000');
			expect(result.docMinted).not.toBe('1000000000000000000');
		});

		it('should throw for zero amount', async () => {
			service.getMoCContract(mockSigner);
			await expect(service.mintDoc('0', mockSigner)).rejects.toThrow(
				'rBTC amount must be greater than zero'
			);
		});

		it('should throw for insufficient balance', async () => {
			service.getMoCContract(mockSigner);
			mockSigner.provider.getBalance.mockResolvedValueOnce(BigInt('100'));
			await expect(service.mintDoc('1000000000000000000', mockSigner)).rejects.toThrow(
				'Insufficient rBTC balance'
			);
		});

		it('should throw if signer has no provider', async () => {
			service.getMoCContract(mockSigner);
			const signerNoProvider = { ...mockSigner, provider: null };
			await expect(service.mintDoc('1000000000000000000', signerNoProvider)).rejects.toThrow(
				'Signer has no provider'
			);
		});
	});

	describe('redeemDoc', () => {
		it('should redeem DOC and return estimated rBTC (bug 6.2 fix)', async () => {
			service.getMoCContract(mockSigner);
			const result = await service.redeemDoc('1000000000000000000', mockSigner);
			expect(result.txHash).toBe('0xredeem123');
			expect(result.rbtcReceived).toBe('1000000000000000000');
		});

		it('should throw for zero amount', async () => {
			service.getMoCContract(mockSigner);
			await expect(service.redeemDoc('0', mockSigner)).rejects.toThrow(
				'DOC amount must be greater than zero'
			);
		});

		it('should approve if allowance insufficient', async () => {
			service.getMoCContract(mockSigner);
			await service.redeemDoc('1000000000000000000', mockSigner);
			expect(mockApprove).toHaveBeenCalled();
		});
	});

	describe('validateMintPreconditions', () => {
		it('should return allowed when all conditions met', async () => {
			service.getMoCContract(mockSigner);
			const result = await service.validateMintPreconditions();
			expect(result.allowed).toBe(true);
		});

		it('should fail if contract not initialized', async () => {
			const result = await service.validateMintPreconditions();
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not initialized');
		});

		it('should fail if protocol is paused', async () => {
			service.getMoCContract(mockSigner);
			mockPaused.mockResolvedValueOnce(true);
			const result = await service.validateMintPreconditions();
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('paused');
		});
	});
});
