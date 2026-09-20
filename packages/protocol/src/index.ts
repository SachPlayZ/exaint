/**
 * @repo/protocol — the single source of truth for every byte on the wire.
 *
 * Both apps import this package; neither imports the other's internals.
 * Contract reference: docs/01-protocol.md.
 */

export * from './decimal.js';
export * from './market.js';
export * from './auth.js';
export * from './rest.js';
export * from './websocket.js';
export * as schemas from './schemas.js';
