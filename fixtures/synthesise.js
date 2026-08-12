#!/usr/bin/env node
/**
 * npm run fixtures:build
 *
 * Synthesises preview data for every generated component.
 *
 * THE IDEA: a component tells you what shape it needs. When the JSX says
 *
 *     {(profileAttributes ?? []).map((a) => <Badge label={a.Profile_Attribute__r.Name} />)}
 *
 * it has fully specified that `profileAttributes` is an array whose items have
 * `Profile_Attribute__r.Name`. That is derivable from the generated code alone
 * — no org, no SOQL, no customer data, and it works the same on component 1
 * and component 1000.
 *
 * Org METADATA (knowledge/org/metadata.json, if pulled) then makes the values
 * look like they came from this org rather than from a random generator:
 * picklist fields get real picklist values, labels get real label text. That
 * is configuration, not records — see agent/pull-org-metadata.js for why the
 * line is drawn exactly there.
 *
 * WHAT THIS IS NOT: a substitute for the oracle. Synthetic data makes a
 * preview legible; it does not prove the conversion is faithful. Only the
 * differential does that.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from '@babel/parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const OUT_DIR = process.argv[2] || path.join('react', 'generated');
const DEST = path.join(ROOT, 'fixtures', 'synthetic');

const META_PATH = path.join(ROOT, 'knowledge', 'org', 'metadata.json');
const META = fs.existsSync(META_PATH)
    ? JSON.parse(fs.readFileSync(META_PATH, 'utf8'))
    : { objects: {}, labels: {} };

/* ------------------------------------------------------------------ *
 * 1. What shape does this component read?
 * ------------------------------------------------------------------ */

/**
 * Walks the JSX for `.map()` calls and records, per iterated collection, the
 * member paths read off the loop variable.
 *
 * Deliberately shallow: it does not try to follow the data through the wire
 * handler back to a specific Apex method. Most converted components have
 * exactly one Apex call, so the union of shapes is that call's response; where
 * a component has several, the synthesised row satisfies all of them, which
 * over-provides rather than under-provides. Over-providing shows MORE of the
 * component, which is what a preview is for. Under-providing looks like a bug.
 */
function readShape(code) {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
    const collections = new Map();   // collection name -> Set of dotted paths
    const objectPaths = new Map();   // root identifier -> Set of dotted paths read on it
    const scalars = new Set();

    const pathOf = (node) => {
        const parts = [];
        let n = node;
        while (n && n.type === 'MemberExpression' && !n.computed) {
            parts.unshift(n.property.name);
            n = n.object;
        }
        return n && n.type === 'Identifier' ? { root: n.name, parts } : null;
    };

    const walk = (node, itemVars) => {
        if (!node || typeof node.type !== 'string') return;

        // (X ?? []).map((item) => ...)
        if (node.type === 'CallExpression'
            && node.callee.type === 'MemberExpression'
            && node.callee.property.name === 'map'
            && node.arguments[0]
            && /FunctionExpression|ArrowFunctionExpression/.test(node.arguments[0].type)) {
            let src = node.callee.object;
            // unwrap `(X ?? [])`
            if (src.type === 'LogicalExpression' && src.operator === '??') src = src.left;
            // A getter is emitted as a zero-arg function, so the iterated
            // collection reads `accounts()`. Without this the entire
            // getter-backed family of components yields no shape at all.
            if (src.type === 'CallExpression' && src.callee.type === 'Identifier') {
                src = src.callee;
            }
            const info = pathOf(src);
            const name = info ? [info.root, ...info.parts].join('.') : null;
            const param = node.arguments[0].params[0];
            const itemVar = param && param.type === 'Identifier' ? param.name : null;
            if (name && itemVar) {
                if (!collections.has(name)) collections.set(name, new Set());
                walk(node.arguments[0].body,
                    new Map(itemVars).set(itemVar, collections.get(name)));
                // fall through so nested maps inside are also walked once
            }
        }

        if (node.type === 'MemberExpression' && !node.computed) {
            const info = pathOf(node);
            if (info && itemVars.has(info.root) && info.parts.length) {
                itemVars.get(info.root).add(info.parts.join('.'));
            } else if (info && info.parts.length) {
                // A read on something that is NOT a loop variable — a prop or
                // a local, e.g. `classificationData.label`. These describe the
                // OBJECT a parent passes down, and without them a component
                // that receives an object (rather than a list) gets nothing and
                // dies on the first field access.
                if (!objectPaths.has(info.root)) objectPaths.set(info.root, new Set());
                objectPaths.get(info.root).add(info.parts.join('.'));
            } else if (info) {
                scalars.add(info.root);
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
            const v = node[key];
            if (Array.isArray(v)) v.forEach((c) => walk(c, itemVars));
            else if (v && typeof v.type === 'string') walk(v, itemVars);
        }
    };

    walk(ast, new Map());

    // What this component hands to its children.
    //
    // A parent very often never touches the array itself — it fetches it and
    // passes it down (`<Section profileAttributes={profileAttributes} />`), so
    // the SHAPE is only visible in the child. Without following that edge, 12
    // of 18 components on the first real org yielded no shape and previewed
    // empty for a reason that had nothing to do with the conversion.
    const childProps = [];
    const walkJsx = (node) => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier'
            && /^[A-Z]/.test(node.name.name)) {
            for (const attr of node.attributes) {
                if (attr.type !== 'JSXAttribute' || !attr.value) continue;
                if (attr.value.type !== 'JSXExpressionContainer') continue;
                const e = attr.value.expression;
                const info = e.type === 'CallExpression' && e.callee.type === 'Identifier'
                    ? { root: e.callee.name, parts: [] }
                    : pathOf(e);
                if (!info) continue;
                childProps.push({
                    child: node.name.name,
                    prop: attr.name.name,
                    local: [info.root, ...info.parts].join('.')
                });
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const v = node[key];
            if (Array.isArray(v)) v.forEach(walkJsx);
            else if (v && typeof v.type === 'string') walkJsx(v);
        }
    };
    walkJsx(ast);

    return {
        collections: Object.fromEntries(
            [...collections].map(([k, v]) => [k, [...v].sort()])
        ),
        objectPaths: Object.fromEntries(
            [...objectPaths].map(([k, v]) => [k, [...v].sort()])
        ),
        childProps,
        scalars: [...scalars].sort()
    };
}

