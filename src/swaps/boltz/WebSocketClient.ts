/**
 * Boltz WebSocket Client
 * Implements real-time swap monitoring as per Boltz API v2 documentation
 * Reference: http://api.docs.boltz.exchange/api-v2.html#websocket
 */

import type { SwapStatusType, SwapEvent } from './types';

interface WebSocketMessage {
	op?: string;
	event?: string;
	channel?: string;
	args?: any[];
	id?: string;
	invoice?: string;
	error?: string;
}

export class BoltzWebSocket {
	private ws: WebSocket | null = null;
	private endpoint: string;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 3;
	private reconnectDelay = 1000;
	private subscribedSwaps: Set<string> = new Set();
	private callbacks: Map<string, (event: SwapEvent) => void> = new Map();

	constructor(endpoint: string = 'wss://api.boltz.exchange/v2/ws') {
		this.endpoint = endpoint;
	}

	/**
	 * Connect to Boltz WebSocket
	 */
	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.endpoint);

				this.ws.onopen = () => {
					console.log('Boltz WebSocket connected');
					this.reconnectAttempts = 0;
					resolve();
				};

				this.ws.onmessage = (event) => {
					const data = JSON.parse(event.data);
					console.log('📨 Boltz WebSocket message:', data);
					this.handleMessage(data);
				};

				this.ws.onclose = () => {
					console.log('Boltz WebSocket disconnected');
					this.handleReconnect();
				};

				this.ws.onerror = (error) => {
					console.error('Boltz WebSocket error:', error);
					reject(error);
				};

			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Subscribe to swap status updates
	 */
	subscribeToSwap(swapId: string, callback: (event: SwapEvent) => void): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error('❌ WebSocket not connected, cannot subscribe to swap:', swapId);
			throw new Error('WebSocket not connected');
		}

		this.subscribedSwaps.add(swapId);
		this.callbacks.set(swapId, callback);

		// Send subscription message as per Boltz API documentation
		console.log('📡 Subscribing to swap updates:', swapId);
		this.send({
			op: 'subscribe',
			channel: 'swap.update',
			args: [swapId]
		});
	}

	/**
	 * Unsubscribe from swap updates
	 */
	unsubscribeFromSwap(swapId: string): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return;
		}

		this.subscribedSwaps.delete(swapId);
		this.callbacks.delete(swapId);

		this.send({
			op: 'unsubscribe',
			channel: 'swap.update',
			args: [swapId]
		});
	}

	/**
	 * Send application-level ping
	 */
	ping(): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.send({ op: 'ping' });
		}
	}

	/**
	 * Disconnect WebSocket
	 */
	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.subscribedSwaps.clear();
		this.callbacks.clear();
	}

	/**
	 * Handle incoming WebSocket messages
	 */
	private handleMessage(message: WebSocketMessage): void {
		switch (message.event) {
			case 'subscribe':
				break;

			case 'update':
				this.handleSwapUpdate(message);
				break;

			case 'pong':
				console.log('Received pong from Boltz WebSocket');
				break;

			case 'request':
				// Handle BOLT12 invoice requests (if needed)
				console.log('Received invoice request:', message);
				break;

			default:
				console.log('Unknown WebSocket message:', message);
		}
	}

	/**
	 * Handle swap status updates
	 */
	private handleSwapUpdate(message: WebSocketMessage): void {
		if (!message.args || message.args.length === 0) {
			return;
		}

		const swapUpdate = message.args[0];
		const swapId = swapUpdate.id;
		const status = swapUpdate.status as SwapStatusType;

		const callback = this.callbacks.get(swapId);
		if (callback) {
			const event: SwapEvent = {
				swapId,
				status,
				timestamp: new Date(),
				transaction: swapUpdate.transaction
			};

			callback(event);
		}
	}

	/**
	 * Handle reconnection logic
	 */
	private handleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error('Max reconnection attempts reached - stopping reconnection');
			// Clear the WebSocket to prevent further reconnection attempts
			this.ws = null;
			return;
		}

		this.reconnectAttempts++;
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

		console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

		setTimeout(async () => {
			// Check if we should still try to reconnect
			if (this.reconnectAttempts >= this.maxReconnectAttempts) {
				console.error('Max reconnection attempts reached during timeout');
				this.ws = null;
				return;
			}

			try {
				await this.connect();

				// Re-subscribe to all previously subscribed swaps
				for (const swapId of this.subscribedSwaps) {
					this.send({
						op: 'subscribe',
						channel: 'swap.update',
						args: [swapId]
					});
				}
			} catch (error) {
				console.error('Reconnection failed:', error);
				this.handleReconnect();
			}
		}, delay);
	}

	/**
	 * Send message to WebSocket
	 */
	private send(message: WebSocketMessage): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		}
	}
}

