/**
 * Shim tests.
 *
 * These are FROZEN TESTS (CLAUDE.md rule 2): they encode the LWC wire
 * contract. Never edit one to make a generated component pass — if a
 * migration fails here, the migration is wrong, not the test.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
    SalesforceRuntimeProvider, createSalesforceQueryClient,
    useRecord, useApex, getFieldValue, getFieldDisplayValue, allParamsDefined
} from './runtime.js';
import { sfKey, isSfKey, sfQueryKeyHashFn } from './keys.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RECORD = {
    id: 'a01', apiName: 'Property__c',
    fields: {
        Name: { value: 'Ocean View Estate', displayValue: null },
        Price__c: { value: 1250000, displayValue: '$1,250,000' },
        Broker__r: {
            value: {
                id: '003', apiName: 'Contact',
                fields: { Name: { value: 'Jane Ortiz', displayValue: null } }
            },
            displayValue: null
        }
    }
};

function makeTransport() {
    const calls = [];
    return {
        calls,
        getRecord: (cfg) => { calls.push({ kind: 'getRecord', cfg }); return Promise.resolve(RECORD); },
        callApex: (name, params) => { calls.push({ kind: 'apex', name, params }); return Promise.resolve([{ Id: '1' }]); },
        getObjectInfo: () => Promise.resolve({}),
        getPicklistValues: () => Promise.resolve({})
    };
}

const roots = [];

/** Let pending query promises resolve and React re-render. */
const settle = async (n = 3) => {
    for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
};

