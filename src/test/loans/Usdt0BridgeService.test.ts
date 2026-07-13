import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared mock state
let mockBalanceOf = vi.fn().mockResolvedValue(BigInt('10000000000'));
let mockAllowance = vi.fn().mockResolvedValue(BigInt('0'));
let mockApprove = vi.fn().mockResolvedValue({
	hash: '0xapprove123',
	wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
});
let mockQuoteSend = vi.fn().mockResolvedValue({
	nativeFee: BigInt('500000000000000'),
	lzTokenFee: BigInt('0')
});
let mockSend = vi.fn().mockResolvedValue({
	hash: '0xbridge123',
	wait: vi.fn().mockResolvedValue({
		hash: '0xbridge123',
		logs: [{ topics: ['0x0', '0xGUID_VALUE'] }]
	})
});
let mockRetryMessage = vi.fn().mockResolvedValue({
	hash: '0xretry123',
	wait: vi.fn().mockResolvedValue({ hash: '0xretry123' })
});
let mockGetBalance = vi.fn().mockResolvedValue(BigInt('1000000000000000000'));

vi.mock('ethers', async () => {
	const actual = await vi.importActual<any>('ethers');
	return {
		...actual,
		ethers: {
			...actual.ethers,
			Contract: vi.fn().mockImplementation(() => ({
				balanceOf: mockBalanceOf,
				allowance: mockAllowance,
				approve: mockApprove,
				quoteSend: mockQuoteSend,
				send: mockSend,
				retryMessage: mockRetryMessage
			}))
		}
	};
});

import {
	Usdt0BridgeService,
	OFT_RSK_ADDRESS,
	AUTO_APPROVE_BUFFER
} from '../../loans/Usdt0BridgeService';

