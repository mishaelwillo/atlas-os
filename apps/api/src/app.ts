import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  const originEnv = process.env.OS_APP_ORIGIN;
  // If originEnv is defined, use it. Otherwise, default to common dev ports.
  const allowedOrigins = originEnv ? originEnv.split(',') : ['http://localhost:5173', 'http://localhost:3000'];

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.get('/healthz', async (request, reply) => {
    return { ok: true, version: '0.1.0' };
  });

  app.get('/v1/status/mission_control', async (request, reply) => {
    return { ok: true, cards: [] };
  });

  return app;
}
