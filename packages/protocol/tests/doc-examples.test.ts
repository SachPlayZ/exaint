import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as schemas from '../src/schemas.js';

/**
 * docs/01-protocol.md is the contract. Every JSON example in it must parse
 * against a schema this package exports — otherwise the doc and the code have
 * diverged, which AGENTS.md §10 calls a bug in one of them.
 *
 * This reads the doc rather than copying its examples, so a new example cannot
 * be added without a schema that accepts it.
 */

const DOC_URL = new URL('../../../docs/01-protocol.md', import.meta.url);
const doc = readFileSync(DOC_URL, 'utf8');

const CANDIDATES: ReadonlyArray<readonly [string, z.ZodType]> = [
  ['MarketsResponse', schemas.MarketsResponseSchema],
  ['BookSnapshotResponse', schemas.BookSnapshotResponseSchema],
  ['CandleHistoryResponse', schemas.CandleHistoryResponseSchema],
  ['TicketResponse', schemas.TicketResponseSchema],
  ['TicketPayload', schemas.TicketPayloadSchema],
  ['RestErrorResponse', schemas.RestErrorResponseSchema],
  ['ClientFrame', schemas.ClientFrameSchema],
  ['ServerFrame', schemas.ServerFrameSchema],
  ['Trade', schemas.TradeSchema],
  ['Candle', schemas.CandleSchema],
];

function extractJsonBlocks(markdown: string): { block: string; line: number }[] {
  const blocks: { block: string; line: number }[] = [];
  const lines = markdown.split('\n');
  let open: { start: number; body: string[] } | null = null;

  for (const [index, line] of lines.entries()) {
    if (open === null) {
      if (line.trim() === '```json') open = { start: index + 2, body: [] };
      continue;
    }
    if (line.trim() === '```') {
      blocks.push({ block: open.body.join('\n'), line: open.start });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return blocks;
}

const blocks = extractJsonBlocks(doc);

describe('docs/01-protocol.md examples', () => {
  it('finds the JSON examples in the doc', () => {
    // Guards the extractor itself: a silently empty match would pass everything.
    expect(blocks.length).toBeGreaterThanOrEqual(14);
  });

  it.each(blocks.map((b, i) => [i, b.line, b.block] as const))(
    'block %i (docs/01-protocol.md:%i) is valid JSON and matches a protocol schema',
    (_index, _line, block) => {
      const parsed: unknown = JSON.parse(block);
      const matched = CANDIDATES.filter(([, schema]) => schema.safeParse(parsed).success).map(
        ([name]) => name,
      );
      expect(matched, `no protocol schema accepts:\n${block}`).not.toHaveLength(0);
    },
  );
});

describe('normative examples resolve to the intended schema', () => {
  it('a trade carries a per-symbol tradeId, not a timestamp ordering key', () => {
    const trade = schemas.TradeSchema.parse({
      type: 'trade',
      symbol: 'BTC-USD',
      tradeId: '183192',
      timestamp: 1789874705123,
      side: 'buy',
      price: '67231.4287',
      quantity: '0.03124500',
    });
    expect(trade.tradeId).toBe('183192');
  });

  it('a book delta carries previousSequence so gap detection is local', () => {
    const delta = schemas.BookDeltaFrameSchema.parse({
      type: 'book.delta',
      symbol: 'BTC-USD',
      previousSequence: '15291',
      sequence: '15292',
      timestamp: 1789874705142,
      bids: [['67230.9000', '0.50000000']],
      asks: [['67232.0000', '0']],
    });
    expect(delta.previousSequence).toBe('15291');
    // Quantity "0" is the delete sentinel and must survive validation verbatim.
    expect(delta.asks[0]?.[1]).toBe('0');
  });

  it('an empty candle history is a valid response, not an error', () => {
    const response = schemas.CandleHistoryResponseSchema.parse({
      symbol: 'BTC-USD',
      interval: '1s',
      serverTime: 1789874705123,
      candles: [],
    });
    expect(response.candles).toEqual([]);
  });
});