/* ------------------------------------------------------------------ *
 * 2. Plausible values
 * ------------------------------------------------------------------ */

const WORDS = ['Northern Trail', 'Acme', 'Global Media', 'Pyramid', 'Edge Communications',
    'United Oil', 'Express Logistics', 'Grand Hotels'];
const PEOPLE = ['Avery Stone', 'Jordan Patel', 'Sam Okafor', 'Riley Chen', 'Morgan Diaz'];

/** Field metadata for a leaf name, if any object in the org has such a field. */
function metaFor(leaf) {
    for (const obj of Object.values(META.objects || {})) {
        const f = (obj.fields || []).find((x) => x.name === leaf);
        if (f) return f;
    }
    return null;
}

/**
 * A value for one leaf.
 *
 * `i` varies the value per row so a list looks like a list; a preview where
 * every row reads "Sample" hides exactly the bug a list rendering is likely to
 * have — the same record bound to every row (a known oracle blind spot: row
 * identity is not in the boundary tree).
 */
function valueFor(leaf, i) {
    const f = metaFor(leaf);
    if (f && f.picklistValues && f.picklistValues.length) {
        return f.picklistValues[i % f.picklistValues.length].value;
    }
    if (f) {
        if (['Boolean'].includes(f.type)) return i % 2 === 0;
        if (['Int', 'Double', 'Currency', 'Percent'].includes(f.type)) return (i + 1) * 100;
        if (['Date'].includes(f.type)) return `2026-0${(i % 9) + 1}-15`;
        if (['DateTime'].includes(f.type)) return `2026-0${(i % 9) + 1}-15T10:00:00.000Z`;
    }

    // Structural fallbacks, by name.
    if (/^Id$|Id$/.test(leaf)) return `a0${String(i).padStart(2, '0')}xx0000000001`;
    if (/^(is|has|can|should)[A-Z]/.test(leaf)) return i % 2 === 0;
    if (/Count$|Number$|Qty$|Amount$|Total$/i.test(leaf)) return (i + 1) * 3;
    if (/Date$|^Date/i.test(leaf)) return `2026-0${(i % 9) + 1}-15`;
    if (/Url$|Link$/i.test(leaf)) return `https://example.invalid/${i}`;
    if (/Email$/i.test(leaf)) return `person${i}@example.invalid`;
    if (/Phone$/i.test(leaf)) return `555-010${i}`;
    if (/Name$|Label$|Title$|Subject$/i.test(leaf)) {
        return /Contact|Owner|Person|User/i.test(leaf)
            ? PEOPLE[i % PEOPLE.length]
            : WORDS[i % WORDS.length];
    }
    if (/Description$|Comment|Body$|Text$/i.test(leaf)) {
        return `Synthetic ${leaf} for preview row ${i + 1}.`;
    }
    return `${leaf} ${i + 1}`;
}

/** Build one row satisfying a set of dotted paths. */
function buildRow(allPaths, i) {
    const row = {};
    // A relationship is read both as a whole and through its fields —
    // `Profile_Attribute__r` and `Profile_Attribute__r.Name` are both in the
    // set. Building the shorter one first writes a string where the longer one
    // then needs an object. Drop any path that is a strict prefix of another;
    // the deeper read is the one that describes the shape.
    const paths = allPaths.filter(
        (p) => !allPaths.some((q) => q !== p && q.startsWith(`${p}.`))
    );
    for (const p of paths) {
        const parts = p.split('.');
        let node = row;
        for (let d = 0; d < parts.length - 1; d++) {
            node[parts[d]] = node[parts[d]] || {};
            node = node[parts[d]];
        }
        node[parts[parts.length - 1]] = valueFor(parts[parts.length - 1], i);
    }
    // Every Salesforce row has an Id, and React keys are usually bound to it.
    if (!row.Id && !row.id) row.Id = `a0${String(i).padStart(2, '0')}xx0000000001`;
    return row;
}

