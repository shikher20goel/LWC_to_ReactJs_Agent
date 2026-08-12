#!/usr/bin/env node
/**
 * Generates ONE Apex REST endpoint that bridges the BFF to the existing
 * @AuraEnabled controllers, without editing those controllers.
 *
 * WHY NOT THE OBVIOUS DESIGN
 * The tempting version takes a class name and method name FROM THE CLIENT and
 * invokes them reflectively. That hands an attacker every @AuraEnabled method
 * in the org — including ones no UI ever exposed — which is the confused-deputy
 * problem in its purest form. It is also not even possible: Apex has no general
 * method reflection. The sanctioned dynamic mechanism (System.Callable) needs
 * every controller edited, which defeats the point of a facade.
 *
 * So the allowlist is COMPILE-TIME. The generated switch is the allowlist; a
 * name that is not in it cannot be reached, and adding one requires a code
 * review. Nothing is read from data at runtime — a Custom Metadata registry
 * would let someone widen the attack surface without review, which is the same
 * hole wearing a nicer hat.
 *
 * READ-ONLY BY PLATFORM ENFORCEMENT
 * Only @AuraEnabled(cacheable=true) methods are bridged. Salesforce forbids DML
 * in a cacheable method, so "this endpoint cannot mutate data" is enforced by
 * the platform rather than promised by us. Mutating methods are EXCLUDED and
 * listed, with the reason. That matches "buttons will not work for now" and
 * makes turning buttons on later a deliberate, reviewable act.
 *
 * STILL REQUIRED, and not solved by this file:
 *   - FLS/sharing review per method. Apex does not enforce FLS unless it opts
 *     in, and user-mode default is version-gated (v67.0+). The facade cannot
 *     make an unsafe method safe.
 *   - Auth on the BFF. This endpoint is only as protected as the session
 *     reaching it.
 */
import fs from 'fs';
import path from 'path';
// The parser is reached ONLY through apex/parser.js — see that file for why
// the dependency is vendored rather than inlined.
import { parseApex, walk, nodeText as txt, nodeType, CONTEXT } from './parser.js';

/** Formal parameters, read from the tree — getText() strips whitespace. */
function formalParams(declNode) {
    const params = [];
    walk(declNode, (n) => {
        if (nodeType(n) === CONTEXT.FORMAL_PARAMETER) {
            const kids = (n.children || []).map(txt).filter(Boolean);
            if (kids.length >= 2) {
                params.push({ type: kids.slice(0, -1).join(''), name: kids[kids.length - 1] });
            }
        }
    });
    return params;
}

export function analyseApexClass(source, fileName) {
    const cu = parseApex(source);
    const className = (source.match(/\bclass\s+(\w+)/) || [])[1] || path.basename(fileName, '.cls');
    const sharing = /\bwith\s+sharing\b/i.test(source) ? 'with sharing'
        : (/\bwithout\s+sharing\b/i.test(source) ? 'without sharing'
            : (/\binherited\s+sharing\b/i.test(source) ? 'inherited sharing' : 'none'));

    const methods = [];
    walk(cu, (n) => {
        if (nodeType(n) !== CONTEXT.CLASS_BODY_DECLARATION) return;
        const body = txt(n);
        if (!body.includes('AuraEnabled')) return;

        const ann = (body.match(/AuraEnabled(\([^)]*\))?/) || [])[0] || '';
        const cacheable = /cacheable\s*=\s*true/i.test(ann);

        let decl = null;
        walk(n, (m) => {
            if (!decl && nodeType(m) === CONTEXT.METHOD_DECLARATION) decl = m;
        });
        if (!decl) return;

        const kids = decl.children || [];
        const name = txt(kids[1]) || txt(kids[0]);
        const returnType = txt(kids[0]);

        methods.push({
            className,
            name,
            returnType,
            cacheable,
            // NOT /\bstatic\b/ — getText() concatenates without whitespace, so
            // the source reads "publicstaticList<Contact>getContactList" and a
            // word-boundary match silently never fires. That failure mode is
            // invisible: every method just looks non-static and gets excluded.
            isStatic: /static/i.test(body),
            params: formalParams(decl)
        });
    });

    return { className, sharing, methods, fileName };
}

/** Apex cast for a JSON value. Anything non-primitive round-trips via JSON. */
function coerce(param) {
    const t = param.type.replace(/\s+/g, '');
    const PRIMITIVES = ['String', 'Id', 'Boolean', 'Integer', 'Long', 'Double', 'Decimal', 'Date', 'Datetime'];
    if (PRIMITIVES.includes(t)) {
        // Integer/Decimal arrive from JSON as Integer/Decimal already.
        return `(${t}) args.get('${param.name}')`;
    }
    return `(${t}) JSON.deserialize(JSON.serialize(args.get('${param.name}')), ${t}.class)`;
}

