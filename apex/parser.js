/**
 * The ONLY place @apexdevtools/apex-parser is imported.
 *
 * WHY AN ADAPTER RATHER THAN INLINING THE PARSER
 *
 * The instinct to stop depending on a third party is right — research/07
 * found this ecosystem has a track record of abandonment (unscoped
 * `apex-parser` died in 2023, npm `apexlink` in 2022). But inlining is the
 * wrong mitigation for this particular dependency:
 *
 *   - It is ANTLR-GENERATED. `ApexParser.cjs` alone is 675 KB of machine-
 *     written code. Nobody here can meaningfully review or patch it.
 *   - The Apex grammar changes with every Salesforce release (three a year).
 *     A frozen copy does not stay correct, it stays SILENT — new syntax
 *     parses to something unexpected rather than failing loudly.
 *   - Owning it means owning ANTLR upgrades, which is a job, not a file.
 *
 * So the risk is mitigated three ways instead:
 *
 *   1. The exact tarball is committed to `vendor/` and installed with
 *      `file:`. If npm removes the package tomorrow, the build still works.
 *      1.8 MB, byte-identical, with its BSD-3-Clause licence retained.
 *   2. This adapter is the ONLY import site. We use seven API points out of
 *      a very large surface, so swapping parsers is a one-file change.
 *   3. `parser.contract.test.js` asserts exactly those seven behaviours. A
 *      replacement parser is correct when that file passes — which turns
 *      "can we swap this?" from an unknown into a checklist.
 *
 * If the parser ever does disappear, the realistic replacements are Salesforce
 * Code Analyzer's PMD Apex grammar or regenerating from the open ANTLR
 * grammar — both of which need this same seven-point contract.
 */

import { ApexParserFactory, ThrowingErrorListener } from '@apexdevtools/apex-parser';

/** Parser identity, so a swap is visible in output rather than silent. */
export const PARSER_ID = '@apexdevtools/apex-parser@5.1.0 (vendored)';

/**
 * Node text.
 *
 * NOTE: this CONCATENATES WITHOUT WHITESPACE. `public static List<Contact> f()`
 * comes back as `publicstaticList<Contact>f()`. Every word-boundary regex over
 * this result silently never matches — that bug excluded every method from the
 * generated facade and produced a clean, empty, wrong result.
 */
export function nodeText(node) {
    try {
        return typeof node.getText === 'function' ? node.getText() : (node.text || '');
    } catch {
        return '';
    }
}

/** Depth-first walk over the parse tree. */
export function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const child of node.children || []) walk(child, visit);
}

/** ANTLR context type name, e.g. 'MethodDeclarationContext'. */
export function nodeType(node) {
    return (node && node.constructor && node.constructor.name) || '';
}

/**
 * Parse Apex source into a compilation unit.
 *
 * BY DEFAULT THE PARSER DOES NOT THROW on invalid input — it returns a partial
 * tree and writes syntax errors to the console. Exactly the same trap as
 * @lwc/template-compiler (research/06 R4.5); I had assumed Apex differed and
 * the contract test caught it.
 *
 * That failure mode is dangerous here specifically: a class that fails to
 * parse yields FEWER methods, so the generated facade is smaller, valid, and
 * silently missing endpoints. Nothing looks wrong.
 *
 * So error listeners are attached and parsing FAILS LOUDLY by default. Pass
 * `{ tolerant: true }` only when a partial tree is genuinely acceptable.
 */
export function parseApex(source, { tolerant = false } = {}) {
    const parser = ApexParserFactory.createParser(source);
    if (!tolerant) {
        parser.removeErrorListeners();
        parser.addErrorListener(new ThrowingErrorListener());
    }
    return parser.compilationUnit();
}

/**
 * Parse without throwing, returning the tree AND the syntax errors.
 * Use when you need to report every bad file rather than stop at the first.
 */
export function tryParseApex(source) {
    const errors = [];
    const parser = ApexParserFactory.createParser(source);
    parser.removeErrorListeners();
    parser.addErrorListener({
        syntaxError: (_r, _o, line, col, msg) => errors.push({ line, col, message: msg }),
        reportAmbiguity() {}, reportAttemptingFullContext() {}, reportContextSensitivity() {}
    });
    const tree = parser.compilationUnit();
    return { tree, errors, ok: errors.length === 0 };
}

/** Every context type this project depends on. Keep in sync with the contract test. */
export const CONTEXT = {
    CLASS_BODY_DECLARATION: 'ClassBodyDeclarationContext',
    METHOD_DECLARATION: 'MethodDeclarationContext',
    FORMAL_PARAMETER: 'FormalParameterContext'
};

/** Collect nodes of a given context type. */
export function findAll(root, contextType) {
    const out = [];
    walk(root, (n) => { if (nodeType(n) === contextType) out.push(n); });
    return out;
}
