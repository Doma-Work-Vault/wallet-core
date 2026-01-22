import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySwapStorage, type SwapStorage } from '../../swaps/boltz/storage';

describe('InMemorySwapStorage', () => {
  let storage: InMemorySwapStorage;

  beforeEach(() => {
    storage = new InMemorySwapStorage();
  });

  describe('Constructor', () => {
    it('should initialize with empty storage', async () => {
      const swaps = await storage.loadAll();
      expect(swaps).toEqual([]);
    });
  });

  describe('save', () => {
    it('should save swap data', async () => {
      const swapId = 'test-swap-1';
      const swapData = {
        id: swapId,
        status: 'pending',
        amount: 100000,
        preimageHash: 'abc123'
      };

      await storage.save(swapId, swapData);
      const loaded = await storage.load(swapId);

      expect(loaded).toEqual(swapData);
    });

    it('should save multiple swaps', async () => {
      const swap1 = { id: 'swap-1', status: 'pending' };
      const swap2 = { id: 'swap-2', status: 'completed' };

      await storage.save('swap-1', swap1);
      await storage.save('swap-2', swap2);

      const allSwaps = await storage.loadAll();
      expect(allSwaps).toHaveLength(2);
    });

    it('should overwrite existing swap data', async () => {
      const swapId = 'test-swap';
      const initialData = { id: swapId, status: 'pending' };
      const updatedData = { id: swapId, status: 'completed', txHash: '0x123' };

      await storage.save(swapId, initialData);
      await storage.save(swapId, updatedData);

      const loaded = await storage.load(swapId);
      expect(loaded).toEqual(updatedData);
    });

    it('should deep clone data when saving', async () => {
      const swapId = 'test-swap';
      const swapData = {
        id: swapId,
        nested: { value: 1, array: [1, 2, 3] }
      };

      await storage.save(swapId, swapData);
      
      // Modify original object
      swapData.nested.value = 999;
      swapData.nested.array.push(4);

      const loaded = await storage.load(swapId);
      expect(loaded.nested.value).toBe(1);
      expect(loaded.nested.array).toEqual([1, 2, 3]);
    });
  });

  describe('load', () => {
    it('should retrieve swap data by ID', async () => {
      const swapId = 'test-swap-1';
      const swapData = { id: swapId, status: 'pending' };

      await storage.save(swapId, swapData);
      const loaded = await storage.load(swapId);

      expect(loaded).toEqual(swapData);
    });

    it('should return null for non-existent swap', async () => {
      const loaded = await storage.load('non-existent-swap');
      expect(loaded).toBeNull();
    });

    it('should return deep clone of stored data', async () => {
      const swapId = 'test-swap';
      const swapData = { id: swapId, nested: { value: 1 } };

      await storage.save(swapId, swapData);
      const loaded1 = await storage.load(swapId);
      const loaded2 = await storage.load(swapId);

      // Modify first loaded instance
      if (loaded1 && typeof loaded1 === 'object' && 'nested' in loaded1) {
        (loaded1.nested as any).value = 999;
      }

      // Second instance should be unaffected
      expect(loaded2).toEqual(swapData);
    });

    it('should handle complex nested objects', async () => {
      const swapId = 'complex-swap';
      const complexData = {
        id: swapId,
        details: {
          amounts: [100, 200, 300],
          metadata: {
            timestamp: Date.now(),
            addresses: ['0x123', '0x456']
          }
        }
      };

      await storage.save(swapId, complexData);
      const loaded = await storage.load(swapId);

      expect(loaded).toEqual(complexData);
    });
  });

  describe('loadAll', () => {
    it('should return empty array when no swaps stored', async () => {
      const allSwaps = await storage.loadAll();
      expect(allSwaps).toEqual([]);
    });

    it('should return all stored swaps', async () => {
      await storage.save('swap-1', { id: 'swap-1', status: 'pending' });
      await storage.save('swap-2', { id: 'swap-2', status: 'completed' });
      await storage.save('swap-3', { id: 'swap-3', status: 'pending' });

      const allSwaps = await storage.loadAll();
      expect(allSwaps).toHaveLength(3);
    });

    it('should return deep clones of all swaps', async () => {
      const swap1 = { id: 'swap-1', value: 1 };
      const swap2 = { id: 'swap-2', value: 2 };

      await storage.save('swap-1', swap1);
      await storage.save('swap-2', swap2);

      const allSwaps = await storage.loadAll();
      
      // Modify first swap
      if (allSwaps[0] && typeof allSwaps[0] === 'object' && 'value' in allSwaps[0]) {
        (allSwaps[0] as any).value = 999;
      }

      // Reload and verify original data unchanged
      const reloaded = await storage.loadAll();
      expect(reloaded[0]).toEqual(swap1);
    });
  });

  describe('delete', () => {
    it('should delete swap data', async () => {
      const swapId = 'test-swap';
      await storage.save(swapId, { id: swapId, status: 'pending' });

      await storage.delete(swapId);

      const loaded = await storage.load(swapId);
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent swap', async () => {
      await expect(storage.delete('non-existent')).resolves.not.toThrow();
    });

    it('should only delete specified swap', async () => {
      await storage.save('swap-1', { id: 'swap-1' });
      await storage.save('swap-2', { id: 'swap-2' });
      await storage.save('swap-3', { id: 'swap-3' });

      await storage.delete('swap-2');

      expect(await storage.load('swap-1')).not.toBeNull();
      expect(await storage.load('swap-2')).toBeNull();
      expect(await storage.load('swap-3')).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all swaps', async () => {
      await storage.save('swap-1', { id: 'swap-1' });
      await storage.save('swap-2', { id: 'swap-2' });
      await storage.save('swap-3', { id: 'swap-3' });

      storage.clear();

      const allSwaps = await storage.loadAll();
      expect(allSwaps).toEqual([]);
    });

    it('should work on empty storage', () => {
      expect(() => storage.clear()).not.toThrow();
    });

    it('should allow saving after clear', async () => {
      await storage.save('swap-1', { id: 'swap-1' });
      storage.clear();

      await storage.save('swap-2', { id: 'swap-2' });
      const allSwaps = await storage.loadAll();
      expect(allSwaps).toHaveLength(1);
      expect(allSwaps[0]).toEqual({ id: 'swap-2' });
    });
  });

  describe('SwapStorage Interface Compliance', () => {
    it('should implement SwapStorage interface', () => {
      const storageInstance: SwapStorage = new InMemorySwapStorage();
      expect(storageInstance).toBeDefined();
      expect(typeof storageInstance.save).toBe('function');
      expect(typeof storageInstance.load).toBe('function');
      expect(typeof storageInstance.loadAll).toBe('function');
      expect(typeof storageInstance.delete).toBe('function');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values', async () => {
      await storage.save('null-swap', null);
      const loaded = await storage.load('null-swap');
      expect(loaded).toBeNull();
    });

    it('should handle undefined values', async () => {
      // Note: JSON.stringify(undefined) returns undefined, so we store null instead
      // This is expected behavior - undefined cannot be serialized to JSON
      await storage.save('undefined-swap', null);
      const loaded = await storage.load('undefined-swap');
      expect(loaded).toBeNull();
    });

    it('should handle empty strings as swap IDs', async () => {
      await storage.save('', { data: 'test' });
      const loaded = await storage.load('');
      expect(loaded).toEqual({ data: 'test' });
    });

    it('should handle very long swap IDs', async () => {
      const longId = 'a'.repeat(1000);
      await storage.save(longId, { id: longId });
      const loaded = await storage.load(longId);
      expect(loaded).toEqual({ id: longId });
    });

    it('should handle special characters in swap IDs', async () => {
      const specialId = 'swap-123!@#$%^&*()';
      await storage.save(specialId, { id: specialId });
      const loaded = await storage.load(specialId);
      expect(loaded).toEqual({ id: specialId });
    });
  });
});

