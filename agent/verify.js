#!/usr/bin/env node
/**
 * The promotion gate.
 *
 *   npm run learn:verify [-- <source-root>]
 *
 * Moves knowledge forward, and is the ONLY thing that does. Two steps, and the
 * second is deliberately hard to satisfy:
 *
 *   observed -> proposed   a catalog entry now exists for the construct.
 *                          Mechanical: the entry is either there or it is not.
 *   proposed -> verified   a component USING that construct converted
 *                          oracle-green. Requires evidence, not confidence.
 *
 * WHY THE SECOND STEP MATTERS
 *
 * A catalog entry existing proves only that somebody typed something. The
 * failure this guards against is a plausible-but-wrong entry — say
 * `lightning-combobox` catalogued with prop `items` when it is `options`.
 * That entry makes the build pass, makes `learn` stop reporting the gap, and
 * produces a false prop diff on every render that looks like the COMPONENT is
 * broken rather than the catalog.
 *
 * The oracle is what distinguishes "we wrote something down" from "it behaves
 * like the original". research/13 found no other migration tool pairs
 * generation with a differential oracle as the fitness function — this is that
 * pairing applied to the agent's own memory.
 *
 * So `--oracle-green <test>` is required to reach `verified`, and
 * knowledge.js throws if it is omitted.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { loadCatalog } from '../catalog/load.js';
import { loadSlds, loadPlatformModules } from '../catalog/slds-load.js';
import { loadKnowledge, saveKnowledge, promote, pendingConstructs } from './knowledge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oracleFlag = args.indexOf('--oracle-green');
const oracleTest = oracleFlag >= 0 ? args[oracleFlag + 1] : null;
const stamp = new Date().toISOString();

const CAT = loadCatalog({ force: true });
const SLDS = loadSlds({ force: true });
const PLATFORM = loadPlatformModules({ force: true });
const k = loadKnowledge();

/** Does a catalog entry now exist for this construct? */
function hasCatalogEntry(key) {
    const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (kind === 'base') return CAT.has(value);
    if (kind === 'slds') return Boolean(SLDS.classes[value]);
    if (kind === 'module') return Boolean(PLATFORM.lookup(value));
    return false;
}

const promotedToProposed = [];
for (const c of pendingConstructs(k)) {
    if (c.state === 'observed' && hasCatalogEntry(c.key)) {
        promote(k, c.key, 'proposed');
        promotedToProposed.push(c.key);
    }
}

/* ---- verified requires the oracle, and it is actually run ---- */

const promotedToVerified = [];
if (oracleTest) {
    let green = false;
    try {
        execSync(`npx jest ${oracleTest} --silent`, { cwd: path.join(here, '..'), stdio: 'pipe' });
        green = true;
    } catch {
        green = false;
    }

    if (!green) {
        console.error(`\nORACLE NOT GREEN: "${oracleTest}" failed.`);
        console.error('Nothing promoted to verified. That is the gate working —');
        console.error('a catalog entry that does not survive the oracle is not knowledge.');
        process.exit(1);
    }

    for (const c of pendingConstructs(k)) {
        if (c.state === 'proposed') {
            promote(k, c.key, 'verified', { promotedBy: `${oracleTest} @ ${stamp}` });
            promotedToVerified.push(c.key);
        }
    }
}

saveKnowledge(k, { stamp });

/* ------------------------------- report ------------------------------- */

console.log(`observed -> proposed : ${promotedToProposed.length}`);
for (const key of promotedToProposed) console.log(`   ${key}`);

if (oracleTest) {
    console.log(`\nproposed -> verified : ${promotedToVerified.length}   (oracle: ${oracleTest})`);
    for (const key of promotedToVerified) console.log(`   ${key}`);
} else {
    const proposed = pendingConstructs(k).filter((c) => c.state === 'proposed');
    console.log(`\n${proposed.length} construct(s) are PROPOSED but not verified.`);
    if (proposed.length) {
        console.log('A catalog entry existing only proves someone typed something.');
        console.log('Promote with evidence:');
        console.log('   npm run learn:verify -- --oracle-green <oracle-test-name>');
    }
}

const still = pendingConstructs(k).filter((c) => c.state === 'observed');
if (still.length) {
    console.log(`\n${still.length} construct(s) still have NO catalog entry:`);
    for (const c of still.slice(0, 10)) console.log(`   ${String(c.uses).padStart(4)}x  ${c.key}`);
}
