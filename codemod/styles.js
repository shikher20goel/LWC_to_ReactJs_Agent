/**
 * SLDS class -> React CSS converter.
 *
 * Reads catalog/slds.xml. Teams change the MAPPING, not this file.
 *
 * Three rules this is built around, all from research/11:
 *
 *  1. DENSITY IS A FEATURE, NOT NOISE. `slds-var-*` drives Display Density —
 *     varSpacingMedium is 1rem in Comfy and 0.5rem in Compact. Emitting a
 *     fixed value compiles, looks correct in dev, and silently removes
 *     Compact support. The default preset emits custom properties so density
 *     survives; lossy presets must WARN.
 *
 *  2. THE SCALE IS NON-LINEAR. small=0.75rem, and x-large->xx-large jumps
 *     2->3rem. Mapping onto a linear utility scale shifts spacing everywhere.
 *
 *  3. NEVER SILENTLY DROP A CLASS. Anything unmapped is reported. A converter
 *     that quietly discards what it does not understand produces output that
 *     looks finished and is not.
 */

import { loadSlds } from '../catalog/slds-load.js';

const SLDS = loadSlds();

/** slds-[var-]{p|m}-{axis}_{size} */
const SPACING_RE = /^slds-(var-)?([pm])-(around|top|right|bottom|left|horizontal|vertical)_(.+)$/;

/** slds-size_1-of-3, slds-size_x-small etc. */
const SIZE_RE = /^slds-size_(\d+)-of-(\d+)$/;

const cssProp = (kind, axisProps) =>
    axisProps.map((p) => (kind === 'm' ? p.replace('padding', 'margin') : p));

/** The custom-property chain SLDS itself emits, so density keeps working. */
function densityVar(kind, axis, size, step) {
    const group = SLDS.axisGroupFor(axis);              // three groups, by axis
    const token = `--lwc-${group.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())}`
        + size.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
    return `var(${token}, ${step.rem}rem)`;
}

function convertSpacing(cls, preset, report) {
    const m = SPACING_RE.exec(cls);
    if (!m) return null;
    const [, isVar, kind, axis, size] = m;

    const step = SLDS.spacing[size];
    if (!step) {
        report.unmapped.push({ cls, reason: `unknown spacing step "${size}"` });
        return null;
    }
    const axisDef = SLDS.axes[axis];
    if (!axisDef) {
        report.unmapped.push({ cls, reason: `unknown axis "${axis}"` });
        return null;
    }

    const props = cssProp(kind, axisDef);
    // `_none` is the only step SLDS marks !important. Dropping that changes
    // which rule wins.
    const bang = size === 'none' ? ' !important' : '';

    let value;
    if (isVar && preset.name === 'css-vars') {
        value = densityVar(kind, axis, size, step);
    } else {
        value = `${step.rem}rem`;
        if (isVar) {
            report.warnings.push({
                cls,
                kind: 'density-lost',
                detail: `"${cls}" is density-aware (Compact renders it smaller). Preset `
                    + `"${preset.name}" emits a fixed ${step.rem}rem, so Compact density `
                    + 'stops working for this rule.'
            });
        }
    }

    return props.map((p) => `${p}:${value}${bang}`).join(';');
}

function convertSize(cls, report) {
    const m = SIZE_RE.exec(cls);
    if (!m) return null;
    const [, num, den] = m;
    const pct = (Number(num) / Number(den)) * 100;
    return `flex:0 0 ${pct.toFixed(4).replace(/\.?0+$/, '')}%;max-width:${pct.toFixed(4).replace(/\.?0+$/, '')}%`;
}

/**
 * Convert a class attribute value.
 * Returns the decls plus everything the caller needs to review the result.
 */
export function convertClasses(classAttr, { preset = 'css-vars' } = {}) {
    const p = SLDS.presets[preset];
    if (!p) {
        throw new Error(
            `Unknown SLDS preset "${preset}". Available: ${Object.keys(SLDS.presets).join(', ')}`
        );
    }

    const report = { mapped: [], unmapped: [], componentOwned: [], passthrough: [], warnings: [] };
    const decls = [];

    for (const cls of String(classAttr || '').split(/\s+/).filter(Boolean)) {
        if (!cls.startsWith('slds-')) { report.passthrough.push(cls); continue; }

        // Owned by a component the codemod already replaces — dropping these
        // deliberately is right; reporting them as "unmapped" would be noise.
        if (SLDS.isComponentOwned(cls)) { report.componentOwned.push(cls); continue; }

        const direct = SLDS.classes[cls];
        if (direct) { decls.push(direct); report.mapped.push({ cls, css: direct }); continue; }

        const spacing = convertSpacing(cls, p, report);
        if (spacing) { decls.push(spacing); report.mapped.push({ cls, css: spacing }); continue; }

        const size = convertSize(cls, report);
        if (size) { decls.push(size); report.mapped.push({ cls, css: size }); continue; }

        report.unmapped.push({ cls, reason: 'no mapping in catalog/slds.xml' });
    }

    return {
        css: decls.join(';'),
        declarations: decls,
        preset: p.name,
        lossy: p.lossy,
        ...report
    };
}

