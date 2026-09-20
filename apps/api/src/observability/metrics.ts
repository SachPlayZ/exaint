/**
 * Counters and gauges, rendered as Prometheus text (docs/06-ops-deploy.md §5).
 *
 * Symbol-labelled series are the point: a single global `trades_generated` tells
 * you nothing about which engine stalled.
 */

export type MetricLabels = Readonly<Record<string, string>>;
type MetricKind = 'counter' | 'gauge';

interface MetricDefinition {
  readonly name: string;
  readonly kind: MetricKind;
  readonly help: string;
  readonly series: Map<string, { labels: MetricLabels; value: number }>;
}

function seriesKey(labels: MetricLabels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key] ?? ''}`)
    .join(',');
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export class MetricsRegistry {
  readonly #metrics = new Map<string, MetricDefinition>();

  register(name: string, kind: MetricKind, help: string): void {
    if (this.#metrics.has(name)) return;
    this.#metrics.set(name, { name, kind, help, series: new Map() });
  }

  #series(name: string, labels: MetricLabels): { labels: MetricLabels; value: number } {
    const metric = this.#metrics.get(name);
    if (metric === undefined) throw new Error(`metric "${name}" was never registered`);
    const key = seriesKey(labels);
    let series = metric.series.get(key);
    if (series === undefined) {
      series = { labels, value: 0 };
      metric.series.set(key, series);
    }
    return series;
  }

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    this.#series(name, labels).value += by;
  }

  setGauge(name: string, labels: MetricLabels, value: number): void {
    this.#series(name, labels).value = value;
  }

  read(name: string, labels: MetricLabels = {}): number {
    return this.#series(name, labels).value;
  }

  render(): string {
    const lines: string[] = [];
    for (const metric of this.#metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);
      if (metric.series.size === 0) {
        lines.push(`${metric.name} 0`);
        continue;
      }
      for (const series of metric.series.values()) {
        const labels = Object.entries(series.labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
          .join(',');
        lines.push(`${metric.name}${labels === '' ? '' : `{${labels}}`} ${series.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

/** Metric names, so a typo is a compile error rather than a silent empty series. */
export const METRIC = {
  tradesGenerated: 'trades_generated',
  candleUpdatesGenerated: 'candle_updates_generated',
  bookSequence: 'book_sequence',
  authTicketsIssued: 'auth_tickets_issued',
  authFailures: 'auth_failures',
  restRequests: 'rest_requests',
  wsConnections: 'ws_connections',
  connectionsByTier: 'connections_by_tier',
  subscriptionsBySymbol: 'subscriptions_by_symbol',
  invalidWsMessages: 'invalid_ws_messages',
  rateLimitedFrames: 'rate_limited_frames',
  rateLimitCloses: 'rate_limit_closes',
  tierChanges: 'tier_changes',
  tradeBatchesDelivered: 'trade_batches_delivered',
  candleUpdatesDelivered: 'candle_updates_delivered',
  wsReconnects: 'ws_reconnects',
  bookResyncs: 'book_resyncs',
} as const;

export function createMetricsRegistry(): MetricsRegistry {
  const metrics = new MetricsRegistry();
  metrics.register(METRIC.tradesGenerated, 'counter', 'Canonical trades generated, per symbol.');
  metrics.register(
    METRIC.candleUpdatesGenerated,
    'counter',
    'Candles finalised by the canonical engine, per symbol. Flat across tiers by construction.',
  );
  metrics.register(METRIC.bookSequence, 'gauge', 'Current bookSequence, per symbol.');
  metrics.register(METRIC.authTicketsIssued, 'counter', 'Connect tickets minted.');
  metrics.register(METRIC.authFailures, 'counter', 'Rejected tickets, by reason.');
  metrics.register(METRIC.restRequests, 'counter', 'REST requests, by route and status class.');
  metrics.register(METRIC.wsConnections, 'counter', 'WebSocket connections accepted.');
  metrics.register(METRIC.wsReconnects, 'counter', 'WebSocket reconnection attempts.');
  metrics.register(METRIC.connectionsByTier, 'gauge', 'Open connections, by effective tier.');
  metrics.register(METRIC.subscriptionsBySymbol, 'gauge', 'Open subscriptions, per symbol.');
  metrics.register(METRIC.invalidWsMessages, 'counter', 'Inbound frames rejected by validation.');
  metrics.register(METRIC.rateLimitedFrames, 'counter', 'Frames dropped by the limiter, by type.');
  metrics.register(METRIC.rateLimitCloses, 'counter', 'Sockets closed for sustained rate abuse.');
  metrics.register(METRIC.tierChanges, 'counter', 'Effective-tier transitions, by reason.');
  metrics.register(
    METRIC.tradeBatchesDelivered,
    'counter',
    'trades.batch frames delivered, per symbol and tier.',
  );
  metrics.register(
    METRIC.candleUpdatesDelivered,
    'counter',
    'candles.update frames delivered, per symbol and tier. Drops as clients degrade, while candle_updates_generated stays flat.',
  );
  metrics.register(METRIC.bookResyncs, 'counter', 'Order book resynchronisations, per symbol.');
  return metrics;
}
