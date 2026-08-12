/**
 * Structural diff over two normalised boundary trees.
 *
 * Reports the smallest true statement about a mismatch — a path, a kind, and
 * the two values — rather than a wall of markup. The agent reads these; they
 * have to be actionable without a human re-reading both components.
 *
 * CHILD ALIGNMENT (the part that matters).
 * Matching children by index is wrong: dropping one child shifts every later
 * sibling, so a single defect is reported as a cascade of tag and prop
 * mismatches whose FIRST line names the wrong node. Measured, before this
 * was fixed: 3 dropped <FormattedText> nodes reported as 15 diffs opening
 * with "tag: FormattedText → Button".
 *
 * So children are aligned in two tiers:
 *   1. LCS over a deep fingerprint — pins subtrees that are identical.
 *      Handles a dropped/added ROW in a list of otherwise-identical siblings.
 *   2. Within each remaining gap, LCS over tag — pins same-kind nodes whose
 *      contents differ. Handles a dropped CHILD inside every row, where no
 *      row fingerprint matches any more.
 *
 * Neither tier alone is sufficient; tier 1 alone degrades to all-delete +
 * all-insert the moment every sibling changed.
 */

const eq = (a, b) => JSON.stringify(a === undefined ? null : a)
    === JSON.stringify(b === undefined ? null : b);

function label(node) {
    if (!node) return '(absent)';
    return node.boundary ? `◆${node.tag}` : `·${node.tag}`;
}

/** Stable deep fingerprint — identity for tier-1 alignment. */
function fingerprint(n) {
    if (!n) return '';
    const bag = (o) => Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',');
    return `${n.tag}|${n.boundary ? 1 : 0}|${bag(n.props)}|${bag(n.attrs)}`
        + `|${n.text || ''}|(${(n.children || []).map(fingerprint).join('')})`;
}

/** Longest common subsequence — returns matched [i, j] index pairs. */
function lcsPairs(a, b, same) {
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = same(a[i], b[j])
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const pairs = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (same(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}

const sameKind = (x, y) => x.tag === y.tag && Boolean(x.boundary) === Boolean(y.boundary);

/**
 * Align two child lists. Returns [lwcNode|null, reactNode|null, index] triples
 * in document order.
 */
export function alignChildren(a, b) {
    const out = [];

    const fillGap = (aSeg, bSeg, aOff) => {
        const pairs = lcsPairs(aSeg, bSeg, sameKind);
        let x = 0;
        let y = 0;
        for (const [pi, pj] of pairs) {
            while (x < pi) { out.push([aSeg[x], null, aOff + x]); x++; }
            while (y < pj) { out.push([null, bSeg[y], aOff + x]); y++; }
            out.push([aSeg[pi], bSeg[pj], aOff + pi]);
            x = pi + 1; y = pj + 1;
        }
        while (x < aSeg.length) { out.push([aSeg[x], null, aOff + x]); x++; }
        while (y < bSeg.length) { out.push([null, bSeg[y], aOff + x]); y++; }
    };

    const exact = lcsPairs(a, b, (x, y) => fingerprint(x) === fingerprint(y));
    let ai = 0;
    let bi = 0;
    for (const [pi, pj] of exact) {
        fillGap(a.slice(ai, pi), b.slice(bi, pj), ai);
        out.push([a[pi], b[pj], pi]);
        ai = pi + 1;
        bi = pj + 1;
    }
    fillGap(a.slice(ai), b.slice(bi), ai);
    return out;
}

export function diffTrees(lwc, react, path = '$', out = []) {
    if (!lwc && !react) return out;

    if (!lwc || !react) {
        out.push({
            path,
            kind: 'presence',
            lwc: label(lwc),
            react: label(react),
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

    for (const [a, b, i] of alignChildren(lwc.children || [], react.children || [])) {
        diffTrees(a, b, `${path}/${label(a || b)}[${i}]`, out);
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
