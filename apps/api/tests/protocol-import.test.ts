import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeClientFrame,
  formatPrice,
  parsePrice,
  schemas,
} from '@repo/protocol';

/**
 * The contract crosses the app boundary as a package, not as a reach into
 * another app's source. This proves the published entry point resolves from the
 * api workspace (docs/00-architecture.md §2).
 */
describe('@repo/protocol from apps/api', () => {
  it('resolves the package entry point', () => {
    expect(PROTOCOL_VERSION).toBe('v1');
    expect(schemas.IntervalSchema.options).toEqual(['1s', '5s', '1m']);
  });

  it('decodes a client frame and round-trips a price', () => {
    const result = decodeClientFrame(
      JSON.stringify({ type: 'subscribe', symbol: 'ETH-USD', channels: ['book'] }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(formatPrice(parsePrice('67231.4287'))).toBe('67231.4287');
  });
});
