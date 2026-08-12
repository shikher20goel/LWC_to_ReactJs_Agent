#!/usr/bin/env node
/**
 * The learning pass.
 *
 *   npm run learn [-- <source-root>]
 *
 * Scans force-app/ (or a given root), finds every construct the catalogs do
 * NOT yet know, and records it with evidence. Run it again after adding more
 * components and it accumulates — the knowledge store is the agent's memory
 * between runs.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not write mappings. It cannot know that `lightning-combobox` exposes
 * `options` rather than `items`, and guessing produces a false prop diff on
 * every render that looks like the COMPONENT is broken rather than the
 * catalog. So it records WHAT it saw and WHERE, ranks by usage, and stops.
 *
 * That ranking is the actual value: it turns "the catalog is incomplete" into
 * "these five entries, in this order, unblock 40 components." research/01
 * calls this census-first; this is the same idea applied continuously instead
 * of once.
 *
 * PROMOTION IS BY ORACLE, NOT BY CONFIDENCE
 * `npm run learn:verify` promotes a construct to `verified` only when a
 * component using it converts oracle-green. Nothing else promotes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findBundles } from '../census/lwc-census.js';
import { parseTemplate, walkTemplate } from '../codemod/lwc-parser.js';
import { loadCatalog } from '../catalog/load.js';
import { loadSlds, loadPlatformModules } from '../catalog/slds-load.js';
import {
    loadKnowledge, saveKnowledge, observe, pendingConstructs, recordFailure
} from './knowledge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || path.join(here, '..', 'force-app');
const stamp = process.argv[3] || new Date().toISOString();

const CAT = loadCatalog();
const SLDS = loadSlds();
const PLATFORM = loadPlatformModules();

const k = loadKnowledge();
let scanned = 0;

for (const dir of findBundles(root)) {
    const name = path.basename(dir);
    const htmlPath = path.join(dir, `${name}.html`);
    const jsPath = path.join(dir, `${name}.js`);
    if (!fs.existsSync(htmlPath)) {
        // A bundle with no matching template uses a render() override with
        // multiple templates — a real construct we do not handle.
        recordFailure(k, {
            kind: 'multi-template', subject: 'render() override', component: name
        });
        continue;
    }
    scanned++;

    const { root: tree } = parseTemplate(fs.readFileSync(htmlPath, 'utf8'), { name });
    if (!tree) {
        recordFailure(k, { kind: 'parse-failure', subject: 'template', component: name });
        continue;
    }

    walkTemplate(tree, (n) => {
        const tag = n.name || '';

        // Base components the catalog does not know.
        if (tag.startsWith('lightning-') && !CAT.has(tag)) {
            observe(k, {
                key: `base:${tag}`, kind: 'base-component', component: name,
                detail: 'needs canonical name + EXACT prop list; a wrong prop name '
                    + 'produces a false diff on every render'
            });
        }

        // SLDS classes with no mapping.
        for (const a of n.attributes || []) {
            if (a.name !== 'class' || !a.value || a.value.type !== 'Literal') continue;
            for (const cls of String(a.value.value).split(/\s+/)) {
                if (!cls.startsWith('slds-') || SLDS.isComponentOwned(cls)) continue;
                if (SLDS.classes[cls]) continue;
                if (/^slds-(var-)?[pm]-(around|top|right|bottom|left|horizontal|vertical)_/.test(cls)) continue;
                if (/^slds-size_\d+-of-\d+$/.test(cls)) continue;
                observe(k, { key: `slds:${cls}`, kind: 'slds-class', component: name });
            }
        }
    });

    // Platform modules the catalog does not classify.
    if (fs.existsSync(jsPath)) {
        const js = fs.readFileSync(jsPath, 'utf8');
        for (const m of js.matchAll(/^import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
            const src = m[1];
            if (src === 'lwc' || src.startsWith('.') || src.startsWith('c/')) continue;
            if (src.startsWith('@salesforce/apex/') || src.startsWith('@salesforce/schema/')) continue;
            if (PLATFORM.lookup(src)) continue;
            observe(k, {
                key: `module:${src}`, kind: 'platform-module', component: name,
                detail: 'classify as shim | token | escalate — escalate is a valid '
                    + 'answer and is often the correct one'
            });
        }
    }
}

k.runs.push({ at: stamp, root: path.relative(path.join(here, '..'), root) || '.', scanned });
saveKnowledge(k, { stamp });

/* ------------------------------- report ------------------------------- */

const pending = pendingConstructs(k);
console.log(`Scanned ${scanned} component(s). Knowledge store: ${Object.keys(k.constructs).length} construct(s).\n`);

if (!pending.length) {
    console.log('No unknown constructs. The catalogs cover everything in this source.');
} else {
    console.log('UNKNOWN CONSTRUCTS — highest impact first:\n');
    for (const c of pending.slice(0, 25)) {
        console.log(`  ${String(c.uses).padStart(4)}x  [${c.state}] ${c.key}`);
        console.log(`         in: ${c.seenIn.slice(0, 4).join(', ')}${c.seenIn.length > 4 ? ` +${c.seenIn.length - 4}` : ''}`);
        if (c.evidence.length) console.log(`         ${c.evidence[0]}`);
    }
    console.log(`\n${pending.length} construct(s) need a catalog entry.`);
    console.log('These are RECORDED, not guessed — the agent does not invent mappings');
    console.log('(CLAUDE.md rule 3). Add them to catalog/, then `npm run learn:verify`.');
}

const openFailures = Object.entries(k.failures).filter(([, f]) => !f.fix);
if (openFailures.length) {
    console.log('\nFAILURE SIGNATURES with no recorded fix:');
    for (const [sig, f] of openFailures) {
        console.log(`  ${String(f.count).padStart(4)}x  ${sig}   (${f.seenIn.slice(0, 3).join(', ')})`);
    }
}
