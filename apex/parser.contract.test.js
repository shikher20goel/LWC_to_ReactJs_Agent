/**
 * PARSER CONTRACT.
 *
 * These are the ONLY behaviours this project relies on from the Apex parser.
 * If the dependency is ever replaced — because it was abandoned, because it
 * broke on new Apex syntax, or because we regenerate from the ANTLR grammar —
 * a replacement is correct when this file passes.
 *
 * That is the point of writing it down: it converts "can we swap the parser?"
 * from an open question into a checklist. Seven assertions, not an audit of a
 * 675 KB generated file.
 */
import {
    parseApex, tryParseApex, walk, nodeText, nodeType, findAll, CONTEXT, PARSER_ID
} from './parser.js';

const SOURCE = `
public with sharing class ContractDemo {
    @AuraEnabled(cacheable=true)
    public static List<Account> withParams(String searchKey, Integer maxResults) {
        return null;
    }
    @AuraEnabled
    public static void noParams() { }
}
`;

describe('PARSER CONTRACT — required behaviours', () => {
    it('1. identifies which parser is in use', () => {
        // A silent parser swap is how a subtle behaviour change ships.
        expect(PARSER_ID).toMatch(/apex-parser@\d+\.\d+\.\d+/);
    });

    it('2. parses a class into a walkable tree', () => {
        const cu = parseApex(SOURCE);
        expect(cu).toBeTruthy();
        let nodes = 0;
        walk(cu, () => { nodes++; });
        expect(nodes).toBeGreaterThan(10);
    });

    it('3. exposes ANTLR context type names', () => {
        const cu = parseApex(SOURCE);
        const types = new Set();
        walk(cu, (n) => types.add(nodeType(n)));
        expect(types.has(CONTEXT.CLASS_BODY_DECLARATION)).toBe(true);
        expect(types.has(CONTEXT.METHOD_DECLARATION)).toBe(true);
    });

    it('4. surfaces annotations in declaration text, including cacheable', () => {
        // The facade generator's read-only guarantee depends entirely on being
        // able to see cacheable=true.
        const decls = findAll(parseApex(SOURCE), CONTEXT.CLASS_BODY_DECLARATION)
            .map(nodeText).filter((t) => t.includes('AuraEnabled'));
        expect(decls).toHaveLength(2);
        expect(decls.some((d) => /cacheable\s*=\s*true/i.test(d))).toBe(true);
        expect(decls.some((d) => !/cacheable/i.test(d))).toBe(true);
    });

    it('5. nodeText CONCATENATES WITHOUT WHITESPACE — depended on, and a trap', () => {
        // Documented as a contract because it is load-bearing in both
        // directions: extraction relies on it, and any \b regex over it
        // silently never matches. That bug produced a clean, empty facade.
        const decl = findAll(parseApex(SOURCE), CONTEXT.CLASS_BODY_DECLARATION)
            .map(nodeText).find((t) => t.includes('withParams'));
        expect(decl).toContain('publicstatic');
        expect(decl).not.toContain('public static');
        expect(/\bstatic\b/.test(decl)).toBe(false);   // the trap, pinned
        expect(/static/.test(decl)).toBe(true);        // what to use instead
    });

    it('6. exposes formal parameters as distinct nodes with type and name', () => {
        // Types cannot be recovered from concatenated text, so the tree
        // structure is required, not optional.
        const method = findAll(parseApex(SOURCE), CONTEXT.METHOD_DECLARATION)
            .find((m) => nodeText(m).includes('withParams'));
        const params = findAll(method, CONTEXT.FORMAL_PARAMETER)
            .map((p) => (p.children || []).map(nodeText).filter(Boolean));
        expect(params).toHaveLength(2);
        expect(params[0]).toEqual(expect.arrayContaining(['String', 'searchKey']));
        expect(params[1]).toEqual(expect.arrayContaining(['Integer', 'maxResults']));
    });

    it('7. RAW parser does NOT throw on bad input — the same trap as LWC', () => {
        // I assumed Apex differed from @lwc/template-compiler here. It does
        // not, and this test caught it. Left in tolerant mode so the actual
        // upstream behaviour stays pinned: if a future parser starts throwing,
        // this fails and tells us the contract moved.
        expect(() => parseApex('public class Broken { ((( }', { tolerant: true }))
            .not.toThrow();
    });

    it('8. our wrapper FAILS LOUDLY by default', () => {
        // A class that fails to parse yields fewer methods, so the generated
        // facade comes out smaller, valid and silently missing endpoints.
        // Nothing looks wrong — which is exactly why the default throws.
        expect(() => parseApex('public class Broken { ((( }')).toThrow();
    });

    it('9. tryParseApex reports every syntax error without throwing', () => {
        const bad = tryParseApex('public class Broken { ((( }');
        expect(bad.ok).toBe(false);
        expect(bad.errors.length).toBeGreaterThan(0);
        expect(bad.errors[0]).toHaveProperty('line');

        const good = tryParseApex('public class Fine { public static void x(){} }');
        expect(good.ok).toBe(true);
        expect(good.errors).toEqual([]);
    });
});

describe('PARSER CONTRACT — sourced from the vendored tarball', () => {
    it('resolves the vendored copy, not a registry download', async () => {
        // vendor/apexdevtools-apex-parser-5.1.0.tgz is committed and installed
        // with file:, so the build survives the package being unpublished.
        const pkg = require('../package.json');
        expect(pkg.devDependencies['@apexdevtools/apex-parser'])
            .toMatch(/^file:vendor\//);
    });
});
