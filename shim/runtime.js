import React from 'react';
import {
    QueryClient, QueryClientProvider, useQuery, useQueryClient
} from '@tanstack/react-query';
import { sfKey, sfQueryKeyHashFn, recordKeyPrefix, apexKeyPrefix } from './keys.js';

/**
 * @migration/salesforce-runtime — the LWC wire contract on TanStack Query.
 *
 * Design goal: the call site reads like the LWC it replaced, so the diff is
 * reviewable, and every divergence from LDS is an explicit flag rather than a
 * silent default.
 *
 * THE THREE DEFECTS THIS EXISTS TO PREVENT (research/08):
 *
 * F1 — "$param undefined" (the #1 naive-conversion defect).
 *      An LWC @wire does NOT fire while any reactive $param is undefined.
 *      useQuery WILL fire unless guarded. Every hook here computes `enabled`
 *      from its config and refuses to fetch on undefined params. The oracle's
 *      call-log diff checks exactly this.
 *
 * F-isLoading — the second-order form of the same bug.
 *      A DISABLED TanStack query reports status:'pending', fetchStatus:'idle'.
 *      So `isPending` is TRUE for a query that will never run, and a spinner
 *      keyed off it spins forever where the LWC rendered nothing. We expose
 *      `isLoading` (pending AND actually fetching) and never `isPending`.
 *
 * F3 — data/error are mutually exclusive in LWC.
 *      When a wire errors, `data` becomes undefined. TanStack keeps the last
 *      good data by default. We reproduce LWC parity unless the app opts into
 *      keepDataOnError.
 */

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export function createSalesforceQueryClient(config = {}) {
    return new QueryClient({
        defaultOptions: {
            queries: {
                // LDS does not retry reads behind your back; neither do we.
                retry: false,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: true,
                gcTime: 5 * 60 * 1000,
                staleTime: config.recordStaleTime ?? 30_000,
                structuralSharing: true,
                // Enforcement: generated code cannot invent a key shape.
                queryKeyHashFn: sfQueryKeyHashFn
            }
        }
    });
}

const RuntimeConfigContext = React.createContext({
    keepDataOnError: false,
    transport: null
});

