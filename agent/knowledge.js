/**
 * The agent's persistent memory.
 *
 * As components and Apex classes land in force-app/, the agent accumulates
 * knowledge here and reuses it on the next run. This is the "self-learning"
 * mechanism — but built the way research/02 prescribes, not the obvious way.
 *
 * WHY IT DOES NOT LEARN MAPPINGS BY ITSELF
 *
 * The tempting design has the agent infer a mapping from what it sees and
 * write it straight into the catalog. That directly violates CLAUDE.md rule 3
 * (never invent a base-component or wire-adapter mapping), and the asymmetry
 * is the whole point:
 *
 *   a MISSING entry  -> reported, blocks the build, gets fixed
 *   a WRONG entry    -> silently trusted forever, and every future conversion
 *                       inherits it
 *
 * An agent that guesses `lightning-combobox` has a prop called `items` (it is
 * `options`) produces a false prop diff on every render, and the diff looks
 * like the COMPONENT is wrong rather than the catalog. Learning the wrong
 * thing is worse than learning nothing.
 *
 * SO KNOWLEDGE HAS THREE STATES, AND ONLY EVIDENCE MOVES IT FORWARD
 *
 *   observed   the agent saw a construct it does not know. Recorded with
 *              evidence (which components, how many uses). No claim is made
 *              about what it MEANS.
 *   proposed   a candidate entry exists. It is NOT used by the codemod.
 *              Requires a human or a documented source to fill in semantics.
 *   verified   a component using it converted ORACLE-GREEN. Only now does the
 *              codemod trust it.
 *
 * THE ORACLE IS THE PROMOTION GATE. That is the part that makes this safe:
 * knowledge is promoted by evidence that a real conversion behaved
 * identically to the original, not by the agent's confidence. research/13
 * found nobody else pairs generation with a differential oracle as the
 * fitness function; this is that pairing applied to learning.
 *
 * Self-healing works the same way: a failure signature is recorded with the
 * fix that resolved it, and a fix is only reused after the oracle confirmed
 * it worked. A "fix" that was never verified is a guess with a history.
 */

import fs from 'fs';
import path from 'path';

const STATES = ['observed', 'proposed', 'verified'];

function resolveStore() {
    let here = null;
    try {
        // eslint-disable-next-line camelcase
        if (typeof __dirname !== 'undefined') here = __dirname;
    } catch { /* ignore */ }
    const base = here ? path.join(here, '..') : process.cwd();
    return path.join(base, 'knowledge');
}

const EMPTY = {
    version: 1,
    updated: null,
    constructs: {},   // key -> { kind, state, uses, seenIn[], evidence, promotedBy }
    failures: {},     // signature -> { count, seenIn[], fix, verifiedBy }
    runs: []          // append-only audit trail
};

export function loadKnowledge({ dir = resolveStore() } = {}) {
    const file = path.join(dir, 'knowledge.json');
    if (!fs.existsSync(file)) return { ...EMPTY, constructs: {}, failures: {}, runs: [] };
    try {
        return { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
        // A corrupt store must not silently reset to empty — that would
        // discard every verified promotion and look like a fresh start.
        throw new Error(`knowledge.json is unreadable (${e.message}). `
            + 'Fix or delete it deliberately; refusing to silently start over.');
    }
}

export function saveKnowledge(k, { dir = resolveStore(), stamp } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const out = { ...k, updated: stamp || k.updated };
    fs.writeFileSync(path.join(dir, 'knowledge.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
}

/**
 * Record that a construct was seen. Never claims to know what it means.
 * Idempotent: re-running on the same source updates counts, not history.
 */
export function observe(k, { key, kind, component, detail }) {
    const existing = k.constructs[key];
    if (!existing) {
        k.constructs[key] = {
            kind,
            state: 'observed',
            uses: 1,
            seenIn: [component],
            evidence: detail ? [detail] : [],
            firstSeen: component
        };
        return k;
    }
    // Do NOT reset state — a verified construct stays verified when seen again.
    existing.uses += 1;
    if (!existing.seenIn.includes(component)) existing.seenIn.push(component);
    if (detail && !existing.evidence.includes(detail)) existing.evidence.push(detail);
    return k;
}

/**
 * Promote a construct. `verified` REQUIRES oracle evidence — passing anything
 * else is the failure mode this whole file exists to prevent.
 */
export function promote(k, key, state, { promotedBy } = {}) {
    if (!STATES.includes(state)) {
        throw new Error(`Unknown knowledge state "${state}". Expected: ${STATES.join(', ')}`);
    }
    const c = k.constructs[key];
    if (!c) throw new Error(`Cannot promote unknown construct "${key}".`);
    if (state === 'verified' && !promotedBy) {
        throw new Error(
            `Refusing to mark "${key}" verified without evidence. Pass promotedBy `
            + '(the oracle test that proved a component using it converts green). '
            + 'Verified-without-evidence is how a wrong mapping becomes permanent.'
        );
    }
    c.state = state;
    if (promotedBy) c.promotedBy = promotedBy;
    return k;
}

/** Only verified knowledge is safe for the codemod to act on. */
export function verifiedConstructs(k) {
    return Object.entries(k.constructs)
        .filter(([, c]) => c.state === 'verified')
        .map(([key, c]) => ({ key, ...c }));
}

export function pendingConstructs(k) {
    return Object.entries(k.constructs)
        .filter(([, c]) => c.state !== 'verified')
        .map(([key, c]) => ({ key, ...c }))
        .sort((a, b) => b.uses - a.uses);   // highest-impact gap first
}

/* ------------------------------------------------------------------ *
 * Self-healing: failure signatures
 * ------------------------------------------------------------------ */

/**
 * A failure SIGNATURE, not a message. Messages contain component names and
 * counts, so they never repeat; a signature is the shape of the failure and
 * is what actually recurs.
 */
export function failureSignature({ kind, subject }) {
    return `${kind}::${subject}`;
}

export function recordFailure(k, { kind, subject, component }) {
    const sig = failureSignature({ kind, subject });
    const f = k.failures[sig] || { kind, subject, count: 0, seenIn: [], fix: null, verifiedBy: null };
    f.count += 1;
    if (!f.seenIn.includes(component)) f.seenIn.push(component);
    k.failures[sig] = f;
    return sig;
}

/**
 * Attach a fix to a failure signature.
 * `verifiedBy` is required for the fix to be REUSED — an unverified fix is
 * recorded as a suggestion only, so a bad fix cannot silently propagate to
 * every future component with the same failure.
 */
export function recordFix(k, sig, { fix, verifiedBy = null }) {
    const f = k.failures[sig];
    if (!f) throw new Error(`Unknown failure signature "${sig}".`);
    f.fix = fix;
    f.verifiedBy = verifiedBy;
    return k;
}

/** Fixes the agent may APPLY — verified only. */
export function reusableFixes(k) {
    return Object.entries(k.failures)
        .filter(([, f]) => f.fix && f.verifiedBy)
        .map(([sig, f]) => ({ sig, ...f }));
}

/** Suggestions a human should look at — recorded but never auto-applied. */
export function unverifiedFixes(k) {
    return Object.entries(k.failures)
        .filter(([, f]) => f.fix && !f.verifiedBy)
        .map(([sig, f]) => ({ sig, ...f }));
}

export { resolveStore, STATES };
