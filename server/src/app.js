import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { apiLimiter } from './middleware/limits.js';
import adminRoutes from './routes/admin.js';
import nominationRoutes from './routes/nominations.js';
import publicRoutes from './routes/public.js';
import voteRoutes from './routes/vote.js';
import { errorHandler } from './utils/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  if (config.clientOrigin) app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '20kb' }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/nominations', nominationRoutes);
  app.use('/api/vote', voteRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', publicRoutes);
  app.use('/api', (req, res) => res.status(404).json({ message: 'Not found.' }));

  // In production the built React app is served by this same server.
  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
