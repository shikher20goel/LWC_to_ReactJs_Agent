/**
 * BFF transport tests.
 *
 * The security assertions here are the important ones: each failure mode they
 * cover WORKS in development and is only wrong in production or under load.
 */
import { createBffTransport, SalesforceTransportError } from './transport-bff.js';

function mockFetch(handler) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init });
        return handler(url, init, calls.length);
    };
    fn.calls = calls;
    return fn;
}

const ok = (body, headers = {}) => ({
    ok: true, status: 200,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body
});

const fail = (status, body, headers = {}) => ({
    ok: false, status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
});

describe('BFF transport — credentials never reach the browser', () => {
    it('sends same-origin credentials and NO Authorization header', async () => {
        // The session is an HttpOnly cookie. If a token ever appears here, it
        // is readable by any script on the page — including a compromised dep.
        const f = mockFetch(() => ok({ id: 'a01' }));
        const t = createBffTransport({ fetchImpl: f });
        await t.getRecord({ recordId: 'a01', fields: ['Contact.Name'] });

        const { init } = f.calls[0];
        expect(init.credentials).toBe('same-origin');
        expect(Object.keys(init.headers).map((h) => h.toLowerCase()))
            .not.toContain('authorization');
        expect(JSON.stringify(init)).not.toMatch(/bearer|access_token|refresh_token/i);
    });

    it('calls the BFF, never Salesforce, and leaks no instance URL', async () => {
        const f = mockFetch(() => ok({}));
        const t = createBffTransport({ fetchImpl: f });
        await t.getRecord({ recordId: 'a01', fields: [] });
        const { url } = f.calls[0];
        expect(url.startsWith('/api/sf')).toBe(true);
        expect(url).not.toMatch(/salesforce\.com|force\.com|my\.salesforce/);
    });

    it('exposes no way to send raw SOQL', async () => {
        // Intent-shaped endpoints only. A client that can post arbitrary SOQL
        // reads whatever the BFF credential can see, defeating FLS.
        const t = createBffTransport({ fetchImpl: mockFetch(() => ok({})) });
        expect(t.query).toBeUndefined();
        expect(t.soql).toBeUndefined();
        expect(typeof t.getRecord).toBe('function');
    });

    it('propagates a traceparent so a render can be tied to an API call', async () => {
        const f = mockFetch(() => ok({}));
        const t = createBffTransport({ fetchImpl: f });
        await t.getRecord({ recordId: 'a01', fields: [] });
        expect(f.calls[0].init.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });
});

describe('BFF transport — org-wide quota is a first-class signal', () => {
    it('reports quota pressure BEFORE the org is hard-failed', async () => {
        // Quota is org-wide: exhausting it 403s every other integration too.
        // Degrading early is much cheaper than finding out at the 403.
        const seen = [];
        const f = mockFetch(() => ok({}, { 'x-sf-api-remaining': '900', 'x-sf-api-limit': '100000' }));
        const t = createBffTransport({ fetchImpl: f, onQuota: (q) => seen.push(q) });
        await t.getRecord({ recordId: 'a01', fields: [] });
        expect(seen).toHaveLength(1);
        expect(seen[0].remaining).toBe(900);
        expect(seen[0].usedPct).toBeCloseTo(0.991, 2);
    });

    it('names quota exhaustion as an ORG-WIDE failure, not an app failure', async () => {
        const f = mockFetch(() => fail(403, [{ errorCode: 'REQUEST_LIMIT_EXCEEDED' }]));
        const t = createBffTransport({ fetchImpl: f });
        await expect(t.getRecord({ recordId: 'a01', fields: [] }))
            .rejects.toThrow(/quota exhausted for the ORG/);
    });

    it('marks quota exhaustion NON-retryable — retrying burns more quota', async () => {
        const f = mockFetch(() => fail(403, [{ errorCode: 'REQUEST_LIMIT_EXCEEDED' }]));
        const t = createBffTransport({ fetchImpl: f });
        const err = await t.getRecord({ recordId: 'a01', fields: [] }).catch((e) => e);
        expect(err).toBeInstanceOf(SalesforceTransportError);
        expect(err.retryable).toBe(false);
        expect(err.status).toBe(403);
    });

    it('marks 429 and 5xx retryable', async () => {
        for (const [status, expected] of [[429, true], [503, true], [400, false], [404, false]]) {
            // eslint-disable-next-line no-await-in-loop
            const err = await createBffTransport({ fetchImpl: mockFetch(() => fail(status, {})) })
                .getRecord({ recordId: 'a01', fields: [] }).catch((e) => e);
            expect([status, err.retryable]).toEqual([status, expected]);
        }
    });

    it('offers a batch hint — a whole composite is ONE call against the quota', async () => {
        // Adding ECS tasks adds no quota, so batching is one of the few real levers.
        const f = mockFetch(() => ok({ results: [] }));
        const t = createBffTransport({ fetchImpl: f });
        await t.batch([{ path: '/record/a01' }, { path: '/record/a02' }]);
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0].url).toContain('/composite');
    });
});

describe('BFF transport — errors carry enough to triage', () => {
    it('surfaces status, body and a correlation id', async () => {
        const f = mockFetch(() => fail(404, [{ errorCode: 'NOT_FOUND', message: 'gone' }],
            { 'x-correlation-id': 'abc-123' }));
        const t = createBffTransport({ fetchImpl: f });
        const err = await t.getRecord({ recordId: 'nope', fields: [] }).catch((e) => e);
        expect(err.status).toBe(404);
        expect(err.correlationId).toBe('abc-123');
        expect(err.body[0].errorCode).toBe('NOT_FOUND');
    });

    it('falls back to the traceparent when the BFF sends no correlation id', async () => {
        const t = createBffTransport({ fetchImpl: mockFetch(() => fail(500, {})) });
        const err = await t.getRecord({ recordId: 'a01', fields: [] }).catch((e) => e);
        expect(err.correlationId).toMatch(/^00-[0-9a-f]{32}/);
    });
});