/**
 * Deterministic, READABLE CSS Module class name for a set of SLDS classes.
 *
 * Not a hash. A reviewer opening Foo.module.css has to be able to see which
 * SLDS classes a rule came from, otherwise the mapping is only inspectable in
 * the report and not at the point of use.
 *
 *   "slds-grid slds-wrap"          -> "gridWrap"
 *   "slds-var-m-around_medium"     -> "varMAroundMedium"
 *
 * Identical class SETS collapse to the same name, which dedupes rules for
 * free — the common case in a template that repeats a layout.
 */
export function classNameFor(classAttr) {
    const parts = String(classAttr || '').split(/\s+/)
        .filter((c) => c.startsWith('slds-'))
        .map((c) => c.replace(/^slds-/, ''));
    if (!parts.length) return null;
    const name = parts
        .map((p) => p.split(/[-_]/).filter(Boolean)
            .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
            .join(''))
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join('');
    // A CSS identifier cannot start with a digit.
    return /^\d/.test(name) ? `s${name}` : name;
}

/**
 * Collects converted rules for one component and emits its CSS Module.
 * Rules are keyed by class name, so a repeated class attribute yields one rule.
 */
export function createStyleSheet({ preset } = {}) {
    const rules = new Map();
    const reports = [];

    return {
        /**
         * Convert a class attribute. Returns the module class name (or null if
         * nothing SLDS was present) plus any non-SLDS classes to keep verbatim.
         */
        add(classAttr) {
            const result = convertClasses(classAttr, preset ? { preset } : {});
            reports.push(result);
            const name = classNameFor(classAttr);
            if (name && result.declarations.length && !rules.has(name)) {
                rules.set(name, { css: result.declarations, from: classAttr });
            }
            return {
                moduleClass: name && result.declarations.length ? name : null,
                passthrough: result.passthrough,
                result
            };
        },
        get isEmpty() { return rules.size === 0; },
        reports,
        /** The .module.css text. Each rule cites the SLDS it came from. */
        toCss() {
            if (!rules.size) return '';
            const out = ['/* GENERATED from SLDS classes by codemod/styles.js.',
                ' * Do not edit — change catalog/slds.xml and regenerate.',
                ' */', ''];
            for (const [name, rule] of rules) {
                out.push(`/* ${rule.from} */`);
                out.push(`.${name} {`);
                for (const decl of rule.css.join(';').split(';').filter(Boolean)) {
                    const i = decl.indexOf(':');
                    out.push(`  ${decl.slice(0, i)}: ${decl.slice(i + 1)};`);
                }
                out.push('}', '');
            }
            return out.join('\n');
        }
    };
}

/** Human-readable "SLDS X became CSS Y" table — the artifact teams review. */
export function formatMappingReport(results) {
    const lines = [];
    const seen = new Map();
    const unmapped = new Map();
    const warnings = new Map();

    for (const r of results) {
        for (const m of r.mapped) if (!seen.has(m.cls)) seen.set(m.cls, m.css);
        for (const u of r.unmapped) unmapped.set(u.cls, u.reason);
        for (const w of r.warnings) warnings.set(w.cls, w.detail);
    }

    lines.push('| SLDS class | becomes |');
    lines.push('|---|---|');
    for (const [cls, css] of [...seen].sort()) {
        lines.push(`| \`${cls}\` | \`${css}\` |`);
    }

    if (warnings.size) {
        lines.push('', '## Lossy conversions', '');
        for (const [cls, detail] of [...warnings].sort()) lines.push(`- **${cls}** — ${detail}`);
    }
    if (unmapped.size) {
        lines.push('', '## Unmapped — add these to `catalog/slds.xml`', '');
        for (const [cls, reason] of [...unmapped].sort()) lines.push(`- \`${cls}\` — ${reason}`);
    }
    return lines.join('\n');
}

export { SLDS };