export function generateFacade(classes, { resourceName = 'LwcBridgeResource', urlMapping = '/lwcbridge/*' } = {}) {
    const included = [];
    const excluded = [];

    for (const c of classes) {
        for (const m of c.methods) {
            if (!m.cacheable) {
                excluded.push({
                    ...m,
                    reason: 'not cacheable=true — may perform DML, so it is a WRITE path. '
                        + 'Bridging it would make this endpoint able to mutate data.'
                });
            } else if (!m.isStatic) {
                excluded.push({ ...m, reason: 'not static — @AuraEnabled methods must be static.' });
            } else {
                included.push(m);
            }
        }
    }

    const cases = included.map((m) => {
        const key = `${m.className}.${m.name}`;
        const argLines = m.params.map((p) => `                    ${p.type} ${p.name} = ${coerce(p)};`);
        const call = `${m.className}.${m.name}(${m.params.map((p) => p.name).join(', ')})`;
        return [
            `                when '${key}' {`,
            ...argLines,
            `                    result = ${call};`,
            '                }'
        ].join('\n');
    }).join('\n');

    const apex = `/**
 * GENERATED by apex/generate-facade.js — do not edit by hand, regenerate.
 *
 * One REST endpoint bridging the React app (via the BFF) to existing
 * @AuraEnabled controllers, which are NOT callable from outside Salesforce.
 *
 * SECURITY PROPERTIES — read before changing anything here:
 *
 *  1. The switch below IS the allowlist, and it is COMPILE-TIME. A method not
 *     listed cannot be reached. Adding one requires a code review. Do not
 *     replace this with a runtime registry (Custom Metadata, a Map built from
 *     data): that lets someone widen the attack surface without review.
 *
 *  2. Only @AuraEnabled(cacheable=true) methods are bridged. Salesforce
 *     forbids DML in a cacheable method, so this endpoint CANNOT mutate data —
 *     enforced by the platform, not promised by us. ${excluded.length} mutating
 *     method(s) were excluded; see the report.
 *
 *  3. NEVER reach @AuraEnabled via /s/sfsites/aura instead of this. That
 *     endpoint is undocumented, unversioned, and publicly documented as an
 *     attack technique.
 *
 * Still required and NOT solved here: an FLS/sharing review of every bridged
 * method. Apex does not enforce FLS unless it opts in, and the user-mode
 * default is version-gated (v67.0+).
 */
@RestResource(urlMapping='${urlMapping}')
global with sharing class ${resourceName} {

    global class BridgeRequest {
        public String op;
        public Map<String, Object> args;
    }

    @HttpPost
    global static void dispatch() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');

        try {
            BridgeRequest req = (BridgeRequest) JSON.deserialize(
                RestContext.request.requestBody.toString(), BridgeRequest.class);

            if (req == null || String.isBlank(req.op)) {
                res.statusCode = 400;
                res.responseBody = Blob.valueOf(JSON.serialize(
                    new Map<String, Object>{ 'error' => 'Missing "op".' }));
                return;
            }

            Map<String, Object> args = req.args == null
                ? new Map<String, Object>() : req.args;
            Object result;

            switch on req.op {
${cases}
                when else {
                    // Not an allowlisted operation. Deliberately does NOT echo
                    // the op back — that would confirm which names exist.
                    res.statusCode = 404;
                    res.responseBody = Blob.valueOf(JSON.serialize(
                        new Map<String, Object>{ 'error' => 'Unknown operation.' }));
                    return;
                }
            }

            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(result));

        } catch (Exception e) {
            // Type and message only. A stack trace can disclose class and
            // field names that are not otherwise visible to the caller.
            res.statusCode = 500;
            res.responseBody = Blob.valueOf(JSON.serialize(
                new Map<String, Object>{
                    'error' => e.getTypeName(),
                    'message' => e.getMessage()
                }));
        }
    }
}
`;

    return { apex, included, excluded };
}

/* ---------------------------------- CLI ---------------------------------- */

if (process.argv[1] && process.argv[1].endsWith('generate-facade.js')) {
    const dir = process.argv[2];
    const outDir = process.argv[3] || path.join(process.cwd(), 'apex', 'generated');
    if (!dir || !fs.existsSync(dir)) {
        console.error('usage: node apex/generate-facade.js <classes-dir> [out-dir]');
        process.exit(2);
    }

    const classes = fs.readdirSync(dir).filter((f) => f.endsWith('.cls'))
        .map((f) => analyseApexClass(fs.readFileSync(path.join(dir, f), 'utf8'), f));

    const { apex, included, excluded } = generateFacade(classes);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'LwcBridgeResource.cls'), apex);
    fs.writeFileSync(path.join(outDir, 'LwcBridgeResource.cls-meta.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n'
        + '    <apiVersion>62.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n');

    console.log(`Bridged (read-only, cacheable=true): ${included.length}`);
    for (const m of included) console.log(`   ${m.className}.${m.name}(${m.params.map((p) => p.type).join(', ')})`);
    console.log(`\nEXCLUDED — these are write paths: ${excluded.length}`);
    for (const m of excluded) console.log(`   ${m.className}.${m.name}  — ${m.reason}`);
    console.log(`\nWritten: ${path.join(outDir, 'LwcBridgeResource.cls')}`);
}
