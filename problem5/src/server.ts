import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import resourcesRouter from './routes/resources';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import { config } from './config';

const app = express();

// Security middleware
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for Swagger UI / static demo
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Global rate limit
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// Auth endpoints — stricter rate limit
app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));

// Swagger docs
try {
  const swaggerUi = require('swagger-ui-express');
  const YAML = require('yamljs');
  const fs = require('fs');
  const specPath = path.join(__dirname, '../openapi.yaml');
  if (fs.existsSync(specPath)) {
    const spec = YAML.load(specPath);
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  }
} catch {
  // swagger-ui-express optional
}

// API routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/resources', resourcesRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Static frontend
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { index: false }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

export { app };

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`Problem 5 CRUD server → http://localhost:${config.PORT}`);
    console.log(`  Frontend  → http://localhost:${config.PORT}/`);
    console.log(`  API       → http://localhost:${config.PORT}/api/resources`);
    console.log(`  Auth      → http://localhost:${config.PORT}/api/auth`);
    console.log(`  Docs      → http://localhost:${config.PORT}/docs`);
  });
}
