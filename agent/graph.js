#!/usr/bin/env node
/**
 * Builds the dependency graph the migration console renders.
 *
 *   npm run graph [-- <source-root> [out]]
 *
 * TWO graphs, deliberately kept separate rather than merged:
 *
 *   salesforce   what exists TODAY — LWC -> child LWC -> Apex -> platform
 *                modules -> sObjects
 *   target       what the migration PRODUCES — React component -> child
 *                component -> shim hook -> Spring service
 *
 * Keeping them apart is the point. A single merged graph hides the question
 * that actually matters: which edges did NOT survive the crossing. A component
 * whose Salesforce graph has four edges and whose target graph has two has
 * lost something, and that difference is the coverage number — not a
 * percentage someone estimated.
 *
 * Coverage here is EDGE-level, not line-level. "80% of lines converted" says
 * nothing useful; "this component still depends on platformWorkspaceApi, which
 * has no off-platform equivalent" is actionable.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findBundles, censusBundle } from '../census/lwc-census.js';
import { loadCatalog } from '../catalog/load.js';
import { loadPlatformModules } from '../catalog/slds-load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || path.join(here, '..', 'force-app');
const outFile = process.argv[3] || path.join(here, '..', 'knowledge', 'graph.json');

const CAT = loadCatalog();
const PLATFORM = loadPlatformModules();
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Read the codemod's manifest if one exists, so we know what was generated. */
function loadManifest(dir) {
    const f = path.join(dir, 'manifest.json');
    if (!fs.existsSync(f)) return new Map();
    try {
        const m = JSON.parse(fs.readFileSync(f, 'utf8'));
        return new Map((m.components || []).map((c) => [c.lwc, c]));
    } catch { return new Map(); }
}

const generated = new Map([
    ...loadManifest(path.join(here, '..', 'react', 'generated')),
    ...loadManifest(path.join(here, '..', 'react', 'corpus'))
]);

const nodes = new Map();
const edges = [];

const addNode = (id, type, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, ...extra });
    else Object.assign(nodes.get(id), extra);
};
const addEdge = (from, to, kind, side) => {
    edges.push({ from, to, kind, side });
};

const components = [];

for (const dir of findBundles(root)) {
    const b = censusBundle(dir);
    const name = b.name;
    const gen = generated.get(name);

    /* ---------------- salesforce side: what exists today ---------------- */
    addNode(`lwc:${name}`, 'lwc', {
        label: name, tier: b.tier, tierReasons: b.tier_reasons, side: 'salesforce'
    });

    for (const child of b.child_components) {
        const childName = child.replace(/^c-/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        addNode(`lwc:${childName}`, 'lwc', { label: childName, side: 'salesforce' });
        addEdge(`lwc:${name}`, `lwc:${childName}`, 'child', 'salesforce');
    }

    for (const tag of b.base_components) {
        const entry = CAT.byTag ? CAT.byTag[tag] : null;
        addNode(`base:${tag}`, 'base-component', {
            label: tag, tier: entry ? entry.tier : '?', side: 'salesforce'
        });
        addEdge(`lwc:${name}`, `base:${tag}`, 'uses', 'salesforce');
    }

    for (const m of b.apex_imports) {
        const cls = String(m).split('.')[0];
        addNode(`apex:${cls}`, 'apex', { label: cls, side: 'salesforce' });
        addEdge(`lwc:${name}`, `apex:${cls}`, 'calls', 'salesforce');
    }

    for (const w of b.wires) {
        if (!w.module.startsWith('lightning/')) continue;
        const mod = PLATFORM.lookup(w.module);
        addNode(`module:${w.module}`, 'platform-module', {
            label: w.module, status: mod ? mod.status : 'unclassified', side: 'salesforce'
        });
        addEdge(`lwc:${name}`, `module:${w.module}`, 'wires', 'salesforce');
    }

    /* ---------------- target side: what the migration produced ---------------- */
    const comp = pascal(name);
    if (gen) {
        addNode(`react:${comp}`, 'react', {
            label: comp, status: gen.status, reviewItems: gen.reviewItems, side: 'target'
        });
        addEdge(`lwc:${name}`, `react:${comp}`, 'converts-to', 'crossing');

        for (const child of b.child_components) {
            const childComp = pascal(child.replace(/^c-/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase()));
            addEdge(`react:${comp}`, `react:${childComp}`, 'child', 'target');
        }
        for (const m of b.apex_imports) {
            const cls = String(m).split('.')[0];
            addNode(`spring:${cls}Service`, 'spring', { label: `${cls}Service`, side: 'target' });
            addEdge(`react:${comp}`, `spring:${cls}Service`, 'calls', 'target');
            addEdge(`apex:${cls}`, `spring:${cls}Service`, 'converts-to', 'crossing');
        }
    }

    /* ---------------- coverage: which edges survived the crossing ---------------- */
    const sfEdges = edges.filter((e) => e.from === `lwc:${name}` && e.side === 'salesforce');
    const lost = [];
    for (const e of sfEdges) {
        const n = nodes.get(e.to);
        if (n.type === 'base-component' && n.tier === 'H') {
            lost.push({ edge: e.to, why: 'Tier-H component — a product build, not a translation' });
        }
        if (n.type === 'platform-module' && n.status === 'escalate') {
            lost.push({ edge: e.to, why: 'platform module with no honest off-platform equivalent' });
        }
        if (n.type === 'platform-module' && n.status === 'unclassified') {
            lost.push({ edge: e.to, why: 'platform module not yet classified in the catalog' });
        }
    }

    components.push({
        name,
        component: comp,
        tier: b.tier,
        tierReasons: b.tier_reasons,
        status: gen ? gen.status : 'not-generated',
        reviewItems: gen ? gen.reviewItems : null,
        todos: gen ? gen.todos : [],
        salesforce: {
            children: b.child_components,
            baseComponents: b.base_components,
            apexClasses: [...new Set(b.apex_imports.map((m) => String(m).split('.')[0]))],
            apexMethods: b.apex_imports,
            wires: b.wires.map((w) => ({ adapter: w.adapter, module: w.module })),
            platformModules: b.platform_modules,
            lifecycle: b.lifecycle,
            events: b.events
        },
        coverage: {
            totalEdges: sfEdges.length,
            lostEdges: lost.length,
            survived: sfEdges.length - lost.length,
            lost
        }
    });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify({
    generatedFrom: path.relative(path.join(here, '..'), root).replace(/\\/g, '/') || '.',
    totals: {
        components: components.length,
        generated: components.filter((c) => c.status !== 'not-generated').length,
        clean: components.filter((c) => c.status === 'clean').length,
        escalated: components.filter((c) => c.status === 'escalated').length,
        lostEdges: components.reduce((a, c) => a + c.coverage.lostEdges, 0)
    },
    nodes: [...nodes.values()],
    edges,
    components: components.sort((a, b) => a.name.localeCompare(b.name))
}, null, 2)}\n`);

console.log(`Graph: ${nodes.size} nodes, ${edges.length} edges -> ${outFile}`);
console.log(`  components  ${components.length}`);
console.log(`  generated   ${components.filter((c) => c.status !== 'not-generated').length}`);
console.log(`  lost edges  ${components.reduce((a, c) => a + c.coverage.lostEdges, 0)}  (dependencies with no off-platform equivalent)`);
