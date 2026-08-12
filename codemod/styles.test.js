/**
 * SLDS converter tests.
 *
 * The density and non-linearity assertions are the load-bearing ones: both
 * failure modes COMPILE and LOOK CORRECT in development, so only a test
 * catches them.
 */
import { convertClasses, formatMappingReport, SLDS } from './styles.js';

describe('SLDS — the spacing scale is NON-LINEAR', () => {
    it('small is 0.75rem, not 1rem', () => {
        // The single most common wrong assumption. A 4px-grid mapping puts
        // this at 1rem and shifts spacing across the whole app.
        expect(SLDS.spacing.small.rem).toBe(0.75);
        expect(SLDS.spacing.small.px).toBe(12);
    });

    it('has the exact verified scale', () => {
        expect(SLDS.spacing['xxx-small'].px).toBe(2);
        expect(SLDS.spacing['xx-small'].px).toBe(4);
        expect(SLDS.spacing['x-small'].px).toBe(8);
        expect(SLDS.spacing.medium.px).toBe(16);
        expect(SLDS.spacing.large.px).toBe(24);
        expect(SLDS.spacing['x-large'].px).toBe(32);
        expect(SLDS.spacing['xx-large'].px).toBe(48);
    });

    it('is not a uniform progression — steps are not evenly spaced', () => {
        const px = ['xxx-small', 'xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large']
            .map((k) => SLDS.spacing[k].px);
        const deltas = px.slice(1).map((v, i) => v - px[i]);
        expect(new Set(deltas).size).toBeGreaterThan(1);
    });
});

describe('SLDS — density (slds-var-*) must survive conversion', () => {
    it('emits a custom property for var- classes under the default preset', () => {
        const r = convertClasses('slds-var-p-around_medium');
        expect(r.css).toContain('var(');
        expect(r.css).toContain('1rem');          // fallback keeps Comfy correct
        expect(r.warnings).toEqual([]);
    });

    it('emits a FIXED value for the non-var form', () => {
        const r = convertClasses('slds-p-around_medium');
        expect(r.css).toBe('padding:1rem');
        expect(r.css).not.toContain('var(');
    });

    it('WARNS when a lossy preset destroys density', () => {
        // Silence here would be the bug: Compact just stops working and
        // nothing in the output says so.
        const r = convertClasses('slds-var-p-around_medium', { preset: 'static' });
        expect(r.css).toBe('padding:1rem');
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0].kind).toBe('density-lost');
    });

    it('does not warn for a non-var class under a lossy preset', () => {
        const r = convertClasses('slds-p-around_medium', { preset: 'static' });
        expect(r.warnings).toEqual([]);
    });

    it('resolves the THREE axis token groups, not one', () => {
        // top/bottom/vertical, left/right/horizontal, and around use different
        // token groups. One group for all gives the right answer in Comfy and
        // the wrong one in Compact.
        expect(SLDS.axisGroupFor('top')).toBe('var-spacing-vertical');
        expect(SLDS.axisGroupFor('vertical')).toBe('var-spacing-vertical');
        expect(SLDS.axisGroupFor('left')).toBe('var-spacing-horizontal');
        expect(SLDS.axisGroupFor('horizontal')).toBe('var-spacing-horizontal');
        expect(SLDS.axisGroupFor('around')).toBe('var-spacing');
    });
});

describe('SLDS — spacing axes and margin/padding', () => {
    it('maps padding vs margin from the p/m segment', () => {
        expect(convertClasses('slds-p-top_small').css).toBe('padding-top:0.75rem');
        expect(convertClasses('slds-m-top_small').css).toBe('margin-top:0.75rem');
    });

    it('expands horizontal and vertical to two properties', () => {
        expect(convertClasses('slds-p-horizontal_x-small').css)
            .toBe('padding-left:0.5rem;padding-right:0.5rem');
        expect(convertClasses('slds-m-vertical_medium').css)
            .toBe('margin-top:1rem;margin-bottom:1rem');
    });

    it('keeps !important on _none — the only step that has it', () => {
        expect(convertClasses('slds-p-around_none').css).toBe('padding:0rem !important');
        expect(convertClasses('slds-p-around_medium').css).not.toContain('!important');
    });
});

describe('SLDS — layout', () => {
    it('slds-grid is FLEXBOX, not CSS grid', () => {
        // The name is misleading; display:grid would be wrong.
        expect(convertClasses('slds-grid').css).toBe('display:flex');
    });

    it('converts fractional sizes', () => {
        expect(convertClasses('slds-size_1-of-2').css).toContain('flex:0 0 50%');
        expect(convertClasses('slds-size_1-of-3').css).toContain('33.3333%');
    });

    it('handles a realistic multi-class attribute', () => {
        const r = convertClasses('slds-grid slds-wrap slds-grid_vertical-align-center');
        expect(r.css).toBe('display:flex;flex-wrap:wrap;align-items:center');
        expect(r.unmapped).toEqual([]);
    });
});

describe('SLDS — visibility and a11y', () => {
    it('keeps !important on slds-hide (asymmetric with slds-show)', () => {
        expect(convertClasses('slds-hide').css).toContain('!important');
        expect(convertClasses('slds-show').css).not.toContain('!important');
    });

    it('keeps slds-assistive-text visually hidden but readable', () => {
        // display:none would remove it from the a11y tree entirely.
        const css = convertClasses('slds-assistive-text').css;
        expect(css).not.toContain('display:none');
        expect(css).toContain('position:absolute');
        expect(css).toContain('clip:');
    });
});

describe('SLDS — nothing is silently dropped', () => {
    it('reports unknown slds- classes instead of discarding them', () => {
        const r = convertClasses('slds-totally-made-up-class');
        expect(r.css).toBe('');
        expect(r.unmapped).toHaveLength(1);
        expect(r.unmapped[0].cls).toBe('slds-totally-made-up-class');
    });

    it('reports an unknown spacing STEP rather than guessing a value', () => {
        const r = convertClasses('slds-p-around_gigantic');
        expect(r.unmapped[0].reason).toMatch(/unknown spacing step/);
    });

    it('separates component-owned classes from unmapped ones', () => {
        // slds-card__header belongs to a component the codemod already
        // replaces. Dropping it is correct; calling it "unmapped" is noise.
        const r = convertClasses('slds-card__header slds-button_brand');
        expect(r.componentOwned).toEqual(['slds-card__header', 'slds-button_brand']);
        expect(r.unmapped).toEqual([]);
    });

    it('passes non-SLDS classes through untouched', () => {
        const r = convertClasses('my-custom-class slds-grid');
        expect(r.passthrough).toEqual(['my-custom-class']);
        expect(r.css).toBe('display:flex');
    });

    it('rejects an unknown preset instead of silently defaulting', () => {
        expect(() => convertClasses('slds-grid', { preset: 'nope' }))
            .toThrow(/Unknown SLDS preset/);
    });
});

describe('SLDS — the mapping report is the team-facing artifact', () => {
    it('produces a reviewable SLDS -> CSS table', () => {
        const results = [
            convertClasses('slds-grid slds-var-m-around_medium'),
            convertClasses('slds-unknown-thing', { preset: 'static' })
        ];
        const md = formatMappingReport(results);
        expect(md).toContain('| SLDS class | becomes |');
        expect(md).toContain('slds-grid');
        expect(md).toContain('Unmapped');
        expect(md).toContain('slds-unknown-thing');
    });
});
