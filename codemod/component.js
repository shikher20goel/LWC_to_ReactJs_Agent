/**
 * LWC bundle -> React function component. The JS half of the codemod.
 *
 * Emits the mechanical scaffold and REFUSES to guess the rest. Anything it
 * cannot translate faithfully becomes a `todos` entry and an inline TODO
 * comment, not a plausible-looking invention — a wrong translation that
 * compiles is worse than an honest gap, because the oracle can only catch
 * what actually renders.
 *
 * Translation rules:
 *   @api foo              -> destructured prop `foo`
 *   @wire(getRecord,{..}) -> useRecord({..})   with `$param` -> the prop/local
 *   @wire(apexFn,{..})    -> useApex(apexFn,{..})
 *   get foo() {return X}  -> const foo = X;
 *   method(a) {...}       -> const method = (a) => {...}
 *   this.dispatchEvent(new CustomEvent('foo',{detail:D}))  -> onFoo?.(D)
 *   this.x                -> x
 *   connectedCallback     -> useEffect(..., [])            [flagged]
 *   renderedCallback      -> NOT auto-converted            [flagged, Tier A]
 */

import { parse } from '@babel/parser';
import { convertTemplate } from './template.js';

const RUNTIME_PKG = '@migration/salesforce-runtime';

const LDS_ADAPTERS = {
    getRecord: 'useRecord',
    getObjectInfo: 'useObjectInfo',
    getPicklistValues: 'usePicklistValues'
};

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Source text for a node, using original offsets — avoids a generator pass. */
const src = (code, node) => code.slice(node.start, node.end);

/**
 * Strip `this.` so class-field references become locals.
 * Deliberately textual: the alternative is a full scope-aware rewrite, and
 * anything it cannot handle is flagged rather than silently mangled.
 */
function deThis(text) {
    return text.replace(/\bthis\./g, '');
}

function parseBundle(code) {
    return parse(code, {
        sourceType: 'module',
        plugins: ['classProperties', 'classPrivateProperties', 'decorators-legacy']
    });
}

