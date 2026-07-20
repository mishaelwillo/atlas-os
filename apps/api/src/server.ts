import { buildApp } from './app.js';

const app = buildApp();
const port = parseInt(process.env.PORT ?? '3000', 10);
const host = '0.0.0.0'; // Important for Docker and Railway routing

const start = async () => {
  try {
    await app.listen({ port, host });
    app.log.info(`Server listening on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
