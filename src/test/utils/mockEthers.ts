/**
 * Mock utilities for ethers.js
 */

import { vi } from 'vitest';
import type { JsonRpcProvider, Wallet, HDNodeWallet, Network } from 'ethers';

export interface MockProvider extends Partial<JsonRpcProvider> {
  getBalance: ReturnType<typeof vi.fn>;
  getBlockNumber: ReturnType<typeof vi.fn>;
  estimateGas: ReturnType<typeof vi.fn>;
  getFeeData: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getTransactionCount: ReturnType<typeof vi.fn>;
}

export interface MockWallet extends Partial<Wallet> {
  address: string;
  sendTransaction: ReturnType<typeof vi.fn>;
  getAddress: ReturnType<typeof vi.fn>;
}

export interface MockHDNodeWallet extends Partial<HDNodeWallet> {
  privateKey: string;
}

export function createMockProvider(): MockProvider {
  return {
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 RBTC
    getBlockNumber: vi.fn().mockResolvedValue(12345),
    estimateGas: vi.fn().mockResolvedValue(BigInt('21000')),
    getFeeData: vi.fn().mockResolvedValue({
      gasPrice: BigInt('20000000000'), // 20 gwei
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    }),
    on: vi.fn(),
    off: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
    getTransactionCount: vi.fn().mockResolvedValue(5),
  };
}

export function createMockWallet(address: string = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'): MockWallet {
  const mockTx = {
    hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    wait: vi.fn().mockResolvedValue({
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      blockNumber: 12346,
    }),
  };

  return {
    address,
    getAddress: vi.fn().mockResolvedValue(address),
    sendTransaction: vi.fn().mockResolvedValue(mockTx),
  };
}

export function createMockHDNodeWallet(privateKey: string = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'): MockHDNodeWallet {
  return {
    privateKey,
  };
}

export function createMockNetwork(chainId: number = 30) {
  return {
    chainId,
    name: 'rsk-mainnet',
  };
}

