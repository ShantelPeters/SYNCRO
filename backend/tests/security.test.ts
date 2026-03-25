import request from 'supertest';
import express from 'express';

// Mock everything before any other imports
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() }
  }
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user', email: 'test@example.com' };
    next();
  }
}));

jest.mock('../src/middleware/ownership', () => ({
  validateSubscriptionOwnership: (req: any, res: any, next: any) => next(),
  validateBulkSubscriptionOwnership: (req: any, res: any, next: any) => next(),
}));

jest.mock('../src/services/idempotency', () => ({
  idempotencyService: {
    hashRequest: jest.fn().mockReturnValue('hash'),
    checkIdempotency: jest.fn().mockResolvedValue({ isDuplicate: false }),
    storeResponse: jest.fn()
  }
}));

jest.mock('../src/services/subscription-service', () => ({
  subscriptionService: {
    createSubscription: jest.fn().mockResolvedValue({
      subscription: { id: '123' },
      syncStatus: 'synced'
    }),
    updateSubscription: jest.fn().mockResolvedValue({
      subscription: { id: '123' },
      syncStatus: 'synced'
    })
  }
}));

// Use require to ensure mocks are in place
const subscriptionRoutes = require('../src/routes/subscriptions').default;

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use('/api/subscriptions', subscriptionRoutes);

describe('Security - Body Parsing and Validation', () => {
  it('should return 413 when payload exceeds 10kb', async () => {
    const response = await request(app)
      .post('/api/subscriptions')
      .send({ name: 'a'.repeat(11000) });
    expect(response.status).toBe(413);
  });

  it('should return 400 when name length exceeds 100 chars', async () => {
    const response = await request(app)
      .post('/api/subscriptions')
      .send({ name: 'a'.repeat(101), price: 10, billing_cycle: 'monthly' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  it('should allow valid payloads', async () => {
    const response = await request(app)
      .post('/api/subscriptions')
      .send({ name: 'Netflix', price: 15.99, billing_cycle: 'monthly' });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
