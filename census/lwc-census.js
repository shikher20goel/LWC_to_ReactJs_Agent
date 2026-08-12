/**
 * LWC org census — the measurement that reprices the whole project.
 *
 * Emits the schema specified in research/03 Part 2. Two of its outputs are
 * KILL CRITERIA, not statistics:
 *   tier_distribution.H / total   > 35%  -> STOP, reconsider LWC-OSS
 *   lwcs_touching_FLS_or_sharing  > 50%  -> STOP, this is a security rewrite
 *
 * Built per research/07: buy the parsers, build the census. No existing tool
 * emits this schema, and the regex-based ones silently drop edges (a
 * self-closing <c-foo /> is invisible to them).
 *
 * `parse_success_rate` is a FIRST-CLASS field, deliberately. A census that
 * silently skips 8% of bundles mis-prices the project and nothing surfaces
 * the omission. If it is not 1.0, the tier percentages are not trustworthy.
 *
 * Apex is a separate pass (@apexdevtools/apex-parser) — see apex-census.js.
 * Without it, `lwcs_touching_FLS_or_sharing` covers only what is visible from
 * the LWC side, so gate C-4 CANNOT be evaluated from this file alone.
 */

import fs from 'fs';
import path from 'path';
import { parse as parseTemplate } from '@lwc/template-compiler';
import { parse as parseJs } from '@babel/parser';
import { loadCatalog } from '../catalog/load.js';

// SINGLE SOURCE OF TRUTH: catalog/base-components.xml (O-9). A Tier-H tag
// missing here produces a WRONG kill-criterion percentage.
const TIER_H_TAGS = loadCatalog().tierH;

const PLATFORM_MODULES = {
    'lightning/messageService': 'LMS',
    'lightning/empApi': 'empApi',
    'lightning/uiRecordApi': 'uiRecordApi',
    'lightning/uiObjectInfoApi': 'uiObjectInfoApi',
    'lightning/navigation': 'navigation',
    'lightning/platformResourceLoader': 'platformResourceLoader'
};

const LIFECYCLE = new Set([
    'connectedCallback', 'disconnectedCallback', 'renderedCallback',
    'errorCallback', 'render'
]);

/* ------------------------------------------------------------------ */

function walkTemplate(node, acc) {
    if (!node || typeof node !== 'object') return;
    const type = node.type;

    if (type === 'Component' || type === 'ExternalComponent' || type === 'Element') {
        const name = node.name || '';
        if (name.startsWith('lightning-')) acc.baseTags.push(name);
        else if (name.startsWith('c-')) acc.childComponents.push(name);
    }
    if (type === 'Slot') acc.slots.push(node.slotName || '(default)');
    if (type === 'ForEach' || type === 'ForOf') acc.directives.add('iteration');
    if (type === 'IfBlock' || type === 'If') acc.directives.add('conditional');
    if (type === 'ScopedSlotFragment') acc.directives.add('scoped-slot');

    for (const d of node.directives || []) {
        if (d.name === 'Dynamic' || d.name === 'Is') acc.directives.add('dynamic-component');
        if (d.name === 'InnerHTML') acc.directives.add('inner-html');
        if (d.name === 'Dom') acc.directives.add('lwc-dom-manual');
    }

    for (const c of node.children || []) walkTemplate(c, acc);
    // Trap: the lwc:elseif/lwc:else chain hangs off `.else`, not children.
    if (node.else) walkTemplate(node.else, acc);
}

function analyseTemplate(html, name) {
    const acc = {
        baseTags: [], childComponents: [], slots: [],
        directives: new Set(), ok: true, diagnostics: []
    };
    const { root, warnings = [] } = parseTemplate(html, { name, namespace: 'c' });
    // parse() never throws — research/06 R4.5.
    if (!root) {
        acc.ok = false;
        acc.diagnostics = warnings.map((w) => `LWC${w.code}: ${w.message}`);
        return acc;
    }
    walkTemplate(root, acc);
    acc.directives = [...acc.directives];
    return acc;
}

/* ------------------------------------------------------------------ */

