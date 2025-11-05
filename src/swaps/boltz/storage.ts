/**
 * Swap Storage Interface
 * 
 * Provides an abstraction layer for storing swap data.
 * This allows the SDK to be storage-agnostic - consumers can implement
 * this interface to use their preferred storage solution (Nostr, localStorage, IndexedDB, etc.)
 */

export interface SwapStorage {
	/**
	 * Save swap data
	 * @param swapId Unique identifier for the swap
	 * @param data Swap data to store
	 */
	save(swapId: string, data: any): Promise<void>;

	/**
	 * Load swap data by ID
	 * @param swapId Unique identifier for the swap
	 * @returns Swap data or null if not found
	 */
	load(swapId: string): Promise<any | null>;

	/**
	 * Load all swaps
	 * @returns Array of all stored swaps
	 */
	loadAll(): Promise<any[]>;

	/**
	 * Delete swap data
	 * @param swapId Unique identifier for the swap
	 */
	delete(swapId: string): Promise<void>;
}

/**
 * In-Memory Swap Storage Implementation
 * Useful for testing or temporary storage
 */
export class InMemorySwapStorage implements SwapStorage {
	private swaps: Map<string, any> = new Map();

	async save(swapId: string, data: any): Promise<void> {
		this.swaps.set(swapId, JSON.parse(JSON.stringify(data)));
	}

	async load(swapId: string): Promise<any | null> {
		const data = this.swaps.get(swapId);
		return data ? JSON.parse(JSON.stringify(data)) : null;
	}

	async loadAll(): Promise<any[]> {
		return Array.from(this.swaps.values()).map(data => 
			JSON.parse(JSON.stringify(data))
		);
	}

	async delete(swapId: string): Promise<void> {
		this.swaps.delete(swapId);
	}

	/**
	 * Clear all swaps (useful for testing)
	 */
	clear(): void {
		this.swaps.clear();
	}
}