export function SalesforceRuntimeProvider({
    transport, children, client, ...config
}) {
    const qc = React.useMemo(
        () => client || createSalesforceQueryClient(config),
        [client] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const value = React.useMemo(
        () => ({ transport, keepDataOnError: config.keepDataOnError ?? false }),
        [transport, config.keepDataOnError]
    );
    return React.createElement(
        QueryClientProvider, { client: qc },
        React.createElement(RuntimeConfigContext.Provider, { value }, children)
    );
}

export const useRuntimeConfig = () => React.useContext(RuntimeConfigContext);

/* ------------------------------------------------------------------ *
 * Core hook
 * ------------------------------------------------------------------ */

/** True when every reactive param is defined. F1. */
export function allParamsDefined(params) {
    return Object.values(params).every((v) => v !== undefined);
}

/**
 * The single place a query is issued. Every adapter below funnels through it,
 * so the enabled-guard cannot be forgotten in one hook and remembered in
 * another.
 */
function useWire(key, fetcher, reactiveParams, options = {}) {
    const cfg = useRuntimeConfig();
    // F1: an LWC wire does not fire while a reactive param is undefined.
    const enabled = allParamsDefined(reactiveParams);

    const q = useQuery({
        queryKey: key,
        queryFn: () => fetcher(),
        enabled,
        staleTime: options.staleTime,
        retry: false
    });

    const keepDataOnError = options.keepDataOnError ?? cfg.keepDataOnError;

    return {
        // F3: LWC clears data when an error is current.
        data: q.error && !keepDataOnError ? undefined : q.data,
        error: q.error || undefined,
        // NOT isPending — see the header. A disabled query is pending forever.
        isLoading: q.isLoading,
        enabled,
        query: q,
        handle: { queryKey: key, refetch: async () => { await q.refetch(); } }
    };
}

/* ------------------------------------------------------------------ *
 * LDS read adapters
 * ------------------------------------------------------------------ */

export function useRecord({ recordId, fields, optionalFields }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('record', recordId ?? '(undefined)', 'get', { fields, optionalFields });
    return useWire(
        key,
        () => transport.getRecord({ recordId, fields, optionalFields }),
        { recordId, fields }
    );
}

export function useObjectInfo({ objectApiName }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('objectInfo', objectApiName ?? '(undefined)', 'describe', {});
    return useWire(key, () => transport.getObjectInfo({ objectApiName }), { objectApiName });
}

export function usePicklistValues({ recordTypeId, fieldApiName }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('picklist', String(fieldApiName ?? '(undefined)'), 'get', { recordTypeId });
    return useWire(
        key,
        () => transport.getPicklistValues({ recordTypeId, fieldApiName }),
        { recordTypeId, fieldApiName }
    );
}

/* ------------------------------------------------------------------ *
 * Apex
 * ------------------------------------------------------------------ */

/**
 * Mirrors @wire(apexMethod, {a: '$a'}).
 * `params === undefined` means the config itself is unresolved -> never fires.
 */
export function useApex(method, params, options = {}) {
    const { transport } = useRuntimeConfig();
    const name = method.name || String(method);
    const key = sfKey('apex', name, 'get', params ?? {});
    return useWire(
        key,
        () => transport.callApex(name, params),
        params === undefined ? { __config: undefined } : params,
        { staleTime: options.staleTime ?? 30_000, keepDataOnError: options.keepDataOnError }
    );
}

/** Imperative Apex. Not cached, never a query — mirrors a direct import call. */
export async function callApex(transport, method, params) {
    return transport.callApex(method.name || String(method), params);
}

/* ------------------------------------------------------------------ *
 * Invalidation — the three LWC mechanisms kept deliberately separate
 * ------------------------------------------------------------------ */

export function useRefreshApex() {
    const qc = useQueryClient();
    // refreshApex binds to ONE wire instance's config, not to a record id.
    return React.useCallback(
        (handle) => qc.invalidateQueries({ queryKey: handle.queryKey, exact: true }),
        [qc]
    );
}

export function useNotifyRecordUpdateAvailable() {
    const qc = useQueryClient();
    // App-wide, by record id, and it actually refetches.
    return React.useCallback(
        (recordIds) => Promise.all(
            recordIds.map((id) =>
                qc.invalidateQueries({ queryKey: recordKeyPrefix(id), refetchType: 'active' }))
        ),
        [qc]
    );
}

export function useInvalidateApex() {
    const qc = useQueryClient();
    return React.useCallback(
        (methodName) => qc.invalidateQueries({ queryKey: apexKeyPrefix(methodName) }),
        [qc]
    );
}

/* ------------------------------------------------------------------ *
 * Field access — where [object Object] comes from
 * ------------------------------------------------------------------ */

/**
 * LWC's getFieldValue. The LDS payload is NESTED:
 *   record.fields.Name.value        — NOT record.Name
 * Reading the wrong level renders "[object Object]" for every field. This is
 * the exact bug that broke Salesforce's own Aura->LWC agent.
 *
 * Supports spanning fields: 'Account.Owner.Name' walks
 *   fields.Account.value.fields.Owner.value.fields.Name.value
 */
export function getFieldValue(record, fieldRef) {
    if (!record) return undefined;
    const pathStr = typeof fieldRef === 'string'
        ? fieldRef
        : `${fieldRef.objectApiName}.${fieldRef.fieldApiName}`;
    const parts = pathStr.split('.');
    // Drop a leading object api name (Property__c.Name -> Name).
    if (parts.length > 1 && record.apiName === parts[0]) parts.shift();

    let node = record;
    for (let i = 0; i < parts.length; i++) {
        if (!node || !node.fields) return undefined;
        const f = node.fields[parts[i]];
        if (f === undefined) return undefined;
        if (i === parts.length - 1) return f.value;
        node = f.value;   // spanning: the value is itself a record
    }
    return undefined;
}

export function getFieldDisplayValue(record, fieldRef) {
    if (!record) return undefined;
    const pathStr = typeof fieldRef === 'string'
        ? fieldRef
        : `${fieldRef.objectApiName}.${fieldRef.fieldApiName}`;
    const parts = pathStr.split('.');
    if (parts.length > 1 && record.apiName === parts[0]) parts.shift();
    let node = record;
    for (let i = 0; i < parts.length; i++) {
        if (!node || !node.fields) return undefined;
        const f = node.fields[parts[i]];
        if (f === undefined) return undefined;
        if (i === parts.length - 1) return f.displayValue;
        node = f.value;
    }
    return undefined;
}

/* ================================================================== *
 * Platform module shims
 *
 * catalog/platform-modules.xml marks a module `status="shim"` to mean "a React
 * equivalent exists in @migration/salesforce-runtime". For 18 of the 25
 * declared names that was simply untrue — the codemod emitted
 * `import { useToast } from '@migration/salesforce-runtime'` and the browser
 * answered "does not provide an export named 'useToast'". Seven of twenty
 * components on the first real org died on that one line, and nothing in the
 * test suite noticed, because the codemod's only question is "does the catalog
 * say shim?".
 *
 * shim/contract.test.js now checks the two files against each other. Adding a
 * `status="shim"` row without the export here fails that test.
 *
 * Fidelity is stated per-shim below. Where a faithful equivalent does not
 * exist off-platform the honest answer is an `escalate` row in the catalog,
 * not a convincing-looking stub — lightning/modal was reclassified for exactly
 * that reason rather than given a fake `Modal`.
 * ================================================================== */

/* ---------------------------- navigation ---------------------------- */

/**
 * NavigationMixin.Navigate / .GenerateUrl.
 *
 * A PageReference is Salesforce's routing vocabulary and has no off-platform
 * meaning, so the app must supply the mapping. Provide `navigate` on the
 * provider's transport-adjacent config and it receives the PageReference
 * verbatim; the default resolver handles the two shapes that survive a
 * migration (a webPage URL, and a record page under a configurable base) and
 * REFUSES the rest rather than silently navigating somewhere wrong.
 */
const NavigationContext = React.createContext(null);

export function NavigationProvider({ navigate, recordBasePath = '/records', children }) {
    const value = React.useMemo(
        () => ({ navigate, recordBasePath }),
        [navigate, recordBasePath]
    );
    return React.createElement(NavigationContext.Provider, { value }, children);
}

function defaultResolveUrl(pageRef, recordBasePath) {
    if (!pageRef || typeof pageRef !== 'object') return null;
    const { type, attributes = {}, state } = pageRef;
    const qs = state && Object.keys(state).length
        ? '?' + new URLSearchParams(state).toString()
        : '';
    if (type === 'standard__webPage') return (attributes.url || '') + qs;
    if (type === 'standard__recordPage' && attributes.recordId) {
        return `${recordBasePath}/${attributes.recordId}${qs}`;
    }
    // standard__objectPage, standard__navItemPage, comm__namedPage and the
    // rest depend on the target app's routes. Guessing produces a dead link
    // that looks like it works.
    return null;
}

export function useNavigation() {
    const ctx = React.useContext(NavigationContext);
    const recordBasePath = ctx ? ctx.recordBasePath : '/records';

    const generateUrl = React.useCallback(
        (pageRef) => defaultResolveUrl(pageRef, recordBasePath),
        [recordBasePath]
    );

    const navigate = React.useCallback((pageRef, replace = false) => {
        if (ctx && ctx.navigate) return ctx.navigate(pageRef, { replace });
        const url = defaultResolveUrl(pageRef, recordBasePath);
        if (url == null) {
            // Loud on purpose. A silent no-op here reads as "the button is
            // broken" during review, with no clue that routing was never wired.
            // eslint-disable-next-line no-console
            console.warn('[salesforce-runtime] no route for PageReference '
                + `type "${pageRef && pageRef.type}". Pass navigate= to `
                + 'NavigationProvider to handle it.');
            return undefined;
        }
        if (typeof window !== 'undefined') {
            if (replace) window.location.replace(url); else window.location.assign(url);
        }
        return undefined;
    }, [ctx, recordBasePath]);

    return React.useMemo(
        () => ({ navigate, generateUrl, Navigate: navigate, GenerateUrl: generateUrl }),
        [navigate, generateUrl]
    );
}

/* ------------------------------ toasts ------------------------------ */

/**
 * ShowToastEvent.
 *
 * In LWC the event bubbles to the Lightning host, which always exists. Here
 * the host is the app: without a ToastProvider the toast is a NO-OP, which is
 * a real behaviour difference and is recorded in the catalog note.
 */
const ToastContext = React.createContext(null);

export function ToastProvider({ onToast, children }) {
    const [toasts, setToasts] = React.useState([]);
    const seq = React.useRef(0);

    const show = React.useCallback((toast) => {
        if (onToast) return onToast(toast);
        seq.current += 1;
        const id = seq.current;
        setToasts((cur) => [...cur, { ...toast, id }]);
        const ms = toast.mode === 'sticky' ? 0 : 5000;
        if (ms) setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), ms);
        return undefined;
    }, [onToast]);

    const value = React.useMemo(() => ({ show, toasts }), [show, toasts]);
    return React.createElement(ToastContext.Provider, { value }, children);
}