function analyseJs(code) {
    const out = {
        ok: true, diagnostics: [],
        imports: [], apexImports: [], schemaImports: [], platform: [],
        wires: [], apiProps: [], lifecycle: [],
        usesQuerySelector: false, composedEvents: [], events: [],
        usesLMS: false, usesEmpApi: false, usesDocumentOrWindow: false
    };

    let ast;
    try {
        ast = parseJs(code, {
            sourceType: 'module',
            plugins: ['classProperties', 'classPrivateProperties', 'decorators-legacy']
        });
    } catch (e) {
        out.ok = false;
        out.diagnostics.push(`babel: ${e.message}`);
        return out;
    }

    // local identifier -> source module, so @wire(adapter) resolves to a module
    const importMap = new Map();

    const body = ast.program.body;
    for (const n of body) {
        if (n.type !== 'ImportDeclaration') continue;
        const src = n.source.value;
        out.imports.push(src);
        if (src.startsWith('@salesforce/apex/')) out.apexImports.push(src.replace('@salesforce/apex/', ''));
        if (src.startsWith('@salesforce/schema/')) out.schemaImports.push(src.replace('@salesforce/schema/', ''));
        if (PLATFORM_MODULES[src]) out.platform.push(PLATFORM_MODULES[src]);
        if (src === 'lightning/messageService') out.usesLMS = true;
        if (src === 'lightning/empApi') out.usesEmpApi = true;
        for (const s of n.specifiers) importMap.set(s.local.name, src);
    }

    // Recursive walk — cheap and avoids a @babel/traverse ESM interop dance.
    const seen = new Set();
    (function visit(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);

        if (node.type === 'ClassProperty' || node.type === 'PropertyDefinition'
            || node.type === 'ClassMethod') {
            for (const dec of node.decorators || []) {
                const ex = dec.expression;
                if (ex.type === 'Identifier' && ex.name === 'api') {
                    out.apiProps.push(node.key && node.key.name);
                }
                if (ex.type === 'CallExpression' && ex.callee.name === 'wire') {
                    const adapter = ex.arguments[0]
                        && (ex.arguments[0].name || '(expression)');
                    out.wires.push({
                        adapter,
                        module: importMap.get(adapter) || '(unresolved)',
                        property: node.key && node.key.name
                    });
                }
            }
            if (node.type === 'ClassMethod' && node.key && LIFECYCLE.has(node.key.name)) {
                out.lifecycle.push(node.key.name);
            }
        }

        if (node.type === 'MemberExpression' && node.property && node.property.name) {
            const p = node.property.name;
            if (p === 'querySelector' || p === 'querySelectorAll') out.usesQuerySelector = true;
        }
        if (node.type === 'Identifier' && (node.name === 'document' || node.name === 'window')) {
            out.usesDocumentOrWindow = true;
        }

        if (node.type === 'NewExpression' && node.callee.name === 'CustomEvent') {
            const evName = node.arguments[0] && node.arguments[0].value;
            let composed = false;
            let bubbles = false;
            const opts = node.arguments[1];
            if (opts && opts.type === 'ObjectExpression') {
                for (const p of opts.properties) {
                    if (!p.key) continue;
                    if (p.key.name === 'composed' && p.value.value === true) composed = true;
                    if (p.key.name === 'bubbles' && p.value.value === true) bubbles = true;
                }
            }
            out.events.push({ name: evName, composed, bubbles });
            if (composed || bubbles) out.composedEvents.push(evName);
        }

        for (const k of Object.keys(node)) {
            const v = node[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v === 'object' && v.type) visit(v);
        }
    })(ast.program);

    return out;
}

/* ------------------------------------------------------------------ */

