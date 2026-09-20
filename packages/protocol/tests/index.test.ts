import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index.js';

describe('@repo/protocol', () => {
  it('exposes the wire protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('v1');
  });
});
