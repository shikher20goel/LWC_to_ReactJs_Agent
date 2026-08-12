/**
 * Deterministic LWC template -> JSX codemod.
 *
 * Every construct handled here is a construct the LLM can no longer get
 * wrong. Target is >=60% of emitted output from codemods, not prompts.
 *
 * Built on @lwc/template-compiler 8.28.2, PINNED EXACTLY. The AST is an
 * internal API that is de-facto stable (deliberately stabilised in PR #2518),
 * but it arrives here transitively via sfdx-lwc-jest, so an unrelated Jest
 * bump could swap the parser under us. Do not unpin. Do not move to 9.x —
 * v9 made the main export ESM-only. See research/06 R4.7/R4.8.
 *
 * TRAPS ENCODED HERE — all verified against the real parser, see research/06:
 *  1. lwc:elseif / lwc:else are NOT siblings. They hang off `.else`, so a
 *     3-branch chain has root.children.length === 1. A naive sibling walker
 *     silently drops branches.
 *  2. iterator:* produces type 'ForOf' (not 'ForEach', and there is no
 *     for:of directive in LWC — the enum name is a misnomer).
 *  3. if:false is the SAME `If` node as if:true, distinguished only by
 *     `modifier`. Must negate on emit.
 *  4. Directive.name holds the enum KEY: 'Key', not 'key'.
 *  5. parse() NEVER throws. Bad input returns root: undefined + warnings.
 *  6. Text is split one node per interpolation.
 *  7. Literal nodes have no `location` — unlike every other node.
 *  8. MemberExpression carries acorn's `computed` at runtime even though the
 *     .d.ts omits it.
 *  9. class/for are never renamed by LWC — className/htmlFor are our job.
 * 10. Listener names arrive lowercased with the `on` prefix stripped, and
 *     custom-event casing is NOT mechanically recoverable.
 */

import { parse } from '@lwc/template-compiler';
import { loadCatalog } from '../catalog/load.js';
import { createStyleSheet } from './styles.js';

/** Diagnostics that mean "parsed, but do not migrate this". research/06 R4.5 */
const BLOCKING_DIAGNOSTICS = new Set([1044, 1071, 1165]);

// SINGLE SOURCE OF TRUTH: catalog/base-components.xml (O-9).
const CAT = loadCatalog();
const BASE_COMPONENTS = Object.fromEntries(CAT.all().map((c) => [c.tag, c.canonical]));
const TIER_H = CAT.tierH;

/** Plain-DOM events we can map with confidence. */
const DOM_EVENTS = {
    click: 'onClick', dblclick: 'onDoubleClick', change: 'onChange',
    input: 'onInput', submit: 'onSubmit', focus: 'onFocus', blur: 'onBlur',
    keydown: 'onKeyDown', keyup: 'onKeyUp', keypress: 'onKeyPress',
    mouseover: 'onMouseOver', mouseout: 'onMouseOut', mouseenter: 'onMouseEnter',
    mouseleave: 'onMouseLeave', mousedown: 'onMouseDown', mouseup: 'onMouseUp',
    scroll: 'onScroll', paste: 'onPaste', copy: 'onCopy', cut: 'onCut'
};

const ATTR_RENAME = { class: 'className', for: 'htmlFor' };

