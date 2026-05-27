import request from 'supertest';
import express from 'express';
import { monitoringService } from '../src/services/monitoring-service';
import { adminAuth } from '../src/middleware/admin';

jest.mock('../src/services/monitoring-service', () => ({
    monitoringService: {
        getSubscriptionMetrics: jest.fn(),
        getRenewalMetrics: jest.fn(),
        getAgentActivity: jest.fn(),
    },
}));

jest.mock('../src/config/logger');

const app = express();
app.use(express.json());

app.get('/api/admin/metrics/subscriptions', adminAuth, async (req, res) => {
    try {
        const metrics = await monitoringService.getSubscriptionMetrics();
        res.json(metrics);
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

describe('Monitoring API Access Control', () => {
    it('should return 401 if x-admin-api-key is missing', async () => {
        const response = await request(app).get('/api/admin/metrics/subscriptions');
        expect(response.status).toBe(401);
    });

    it('should return 403 if x-admin-api-key is incorrect', async () => {
        const response = await request(app)
            .get('/api/admin/metrics/subscriptions')
            .set('x-admin-api-key', 'wrong-key');
        expect(response.status).toBe(403);
    });

    it('should return 200 and data if x-admin-api-key is correct', async () => {
        (monitoringService.getSubscriptionMetrics as jest.Mock).mockResolvedValue({ total_subscriptions: 10 });

        const response = await request(app)
            .get('/api/admin/metrics/subscriptions')
            .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

        expect(response.status).toBe(200);
        expect(response.body.total_subscriptions).toBe(10);
    });
});
