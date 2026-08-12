/**
 * Oracle normaliser — canonical component-boundary tree from a rendered LWC
 * (or React) root, suitable for structural diffing.
 *
 * S-1 spike findings encoded here:
 *  F1  lightning-* props are JS PROPERTIES, not attributes. Read by name from
 *      the catalog — the stub prototype does not expose the public API.
 *  F2  lightning-* stubs have a shadowRoot containing only <slot> elements.
 *      Slotted content lives in light DOM. Traverse BOTH.
 *  F3  Child c-* components render for real. Only lightning-* are stubbed.
 *  F4  Suppress text rendered BY a base component's shadow root; KEEP text in
 *      slotted light-DOM children.
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
const isBoundary = (tag) => isBaseComponent(tag) || isCustomComponent(tag);

function pascal(tag) {
    return tag.replace(/^c-/, '').split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function canonicalName(tag) {
    if (CATALOG[tag]) return CATALOG[tag].canonical;
    if (isCustomComponent(tag)) return pascal(tag);
    return tag;
}

// F1: read declared props off the element.
function readProps(node, tag) {
    const entry = CATALOG[tag];
    const out = {};
    if (entry) {
        entry.props.forEach((p) => {
            const v = node[p];
            if (v !== undefined && v !== null && v !== '') out[p] = v;
        });
        return out;
    }
    Object.keys(node).forEach((k) => {
        if (k.startsWith('_') || typeof node[k] === 'function') return;
        const v = node[k];
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    });
    return out;
}

// F2: walk shadow root AND light DOM, tracking provenance.
function children(node) {
    const seen = new Set();
    const out = [];
    if (node.shadowRoot) {
        for (const k of node.shadowRoot.children) {
            seen.add(k);
            out.push({ el: k, shadow: true });   // rendered BY this component
        }
    }
    for (const k of node.children || []) {
        if (!seen.has(k)) out.push({ el: k, shadow: false }); // OUR slotted content
    }
    return out;
}

const STRUCTURAL_ATTRS = ['role', 'aria-label', 'aria-labelledby',
    'aria-describedby', 'aria-live', 'aria-hidden', 'type', 'href', 'alt', 'name'];

function build(node, opts) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'slot') {
        return children(node).flatMap((c) => build(c.el, opts)).filter(Boolean);
    }
    const boundary = isBoundary(tag);
    const base = isBaseComponent(tag);
    // F4: only a base component's own shadow output is opaque.
    const kids = children(node)
        .flatMap((c) => build(c.el, {
            ...opts,
            insideBase: base ? c.shadow : opts.insideBase
        }))
        .filter(Boolean);
    let text;
    if (!base && !opts.insideBase && kids.length === 0) {
        const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) text = t;
    }
    const attrs = {};
    for (const a of node.attributes || []) {
        if (STRUCTURAL_ATTRS.includes(a.name)) attrs[a.name] = a.value;
    }
    const node_ = {
        tag: boundary ? canonicalName(tag) : tag,
        boundary,
        ...(boundary ? { props: readProps(node, tag) } : {}),
        ...(Object.keys(attrs).length ? { attrs } : {}),
        ...(text ? { text } : {}),
        ...(kids.length ? { children: kids } : {})
    };
    // Collapse pure layout wrappers.
    if (!boundary && !text && !Object.keys(attrs).length && kids.length === 1) {
        return kids;
    }
    return [node_];
}

export function normalise(root) {
    return build(root, { insideBase: false })[0];
}

export function render(tree, depth = 0) {
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
