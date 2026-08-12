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

export function boundary(name, props, children, { base = false, as = 'div' } = {}) {
    const clean = {};
    for (const [k, v] of Object.entries(props || {})) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
    }
    const attrs = {
        'data-boundary': name,
        'data-props': JSON.stringify(clean)
    };
    if (base) attrs['data-base'] = '';
    // `as` matters: an inline base component inside a <p> must not emit a
    // <div> — that is invalid HTML and React warns about it. Found in the
    // preview on lwc-recipes/contactTile.
    return React.createElement(as, attrs, children);
}

export function slot(children) {
    return React.createElement('div', { 'data-slot': '' }, children);
}

/**
 * CSS text -> React style object.
 *
 * LWC accepts `style="width: 40%"` and, more importantly, a computed STRING:
 *   get style() { return `width: ${this.percentage}%`; }
 * React's `style` prop requires an object and throws on a string. The value is
 * only known at runtime, so the codemod cannot convert it statically — it
 * wraps every style binding in this instead. Found via lwc-recipes/chartBar.
 */
export function cssToStyle(css) {
    if (!css) return undefined;
    if (typeof css === 'object') return css;          // already a style object
    const out = {};
    for (const decl of String(css).split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim();
        const value = decl.slice(i + 1).trim();
        if (!prop || !value) continue;
        // custom properties keep their name; others become camelCase
        const key = prop.startsWith('--')
            ? prop
            : prop.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        out[key] = value;
    }
    return out;
}

/**
 * JSX-friendly form, used by GENERATED components to declare their own
 * boundary. Without it a generated component is invisible to the oracle —
 * its root normalises as whatever it happens to render first, and the diff
 * reports a bogus root mismatch against the LWC's `c-*` element.
 */
export function Boundary({ name, props, base, as, children }) {
    return boundary(name, props, children, { base: Boolean(base), as });
}