function classifyTier(bundle) {
    const h = bundle.base_components.filter((t) => TIER_H_TAGS.has(t));
    if (h.length) return { tier: 'H', reasons: h.map((t) => `Tier-H component <${t}>`) };

    const reasons = [];
    if (bundle.lifecycle.includes('renderedCallback')) reasons.push('renderedCallback');
    if (bundle.uses_query_selector) reasons.push('querySelector(All)');
    if (bundle.composed_events.length) reasons.push('composed/bubbling CustomEvent');
    if (bundle.uses_lms) reasons.push('Lightning Message Service');
    if (bundle.uses_emp_api) reasons.push('empApi');
    if (bundle.uses_document_or_window) reasons.push('direct document/window access');
    if (bundle.directives.includes('dynamic-component')) reasons.push('lwc:dynamic / lwc:is');
    if (bundle.directives.includes('inner-html')) reasons.push('lwc:inner-html');
    if (bundle.directives.includes('lwc-dom-manual')) reasons.push('lwc:dom="manual"');

    return reasons.length ? { tier: 'A', reasons } : { tier: 'M', reasons: [] };
}

/** Find every LWC bundle directory under a source root. */
export function findBundles(root) {
    const out = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(dir, e.name);
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            if (path.basename(dir) === 'lwc'
                && fs.existsSync(path.join(full, `${e.name}.js`))) {
                out.push(full);
            } else {
                stack.push(full);
            }
        }
    }
    return out.sort();
}

export function censusBundle(dir) {
    const name = path.basename(dir);
    const htmlPath = path.join(dir, `${name}.html`);
    const jsPath = path.join(dir, `${name}.js`);
    const metaPath = path.join(dir, `${name}.js-meta.xml`);

    const tpl = fs.existsSync(htmlPath)
        ? analyseTemplate(fs.readFileSync(htmlPath, 'utf8'), name)
        : { baseTags: [], childComponents: [], slots: [], directives: [], ok: true, diagnostics: [] };
    const js = analyseJs(fs.readFileSync(jsPath, 'utf8'));

    let meta = { exposed: false, targets: [] };
    if (fs.existsSync(metaPath)) {
        const xml = fs.readFileSync(metaPath, 'utf8');
        meta = {
            exposed: /<isExposed>\s*true\s*<\/isExposed>/i.test(xml),
            targets: [...xml.matchAll(/<target>([^<]+)<\/target>/g)].map((m) => m[1])
        };
    }

    const bundle = {
        name,
        path: dir,
        parsed_ok: tpl.ok && js.ok,
        diagnostics: [...tpl.diagnostics, ...js.diagnostics],
        base_components: [...new Set(tpl.baseTags)],
        child_components: [...new Set(tpl.childComponents)],
        slots: tpl.slots,
        directives: tpl.directives,
        wires: js.wires,
        apex_imports: js.apexImports,
        schema_imports: js.schemaImports,
        platform_modules: [...new Set(js.platform)],
        api_props: js.apiProps.filter(Boolean),
        lifecycle: [...new Set(js.lifecycle)],
        uses_query_selector: js.usesQuerySelector,
        events: js.events,
        composed_events: js.composedEvents,
        uses_lms: js.usesLMS,
        uses_emp_api: js.usesEmpApi,
        uses_document_or_window: js.usesDocumentOrWindow,
        exposed: meta.exposed,
        targets: meta.targets
    };

    const { tier, reasons } = classifyTier(bundle);
    bundle.tier = tier;
    bundle.tier_reasons = reasons;
    return bundle;
}

