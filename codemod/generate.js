#!/usr/bin/env node
/**
 * CLI:  npm run generate [-- <source-root>]
 *
 * Runs the deterministic codemod over every LWC bundle and writes React
 * components to react/generated/<Name>.jsx.
 *
 * Emitted as .jsx so the React transform applies without touching the LWC
 * transform, which owns .js.
 *
 * Exit codes:
 *   0  every bundle converted with no review items
 *   1  at least one bundle has review items or blockers (expected, not a crash)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findBundles } from '../census/lwc-census.js';
import { generateComponent } from './component.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || path.join(here, '..', 'force-app');
// Second arg lets a corpus run write elsewhere, so it never overwrites the
// force-app output that oracle/generated.react.test.js imports.
const outDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(here, '..', 'react', 'generated');

fs.mkdirSync(outDir, { recursive: true });

let needsReview = 0;
const summary = [];

// Two passes: the set of siblings must be known BEFORE generating any one
// component, or child imports cannot be emitted.
const bundles = findBundles(root).filter(
    (d) => fs.existsSync(path.join(d, `${path.basename(d)}.html`))
);
const pascal = (s2) => s2.charAt(0).toUpperCase() + s2.slice(1);
const knownComponents = new Set(bundles.map((d) => pascal(path.basename(d))));

for (const dir of bundles) {
    const name = path.basename(dir);
    const jsPath = path.join(dir, `${name}.js`);
    const htmlPath = path.join(dir, `${name}.html`);
    if (!fs.existsSync(htmlPath)) continue;

    const r = generateComponent({
        js: fs.readFileSync(jsPath, 'utf8'),
        html: fs.readFileSync(htmlPath, 'utf8'),
        name,
        knownComponents
    });

    const outPath = path.join(outDir, `${r.componentName}.jsx`);
    fs.writeFileSync(outPath, r.code);

    if (r.todos.length) needsReview++;
    summary.push({ name, component: r.componentName, todos: r.todos });
}

console.log(`Generated ${summary.length} component(s) into react/generated/\n`);
for (const s of summary) {
    const mark = s.todos.length ? `${s.todos.length} to review` : 'clean';
    console.log(`  ${s.component.padEnd(20)} ${mark}`);
    for (const t of s.todos) console.log(`      [${t.kind}] ${t.detail}`);
}

console.log(
    `\n${summary.length - needsReview}/${summary.length} converted with no review items.`
);
process.exit(needsReview ? 1 : 0);
