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
