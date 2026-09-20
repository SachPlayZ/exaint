import type { AuthConfig, HttpConfig, WebSocketConfig } from '../config/env.js';
import type { MarketRepository } from '../market/market-repository.js';
import type { MetricsRegistry } from '../observability/metrics.js';
import type { TicketService } from '../auth/ticket-service.js';

/** Everything the transport layer is allowed to reach. Nothing reaches back. */
export interface AppContext {
  readonly repository: MarketRepository;
  readonly metrics: MetricsRegistry;
  /** `null` when `AUTH_MODE=off` — local development only. */
  readonly tickets: TicketService | null;
  readonly auth: AuthConfig;
  readonly http: HttpConfig;
  readonly websocket: WebSocketConfig;
}
