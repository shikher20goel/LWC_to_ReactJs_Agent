/**
 * The ONLY place @lwc/template-compiler is imported.
 *
 * WHY THIS IS NOT VENDORED THE WAY apex-parser IS, AND NOT REWRITTEN
 *
 * The risk profiles are opposite. apex-parser's ecosystem has a track record
 * of abandonment, so its exact tarball is installed from `vendor/`. This
 * package published two days ago, has 880 versions, is MIT, and is maintained
 * by Salesforce in the LWC monorepo. Abandonment is not the risk here.
 *
 * And rewriting it would make this project WORSE, not more independent:
 *
 *   - Salesforce owns the LWC language and ships three releases a year. A
 *     hand-written parser is behind from the day it is written.
 *   - Divergence from real LWC semantics is the most dangerous failure mode
 *     this project has. The oracle's entire value rests on faithfully
 *     representing the ORIGINAL component; a parser that reads a template
 *     differently from the engine that renders it undermines the baseline
 *     everything is measured against.
 *   - The AST encodes TESTED behaviour, not arbitrary structure. The
 *     attribute-vs-property split is the clearest example: only `input.value`
 *     and `input.checked` promote to properties, and that is a rule with
 *     cases, not a principle you can re-derive.
 *
 * Critically, ONE instance is shared with @salesforce/sfdx-lwc-jest, so the
 * codemod parses templates with the same parser the oracle's renderer uses.
 * Installing from a vendored tarball risks npm creating a second copy and
 * silently breaking that. `vendor/lwc-template-compiler-8.28.2.tgz` is
 * committed as a RECOVERY artifact, not as the install source.
 *
 * What IS better than raw usage is this file: the ten traps from research/06
 * are encoded as helpers, so nobody has to rediscover them. Each one below
 * produced code that compiled and ran and was quietly wrong.
 */

import { parse } from '@lwc/template-compiler';

export const PARSER_ID = '@lwc/template-compiler@8.28.2';

/**
 * Diagnostics that mean "parsed, but do not migrate this".
 * The template is syntactically fine; the CONSTRUCT is unsafe to convert.
 */
export const BLOCKING_DIAGNOSTICS = new Set([
    1044,   // for:each without for:item
    1071,   // missing key inside an iterator
    1165    // lwc:elseif not immediately after lwc:if
]);

/**
 * Parse a template.
 *
 * TRAP 5: parse() NEVER THROWS. Invalid input returns `root: undefined` plus
 * warnings. Code that assumes an exception silently treats a failed parse as
 * an empty template — which converts to a valid, empty component.
 *
 * Returns a discriminated result so a caller cannot ignore that by accident.
 */
export function parseTemplate(source, { name = 'component', namespace = 'c' } = {}) {
    const { root, warnings = [] } = parse(source, { name, namespace });

    const blockers = warnings
        .filter((w) => BLOCKING_DIAGNOSTICS.has(w.code))
        .map((w) => ({ code: w.code, message: w.message }));

    if (!root) {
        return {
            ok: false,
            root: null,
            blockers: warnings.map((w) => ({ code: w.code, message: w.message })),
            warnings
        };
    }
    return { ok: blockers.length === 0, root, blockers, warnings };
}

/**
 * Walk the template AST.
 *
 * TRAP 1: `lwc:elseif` and `lwc:else` are NOT siblings in `children` — they
 * hang off `.else`. A three-branch chain has `root.children.length === 1`, so
 * a walker that only follows `children` silently drops branches and generates
 * a component missing its else path.
 *
 * This walker follows `.else`. Use it instead of writing your own.
 */
export function walkTemplate(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const child of node.children || []) walkTemplate(child, visit);
    if (node.else) walkTemplate(node.else, visit);   // the trap
}

/** Node types that are component boundaries. */
export const BOUNDARY_TYPES = new Set(['Component', 'ExternalComponent', 'Lwc']);

