/**
 * Codemod tests — one per AST trap verified in research/06.
 *
 * These are regression locks. Each corresponds to a documented way the
 * @lwc/template-compiler AST differs from what a reasonable person would
 * assume. If one fails after a dependency bump, the parser changed shape and
 * the codemod is silently emitting wrong code.
 */
import { convertTemplate } from './template.js';

const conv = (src, name = 'x') => convertTemplate(src, { name });
const tpl = (inner) => `<template>${inner}</template>`;

describe('CODEMOD — template to JSX', () => {
    it('TRAP 1: lwc:if/elseif/else are chained on .else, not siblings', () => {
        // root.children.length === 1 for a 3-branch chain. A sibling walker
        // silently drops the elseif and else branches.
        const r = conv(tpl(`
            <template lwc:if={a}><p>AAA</p></template>
            <template lwc:elseif={b}><p>BBB</p></template>
            <template lwc:else><p>CCC</p></template>`));
        expect(r.ok).toBe(true);
        expect(r.jsx).toContain('AAA');
        expect(r.jsx).toContain('BBB');
        expect(r.jsx).toContain('CCC');
        expect(r.jsx).toContain('a ?');
        expect(r.jsx).toContain('b ?');
    });

    it('TRAP 2: iterator:* lands as ForOf and exposes value/index/first/last', () => {
        const r = conv(tpl(`
            <template iterator:it={items}>
                <li key={it.value.id}>{it.value.name}</li>
            </template>`));
        expect(r.jsx).toContain('.map(');
        expect(r.jsx).toContain('const it = {');
        expect(r.jsx).toContain('first:');
        expect(r.jsx).toContain('last:');
        expect(r.warnings.some((w) => w.kind === 'iterator')).toBe(true);
    });

    it('TRAP 3: if:false is the same node as if:true and must be negated', () => {
        const t = conv(tpl('<template if:true={open}><p>Y</p></template>'));
        const f = conv(tpl('<template if:false={open}><p>Y</p></template>'));
        expect(t.jsx).toContain('{open && (');
        expect(f.jsx).toContain('{!(open) && (');
    });

    it('TRAP 4: Directive.name holds the enum KEY ("Key", not "key")', () => {
        const r = conv(tpl(`
            <template for:each={rows} for:item="row">
                <li key={row.id}>{row.label}</li>
            </template>`));
        expect(r.jsx).toContain('key={row.id}');
        // `(rows ?? [])`, not `rows` — for:each over undefined renders nothing
        // in LWC and throws in JS. Measured in fixtures/nullSafety.test.js.
        expect(r.jsx).toContain('(rows ?? []).map((row) =>');
    });

    it('GUARDS the iterated list but NOT member access', () => {
        // Two different LWC behaviours, so two different translations. Guarding
        // member access as well would hide a crash the original also had.
        const r = conv(tpl(`
            <template for:each={data.rows} for:item="row">
                <li key={row.id}>{row.owner.name}</li>
            </template>`));
        expect(r.jsx).toContain('(data.rows ?? []).map(');
        expect(r.jsx).toContain('{row.owner.name}');
        expect(r.jsx).not.toContain('?.');
    });

    it('calls a getter instead of reading it as a value', () => {
        // LWC getters are lazy; the codemod emits them as zero-arg functions,
        // so every template reference has to be a CALL. A missed one renders
        // "function () { ... }" as text, or silently as [object Object].
        const r = convertTemplate(tpl('<div>{fullName}</div><p>{plain}</p>'),
            { name: 'x', getters: ['fullName'] });
        expect(r.jsx).toContain('{fullName()}');
        expect(r.jsx).toContain('{plain}');
    });

    it('does NOT call a for:item that shadows a getter name', () => {
        // The loop variable wins inside the loop, exactly as in LWC. Calling
        // it would invoke a plain object.
        const r = convertTemplate(tpl(`
            <template for:each={rows} for:item="label">
                <li key={label.id}>{label.text}</li>
            </template>`), { name: 'x', getters: ['label'] });
        expect(r.jsx).toContain('{label.text}');
        expect(r.jsx).not.toContain('label()');
    });

    it('TRAP 5: parse() never throws — bad input returns ok:false with blockers', () => {
        for (const bad of ['', '<template>', 'not html at all', '<div>nope</div>']) {
            let r;
            expect(() => { r = conv(bad); }).not.toThrow();
            expect(r.ok).toBe(false);
            expect(r.jsx).toBeNull();
            expect(r.blockers.length).toBeGreaterThan(0);
        }
    });

    it('TRAP 6: text is split one node per interpolation', () => {
        const r = conv(tpl('<div>Hi {name}!</div>'));
        expect(r.jsx).toContain('Hi');
        expect(r.jsx).toContain('{name}');
        expect(r.jsx).toContain('!');
    });

    it('TRAP 9: class/for are never renamed by LWC — we emit className/htmlFor', () => {
        const r = conv(tpl('<label class="lbl" for="fld">Name</label>'));
        expect(r.jsx).toContain('className="lbl"');
        expect(r.jsx).toContain('htmlFor="fld"');
        expect(r.jsx).not.toContain(' class=');
    });

    it('TRAP 10: custom-event casing is unrecoverable and must be FLAGGED', () => {
        // LWC lowercases event names. onmycustomevent cannot be mechanically
        // recovered as onMyCustomEvent — guessing silently would be worse
        // than saying so.
        const r = conv(tpl('<c-child onmycustomevent={h}></c-child>'));
        expect(r.jsx).toContain('onMycustomevent={h}');
        expect(r.warnings.some((w) => w.kind === 'event-casing')).toBe(true);
    });

    it('maps DOM events with confidence, no warning', () => {
        const r = conv(tpl('<button onclick={go}>Go</button>'));
        expect(r.jsx).toContain('onClick={go}');
        expect(r.warnings.some((w) => w.kind === 'event-casing')).toBe(false);
    });

    it('ESCALATES Tier-H instead of emitting code for it', () => {
        // CLAUDE.md rule 4: never emit code for a Tier-H construct.
        const r = conv(tpl('<lightning-record-edit-form record-id={id}></lightning-record-edit-form>'));
        expect(r.ok).toBe(false);
        expect(r.escalations).toContain('lightning-record-edit-form');
        expect(r.jsx).toContain('TIER-H');
        expect(r.jsx).not.toContain('<RecordEditForm');
    });

    it('refuses to invent a mapping for an uncatalogued base component', () => {
        // CLAUDE.md rule 3. Uses a tag deliberately ABSENT from
        // catalog/base-components.xml — if someone catalogues combobox later,
        // this test should be repointed, not deleted.
        // Repointed once already: combobox was catalogued after this test was
        // written, and the test correctly failed rather than silently passing.
        // If carousel gets catalogued too, repoint again — do not delete.
        const r = conv(tpl('<lightning-carousel items={o}></lightning-carousel>'));
        expect(r.warnings.some((w) => w.kind === 'uncatalogued-base')).toBe(true);
    });

    it('escalates a catalogued Tier-H component rather than warning', () => {
        // tree-grid IS catalogued (tier="H"), so it must take the escalation
        // path, not the uncatalogued path. These are different failures and
        // the agent must not confuse "I do not know this" with "this cannot
        // be auto-converted".
        const r = conv(tpl('<lightning-tree-grid data={d}></lightning-tree-grid>'));
        expect(r.escalations).toContain('lightning-tree-grid');
        expect(r.warnings.some((w) => w.kind === 'uncatalogued-base')).toBe(false);
    });

    it('treats a missing iterator key (LWC1071) as a migration blocker', () => {
        // parse() "succeeds" here — the diagnostic is the only signal.
        const r = conv(tpl(`
            <template for:each={rows} for:item="row">
                <li>{row.label}</li>
            </template>`));
        expect(r.ok).toBe(false);
        expect(r.blockers.some((b) => b.code === 1071)).toBe(true);
    });

    it('maps catalogued base components to canonical names', () => {
        const r = conv(tpl('<lightning-card title="T"><p>body</p></lightning-card>'));
        expect(r.jsx).toContain('<Card title="T">');
    });

    it('maps c-* children to PascalCase with camelCased props', () => {
        const r = conv(tpl('<c-broker-card broker-name={n} broker-id={i}></c-broker-card>'));
        expect(r.jsx).toContain('<BrokerCard');
        expect(r.jsx).toContain('brokerName={n}');
        expect(r.jsx).toContain('brokerId={i}');
    });

    it('emits children for a default slot and a named slot', () => {
        const d = conv(tpl('<div><slot></slot></div>'));
        expect(d.jsx).toContain('{children}');
        // A named slot becomes its OWN prop. The previous form emitted
        // props.slots?.footer, referencing a `props` object the destructured
        // signature never creates — "props is not defined" at render, on every
        // component with a named slot. Caught by the live preview, not by a test.
        const n = conv(tpl('<div><slot name="footer"></slot></div>'));
        expect(n.jsx).toContain('{footer}');
        expect(n.jsx).not.toContain('props.');
        expect(n.namedSlots).toEqual(['footer']);
    });
});

