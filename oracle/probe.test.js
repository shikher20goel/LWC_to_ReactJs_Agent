/**
 * PROBE — raw-DOM diagnostics that pin the S-1 spike findings at the source,
 * before normalise() ever runs. If any of these regress, the normaliser is
 * built on a false premise. Diagnostic-only; normalise.test.js is the gate.
 */
import { createElement } from 'lwc';
import PropertySummary from 'c/propertySummary';
import { getRecord } from 'lightning/uiRecordApi';
import getBroker from '@salesforce/apex/PropertyController.getBroker';

const RECORD = { id: 'a01', apiName: 'Property__c', fields: {
    Name: { value: 'Ocean View Estate', displayValue: null },
    Price__c: { value: 1250000, displayValue: '$1,250,000' } } };
const BROKER = { Id: '003xx1', Name: 'Jane Ortiz' };
const flush = () => Promise.resolve();

async function renderLoaded() {
    const el = createElement('c-property-summary', { is: PropertySummary });
    el.recordId = 'a01xx0000000001AAA';
    document.body.appendChild(el);
    getRecord.emit(RECORD); getBroker.emit(BROKER);
    await flush(); await flush();
    return el;
}

describe('PROBE — base-component DOM shape', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('F1: base-component props are JS PROPERTIES, not attributes', async () => {
        const el = await renderLoaded();
        const card = el.shadowRoot.querySelector('lightning-card');
        expect(card.title).toBe('Property Summary');       // property is readable
        expect(card.getAttribute('title')).toBeNull();     // ...but NOT an attribute
        expect(card.attributes.length).toBe(0);            // nothing to enumerate
    });

    it('F2: a base-component stub shadow root holds only <slot> elements', async () => {
        const el = await renderLoaded();
        const card = el.shadowRoot.querySelector('lightning-card');
        expect(card.shadowRoot).toBeTruthy();
        const shadowTags = [...card.shadowRoot.children].map((c) => c.tagName.toLowerCase());
        expect(shadowTags.length).toBeGreaterThan(0);
        expect(shadowTags.every((t) => t === 'slot')).toBe(true);
        // Real slotted content lives in LIGHT DOM, not the shadow root.
        expect([...card.children].map((c) => c.tagName.toLowerCase())).toContain('div');
    });

    it('F3: child c-* components render for real (own shadow root)', async () => {
        const el = await renderLoaded();
        const broker = el.shadowRoot.querySelector('c-broker-card');
        expect(broker).toBeTruthy();
        expect(broker.shadowRoot).toBeTruthy();
    });

    it('F4: base-component renders NO text off-platform, but keeps its props', async () => {
        const el = await renderLoaded();
        const fn = el.shadowRoot.querySelector('lightning-formatted-number');
        expect(fn.value).toBe(1250000);                    // prop survives
        expect((fn.textContent || '').trim()).toBe('');    // rendered text does not
    });
});
