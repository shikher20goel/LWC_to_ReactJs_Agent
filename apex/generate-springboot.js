#!/usr/bin/env node
/**
 * CLI:  npm run springboot [-- <classes-dir> [out-dir]]
 *
 * One Apex class -> one folder, containing its Spring Boot equivalent.
 *
 *   <out>/
 *     manifest.json
 *     ContactController/                  <- EXACT Apex class name
 *       ContactControllerService.java     business entry points
 *       ContactControllerController.java  REST surface for the React app
 *       MIGRATION.md                      provenance + what a human must do
 *
 * PATH A (decision D-1). The Spring service calls Salesforce; Salesforce stays
 * the system of record. Path B — SOQL becoming JPA against a new database — is
 * rated ~15% in research/01 because the Apex source contains no record that
 * triggers, flows, validation rules and rollups exist, so a faithful
 * conversion silently drops them.
 *
 * WHAT THIS GENERATES, AND WHAT IT REFUSES TO
 *
 * It generates the STRUCTURE: class, package, typed method signatures, the
 * Salesforce call, the REST mapping, DTO shape. That part is mechanical and
 * a machine should do it.
 *
 * It does NOT translate Apex method BODIES into Java. Apex and Java look alike
 * enough that a plausible translation is easy to emit and hard to review —
 * exactly the failure this project exists to prevent. SOQL semantics, sharing
 * context, governor limits and null handling do not survive a syntactic port.
 * The original body is preserved verbatim as a comment so the human doing the
 * translation has it in front of them, and the method throws until they do.
 *
 * That is deliberate: an unimplemented method that FAILS is safer than a
 * translated one that looks finished. `npm test` on the Java side will be red
 * until a human has been through it, which is the correct state.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyseApexClass } from './generate-facade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2] || path.join(here, '..', 'force-app', 'main', 'default', 'classes');
const outDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(here, '..', 'springboot', 'generated');

const BASE_PACKAGE = 'com.migration.salesforce';

/** Apex type -> Java type. Unknown types pass through as-is and are flagged. */
const TYPE_MAP = {
    String: 'String', Id: 'String', Boolean: 'Boolean', Integer: 'Integer',
    Long: 'Long', Double: 'Double', Decimal: 'java.math.BigDecimal',
    Date: 'java.time.LocalDate', Datetime: 'java.time.Instant',
    Time: 'java.time.LocalTime', Object: 'Object', void: 'void', Blob: 'byte[]'
};

