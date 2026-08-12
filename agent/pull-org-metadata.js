#!/usr/bin/env node
/**
 * npm run org:pull
 *
 * Pulls METADATA from the default org so previews can render realistic values:
 * object and field describes, picklist values, record types, and custom labels.
 *
 * WHAT THIS DELIBERATELY DOES NOT PULL: records.
 *
 * CLAUDE.md rule 7 is the reason, and it is worth restating because "just pull
 * the data so the components work" is the obvious next thought and the trap:
 *
 *   - Fixtures enter an LLM context, which makes the model provider a
 *     sub-processor for whatever is in them.
 *   - Git history makes an Art. 17 erasure request practically unsatisfiable.
 *   - This repository is PUBLIC.
 *
 * There is no clean undo, so the committed fixtures are SYNTHESISED from this
 * metadata instead (fixtures/synthesise.js). Metadata tells us a field is a
 * Picklist with values Hot/Warm/Cold; that is enough to render something
 * realistic without ever holding a customer's record.
 *
 * If you want real records for a local preview, that is a separate, explicitly
 * gitignored path — see `npm run org:pull -- --records`, which refuses to write
 * anywhere tracked.
 *
 * Scoped, not exhaustive: only the objects and labels the converted components
 * actually reference. "Pull everything" on a large org is thousands of
 * describes against an ORG-WIDE API quota that every other integration shares
 * (CLAUDE.md rule 8), and the components cannot use the surplus.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const SRC = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'force-app';
const OUT = path.join(ROOT, 'knowledge', 'org');
const WANT_RECORDS = process.argv.includes('--records');

const sf = (args) => {
    const out = execFileSync('sf', args, {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32'
    });
    return JSON.parse(out);
};

/* ------------------------------------------------------------------ *
 * What do the components actually reference?
 * ------------------------------------------------------------------ */

const lwcDir = path.join(ROOT, SRC, 'main', 'default', 'lwc');
if (!fs.existsSync(lwcDir)) {
    console.error(`No LWC source at ${lwcDir}. Retrieve the org first.`);
    process.exit(1);
}

const objects = new Set();
const labels = new Set();

for (const bundle of fs.readdirSync(lwcDir)) {
    const dir = path.join(lwcDir, bundle);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
        if (!/\.(js|html)$/.test(f)) continue;
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        // @salesforce/schema/Account.Industry  ->  Account
        for (const m of text.matchAll(/@salesforce\/schema\/([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?/g)) {
            objects.add(m[1]);
        }
        // @salesforce/label/c.My_Label
        for (const m of text.matchAll(/@salesforce\/label\/([A-Za-z0-9_.]+)/g)) {
            labels.add(m[1]);
        }
        // objectApiName="Account" / objectApiName={'Account'} in markup
        for (const m of text.matchAll(/object-api-name="([A-Za-z0-9_]+)"/g)) objects.add(m[1]);
    }
}

// Objects an Apex controller obviously serves, inferred from its name is NOT
// reliable, so it is not done. Undetected objects simply get no metadata and
// the synthesiser falls back to structural inference — a smaller, honest gap.
if (!objects.size) objects.add('Account');

console.log(`Referenced by ${SRC}: ${objects.size} object(s), ${labels.size} label(s)`);

/* ------------------------------------------------------------------ *
 * Pull
 * ------------------------------------------------------------------ */

fs.mkdirSync(OUT, { recursive: true });

/**
 * A describe is metadata, but the response is large and some fields carry
 * example-ish content. Keep only what the synthesiser needs, so nothing
 * unexpected is ever written to a tracked file.
 */
function slimDescribe(d) {
    return {
        name: d.name,
        label: d.label,
        custom: d.custom,
        fields: (d.fields || []).map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            length: f.length,
            precision: f.precision,
            scale: f.scale,
            nillable: f.nillable,
            referenceTo: f.referenceTo,
            relationshipName: f.relationshipName,
            // Picklist VALUES are configuration, not data — this is what makes
            // a synthetic record look like it came from this org.
            picklistValues: (f.picklistValues || [])
                .filter((p) => p.active)
                .map((p) => ({ value: p.value, label: p.label, defaultValue: p.defaultValue }))
        }))
    };
}

const describes = {};
const failed = [];
for (const obj of [...objects].sort()) {
    try {
        const r = sf(['sobject', 'describe', '--sobject', obj, '--json']);
        describes[obj] = slimDescribe(r.result);
        const pl = describes[obj].fields.filter((f) => f.picklistValues.length).length;
        console.log(`  ${obj}: ${describes[obj].fields.length} fields, ${pl} picklist(s)`);
    } catch (e) {
        failed.push(obj);
        console.log(`  ${obj}: NOT DESCRIBABLE — ${String(e.message).split('\n')[0].slice(0, 80)}`);
    }
}

let labelValues = {};
if (labels.size) {
    try {
        // Custom labels are Metadata API objects; tooling query is the cheapest read.
        const names = [...labels].map((l) => l.replace(/^c\./, ''));
        const q = `SELECT Name, Value FROM ExternalString WHERE Name IN (${
            names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(',')})`;
        const r = sf(['data', 'query', '--query', q, '--use-tooling-api', '--json']);
        for (const rec of r.result.records || []) labelValues[`c.${rec.Name}`] = rec.Value;
        console.log(`  labels: ${Object.keys(labelValues).length}/${labels.size} resolved`);
    } catch (e) {
        console.log(`  labels: could not read — ${String(e.message).split('\n')[0].slice(0, 80)}`);
    }
}

const payload = {
    // No org id, no instance url, no usernames — nothing that identifies the
    // tenant goes into a tracked file.
    pulledFor: SRC,
    objects: describes,
    labels: labelValues,
    notDescribable: failed,
    note: 'METADATA ONLY. No records. See the header of agent/pull-org-metadata.js.'
};
fs.writeFileSync(path.join(OUT, 'metadata.json'), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`\nWrote knowledge/org/metadata.json (metadata only).`);

if (WANT_RECORDS) {
    console.log('\n--records was passed.');
    console.log('Records are NOT written by this script, in any directory.');
    console.log('Reason: this repo is public and git history has no clean undo;');
    console.log('a fixture that reaches an LLM context makes the provider a');
    console.log('sub-processor for whatever is in it (CLAUDE.md rule 7).');
    console.log('');
    console.log('Use `npm run fixtures:build` instead — it synthesises records');
    console.log('from the metadata above, shaped by what each component reads,');
    console.log('so previews look real without holding anyone\'s data.');
    process.exitCode = 2;
}
