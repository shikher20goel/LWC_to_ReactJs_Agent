/**
 * LWC TEMPLATE PARSER CONTRACT.
 *
 * The ten behaviours this project depends on, pinned. Every one of them
 * produced code that COMPILED AND RAN and was quietly wrong — which is why
 * they are worth a test each rather than a comment.
 *
 * If @lwc/template-compiler is ever upgraded and one of these fails, the
 * failure names exactly what changed. That is the point: an upgrade becomes a
 * diff against known behaviour instead of a gamble.
 */
import {
    parseTemplate, walkTemplate, getDirective, conditionOf, iterationOf,
    listenerToReactProp, textOf, expressionToSource, ATTR_RENAME,
    BLOCKING_DIAGNOSTICS, PARSER_ID
} from './lwc-parser.js';

const tpl = (inner) => `<template>${inner}</template>`;
const collect = (root, pred) => {
    const out = [];
    walkTemplate(root, (n) => { if (pred(n)) out.push(n); });
    return out;
};

describe('LWC PARSER CONTRACT — the ten traps', () => {
    it('identifies the parser version', () => {
        expect(PARSER_ID).toMatch(/@lwc\/template-compiler@\d+\.\d+\.\d+/);
    });

    it('TRAP 1: lwc:elseif/else hang off .else, not children', () => {
        const { root } = parseTemplate(tpl(`
            <template lwc:if={a}><p>A</p></template>
            <template lwc:elseif={b}><p>B</p></template>
            <template lwc:else><p>C</p></template>`));
        // The trap itself, pinned: a three-branch chain is ONE child.
        expect(root.children).toHaveLength(1);
        // ...and walkTemplate follows .else, so all three branches are seen.
        const texts = collect(root, (n) => n.type === 'Text')
            .map((n) => textOf(n).value);
        expect(texts).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    });

    it('TRAP 2: iterator:* is type ForOf, not ForEach', () => {
        const { root } = parseTemplate(tpl(
            '<template iterator:it={items}><li key={it.value.id}>{it.value.n}</li></template>'));
        const nodes = collect(root, (n) => iterationOf(n));
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe('ForOf');
        expect(iterationOf(nodes[0]).kind).toBe('iterator');
    });

    it('TRAP 3: if:false is the same node as if:true, only modifier differs', () => {
        const t = parseTemplate(tpl('<template if:true={x}><p>y</p></template>')).root;
        const f = parseTemplate(tpl('<template if:false={x}><p>y</p></template>')).root;
        const nodeT = collect(t, (n) => n.type === 'If')[0];
        const nodeF = collect(f, (n) => n.type === 'If')[0];
        expect(nodeT.type).toBe(nodeF.type);                 // identical type
        expect(conditionOf(nodeT).negated).toBe(false);
        expect(conditionOf(nodeF).negated).toBe(true);       // must be inverted
    });

    it('TRAP 4: Directive.name is the enum KEY ("Key", not "key")', () => {
        const { root } = parseTemplate(tpl(
            '<template for:each={rows} for:item="r"><li key={r.id}>{r.n}</li></template>'));
        const li = collect(root, (n) => n.name === 'li')[0];
        expect(getDirective(li, 'Key')).toBeDefined();
        expect(getDirective(li, 'key')).toBeUndefined();      // the trap
    });

    it('TRAP 5: parse() NEVER throws — bad input returns ok:false, not an error', () => {
        for (const bad of ['', '<template>', 'not html', '<div>x</div>']) {
            let r;
            expect(() => { r = parseTemplate(bad); }).not.toThrow();
            expect(r.ok).toBe(false);
            expect(r.root).toBeNull();
            expect(r.blockers.length).toBeGreaterThan(0);
        }
    });

    it('TRAP 5b: a template can parse and still be unsafe to migrate', () => {
        // Missing key inside an iterator: syntactically fine, LWC1071.
        const r = parseTemplate(tpl(
            '<template for:each={rows} for:item="r"><li>{r.n}</li></template>'));
        expect(r.root).toBeTruthy();          // parsed
        expect(r.ok).toBe(false);             // but blocked
        expect(r.blockers.some((b) => b.code === 1071)).toBe(true);
        expect(BLOCKING_DIAGNOSTICS.has(1071)).toBe(true);
    });

    it('TRAP 6: text splits one node per interpolation', () => {
        const { root } = parseTemplate(tpl('<div>Hi {name}!</div>'));
        const texts = collect(root, (n) => n.type === 'Text').map(textOf);
        expect(texts).toHaveLength(3);
        expect(texts[0]).toEqual({ kind: 'literal', value: 'Hi ' });
        expect(texts[1].kind).toBe('expression');
        expect(texts[2]).toEqual({ kind: 'literal', value: '!' });
    });

    it('TRAP 7: Literal nodes have no location, unlike every other node', () => {
        const { root } = parseTemplate(tpl('<div>plain</div>'));
        const div = collect(root, (n) => n.name === 'div')[0];
        expect(div.location).toBeDefined();
        const text = collect(root, (n) => n.type === 'Text')[0];
        expect(text.value.location).toBeUndefined();   // the trap
    });

    it('TRAP 8: MemberExpression carries computed at runtime', () => {
        const { root } = parseTemplate(tpl('<div>{a.b.c}</div>'));
        const expr = collect(root, (n) => n.type === 'Text')[0].value;
        expect(expr.type).toBe('MemberExpression');
        expect(expr).toHaveProperty('computed');       // absent from the .d.ts
        expect(expressionToSource(expr)).toBe('a.b.c');
    });

    it('TRAP 9: LWC never renames class/for — that translation is ours', () => {
        const { root } = parseTemplate(tpl('<label class="c" for="f">x</label>'));
        const label = collect(root, (n) => n.name === 'label')[0];
        const names = label.attributes.map((a) => a.name);
        expect(names).toContain('class');              // NOT className
        expect(names).toContain('for');                // NOT htmlFor
        expect(ATTR_RENAME.class).toBe('className');
        expect(ATTR_RENAME.for).toBe('htmlFor');
    });

    it('TRAP 10: listener casing is lowercased and NOT recoverable', () => {
        const { root } = parseTemplate(tpl('<c-child onmycustomevent={h}></c-child>'));
        const child = collect(root, (n) => n.name === 'c-child')[0];
        expect(child.listeners[0].name).toBe('mycustomevent');   // on- stripped, lowered

        const custom = listenerToReactProp('mycustomevent', { isCustomComponent: true });
        expect(custom.recoverable).toBe(false);        // must be flagged, not guessed
        const dom = listenerToReactProp('click');
        expect(dom).toEqual({ handler: 'onClick', recoverable: true });
    });
});