export function useToast() {
    const ctx = React.useContext(ToastContext);
    return React.useCallback((toast) => {
        if (ctx) return ctx.show(toast);
        // eslint-disable-next-line no-console
        console.warn('[salesforce-runtime] toast dropped (no ToastProvider): '
            + (toast && toast.title));
        return undefined;
    }, [ctx]);
}

/** Read the queue to render toasts yourself. Empty without a provider. */
export function useToasts() {
    const ctx = React.useContext(ToastContext);
    return ctx ? ctx.toasts : [];
}

/* -------------------- alert / confirm / prompt ---------------------- */

/*
 * LightningAlert.open({message, label, theme}) resolves when dismissed;
 * LightningConfirm resolves to a boolean; LightningPrompt to the string or
 * null. The native dialogs match those contracts exactly, which is why they
 * are used here — the visible difference is styling and that the native ones
 * block the tab. Swap in a component dialog before shipping if that matters.
 */
export async function alert({ message } = {}) {
    if (typeof window !== 'undefined' && window.alert) window.alert(message);
    return undefined;
}

export async function confirm({ message } = {}) {
    if (typeof window !== 'undefined' && window.confirm) return window.confirm(message);
    return false;
}

export async function prompt({ message, defaultValue = '' } = {}) {
    if (typeof window !== 'undefined' && window.prompt) return window.prompt(message, defaultValue);
    return null;
}