/**
 * TRAP 4: `Directive.name` holds the enum KEY, not the source string —
 * `key={x}` serialises as `{ name: 'Key' }`, not `'key'`. Same for Ref, Dom,
 * InnerHTML, Spread, On, Is, Dynamic, SlotBind, SlotData.
 */
export function getDirective(node, enumKey) {
    return (node.directives || []).find((d) => d.name === enumKey);
}

/**
 * TRAP 3: `if:false` is the SAME `If` node as `if:true`, distinguished only by
 * `modifier`. Emitting both identically inverts the condition on every
 * if:false in the codebase.
 */
export function conditionOf(node) {
    if (node.type === 'If') {
        return { expression: node.condition, negated: node.modifier === 'false' };
    }
    if (node.type === 'IfBlock' || node.type === 'ElseifBlock') {
        return { expression: node.condition, negated: false };
    }
    return null;
}

/**
 * TRAP 2: `iterator:name` produces type **'ForOf'**, not 'ForEach'. There is
 * no `for:of` directive in LWC — the enum name is a misnomer. Matching on
 * 'ForEach' alone silently skips every iterator template.
 */
export function iterationOf(node) {
    if (node.type === 'ForEach') {
        return {
            kind: 'forEach',
            list: node.expression,
            item: node.item,
            index: node.index || null
        };
    }
    if (node.type === 'ForOf') {
        return {
            kind: 'iterator',       // exposes .value/.index/.first/.last
            list: node.expression,
            iterator: node.iterator
        };
    }
    return null;
}

/**
 * TRAP 10: listener names arrive LOWERCASED with the `on` prefix stripped, so
 * `onMyCustomEvent` is indistinguishable from `onmycustomevent`. The original
 * casing is NOT mechanically recoverable.
 *
 * Returns `{ handler, recoverable }`. When `recoverable` is false the caller
 * must flag it rather than shipping a confident guess.
 */
export function listenerToReactProp(eventName, { isCustomComponent = false } = {}) {
    const DOM_EVENTS = {
        click: 'onClick', dblclick: 'onDoubleClick', change: 'onChange',
        input: 'onInput', submit: 'onSubmit', focus: 'onFocus', blur: 'onBlur',
        keydown: 'onKeyDown', keyup: 'onKeyUp', keypress: 'onKeyPress',
        mouseover: 'onMouseOver', mouseout: 'onMouseOut', mouseenter: 'onMouseEnter',
        mouseleave: 'onMouseLeave', mousedown: 'onMouseDown', mouseup: 'onMouseUp',
        scroll: 'onScroll', paste: 'onPaste', copy: 'onCopy', cut: 'onCut'
    };
    if (DOM_EVENTS[eventName]) return { handler: DOM_EVENTS[eventName], recoverable: true };
    return {
        handler: `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`,
        recoverable: !isCustomComponent
    };
}

/**
 * TRAP 6: text is split into one node per interpolation — `Hi {name}!` is
 * THREE Text nodes. TRAP 7: `Literal` has no `location`, unlike every other
 * node, so do not assume it is there.
 */
export function textOf(node) {
    if (node.type !== 'Text') return null;
    const v = node.value;
    if (v.type === 'Literal') return { kind: 'literal', value: String(v.value) };
    return { kind: 'expression', expression: v };
}

/**
 * TRAP 8: `MemberExpression` carries acorn's `computed` at runtime even though
 * the .d.ts omits it. Ignoring it turns `a[b]` into `a.b`.
 */
export function expressionToSource(e) {
    if (!e) return '';
    if (e.type === 'Literal') return JSON.stringify(e.value);
    if (e.type === 'Identifier') return e.name;
    if (e.type === 'MemberExpression') {
        const obj = expressionToSource(e.object);
        return e.computed
            ? `${obj}[${expressionToSource(e.property)}]`
            : `${obj}.${e.property.name}`;
    }
    return null;   // caller decides; do not invent an expression
}

/**
 * TRAP 9: LWC never renames `class` or `for`. React needs `className` and
 * `htmlFor`, and that translation is entirely ours.
 */
export const ATTR_RENAME = Object.freeze({ class: 'className', for: 'htmlFor' });