function pascal(name) {
    return name.replace(/^(c|lightning)-/, '')
        .split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function camel(name) {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function componentName(tag) {
    return BASE_COMPONENTS[tag] || pascal(tag);
}

/* ------------------------------------------------------------------ *
 * Expressions
 * ------------------------------------------------------------------ */

function exprToSource(e, ctx) {
    if (!e) return '';
    if (e.type === 'Literal') return JSON.stringify(e.value);
    if (e.type === 'Identifier') return e.name;
    if (e.type === 'MemberExpression') {
        const obj = exprToSource(e.object, ctx);
        // Trap 8: `computed` is present at runtime but absent from the .d.ts.
        if (e.computed) return `${obj}[${exprToSource(e.property, ctx)}]`;
        return `${obj}.${e.property.name}`;
    }
    if (e.type === 'ComplexExpression') {
        ctx.warn('complex-expression',
            'Template uses an experimental complex expression; emit by hand.');
        return '/* complex expression — review */ undefined';
    }
    ctx.warn('unknown-expression', `Unhandled expression node ${e.type}`);
    return 'undefined';
}

/* ------------------------------------------------------------------ *
 * Attributes / properties / listeners
 * ------------------------------------------------------------------ */

function valueToJsx(v, ctx) {
    if (!v) return null;
    if (v.type === 'Literal') {
        if (v.value === true) return null;               // bare boolean attr
        return JSON.stringify(String(v.value));
    }
    return `{${exprToSource(v, ctx)}}`;
}

function collectProps(node, ctx, isComponent) {
    const parts = [];

    for (const a of node.attributes || []) {
        if (a.name === 'slot') continue;                 // handled by grouping

        // SLDS classes are CONVERTED, not passed through. Emitting the raw
        // string would make the output depend on Salesforce's stylesheet
        // being loaded — i.e. not actually migrated.
        if (a.name === 'class' && a.value && a.value.type === 'Literal') {
            const { moduleClass, passthrough } = ctx.style(String(a.value.value));
            if (moduleClass && passthrough.length) {
                parts.push(`className={\`\${styles.${moduleClass}} ${passthrough.join(' ')}\`}`);
            } else if (moduleClass) {
                parts.push(`className={styles.${moduleClass}}`);
            } else if (passthrough.length) {
                parts.push(`className=${JSON.stringify(passthrough.join(' '))}`);
            }
            continue;
        }

        const name = ATTR_RENAME[a.name] || a.name;
        // React's style prop needs an OBJECT and throws on a string. LWC allows
        // both, including a computed string, so convert at runtime.
        if (a.name === 'style') {
            ctx.needsCssToStyle();
            const v = a.value;
            const inner = v && v.type === 'Literal'
                ? JSON.stringify(String(v.value))
                : exprToSource(v, ctx);
            parts.push(`style={cssToStyle(${inner})}`);
            continue;
        }
        const jsx = valueToJsx(a.value, ctx);
        parts.push(jsx === null ? name : `${name}=${jsx}`);
    }

    for (const p of node.properties || []) {
        // LWC already camelCases `name`; `attributeName` keeps the kebab form.
        const jsx = valueToJsx(p.value, ctx);
        parts.push(jsx === null ? p.name : `${p.name}=${jsx}`);
    }

    for (const l of node.listeners || []) {
        // Trap 10: `on` is stripped and the name is lowercased.
        let handlerName = DOM_EVENTS[l.name];
        if (!handlerName) {
            handlerName = `on${l.name.charAt(0).toUpperCase()}${l.name.slice(1)}`;
            if (isComponent) {
                ctx.warn('event-casing',
                    `Custom event "${l.name}" — LWC lowercases event names, so the `
                    + `original camelCase cannot be recovered. Emitted "${handlerName}"; verify.`);
            }
        }
        parts.push(`${handlerName}={${exprToSource(l.handler, ctx)}}`);
    }

    for (const d of node.directives || []) {
        // Trap 4: `name` is the enum KEY.
        if (d.name === 'Key') {
            parts.push(`key={${exprToSource(d.value, ctx)}}`);
        } else if (d.name === 'Ref') {
            ctx.warn('lwc-ref', `lwc:ref="${d.value.value}" needs a useRef — emitted as a comment.`);
        } else if (d.name === 'InnerHTML') {
            parts.push(`dangerouslySetInnerHTML={{ __html: ${exprToSource(d.value, ctx)} }}`);
            ctx.warn('inner-html', 'lwc:inner-html became dangerouslySetInnerHTML — review for XSS.');
        } else if (['Dynamic', 'Is', 'Spread', 'On', 'Dom', 'External'].includes(d.name)) {
            ctx.warn('unsupported-directive', `lwc:${d.name.toLowerCase()} is not auto-converted.`);
        }
    }

    return parts;
}

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */

const pad = (d) => '  '.repeat(d);

function emitChildren(children, depth, ctx) {
    return (children || [])
        .map((c) => emit(c, depth, ctx))
        .filter((s) => s !== null && s.trim() !== '');
}

function wrapExpr(body, depth) {
    return `${pad(depth)}{${body}}`;
}

function emit(node, depth, ctx) {
    switch (node.type) {
        case 'Root':
            return emitChildren(node.children, depth, ctx).join('\n');

        case 'Comment':
            return null;

        case 'Text': {
            // Trap 6: one Text node per interpolation.
            const v = node.value;
            if (v.type === 'Literal') {
                const t = String(v.value).replace(/\s+/g, ' ');
                return t.trim() ? `${pad(depth)}${t.trim()}` : null;
            }
            return wrapExpr(exprToSource(v, ctx), depth);
        }

        // Trap 1: the else chain hangs off `.else`, not off children.
        case 'IfBlock': {
            const cond = exprToSource(node.condition, ctx);
            const then = emitChildren(node.children, depth + 2, ctx).join('\n');
            let out = `${pad(depth)}{${cond} ? (\n${pad(depth + 1)}<>\n${then}\n${pad(depth + 1)}</>\n${pad(depth)}) : `;
            out += emitElse(node.else, depth, ctx);
            out += '}';
            return out;
        }

        // Trap 3: if:true and if:false are the same node type.
        case 'If': {
            const cond = exprToSource(node.condition, ctx);
            const guard = node.modifier === 'false' ? `!(${cond})` : cond;
            const body = emitChildren(node.children, depth + 2, ctx).join('\n');
            return `${pad(depth)}{${guard} && (\n${pad(depth + 1)}<>\n${body}\n${pad(depth + 1)}</>\n${pad(depth)})}`;
        }

        case 'ForEach': {
            const list = exprToSource(node.expression, ctx);
            const item = node.item ? node.item.name : 'item';
            const index = node.index ? node.index.name : null;
            ctx.pushScope([item, index].filter(Boolean));
            const body = emitChildren(node.children, depth + 2, ctx).join('\n');
            ctx.popScope();
            const args = index ? `(${item}, ${index})` : `(${item})`;
            return `${pad(depth)}{${list}.map(${args} => (\n${body}\n${pad(depth)}))}`;
        }

        // Trap 2: iterator:* lands as ForOf.
        case 'ForOf': {
            const list = exprToSource(node.expression, ctx);
            const it = node.iterator ? node.iterator.name : 'it';
            ctx.warn('iterator',
                `iterator:${it} exposes .value/.index/.first/.last — emitted a shim object; verify.`);
            ctx.pushScope([it]);
            const body = emitChildren(node.children, depth + 2, ctx).join('\n');
            ctx.popScope();
            return `${pad(depth)}{${list}.map((__v, __i, __a) => { `
                + `const ${it} = { value: __v, index: __i, first: __i === 0, last: __i === __a.length - 1 }; `
                + `return (\n${body}\n${pad(depth)}); })}`;
        }

        case 'Slot': {
            const name = node.slotName || '';
            return name
                ? `${pad(depth)}{props.slots?.${camel(name)}}`
                : `${pad(depth)}{children}`;
        }

        case 'Element':
        case 'Component':
        case 'ExternalComponent':
        case 'Lwc': {
            const isComponent = node.type !== 'Element';
            const tag = isComponent ? componentName(node.name) : node.name;

            if (TIER_H.has(node.name)) {
                ctx.escalate(node.name);
                return `${pad(depth)}{/* TIER-H: <${node.name}> not auto-converted. `
                    + `Metadata-driven layout / FLS. Emit a spec and build by hand. */}`;
            }
            if (isComponent && !BASE_COMPONENTS[node.name] && node.name.startsWith('lightning-')) {
                ctx.warn('uncatalogued-base',
                    `<${node.name}> is not in catalog/base-components.xml — do not invent a mapping.`);
            }

            if (isComponent && node.name.startsWith('c-')) ctx.child(tag);

            const props = collectProps(node, ctx, isComponent);
            const attrStr = props.length ? ' ' + props.join(' ') : '';
            const kids = emitChildren(node.children, depth + 1, ctx);

            if (!kids.length) return `${pad(depth)}<${tag}${attrStr} />`;
            return `${pad(depth)}<${tag}${attrStr}>\n${kids.join('\n')}\n${pad(depth)}</${tag}>`;
        }

        case 'ScopedSlotFragment':
            ctx.warn('scoped-slot', 'lwc:slot-data (scoped slots) needs a render prop — review.');
            return `${pad(depth)}{/* scoped slot — review */}`;

        default:
            ctx.warn('unknown-node', `Unhandled AST node type ${node.type}`);
            return null;
    }
}

function emitElse(node, depth, ctx) {
    if (!node) return 'null';
    const body = emitChildren(node.children, depth + 2, ctx).join('\n');
    const frag = `(\n${pad(depth + 1)}<>\n${body}\n${pad(depth + 1)}</>\n${pad(depth)})`;
    if (node.type === 'ElseBlock') return frag;
    // ElseifBlock — recurse down the chain.
    const cond = exprToSource(node.condition, ctx);
    return `${cond} ? ${frag} : ${emitElse(node.else, depth, ctx)}`;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function convertTemplate(source, { name = 'component', stylePreset } = {}) {
    const { root, warnings = [] } = parse(source, { name, namespace: 'c' });

    // Trap 5: parse() never throws.
    if (!root) {
        return {
            ok: false,
            jsx: null,
            blockers: warnings.map((w) => ({ code: w.code, message: w.message })),
            warnings: [],
            escalations: []
        };
    }

    const blockers = warnings
        .filter((w) => BLOCKING_DIAGNOSTICS.has(w.code))
        .map((w) => ({ code: w.code, message: w.message }));

    const sheet = createStyleSheet({ preset: stylePreset });
    const ctx = {
        _sheetRef: sheet,
        _warnings: [],
        _escalations: [],
        _children: new Set(),
        _needsCssToStyle: false,
        _sheet: null,
        _scopes: [],
        warn(kind, message) { this._warnings.push({ kind, message }); },
        escalate(tag) { this._escalations.push(tag); },
        child(name) { this._children.add(name); },
        needsCssToStyle() { this._needsCssToStyle = true; },
        style(classAttr) { return this._sheet.add(classAttr); },
        pushScope(names) { this._scopes.push(names); },
        popScope() { this._scopes.pop(); }
    };

    ctx._sheet = sheet;
    const jsx = emit(root, 0, ctx);

    return {
        ok: blockers.length === 0 && ctx._escalations.length === 0,
        jsx,
        blockers,
        warnings: ctx._warnings,
        escalations: ctx._escalations,
        childComponents: [...ctx._children],
        needsCssToStyle: ctx._needsCssToStyle,
        css: sheet.toCss(),
        usesStyles: !sheet.isEmpty,
        styleReports: sheet.reports
    };
}
