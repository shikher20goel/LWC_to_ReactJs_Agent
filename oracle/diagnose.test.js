/**
 * DIAGNOSE — asserts the normalise() OUTPUT encodes each spike finding, so a
 * silent regression in the normaliser (not just the DOM) is caught. Walks the
 * canonical boundary tree and checks the invariants named in CLAUDE.md.
 * Diagnostic-only; normalise.test.js is the gate.
 */
import { createElement } from 'lwc';
import PropertySummary from 'c/propertySummary';
import { getRecord } from 'lightning/uiRecordApi';
import getBroker from '@salesforce/apex/PropertyController.getBroker';
import { normalise } from './normalise';

const RECORD = { id: 'a01', apiName: 'Property__c', fields: {
    Name: { value: 'Ocean View Estate', displayValue: null },
    Price__c: { value: 1250000, displayValue: '$1,250,000' } } };
const BROKER = { Id: '003xx1', Name: 'Jane Ortiz' };
const flush = () => Promise.resolve();

// Depth-first search over the boundary tree.
function find(tree, pred) {
    if (!tree) return undefined;
    if (pred(tree)) return tree;
    for (const c of tree.children || []) {
        const hit = find(c, pred);
        if (hit) return hit;
    }
    return undefined;
}
function collect(tree, pred, out = []) {
    if (!tree) return out;
    if (pred(tree)) out.push(tree);
    for (const c of tree.children || []) collect(c, pred, out);
    return out;
}

async function loadedTree() {
    const el = createElement('c-property-summary', { is: PropertySummary });
    el.recordId = 'a01xx0000000001AAA';
    document.body.appendChild(el);
    getRecord.emit(RECORD); getBroker.emit(BROKER);
    await flush(); await flush();
    return normalise(el);
}

async function emptyTree() {
    const el = createElement('c-property-summary', { is: PropertySummary });
    document.body.appendChild(el);
    await flush();
    return normalise(el);
}

describe('DIAGNOSE — normalised boundary tree', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('F1: base-component props are read by name from the catalog', async () => {
        const card = find(await loadedTree(), (n) => n.tag === 'Card');
        expect(card).toBeDefined();
        expect(card.props.title).toBe('Property Summary');
        expect(card.props.iconName).toBe('standard:account');
    });

    it('F2/F3: traversal crosses shadow + light DOM down to nested c-* boundaries', async () => {
        const broker = find(await loadedTree(), (n) => n.tag === 'BrokerCard');
        expect(broker).toBeDefined();
        // Button is inside BrokerCard's own template — proves we descended through
        // Card's slot, into light DOM, and into the child component.
        expect(find(broker, (n) => n.tag === 'Button')).toBeDefined();
    });

    it('F4: slotted light-DOM text is KEPT (guards [object Object] detection)', async () => {
        const h2 = find(await loadedTree(), (n) => n.tag === 'h2');
        expect(h2).toBeDefined();
        expect(h2.text).toBe('Ocean View Estate');
    });

    it('F4: base-component shadow text is SUPPRESSED, props compared instead', async () => {
        const fn = find(await loadedTree(), (n) => n.tag === 'FormattedNumber');
        expect(fn).toBeDefined();
        expect(fn.text).toBeUndefined();          // never diff on base-rendered text
        expect(fn.props.value).toBe(1250000);     // diff on props
    });

    it('every boundary node is tagged and carries a props bag', async () => {
        const boundaries = collect(await loadedTree(), (n) => n.boundary);
        expect(boundaries.length).toBeGreaterThanOrEqual(4); // Property, Card, FN, Broker, Button
        expect(boundaries.every((n) => typeof n.tag === 'string' && n.props)).toBe(true);
    });

    it('EMPTY state renders the empty-state text and no property boundaries', async () => {
        const tree = await emptyTree();
        expect(find(tree, (n) => n.text === 'Select a property to see details here')).toBeDefined();
        expect(find(tree, (n) => n.tag === 'FormattedNumber')).toBeUndefined();
        expect(find(tree, (n) => n.tag === 'BrokerCard')).toBeUndefined();
    });
});
