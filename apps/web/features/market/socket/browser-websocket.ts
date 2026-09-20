'use client';

import type { WebSocketLike } from './types';

/** Narrow adapter around the browser WebSocket, keeping the client class DOM-independent. */
export class BrowserWebSocket implements WebSocketLike {
  readonly #socket: WebSocket;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('open', () => this.onopen?.());
    this.#socket.addEventListener('message', (event) => this.onmessage?.({ data: event.data }));
    this.#socket.addEventListener('close', (event) =>
      this.onclose?.({ code: event.code, reason: event.reason }),
    );
    this.#socket.addEventListener('error', (event) => this.onerror?.(event));
  }

  get readyState(): number {
    return this.#socket.readyState;
  }

  send(data: string): void {
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }
}
