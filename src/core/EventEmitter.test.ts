import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from './EventEmitter';

describe('EventEmitter', () => {
  describe('Constructor', () => {
    it('should initialize with initial state', () => {
      const initialState = { count: 0, name: 'test' };
      const emitter = new EventEmitter(initialState);
      
      expect(emitter.getState()).toEqual(initialState);
    });

    it('should create independent instances', () => {
      const emitter1 = new EventEmitter({ value: 1 });
      const emitter2 = new EventEmitter({ value: 2 });
      
      expect(emitter1.getState()).toEqual({ value: 1 });
      expect(emitter2.getState()).toEqual({ value: 2 });
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const initialState = { count: 5 };
      const emitter = new EventEmitter(initialState);
      
      expect(emitter.getState()).toEqual({ count: 5 });
    });

    it('should return a snapshot of the state', () => {
      const emitter = new EventEmitter({ count: 0 });
      const state1 = emitter.getState();
      
      emitter.setState({ count: 1 });
      const state2 = emitter.getState();
      
      expect(state1).toEqual({ count: 0 });
      expect(state2).toEqual({ count: 1 });
    });
  });

  describe('setState', () => {
    it('should update state with partial update', () => {
      const emitter = new EventEmitter({ count: 0, name: 'initial' });
      
      emitter.setState({ count: 1 });
      
      expect(emitter.getState()).toEqual({ count: 1, name: 'initial' });
    });

    it('should update multiple properties', () => {
      const emitter = new EventEmitter({ count: 0, name: 'initial', active: false });
      
      emitter.setState({ count: 5, active: true });
      
      expect(emitter.getState()).toEqual({ count: 5, name: 'initial', active: true });
    });

    it('should update state with updater function', () => {
      const emitter = new EventEmitter({ count: 0 });
      
      emitter.setState((prev) => ({ count: prev.count + 1 }));
      
      expect(emitter.getState()).toEqual({ count: 1 });
    });

    it('should handle updater function with multiple updates', () => {
      const emitter = new EventEmitter({ count: 0 });
      
      emitter.setState((prev) => ({ count: prev.count + 1 }));
      emitter.setState((prev) => ({ count: prev.count * 2 }));
      
      expect(emitter.getState()).toEqual({ count: 2 });
    });

    it('should replace entire state with updater function', () => {
      const emitter = new EventEmitter({ count: 0, name: 'old' });
      
      emitter.setState(() => ({ count: 10, name: 'new' }));
      
      expect(emitter.getState()).toEqual({ count: 10, name: 'new' });
    });
  });

  describe('subscribe', () => {
    it('should add listener and call immediately with current state', () => {
      const emitter = new EventEmitter({ count: 5 });
      const listener = vi.fn();
      
      emitter.subscribe(listener);
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ count: 5 });
    });

    it('should return unsubscribe function', () => {
      const emitter = new EventEmitter({ count: 0 });
      const unsubscribe = emitter.subscribe(() => {});
      
      expect(typeof unsubscribe).toBe('function');
    });

    it('should call listener on state changes', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener = vi.fn();
      
      emitter.subscribe(listener);
      listener.mockClear(); // Clear initial call
      
      emitter.setState({ count: 1 });
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ count: 1 });
    });

    it('should call multiple listeners on state changes', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      emitter.subscribe(listener1);
      emitter.subscribe(listener2);
      listener1.mockClear();
      listener2.mockClear();
      
      emitter.setState({ count: 1 });
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener1).toHaveBeenCalledWith({ count: 1 });
      expect(listener2).toHaveBeenCalledWith({ count: 1 });
    });

    it('should not call unsubscribed listeners', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      const unsubscribe1 = emitter.subscribe(listener1);
      emitter.subscribe(listener2);
      listener1.mockClear();
      listener2.mockClear();
      
      unsubscribe1();
      
      emitter.setState({ count: 1 });
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple subscriptions and unsubscriptions', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();
      
      const unsubscribe1 = emitter.subscribe(listener1);
      const unsubscribe2 = emitter.subscribe(listener2);
      emitter.subscribe(listener3);
      
      listener1.mockClear();
      listener2.mockClear();
      listener3.mockClear();
      
      unsubscribe1();
      emitter.setState({ count: 1 });
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
      
      unsubscribe2();
      listener2.mockClear();
      listener3.mockClear();
      
      emitter.setState({ count: 2 });
      
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it('should handle complex state updates with listeners', () => {
      const emitter = new EventEmitter({ items: [] as string[] });
      const listener = vi.fn();
      
      emitter.subscribe(listener);
      listener.mockClear();
      
      emitter.setState({ items: ['item1', 'item2'] });
      
      expect(listener).toHaveBeenCalledWith({ items: ['item1', 'item2'] });
      
      emitter.setState((prev) => ({ items: [...prev.items, 'item3'] }));
      
      expect(listener).toHaveBeenCalledWith({ items: ['item1', 'item2', 'item3'] });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty state object', () => {
      const emitter = new EventEmitter({});
      
      expect(emitter.getState()).toEqual({});
      
      emitter.setState({ newProp: 'value' });
      expect(emitter.getState()).toEqual({ newProp: 'value' });
    });

    it('should handle state with nested objects', () => {
      const emitter = new EventEmitter({ 
        user: { name: 'John', age: 30 },
        settings: { theme: 'dark' }
      });
      
      emitter.setState({ user: { name: 'Jane', age: 25 } });
      
      expect(emitter.getState()).toEqual({
        user: { name: 'Jane', age: 25 },
        settings: { theme: 'dark' }
      });
    });

    it('should handle rapid state updates', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener = vi.fn();
      
      emitter.subscribe(listener);
      listener.mockClear();
      
      emitter.setState({ count: 1 });
      emitter.setState({ count: 2 });
      emitter.setState({ count: 3 });
      
      expect(listener).toHaveBeenCalledTimes(3);
      expect(emitter.getState()).toEqual({ count: 3 });
    });

    it('should handle unsubscribe called multiple times', () => {
      const emitter = new EventEmitter({ count: 0 });
      const listener = vi.fn();
      
      const unsubscribe = emitter.subscribe(listener);
      listener.mockClear();
      
      unsubscribe();
      unsubscribe(); // Should be safe to call multiple times
      
      emitter.setState({ count: 1 });
      
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

