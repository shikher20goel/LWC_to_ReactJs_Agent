import { validateFixture, validateRecordShape, scanForRealData } from './validate.js';

const GOOD = {
    id: 'a01xx0000000001', apiName: 'Property__c',
    fields: {
        Name: { value: 'Ocean View Estate', displayValue: null },
        Price__c: { value: 1250000, displayValue: '$1,250,000' }
    }
};

describe('FIXTURES — shape (CLAUDE.md rule 6)', () => {
    it('accepts the real nested LDS shape', () => {
        expect(validateFixture(GOOD)).toEqual([]);
    });

    it('REJECTS a flattened record', () => {
        // The dangerous case: this renders fine and passes naive tests, while
        // making the oracle blind to [object Object].
        const errs = validateFixture({ id: 'a01', apiName: 'Property__c', Name: 'Ocean View' });
        expect(errs).toHaveLength(1);
        expect(errs[0].kind).toBe('flattened-record');
    });

    it('REJECTS a bare field value inside fields', () => {
        const errs = validateFixture({
            id: 'a01', apiName: 'Property__c', fields: { Name: 'Ocean View' }
        });
        expect(errs.some((e) => e.kind === 'flattened-field')).toBe(true);
    });

    it('validates spanning fields recursively', () => {
        const errs = validateRecordShape({
            id: 'a01', apiName: 'Property__c',
            fields: {
                Broker__r: {
                    value: { id: '003', apiName: 'Contact', fields: { Name: 'Jane' } },
                    displayValue: null
                }
            }
        });
        expect(errs.some((e) => e.path.includes('Broker__r.value') && e.kind === 'flattened-field'))
            .toBe(true);
    });

    it('accepts a SEQUENCE of emissions', () => {
        // LDS emits more than once (cache-then-revalidate). A single-value
        // fixture cannot express the pre-emit or revalidation frames.
        expect(validateFixture([GOOD, GOOD])).toEqual([]);
    });

    it('reports the index of the bad emission in a sequence', () => {
        const errs = validateFixture([GOOD, { apiName: 'X', Name: 'flat' }]);
        expect(errs[0].path).toBe('$[1]');
    });

    it('requires apiName', () => {
        const errs = validateRecordShape({ id: 'a01', fields: {} });
        expect(errs.some((e) => e.kind === 'missing-apiName')).toBe(true);
    });
});

describe('FIXTURES — provenance heuristic (CLAUDE.md rule 7)', () => {
    it('passes a synthetic fixture', () => {
        expect(scanForRealData(GOOD)).toEqual([]);
    });

    it('flags an email address', () => {
        const f = scanForRealData({ fields: { Email: { value: 'jane.ortiz@acme.com' } } });
        expect(f.some((x) => x.kind === 'email')).toBe(true);
    });

    it('flags a full-length Salesforce id that does not look synthetic', () => {
        const f = scanForRealData({ id: '0015g00000XyZaBQAV' });
        expect(f.some((x) => x.kind === 'record-id')).toBe(true);
    });

    it('does NOT flag obviously synthetic ids', () => {
        expect(scanForRealData({ id: 'a01xx0000000001AAA' })).toEqual([]);
    });

    it('flags an SSN', () => {
        const f = scanForRealData({ ssn: '123-45-6789' });
        expect(f.some((x) => x.kind === 'ssn')).toBe(true);
    });

    it('is a BACKSTOP, not a clearance — a clean scan proves nothing', () => {
        // A real customer record with an innocuous name passes this scan.
        // The rule is "fixtures are synthetic by construction"; this only
        // catches accidents. Encoded as a test so nobody mistakes a green
        // run for approval to commit captured data.
        const realButBoring = { id: 'a01xx0000000001', apiName: 'Account', fields: { Name: { value: 'Acme' } } };
        expect(scanForRealData(realButBoring)).toEqual([]);
    });
});
