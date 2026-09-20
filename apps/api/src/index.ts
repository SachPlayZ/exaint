import { buildServer } from './app/build-server.js';
import { createApplication } from './app/create-app.js';
import { loadServerConfig } from './config/env.js';

const config = loadServerConfig();
const application = createApplication();
const server = await buildServer(application.context, application.runtime);

application.runtime.start();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  server.log.info({ event: 'server.shutdown', signal }, 'shutting down');
  application.runtime.stop();
  await server.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  application.runtime.stop();
  server.log.error({ event: 'server.listen_failed', err: error }, 'failed to listen');
  process.exit(1);
}
