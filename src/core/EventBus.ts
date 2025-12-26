/**
 * EventBus - Framework-agnostic event pub/sub system
 * Used for emitting and listening to events across the SDK
 */

export type EventCallback<T = any> = (data: T) => void;

export class EventBus {
	private listeners = new Map<string, Set<EventCallback>>();

	/**
	 * Subscribe to an event
	 * @returns Unsubscribe function
	 */
	on<T = any>(event: string, callback: EventCallback<T>): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event)!.add(callback);

		// Return unsubscribe function
		return () => this.off(event, callback);
	}

	/**
	 * Unsubscribe from an event
	 */
	off<T = any>(event: string, callback: EventCallback<T>): void {
		this.listeners.get(event)?.delete(callback);
	}

	/**
	 * Emit an event to all subscribers
	 */
	emit<T = any>(event: string, data: T): void {
		this.listeners.get(event)?.forEach(callback => {
			try {
				callback(data);
			} catch (error) {
				console.error(`Error in event listener for "${event}":`, error);
			}
		});
	}

	/**
	 * Remove all listeners (cleanup)
	 */
	clear(): void {
		this.listeners.clear();
	}

	/**
	 * Get count of listeners for an event (useful for debugging)
	 */
	listenerCount(event: string): number {
		return this.listeners.get(event)?.size ?? 0;
	}
}

