/**
 * Oracle normaliser — canonical component-boundary tree from a rendered
 * component root, suitable for structural diffing.
 *
 * ONE tree-builder, TWO adapters. This is the load-bearing design decision:
 * if the LWC side and the React side each had their own serialiser, any diff
 * could be an artifact of the serialiser rather than of the component, and the
 * oracle would prove nothing. `build()` below is shared verbatim. An adapter
 * only answers four questions about a DOM node:
 *
 *   isBoundary(n)   is this a component boundary we care about?
 *   isOpaque(n)     is it a component whose OWN internals must not be diffed?
 *                   (LWC: a lightning-* stub. React: a shim base component.)
 *   canonicalName / readProps
 *   children(n)     each tagged own:true  = rendered BY this component
 *                                own:false = content passed INTO it
 *
 * S-1 spike findings encoded here:
 *  F1  lightning-* props are JS PROPERTIES, not attributes. Read by name from
 *      the catalog — the stub prototype does not expose the public API.
 *  F2  lightning-* stubs have a shadowRoot containing only <slot> elements.
 *      Slotted content lives in light DOM. Traverse BOTH.
 *  F3  Child c-* components render for real. Only lightning-* are stubbed.
 *  F4  Suppress content rendered BY a base component; KEEP content slotted
 *      into it. Getting this wrong disables [object Object] detection.
 */

// Stand-in for catalog/base-components.xml. Replace with a catalog loader.
const CATALOG = {
    'lightning-card': { canonical: 'Card', props: ['title', 'iconName', 'variant'] },
    'lightning-button': {
        canonical: 'Button',
        props: ['label', 'variant', 'iconName', 'disabled', 'type']
    },
    'lightning-formatted-number': {
        canonical: 'FormattedNumber',
        props: ['value', 'formatStyle', 'currencyCode', 'minimumFractionDigits']
    },
    'lightning-formatted-text': { canonical: 'FormattedText', props: ['value'] }
};

const isBaseComponent = (tag) => tag.startsWith('lightning-');
const isCustomComponent = (tag) => tag.startsWith('c-');

