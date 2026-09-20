import type { Channel, Interval, Tier } from '@repo/protocol';
import type { DesiredSubscription } from './types';

export class SocketDesiredState {
  readonly #send: (frame: Record<string, unknown>) => boolean;
  readonly #subscriptions = new Map<string, DesiredSubscription>();
  #tierOverride: Tier | null = null;
  #hasExplicitOverride = false;

  constructor(send: (frame: Record<string, unknown>) => boolean) {
    this.#send = send;
  }

  get tierOverride(): Tier | null {
    return this.#tierOverride;
  }

  subscriptions(): DesiredSubscription[] {
    return [...this.#subscriptions.values()];
  }

  subscribe(symbol: string, channels: readonly Channel[], interval: Interval | null): void {
    this.#subscriptions.set(symbol, { symbol, channels: [...channels], interval });
    this.#send({
      type: 'subscribe',
      symbol,
      channels: [...channels] as [Channel, ...Channel[]],
      ...(interval === null ? {} : { interval }),
    });
  }

  unsubscribe(symbol: string): void {
    this.#subscriptions.delete(symbol);
    this.#send({ type: 'unsubscribe', symbol });
  }

  setInterval(symbol: string, interval: Interval): void {
    const existing = this.#subscriptions.get(symbol);
    if (existing === undefined) return;
    this.#subscriptions.set(symbol, { ...existing, interval });
    this.#send({ type: 'set_interval', symbol, interval });
  }

  setTierOverride(tier: Tier | null): void {
    this.#tierOverride = tier;
    this.#hasExplicitOverride = true;
    this.#send({ type: 'debug.tier_override', tier });
  }

  reapply(): void {
    for (const subscription of this.#subscriptions.values()) {
      this.#send({
        type: 'subscribe',
        symbol: subscription.symbol,
        channels: [...subscription.channels],
        ...(subscription.interval === null ? {} : { interval: subscription.interval }),
      });
    }
    if (this.#hasExplicitOverride) {
      this.#send({ type: 'debug.tier_override', tier: this.#tierOverride });
    }
  }
}
