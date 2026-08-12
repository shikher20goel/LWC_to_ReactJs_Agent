/**
 * Census tests.
 *
 * Two of these assertions are kill criteria, so the classifier has to be
 * right for the right REASON — a component landing in Tier A by accident is
 * as bad as one landing in Tier M by accident. Each tier assertion below also
 * checks `tier_reasons`.
 */
import path from 'path';
import { runCensus, censusBundle, findBundles } from './lwc-census.js';

const SRC = path.join(__dirname, '..', 'force-app');
const bundleDir = (n) => path.join(SRC, 'main', 'default', 'lwc', n);

describe('CENSUS — bundle discovery', () => {
    it('finds every LWC bundle under a source root', () => {
        const names = findBundles(SRC).map((d) => path.basename(d)).sort();
        expect(names).toEqual(['accountList', 'brokerCard', 'propertySummary']);
    });
});

describe('CENSUS — per-bundle extraction', () => {
    it('resolves @wire adapters back to their source module', () => {
        // The adapter identifier alone is useless — "getRecord" could be LDS
        // or a local helper. The module is what the catalog is keyed on.
        const b = censusBundle(bundleDir('propertySummary'));
        const byAdapter = Object.fromEntries(b.wires.map((w) => [w.adapter, w.module]));
        expect(byAdapter.getRecord).toBe('lightning/uiRecordApi');
        expect(byAdapter.getBroker).toBe('@salesforce/apex/PropertyController.getBroker');
        expect(b.wires.every((w) => w.module !== '(unresolved)')).toBe(true);
    });

    it('extracts base components, children and @api props', () => {
        const b = censusBundle(bundleDir('propertySummary'));
        expect(b.base_components).toEqual(
            expect.arrayContaining(['lightning-card', 'lightning-formatted-number'])
        );
        expect(b.child_components).toContain('c-broker-card');
        expect(b.api_props).toContain('recordId');
        expect(b.apex_imports).toContain('PropertyController.getBroker');
    });

    it('detects composed/bubbling CustomEvents specifically', () => {
        const b = censusBundle(bundleDir('brokerCard'));
        expect(b.composed_events).toContain('contact');
        const ev = b.events.find((e) => e.name === 'contact');
        expect(ev.composed).toBe(true);
        expect(ev.bubbles).toBe(true);
    });

    it('does NOT flag a plain non-composed event as composed', () => {
        // propertySummary dispatches brokerselected with no composed/bubbles.
        const b = censusBundle(bundleDir('propertySummary'));
        const ev = b.events.find((e) => e.name === 'brokerselected');
        expect(ev).toBeDefined();
        expect(ev.composed).toBe(false);
        expect(b.composed_events).not.toContain('brokerselected');
    });

    it('reads .js-meta.xml exposure and targets when present', () => {
        const b = censusBundle(bundleDir('accountList'));
        expect(b.exposed).toBe(true);
        expect(b.targets).toContain('lightning__AppPage');
    });
});

describe('CENSUS — tiering (drives the kill criterion)', () => {
    it('classifies a plain wire+list component as Tier M', () => {
        const b = censusBundle(bundleDir('accountList'));
        expect(b.tier).toBe('M');
        expect(b.tier_reasons).toEqual([]);
    });

    it('classifies renderedCallback as Tier A, for that reason', () => {
        const b = censusBundle(bundleDir('propertySummary'));
        expect(b.tier).toBe('A');
        expect(b.tier_reasons).toContain('renderedCallback');
    });

    it('classifies a composed event as Tier A, for that reason', () => {
        const b = censusBundle(bundleDir('brokerCard'));
        expect(b.tier).toBe('A');
        expect(b.tier_reasons).toContain('composed/bubbling CustomEvent');
    });
});

describe('CENSUS — aggregate report and gates', () => {
    const c = runCensus(SRC);

    it('reports parse_success_rate as a first-class field', () => {
        // If this silently drops below 1, every tier percentage is understated
        // and the gate can read "clear" on a project that should stop.
        expect(c.parse_success_rate).toBe(1);
        expect(c.parse_failures).toEqual([]);
    });

    it('tallies base components by usage, most-used first', () => {
        expect(c.base_components_used[0].count)
            .toBeGreaterThanOrEqual(c.base_components_used[c.base_components_used.length - 1].count);
        const card = c.base_components_used.find((b) => b.tag === 'lightning-card');
        expect(card.count).toBe(2);
        expect(card.files).toEqual(expect.arrayContaining(['accountList', 'propertySummary']));
    });

    it('evaluates gate C-3 (Tier H > 35%) from LWC source alone', () => {
        expect(c.gates.tier_h_over_35pct.threshold).toBe(0.35);
        expect(c.gates.tier_h_over_35pct.breached).toBe(false);
    });

    it('refuses to evaluate gate C-4 without the Apex pass', () => {
        // Reporting "clear" here would be a false negative on a security
        // gate. Null is the honest answer until apex-census exists.
        expect(c.gates.fls_sharing_over_50pct.breached).toBeNull();
        expect(c.gates.fls_sharing_over_50pct.value).toBeNull();
    });

    it('tier counts sum to the component total', () => {
        const { M, A, H } = c.tier_distribution;
        expect(M + A + H).toBe(c.total_components);
    });
});
