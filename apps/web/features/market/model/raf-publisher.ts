export interface AnimationFrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** Coalesces any number of model mutations into one UI publication per frame. */
export class RafPublisher<TSnapshot extends object> {
  readonly #createSnapshot: () => TSnapshot;
  readonly #publish: (snapshot: Readonly<TSnapshot>) => void;
  readonly #scheduler: AnimationFrameScheduler;
  #pendingHandle: number | null = null;
  #paused = false;
  #disposed = false;

  constructor(options: {
    createSnapshot: () => TSnapshot;
    publish: (snapshot: Readonly<TSnapshot>) => void;
    scheduler: AnimationFrameScheduler;
  }) {
    this.#createSnapshot = options.createSnapshot;
    this.#publish = options.publish;
    this.#scheduler = options.scheduler;
  }

  mutate(mutation: () => void): void {
    if (this.#disposed) return;
    mutation();
    this.markDirty();
  }

  markDirty(): void {
    if (this.#disposed || this.#paused || this.#pendingHandle !== null) return;
    this.#pendingHandle = this.#scheduler.request(() => {
      this.#pendingHandle = null;
      if (this.#disposed) return;
      this.#publish(Object.freeze(this.#createSnapshot()));
    });
  }

  setPaused(paused: boolean): void {
    if (this.#disposed || paused === this.#paused) return;
    this.#paused = paused;
    if (paused) {
      if (this.#pendingHandle !== null) this.#scheduler.cancel(this.#pendingHandle);
      this.#pendingHandle = null;
      return;
    }
    this.markDirty();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#pendingHandle !== null) this.#scheduler.cancel(this.#pendingHandle);
    this.#pendingHandle = null;
  }
}
