import type { ServerFrame } from '@repo/protocol';
import { decodeServerFrame } from '@repo/protocol';
import WebSocket from 'ws';

export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
}

/**
 * A minimal client for driving the gateway in tests. Every inbound frame is
 * decoded with the protocol schema, so a server frame that does not match the
 * contract fails the test rather than being quietly accepted.
 */
export class TestSocket {
  readonly frames: ServerFrame[] = [];
  readonly raw: string[] = [];
  #closed: CloseInfo | null = null;
  readonly #socket: WebSocket;
  readonly #waiters: (() => void)[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (payload: Buffer) => {
      const text = payload.toString('utf8');
      this.raw.push(text);
      const decoded = decodeServerFrame(text);
      if (!decoded.ok) throw new Error(`server sent an invalid frame: ${text}`);
      this.frames.push(decoded.frame);
      this.#notify();
    });
    socket.on('close', (code: number, reason: Buffer) => {
      this.#closed = { code, reason: reason.toString('utf8') };
      this.#notify();
    });
  }

  static async connect(url: string): Promise<TestSocket> {
    const socket = new WebSocket(url);
    const client = new TestSocket(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  #notify(): void {
    while (this.#waiters.length > 0) this.#waiters.shift()?.();
  }

  get closed(): CloseInfo | null {
    return this.#closed;
  }

  get isOpen(): boolean {
    return this.#socket.readyState === WebSocket.OPEN;
  }

  send(frame: unknown): void {
    this.#socket.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /** Every frame of `type` seen so far. */
  received<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }>[] {
    return this.frames.filter(
      (frame): frame is Extract<ServerFrame, { type: T }> => frame.type === type,
    );
  }

  /** Waits until `predicate` holds over the frames received so far. */
  async until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10);
        this.#waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async waitFor<T extends ServerFrame['type']>(
    type: T,
    count = 1,
    timeoutMs = 2_000,
  ): Promise<Extract<ServerFrame, { type: T }>> {
    await this.until(() => this.received(type).length >= count, timeoutMs);
    const frames = this.received(type);
    const frame = frames[count - 1];
    if (frame === undefined) throw new Error(`no ${type} frame`);
    return frame;
  }

  async waitForClose(timeoutMs = 2_000): Promise<CloseInfo> {
    await this.until(() => this.#closed !== null, timeoutMs);
    if (this.#closed === null) throw new Error('socket did not close');
    return this.#closed;
  }

  /** Lets queued frames arrive before the next assertion. */
  async settle(ms = 60): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  close(): void {
    this.#socket.close();
  }
}
