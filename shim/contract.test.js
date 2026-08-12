/**
 * PLATFORM-MODULE CATALOG <-> RUNTIME CONTRACT.
 *
 * The base-component version of this bug is in catalog/contract.test.js. This
 * is the same bug one layer down, and it was more expensive.
 *
 * catalog/platform-modules.xml marks a module `status="shim"` with a
 * `react="..."` list, meaning "@migration/salesforce-runtime exports these".
 * The codemod trusts that completely: seeing status="shim" it writes
 *
 *     import { useToast } from '@migration/salesforce-runtime';
 *
 * and moves on. Nothing verified the export existed. Eighteen of the
 * twenty-five declared names did not, and on the first real org that single
 * missing import killed 7 of 20 previews — while the codemod reported them
 * converted, the census counted them, and 181 tests passed.
 *
 * A missing export is not a subtle bug: the module fails to LOAD, so the whole
 * component is blank. It is invisible to every static check and obvious the
 * instant something renders. This test is the cheap version of rendering.
 *
 * If you mark a module status="shim", export it. If you cannot export it
 * honestly, the row is status="escalate" — that is what happened to
 * lightning/modal, whose own note already said so while its status did not.
 */
import fs from 'fs';
import path from 'path';
import * as runtime from './runtime.js';

const XML = fs.readFileSync(
    path.join(__dirname, '..', 'catalog', 'platform-modules.xml'), 'utf8'
);

/** Rows the codemod will treat as importable, with the names it will import. */
function declaredShims() {
    const rows = [];
    for (const chunk of XML.split(/<module/).slice(1)) {
        const id = /id="([^"]+)"/.exec(chunk);
        const status = /status="([a-z]+)"/.exec(chunk);
        const react = /react="([^"]*)"/.exec(chunk);
        if (!id || !status || status[1] !== 'shim' || !react) continue;
        for (const name of react[1].split(',').map((s) => s.trim())) {
            // Rows like react="a build-time asset import" are prose, not an
            // export list. Only identifiers are a promise the codemod can act on.
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) rows.push([id[1], name]);
        }
    }
    return rows;
}

describe('PLATFORM MODULES — catalog promises match the runtime', () => {
    const shims = declaredShims();

    it('finds shim rows at all (guards against a regex that stops matching)', () => {
        expect(shims.length).toBeGreaterThan(15);
    });

    it.each(shims)('%s declares %s — runtime exports it', (_id, name) => {
        expect(runtime[name]).toBeDefined();
    });

    it('exports nothing for an escalate-only module', () => {
        // The inverse: if lightning/modal ever gains a `Modal` export, the
        // escalation stops being enforced and components silently "convert"
        // into something that cannot work.
        expect(runtime.Modal).toBeUndefined();
    });

    it('every status="shim" row says which names it provides', () => {
        // A shim row with no react= is unactionable: the codemod cannot know
        // what to import, so it will emit nothing and the call site breaks
        // further downstream where the cause is much harder to see.
        const bare = [];
        for (const chunk of XML.split(/<module/).slice(1)) {
            const id = /id="([^"]+)"/.exec(chunk);
            const status = /status="([a-z]+)"/.exec(chunk);
            if (!id || !status || status[1] !== 'shim') continue;
            if (!/react="/.test(chunk)) bare.push(id[1]);
        }
        expect(bare).toEqual([]);
    });
});
