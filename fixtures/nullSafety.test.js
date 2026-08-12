/**
 * PROBE — is an LWC template null-safe, and WHERE?
 *
 * Not a test of our code: a measurement of the PLATFORM, so the codemod's
 * translation rules rest on observed behaviour instead of on what seems
 * likely. Motivation: on the first real org, 9 of 20 generated components
 * crashed with "Cannot read properties of undefined (reading 'map')" while the
 * LWC they came from rendered a blank card without complaint.
 *
 * THE RESULT IS SPLIT, and the split is the whole point:
 *
 *   for:each / iterator:*  over undefined  -> renders NOTHING. Safe.
 *   {a.b.c} through undefined `b`          -> THROWS. Not safe.
 *
 * So the codemod must guard iteration (a literal `.map` is a crash the
 * original never had) and must NOT paper over member access with optional
 * chaining (that would SUPPRESS a crash the original did have, turning a loud
 * bug into a silently blank screen — strictly worse for a migration, where the
 * job is to find behaviour differences, not to hide them).
 *
 * The first draft of this probe assumed both were safe. The measurement said
 * otherwise; the rule follows the measurement.
 */
import { createElement } from 'lwc';
import Probe from 'c/nullSafetyProbe';
import DeepProbe from 'c/nullSafetyProbeDeep';

function mount(Ctor, tag, props = {}) {
    const el = createElement(tag, { is: Ctor });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

const mountProbe = (props) => mount(Probe, 'c-null-safety-probe', props);

describe('PROBE — LWC iteration IS null-safe', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('renders at all with every iterable undefined', () => {
        expect(() => mountProbe()).not.toThrow();
    });

    it('for:each over undefined renders NOTHING (not a crash)', () => {
        const el = mountProbe();
        expect(el.shadowRoot.querySelector('.iter').children.length).toBe(0);
    });

    it('iterator:* over undefined renders NOTHING (not a crash)', () => {
        const el = mountProbe();
        expect(el.shadowRoot.querySelector('.iterof').children.length).toBe(0);
    });

    it('the undefined field rendered AS TEXT is empty, not "undefined"', () => {
        const el = mountProbe();
        expect(el.shadowRoot.querySelector('.text').textContent).toBe('');
    });

    it('if:true on an undefined field is falsy, not an error', () => {
        const el = mountProbe();
        expect(el.shadowRoot.querySelector('.cond')).toBeNull();
    });

    it('for:each over a real list still iterates (guards a vacuous pass)', () => {
        // Without this, a template that silently failed to compile would make
        // every assertion above trivially true.
        const el = mountProbe({ undefinedList: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
        expect(el.shadowRoot.querySelector('.iter').children.length).toBe(2);
    });
});

describe('PROBE — LWC member access is NOT null-safe', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    /**
     * The error does NOT propagate out of appendChild.
     *
     * connectedCallback runs inside jsdom's custom-element machinery, which
     * catches whatever it throws and re-reports it as an uncaught `error`
     * event on window. So `expect(...).toThrow()` sees nothing and reads as
     * "LWC handled it gracefully" — the opposite of the truth. Two drafts of
     * this probe recorded that wrong conclusion before the render output was
     * actually inspected.
     */
    function mountCapturingUncaught(props) {
        const seen = [];
        const onError = (e) => { seen.push(e.error ? e.error.message : e.message); };
        window.addEventListener('error', onError);
        try {
            mount(DeepProbe, 'c-null-safety-probe-deep', props);
        } catch (e) {
            seen.push(e.message);              // in case it ever does propagate
        } finally {
            window.removeEventListener('error', onError);
        }
        return seen;
    }

    it('{obj.length} THROWS when obj is undefined', () => {
        // Recorded so nobody "fixes" the codemod by emitting a?.b. React
        // throwing here is FAITHFUL — it is what the original did. Silencing
        // it would convert a loud bug into a blank screen, which for a
        // migration is strictly worse: the job is to FIND behaviour
        // differences, not to hide them.
        const errors = mountCapturingUncaught();
        expect(errors.join('\n')).toMatch(/Cannot read propert/);
    });

    it('and is silent once the value exists', () => {
        expect(mountCapturingUncaught({ obj: 'abc' })).toEqual([]);
    });
});