export function runCensus(sourceRoot) {
    const bundles = findBundles(sourceRoot).map(censusBundle);

    const tally = (pairs) => {
        const m = new Map();
        for (const [k, file] of pairs) {
            if (!m.has(k)) m.set(k, { count: 0, files: [] });
            const e = m.get(k);
            e.count++;
            e.files.push(file);
        }
        return [...m.entries()]
            .map(([k, v]) => ({ tag: k, ...v }))
            .sort((a, b) => b.count - a.count);
    };

    const parsedOk = bundles.filter((b) => b.parsed_ok).length;
    const tiers = { M: 0, A: 0, H: 0 };
    bundles.forEach((b) => { tiers[b.tier]++; });
    const total = bundles.length || 1;

    const wirePairs = new Map();
    for (const b of bundles) {
        for (const w of b.wires) {
            const k = `${w.module}::${w.adapter}`;
            if (!wirePairs.has(k)) {
                wirePairs.set(k, { adapter: w.adapter, module: w.module, count: 0, files: [] });
            }
            const e = wirePairs.get(k);
            e.count++;
            e.files.push(b.name);
        }
    }

    return {
        generated_from: sourceRoot,
        // FIRST-CLASS: if this is not 1, every percentage below is understated.
        parse_success_rate: bundles.length ? parsedOk / bundles.length : 1,
        parse_failures: bundles.filter((b) => !b.parsed_ok)
            .map((b) => ({ name: b.name, diagnostics: b.diagnostics })),
        total_components: bundles.length,

        base_components_used: tally(
            bundles.flatMap((b) => b.base_components.map((t) => [t, b.name]))
        ),
        wire_adapters_used: [...wirePairs.values()].sort((a, b) => b.count - a.count),
        apex_methods_referenced: tally(
            bundles.flatMap((b) => b.apex_imports.map((t) => [t, b.name]))
        ),

        lwcs_with_renderedCallback: bundles.filter((b) => b.lifecycle.includes('renderedCallback')).map((b) => b.name),
        lwcs_with_querySelectorAll: bundles.filter((b) => b.uses_query_selector).map((b) => b.name),
        lwcs_with_composed_events: bundles.filter((b) => b.composed_events.length).map((b) => b.name),
        lwcs_using_LMS: bundles.filter((b) => b.uses_lms).map((b) => b.name),
        lwcs_using_empApi: bundles.filter((b) => b.uses_emp_api).map((b) => b.name),
        lwcs_using_document_or_window: bundles.filter((b) => b.uses_document_or_window).map((b) => b.name),
        lwcs_using_record_edit_form: bundles
            .filter((b) => b.base_components.some((t) => TIER_H_TAGS.has(t)))
            .map((b) => ({ name: b.name, tags: b.base_components.filter((t) => TIER_H_TAGS.has(t)) })),

        tier_distribution: tiers,
        tier_percentages: {
            M: tiers.M / total, A: tiers.A / total, H: tiers.H / total
        },

        gates: {
            // Gate C-3 — evaluable from LWC source alone.
            tier_h_over_35pct: {
                value: tiers.H / total,
                threshold: 0.35,
                breached: tiers.H / total > 0.35,
                action: 'STOP — reconsider LWC-OSS or strangler-fig'
            },
            // Gate C-4 — NOT evaluable here. Needs the Apex pass.
            fls_sharing_over_50pct: {
                value: null,
                threshold: 0.5,
                breached: null,
                action: 'Requires apex-census (sharing declarations + SOQL access mode)'
            }
        },

        components: bundles
    };
}

export function formatCensus(c) {
    const pct = (n) => `${(n * 100).toFixed(1)}%`;
    const lines = [
        `Components:          ${c.total_components}`,
        `Parse success rate:  ${pct(c.parse_success_rate)}`
            + (c.parse_success_rate < 1 ? '  <-- percentages below are UNDERSTATED' : ''),
        '',
        `Tier M (mechanical): ${c.tier_distribution.M}  ${pct(c.tier_percentages.M)}`,
        `Tier A (assisted):   ${c.tier_distribution.A}  ${pct(c.tier_percentages.A)}`,
        `Tier H (hard):       ${c.tier_distribution.H}  ${pct(c.tier_percentages.H)}`,
        '',
        `GATE Tier-H > 35%:   ${c.gates.tier_h_over_35pct.breached ? 'BREACHED — STOP' : 'clear'} `
            + `(${pct(c.gates.tier_h_over_35pct.value)})`,
        `GATE FLS/sharing:    not evaluable — run the Apex census`,
        '',
        'Top base components:',
        ...c.base_components_used.slice(0, 15).map((b) => `  ${String(b.count).padStart(4)}  ${b.tag}`),
        '',
        'Wire adapters:',
        ...c.wire_adapters_used.map((w) => `  ${String(w.count).padStart(4)}  ${w.adapter}  <- ${w.module}`)
    ];
    return lines.join('\n');
}
