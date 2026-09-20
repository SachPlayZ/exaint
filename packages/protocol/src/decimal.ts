/**
 * Decimal-string ↔ `bigint` codecs.
 *
 * JSON cannot carry a `bigint` and a float cannot carry money, so every price,
 * quantity, `tradeId` and `sequence` crosses the wire as a decimal string and
 * lives in memory as fixed-point `bigint`. See docs/01-protocol.md §3 and
 * docs/02-market-domain.md §5.
 */

/** Price fixed-point scale — uniform across every symbol. */
export const PRICE_SCALE = 4;

/** Quantity fixed-point scale — uniform across every symbol. */
export const QUANTITY_SCALE = 8;

/**
 * A decimal string as it may arrive on the wire: optional sign, no leading
 * zeros, no exponent, no trailing dot. `"0"`, `"67231.4287"`, `"-0.5"`.
 */
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** An unsigned integer string — `tradeId`, `sequence`. */
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;

export class DecimalParseError extends Error {
  constructor(value: string, reason: string) {
    super(`invalid decimal string ${JSON.stringify(value)}: ${reason}`);
    this.name = 'DecimalParseError';
  }
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError(`scale must be an integer in [0, 18], received ${scale}`);
  }
}

/**
 * Parses a decimal string into fixed-point `bigint` at `scale`.
 *
 * Accepts **at most** `scale` fraction digits — fewer is fine, which is what
 * lets a book delta carry the `"0"` delete sentinel from docs/01-protocol.md §6.
 */
export function parseDecimal(value: string, scale: number): bigint {
  assertScale(scale);
  if (!DECIMAL_PATTERN.test(value)) {
    throw new DecimalParseError(value, 'not a plain decimal number');
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const dot = unsigned.indexOf('.');
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);

  if (fraction.length > scale) {
    throw new DecimalParseError(value, `more than ${scale} fraction digits`);
  }

  const magnitude = BigInt(whole + fraction.padEnd(scale, '0'));
  return negative ? -magnitude : magnitude;
}

/**
 * Renders fixed-point `bigint` as a decimal string with **exactly** `scale`
 * fraction digits. Trailing zeros are part of the contract: `"0.03124500"` is
 * never normalised to `"0.031245"`.
 */
export function formatDecimal(value: bigint, scale: number): string {
  assertScale(scale);
  if (scale === 0) return value.toString();

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const split = digits.length - scale;
  return `${negative ? '-' : ''}${digits.slice(0, split)}.${digits.slice(split)}`;
}

export const parsePrice = (value: string): bigint => parseDecimal(value, PRICE_SCALE);
export const formatPrice = (value: bigint): string => formatDecimal(value, PRICE_SCALE);

export const parseQuantity = (value: string): bigint => parseDecimal(value, QUANTITY_SCALE);
export const formatQuantity = (value: bigint): string => formatDecimal(value, QUANTITY_SCALE);

/** Parses an unsigned integer identifier — `tradeId`, `sequence`. */
export function parseIdentifier(value: string): bigint {
  if (!INTEGER_PATTERN.test(value)) {
    throw new DecimalParseError(value, 'not an unsigned integer');
  }
  return BigInt(value);
}

/** Renders an identifier `bigint`. Negative identifiers are a programming error. */
export function formatIdentifier(value: bigint): string {
  if (value < 0n) {
    throw new RangeError(`identifier must not be negative, received ${value}`);
  }
  return value.toString();
}