export function analyseComponentJs(code) {
    const ast = parseBundle(code);
    const out = {
        apiProps: [], wires: [], getters: [], methods: [],
        fields: [], lifecycle: [], emittedEvents: [], imports: [],
        todos: []
    };

    const importMap = new Map();
    for (const n of ast.program.body) {
        if (n.type !== 'ImportDeclaration') continue;
        out.imports.push({ source: n.source.value, specifiers: n.specifiers.map((s) => s.local.name) });
        for (const s of n.specifiers) importMap.set(s.local.name, n.source.value);
    }
    out.importMap = importMap;

    const cls = ast.program.body
        .map((n) => (n.type === 'ExportDefaultDeclaration' ? n.declaration : n))
        .find((n) => n && n.type === 'ClassDeclaration');
    if (!cls) {
        out.todos.push({ kind: 'no-class', detail: 'No default-exported class found.' });
        return out;
    }

    for (const m of cls.body.body) {
        const name = m.key && m.key.name;
        const decorators = (m.decorators || []).map((d) => d.expression);
        const isApi = decorators.some((e) => e.type === 'Identifier' && e.name === 'api');
        const wireDec = decorators.find((e) => e.type === 'CallExpression' && e.callee.name === 'wire');

        if (wireDec) {
            const adapter = wireDec.arguments[0] && wireDec.arguments[0].name;
            const cfgNode = wireDec.arguments[1];
            const params = [];
            if (cfgNode && cfgNode.type === 'ObjectExpression') {
                for (const p of cfgNode.properties) {
                    const key = p.key.name || p.key.value;
                    let value = src(code, p.value);
                    let reactive = false;
                    // '$recordId' is a REACTIVE param — it is why the wire may
                    // not fire at all. It becomes a plain reference.
                    if (p.value.type === 'StringLiteral' && p.value.value.startsWith('$')) {
                        value = p.value.value.slice(1);
                        reactive = true;
                    }
                    params.push({ key, value, reactive });
                }
            }
            out.wires.push({
                property: name,
                adapter,
                module: importMap.get(adapter) || '(unresolved)',
                hook: LDS_ADAPTERS[adapter] || 'useApex',
                isApex: (importMap.get(adapter) || '').startsWith('@salesforce/apex/'),
                params
            });
            continue;
        }

        if (isApi) { out.apiProps.push(name); continue; }

        if (m.kind === 'get') {
            const body = m.body.body;
            if (body.length === 1 && body[0].type === 'ReturnStatement') {
                out.getters.push({ name, expr: deThis(src(code, body[0].argument)) });
            } else {
                out.getters.push({ name, block: deThis(src(code, m.body)) });
            }
            continue;
        }

        if (m.type === 'ClassMethod' && m.kind === 'method') {
            if (['connectedCallback', 'disconnectedCallback', 'renderedCallback',
                'errorCallback', 'render'].includes(name)) {
                out.lifecycle.push({ name, body: deThis(src(code, m.body)) });
                continue;
            }
            out.methods.push({
                name,
                params: m.params.map((p) => src(code, p)),
                body: deThis(src(code, m.body))
            });
            continue;
        }

        if (m.type === 'ClassProperty' || m.type === 'PropertyDefinition') {
            out.fields.push({ name, init: m.value ? deThis(src(code, m.value)) : 'undefined' });
        }
    }

    // Dispatched CustomEvents become callback props.
    const seen = new Set();
    (function visit(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (node.type === 'NewExpression' && node.callee.name === 'CustomEvent') {
            const evName = node.arguments[0] && node.arguments[0].value;
            let detail = null;
            const opts = node.arguments[1];
            if (opts && opts.type === 'ObjectExpression') {
                const d = opts.properties.find((p) => p.key && p.key.name === 'detail');
                if (d) detail = deThis(src(code, d.value));
            }
            if (evName) out.emittedEvents.push({ name: evName, detail });
        }
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v === 'object' && v.type) visit(v);
        }
    })(cls);

    return out;
}

/** Rewrite this.dispatchEvent(new CustomEvent('foo',{detail:D})) -> onFoo?.(D) */
function rewriteDispatches(body, events) {
    let out = body;
    for (const ev of events) {
        const handler = `on${pascal(ev.name)}`;
        const re = new RegExp(
            `dispatchEvent\\(\\s*new CustomEvent\\(\\s*['"\`]${ev.name}['"\`][\\s\\S]*?\\)\\s*\\)`,
            'g'
        );
        out = out.replace(re, `${handler}?.(${ev.detail || 'undefined'})`);
    }
    return out;
}