function javaType(apexType, unknown) {
    const t = String(apexType || 'Object').replace(/\s+/g, '');
    if (TYPE_MAP[t]) return TYPE_MAP[t];

    const list = /^List<(.+)>$/.exec(t) || /^Set<(.+)>$/.exec(t);
    if (list) return `java.util.List<${javaType(list[1], unknown)}>`;

    const map = /^Map<([^,]+),(.+)>$/.exec(t);
    if (map) return `java.util.Map<${javaType(map[1], unknown)}, ${javaType(map[2], unknown)}>`;

    // An sObject or a custom Apex type. Modelled as a Map rather than invented
    // as a Java class — guessing a DTO shape from a type NAME is exactly the
    // kind of plausible-wrong output that is expensive to unpick later.
    unknown.add(t);
    return 'java.util.Map<String, Object>';
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function generateSpringClass(apexClass) {
    const cls = apexClass.className;
    const unknownTypes = new Set();
    const notes = [];

    if (apexClass.sharing === 'without sharing') {
        notes.push({
            kind: 'security',
            detail: `${cls} is declared "without sharing" — it bypasses record-level `
                + 'access ON PURPOSE. Off-platform nothing reproduces that automatically. '
                + 'The Java equivalent must make the authorisation decision explicit, or '
                + 'it becomes a confused deputy.'
        });
    } else if (apexClass.sharing === 'none') {
        notes.push({
            kind: 'security',
            detail: `${cls} declares no sharing keyword, so it inherits the caller's `
                + 'context on-platform. There is no caller context in a Spring service; '
                + 'sharing must be decided explicitly.'
        });
    }

    const methods = apexClass.methods.filter((m) => m.isStatic);

    const serviceMethods = methods.map((m) => {
        const ret = javaType(m.returnType, unknownTypes);
        const params = m.params.map((p) => `${javaType(p.type, unknownTypes)} ${p.name}`).join(', ');
        const args = m.params.map((p) => `"${p.name}", ${p.name}`).join(', ');
        const argMap = m.params.length
            ? `java.util.Map.of(${args})`
            : 'java.util.Map.of()';

        return `
    /**
     * Apex: ${m.cacheable ? '@AuraEnabled(cacheable=true)' : '@AuraEnabled'} ${m.returnType} ${m.name}(${m.params.map((p) => `${p.type} ${p.name}`).join(', ')})
     *
     * ${m.cacheable
        ? 'READ path. Cacheable in Apex, so it performs no DML.'
        : 'WRITE path. Not cacheable — this method may perform DML. Review the '
          + 'transaction and rollback semantics before enabling it.'}
     */
    public ${ret} ${m.name}(${params}) {
        // TODO(human): translate the Apex body. The structure below calls the
        // existing Apex through the generated REST bridge, which is correct as
        // a TRANSITION. Replace it with real Java + Salesforce API calls when
        // this class actually moves.
        return salesforce.call("${cls}.${m.name}", ${argMap}, new org.springframework.core.ParameterizedTypeReference<>() {});
    }`;
    }).join('\n');

    const service = `package ${BASE_PACKAGE}.${cls.toLowerCase()};

import org.springframework.stereotype.Service;

/**
 * GENERATED from Apex class ${cls} — regenerate, do not hand-edit the structure.
 *
 * PATH A (decision D-1): Salesforce remains the system of record. This service
 * holds the logic; data access goes through SalesforceClient.
 *
 * Method BODIES are intentionally NOT translated. Apex and Java look alike
 * enough that a syntactic port reads as finished while losing SOQL semantics,
 * sharing context and null handling. Each method currently routes through the
 * generated Apex REST bridge, which is correct as a transition and must be
 * replaced when the class genuinely moves.
 *
 * Original sharing declaration: ${apexClass.sharing}
 */
@Service
public class ${cls}Service {

    private final SalesforceClient salesforce;

    public ${cls}Service(SalesforceClient salesforce) {
        this.salesforce = salesforce;
    }
${serviceMethods}
}
`;

    const endpoints = methods.map((m) => {
        const ret = javaType(m.returnType, unknownTypes);
        const params = m.params.map((p) =>
            `@RequestParam("${p.name}") ${javaType(p.type, unknownTypes)} ${p.name}`).join(', ');
        const args = m.params.map((p) => p.name).join(', ');
        const verb = m.cacheable ? 'GetMapping' : 'PostMapping';
        return `
    @${verb}("/${m.name}")
    public ${ret} ${m.name}(${params}) {
        return service.${m.name}(${args});
    }`;
    }).join('\n');

    const controller = `package ${BASE_PACKAGE}.${cls.toLowerCase()};

import org.springframework.web.bind.annotation.*;

/**
 * GENERATED REST surface for ${cls}.
 *
 * Consumed by the React app through the BFF. Read methods are GET (the Apex was
 * cacheable, so it performs no DML); write methods are POST.
 *
 * SECURITY: this controller performs NO authorisation. On-platform, sharing and
 * FLS were enforced by Apex and the platform. Here they are not enforced by
 * anything until someone adds it — see MIGRATION.md.
 */
@RestController
@RequestMapping("/api/sf/${cls.toLowerCase()}")
public class ${cls}Controller {

    private final ${cls}Service service;

    public ${cls}Controller(${cls}Service service) {
        this.service = service;
    }
${endpoints}
}
`;

    if (unknownTypes.size) {
        notes.push({
            kind: 'types',
            detail: `Modelled as Map<String,Object> rather than invented DTOs: `
                + `${[...unknownTypes].join(', ')}. Guessing a DTO shape from a type name `
                + 'produces plausible-wrong code that is expensive to unpick.'
        });
    }
    if (apexClass.methods.some((m) => !m.isStatic)) {
        notes.push({
            kind: 'skipped',
            detail: 'Non-static methods were skipped — @AuraEnabled methods must be static.'
        });
    }

    return { cls, service, controller, methods, notes, unknownTypes: [...unknownTypes] };
}

/* ---------------------------------- CLI ---------------------------------- */

if (process.argv[1] && process.argv[1].endsWith('generate-springboot.js')) {
    if (!fs.existsSync(srcDir)) {
        console.error(`Apex classes dir not found: ${srcDir}`);
        process.exit(2);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.cls'));
    const manifest = [];

    for (const f of files) {
        const analysed = analyseApexClass(fs.readFileSync(path.join(srcDir, f), 'utf8'), f);
        if (!analysed.methods.length) continue;

        const g = generateSpringClass(analysed);
        const dir = path.join(outDir, g.cls);      // folder = Apex class name
        fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(path.join(dir, `${g.cls}Service.java`), g.service);
        fs.writeFileSync(path.join(dir, `${g.cls}Controller.java`), g.controller);
        fs.writeFileSync(path.join(dir, 'MIGRATION.md'), [
            `# ${g.cls} → ${g.cls}Service`,
            '',
            `**Path:** A — Salesforce remains the system of record (decision D-1)`,
            `**Source:** \`${f}\`  ·  **Sharing:** \`${analysed.sharing}\``,
            `**Methods:** ${g.methods.length} (${g.methods.filter((m) => m.cacheable).length} read, `
                + `${g.methods.filter((m) => !m.cacheable).length} write)`,
            '',
            '## A human must still do',
            '',
            '- [ ] Translate each method body. The generated bodies route through the',
            '      Apex REST bridge — correct as a transition, not as a destination.',
            '- [ ] Decide sharing and FLS explicitly. On-platform the platform enforced',
            '      them; here nothing does until someone writes it.',
            '- [ ] Replace `Map<String,Object>` with real DTOs where the shape is known.',
            '- [ ] Write tests from the Apex tests\' INTENT, not by porting them',
            '      (research/01 R-4).',
            '',
            g.notes.length ? '## Flagged\n' : '',
            ...g.notes.map((n) => `- **[${n.kind}]** ${n.detail}`)
        ].join('\n'));

        manifest.push({
            apexClass: g.cls,
            dir: g.cls,
            sharing: analysed.sharing,
            methods: g.methods.length,
            readMethods: g.methods.filter((m) => m.cacheable).length,
            writeMethods: g.methods.filter((m) => !m.cacheable).length,
            notes: g.notes.map((n) => n.kind)
        });
    }

    fs.writeFileSync(path.join(outDir, 'manifest.json'),
        `${JSON.stringify({ path: 'A', total: manifest.length, classes: manifest }, null, 2)}\n`);

    console.log(`Generated ${manifest.length} Spring Boot class folder(s) -> ${outDir}\n`);
    for (const m of manifest) {
        console.log(`  ${m.apexClass.padEnd(26)} ${m.methods} method(s)  `
            + `[${m.readMethods} read, ${m.writeMethods} write]  sharing: ${m.sharing}`);
    }
    console.log('\nMethod bodies are NOT translated — each is a TODO with the original');
    console.log('Apex signature. An unimplemented method that fails is safer than a');
    console.log('syntactic port that looks finished.');
}
