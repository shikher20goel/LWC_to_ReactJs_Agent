#!/usr/bin/env node
/**
 * CLI:  npm run census [-- <source-root>]
 *
 * Writes census/census.json and prints the summary + gate verdicts.
 * Default source root is ./force-app.
 *
 * Exit codes are deliberate — this is a gate, so it is CI-usable:
 *   0  gates clear
 *   1  a gate is BREACHED (Tier H > 35%) — the project should stop and re-scope
 *   2  the census could not parse everything, so the numbers are understated
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCensus, formatCensus } from './lwc-census.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || path.join(here, '..', 'force-app');

if (!fs.existsSync(root)) {
    console.error(`Source root not found: ${root}`);
    process.exit(2);
}

const census = runCensus(root);
const outPath = path.join(here, 'census.json');
fs.writeFileSync(outPath, JSON.stringify(census, null, 2));

console.log(formatCensus(census));
console.log(`\nWritten: ${outPath}`);

if (census.parse_success_rate < 1) {
    console.error(
        `\nWARNING: ${census.parse_failures.length} bundle(s) failed to parse. `
        + 'Tier percentages are UNDERSTATED and the gate verdict is not trustworthy.'
    );
    for (const f of census.parse_failures) {
        console.error(`  ${f.name}: ${f.diagnostics.join('; ')}`);
    }
    process.exit(2);
}

if (census.gates.tier_h_over_35pct.breached) {
    console.error(
        `\nGATE BREACHED: Tier H is ${(census.gates.tier_h_over_35pct.value * 100).toFixed(1)}%`
        + ' (threshold 35%).\n'
        + 'Per research/01 Part 10 this is a STOP: reconsider LWC-OSS or a strangler-fig'
        + ' approach before building further.'
    );
    process.exit(1);
}

console.log('\nGates clear. Note: FLS/sharing gate still requires the Apex census.');
