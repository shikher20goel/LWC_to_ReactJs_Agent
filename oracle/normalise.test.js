import { createElement } from 'lwc';
import PropertySummary from 'c/propertySummary';
import { getRecord } from 'lightning/uiRecordApi';
import getBroker from '@salesforce/apex/PropertyController.getBroker';
import { normalise, render } from './normalise';
const RECORD = { id: 'a01', apiName: 'Property__c', fields: {
    Name: { value: 'Ocean View Estate', displayValue: null },
    Price__c: { value: 1250000, displayValue: '$1,250,000' } } };
const BROKER = { Id: '003xx1', Name: 'Jane Ortiz' };
const flush = () => Promise.resolve();
describe('NORMALISER', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });
    it('produces a canonical boundary tree — LOADED state', async () => {
        const el = createElement('c-property-summary', { is: PropertySummary });
        el.recordId = 'a01xx0000000001AAA';
        document.body.appendChild(el);
        getRecord.emit(RECORD); getBroker.emit(BROKER);
        await flush(); await flush();
        console.log('\n' + render(normalise(el)));
    });
    it('produces a canonical boundary tree — EMPTY state', async () => {
        const el = createElement('c-property-summary', { is: PropertySummary });
        document.body.appendChild(el);
        await flush();
        console.log('\n' + render(normalise(el)));
    });
    it('is stable across identical renders', async () => {
        const snap = async () => {
            const el = createElement('c-property-summary', { is: PropertySummary });
            el.recordId = 'a01xx0000000001AAA';
            document.body.appendChild(el);
            getRecord.emit(RECORD); getBroker.emit(BROKER);
            await flush(); await flush();
            const s = render(normalise(el));
            document.body.removeChild(el);
            return s;
        };
        expect(await snap()).toBe(await snap());
    });
});
