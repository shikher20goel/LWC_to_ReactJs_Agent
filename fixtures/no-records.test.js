/**
 * GUARD — no org records in anything tracked.
 *
 * CLAUDE.md rule 7 is a prose rule, and prose rules lose. The pressure to
 * break this one is specific and recurring: previews look empty, the org has
 * real rows sitting right there, and `sf data query` is one command away. It
 * would work, immediately, and the damage would be invisible until it was
 * permanent — this repository is public, fixtures reach an LLM context, and
 * git history makes an Art. 17 erasure request practically unsatisfiable.
 *
 * So the rule gets a test. The synthetic fixtures are checked for the
 * fingerprints of a real Salesforce query result, and the metadata pull is
 * checked for record payloads.
 *
 * If this fails, do NOT relax it. Regenerate with `npm run fixtures:build`,
 * which synthesises from SHAPE plus metadata and cannot produce records.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

const TRACKED = [
    path.join(ROOT, 'fixtures', 'synthetic', 'preview-data.json'),
    path.join(ROOT, 'knowledge', 'org', 'metadata.json')
];

describe('PRIVACY — tracked fixtures contain no org records', () => {
    it('has files to check (guards a vacuous pass)', () => {
        expect(TRACKED.filter((p) => fs.existsSync(p)).length).toBeGreaterThan(0);
    });

    it.each(TRACKED.filter((p) => fs.existsSync(p)).map((p) => [path.relative(ROOT, p), p]))(
        '%s has no query-result fingerprints',
        (_rel, file) => {
            const text = read(file);
            // `attributes: { type, url }` is stamped on every record the REST
            // and SOAP APIs return, and on nothing a human writes by hand. It
            // is the single most reliable tell that a response body was pasted
            // in rather than synthesised.
            expect(text).not.toMatch(/"attributes"\s*:\s*\{[^}]*"url"/);
            expect(text).not.toMatch(/\/services\/data\/v\d+\.\d+\/sobjects\//);
            // A totalSize/done/records envelope is a query result verbatim.
            expect(text).not.toMatch(/"totalSize"\s*:/);
            expect(text).not.toMatch(/"done"\s*:\s*(true|false)/);
        }
    );

    it('synthetic ids are obviously synthetic', () => {
        const file = TRACKED[0];
        if (!fs.existsSync(file)) return;
        const text = read(file);
        // Every generated id carries an `xx` marker. A real 15/18-character id
        // never does, so a genuine record pasted in here fails this.
        //
        // Matched on VALUES only (`: "..."`), not keys — JSON keys like
        // "propertySummary" are 15 characters and tripped the first version.
        // A real id also always contains a digit, because the 3-character key
        // prefix is numeric for standard objects and a0-style for custom ones;
        // that is what separates an id from a camelCase name of the same length.
        const values = [...text.matchAll(/:\s*"([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})"/g)]
            .map((m) => m[1]);
        const realLooking = values.filter((v) => /\d/.test(v) && !v.includes('xx'));
        expect(realLooking).toEqual([]);
    });

    it('the metadata pull kept only metadata', () => {
        const file = path.join(ROOT, 'knowledge', 'org', 'metadata.json');
        if (!fs.existsSync(file)) return;
        const meta = JSON.parse(read(file));
        // Field DESCRIBES are metadata. A `records` array is not.
        expect(meta.records).toBeUndefined();
        for (const obj of Object.values(meta.objects || {})) {
            expect(Array.isArray(obj.fields)).toBe(true);
            for (const f of obj.fields) {
                // A describe field carries type information, never values —
                // except picklistValues, which are configuration.
                expect(Object.keys(f).every(
                    (k) => k !== 'value' && k !== 'records'
                )).toBe(true);
            }
        }
    });

    it('does not identify the tenant', () => {
        const file = path.join(ROOT, 'knowledge', 'org', 'metadata.json');
        if (!fs.existsSync(file)) return;
        const text = read(file);
        // An instance URL plus an org id turns "some org's field list" into
        // "THIS customer's field list", which is a different disclosure.
        expect(text).not.toMatch(/\.my\.salesforce\.com/);
        expect(text).not.toMatch(/"organizationId"/);
        expect(text).not.toMatch(/@[a-z0-9.-]+\.(com|org|net)/i);
    });
});
