import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RifRelayClaimService } from './RifRelayClaimService';
import { ethers } from 'ethers';

// Mock dependencies
vi.mock('../../utils/networkConfig', () => ({
  isRifRelayAvailable: vi.fn(() => true),
}));

vi.mock('../rif/Signer', () => ({
  relayClaimTransaction: vi.fn().mockResolvedValue('0x' + 'relay'.repeat(16)),
}));

// Note: ethers is used directly, so we need to ensure it works
// The actual ethers module will be imported and used

// Mock boltz-core
vi.mock('boltz-core/out/EtherSwap.sol/EtherSwap.json', () => ({
  default: {
    abi: [],
  },
}));

describe('RifRelayClaimService', () => {
  let service: RifRelayClaimService;
  let mockSigner: any;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
      waitForTransaction: vi.fn().mockResolvedValue({
        status: 1,
        blockNumber: 1000000,
      }),
    };

    // Create mock signer
    mockSigner = {
      getAddress: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      provider: mockProvider,
      address: '0x1234567890123456789012345678901234567890',
    };

    // Create service instance
    service = new RifRelayClaimService();
  });

  describe('Constructor', () => {
    it('should create service instance', () => {
      const service = new RifRelayClaimService();
      expect(service).toBeDefined();
    });
  });

  describe('claimViaRifRelay', () => {
    const getValidParams = () => ({
      walletSigner: mockSigner,
      contractAddress: '0x1234567890123456789012345678901234567890',
      preimage: 'a'.repeat(64),
      amount: 100000,
      refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      timelock: 12345,
    });

    it('should throw if wallet signer not provided', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        walletSigner: undefined as any,
      })).rejects.toThrow('Wallet signer is required');
    });

    it('should throw if contract address invalid', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        contractAddress: 'invalid',
      })).rejects.toThrow('Invalid contract address');
    });

    it('should throw if preimage invalid', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        preimage: 'invalid',
      })).rejects.toThrow('Invalid preimage');
    });

    it('should throw if refund address invalid', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        refundAddress: 'invalid',
      })).rejects.toThrow('Invalid refund address');
    });

    it('should throw if amount invalid', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        amount: 0,
      })).rejects.toThrow('Invalid amount');
    });

    it('should throw if timelock invalid', async () => {
      const validParams = getValidParams();
      await expect(service.claimViaRifRelay({
        ...validParams,
        timelock: 0,
      })).rejects.toThrow('Invalid timelock');
    });

    it('should throw if RIF Relay not available', async () => {
      const validParams = getValidParams();
      const { isRifRelayAvailable } = await import('../../utils/networkConfig');
      vi.mocked(isRifRelayAvailable).mockReturnValueOnce(false);

      await expect(service.claimViaRifRelay(validParams)).rejects.toThrow('RIF Relay is not available');
    });

    it('should claim via RIF Relay successfully', async () => {
      const validParams = getValidParams();
      const { relayClaimTransaction } = await import('../rif/Signer');
      const relaySpy = vi.mocked(relayClaimTransaction);
      
      const result = await service.claimViaRifRelay(validParams);

      expect(result).toBe('0x' + 'relay'.repeat(16));
      expect(relaySpy).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const validParams = getValidParams();
      const { relayClaimTransaction } = await import('../rif/Signer');
      const relaySpy = vi.mocked(relayClaimTransaction);
      relaySpy.mockRejectedValueOnce(new Error('RIF Relay failed'));

      await expect(service.claimViaRifRelay(validParams)).rejects.toThrow('Failed to claim via RIF Relay');
    });
  });

  describe('waitForConfirmation', () => {
    it('should wait for transaction confirmation', async () => {
      const txHash = '0x' + 'tx'.repeat(32);
      await service.waitForConfirmation(txHash, mockProvider);

      expect(mockProvider.waitForTransaction).toHaveBeenCalledWith(txHash);
    });

    it('should handle confirmation errors gracefully', async () => {
      const txHash = '0x' + 'tx'.repeat(32);
      mockProvider.waitForTransaction.mockRejectedValueOnce(new Error('Transaction failed'));

      const result = await service.waitForConfirmation(txHash, mockProvider);
      // waitForConfirmation returns null on error, doesn't throw
      expect(result).toBeNull();
    });
  });
});

