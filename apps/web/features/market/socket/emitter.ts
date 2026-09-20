/**
 * A tiny typed event emitter. Every `on` returns its own unsubscribe, because a
 * listener registered without its cancellation is the teardown bug in
 * docs/04-frontend.md §14.
 */
export class TypedEmitter<Events> {
  readonly #listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    const existing = this.#listeners.get(event) ?? new Set();
    existing.add(listener as (payload: never) => void);
    this.#listeners.set(event, existing);
    return () => {
      existing.delete(listener as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const listeners = this.#listeners.get(event);
    if (listeners === undefined) return;
    // Copied so a listener unsubscribing mid-emit cannot skip its neighbour.
    for (const listener of [...listeners]) (listener as (value: Events[K]) => void)(payload);
  }

  removeAll(): void {
    this.#listeners.clear();
  }

  count(event: keyof Events): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}
