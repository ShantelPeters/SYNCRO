import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
// Load environment variables before importing other modules
dotenv.config();

import logger from './config/logger';
import { requestIdMiddleware } from './middleware/requestContext';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { schedulerService } from './services/scheduler';
import { reminderEngine } from './services/reminder-engine';
import subscriptionRoutes from './routes/subscriptions';
import riskScoreRoutes from './routes/risk-score';
import simulationRoutes from './routes/simulation';
import merchantRoutes from './routes/merchants';
import teamRoutes from './routes/team';
import auditRoutes from './routes/audit';
import webhookRoutes from './routes/webhooks';
import { monitoringService } from './services/monitoring-service';
import { healthService } from './services/health-service';
import { eventListener } from './services/event-listener';
import { expiryService } from './services/expiry-service';
import { scheduleAutoResume } from './jobs/auto-resume';
import { adminAuth } from './middleware/admin';
import { createAdminLimiter, RateLimiterFactory } from './middleware/rate-limit-factory';


const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'development-admin-key';

// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, If-Match');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ─── Payload-size limits ────────────────────────────────────────────────────
// Per-route overrides MUST be registered before the global parsers so that
// Express selects the correct limit for each path.

// /api/audit accepts batches of up to 100 events — allow 100 kb
app.use('/api/audit', express.json({ limit: '100kb' }));
app.use('/api/audit', express.urlencoded({ extended: true, limit: '100kb' }));

// /api/admin endpoints may send bulk config payloads — allow 50 kb
app.use('/api/admin', express.json({ limit: '50kb' }));
app.use('/api/admin', express.urlencoded({ extended: true, limit: '50kb' }));

// Global default: everything else is capped at 10 kb
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Middleware
app.use(cookieParser());

// Request tracing — must come before routes so every log line carries requestId
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/risk-score', riskScoreRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/webhooks', webhookRoutes);

// API Routes (Public/Standard)
app.get('/api/reminders/status', (req, res) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

// Admin Monitoring Endpoints (Read-only)
app.get('/api/admin/metrics/subscriptions', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getSubscriptionMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription metrics' });
  }
});

app.get('/api/admin/metrics/renewals', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getRenewalMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch renewal metrics' });
  }
});

app.get('/api/admin/metrics/activity', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getAgentActivity();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

// Protocol Health Monitor: unified admin health (metrics, alerts, history)
app.get('/api/admin/health', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const includeHistory = req.query.history !== 'false';
    const health = await healthService.getAdminHealth(includeHistory);
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Error fetching admin health:', error);
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

// Manual trigger endpoints (for testing/admin - Should eventually be protected)
app.post('/api/reminders/process', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    await reminderEngine.processReminders();
    res.json({ success: true, message: 'Reminders processed' });
  } catch (error) {
    logger.error('Error processing reminders:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/reminders/schedule', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const daysBefore = req.body.daysBefore || [7, 3, 1];
    await reminderEngine.scheduleReminders(daysBefore);
    res.json({ success: true, message: 'Reminders scheduled' });
  } catch (error) {
    logger.error('Error scheduling reminders:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/reminders/retry', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    await reminderEngine.processRetries();
    res.json({ success: true, message: 'Retries processed' });
  } catch (error) {
    logger.error('Error processing retries:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Protocol Health Monitor: record metrics snapshot periodically (historical storage)
const HEALTH_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
function startHealthSnapshotInterval() {
  setInterval(() => {
    healthService.recordSnapshot().catch(() => {});
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  // Record one snapshot shortly after startup
  setTimeout(() => healthService.recordSnapshot().catch(() => {}), 5000);
}

app.post('/api/admin/expiry/process', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const result = await expiryService.processExpiries();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error processing expiries:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});


// ─── Global error handler ────────────────────────────────────────────────────
// Must be defined after all routes so Express treats it as an error-handling
// middleware (4-argument signature).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Payload too large (express body-parser throws type === 'entity.too.large')
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Payload too large',
      message: `Request body exceeds the size limit for this endpoint. Maximum allowed size depends on the route (default: 10 kb, /api/audit: 100 kb, /api/admin: 50 kb).`,
    });
  }

  // Malformed JSON
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON',
      message: 'The request body contains malformed JSON.',
    });
  }

  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize rate limiting Redis store
  try {
    await RateLimiterFactory.initializeRedisStore();
    logger.info('Rate limiting initialized successfully');
  } catch (error) {
    logger.warn('Rate limiting initialization failed, using memory store:', error);
  }

  // Start scheduler
  schedulerService.start();

  // Start health metrics snapshot loop
  startHealthSnapshotInterval();

  // Start event listener
  eventListener.start().catch(err => {
    logger.error('Failed to start event listener:', err);
  });

  scheduleAutoResume();
});



// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  schedulerService.stop();
  eventListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  schedulerService.stop();
  eventListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

