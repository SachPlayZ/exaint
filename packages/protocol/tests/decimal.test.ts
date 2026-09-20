import { describe, expect, it } from 'vitest';
import {
  DecimalParseError,
  PRICE_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  formatIdentifier,
  formatPrice,
  formatQuantity,
  parseDecimal,
  parseIdentifier,
  parsePrice,
  parseQuantity,
} from '../src/decimal.js';

describe('decimal codecs', () => {
  it('parses the worked examples from docs/02-market-domain.md §5', () => {
    expect(parsePrice('67231.4287')).toBe(672314287n);
    expect(parseQuantity('0.03124500')).toBe(3124500n);
  });

  it('keeps trailing zeros — the scale is part of the contract', () => {
    expect(formatQuantity(3124500n)).toBe('0.03124500');
    expect(formatQuantity(3124500n)).not.toBe('0.031245');
    expect(formatPrice(672314287n)).toBe('67231.4287');
  });

  it('accepts fewer fraction digits than the scale, so "0" deletes a book level', () => {
    expect(parseQuantity('0')).toBe(0n);
    expect(parseQuantity('0.5')).toBe(50000000n);
    expect(parsePrice('67232')).toBe(672320000n);
  });

  it('round-trips every value through both directions', () => {
    for (const value of ['0', '0.00000001', '1', '12345.67890123', '999999.99999999']) {
      const scaled = parseDecimal(value, QUANTITY_SCALE);
      expect(parseDecimal(formatDecimal(scaled, QUANTITY_SCALE), QUANTITY_SCALE)).toBe(scaled);
    }
    for (const raw of [0n, 1n, 3124500n, 672314287n, 10n ** 18n]) {
      expect(parseQuantity(formatQuantity(raw))).toBe(raw);
      expect(parsePrice(formatPrice(raw))).toBe(raw);
    }
  });

  it('handles negative values and scale 0', () => {
    expect(parseDecimal('-0.5', 1)).toBe(-5n);
    expect(formatDecimal(-5n, 1)).toBe('-0.5');
    expect(formatDecimal(-1n, 8)).toBe('-0.00000001');
    expect(formatDecimal(42n, 0)).toBe('42');
    expect(parseDecimal('42', 0)).toBe(42n);
  });

  it('rejects anything that is not a plain decimal', () => {
    const bad = ['', ' 1', '1 ', '+1', '.5', '1.', '1e5', '0x10', 'NaN', 'Infinity', '007', '1,5'];
    for (const value of bad) {
      expect(() => parseQuantity(value), value).toThrow(DecimalParseError);
    }
  });

  it('rejects more fraction digits than the scale carries', () => {
    expect(() => parsePrice('1.12345')).toThrow(/more than 4 fraction digits/);
    expect(() => parseQuantity('1.123456789')).toThrow(/more than 8 fraction digits/);
    expect(parsePrice('1.1234')).toBe(11234n);
  });

  it('rejects an out-of-range scale rather than silently truncating', () => {
    expect(() => parseDecimal('1', -1)).toThrow(RangeError);
    expect(() => formatDecimal(1n, 19)).toThrow(RangeError);
  });

  it('parses and formats identifiers as unsigned integers', () => {
    expect(parseIdentifier('183192')).toBe(183192n);
    expect(formatIdentifier(183192n)).toBe('183192');
    expect(() => parseIdentifier('-1')).toThrow(DecimalParseError);
    expect(() => parseIdentifier('1.0')).toThrow(DecimalParseError);
    expect(() => formatIdentifier(-1n)).toThrow(RangeError);
  });

  it('pins the documented scales', () => {
    expect(PRICE_SCALE).toBe(4);
    expect(QUANTITY_SCALE).toBe(8);
  });
});
