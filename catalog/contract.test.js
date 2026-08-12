/**
 * CATALOG <-> SHIM CONTRACT.
 *
 * This suite exists because of a real outage, and it is worth stating the
 * failure precisely so nobody deletes it as redundant.
 *
 * The codemod's only question about a base component is "is it in the
 * catalog?". If yes it emits the canonical name — `<Accordion .../>`. Nothing
 * downstream checks that a React component called `Accordion` actually
 * EXISTS. So a catalog entry with no matching shim export produces code that:
 *
 *   - converts with zero warnings
 *   - passes every codemod test
 *   - is counted as "clean" in the census and the manifest
 *   - and dies in the browser with "Accordion is not defined"
 *
 * On the first real org that gap took out 5 of 21 previews while the tooling
 * reported success. Static "clean" is not the same as "renders", and the only
 * cheap place to close the gap is here: the catalog and the shim must agree,
 * checked mechanically, on every run.
 *
 * If you add a component to catalog/base-components.xml, this test fails until
 * you add the shim. That is the point.
 */
import { loadCatalog } from './load.js';
import * as shim from '../shim/components.js';

const catalog = loadCatalog();

describe('CATALOG — every convertible component has a shim to render it', () => {
    const convertible = catalog.all().filter((c) => c.tier !== 'H' && !c.escalateAlways);

    it('has convertible components at all (guards against an empty sweep)', () => {
        // Without this, a catalog that failed to parse would make every
        // it.each below vacuously pass.
        expect(convertible.length).toBeGreaterThan(10);
    });

    it.each(convertible.map((c) => [c.tag, c.canonical]))(
        '%s -> %s is exported by shim/components.js',
        (_tag, canonical) => {
            expect(typeof shim[canonical]).toBe('function');
        }
    );

    it('never emits code for a Tier-H component, so it needs no shim', () => {
        // The inverse contract. A Tier-H entry WITH a shim is a trap: someone
        // will wire it up and the escalation silently stops being enforced.
        const tierH = catalog.all().filter((c) => c.tier === 'H');
        expect(tierH.length).toBeGreaterThan(0);
        const wired = tierH.filter((c) => typeof shim[c.canonical] === 'function');
        expect(wired.map((c) => c.tag)).toEqual([]);
    });

    it('gives every Tier-H entry a reason a human can act on', () => {
        for (const c of catalog.all().filter((x) => x.tier === 'H')) {
            expect(typeof c.reason).toBe('string');
            expect(c.reason.length).toBeGreaterThan(20);
        }
    });

    it('has no duplicate canonical names', () => {
        // Two tags mapping to one canonical would make the shim ambiguous and
        // the oracle's boundary names non-unique.
        const seen = new Map();
        for (const c of catalog.all()) {
            if (seen.has(c.canonical)) {
                throw new Error(
                    `canonical "${c.canonical}" claimed by both ${seen.get(c.canonical)} and ${c.tag}`
                );
            }
            seen.set(c.canonical, c.tag);
        }
    });
});
