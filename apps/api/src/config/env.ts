/**
 * Process configuration. Only the knobs P0 needs live here; each later phase adds
 * the vars it introduces, and records them in docs/06-ops-deploy.md §3.
 */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received "${raw}"`);
  }
  return parsed;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    // 0.0.0.0 so the container port mapping works; see docs/06-ops-deploy.md §4.
    host: env.HOST ?? '0.0.0.0',
    port: readPort(env.PORT),
  };
}
