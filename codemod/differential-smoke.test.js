/**
 * DIFFERENTIAL RENDER SMOKE — is a blank preview OUR bug or the component's?
 *
 * The plain render smoke (smoke.test.js) says which generated components fail
 * to mount. That is necessary but not sufficient, because some components fail
 * for a reason the codemod did not cause:
 *
 *     connectedCallback() {
 *         this.data = this.build(this.objectApiName);   // @api, undefined
 *     }
 *
 * With no parent to pass objectApiName, the ORIGINAL LWC throws too. Rendering
 * that faithfully is correct behaviour, and "fixing" it would mean inserting a
 * guard the original never had — hiding a real precondition behind a blank
 * screen. Two of the five remaining failures on the first real org were this.
 *
 * So the question is never "does the React render?" but "does the React render
 * IFF the LWC does?". This mounts both sides under identical conditions — no
 * props, no data — and classifies:
 *
 *     BOTH-OK      converted and previewable
 *     BOTH-FAIL    faithful: the original has the same precondition
 *     REACT-ONLY   a codemod defect. This is what must stay at zero.
 *     LWC-ONLY     the React survives where LWC died — suspicious, because it
 *                  usually means a guard was invented that changes behaviour.
 *
 * Only REACT-ONLY and LWC-ONLY are failures. That distinction is the entire
 * value of this file: without it, a real defect and a component that simply
 * needs a recordId look identical, and the fix for one is the bug for the other.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createElement } from 'lwc';
import fs from 'fs';
import path from 'path';

import * as runtime from '../shim/runtime.js';
import { listGenerated, renderOne } from './smoke.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.join(__dirname, '..');
const SRC = process.env.SMOKE_SRC || 'force-app';
const OUT = process.env.SMOKE_DIR || path.join('react', 'fixtures');
const LWC_DIR = path.join(ROOT, SRC, 'main', 'default', 'lwc');

const deps = { React, createRoot, act, runtime };

/** c-my-component, from myComponent / my_component. */
const tagFor = (name) => `c-${name
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()}`.replace(/-+/g, '-');

/**
 * Mount the ORIGINAL LWC with nothing supplied.
 *
 * The error does not propagate out of appendChild — jsdom catches whatever
 * connectedCallback throws and re-reports it as an uncaught `error` event on
 * window (see fixtures/nullSafety.test.js, where assuming otherwise produced a
 * confidently wrong conclusion). Both channels are captured.
 */
function mountLwc(name) {
    let Ctor;
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        Ctor = require(`c/${name}`).default;
    } catch (e) {
        return { ok: false, error: `import: ${e.message}` };
    }

    const seen = [];
    const onError = (e) => seen.push(e.error ? e.error.message : e.message);
    window.addEventListener('error', onError);
    try {
        const el = createElement(tagFor(name), { is: Ctor });
        document.body.appendChild(el);
    } catch (e) {
        seen.push(e.message);
    } finally {
        window.removeEventListener('error', onError);
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    }
    return seen.length ? { ok: false, error: seen[0] } : { ok: true };
}

const generated = listGenerated(path.join(ROOT, OUT));
// Only pairs can be compared. A generated component whose LWC source is gone
// is a stale output directory, not a result.
const pairs = generated.filter((g) => fs.existsSync(path.join(LWC_DIR, g.name)));

describe(`DIFFERENTIAL SMOKE — ${SRC} vs ${OUT}`, () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('has pairs to compare', () => {
        expect(pairs.length).toBeGreaterThan(0);
    });

    it.each(pairs.map((p) => [p.name, p]))(
        '%s — React renders iff the LWC does',
        async (name, entry) => {
            const lwc = mountLwc(name);
            const react = await renderOne(entry, deps);

            if (lwc.ok === react.ok) return;         // BOTH-OK or BOTH-FAIL

            if (!react.ok) {
                throw new Error(
                    `REACT-ONLY failure — codemod defect.\n`
                    + `  LWC:   rendered clean\n`
                    + `  React: [${react.phase}] ${react.error}`
                );
            }
            throw new Error(
                `LWC-ONLY failure — the generated component survives where the `
                + `original did not, which usually means a guard was invented.\n`
                + `  LWC:   ${lwc.error}\n`
                + `  React: rendered clean`
            );
        }
    );
});
