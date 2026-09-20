import { PRICE_SCALE, QUANTITY_SCALE } from '@repo/protocol';

/**
 * Fixed-point helpers for the market domain. Everything here is `bigint`;
 * decimal strings happen at the JSON boundary and nowhere else.
 * See docs/02-market-domain.md §5 and docs/adr/0002-fixed-point-bigint.md.
 */

export { PRICE_SCALE, QUANTITY_SCALE };

/** `10 ** scale`, as the multiplier between a unit and its fixed-point form. */
export function scaleUnit(scale: number): bigint {
  return 10n ** BigInt(scale);
}

export const PRICE_UNIT = scaleUnit(PRICE_SCALE);
export const QUANTITY_UNIT = scaleUnit(QUANTITY_SCALE);

export function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function clampBigInt(value: bigint, low: bigint, high: bigint): bigint {
  if (low > high) throw new RangeError('clamp bounds are inverted');
  return value < low ? low : value > high ? high : value;
}

/**
 * Snaps a price down to the nearest multiple of `tickSize`. Floor rather than
 * round-half so repeated snapping is idempotent and never drifts upward.
 */
export function floorToTick(price: bigint, tickSize: bigint): bigint {
  if (tickSize <= 0n) throw new RangeError('tickSize must be positive');
  const remainder = ((price % tickSize) + tickSize) % tickSize;
  return price - remainder;
}

/** Snaps a price up to the nearest multiple of `tickSize`. */
export function ceilToTick(price: bigint, tickSize: bigint): bigint {
  const floored = floorToTick(price, tickSize);
  return floored === price ? price : floored + tickSize;
}