describe('CODEMOD — against the real bundles in force-app', () => {
    const fs = require('fs');
    const path = require('path');
    const bundles = ['accountList', 'propertySummary', 'brokerCard'];

    it.each(bundles)('converts %s cleanly', (name) => {
        const html = fs.readFileSync(
            path.join(__dirname, '..', 'force-app', 'main', 'default', 'lwc', name, `${name}.html`),
            'utf8'
        );
        const r = conv(html, name);
        expect(r.blockers).toEqual([]);
        expect(r.escalations).toEqual([]);
        expect(r.jsx).toBeTruthy();
    });

    it('reproduces the hand-written accountList structure', () => {
        const html = fs.readFileSync(
            path.join(__dirname, '..', 'force-app', 'main', 'default', 'lwc',
                'accountList', 'accountList.html'), 'utf8'
        );
        const { jsx } = conv(html, 'accountList');
        // The same boundaries, props and order as react/accountList.js.
        expect(jsx).toContain('<Card title="Accounts" iconName="standard:account">');
        expect(jsx).toContain('(accounts ?? []).map((account) =>');
        expect(jsx).toContain('key={account.Id}');
        expect(jsx).toContain('<FormattedText value={account.Industry} />');
        expect(jsx).toContain('label="View"');
        expect(jsx).toContain('onClick={handleView}');
        expect(jsx).toContain('No accounts to display');
        expect(jsx).toContain('Unable to load accounts');
    });
});
