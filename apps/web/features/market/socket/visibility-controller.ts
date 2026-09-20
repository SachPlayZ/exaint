import type { VisibilitySource } from './types';

export const VISIBILITY_HARD_REFRESH_MS = 30_000;

export interface SocketVisibilityEvent {
  readonly hidden: boolean;
  readonly hiddenMs: number;
}

function browserVisibility(): VisibilitySource | undefined {
  if (typeof document === 'undefined') return undefined;
  return {
    get hidden() {
      return document.hidden;
    },
    addEventListener: (type, listener) => document.addEventListener(type, listener),
    removeEventListener: (type, listener) => document.removeEventListener(type, listener),
  };
}

export class SocketVisibilityController {
  readonly #source: VisibilitySource | undefined;
  readonly #now: () => number;
  readonly #onChange: (event: SocketVisibilityEvent) => void;
  #hiddenAt: number | null = null;
  #listening = false;

  constructor(options: {
    readonly source?: VisibilitySource;
    readonly now: () => number;
    readonly onChange: (event: SocketVisibilityEvent) => void;
  }) {
    this.#source = options.source ?? browserVisibility();
    this.#now = options.now;
    this.#onChange = options.onChange;
  }

  start(): void {
    if (this.#source === undefined || this.#listening) return;
    this.#listening = true;
    this.#source.addEventListener('visibilitychange', this.#handleChange);
    if (this.#source.hidden) this.#hiddenAt = this.#now();
  }

  stop(): void {
    if (this.#source === undefined || !this.#listening) return;
    this.#source.removeEventListener('visibilitychange', this.#handleChange);
    this.#listening = false;
    this.#hiddenAt = null;
  }

  readonly #handleChange = (): void => {
    const source = this.#source;
    if (source === undefined) return;
    if (source.hidden) {
      if (this.#hiddenAt === null) this.#hiddenAt = this.#now();
      this.#onChange({ hidden: true, hiddenMs: 0 });
      return;
    }

    const hiddenMs = this.#hiddenAt === null ? 0 : Math.max(0, this.#now() - this.#hiddenAt);
    this.#hiddenAt = null;
    this.#onChange({ hidden: false, hiddenMs });
  };
}
