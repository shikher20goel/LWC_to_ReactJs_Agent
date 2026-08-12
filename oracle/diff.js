/**
 * Structural diff over two normalised boundary trees.
 *
 * Reports the smallest true statement about a mismatch — a path, a kind, and
 * the two values — rather than a wall of markup. The agent reads these; they
 * need to be actionable without a human re-reading both components.
 */

const eq = (a, b) => JSON.stringify(a === undefined ? null : a)
    === JSON.stringify(b === undefined ? null : b);

function label(node) {
    if (!node) return '(absent)';
    return node.boundary ? `◆${node.tag}` : `·${node.tag}`;
}

export function diffTrees(lwc, react, path = '$', out = []) {
    if (!lwc && !react) return out;

    if (!lwc || !react) {
        out.push({
            path, kind: 'presence',
            lwc: label(lwc), react: label(react),
            detail: !react ? 'missing in React' : 'extra in React'
        });
        return out;
    }

    if (lwc.tag !== react.tag) {
        out.push({ path, kind: 'tag', lwc: lwc.tag, react: react.tag });
    }
    if (Boolean(lwc.boundary) !== Boolean(react.boundary)) {
        out.push({ path, kind: 'boundary', lwc: lwc.boundary, react: react.boundary });
    }

    for (const k of new Set([
        ...Object.keys(lwc.props || {}), ...Object.keys(react.props || {})
    ])) {
        const a = (lwc.props || {})[k];
        const b = (react.props || {})[k];
        if (!eq(a, b)) out.push({ path: `${path}[${k}]`, kind: 'prop', lwc: a, react: b });
    }

    for (const k of new Set([
        ...Object.keys(lwc.attrs || {}), ...Object.keys(react.attrs || {})
    ])) {
        const a = (lwc.attrs || {})[k];
        const b = (react.attrs || {})[k];
        if (!eq(a, b)) out.push({ path: `${path}@${k}`, kind: 'attr', lwc: a, react: b });
    }

    if (!eq(lwc.text, react.text)) {
        out.push({ path, kind: 'text', lwc: lwc.text, react: react.text });
    }

    const lk = lwc.children || [];
    const rk = react.children || [];
    for (let i = 0; i < Math.max(lk.length, rk.length); i++) {
        const child = lk[i] || rk[i];
        diffTrees(lk[i], rk[i], `${path}/${label(child)}[${i}]`, out);
    }
    return out;
}

export function formatDiff(diffs) {
    if (!diffs.length) return 'IDENTICAL — no structural difference.';
    return [`${diffs.length} difference(s):`, ...diffs.map((d) =>
        `  ${d.path}\n    ${d.kind}: LWC=${JSON.stringify(d.lwc)} `
        + `React=${JSON.stringify(d.react)}${d.detail ? `  (${d.detail})` : ''}`
    )].join('\n');
}