/* ------------------------------------------------------------------ *
 * 3. Emit
 * ------------------------------------------------------------------ */

const outDir = path.join(ROOT, OUT_DIR);
const manifestPath = path.join(outDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}. Run the codemod first.`);
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

fs.mkdirSync(DEST, { recursive: true });
const ROWS = 3;
const index = {};
let withData = 0;

/* Pass 1 — read each component's own shape. */
const shapes = new Map();       // component (Pascal) -> shape
const byLwc = new Map();        // lwc name -> component
for (const c of manifest.components) {
    if (c.status === 'escalated') continue;
    const file = path.join(outDir, c.dir, `${c.component}.jsx`);
    if (!fs.existsSync(file)) continue;
    try {
        shapes.set(c.component, readShape(fs.readFileSync(file, 'utf8')));
        byLwc.set(c.lwc, c.component);
    } catch (e) {
        console.log(`  ${c.lwc}: could not parse — ${e.message.split('\n')[0]}`);
    }
}

/*
 * Pass 2 — propagate shapes UP from children to parents, to a fixpoint.
 *
 * `<Section profileAttributes={rows} />` means `rows` in the parent has
 * whatever shape Section reads off its `profileAttributes` prop. Iterating to
 * a fixpoint (rather than one pass) handles a chain — grandparent -> parent ->
 * child — which is the normal arrangement here: a demo component fetches, a
 * middle component splits by classification, a leaf renders badges.
 *
 * Bounded by the component count so a cyclic reference cannot spin.
 */
let changed = true;
let rounds = 0;
while (changed && rounds < shapes.size + 2) {
    changed = false;
    rounds++;
    for (const shape of shapes.values()) {
        for (const use of shape.childProps) {
            const childShape = shapes.get(use.child);
            if (!childShape) continue;                 // placeholder or base component
            const inherited = childShape.collections[use.prop];
            if (!inherited || !inherited.length) continue;
            const own = shape.collections[use.local] || [];
            const merged = [...new Set([...own, ...inherited])];
            if (merged.length !== own.length) {
                shape.collections[use.local] = merged.sort();
                changed = true;
            }
        }
    }
}

/**
 * Pass 3 — build one value per ROOT identifier.
 *
 * A component does not receive `classificationData.allProfileAttributes`; it
 * receives `classificationData`, an object that happens to contain an array at
 * that path and scalars like `label` beside it. Emitting the dotted path as a
 * top-level key produced data no component could consume — the preview passed
 * nothing for `classificationData` and every field access on it threw.
 *
 * So dotted collections nest under their root, and the scalar reads recorded
 * on that same root fill in around them.
 */
function setIn(obj, dotted, value) {
    const parts = dotted.split('.');
    let node = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
}

for (const [lwc, comp] of byLwc) {
    const shape = shapes.get(comp);
    const roots = {};

    // Arrays first — they are the load-bearing part of the shape.
    for (const [name, paths] of Object.entries(shape.collections)) {
        const rows = Array.from({ length: ROWS }, (_, i) => buildRow(paths, i));
        const root = name.split('.')[0];
        if (!name.includes('.')) { roots[root] = rows; continue; }
        if (!roots[root] || Array.isArray(roots[root])) roots[root] = {};
        setIn(roots[root], name.split('.').slice(1).join('.'), rows);
    }

    // Then scalars read on those same roots, without clobbering an array.
    for (const [root, paths] of Object.entries(shape.objectPaths || {})) {
        if (Array.isArray(roots[root])) continue;      // it is a list, not an object
        if (!(root in roots)) continue;                // only fill roots we already serve
        for (const p of paths) {
            if (Object.keys(shape.collections).includes(`${root}.${p}`)) continue;
            let node = roots[root];
            const parts = p.split('.');
            let clash = false;
            for (let i = 0; i < parts.length - 1 && !clash; i++) {
                if (Array.isArray(node[parts[i]])) clash = true;
                else { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]]; }
            }
            if (clash || Array.isArray(node[parts[parts.length - 1]])) continue;
            node[parts[parts.length - 1]] = valueFor(parts[parts.length - 1], 0);
        }
    }

    const names = Object.keys(roots);
    if (!names.length) { index[lwc] = { collections: {} }; continue; }
    index[lwc] = { collections: roots };
    withData++;
    console.log(`  ${lwc}: ${names.map((n) => (Array.isArray(roots[n]) ? `${n}[]` : `${n}{}`)).join(', ')}`);
}

fs.writeFileSync(path.join(DEST, 'preview-data.json'), `${JSON.stringify({
    note: 'SYNTHETIC. Generated by fixtures/synthesise.js from the SHAPE each '
        + 'component reads, plus org METADATA (picklist values, field types). '
        + 'Contains no records and must never be replaced by any.',
    rows: ROWS,
    usedOrgMetadata: Object.keys(META.objects || {}).length > 0,
    components: index
}, null, 2)}\n`);

console.log(`\n${withData}/${Object.keys(index).length} components have a data shape.`);
console.log('Wrote fixtures/synthetic/preview-data.json (synthetic — no records).');