/* ------------------------------ logger ------------------------------ */

/**
 * lightning/logger writes to Event Monitoring. There is no off-platform
 * equivalent, so this forwards to the console and to an optional sink. Log
 * VOLUME is unchanged, which matters: a component logging per keystroke will
 * do the same here.
 */
let logSink = null;
export function setLogSink(fn) { logSink = fn; }
export const logger = {
    log(payload) {
        if (logSink) return logSink(payload);
        // eslint-disable-next-line no-console
        console.info('[lightning/logger]', payload);
        return undefined;
    }
};

/* ------------------------ pageReferenceUtils ------------------------ */

/*
 * Pure string codecs, identical to the platform's — defaultFieldValues is a
 * comma-separated list of Field=Value with commas and equals percent-encoded
 * inside the value.
 */
export function encodeDefaultFieldValues(obj) {
    return Object.entries(obj || {})
        .map(([k, v]) => `${k}=${encodeURIComponent(v == null ? '' : String(v))}`)
        .join(',');
}

export function decodeDefaultFieldValues(str) {
    const out = {};
    for (const pair of String(str || '').split(',')) {
        if (!pair) continue;
        const i = pair.indexOf('=');
        if (i < 0) continue;
        out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    }
    return out;
}

/* --------------------------- uiRecordApi DML ------------------------ */

