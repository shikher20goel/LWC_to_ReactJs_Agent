/**
 * Fixture validation — two independent jobs, deliberately not merged.
 *
 * 1. SHAPE (CLAUDE.md rule 6). Fixtures must use the real nested LDS shape,
 *    `fields.X.value`. A flattened convenience object still renders, still
 *    passes tests, and silently blinds the oracle to the [object Object]
 *    defect — the most common conversion bug and the one that broke
 *    Salesforce's own Aura->LWC agent. A flat fixture is worse than no
 *    fixture because it looks like coverage.
 *
 * 2. PROVENANCE (CLAUDE.md rule 7). A HEURISTIC scan for values that look
 *    like real customer data. This is a backstop against an accident, NOT a
 *    clearance mechanism — it cannot prove data is synthetic, and passing it
 *    is not permission to commit anything. See research/10: once real records
 *    are in git history, Art. 17 erasure is practically unsatisfiable.
 *
 * Sequences: LDS emits more than once (cache-then-revalidate), so a fixture
 * may be an ARRAY of emissions. A single-value fixture cannot express the
 * pre-emit frame or the revalidation frame, and those are where real defects
 * hide (research/10 §3).
 */

/** A well-formed LDS field entry. */
function isFieldEntry(v) {
    return v !== null
        && typeof v === 'object'
        && !Array.isArray(v)
        && Object.prototype.hasOwnProperty.call(v, 'value');
}

export function validateRecordShape(record, path = '$') {
    const errors = [];

    if (record === null || typeof record !== 'object') {
        errors.push({ path, kind: 'not-a-record', detail: 'Expected a record object.' });
        return errors;
    }

    if (!Object.prototype.hasOwnProperty.call(record, 'fields')) {
        errors.push({
            path,
            kind: 'flattened-record',
            detail: 'No `fields` key. This looks like a FLATTENED fixture. LDS records '
                + 'are nested: { apiName, fields: { Name: { value, displayValue } } }. '
                + 'A flat fixture blinds the oracle to the [object Object] defect.'
        });
        return errors;
    }

    if (typeof record.apiName !== 'string' || !record.apiName) {
        errors.push({ path, kind: 'missing-apiName', detail: 'Record needs an `apiName`.' });
    }

    const fields = record.fields;
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        errors.push({ path: `${path}.fields`, kind: 'bad-fields', detail: '`fields` must be an object.' });
        return errors;
    }

    for (const [name, entry] of Object.entries(fields)) {
        const p = `${path}.fields.${name}`;
        if (!isFieldEntry(entry)) {
            errors.push({
                path: p,
                kind: 'flattened-field',
                detail: `Field "${name}" is a bare value. Expected { value, displayValue }.`
            });
            continue;
        }
        // Spanning field: the value is itself a record.
        const v = entry.value;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)
            && Object.prototype.hasOwnProperty.call(v, 'fields')) {
            errors.push(...validateRecordShape(v, `${p}.value`));
        }
    }

    return errors;
}

/** Accepts a single record or a SEQUENCE of emissions. */
export function validateFixture(fixture) {
    if (Array.isArray(fixture)) {
        return fixture.flatMap((f, i) => validateRecordShape(f, `$[${i}]`));
    }
    return validateRecordShape(fixture);
}

/* ------------------------------------------------------------------ *
 * Provenance heuristics — a backstop, not a clearance
 * ------------------------------------------------------------------ */

const PII_PATTERNS = [
    { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/, note: 'looks like an email address' },
    { kind: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/, note: 'looks like a US SSN' },
    { kind: 'phone', re: /\b(?:\+?1[ -.])?\(?\d{3}\)?[ -.]\d{3}[ -.]\d{4}\b/, note: 'looks like a phone number' },
    { kind: 'credit-card', re: /\b(?:\d[ -]?){13,16}\b/, note: 'looks like a payment card number' }
];

/** Test-shaped ids we deliberately allow (repeated digits / obvious filler). */
const SYNTHETIC_ID = /^(a01|001|003|005)x{2}0{3,}\d*(AAA)?$/i;

export function scanForRealData(value, path = '$', findings = []) {
    if (typeof value === 'string') {
        for (const p of PII_PATTERNS) {
            if (p.re.test(value)) {
                findings.push({ path, kind: p.kind, detail: `${p.note}: ${JSON.stringify(value)}` });
            }
        }
        // A full 18-char Salesforce id that is not obviously synthetic.
        if (/^[a-zA-Z0-9]{18}$/.test(value) && !SYNTHETIC_ID.test(value)) {
            findings.push({
                path, kind: 'record-id',
                detail: `"${value}" is a full-length Salesforce id and does not look synthetic.`
            });
        }
    } else if (Array.isArray(value)) {
        value.forEach((v, i) => scanForRealData(v, `${path}[${i}]`, findings));
    } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) scanForRealData(v, `${path}.${k}`, findings);
    }
    return findings;
}

export function formatIssues(label, issues) {
    if (!issues.length) return `${label}: clean`;
    return [`${label}: ${issues.length} issue(s)`, ...issues.map(
        (i) => `  ${i.path}\n    [${i.kind}] ${i.detail}`
    )].join('\n');
}