async function renderHook(useHook, { transport, ...cfg } = {}) {
    const seen = { current: null };
    function Probe() {
        seen.current = useHook();
        return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const client = createSalesforceQueryClient(cfg);
    await act(async () => {
        root.render(React.createElement(
            SalesforceRuntimeProvider,
            { transport, client, ...cfg },
            React.createElement(Probe)
        ));
    });
    await settle();
    return seen;
}

afterEach(async () => {
    await act(async () => { roots.forEach((r) => r.unmount()); });
    roots.length = 0;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('SHIM — F1: undefined reactive param must issue ZERO calls', () => {
    it('useRecord does NOT fetch while recordId is undefined', async () => {
        // THE #1 naive-conversion defect. An LWC @wire stays silent; useQuery
        // would fire. If this test ever passes with calls.length > 0, every
        // generated component is making unauthorised requests on mount.
        const t = makeTransport();
        const h = await renderHook(() => useRecord({ recordId: undefined, fields: ['Property__c.Name'] }), { transport: t });
        expect(t.calls).toHaveLength(0);
        expect(h.current.enabled).toBe(false);
        expect(h.current.data).toBeUndefined();
    });

    it('useRecord DOES fetch once recordId is defined', async () => {
        const t = makeTransport();
        const h = await renderHook(() => useRecord({ recordId: 'a01', fields: ['Property__c.Name'] }), { transport: t });
        expect(t.calls).toHaveLength(1);
        expect(h.current.enabled).toBe(true);
        expect(h.current.data).toEqual(RECORD);
    });

    it('useApex does NOT fetch while a param is undefined', async () => {
        const t = makeTransport();
        const fn = { name: 'AccountController.getAccounts' };
        await renderHook(() => useApex(fn, { propertyId: undefined }), { transport: t });
        expect(t.calls).toHaveLength(0);
    });

    it('useApex treats an undefined config object as never-fires', async () => {
        const t = makeTransport();
        const fn = { name: 'AccountController.getAccounts' };
        await renderHook(() => useApex(fn, undefined), { transport: t });
        expect(t.calls).toHaveLength(0);
    });

    it('allParamsDefined is the single guard everything funnels through', () => {
        expect(allParamsDefined({ a: 1, b: 'x' })).toBe(true);
        expect(allParamsDefined({ a: 1, b: undefined })).toBe(false);
        expect(allParamsDefined({})).toBe(true);
        expect(allParamsDefined({ a: null })).toBe(true);  // null is a VALUE
    });
});

describe('SHIM — the isPending trap', () => {
    it('a disabled query is NOT isLoading (it would spin forever)', async () => {
        // A disabled TanStack query reports status:'pending'/fetchStatus:'idle'.
        // Generated code keying a spinner off isPending hangs forever where
        // the LWC rendered nothing. isLoading is the correct signal.
        const t = makeTransport();
        const h = await renderHook(() => useRecord({ recordId: undefined, fields: ['x'] }), { transport: t });
        expect(h.current.isLoading).toBe(false);
        expect(h.current.query.isPending).toBe(true);   // the trap, documented
        expect(h.current.query.fetchStatus).toBe('idle');
    });
});

describe('SHIM — F3: data and error are mutually exclusive (LWC parity)', () => {
    it('clears data when an error is current', async () => {
        const t = makeTransport();
        let fail = false;
        t.getRecord = () => (fail
            ? Promise.reject(Object.assign(new Error('boom'), { status: 404 }))
            : Promise.resolve(RECORD));

        const h = await renderHook(() => useRecord({ recordId: 'a01', fields: ['x'] }), { transport: t });
        expect(h.current.data).toEqual(RECORD);

        fail = true;
        await act(async () => { await h.current.handle.refetch(); });
        await settle();
        expect(h.current.error).toBeDefined();
        expect(h.current.data).toBeUndefined();          // LWC parity
    });

    it('keepDataOnError is an explicit opt-in divergence, not a default', async () => {
        const t = makeTransport();
        let fail = false;
        t.getRecord = () => (fail
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(RECORD));

        const h = await renderHook(
            () => useRecord({ recordId: 'a01', fields: ['x'] }),
            { transport: t, keepDataOnError: true }
        );
        fail = true;
        await act(async () => { await h.current.handle.refetch(); });
        await settle();
        expect(h.current.error).toBeDefined();
        expect(h.current.data).toEqual(RECORD);          // deliberately diverges
    });
});

describe('SHIM — query keys are the public API', () => {
    it('sfKey builds the documented grammar', () => {
        const k = sfKey('record', 'a01', 'get', { fields: ['Name'] });
        expect(k[0]).toBe('sf');
        expect(k[1]).toBe('record');
        expect(isSfKey(k)).toBe(true);
    });

    it('rejects an unknown domain instead of inventing one', () => {
        expect(() => sfKey('nonsense', 'x', 'get', {})).toThrow(/Unknown query-key domain/);
    });

    it('hashes param order deterministically', () => {
        const a = sfQueryKeyHashFn(sfKey('apex', 'C.m', 'get', { a: 1, b: 2 }));
        const b = sfQueryKeyHashFn(sfKey('apex', 'C.m', 'get', { b: 2, a: 1 }));
        expect(a).toBe(b);
    });

    it('THROWS on an unbranded key — generated code cannot use raw useQuery', () => {
        // ESLint can be disabled per line. A runtime throw cannot.
        expect(() => sfQueryKeyHashFn(['accounts', 'list'])).toThrow(/Unbranded query key/);
        expect(() => sfQueryKeyHashFn(['sf', 'record'])).toThrow(/Unbranded query key/);
    });
});

describe('SHIM — getFieldValue: the [object Object] guard', () => {
    it('reads the NESTED LDS shape', () => {
        expect(getFieldValue(RECORD, 'Property__c.Name')).toBe('Ocean View Estate');
        expect(getFieldValue(RECORD, 'Price__c')).toBe(1250000);
        expect(getFieldDisplayValue(RECORD, 'Price__c')).toBe('$1,250,000');
    });

    it('walks spanning fields through nested records', () => {
        expect(getFieldValue(RECORD, 'Broker__r.Name')).toBe('Jane Ortiz');
    });

    it('returns undefined for a path that does not exist', () => {
        expect(getFieldValue(RECORD, 'Nope')).toBeUndefined();
        // A FLAT fixture yields undefined, which is why fixtures must use the
        // real nested shape (CLAUDE.md rule 6) — a flat one silently blinds
        // the oracle instead of failing.
        expect(getFieldValue({ Name: 'flat' }, 'Name')).toBeUndefined();
    });

    it('DOES return a record object for a relationship field — matching LWC', () => {
        // This is where [object Object] actually comes from, and the shim must
        // NOT paper over it: LWC's getFieldValue returns the nested record for
        // a relationship, so a component that renders it directly prints
        // "[object Object]". That is a component defect, and catching it is the
        // oracle's text diff's job — not something the shim should silently
        // coerce away, which would hide the bug rather than surface it.
        const rel = getFieldValue(RECORD, 'Broker__r');
        expect(typeof rel).toBe('object');
        expect(String(rel)).toBe('[object Object]');
        expect(getFieldValue(RECORD, 'Broker__r.Name')).toBe('Jane Ortiz');
    });

    it('accepts a schema-style field reference object', () => {
        expect(getFieldValue(RECORD, { objectApiName: 'Property__c', fieldApiName: 'Name' }))
            .toBe('Ocean View Estate');
    });
});