export function generateComponent({ js, html, name }) {
    const a = analyseComponentJs(js);
    const tpl = convertTemplate(html, { name });
    const Comp = pascal(name);
    const todos = [...a.todos];

    if (!tpl.ok) {
        for (const b of tpl.blockers) todos.push({ kind: 'template-blocker', detail: `LWC${b.code}: ${b.message}` });
        for (const e of tpl.escalations) todos.push({ kind: 'tier-h', detail: e });
    }
    for (const w of tpl.warnings) todos.push({ kind: `template-${w.kind}`, detail: w.message });

    /* ---- imports ---- */
    const shimHooks = [...new Set(a.wires.map((w) => w.hook))];
    const baseComponents = [...new Set(
        (tpl.jsx || '').match(/<(Card|Button|FormattedText|FormattedNumber)\b/g) || []
    )].map((m) => m.slice(1));

    // Generated code imports the PACKAGE, never a relative path — the output
    // must be independent of where it happens to be written, and this is the
    // name the runtime ships as.
    const importLines = ["import React from 'react';"];
    if (shimHooks.length) {
        importLines.push(`import { ${shimHooks.sort().join(', ')} } from '${RUNTIME_PKG}';`);
    }
    const uiImports = [...new Set([...baseComponents, 'Boundary'])].sort();
    importLines.push(`import { ${uiImports.join(', ')} } from '${RUNTIME_PKG}/components';`);
    for (const w of a.wires) {
        if (w.isApex) {
            importLines.push(`import ${w.adapter} from '${w.module}';`);
        }
    }

    /* ---- props ---- */
    const eventProps = [...new Set(a.emittedEvents.map((e) => `on${pascal(e.name)}`))];
    const props = [...a.apiProps, ...eventProps];

    /* ---- body ---- */
    const lines = [];

    for (const f of a.fields) {
        lines.push(`  // field: ${f.name} — LWC instance state`);
        lines.push(`  const [${f.name}] = React.useState(${f.init});`);
    }

    for (const w of a.wires) {
        const cfg = w.params.length
            ? `{ ${w.params.map((p) => (p.reactive ? `${p.key}: ${p.value}` : `${p.key}: ${p.value}`)).join(', ')} }`
            : '{}';
        // F1: the hook computes `enabled` from these params — an undefined
        // reactive param means zero calls, matching the LWC wire.
        lines.push(w.isApex
            ? `  const ${w.property} = ${w.hook}(${w.adapter}, ${cfg});`
            : `  const ${w.property} = ${w.hook}(${cfg});`);
    }

    for (const g of a.getters) {
        if (g.expr !== undefined) lines.push(`  const ${g.name} = ${g.expr};`);
        else {
            lines.push(`  const ${g.name} = (() => ${g.block})();`);
            todos.push({ kind: 'multi-statement-getter', detail: `get ${g.name}() has a block body — review.` });
        }
    }

    for (const m of a.methods) {
        const body = rewriteDispatches(m.body, a.emittedEvents);
        lines.push(`  const ${m.name} = (${m.params.join(', ')}) => ${body};`);
    }

    for (const lc of a.lifecycle) {
        if (lc.name === 'connectedCallback') {
            lines.push('  React.useEffect(() => ' + lc.body + ', []);');
            todos.push({ kind: 'lifecycle', detail: 'connectedCallback -> useEffect([]) — verify effect semantics.' });
        } else {
            lines.push(`  // TODO(${lc.name}): NOT auto-converted — Tier A. Original body:`);
            lines.push(...lc.body.split('\n').map((l) => `  //   ${l.trim()}`));
            todos.push({
                kind: 'lifecycle-manual',
                detail: `${lc.name} requires human translation (DOM timing / imperative access).`
            });
        }
    }

    // Every generated component declares its OWN boundary. Without it the
    // component is invisible to the oracle: the root normalises as whatever
    // it happens to render first (the Card, say), and the diff reports a
    // bogus root mismatch against the LWC's c-* element.
    // props mirror what LWC exposes for a c-* node — the @api surface.
    const ownProps = a.apiProps.length ? `{{ ${a.apiProps.join(', ')} }}` : '{{}}';
    const jsxIndented = [
        `    <Boundary name="${Comp}" props=${ownProps}>`,
        ...(tpl.jsx || '<></>').split('\n').map((l) => '      ' + l),
        '    </Boundary>'
    ].join('\n');

    const header = [
        '/**',
        ` * GENERATED from force-app/.../lwc/${name} by codemod/component.js.`,
        ' * Do not edit by hand — regenerate. Review every TODO before shipping.',
        todos.length
            ? ` * ${todos.length} item(s) need review; see the TODO block below.`
            : ' * No review items flagged.',
        ' */'
    ].join('\n');

    const todoBlock = todos.length
        ? '\n/* REVIEW REQUIRED:\n'
            + todos.map((t) => ` *  [${t.kind}] ${t.detail}`).join('\n') + '\n */\n'
        : '';

    const code = `${header}
${importLines.join('\n')}
${todoBlock}
export function ${Comp}({ ${props.join(', ')} }) {
${lines.join('\n')}

  return (
${jsxIndented}
  );
}
`;

    return { code, todos, componentName: Comp, analysis: a, template: tpl };
}