describe('Usdt0BridgeService', () => {
	let service: Usdt0BridgeService;
	let mockSigner: any;
	const USDT0_ADDRESS = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset all mock implementations to defaults
		mockBalanceOf = vi.fn().mockResolvedValue(BigInt('10000000000'));
		mockAllowance = vi.fn().mockResolvedValue(BigInt('0'));
		mockApprove = vi.fn().mockResolvedValue({
			hash: '0xapprove123',
			wait: vi.fn().mockResolvedValue({ hash: '0xapprove123' })
		});
		mockQuoteSend = vi.fn().mockResolvedValue({
			nativeFee: BigInt('500000000000000'),
			lzTokenFee: BigInt('0')
		});
		mockSend = vi.fn().mockResolvedValue({
			hash: '0xbridge123',
			wait: vi.fn().mockResolvedValue({
				hash: '0xbridge123',
				logs: [{ topics: ['0x0', '0xGUID_VALUE'] }]
			})
		});
		mockRetryMessage = vi.fn().mockResolvedValue({
			hash: '0xretry123',
			wait: vi.fn().mockResolvedValue({ hash: '0xretry123' })
		});
		mockGetBalance = vi.fn().mockResolvedValue(BigInt('1000000000000000000'));

		service = new Usdt0BridgeService(USDT0_ADDRESS, OFT_RSK_ADDRESS);
		mockSigner = {
			address: '0x1234567890123456789012345678901234567890',
			provider: {
				getBalance: mockGetBalance
			}
		};
	});

	describe('Constructor', () => {
		it('should store addresses', () => {
			expect(service.getUSDT0Address()).toBe(USDT0_ADDRESS);
			expect(service.getOFTAddress()).toBe(OFT_RSK_ADDRESS);
		});
	});

	describe('Contract caching fix (bug 6.6)', () => {
		it('should create fresh contract instances each call', () => {
			const contract1 = service.getOFTContract(mockSigner);
			const contract2 = service.getOFTContract(mockSigner);
			expect(contract1).not.toBe(contract2);
		});
	});

	describe('getUSDT0Balance', () => {
		it('should return balance', async () => {
			const balance = await service.getUSDT0Balance(mockSigner);
			expect(balance).toBe(BigInt('10000000000'));
		});
	});

	describe('quoteBridge', () => {
		it('should return quote with fees', async () => {
			const quote = await service.quoteBridge('10000000', 30333, 30110, mockSigner);
			expect(quote.nativeFee).toBe(BigInt('500000000000000'));
			expect(quote.lzTokenFee).toBe(BigInt('0'));
		});
	});

	describe('bridge (bug 6.4 fix)', () => {
		it('should throw if allowance insufficient', async () => {
			await expect(
				service.bridge('10000000', 30333, 30110, mockSigner, mockSigner.address)
			).rejects.toThrow('Insufficient USDT0 allowance');
		});

		it('should succeed if allowance is sufficient', async () => {
			mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999'));

			const result = await service.bridge(
				'10000000', 30333, 30110, mockSigner, mockSigner.address
			);
			expect(result.txHash).toBe('0xbridge123');
		});

		it('should throw for insufficient balance', async () => {
			mockBalanceOf = vi.fn().mockResolvedValue(BigInt('0'));

			await expect(
				service.bridge('10000000', 30333, 30110, mockSigner, mockSigner.address)
			).rejects.toThrow('Insufficient USDT0 balance');
		});
	});

	describe('approveBridge', () => {
		it('should approve if allowance insufficient', async () => {
			const txHash = await service.approveBridge('10000000', mockSigner);
			expect(txHash).toBe('0xapprove123');
		});

		it('should skip if allowance sufficient', async () => {
			mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999'));

			const txHash = await service.approveBridge('10000000', mockSigner);
			expect(txHash).toBe('0x0');
		});
	});

	describe('retryBridge (bug 6.5 fix)', () => {
		it('should accept raw message bytes and token address', async () => {
			const result = await service.retryBridge(USDT0_ADDRESS, '0xdeadbeef', mockSigner);
			expect(result).toBe('0xretry123');
		});
	});

	describe('validateSendPreconditions', () => {
		it('should pass with sufficient balance and ETH', async () => {
			const result = await service.validateSendPreconditions('10000000', mockSigner);
			expect(result.allowed).toBe(true);
		});

		it('should fail with zero amount', async () => {
			const result = await service.validateSendPreconditions('0', mockSigner);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('greater than zero');
		});

		it('should fail with insufficient USDT0 balance', async () => {
			mockBalanceOf = vi.fn().mockResolvedValue(BigInt('1'));

			const result = await service.validateSendPreconditions('10000000', mockSigner);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Insufficient USDT0 balance');
		});

		it('should fail with zero ETH balance', async () => {
			// Need to create a new signer with zero balance
			const zeroEthSigner = {
				address: '0x1234567890123456789012345678901234567890',
				provider: {
					getBalance: vi.fn().mockResolvedValue(BigInt('0'))
				}
			};

			const result = await service.validateSendPreconditions('10000000', zeroEthSigner as any);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Insufficient ETH');
		});
	});

	describe('bridgeMultiHop', () => {
		it('should throw if allowance insufficient', async () => {
			await expect(
				service.bridgeMultiHop(
					'10000000', 30333, 30101, 30110, mockSigner, mockSigner.address
				)
			).rejects.toThrow('Insufficient USDT0 allowance');
		});

		it('should succeed with sufficient allowance', async () => {
			mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999'));

			const result = await service.bridgeMultiHop(
				'10000000', 30333, 30101, 30110, mockSigner, mockSigner.address
			);
			expect(result.txHash).toBe('0xbridge123');
			expect(result.guid).toBeDefined();
		});

		it('should use composeMsg for multi-hop routing', async () => {
			mockAllowance = vi.fn().mockResolvedValue(BigInt('999999999999'));

			await service.bridgeMultiHop(
				'10000000', 30333, 30101, 30110, mockSigner, mockSigner.address
			);

			// Verify send was called with composeMsg (non-empty)
			expect(mockSend).toHaveBeenCalled();
			const sendParam = mockSend.mock.calls[0][0];
			expect(sendParam.composeMsg).not.toBe('0x');
			expect(sendParam.composeMsg.length).toBeGreaterThan(2);
		});
	});
});
