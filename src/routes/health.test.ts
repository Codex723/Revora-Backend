import { Request, Response } from 'express';
import { Pool } from 'pg';
import createHealthRouter, { healthReadyHandler } from './health';
import request from 'supertest';
import app from '../index';
import { closePool } from '../db/client';

// Mock fetch for Stellar check
global.fetch = jest.fn();

afterAll(async () => {
    await closePool();
});

describe('Health Router', () => {
    let mockPool: jest.Mocked<Pool>;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        mockPool = {
            query: jest.fn(),
        } as unknown as jest.Mocked<Pool>;

        jsonMock = jest.fn();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockReq = {};
        mockRes = {
            status: statusMock,
            json: jsonMock,
        };

        jest.clearAllMocks();
    });

    it('should return 200 when both DB and Stellar are up', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
    });

    it('should return 503 when DB is down', async () => {
        (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('Connection timeout'));

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
        expect(global.fetch).not.toHaveBeenCalled(); // DB checked first
    });

    it('should return 503 when Stellar Horizon is down', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
    });

    it('should return 503 when Stellar Horizon returns non-OK status', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
    });

    it('should create returning router instance', () => {
        const router = createHealthRouter(mockPool);
        expect(router).toBeDefined();
        expect(typeof router.get).toBe('function');
    });
});

describe('API Version Prefix Consistency tests', () => {
    it('should resolve /health without API prefix', async () => {
        const res = await request(app).get('/health');
        expect([200, 503]).toContain(res.status);
    });

    it('should resolve api routes with API_VERSION_PREFIX', async () => {
        const prefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
        const res = await request(app).get(`${prefix}/overview`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('name', 'Stellar RevenueShare (Revora) Backend');
    });

    it('should return 404 for api routes without prefix', async () => {
        const res = await request(app).get('/overview');
        expect(res.status).toBe(404);
    });
    
    it('should correctly scope protected endpoints under the prefix', async () => {
        const prefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
        // Hit milestone validation route (requires auth)
        const res = await request(app).post(`${prefix}/vaults/vault-1/milestones/milestone-1/validate`);
        expect(res.status).toBe(401);
    });
    
    it('should 404 for protected endpoints if prefix is lacking', async () => {
        const res = await request(app).post('/vaults/vault-1/milestones/milestone-1/validate');
        expect(res.status).toBe(404);
    });
});

describe('Revenue Route Schema Validation tests', () => {
    const prefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
    const VALID_UUID = '00000000-0000-4000-8000-000000000000';
    const VALID_BODY = {
        amount: '1000.00',
        periodStart: '2024-01-01',
        periodEnd: '2024-03-31',
    };

    // ── POST /offerings/:id/revenue ──────────────────────────────────────────

    it('valid body + valid UUID param reaches auth guard (returns 401, not 400)', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send(VALID_BODY);
        // Schema validation passes → authMiddleware fires → 401 because no Bearer token
        expect(res.status).toBe(401);
    });

    it('missing amount returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ periodStart: '2024-01-01', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('amount')])
        );
    });

    it('missing periodStart returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: '500.00', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('periodStart')])
        );
    });

    it('missing periodEnd returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: '500.00', periodStart: '2024-01-01' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('periodEnd')])
        );
    });

    it('invalid UUID format in :id param returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/not-a-uuid/revenue`)
            .send(VALID_BODY);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('id')])
        );
    });

    it('non-numeric amount returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: 'not-a-number', periodStart: '2024-01-01', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('amount')])
        );
    });

    it('invalid ISO date for periodStart returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: '500.00', periodStart: 'January 1st 2024', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('periodStart')])
        );
    });

    it('invalid ISO date for periodEnd returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: '500.00', periodStart: '2024-01-01', periodEnd: 'not-a-date' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('periodEnd')])
        );
    });

    it('inverted period dates pass schema validation and reach auth guard (returns 401)', async () => {
        // Schema validates format only — date ordering (periodEnd > periodStart) is a
        // RevenueService business rule. Without a token, auth fires first and returns 401.
        const res = await request(app)
            .post(`${prefix}/offerings/${VALID_UUID}/revenue`)
            .send({ amount: '500.00', periodStart: '2024-12-31', periodEnd: '2024-01-01' });
        expect(res.status).toBe(401);
    });

    // ── POST /revenue-reports ────────────────────────────────────────────────

    it('POST /revenue-reports: missing offeringId returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/revenue-reports`)
            .send({ amount: '500.00', periodStart: '2024-01-01', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('offeringId')])
        );
    });

    it('POST /revenue-reports: invalid offeringId UUID format returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/revenue-reports`)
            .send({ offeringId: 'bad-uuid', amount: '500.00', periodStart: '2024-01-01', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('offeringId')])
        );
    });

    it('POST /revenue-reports: valid body with no auth returns 401', async () => {
        const res = await request(app)
            .post(`${prefix}/revenue-reports`)
            .send({ offeringId: VALID_UUID, amount: '750.50', periodStart: '2024-01-01', periodEnd: '2024-06-30' });
        // Schema validation passes; auth gate rejects
        expect(res.status).toBe(401);
    });

    it('POST /revenue-reports: leading-dot amount returns 400 ValidationError', async () => {
        const res = await request(app)
            .post(`${prefix}/revenue-reports`)
            .send({ offeringId: VALID_UUID, amount: '.5', periodStart: '2024-01-01', periodEnd: '2024-03-31' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.details).toEqual(
            expect.arrayContaining([expect.stringContaining('amount')])
        );
    });
});
