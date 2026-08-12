import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the `@salesforce/*` compile-time tokens that only exist on-platform.
 *
 * A single alias to one stub file is NOT enough: every `@salesforce/schema/*`
 * import would collapse to the same value, so getFieldValue() could not tell
 * Contact.Name from Contact.Email and every field rendered blank. Each import
 * needs its OWN module carrying its own identity.
 */
function salesforceTokens() {
    const SCHEMA = '@salesforce/schema/';
    const APEX = '@salesforce/apex/';
    return {
        name: 'salesforce-tokens',
        resolveId(id) {
            if (id.startsWith(SCHEMA) || id.startsWith(APEX)) return `\0${id}`;
            return null;
        },
        load(id) {
            if (!id.startsWith('\0')) return null;
            const spec = id.slice(1);
            if (spec.startsWith(SCHEMA)) {
                // "Contact.Name" -> { objectApiName, fieldApiName }
                const [objectApiName, ...rest] = spec.slice(SCHEMA.length).split('.');
                return `export default ${JSON.stringify({
                    objectApiName, fieldApiName: rest.join('.')
                })};`;
            }
            if (spec.startsWith(APEX)) {
                // "ContactController.getContactList" -> a named method token
                const name = spec.slice(APEX.length);
                return `export default ${JSON.stringify({ name, __stub: true })};`;
            }
            return null;
        }
    };
}

/**
 * Preview server for GENERATED React components.
 *
 * No @vitejs/plugin-react: its current release pulls a Babel 8 plugin, and the
 * LWC toolchain pins Babel 7. Vite's own esbuild handles JSX natively, which
 * is all the preview needs (we lose Fast Refresh, not correctness).
 */
export default defineConfig({
    root: path.join(root, 'preview'),
    server: { port: 8080, open: false },
    esbuild: { jsx: 'automatic' },
    plugins: [salesforceTokens()],
    resolve: {
        alias: [
            {
                find: /^@migration\/salesforce-runtime\/components$/,
                replacement: path.join(root, 'shim/components.js')
            },
            {
                find: /^@migration\/salesforce-runtime$/,
                replacement: path.join(root, 'shim/runtime.js')
            }
        ]
    }
});
