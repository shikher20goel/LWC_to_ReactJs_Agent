/**
 * Query-key factory for @migration/salesforce-runtime.
 *
 * Query keys ARE the public API of the cache. If machine-generated components
 * can invent their own, invalidation silently stops working and nothing fails
 * loudly — the app just serves stale data. So keys are constructed here or
 * not at all.
 *
 * Grammar (research/08 §2.3):
 *   ['sf', domain, entity, operation, params]
 *    ^      ^       ^       ^          ^
 *    |      |       |       |          unordered params, deterministically hashed
 *    |      |       |       operation — 'get' | 'list' | 'describe' | ...
 *    |      |       entity — sObject / Apex class.method
 *    |      domain — 'record' | 'apex' | 'objectInfo' | 'picklist' | 'graphql'
 *    brand
 *
 * ORDERED segments live in array positions (order is meaningful for prefix
 * invalidation). UNORDERED params live in the trailing object, which is
 * hashed with sorted keys so {a:1,b:2} and {b:2,a:1} are the same key.
 */

export const KEY_BRAND = 'sf';

export const DOMAINS = new Set([
    'record', 'records', 'relatedList', 'objectInfo', 'picklist', 'graphql', 'apex'
]);

/** Deterministic stringify — key order must not affect the hash. */
function stable(value) {
    if (value === undefined) return '__undefined__';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

export function sfKey(domain, entity, operation, params = {}) {
    if (!DOMAINS.has(domain)) {
        throw new Error(
            `[salesforce-runtime] Unknown query-key domain "${domain}". `
            + `Expected one of: ${[...DOMAINS].join(', ')}. `
            + 'Generated code must not invent domains — add it to keys.js deliberately.'
        );
    }
    return [KEY_BRAND, domain, entity, operation, params];
}

export function isSfKey(key) {
    return Array.isArray(key)
        && key.length === 5
        && key[0] === KEY_BRAND
        && DOMAINS.has(key[1]);
}

/**
 * queryKeyHashFn for the locked-down client.
 *
 * Throws on any key not built by sfKey(). This is the load-bearing
 * enforcement layer — ESLint can be disabled per-line, a runtime throw
 * cannot. Generated components that reach for useQuery directly fail
 * immediately and loudly instead of quietly missing invalidation.
 */
export function sfQueryKeyHashFn(key) {
    if (!isSfKey(key)) {
        throw new Error(
            '[salesforce-runtime] Unbranded query key: ' + JSON.stringify(key) + '\n'
            + 'Keys must come from sfKey(domain, entity, operation, params). '
            + 'Generated components must never call useQuery directly — use the '
            + 'useRecord / useApex hooks, which own key construction.'
        );
    }
    return stable(key);
}

/** Prefix for invalidating everything about one record id. */
export const recordKeyPrefix = (recordId) => [KEY_BRAND, 'record', recordId];

/** Prefix for invalidating one Apex method regardless of params. */
export const apexKeyPrefix = (methodName) => [KEY_BRAND, 'apex', methodName];
