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
import { loadCatalog } from '../catalog/load.js';
import { loadPlatformModules } from '../catalog/slds-load.js';

const RUNTIME_PKG = '@migration/salesforce-runtime';

// catalog/platform-modules.xml — which lightning/* and @salesforce/* modules
// have an honest React equivalent, and which must escalate.
const PLATFORM = loadPlatformModules();

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

/**
 * `foo` -> `foo()` for names that were getters on the LWC class.
 *
 * deThis has already turned `this.foo` into a bare `foo`, so by the time this
 * runs a getter read is indistinguishable from a local variable read. The
 * guards below are what keep it from rewriting the wrong thing:
 *
 *   (?<![.\w$])  not a property access (`obj.foo`) and not mid-identifier
 *   (?!\s*[(:=]) not already a call, not an object-literal key, not the left
 *                side of an assignment
 *
 * A regex is the wrong tool for JS in general. It is used here because the
 * bodies are emitted as TEXT — component.js never rebuilds an AST — and
 * changing that is a much larger job than this fix. The guards make it safe
 * for the shapes that actually occur; anything stranger is caught by the
 * render smoke, which is where this class of bug was found in the first place.
 */
function rewriteGetterReads(text, getterNames) {
    if (!getterNames.length) return text;
    let out = text;
    for (const n of getterNames) {
        out = out.replace(
            new RegExp(`(?<![.\\w$])${n}(?!\\s*[(:=])(?![\\w$])`, 'g'),
            `${n}()`
        );
    }
    return out;
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
        apiProps: [], apiSetters: [], selfAssignedApiProps: new Set(),
        wires: [], getters: [], methods: [],
        fields: [], lifecycle: [], emittedEvents: [], imports: [],
        todos: []
    };

    const importMap = new Map();
    for (const n of ast.program.body) {
        if (n.type !== 'ImportDeclaration') continue;
        out.imports.push({ source: n.source.value, specifiers: n.specifiers.map((s) => s.local.name), text: src(code, n) });
        for (const s of n.specifiers) importMap.set(s.local.name, n.source.value);
    }
    out.importMap = importMap;

    // Module-level declarations. lwc-recipes/wireGetRecordStaticContact does
    // `const fields = [NAME_FIELD, ...]` at module scope and references it from
    // the @wire config — dropping these emits code with undefined identifiers.
    out.moduleConsts = ast.program.body
        .filter((n) => n.type === 'VariableDeclaration')
        .map((n) => src(code, n));

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
            // @wire has TWO forms and they are not interchangeable:
            //
            //   @wire(a, cfg) prop;              data lands IN prop
            //   @wire(a, cfg) handler({data,error}) {...}   the body RUNS
            //
            // Treating the handler form as the property form silently discards
            // the body — and the body is the only thing that moves the response
            // into the fields the template reads. On the first real org 10 of 13
            // wires were the handler form, so those components could never
            // display data no matter what the backend returned. They still
            // RENDERED, which is why nothing caught it.
            const isHandler = m.type === 'ClassMethod';
            out.wires.push({
                property: name,
                adapter,
                module: importMap.get(adapter) || '(unresolved)',
                hook: LDS_ADAPTERS[adapter] || 'useApex',
                isApex: (importMap.get(adapter) || '').startsWith('@salesforce/apex/'),
                params,
                isHandler,
                // The param is normally an ObjectPattern `{ error, data }`, but
                // `(result)` is legal too — keep the source text and let the
                // emitted IIFE bind whichever shape was written.
                handlerParam: isHandler && m.params[0] ? src(code, m.params[0]) : null,
                handlerBody: isHandler ? deThis(src(code, m.body)) : null
            });
            continue;
        }

        // ACCESSORS BEFORE @api.
        //
        // `@api get x()` is a PUBLIC GETTER — a value the component computes
        // and exposes read-only. It is not a prop the parent passes in.
        // Testing isApi first made it one, and the getter body was discarded
        // entirely: a component whose whole job was building a classification
        // tree emitted an empty render, with "No review items flagged". Silent
        // loss of the only logic in the file.
        if (m.kind === 'get') {
            const body = m.body.body;
            if (body.length === 1 && body[0].type === 'ReturnStatement') {
                out.getters.push({ name, expr: deThis(src(code, body[0].argument)) });
            } else {
                out.getters.push({ name, block: deThis(src(code, m.body)) });
            }
            if (isApi) {
                out.todos.push({
                    kind: 'api-getter',
                    detail: `@api get ${name}() is PUBLIC — a parent could read it off the `
                        + 'element. React has no equivalent to reading a child\'s value: '
                        + 'lift the computation to the parent, or expose it with '
                        + 'useImperativeHandle. Kept as a local computed value for now.'
                });
            }
            continue;
        }

        if (m.kind === 'set') {
            // `@api set x(v)` IS written by the parent, so it stays a prop —
            // but the setter BODY runs on every write and has nowhere to go in
            // a function component. Emitting the prop while dropping the body
            // would look converted and silently skip the side effect.
            out.apiSetters.push({ name, body: deThis(src(code, m.body)) });
            out.todos.push({
                kind: 'api-setter',
                detail: `@api set ${name}(v) has a body that runs whenever the parent `
                    + 'writes it. Props are read-only in React — port the body to a '
                    + `React.useEffect on [${name}] and verify ordering.`
            });
            continue;
        }

        if (isApi) { out.apiProps.push(name); continue; }

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

    // IMPLICIT INSTANCE FIELDS.
    //
    // LWC does not require a field to be declared. `this.foo = []` anywhere in
    // the class creates it, because the component is a plain JS object. React
    // has no `this`, so once deThis() strips the prefix the name is a bare
    // identifier that nothing declares — "allProfileAttributeData is not
    // defined", and the whole component is blank.
    //
    // Found on profileAttributeDemo1, which fails identically to its LWC with
    // no props (so the differential smoke called it faithful) and diverges only
    // once a recordId is supplied. That is why the differential probes more
    // than one input state.
    const declared = new Set([
        ...out.fields.map((f) => f.name),
        ...out.apiProps,
        ...out.apiSetters.map((s) => s.name),
        ...out.getters.map((g) => g.name),
        ...out.methods.map((m) => m.name),
        ...out.wires.map((w) => w.property)
    ]);
    // @api PROPS THE COMPONENT WRITES TO ITSELF.
    //
    // `@api isDisabled = false;` plus `this.isDisabled = true` is legal LWC —
    // the component is a plain object and a public property is still its own
    // field. In React a prop is read-only and arrives as a const, so the same
    // line throws "Assignment to constant variable".
    //
    // Only reachable once data flows: the assignment sits in the branch that
    // runs when the wire returns rows, so the empty preview never hit it. It
    // surfaced the moment synthetic data was switched on.
    for (const m2 of String(src(code, cls.body)).matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*[-+*/?]?=[^=]/g)) {
        if (out.apiProps.includes(m2[1])) out.selfAssignedApiProps.add(m2[1]);
    }

    const implicit = new Set();
    // `this.x =` (or +=, ??=, ...) anywhere in the class body.
    for (const m of String(src(code, cls.body)).matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*[-+*/?]?=[^=]/g)) {
        if (!declared.has(m[1])) implicit.add(m[1]);
    }
    for (const name of implicit) {
        out.fields.push({ name, init: 'undefined' });
        out.todos.push({
            kind: 'implicit-field',
            detail: `"${name}" is never declared on the class — LWC created it on first `
                + 'assignment. Emitted as component state so the reference resolves; '
                + 'confirm it is really per-instance state and not a typo for a '
                + 'declared field.'
        });
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

/**
 * Rewrite assignments to LWC instance fields into React state setters.
 *
 * An LWC field is mutable instance state: `this.isVisible = true` re-renders.
 * Emitting `const [isVisible] = useState(...)` and leaving the assignment
 * alone produces "Assignment to constant variable" — caught here only because
 * a REAL component (lwc-recipes helloConditionalRendering) does exactly this.
 * The synthetic components never mutated state, so this was invisible.
 *
 * Handles the statement forms that actually occur; anything else is FLAGGED
 * rather than mangled.
 */
function rewriteStateAssignments(body, fieldNames, todos, where) {
    if (!fieldNames.length) return body;
    let out = body;

    for (const f of fieldNames) {
        const setter = `set${pascal(f)}`;
        // x = expr;  -> setX(expr);
        // [\s\S]+? not [^;\n]+ : real components wrap long assignments across
        // lines. lwc-recipes/eventWithData does exactly that, and a
        // newline-excluding pattern silently skipped it.
        out = out.replace(
            new RegExp(`(^|[\\s{;])${f}\\s*=\\s*([\\s\\S]+?);`, 'g'),
            (_m, pre, expr) => `${pre}${setter}(${expr.replace(/\s+/g, ' ').trim()});`
        );
        // x += expr;  x -= expr;  -> setX(x + (expr));
        out = out.replace(
            new RegExp(`(^|[\\s{;])${f}\\s*([+\\-*/])=\\s*([\\s\\S]+?);`, 'g'),
            (_m, pre, op, expr) => `${pre}${setter}(${f} ${op} (${expr.replace(/\s+/g, ' ').trim()}));`
        );
        // x++ / x--
        out = out.replace(
            new RegExp(`(^|[\\s{;])${f}\\+\\+\\s*;`, 'g'),
            (_m, pre) => `${pre}${setter}(${f} + 1);`
        );
        out = out.replace(
            new RegExp(`(^|[\\s{;])${f}--\\s*;`, 'g'),
            (_m, pre) => `${pre}${setter}(${f} - 1);`
        );

        // Anything left that still assigns to the bare field was not a form we
        // handle — say so instead of shipping code that throws at runtime.
        if (new RegExp(`(^|[\\s{;])${f}\\s*[+\\-*/]?=[^=]`).test(out)) {
            todos.push({
                kind: 'state-assignment',
                detail: `${where}: assignment to "${f}" could not be rewritten to a `
                    + `React setter automatically. Convert it to ${setter}(...) by hand.`
            });
        }
    }
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

export function generateComponent({ js, html, name, knownComponents = new Set(), componentDirs = new Map() }) {
    const a = analyseComponentJs(js);

    // An `@api set x(v)` IS parent-written, so it belongs in the props
    // signature; an `@api get x()` is not. Where a class declares BOTH for one
    // name the prop wins and the getter is dropped — declaring
    // `const x = () => ...` alongside a destructured `x` is a duplicate
    // binding and will not parse.
    //
    // Computed here, before the template runs, because the template needs to
    // know which names became lazy functions: `{foo}` has to become `{foo()}`
    // for a getter and stay `{foo}` for a prop.
    const setterNames = a.apiSetters.map((s) => s.name);
    const propNames = [...new Set([...a.apiProps, ...setterNames])];
    const lazyGetters = a.getters.filter((g) => !propNames.includes(g.name));
    const lazyNames = lazyGetters.map((g) => g.name);

    const tpl = convertTemplate(html, { name, getters: lazyNames });
    const Comp = pascal(name);
    const todos = [...a.todos];

    if (!tpl.ok) {
        for (const b of tpl.blockers) todos.push({ kind: 'template-blocker', detail: `LWC${b.code}: ${b.message}` });
        for (const e of tpl.escalations) todos.push({ kind: 'tier-h', detail: e });
    }
    for (const w of tpl.warnings) todos.push({ kind: `template-${w.kind}`, detail: w.message });

    /* ---- imports ---- */
    const shimHooks = [...new Set(a.wires.map((w) => w.hook))];
    // Derive from the CATALOG, never a hardcoded list. A hardcoded one silently
    // omits imports for newly catalogued components, and the generated file
    // then references an undefined identifier — caught only at runtime.
    const canonicalNames = new Set(
        loadCatalog().all().filter((c) => c.tier !== 'H').map((c) => c.canonical)
    );
    const used = new Set();
    for (const m of (tpl.jsx || '').matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
        if (canonicalNames.has(m[1])) used.add(m[1]);
    }
    const baseComponents = [...used];

    // Generated code imports the PACKAGE, never a relative path — the output
    // must be independent of where it happens to be written, and this is the
    // name the runtime ships as.
    const importLines = ["import React from 'react';"];
    // CSS Module: generated components must not depend on Salesforce's
    // stylesheet being present, or nothing was actually migrated.
    if (tpl.usesStyles) importLines.push(`import styles from './${Comp}.module.css';`);
    if (shimHooks.length) {
        importLines.push(`import { ${shimHooks.sort().join(', ')} } from '${RUNTIME_PKG}';`);
    }
    const uiImports = [...new Set([...baseComponents, 'Boundary',
        ...(tpl.needsCssToStyle ? ['cssToStyle'] : [])])].sort();
    importLines.push(`import { ${uiImports.join(', ')} } from '${RUNTIME_PKG}/components';`);

    // Pass through the imports the component still needs. Dropping these emits
    // undefined identifiers — e.g. lwc-recipes/wireGetRecordStaticContact
    // imports four @salesforce/schema field tokens and getFieldValue.
    const LDS_HOOKS = new Set(Object.keys(LDS_ADAPTERS));
    const wireAdapters = new Set(a.wires.map((w) => w.adapter));
    for (const imp of a.imports) {
        const src2 = imp.source;
        if (src2 === 'lwc') continue;                          // decorators are gone
        if (src2.startsWith('@salesforce/apex/')) continue;    // handled by the wire
        if (src2 === 'lightning/uiRecordApi') {
            // Adapters became hooks; the helpers come from the runtime shim.
            const helpers = imp.specifiers.filter(
                (n) => !LDS_HOOKS.has(n) && !wireAdapters.has(n)
            );
            if (helpers.length) {
                importLines.push(`import { ${helpers.sort().join(', ')} } from '${RUNTIME_PKG}';`);
            }
            continue;
        }
        if (src2.startsWith('@salesforce/schema/')) {
            importLines.push(`import ${imp.specifiers[0]} from '${src2}';`);
            continue;
        }
        // c/* is a SIBLING component, not a platform module. It resolves to
        // the generated .jsx next door.
        if (src2.startsWith('c/')) {
            const child = pascal(src2.slice(2));
            if (knownComponents.has(child)) {
                const dir2 = componentDirs.get(child) || child;
                importLines.push(`import { ${child} } from '../${dir2}/${child}.jsx';`);
            } else {
                todos.push({
                    kind: 'missing-dependency',
                    detail: `${src2} is imported but was not part of this conversion set.`
                });
            }
            continue;
        }

        // Platform modules are CLASSIFIED, not guessed. catalog/platform-modules.xml
        // records which have an honest React equivalent and which do not.
        const mod = PLATFORM.lookup(src2);
        if (mod && mod.status === 'shim') {
            const names = mod.react.length ? mod.react : imp.specifiers;
            importLines.push(`import { ${names.join(', ')} } from '${RUNTIME_PKG}';`);
            if (mod.note) todos.push({ kind: 'platform-shim', detail: `${src2}: ${mod.note}` });
            continue;
        }
        if (mod && mod.status === 'token') {
            importLines.push(`// ${src2} -> ${mod.react.join(', ') || 'build-time value'}`);
            todos.push({
                kind: 'platform-token',
                detail: `${src2} is a compile-time value the platform injects. `
                    + `Becomes ${mod.react.join(', ') || 'a build-time constant'}.`
                    + (mod.note ? ` ${mod.note}` : '')
            });
            continue;
        }
        if (mod && mod.status === 'escalate') {
            importLines.push(`// ESCALATED: ${src2} — ${mod.reason}`);
            todos.push({
                kind: 'platform-escalate',
                detail: `${src2} has NO honest React equivalent. ${mod.reason}`
            });
            continue;
        }

        // A RELATIVE import is a plain .js module sitting inside the LWC
        // bundle — a label map, a utility, a section builder. It is ordinary
        // JavaScript with nothing Salesforce-specific to translate, so it is
        // copied next to the generated component (see codemod/generate.js) and
        // the import passes through unchanged.
        //
        // Turning it into a TODO instead deleted the binding, and
        // `@track labels = labels` then became a self-referencing useState:
        // "Cannot access 'labels' before initialization". The component died
        // on a file the codemod never needed to touch.
        if (src2.startsWith('./') || src2.startsWith('../')) {
            importLines.push(imp.text || `import ${imp.specifiers.join(', ')} from '${src2}';`);
            continue;
        }

        importLines.push(
            `// TODO: unmapped import — ${src2} (${imp.specifiers.join(', ')})`
        );
        todos.push({
            kind: 'unmapped-import',
            detail: `${src2} is not in catalog/platform-modules.xml. Classify it there.`
        });
    }

    // Child c-* components. Without these the generated file references an
    // undefined identifier — every multi-component conversion breaks at
    // runtime, and nothing catches it until render.
    const missingChildren = [];
    for (const child of (tpl.childComponents || []).sort()) {
        if (knownComponents.has(child)) {
            // Each component lives in its own folder named after the LWC
            // bundle, so a sibling is one level up and back down.
            const dir = componentDirs.get(child) || child;
            importLines.push(`import { ${child} } from '../${dir}/${child}.jsx';`);
        } else {
            todos.push({
                kind: 'missing-dependency',
                detail: `<${child}> is used but was not part of this conversion set. `
                    + 'Convert it too. A labelled placeholder is rendered in its place '
                    + 'so the gap is visible in the preview instead of crashing it.'
            });
            // A bare `<Example1/>` with no import is "Example1 is not defined" —
            // the whole component is blank and the developer sees a stack
            // trace, not the hole. The placeholder is deliberately loud and
            // deliberately NOT an approximation of the child: it renders the
            // name and nothing else, so it can never be mistaken for working
            // output, and the oracle sees a boundary where the child belongs
            // rather than a missing subtree.
            missingChildren.push(child);
        }
    }
    for (const w of a.wires) {
        if (w.isApex) {
            importLines.push(`import ${w.adapter} from '${w.module}';`);
        }
    }

    /* ---- props ---- */
    const eventProps = [...new Set(a.emittedEvents.map((e) => `on${pascal(e.name)}`))];
    // A default <slot> emits {children}; without destructuring it the generated
    // component throws "children is not defined" at render.
    const usesChildren = /\{children\}/.test(tpl.jsx || '');
    // A prop the component writes to itself is BOTH a prop and state: the
    // parent supplies the initial value, the component owns it afterwards.
    // Destructured under a private name so the state variable can keep the
    // original one and every existing reference stays correct.
    const selfWritten = [...a.selfAssignedApiProps];
    const props = [...propNames.map((p) => (selfWritten.includes(p) ? `${p}: ${p}__prop` : p)),
        ...eventProps, ...(tpl.namedSlots || []),
        ...(usesChildren ? ['children'] : [])];

    /* ---- body ---- */
    const lines = [];

    // LWC fields are MUTABLE instance state -> React state, with a setter.
    const fieldNames = [...a.fields.map((f) => f.name), ...selfWritten];
    for (const f of a.fields) {
        lines.push(`  const [${f.name}, set${pascal(f.name)}] = React.useState(${f.init});`);
    }
    for (const p of selfWritten) {
        lines.push(`  const [${p}, set${pascal(p)}] = React.useState(${p}__prop);`);
        todos.push({
            kind: 'self-written-api-prop',
            detail: `@api ${p} is written by the component itself, which LWC allows and `
                + 'React does not — a prop is read-only. Seeded from the prop and owned '
                + 'locally afterwards, so a LATER change from the parent no longer '
                + `propagates. If the parent is meant to drive ${p}, add a `
                + `useEffect syncing it; if the component owns it, it should not be @api.`
        });
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

        if (!w.isHandler) continue;

        // THE HANDLER FORM. Its body is what moves the response into the
        // fields the template reads, so dropping it produces a component that
        // renders correctly and is permanently empty.
        //
        // The body is replayed through an IIFE rather than inlined, so the
        // original parameter pattern binds exactly as written — `{ error, data }`
        // and `(result)` are both legal and destructure differently.
        //
        // The hook result is kept under its own name as well, because
        // refreshApex(this.wiredContacts) refers to the wire handle.
        let hb = rewriteDispatches(w.handlerBody, a.emittedEvents);
        hb = rewriteStateAssignments(hb, fieldNames, todos, `@wire ${w.property}()`);
        hb = rewriteGetterReads(hb, lazyNames);
        const param = w.handlerParam ? `(${w.handlerParam})` : '()';
        lines.push(`  React.useEffect(() => {`);
        lines.push(`    (${param} => ${hb})`
            + `({ data: ${w.property}.data, error: ${w.property}.error });`);
        lines.push(`    // eslint-disable-next-line react-hooks/exhaustive-deps`);
        lines.push(`  }, [${w.property}.data, ${w.property}.error]);`);
        todos.push({
            kind: 'wire-handler',
            detail: `@wire ${w.property}() is the HANDLER form — its body runs on every `
                + 'emission. Replayed in a useEffect keyed on data/error. LWC runs it '
                + 'BEFORE render and this runs after, so there is one extra render with '
                + 'the previous values; observably equivalent once settled, but verify '
                + 'if the body has side effects beyond setting state.'
        });
    }

    // GETTERS STAY LAZY.
    //
    // An LWC getter runs only when something READS it, and runs again on every
    // read. `const x = expr;` runs once, always, before the first render —
    // which is a different program. It matters because a getter guarded by
    // `<template if:true={open}>` is never called while `open` is false, so it
    // is routinely written assuming data that has not arrived yet:
    //
    //     get options() { return this.items.map(...); }   // items is @api
    //
    // Hoisted, that throws before anything renders. On the first real org this
    // blanked 4 components whose LWC originals were fine. A zero-arg function
    // reproduces both properties — lazy, and re-evaluated per read.
    const callGetters = (src) => rewriteGetterReads(src, lazyNames);

    for (const g of lazyGetters) {
        const others = lazyNames.filter((n) => n !== g.name);
        if (g.expr !== undefined) {
            lines.push(`  const ${g.name} = () => (${rewriteGetterReads(g.expr, others)});`);
        } else {
            // A getter that WRITES a field is legal in LWC and common in
            // practice — `if (this.x === undefined) this.x = [];` as a lazy
            // init. Without this rewrite the assignment targets the `const`
            // that useState destructures and throws "Assignment to constant
            // variable", which the plain smoke never sees because the getter
            // is lazy and only runs once real data arrives.
            let body = rewriteGetterReads(g.block, others);
            const before = body;
            body = rewriteStateAssignments(body, fieldNames, todos, `get ${g.name}()`);
            if (body !== before) {
                todos.push({
                    kind: 'render-phase-write',
                    detail: `get ${g.name}() writes component state while rendering. React `
                        + 'allows this for the same component and re-renders immediately, '
                        + 'so a guarded lazy-init converges — but an UNGUARDED write loops '
                        + 'forever. Verify the write is conditional.'
                });
            }
            lines.push(`  const ${g.name} = () => ${body};`);
            todos.push({ kind: 'multi-statement-getter', detail: `get ${g.name}() has a block body — review.` });
        }
    }

    for (const m of a.methods) {
        let body = rewriteDispatches(m.body, a.emittedEvents);
        body = rewriteStateAssignments(body, fieldNames, todos, `${m.name}()`);
        lines.push(`  const ${m.name} = (${m.params.join(', ')}) => ${callGetters(body)};`);
    }

    for (const lc of a.lifecycle) {
        if (lc.name === 'connectedCallback') {
            // connectedCallback is where a component seeds its state from its
            // props, so it assigns to fields more than any other member — and
            // it was the one body that never went through the setter rewrite.
            // `classificationApiName = classificationData.apiName;` then targets
            // the const that useState destructures: "Assignment to constant
            // variable", reachable only once data arrives.
            let body = rewriteDispatches(lc.body, a.emittedEvents);
            body = rewriteStateAssignments(body, fieldNames, todos, 'connectedCallback()');
            body = rewriteGetterReads(body, lazyNames);
            lines.push(`  React.useEffect(() => ${body}, []);`);
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

    const moduleConstBlock = (a.moduleConsts || []).length
        ? `\n${a.moduleConsts.join('\n')}\n`
        : '';

    // Stand-ins for children that were not converted. See the missing-dependency
    // branch above for why these exist rather than a bare undefined reference.
    const placeholderBlock = missingChildren.length
        ? '\n/* NOT CONVERTED — placeholders so the gap is visible instead of fatal.\n'
            + ' * Replace each with the real import once the child is converted. */\n'
            + missingChildren.map((c) => `const ${c} = (props) => (\n`
                + `  <Boundary name="${c}" props={props} base>\n`
                + `    <span data-not-converted="${c}">[ ${c} — not converted ]</span>\n`
                + '  </Boundary>\n);').join('\n') + '\n'
        : '';

    const code = `${header}
${importLines.join('\n')}
${todoBlock}${moduleConstBlock}${placeholderBlock}
export function ${Comp}({ ${props.join(', ')} }) {
${lines.join('\n')}

  return (
${jsxIndented}
  );
}
`;

    return {
        code, todos, componentName: Comp, analysis: a, template: tpl,
        css: tpl.css || '', usesStyles: Boolean(tpl.usesStyles),
        styleReports: tpl.styleReports || []
    };
}
