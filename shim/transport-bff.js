/**
 * BFF transport — the `transport` implementation for a React app on AWS ECS.
 *
 * The shim was built with a pluggable transport precisely so the hosting
 * decision could land late. This is that decision made concrete (research/16).
 *
 * ARCHITECTURE
 *   browser (S3/CloudFront)  --same-origin /api/sf/*-->  BFF (ECS Fargate)
 *                                                          |
 *                                                          +--> Salesforce
 *
 * WHY THE BROWSER NEVER TALKS TO SALESFORCE DIRECTLY
 * Salesforce CORS support explicitly does not cover unauthenticated resources,
 * including the OAuth token endpoints. A browser therefore cannot legitimately
 * obtain a token at all — you end up building a server anyway, so build it
 * deliberately rather than discovering it late.
 *
 * WHAT THIS OBJECT MUST NEVER HOLD
 *   - an access or refresh token        (auth rides on an HttpOnly cookie)
 *   - the org instance URL              (BFF concern; leaks org identity)
 *   - an API version                    (BFF pins it; clients drifting is a bug)
 *   - raw SOQL                          (see below)
 *
 * NO CLIENT-SIDE SOQL. Endpoints are INTENT-shaped (`/api/sf/record/:id`), not
 * query-shaped. A client that can post arbitrary SOQL has read access to
 * whatever the BFF's credential can see, which defeats FLS/sharing enforcement
 * no matter how careful the UI is.
 *
 * QUOTA IS ORG-WIDE. Not per user, not per IP, and NOT increased by running
 * more ECS tasks — ten tasks share one org allocation. Production orgs also
 * cap concurrent long-running (20s+) requests at 25. Exhaustion returns
 * 403 REQUEST_LIMIT_EXCEEDED org-wide and takes down unrelated integrations,
 * so quota pressure is surfaced here as a first-class signal rather than being
 * discovered during an incident.
 */

/** Error carrying enough context for TanStack Query and for triage. */
export class SalesforceTransportError extends Error {
    constructor(message, { status, body, quota, correlationId } = {}) {
        super(message);
        this.name = 'SalesforceTransportError';
        this.status = status;
        this.body = body;
        this.quota = quota;
        this.correlationId = correlationId;
        // LWC parity: an error is an error, retrying a 403 quota failure just
        // burns more of an already-exhausted org quota.
        this.retryable = status === 429 || (status >= 500 && status < 600);
    }
}

/** W3C traceparent, so a React render can be tied to a Salesforce API call. */
function traceparent() {
    const hex = (n) => Array.from(
        { length: n }, () => Math.floor(Math.random() * 16).toString(16)
    ).join('');
    return `00-${hex(32)}-${hex(16)}-01`;
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]   same-origin by default — cross-origin would
 *                                  reintroduce CORS and defeat HttpOnly cookies
 * @param {function} [opts.onQuota] called whenever the BFF reports quota
 *                                  pressure, so the app can degrade before it
 *                                  is hard-failed org-wide
 * @param {function} [opts.fetchImpl] injectable for tests
 */
export function createBffTransport({
    baseUrl = '/api/sf',
    onQuota,
    fetchImpl = (typeof fetch !== 'undefined' ? fetch : undefined)
} = {}) {
    if (!fetchImpl) {
        throw new Error('[salesforce-runtime] No fetch available; pass fetchImpl.');
    }

    async function call(path, { method = 'GET', body, signal } = {}) {
        const tp = traceparent();
        const res = await fetchImpl(`${baseUrl}${path}`, {
            method,
            signal,
            // The session cookie is HttpOnly and SameSite — JS cannot read it,
            // which is the entire point.
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                traceparent: tp
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        // Quota headers are advisory and set by the BFF from Salesforce's
        // Sforce-Limit-Info. Acting on them early is cheaper than a 403.
        const remaining = Number(res.headers.get('x-sf-api-remaining'));
        const limit = Number(res.headers.get('x-sf-api-limit'));
        const quota = Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0
            ? { remaining, limit, usedPct: 1 - remaining / limit }
            : undefined;
        if (quota && onQuota) onQuota(quota);

        if (!res.ok) {
            let parsed;
            try { parsed = await res.json(); } catch { parsed = await res.text().catch(() => null); }
            const quotaExhausted = res.status === 403
                && JSON.stringify(parsed || '').includes('REQUEST_LIMIT_EXCEEDED');
            throw new SalesforceTransportError(
                quotaExhausted
                    ? 'Salesforce API quota exhausted for the ORG — this affects every '
                      + 'integration on the org, not just this app.'
                    : `Salesforce request failed (${res.status})`,
                {
                    status: res.status,
                    body: parsed,
                    quota,
                    correlationId: res.headers.get('x-correlation-id') || tp
                }
            );
        }
        if (res.status === 204) return null;
        return res.json();
    }

    return {
        /** Intent-shaped, not query-shaped. */
        getRecord: ({ recordId, fields, optionalFields }, ctx = {}) => call(
            `/record/${encodeURIComponent(recordId)}`
                + `?fields=${encodeURIComponent((fields || []).join(','))}`
                + (optionalFields && optionalFields.length
                    ? `&optionalFields=${encodeURIComponent(optionalFields.join(','))}` : ''),
            { signal: ctx.signal }
        ),

        getRecords: ({ records }, ctx = {}) =>
            call('/records', { method: 'POST', body: { records }, signal: ctx.signal }),

        getObjectInfo: ({ objectApiName }, ctx = {}) =>
            call(`/object-info/${encodeURIComponent(objectApiName)}`, { signal: ctx.signal }),

        getPicklistValues: ({ recordTypeId, fieldApiName }, ctx = {}) =>
            call(`/picklist/${encodeURIComponent(recordTypeId)}/`
                + `${encodeURIComponent(String(fieldApiName))}`, { signal: ctx.signal }),

        /**
         * Named Apex operation. The BFF maps the name to a real endpoint —
         * @AuraEnabled methods are NOT reachable from outside Salesforce, so
         * something server-side has to bridge it. The client must not care
         * which bridge was used.
         */
        callApex: (name, params, ctx = {}) =>
            call(`/apex/${encodeURIComponent(name)}`,
                { method: 'POST', body: params ?? {}, signal: ctx.signal }),

        graphql: ({ query, variables }, ctx = {}) =>
            call('/graphql', { method: 'POST', body: { query, variables }, signal: ctx.signal }),

        /**
         * Batch hint. The BFF can fold these into a Composite request, where the
         * WHOLE composite counts as ONE API call against the org quota — the
         * main lever available, since adding ECS tasks adds none.
         */
        batch: (requests, ctx = {}) =>
            call('/composite', { method: 'POST', body: { requests }, signal: ctx.signal })
    };
}