describe('LWC PARSER CONTRACT — attribute vs property split', () => {
    it('promotes ONLY input.value and input.checked to properties', () => {
        // A rule with cases, not a principle. Getting it wrong sends values
        // through the wrong channel on every form in the org.
        const { root } = parseTemplate(tpl(
            '<input value={v} checked={c} disabled={d} maxlength={m} />'));
        const input = (() => { let f = null; walkTemplate(root, (n) => { if (n.name === 'input') f = n; }); return f; })();
        const props = (input.properties || []).map((p) => p.name);
        const attrs = (input.attributes || []).map((a) => a.name);
        expect(props).toEqual(expect.arrayContaining(['value', 'checked']));
        expect(attrs).toEqual(expect.arrayContaining(['disabled', 'maxlength']));
    });

    it('keeps class/style/data-* as ATTRIBUTES even on a custom element', () => {
        const { root } = parseTemplate(tpl(
            '<c-child my-prop={x} class="k" data-foo="1"></c-child>'));
        const child = (() => { let f = null; walkTemplate(root, (n) => { if (n.name === 'c-child') f = n; }); return f; })();
        expect((child.properties || []).map((p) => p.name)).toContain('myProp');
        const attrs = (child.attributes || []).map((a) => a.name);
        expect(attrs).toEqual(expect.arrayContaining(['class', 'data-foo']));
    });
});
