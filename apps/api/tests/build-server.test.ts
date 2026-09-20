import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/app/build-server.js';
import { loadServerConfig } from '../src/config/env.js';

describe('api scaffold', () => {
  it('builds a Fastify instance that can be injected into', async () => {
    const server = buildServer();
    await server.ready();
    const response = await server.inject({ method: 'GET', url: '/' });
    // No routes are registered until P4 — 404 is the correct scaffold behaviour.
    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it('defaults the listen port to 8080 and rejects a non-numeric PORT', () => {
    expect(loadServerConfig({}).port).toBe(8080);
    expect(() => loadServerConfig({ PORT: 'nope' })).toThrow(/PORT must be an integer/);
  });
});
