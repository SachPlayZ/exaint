/**
 * @repo/protocol — the single source of truth for every byte on the wire.
 *
 * Scaffold only (P0). The Zod schemas and the types derived from them land in P1:
 * `market.ts`, `rest.ts`, `websocket.ts`, `auth.ts`, `schemas.ts`.
 * See docs/01-protocol.md.
 */

/** Wire protocol version, carried on the WebSocket path and the `hello` frame. */
export const PROTOCOL_VERSION = 'v1' as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
