/**
 * Catalog loader — O-9.
 *
 * catalog/base-components.xml is the SINGLE SOURCE OF TRUTH for base-component
 * mappings. Before this existed the map was hardcoded in three places
 * (oracle/normalise.js, codemod/template.js, census/lwc-census.js) and they
 * could drift silently — a component catalogued for the codemod but missing
 * from the normaliser produces a false diff, and a Tier-H tag missing from the
 * census produces a wrong kill-criterion percentage.
 *
 * The oracle reads props BY NAME because base-component stubs expose no
 * discoverable public API (S-1 finding F1), so this file is load-bearing:
 * a missing prop is invisible to the diff, and a wrong one is a false
 * mismatch on every render.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

/**
 * Path resolution has to work in BOTH module systems: this file is imported
 * as native ESM by the CLIs (`node census/run.js`) and transpiled to CJS by
 * jest. Under jest `import.meta.url` is undefined, so fileURLToPath() throws
 * — hence the layered resolution and the explicit error listing what was
 * tried, rather than a bare "path must be a string".
 */
function resolveCatalogPath() {
    const tried = [];

    let here = null;
    try {
        // eslint-disable-next-line camelcase
        if (typeof __dirname !== 'undefined') here = __dirname;
        else here = path.dirname(fileURLToPath(import.meta.url));
    } catch { /* transpiled: import.meta.url is undefined */ }

    if (here) tried.push(path.join(here, 'base-components.xml'));

    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
        tried.push(path.join(dir, 'catalog', 'base-components.xml'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    for (const candidate of tried) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
        'catalog/base-components.xml not found — the oracle, codemod and census '
        + 'all depend on it. Looked in:\n  ' + tried.join('\n  ')
    );
}

const XML_PATH = resolveCatalogPath();

const splitList = (s) => String(s || '')
    .split(',').map((x) => x.trim()).filter(Boolean);

function asArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
}

let cached = null;

export function loadCatalog({ force = false } = {}) {
    if (cached && !force) return cached;

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@'
    });
    const doc = parser.parse(fs.readFileSync(XML_PATH, 'utf8'));
    const components = asArray(doc.catalog && doc.catalog.component);

    const byTag = {};
    for (const c of components) {
        const tag = c['@tag'];
        if (!tag) continue;
        const events = {};
        for (const e of asArray(c.events && c.events.event)) {
            if (e['@from'] && e['@to']) events[e['@from']] = e['@to'];
        }
        byTag[tag] = {
            tag,
            canonical: c['@canonical'],
            tier: c['@tier'] || 'M',
            uses: Number(c['@uses'] || 0),
            props: splitList(c.props),
            slots: splitList(c.slots),
            events,
            escalateAlways: c['escalate-always'] === true || c['escalate-always'] === 'true',
            reason: c.reason ? String(c.reason).replace(/\s+/g, ' ').trim() : undefined
        };
    }

    cached = {
        byTag,
        /** Tags that must never be auto-converted. Drives the census kill criterion. */
        tierH: new Set(Object.values(byTag).filter((c) => c.tier === 'H').map((c) => c.tag)),
        canonicalOf: (tag) => (byTag[tag] ? byTag[tag].canonical : undefined),
        propsOf: (tag) => (byTag[tag] ? byTag[tag].props : []),
        has: (tag) => Object.prototype.hasOwnProperty.call(byTag, tag),
        isTierH: (tag) => Boolean(byTag[tag] && byTag[tag].tier === 'H'),
        all: () => Object.values(byTag)
    };
    return cached;
}

export const CATALOG_PATH = XML_PATH;
