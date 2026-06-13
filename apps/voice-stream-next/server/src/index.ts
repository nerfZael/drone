import { loadServerEnv } from './env.js';

loadServerEnv();
const { buildApp } = await import('./app.js');
const { app, port } = await buildApp();

try {
  await app.listen({ host: '0.0.0.0', port });
  app.log.info(`Voice Stream Next API listening on http://0.0.0.0:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
