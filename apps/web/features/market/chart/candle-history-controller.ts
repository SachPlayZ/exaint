import type { Candle, CandleHistoryResponse, CandlesUpdateFrame } from '@repo/protocol';
import type { CandleScope } from './candle-data';
import { isCandleNewer, mergeCandles } from './candle-data';
import type { ChartSession } from './candlestick-chart-adapter';

export interface ChartSessionFactory {
  create(scope: CandleScope): ChartSession;
}

export interface CandleHistorySource {
  fetch(
    symbol: string,
    interval: CandleScope['interval'],
    signal: AbortSignal,
  ): Promise<CandleHistoryResponse>;
}

export type HistorySelectionResult = 'applied' | 'superseded';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sameScope(
  left: Pick<CandleScope, 'symbol' | 'interval'>,
  right: Pick<CandleScope, 'symbol' | 'interval'>,
): boolean {
  return left.symbol === right.symbol && left.interval === right.interval;
}

/**
 * Owns the history/realtime race. The old chart remains mounted while the next
 * history request is pending, then is disposed immediately before replacement.
 */
export class CandleHistoryController {
  readonly #source: CandleHistorySource;
  readonly #sessions: ChartSessionFactory;

  #generation = 0;
  #abortController: AbortController | null = null;
  #pendingScope: CandleScope | null = null;
  #buffered: Candle[] = [];
  #activeScope: CandleScope | null = null;
  #activeSession: ChartSession | null = null;
  readonly #activeCandles = new Map<number, Candle>();
  #renderingPaused = false;
  #needsFullRender = false;

  constructor(source: CandleHistorySource, sessions: ChartSessionFactory) {
    this.#source = source;
    this.#sessions = sessions;
  }

  get scope(): CandleScope | null {
    return this.#pendingScope ?? this.#activeScope;
  }

  get hasCandles(): boolean {
    return this.#activeCandles.size > 0;
  }

  setRenderingPaused(paused: boolean): void {
    if (paused === this.#renderingPaused) return;
    this.#renderingPaused = paused;
    if (paused || !this.#needsFullRender || this.#activeSession === null) return;
    this.#activeSession.setData(
      [...this.#activeCandles.values()].sort((left, right) => left.startTime - right.startTime),
    );
    this.#needsFullRender = false;
  }

  async select(scope: CandleScope): Promise<HistorySelectionResult> {
    const generation = ++this.#generation;
    this.#abortController?.abort();
    const abortController = new AbortController();
    this.#abortController = abortController;
    this.#pendingScope = scope;
    this.#buffered = [];

    let response: CandleHistoryResponse;
    try {
      response = await this.#source.fetch(scope.symbol, scope.interval, abortController.signal);
    } catch (error) {
      if (generation !== this.#generation || isAbortError(error)) return 'superseded';
      this.#pendingScope = null;
      this.#buffered = [];
      this.#abortController = null;
      throw error;
    }

    if (generation !== this.#generation) {
      return 'superseded';
    }
    if (
      response.symbol !== scope.symbol ||
      response.interval !== scope.interval ||
      response.candles.some((candle) => candle.symbol !== scope.symbol)
    ) {
      this.#pendingScope = null;
      this.#buffered = [];
      this.#abortController = null;
      return 'superseded';
    }

    const merged = mergeCandles(scope, response.candles, this.#buffered);
    const nextSession = this.#sessions.create(scope);
    this.#activeSession?.dispose();
    this.#activeSession = nextSession;
    this.#activeScope = scope;
    this.#abortController = null;
    this.#pendingScope = null;
    this.#buffered = [];
    this.#activeCandles.clear();
    for (const candle of merged) this.#activeCandles.set(candle.startTime, candle);
    if (this.#renderingPaused) this.#needsFullRender = true;
    else nextSession.setData(merged);
    return 'applied';
  }

  onCandles(frame: CandlesUpdateFrame): void {
    const target = this.#pendingScope ?? this.#activeScope;
    if (target === null || !sameScope(target, frame)) return;

    if (this.#pendingScope !== null) {
      this.#buffered.push(...frame.candles);
      return;
    }

    const session = this.#activeSession;
    if (session === null) return;
    const updates = mergeCandles(target, [], frame.candles);
    for (const candle of updates) {
      const current = this.#activeCandles.get(candle.startTime);
      if (!isCandleNewer(candle, current)) continue;
      this.#activeCandles.set(candle.startTime, candle);
      if (this.#renderingPaused) this.#needsFullRender = true;
      else session.update(candle);
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#pendingScope = null;
    this.#buffered = [];
    this.#activeCandles.clear();
    this.#activeSession?.dispose();
    this.#activeSession = null;
    this.#activeScope = null;
    this.#needsFullRender = false;
  }
}
