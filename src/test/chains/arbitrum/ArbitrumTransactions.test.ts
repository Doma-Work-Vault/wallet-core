import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadArbitrumTransactions } from '../../../chains/arbitrum/ArbitrumTransactions';

// Mock the networkConfig
vi.mock('../../../utils/networkConfig', () => ({
	getArbConfig: vi.fn().mockReturnValue({
		name: 'Arbitrum One',
		chainId: 42161,
		rpcUrl: 'https://arb1.arbitrum.io/rpc',
		explorerUrl: 'https://arbiscan.io',
		explorerApiUrl: 'https://api.arbiscan.io/api'
	}),
	ARB_TOKEN_ADDRESSES: {
		USDT0: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
		WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
		TBTC: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40'
	}
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('loadArbitrumTransactions', () => {
	const testAddress = '0x1234567890123456789012345678901234567890';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should fetch ETH and token transactions', async () => {
		// Mock ETH transactions
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: '1',
				result: [
					{ hash: '0xeth1', timestamp: '1000', from: { hash: testAddress } },
					{ hash: '0xeth2', timestamp: '900', from: { hash: testAddress } }
				]
			})
		});

		// Mock USDT0 token transactions
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: '1',
				result: [
					{ hash: '0xusdt1', timestamp: '950', from: { hash: testAddress } }
				]
			})
		});

		// Mock WBTC token transactions
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: '1',
				result: []
			})
		});

		// Mock tBTC token transactions
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: '1',
				result: []
			})
		});

		const result = await loadArbitrumTransactions(testAddress);

		expect(result.length).toBe(3);
		// Should be sorted by timestamp descending
		expect(result[0].hash).toBe('0xeth1');
		expect(result[1].hash).toBe('0xusdt1');
		expect(result[2].hash).toBe('0xeth2');
	});

	it('should deduplicate transactions by hash', async () => {
		const duplicateTx = { hash: '0xdup1', timestamp: '1000', from: { hash: testAddress } };

		// ETH returns duplicate
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [duplicateTx] })
		});

		// USDT0 returns same duplicate
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [duplicateTx] })
		});

		// WBTC empty
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		// tBTC empty
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		const result = await loadArbitrumTransactions(testAddress);

		// Should be deduplicated
		expect(result.length).toBe(1);
		expect(result[0].hash).toBe('0xdup1');
	});

	it('should return empty array on API failure', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		const result = await loadArbitrumTransactions(testAddress);
		expect(result).toEqual([]);
	});

	it('should handle API returning non-ok status', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429
		});

		const result = await loadArbitrumTransactions(testAddress);
		expect(result).toEqual([]);
	});

	it('should handle API returning non-array result', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '0', result: 'error' })
		});

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		const result = await loadArbitrumTransactions(testAddress);
		expect(result).toEqual([]);
	});

	it('should include API key when provided', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		await loadArbitrumTransactions(testAddress, 'MY_API_KEY');

		// First call should include the API key
		const firstCallUrl = mockFetch.mock.calls[0][0];
		expect(firstCallUrl).toContain('apikey=MY_API_KEY');
	});

	it('should gracefully handle individual token fetch failures', async () => {
		// ETH succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				status: '1',
				result: [{ hash: '0xeth1', timestamp: '1000' }]
			})
		});

		// USDT0 fails
		mockFetch.mockRejectedValueOnce(new Error('Rate limited'));

		// WBTC succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		// tBTC succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ status: '1', result: [] })
		});

		const result = await loadArbitrumTransactions(testAddress);

		// Should still return ETH transactions
		expect(result.length).toBe(1);
		expect(result[0].hash).toBe('0xeth1');
	});
});
