/**
 * RENDER SMOKE — every generated component must mount.
 *
 * Targets react/fixtures by default: a STABLE tree generated from
 * fixtures/force-app, so the suite does not break the moment someone
 * retrieves their own org (which is what happened to the census and oracle
 * tests when they pointed at force-app and react/generated).
 *
 * Point it at a real org's output with:
 *
 *     npm run smoke                  # react/generated
 *     SMOKE_DIR=react/corpus npm t   # anything else
 *
 * That is the check to run after `npm run generate`. "Converted with no review
 * items" and "renders" are different claims, and only this one is about
 * software that works.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import path from 'path';

import * as runtime from '../shim/runtime.js';
import { listGenerated, renderOne } from './smoke.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIR = path.join(__dirname, '..', process.env.SMOKE_DIR || path.join('react', 'fixtures'));
const deps = { React, createRoot, act, runtime };
const components = listGenerated(DIR);

describe(`RENDER SMOKE — ${process.env.SMOKE_DIR || 'react/fixtures'}`, () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('found components to render', () => {
        // Without this, a wrong path makes every it.each below vacuous and the
        // suite reports green on zero coverage.
        expect(components.length).toBeGreaterThan(0);
    });

    it.each(components.map((c) => [c.name, c]))('%s mounts', async (_name, entry) => {
        const r = await renderOne(entry, deps);
        if (!r.ok) {
            // A failure here is NOT automatically a defect. A component whose
            // connectedCallback uses an @api prop throws with no parent — and
            // so does the LWC it came from. `npm run smoke:diff` is the check
            // that separates the two; this one answers the narrower question
            // "what can I preview with no data?".
            throw new Error(
                `[${r.phase}] ${r.error}\n`
                + '    Run `npm run smoke:diff` to see whether the original LWC '
                + 'fails the same way (faithful) or this is a codemod defect.'
            );
        }
        expect(r.ok).toBe(true);
    });
});
