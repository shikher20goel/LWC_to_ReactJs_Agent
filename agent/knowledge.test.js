/**
 * Knowledge-store tests.
 *
 * These assert the SAFETY properties. A self-learning agent that learns the
 * wrong thing is worse than one that learns nothing, because a gap is
 * reported and a wrong entry is silently trusted forever.
 */
import {
    observe, promote, recordFailure, recordFix, reusableFixes, unverifiedFixes,
    verifiedConstructs, pendingConstructs, failureSignature, loadKnowledge, saveKnowledge
} from './knowledge.js';

const fresh = () => ({ version: 1, updated: null, constructs: {}, failures: {}, runs: [] });

describe('KNOWLEDGE — nothing becomes verified without evidence', () => {
    it('REFUSES to mark a construct verified without oracle evidence', () => {
        // The whole safety model. Verified-without-evidence is exactly how a
        // plausible-but-wrong mapping becomes permanent.
        const k = observe(fresh(), { key: 'base:lightning-combobox', kind: 'base-component', component: 'x' });
        promote(k, 'base:lightning-combobox', 'proposed');
        expect(() => promote(k, 'base:lightning-combobox', 'verified'))
            .toThrow(/without evidence/);
    });

    it('accepts verified WITH evidence, and records what proved it', () => {
        const k = observe(fresh(), { key: 'base:x', kind: 'base-component', component: 'c' });
        promote(k, 'base:x', 'proposed');
        promote(k, 'base:x', 'verified', { promotedBy: 'oracle/x.react.test.js' });
        expect(k.constructs['base:x'].state).toBe('verified');
        expect(k.constructs['base:x'].promotedBy).toBe('oracle/x.react.test.js');
    });

    it('starts every construct as observed — never as known', () => {
        const k = observe(fresh(), { key: 'slds:slds-foo', kind: 'slds-class', component: 'c' });
        expect(k.constructs['slds:slds-foo'].state).toBe('observed');
    });

    it('exposes ONLY verified knowledge as safe to act on', () => {
        const k = fresh();
        observe(k, { key: 'a', kind: 'base-component', component: 'c1' });
        observe(k, { key: 'b', kind: 'base-component', component: 'c2' });
        promote(k, 'b', 'proposed');
        promote(k, 'b', 'verified', { promotedBy: 'oracle' });
        expect(verifiedConstructs(k).map((c) => c.key)).toEqual(['b']);
        expect(pendingConstructs(k).map((c) => c.key)).toEqual(['a']);
    });

    it('rejects an unknown state rather than storing it', () => {
        const k = observe(fresh(), { key: 'a', kind: 'x', component: 'c' });
        expect(() => promote(k, 'a', 'probably-fine')).toThrow(/Unknown knowledge state/);
    });

    it('refuses to promote a construct it has never seen', () => {
        expect(() => promote(fresh(), 'never-seen', 'proposed')).toThrow(/unknown construct/i);
    });
});

describe('KNOWLEDGE — learning accumulates without losing what was proven', () => {
    it('counts repeat sightings and records where', () => {
        const k = fresh();
        observe(k, { key: 'base:x', kind: 'base-component', component: 'a' });
        observe(k, { key: 'base:x', kind: 'base-component', component: 'b' });
        observe(k, { key: 'base:x', kind: 'base-component', component: 'a' });
        expect(k.constructs['base:x'].uses).toBe(3);
        expect(k.constructs['base:x'].seenIn).toEqual(['a', 'b']);   // deduped
    });

    it('does NOT demote verified knowledge when the construct is seen again', () => {
        // Re-running learn on the same source must not undo a promotion.
        const k = observe(fresh(), { key: 'base:x', kind: 'base-component', component: 'a' });
        promote(k, 'base:x', 'proposed');
        promote(k, 'base:x', 'verified', { promotedBy: 'oracle' });
        observe(k, { key: 'base:x', kind: 'base-component', component: 'b' });
        expect(k.constructs['base:x'].state).toBe('verified');
        expect(k.constructs['base:x'].uses).toBe(2);
    });

    it('ranks pending constructs by usage — highest impact first', () => {
        const k = fresh();
        observe(k, { key: 'rare', kind: 'x', component: 'a' });
        for (const c of ['a', 'b', 'c']) observe(k, { key: 'common', kind: 'x', component: c });
        expect(pendingConstructs(k)[0].key).toBe('common');
    });
});

describe('KNOWLEDGE — self-healing reuses only VERIFIED fixes', () => {
    it('keys failures by signature, not message', () => {
        // Messages contain component names and counts so they never repeat;
        // the signature is the shape, which is what actually recurs.
        expect(failureSignature({ kind: 'multi-template', subject: 'render()' }))
            .toBe('multi-template::render()');
    });

    it('counts recurrence across components', () => {
        const k = fresh();
        const sig = recordFailure(k, { kind: 'multi-template', subject: 'render()', component: 'a' });
        recordFailure(k, { kind: 'multi-template', subject: 'render()', component: 'b' });
        expect(k.failures[sig].count).toBe(2);
        expect(k.failures[sig].seenIn).toEqual(['a', 'b']);
    });

    it('will NOT reuse a fix that the oracle never confirmed', () => {
        // An unverified fix is a guess with a history. Auto-applying it would
        // propagate one bad idea to every component sharing the signature.
        const k = fresh();
        const sig = recordFailure(k, { kind: 'k', subject: 's', component: 'a' });
        recordFix(k, sig, { fix: 'maybe do this' });
        expect(reusableFixes(k)).toEqual([]);
        expect(unverifiedFixes(k)).toHaveLength(1);
    });

    it('reuses a fix once the oracle confirmed it', () => {
        const k = fresh();
        const sig = recordFailure(k, { kind: 'k', subject: 's', component: 'a' });
        recordFix(k, sig, { fix: 'do this', verifiedBy: 'oracle/x.test.js' });
        expect(reusableFixes(k).map((f) => f.sig)).toEqual([sig]);
        expect(unverifiedFixes(k)).toEqual([]);
    });

    it('refuses a fix for an unknown signature', () => {
        expect(() => recordFix(fresh(), 'nope::nope', { fix: 'x' })).toThrow(/Unknown failure signature/);
    });
});

describe('KNOWLEDGE — persistence is honest about corruption', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-'));

    it('round-trips through disk', () => {
        const k = observe(fresh(), { key: 'base:x', kind: 'base-component', component: 'c' });
        saveKnowledge(k, { dir: tmp, stamp: '2026-01-01T00:00:00Z' });
        const back = loadKnowledge({ dir: tmp });
        expect(back.constructs['base:x'].uses).toBe(1);
        expect(back.updated).toBe('2026-01-01T00:00:00Z');
    });

    it('returns an empty store when none exists yet', () => {
        const empty = loadKnowledge({ dir: path.join(tmp, 'nothing-here') });
        expect(empty.constructs).toEqual({});
    });

    it('THROWS on a corrupt store rather than silently starting over', () => {
        // Silently resetting would discard every verified promotion and look
        // like a clean first run.
        fs.writeFileSync(path.join(tmp, 'knowledge.json'), '{ not json');
        expect(() => loadKnowledge({ dir: tmp })).toThrow(/refusing to silently start over/i);
    });
});
