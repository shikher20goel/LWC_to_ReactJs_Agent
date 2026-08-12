/**
 * RENDER SMOKE HARNESS.
 *
 * Everything else in this repo checks generated code STATICALLY: it parses, it
 * has no escalations, the catalog knows every tag. On the first real org all of
 * that reported success while 16 of 20 components were blank in the browser.
 *
 * The gap is always the same shape — a name the codemod emitted that nothing
 * exports:
 *
 *   - `<Accordion>` catalogued with no shim behind it
 *   - `useToast` declared status="shim" and never written
 *   - a child `c-*` referenced but not imported
 *
 * None of those are visible until something mounts the component. This module
 * mounts it. It is deliberately dumb: no fixtures, no props, a transport that
 * answers everything with empty data — the same conditions as the console's
 * preview pane, which is where a developer will look first.
 *
 * A component that throws here is not necessarily wrong (it may genuinely need
 * a recordId), but it IS a component nobody can preview, and that is worth
 * knowing by name rather than discovering one click at a time.
 *
 * Must run under jest: the .jsx files need the React transform, and jest owns
 * it. `npm run smoke` is the CLI form.
 */
const fs = require('fs');
const path = require('path');

/** A transport that never rejects and never returns anything interesting. */
function emptyTransport() {
    const nothing = () => Promise.resolve(null);
    return {
        callApex: () => Promise.resolve([]),
        getRecord: nothing,
        getObjectInfo: () => Promise.resolve({ fields: {} }),
        getPicklistValues: () => Promise.resolve({ values: [] }),
        getPicklistValuesByRecordType: () => Promise.resolve({ picklistFieldValues: {} }),
        getListUi: () => Promise.resolve({ records: { records: [] } }),
        getListInfoByName: () => Promise.resolve({}),
        graphql: () => Promise.resolve({ data: {} }),
        createRecord: nothing,
        updateRecord: nothing,
        deleteRecord: nothing
    };
}

/** Generated components, newest manifest first, from an output directory. */
function listGenerated(outDir) {
    if (!fs.existsSync(outDir)) return [];
    const manifestPath = path.join(outDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return mf.components
            // Escalated components have no .jsx to render, by design.
            .filter((c) => c.status !== 'escalated')
            .map((c) => ({
                name: c.lwc,
                export: c.component,
                file: path.join(outDir, c.dir, `${c.component}.jsx`)
            }))
            .filter((c) => fs.existsSync(c.file));
    }
    // No manifest (hand-made fixture trees): fall back to globbing.
    const out = [];
    for (const dir of fs.readdirSync(outDir)) {
        const full = path.join(outDir, dir);
        if (!fs.statSync(full).isDirectory()) continue;
        for (const f of fs.readdirSync(full)) {
            if (!f.endsWith('.jsx')) continue;
            out.push({ name: dir, export: f.replace(/\.jsx$/, ''), file: path.join(full, f) });
        }
    }
    return out;
}

/**
 * Mount one component. Returns { name, ok, error }.
 *
 * `deps` is injected rather than required at module scope so this file stays
 * loadable outside a jsdom environment (the CLI reads listGenerated only).
 */
async function renderOne(entry, deps, props = {}) {
    const { React, createRoot, act, runtime } = deps;
    let mod;
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        mod = require(entry.file);
    } catch (e) {
        return { name: entry.name, ok: false, phase: 'import', error: e.message };
    }

    const Comp = mod[entry.export] || mod.default;
    if (typeof Comp !== 'function') {
        return {
            name: entry.name, ok: false, phase: 'export',
            error: `no component exported as "${entry.export}" (found: ${Object.keys(mod).join(', ') || 'nothing'})`
        };
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    // React reports render errors to console.error AND rethrows; an error
    // thrown in an effect only reaches the console. Capture both.
    const errors = [];
    const realError = console.error;
    console.error = (...args) => { errors.push(String(args[0])); };

    try {
        await act(async () => {
            root.render(React.createElement(
                runtime.SalesforceRuntimeProvider,
                { transport: emptyTransport(), client: runtime.createSalesforceQueryClient({}) },
                React.createElement(Comp, props)
            ));
        });
        // Let wires settle — a crash often happens on the second render, when
        // data arrives and the template indexes into it.
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    } catch (e) {
        return { name: entry.name, ok: false, phase: 'render', error: e.message };
    } finally {
        console.error = realError;
        try { await act(async () => { root.unmount(); }); } catch { /* already dead */ }
        container.remove();
    }

    const real = errors.filter((e) => !/not wrapped in act|Warning:/.test(e));
    if (real.length) {
        return { name: entry.name, ok: false, phase: 'effect', error: real[0].slice(0, 300) };
    }
    return { name: entry.name, ok: true };
}

module.exports = { listGenerated, renderOne, emptyTransport };