function pascal(tag) {
    return tag.replace(/^c-/, '').split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function canonicalNameFor(tag) {
    if (CATALOG[tag]) return CATALOG[tag].canonical;
    if (isCustomComponent(tag)) return pascal(tag);
    return tag;
}

// Drop props that carry no signal, so both sides agree on what "absent" means.
function pruneProps(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Adapter: LWC
 * ------------------------------------------------------------------ */

// F1: read declared props off the element, by name.
function readLwcProps(node, tag) {
    const entry = CATALOG[tag];
    if (entry) {
        const out = {};
        entry.props.forEach((p) => { out[p] = node[p]; });
        return pruneProps(out);
    }
    const out = {};
    Object.keys(node).forEach((k) => {
        if (k.startsWith('_') || typeof node[k] === 'function') return;
        out[k] = node[k];
    });
    return pruneProps(out);
}

export const lwcAdapter = {
    name: 'lwc',
    isTransparent: (n) => n.tagName.toLowerCase() === 'slot',
    isBoundary: (n) => {
        const t = n.tagName.toLowerCase();
        return isBaseComponent(t) || isCustomComponent(t);
    },
    isOpaque: (n) => isBaseComponent(n.tagName.toLowerCase()),
    canonicalName: (n) => canonicalNameFor(n.tagName.toLowerCase()),
    readProps: (n) => readLwcProps(n, n.tagName.toLowerCase()),
    // F2: walk shadow root AND light DOM, tracking provenance.
    children: (n) => {
        const seen = new Set();
        const out = [];
        if (n.shadowRoot) {
            for (const k of n.shadowRoot.children) {
                seen.add(k);
                out.push({ el: k, own: true });    // rendered BY this component
            }
        }
        for (const k of n.children || []) {
            if (!seen.has(k)) out.push({ el: k, own: false }); // slotted INTO it
        }
        return out;
    }
};

/* ------------------------------------------------------------------ *
 * Adapter: React
 *
 * React has no custom-element tags and no shadow roots, so boundaries and
 * provenance have to be declared by the shim instead of inferred:
 *   data-boundary="Card"   this node is a boundary with that canonical name
 *   data-props='{...}'     its public props, JSON
 *   data-base              it is a BASE component — internals are opaque
 *   data-slot              content passed into the component starts here
 * See shim/boundary.js. Nothing else in the React tree is special-cased.
 * ------------------------------------------------------------------ */

const attr = (n, name) => (n.getAttribute ? n.getAttribute(name) : null);
const has = (n, name) => Boolean(n.hasAttribute && n.hasAttribute(name));

export const reactAdapter = {
    name: 'react',
    isTransparent: (n) => has(n, 'data-slot'),
    isBoundary: (n) => has(n, 'data-boundary'),
    isOpaque: (n) => has(n, 'data-base'),
    canonicalName: (n) => attr(n, 'data-boundary'),
    readProps: (n) => {
        const raw = attr(n, 'data-props');
        if (!raw) return {};
        return pruneProps(JSON.parse(raw));
    },
    // Everything a React component renders is its own output until a
    // data-slot marker hands provenance back to the caller.
    children: (n) => [...(n.children || [])].map((el) => ({ el, own: true }))
};

/* ------------------------------------------------------------------ *
 * Shared tree builder — identical for both sides.
 * ------------------------------------------------------------------ */

const STRUCTURAL_ATTRS = ['role', 'aria-label', 'aria-labelledby',
    'aria-describedby', 'aria-live', 'aria-hidden', 'type', 'href', 'alt', 'name'];

function build(node, opts, A) {
    // A slot hands provenance back: what flows through it is the caller's.
    if (A.isTransparent(node)) {
        return A.children(node)
            .flatMap((c) => build(c.el, { ...opts, insideOwn: false }, A))
            .filter(Boolean);
    }

    // F4: a base component's own internals are opaque. Emit nothing for them,
    // but keep descending so any slot marker underneath still surfaces.
    if (opts.insideOwn) {
        return A.children(node)
            .flatMap((c) => build(c.el, opts, A))
            .filter(Boolean);
    }

    const boundary = A.isBoundary(node);
    const opaque = A.isOpaque(node);

    const kids = A.children(node)
        .flatMap((c) => build(c.el, {
            ...opts,
            insideOwn: opaque ? c.own : opts.insideOwn
        }, A))
        .filter(Boolean);

    let text;
    if (!opaque && kids.length === 0) {
        const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) text = t;
    }

    const attrs = {};
    for (const a of node.attributes || []) {
        if (STRUCTURAL_ATTRS.includes(a.name)) attrs[a.name] = a.value;
    }

    const out = {
        tag: boundary ? A.canonicalName(node) : node.tagName.toLowerCase(),
        boundary,
        ...(boundary ? { props: A.readProps(node) } : {}),
        ...(Object.keys(attrs).length ? { attrs } : {}),
        ...(text ? { text } : {}),
        ...(kids.length ? { children: kids } : {})
    };

    // Collapse pure layout wrappers. This is what lets a React tree with
    // different div nesting still match the LWC tree.
    if (!boundary && !text && !Object.keys(attrs).length && kids.length === 1) {
        return kids;
    }
    return [out];
}

export function normalise(root, adapter = lwcAdapter) {
    return build(root, { insideOwn: false }, adapter)[0];
}

export function render(tree, depth = 0) {
    if (!tree) return '(empty)';
    const pad = '  '.repeat(depth);
    const marker = tree.boundary ? '◆ ' : '· ';
    const props = tree.props && Object.keys(tree.props).length
        ? ' ' + Object.entries(tree.props).sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
        : '';
    const attrs = tree.attrs
        ? ' ' + Object.entries(tree.attrs)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
        : '';
    const text = tree.text ? ` "${tree.text}"` : '';
    const line = `${pad}${marker}${tree.tag}${props}${attrs}${text}`;
    return [line, ...(tree.children || []).map((c) => render(c, depth + 1))].join('\n');
}
