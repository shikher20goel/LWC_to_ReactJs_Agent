import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only API for the migration console.
 *
 * The Generate button has to actually run the codemod, otherwise the console is
 * a report viewer wearing a button. This middleware shells out to the same CLIs
 * you would run by hand — no second code path, so the console cannot drift from
 * what `npm run generate` does.
 *
 * DEV ONLY, and deliberately so: it executes local scripts. It is bound to the
 * Vite dev server and must never be exposed. Fixed argv, no shell, and the
 * component name is validated before touching the filesystem.
 */
function consoleApi() {
    const run = (script, args) => new Promise((resolve) => {
        execFile(process.execPath, [path.join(root, script), ...args],
            { cwd: root, timeout: 300000 },
            (err, stdout, stderr) => resolve({
                // generate.js exits 1 when a component needs review — that is
                // information, not failure, so exit 1 is not an error here.
                ok: !err || err.code === 1,
                code: err ? err.code : 0,
                stdout: String(stdout), stderr: String(stderr)
            }));
    });

    return {
        name: 'console-api',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const json = (obj, status = 200) => {
                    res.statusCode = status;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify(obj));
                };

                if (req.url === '/api/generate' && req.method === 'POST') {
                    const gen = await run('codemod/generate.js', ['corpus/lwc-recipes', 'react/corpus']);
                    if (!gen.ok) return json({ ok: false, error: gen.stderr.slice(0, 500) }, 500);
                    const g = await run('agent/graph.js', ['corpus/lwc-recipes', 'knowledge/graph.json']);
                    const m = /Generated (\d+) component/.exec(gen.stdout);
                    return json({ ok: g.ok, total: m ? Number(m[1]) : undefined, log: gen.stdout.slice(-800) });
                }

                if (req.url && req.url.startsWith('/api/source/')) {
                    const name = decodeURIComponent(req.url.slice('/api/source/'.length));
                    // Path traversal guard: the name is a folder under a known
                    // root, so anything outside [A-Za-z0-9_] is rejected outright.
                    if (!/^[A-Za-z0-9_]+$/.test(name)) return json({ error: 'bad name' }, 400);

                    const dir = path.join(root, 'react', 'corpus', name);
                    if (!fs.existsSync(dir)) return json({ error: 'not generated' }, 404);
                    const jsx = fs.readdirSync(dir).find((f) => f.endsWith('.jsx'));
                    if (!jsx) return json({ error: 'no source' }, 404);

                    res.statusCode = 200;
                    res.setHeader('content-type', 'text/plain; charset=utf-8');
                    return res.end(fs.readFileSync(path.join(dir, jsx), 'utf8'));
                }

                return next();
            });
        }
    };
}

export default defineConfig({
    root: path.join(root, 'console'),
    server: { port: 8081, open: false },
    esbuild: { jsx: 'automatic' },
    plugins: [consoleApi()],
    resolve: {
        alias: [
            // Generated components import Apex/schema tokens that only exist
            // on-platform; the console renders them with no data, so a stub is
            // enough to make the module load.
            { find: /^@salesforce\/apex\/.*$/, replacement: path.join(root, 'console/sf-stub.js') },
            { find: /^@salesforce\/schema\/.*$/, replacement: path.join(root, 'console/sf-stub.js') },
            { find: /^@salesforce\/(user|i18n|resourceUrl|contentAssetUrl|label|messageChannel|customPermission)\/.*$/,
              replacement: path.join(root, 'console/sf-stub.js') },
            { find: /^@migration\/salesforce-runtime\/components$/, replacement: path.join(root, 'shim/components.js') },
            { find: /^@migration\/salesforce-runtime$/, replacement: path.join(root, 'shim/runtime.js') }
        ]
    }
});
