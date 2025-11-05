/**
 * EventEmitter - Framework-agnostic state management
 */

export type StateListener<T> = (state: T) => void;

export class EventEmitter<T> {
  private state: T;
  private listeners = new Set<StateListener<T>>();

  constructor(initialState: T) {
    this.state = initialState;
  }

  /**
   * Get current state snapshot
   */
  getState(): T {
    return this.state;
  }

  /**
   * Update state with partial update or updater function
   */
  setState(updater: Partial<T> | ((prev: T) => T)): void {
    if (typeof updater === 'function') {
      this.state = updater(this.state);
    } else {
      this.state = { ...this.state, ...updater };
    }
    this.emit();
  }

  /**
   * Subscribe to state changes
   * Returns unsubscribe function
   */
  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit state change to all listeners
   */
  private emit(): void {
    this.listeners.forEach(listener => listener(this.state));
  }
}

