import React from 'react';

/**
 * Boundary markers for the oracle.
 *
 * React erases the information the oracle needs: after render there is no
 * component name in the DOM, and no shadow root separating "what this
 * component drew" from "what was handed to it". LWC gives both for free.
 * So the shim declares them.
 *
 *   data-boundary="Card"  canonical component name  (matches catalog/)
 *   data-props='{...}'    public props, JSON
 *   data-base             BASE component — its internals are opaque, exactly
 *                         as a lightning-* stub's shadow output is
 *   data-slot             content passed in by the caller starts here
 *
 * These are inert in production: no behaviour, no styling. They exist so the
 * SAME normaliser can walk an LWC tree and a React tree. If you strip them,
 * the oracle stops seeing boundaries — it does not silently half-work.
 */

export function boundary(name, props, children, { base = false } = {}) {
    const clean = {};
    for (const [k, v] of Object.entries(props || {})) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
    }
    const attrs = {
        'data-boundary': name,
        'data-props': JSON.stringify(clean)
    };
    if (base) attrs['data-base'] = '';
    return React.createElement('div', attrs, children);
}

export function slot(children) {
    return React.createElement('div', { 'data-slot': '' }, children);
}

/**
 * JSX-friendly form, used by GENERATED components to declare their own
 * boundary. Without it a generated component is invisible to the oracle —
 * its root normalises as whatever it happens to render first, and the diff
 * reports a bogus root mismatch against the LWC's `c-*` element.
 */
export function Boundary({ name, props, base, children }) {
    return boundary(name, props, children, { base: Boolean(base) });
}
