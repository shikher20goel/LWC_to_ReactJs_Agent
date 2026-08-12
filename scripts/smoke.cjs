#!/usr/bin/env node
/**
 * npm run smoke [-- <out-dir> [<source-root>]]
 *
 * Runs the render smokes against a generated output directory.
 *
 * A node wrapper rather than `SMOKE_DIR=... jest` in package.json, because
 * that syntax is a shell-ism: it works in bash and silently does nothing
 * useful in cmd or PowerShell, which is where this repo actually runs. The
 * first attempt at these scripts referenced a `cross-env-shim` package that
 * does not exist — a dependency-free wrapper avoids both problems.
 *
 *   npm run smoke              react/generated vs force-app
 *   npm run smoke -- react/corpus corpus/lwc-recipes
 */
const { spawnSync } = require('child_process');
const path = require('path');

const [outDir = 'react/generated', srcRoot = 'force-app'] = process.argv.slice(2);
const diff = process.env.SMOKE_MODE === 'diff';

const target = diff ? 'codemod/differential-smoke.test.js' : 'codemod/smoke.test.js';
console.log(`${diff ? 'DIFFERENTIAL' : 'RENDER'} SMOKE — ${outDir}`
    + `${diff ? ` vs ${srcRoot}` : ''}\n`);

const r = spawnSync(
    process.execPath,
    [path.join('node_modules', 'jest', 'bin', 'jest.js'), target],
    {
        stdio: 'inherit',
        env: { ...process.env, SMOKE_DIR: outDir, SMOKE_SRC: srcRoot }
    }
);
process.exit(r.status === null ? 1 : r.status);
