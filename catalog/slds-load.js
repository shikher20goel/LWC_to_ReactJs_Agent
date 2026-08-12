/**
 * Loader for catalog/slds.xml — the SLDS -> React CSS mapping.
 *
 * Same pattern as catalog/load.js (O-9): one source of truth, resolvable under
 * BOTH module systems, because jest transpiles ESM->CJS and leaves
 * import.meta.url undefined.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

function resolveSldsPath() {
    const tried = [];
    let here = null;
    try {
        // eslint-disable-next-line camelcase
        if (typeof __dirname !== 'undefined') here = __dirname;
        else here = path.dirname(fileURLToPath(import.meta.url));
    } catch { /* transpiled: import.meta.url is undefined */ }

    if (here) tried.push(path.join(here, 'slds.xml'));
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
        tried.push(path.join(dir, 'catalog', 'slds.xml'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    for (const c of tried) if (fs.existsSync(c)) return c;
    throw new Error('catalog/slds.xml not found. Looked in:\n  ' + tried.join('\n  '));
}

const asArray = (v) => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]));

let cached = null;

export function loadSlds({ force = false } = {}) {
    if (cached && !force) return cached;

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
    const doc = parser.parse(fs.readFileSync(resolveSldsPath(), 'utf8')).slds;

    const spacing = {};
    for (const s of asArray(doc['spacing-scale'] && doc['spacing-scale'].step)) {
        spacing[s['@name']] = {
            name: s['@name'],
            rem: Number(s['@rem']),
            px: Number(s['@px']),
            note: s['@note']
        };
    }

    const axes = {};
    for (const a of asArray(doc['spacing-axes'] && doc['spacing-axes'].axis)) {
        axes[a['@name']] = String(a['@properties']).split(',').map((x) => x.trim());
    }

    // Density: axis -> token group. Three groups for var-, one for static.
    const axisGroups = [];
    for (const g of asArray(doc.density && doc.density['axis-group'])) {
        axisGroups.push({
            axes: String(g['@axes']).split(',').map((x) => x.trim()),
            token: g['@token']
        });
    }

    const classes = {};
    for (const c of asArray(doc.classes && doc.classes.class)) {
        classes[c['@name']] = c['@css'];
    }

    const ownedPrefixes = String(
        (doc['component-owned'] && doc['component-owned']['@prefixes']) || ''
    ).split(',').map((x) => x.trim()).filter(Boolean);

    const presets = {};
    for (const p of asArray(doc.presets && doc.presets.preset)) {
        presets[p['@name']] = {
            name: p['@name'],
            lossy: p['@lossy'] === true || p['@lossy'] === 'true',
            isDefault: p['@default'] === true || p['@default'] === 'true',
            description: p.description,
            warnings: asArray(p.warn)
        };
    }

    cached = {
        spacing,
        axes,
        classes,
        presets,
        ownedPrefixes,
        axisGroupFor(axis) {
            const g = axisGroups.find((x) => x.axes.includes(axis));
            return g ? g.token : 'var-spacing';
        },
        isComponentOwned(cls) {
            return ownedPrefixes.some((p) => cls === p || cls.startsWith(`${p}__`)
                || cls.startsWith(`${p}_`) || cls.startsWith(`${p}-`));
        },
        defaultPreset() {
            const d = Object.values(presets).find((p) => p.isDefault);
            return d ? d.name : 'css-vars';
        }
    };
    return cached;
}
