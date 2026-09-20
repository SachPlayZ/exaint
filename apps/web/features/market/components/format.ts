import type { MarketSummary } from '@repo/protocol';
import { formatDecimal } from '@repo/protocol';

export function tickPrecision(tickSize: string): number {
  const fraction = tickSize.split('.')[1] ?? '';
  return fraction.replace(/0+$/, '').length;
}

export function formatMarketPrice(value: bigint, market: MarketSummary): string {
  const exact = formatDecimal(value, market.priceScale);
  const precision = tickPrecision(market.tickSize);
  if (precision === market.priceScale) return exact;
  const [whole = exact, fraction = ''] = exact.split('.');
  return precision === 0 ? whole : `${whole}.${fraction.slice(0, precision)}`;
}

export function formatMarketQuantity(value: bigint, market: MarketSummary): string {
  const exact = formatDecimal(value, market.quantityScale);
  const [whole = exact, fraction = ''] = exact.split('.');
  const trimmed = fraction.replace(/0+$/u, '');
  return trimmed.length === 0 ? whole : `${whole}.${trimmed}`;
}

export function formatSessionChange(changeBps: bigint | null): string {
  if (changeBps === null) return '—';
  const sign = changeBps > 0n ? '+' : '';
  const absolute = changeBps < 0n ? -changeBps : changeBps;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${sign}${changeBps < 0n ? '-' : ''}${whole}.${fraction}%`;
}

export function formatRate(value: number): string {
  return value < 0.05 ? '0.0' : value.toFixed(1);
}
