import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../core/EventBus';

describe('EventBus', () => {
	let bus: EventBus;

	beforeEach(() => {
		bus = new EventBus();
	});

	describe('on/emit', () => {
		it('should subscribe and emit events', () => {
			const callback = vi.fn();

			bus.on('test', callback);
			bus.emit('test', { data: 'hello' });

			expect(callback).toHaveBeenCalledWith({ data: 'hello' });
			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should return unsubscribe function', () => {
			const callback = vi.fn();

			const unsubscribe = bus.on('test', callback);
			unsubscribe();
			bus.emit('test', { data: 'hello' });

			expect(callback).not.toHaveBeenCalled();
		});

		it('should handle multiple listeners', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('test', callback1);
			bus.on('test', callback2);
			bus.emit('test', { data: 'hello' });

			expect(callback1).toHaveBeenCalledWith({ data: 'hello' });
			expect(callback2).toHaveBeenCalledWith({ data: 'hello' });
		});

		it('should handle errors in listeners without breaking others', () => {
			const errorCallback = vi.fn(() => {
				throw new Error('test error');
			});
			const successCallback = vi.fn();

			bus.on('test', errorCallback);
			bus.on('test', successCallback);
			bus.emit('test', { data: 'hello' });

			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).toHaveBeenCalled();
		});

		it('should support multiple event types', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('event1', callback1);
			bus.on('event2', callback2);

			bus.emit('event1', { data: 'first' });
			bus.emit('event2', { data: 'second' });

			expect(callback1).toHaveBeenCalledWith({ data: 'first' });
			expect(callback2).toHaveBeenCalledWith({ data: 'second' });
			expect(callback1).not.toHaveBeenCalledWith({ data: 'second' });
		});

		it('should not call listeners for different events', () => {
			const callback = vi.fn();

			bus.on('event1', callback);
			bus.emit('event2', { data: 'hello' });

			expect(callback).not.toHaveBeenCalled();
		});

		it('should handle emitting to event with no listeners', () => {
			expect(() => {
				bus.emit('nonexistent', { data: 'hello' });
			}).not.toThrow();
		});
	});

	describe('off', () => {
		it('should unsubscribe listener', () => {
			const callback = vi.fn();

			bus.on('test', callback);
			bus.off('test', callback);
			bus.emit('test', { data: 'hello' });

			expect(callback).not.toHaveBeenCalled();
		});

		it('should only unsubscribe specific listener', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('test', callback1);
			bus.on('test', callback2);
			bus.off('test', callback1);
			bus.emit('test', { data: 'hello' });

			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it('should handle unsubscribing non-existent listener', () => {
			const callback = vi.fn();

			expect(() => {
				bus.off('test', callback);
			}).not.toThrow();
		});

		it('should handle unsubscribing from non-existent event', () => {
			const callback = vi.fn();

			expect(() => {
				bus.off('nonexistent', callback);
			}).not.toThrow();
		});
	});

	describe('clear', () => {
		it('should remove all listeners', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('test1', callback1);
			bus.on('test2', callback2);
			bus.clear();
			bus.emit('test1', {});
			bus.emit('test2', {});

			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).not.toHaveBeenCalled();
		});

		it('should allow new subscriptions after clear', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('test', callback1);
			bus.clear();
			bus.on('test', callback2);
			bus.emit('test', { data: 'hello' });

			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});
	});

	describe('listenerCount', () => {
		it('should return correct listener count', () => {
			expect(bus.listenerCount('test')).toBe(0);

			bus.on('test', () => {});
			expect(bus.listenerCount('test')).toBe(1);

			bus.on('test', () => {});
			expect(bus.listenerCount('test')).toBe(2);
		});

		it('should return 0 for non-existent event', () => {
			expect(bus.listenerCount('nonexistent')).toBe(0);
		});

		it('should update count after unsubscribe', () => {
			const callback = vi.fn();

			bus.on('test', callback);
			expect(bus.listenerCount('test')).toBe(1);

			bus.off('test', callback);
			expect(bus.listenerCount('test')).toBe(0);
		});

		it('should update count after clear', () => {
			bus.on('test', () => {});
			bus.on('test', () => {});
			expect(bus.listenerCount('test')).toBe(2);

			bus.clear();
			expect(bus.listenerCount('test')).toBe(0);
		});
	});

	describe('Edge Cases', () => {
		it('should handle rapid subscriptions and unsubscriptions', () => {
			const callbacks = Array.from({ length: 100 }, () => vi.fn());

			// Subscribe all
			const unsubscribers = callbacks.map(cb => bus.on('test', cb));

			// Unsubscribe half
			unsubscribers.slice(0, 50).forEach(unsub => unsub());

			// Emit
			bus.emit('test', { data: 'hello' });

			// First 50 should not be called
			callbacks.slice(0, 50).forEach(cb => {
				expect(cb).not.toHaveBeenCalled();
			});

			// Last 50 should be called
			callbacks.slice(50).forEach(cb => {
				expect(cb).toHaveBeenCalled();
			});
		});

		it('should handle multiple unsubscribe calls', () => {
			const callback = vi.fn();

			const unsubscribe = bus.on('test', callback);
			unsubscribe();
			unsubscribe(); // Second call should not throw

			bus.emit('test', { data: 'hello' });
			expect(callback).not.toHaveBeenCalled();
		});

		it('should handle complex event data', () => {
			const callback = vi.fn();
			const complexData = {
				id: 'swap-123',
				nested: {
					array: [1, 2, 3],
					object: { key: 'value' }
				},
				date: new Date(),
				nullValue: null,
				undefinedValue: undefined
			};

			bus.on('test', callback);
			bus.emit('test', complexData);

			expect(callback).toHaveBeenCalledWith(complexData);
		});

		it('should maintain separate listener sets for different events', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			bus.on('event1', callback1);
			bus.on('event2', callback2);

			expect(bus.listenerCount('event1')).toBe(1);
			expect(bus.listenerCount('event2')).toBe(1);

			bus.off('event1', callback1);

			expect(bus.listenerCount('event1')).toBe(0);
			expect(bus.listenerCount('event2')).toBe(1);
		});
	});

	describe('Type Safety', () => {
		it('should work with typed callbacks', () => {
			interface TestEvent {
				id: string;
				value: number;
			}

			const callback = vi.fn<[TestEvent], void>();

			bus.on<TestEvent>('test', callback);
			bus.emit<TestEvent>('test', { id: 'test-1', value: 42 });

			expect(callback).toHaveBeenCalledWith({ id: 'test-1', value: 42 });
		});
	});
});