/*
 * createRecord / updateRecord / deleteRecord are IMPERATIVE in LWC — plain
 * promises, not wires — so they are plain functions here too, taking the
 * transport explicitly. They are not hooks: making them hooks would change
 * where they may be called and break conditional use.
 *
 * They do NOT invalidate anything on their own. Neither does LDS, which
 * refreshes only the records it can identify; use useNotifyRecordUpdateAvailable.
 */
export function createRecord(transport, recordInput) {
    return transport.createRecord(recordInput);
}

export function updateRecord(transport, recordInput) {
    return transport.updateRecord(recordInput);
}

export function deleteRecord(transport, recordId) {
    return transport.deleteRecord(recordId);
}

/** Hook form, so a generated component can call DML without threading transport. */
export function useRecordMutations() {
    const { transport } = useRuntimeConfig();
    return React.useMemo(() => ({
        createRecord: (r) => createRecord(transport, r),
        updateRecord: (r) => updateRecord(transport, r),
        deleteRecord: (id) => deleteRecord(transport, id)
    }), [transport]);
}

/* ----------------------- picklists by record type ------------------- */

export function usePicklistValuesByRecordType({ objectApiName, recordTypeId }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('picklist', String(objectApiName ?? '(undefined)'),
        'byRecordType', { recordTypeId });
    return useWire(
        key,
        () => transport.getPicklistValuesByRecordType({ objectApiName, recordTypeId }),
        { objectApiName, recordTypeId }
    );
}

/* -------------------------------- list UI --------------------------- */

export function useListUi({ objectApiName, listViewApiName, pageSize, sortBy }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('listUi', `${objectApiName ?? '(undefined)'}.${listViewApiName ?? '(undefined)'}`,
        'get', { pageSize, sortBy });
    return useWire(
        key,
        () => transport.getListUi({ objectApiName, listViewApiName, pageSize, sortBy }),
        { objectApiName, listViewApiName }
    );
}

export function useListInfo({ objectApiName, listViewApiName }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('listUi', `${objectApiName ?? '(undefined)'}.${listViewApiName ?? '(undefined)'}`,
        'info', {});
    return useWire(
        key,
        () => transport.getListInfoByName({ objectApiName, listViewApiName }),
        { objectApiName, listViewApiName }
    );
}

/* -------------------------------- GraphQL --------------------------- */

/**
 * lightning/graphql's gql is a passthrough template tag — it returns the query
 * TEXT, it does not parse. Reproduced exactly, so a query written for the
 * platform is byte-identical here.
 *
 * The RESPONSE SHAPE is UI API's, not a generic GraphQL server's: fields come
 * back as {value, displayValue}. Point the transport at something that speaks
 * that, or rewrite the selection sets.
 */
export function gql(strings, ...values) {
    return strings.reduce((acc, s, i) => acc + s + (i < values.length ? values[i] : ''), '');
}

export function useGraphQL({ query, variables }) {
    const { transport } = useRuntimeConfig();
    const key = sfKey('graphql', String(query ?? '(undefined)'), 'query', variables ?? {});
    return useWire(key, () => transport.graphql({ query, variables }), { query });
}

/* ---------------------------- messageService ------------------------ */

/**
 * Lightning Message Service, in-app only.
 *
 * LMS crosses LWC / Aura / Visualforce inside one Lightning page. Off-platform
 * there is nothing to cross to, so this is a same-bundle event bus. Anything
 * relying on reaching a Visualforce page is not migrated by this.
 *
 * `scope` is ignored: APPLICATION_SCOPE vs active-tab has no meaning without
 * the Lightning console.
 */
const messageBus = new Map();

export function useMessageChannel(channel, onMessage) {
    const name = typeof channel === 'string' ? channel : (channel && channel.name) || String(channel);
    const cb = React.useRef(onMessage);
    cb.current = onMessage;

    React.useEffect(() => {
        if (!onMessage) return undefined;
        const set = messageBus.get(name) || new Set();
        const handler = (msg) => cb.current && cb.current(msg);
        set.add(handler);
        messageBus.set(name, set);
        return () => { set.delete(handler); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, Boolean(onMessage)]);

    return React.useCallback((message) => {
        const set = messageBus.get(name);
        if (set) set.forEach((fn) => fn(message));
    }, [name]);
}
