import React from 'react';
import { boundary, slot } from './boundary.js';

export { Boundary, cssToStyle } from './boundary.js';

/**
 * React equivalents of the catalog base components.
 *
 * Deliberately NOT pixel-faithful to SLDS — the markup below is a plausible
 * stand-in. The oracle never diffs a base component's internals (they are
 * opaque on both sides), so what matters here is only:
 *   1. the canonical name matches catalog/base-components.xml
 *   2. the prop names match the catalog's <props> list exactly
 *   3. children go through slot()
 * Get (2) wrong and the diff reports a false mismatch on every render.
 */

const h = React.createElement;

export function Card({ title, iconName, variant, children }) {
    return boundary('Card', { title, iconName, variant },
        h('article', { className: 'slds-card' },
            h('div', { className: 'slds-card__header' },
                iconName ? h('span', { className: 'slds-icon', 'data-icon': iconName }) : null,
                h('h2', { className: 'slds-card__header-title' }, title)
            ),
            h('div', { className: 'slds-card__body' }, slot(children))
        ),
        { base: true });
}

export function Button({ label, variant, iconName, disabled, type, onClick, dataId }) {
    return boundary('Button', { label, variant, iconName, disabled, type },
        h('button', {
            className: `slds-button slds-button_${variant || 'neutral'}`,
            type: type || 'button',
            disabled: disabled || undefined,
            'data-id': dataId,
            onClick
        }, label),
        { base: true });
}

export function FormattedText({ value }) {
    return boundary('FormattedText', { value },
        h('span', { className: 'slds-form-element__static' }, value),
        { base: true, as: 'span' });
}

export function Layout({ horizontalAlign, verticalAlign, pullToBoundary, multipleRows,
    className, children }) {
    return boundary('Layout',
        { horizontalAlign, verticalAlign, pullToBoundary, multipleRows },
        h('div', {
            className: ['slds-grid', multipleRows && 'slds-wrap',
                horizontalAlign && `slds-grid_align-${horizontalAlign}`,
                verticalAlign && `slds-grid_vertical-align-${verticalAlign}`,
                className].filter(Boolean).join(' ')
        }, slot(children)),
        { base: true });
}

export function LayoutItem({ size, padding, flexibility, alignmentBump,
    smallDeviceSize, mediumDeviceSize, largeDeviceSize, className, children }) {
    return boundary('LayoutItem',
        { size, padding, flexibility, alignmentBump,
            smallDeviceSize, mediumDeviceSize, largeDeviceSize },
        h('div', {
            className: ['slds-col',
                size && `slds-size_${size}-of-12`,
                padding && `slds-p-around_${String(padding).replace('horizontal-', '')}`,
                className].filter(Boolean).join(' ')
        }, slot(children)),
        { base: true });
}

export function FormattedPhone({ value }) {
    return boundary('FormattedPhone', { value },
        h('a', { href: value ? `tel:${value}` : undefined }, value),
        { base: true, as: 'span' });
}

export function FormattedEmail({ value, label, hideIcon }) {
    return boundary('FormattedEmail', { value, label, hideIcon },
        h('a', { href: value ? `mailto:${value}` : undefined }, label || value),
        { base: true, as: 'span' });
}

export function Icon({ iconName, size, alternativeText, variant, title }) {
    return boundary('Icon', { iconName, size, alternativeText, variant, title },
        h('span', {
            className: `slds-icon_container slds-icon-${String(iconName || '').replace(':', '-')}`,
            title: title || alternativeText
        }, h('span', { className: 'slds-assistive-text' }, alternativeText || iconName)),
        { base: true, as: 'span' });
}

export function Input({ label, value, type, name, placeholder, required, disabled,
    readOnly, checked, min, max, step, pattern, variant, messageWhenValueMissing,
    onChange, onBlur }) {
    return boundary('Input',
        { label, value, type, name, placeholder, required, disabled, readOnly,
            checked, min, max, step, pattern, variant, messageWhenValueMissing },
        h('div', { className: 'slds-form-element' },
            h('label', { className: 'slds-form-element__label' }, label),
            h('div', { className: 'slds-form-element__control' },
                h('input', {
                    className: 'slds-input',
                    type: type || 'text',
                    name,
                    value: value === undefined ? undefined : value,
                    defaultValue: value === undefined ? '' : undefined,
                    placeholder, required, disabled, readOnly, checked,
                    min, max, step, pattern,
                    onChange, onBlur
                }))),
        { base: true });
}

export function ButtonIcon({ iconName, variant, size, alternativeText, title, disabled, name, onClick }) {
    return boundary('ButtonIcon', { iconName, variant, size, alternativeText, title, disabled, name },
        h('button', {
            className: 'slds-button slds-button_icon', title: title || alternativeText,
            disabled: disabled || undefined, onClick
        }, h('span', { className: 'slds-assistive-text' }, alternativeText || iconName || 'button')),
        { base: true, as: 'span' });
}

export function Combobox({ label, value, options, placeholder, required, disabled, name, variant, onChange }) {
    return boundary('Combobox',
        { label, value, options, placeholder, required, disabled, name, variant },
        h('div', { className: 'slds-form-element' },
            h('label', { className: 'slds-form-element__label' }, label),
            h('select', {
                className: 'slds-input', value, name, required, disabled, onChange
            }, (options || []).map((o, i) =>
                h('option', { key: o.value ?? i, value: o.value }, o.label ?? String(o.value))))),
        { base: true });
}

export function RadioGroup({ label, options, value, type, required, disabled, name, onChange }) {
    return boundary('RadioGroup', { label, options, value, type, required, disabled, name },
        h('fieldset', { className: 'slds-form-element' },
            h('legend', { className: 'slds-form-element__label' }, label),
            (options || []).map((o, i) => h('label', {
                key: o.value ?? i, style: { display: 'block', fontSize: '0.8125rem' }
            }, h('input', {
                type: type === 'button' ? 'radio' : 'radio', name, value: o.value,
                checked: value === o.value, disabled, onChange
            }), ' ', o.label ?? String(o.value)))),
        { base: true });
}

export function FormattedNumber({ value, formatStyle, currencyCode, minimumFractionDigits }) {
    const formatted = value === undefined || value === null
        ? ''
        : new Intl.NumberFormat('en-US', {
            style: formatStyle || 'decimal',
            currency: currencyCode,
            minimumFractionDigits
        }).format(value);
    return boundary('FormattedNumber',
        { value, formatStyle, currencyCode, minimumFractionDigits },
        h('span', { className: 'slds-form-element__static' }, formatted),
        { base: true, as: 'span' });
}

/* -------------------------------------------------------------------------
 * Added after the first real-org run.
 *
 * Each of these existed in a retrieved org while being absent from the
 * catalog, so the codemod emitted the canonical name and the browser said
 * "X is not defined". The lesson is recorded in agent/knowledge.js as the
 * `uncatalogued-base-renders-undefined` signature: a catalog entry WITHOUT a
 * matching shim export is the same outage as no catalog entry at all, and
 * only the preview catches it — the codemod tests pass either way.
 * ---------------------------------------------------------------------- */

// Open state lives on the accordion, exactly as it does in LWC. Sections read
// it through context so a section can be rendered anywhere in the subtree.
const AccordionCtx = React.createContext(null);

export function Accordion({ activeSectionName, allowMultipleSectionsOpen, children }) {
    // LWC types this as string | string[] depending on the multiple flag.
    // Normalising to an array here, not at each use, keeps the section simple.
    const initial = activeSectionName == null
        ? []
        : (Array.isArray(activeSectionName) ? activeSectionName : [activeSectionName]);
    const [open, setOpen] = React.useState(initial);

    // The owner may change active-section-name at any time; LWC honours it.
    const key = JSON.stringify(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => { setOpen(JSON.parse(key)); }, [key]);

    const toggle = React.useCallback((name) => {
        setOpen((cur) => {
            if (cur.includes(name)) return cur.filter((n) => n !== name);
            return allowMultipleSectionsOpen ? [...cur, name] : [name];
        });
    }, [allowMultipleSectionsOpen]);

    return boundary('Accordion', { activeSectionName, allowMultipleSectionsOpen },
        h(AccordionCtx.Provider, { value: { open, toggle } },
            h('div', { className: 'slds-accordion' }, slot(children))),
        { base: true });
}

export function AccordionSection({ name, label, actions, children }) {
    const ctx = React.useContext(AccordionCtx);
    // Rendered outside an Accordion there is no owner to ask. Expanded is the
    // honest default — collapsed would hide content with no way to open it.
    const isOpen = ctx ? ctx.open.includes(name) : true;
    return boundary('AccordionSection', { name, label },
        h('li', { className: 'slds-accordion__list-item' + (isOpen ? ' slds-is-open' : '') },
            h('div', { className: 'slds-accordion__section' },
                h('div', { className: 'slds-accordion__summary' },
                    h('button', {
                        type: 'button',
                        className: 'slds-button slds-button_reset slds-accordion__summary-action',
                        'aria-expanded': isOpen,
                        onClick: () => ctx && ctx.toggle(name)
                    }, h('span', { className: 'slds-accordion__summary-content' }, label)),
                    actions ? h('div', { className: 'slds-no-flex' }, actions) : null
                ),
                isOpen ? h('div', { className: 'slds-accordion__content' }, slot(children)) : null
            )),
        { base: true, as: 'ul' });
}

export function Avatar({ src, fallbackIconName, initials, alternativeText, size, variant }) {
    return boundary('Avatar', { src, fallbackIconName, initials, alternativeText, size, variant },
        h('span', {
            className: ['slds-avatar', size && `slds-avatar_${size}`,
                variant === 'circle' && 'slds-avatar_circle'].filter(Boolean).join(' ')
        }, src
            ? h('img', { src, alt: alternativeText || '' })
            : h('abbr', { className: 'slds-avatar__initials', title: alternativeText },
                initials || '')),
        { base: true, as: 'span' });
}

export function Badge({ label, iconName, iconPosition, variant }) {
    return boundary('Badge', { label, iconName, iconPosition, variant },
        h('span', {
            className: ['slds-badge', variant && variant !== 'default'
                && `slds-badge_${variant}`].filter(Boolean).join(' ')
        }, label),
        { base: true, as: 'span' });
}

export function ButtonGroup({ children }) {
    return boundary('ButtonGroup', {},
        h('div', { className: 'slds-button-group', role: 'group' }, slot(children)),
        { base: true, as: 'span' });
}

export function ButtonStateful({ state, labelWhenOff, labelWhenOn, labelWhenHover,
    iconNameWhenOff, iconNameWhenOn, variant, disabled, onClick }) {
    // No internal state on purpose: in LWC the owner owns `state`. A shim that
    // toggled itself would drift from the original on the very first click.
    const label = state ? (labelWhenOn != null ? labelWhenOn : labelWhenOff) : labelWhenOff;
    return boundary('ButtonStateful',
        { state, labelWhenOff, labelWhenOn, labelWhenHover, iconNameWhenOff, iconNameWhenOn, variant },
        h('button', {
            type: 'button',
            className: `slds-button slds-button_${variant || 'neutral'}${state ? ' slds-is-selected' : ''}`,
            disabled: disabled || undefined,
            'aria-pressed': Boolean(state),
            onClick
        }, label),
        { base: true, as: 'span' });
}

export function CheckboxGroup({ label, options, value, name, required, disabled, onChange }) {
    const selected = Array.isArray(value) ? value : [];
    const fire = (optValue, checked) => {
        if (!onChange) return;
        const next = checked
            ? [...selected, optValue]
            : selected.filter((v) => v !== optValue);
        // LWC hands the owner the whole new array, not the toggled item.
        onChange({ detail: { value: next }, target: { name, value: next } });
    };
    return boundary('CheckboxGroup', { label, options, value, name, required, disabled },
        h('fieldset', { className: 'slds-form-element' },
            h('legend', { className: 'slds-form-element__legend slds-form-element__label' }, label),
            h('div', { className: 'slds-form-element__control' },
                (options || []).map((o) => h('span', {
                    key: String(o.value), className: 'slds-checkbox'
                },
                h('input', {
                    type: 'checkbox', name, value: o.value, disabled: disabled || undefined,
                    checked: selected.includes(o.value),
                    onChange: (e) => fire(o.value, e.target.checked)
                }),
                h('label', { className: 'slds-checkbox__label' },
                    h('span', { className: 'slds-form-element__label' }, o.label))))
            )),
        { base: true });
}

export function Pill({ label, name, href, hasError, onRemove, onClick }) {
    return boundary('Pill', { label, name, href, hasError },
        h('span', { className: 'slds-pill' + (hasError ? ' slds-has-error' : '') },
            h('span', { className: 'slds-pill__label', onClick }, href
                ? h('a', { href }, label) : label),
            onRemove ? h('button', {
                type: 'button', className: 'slds-button slds-button_icon slds-pill__remove',
                onClick: () => onRemove({ detail: { name } })
            }, '×') : null),
        { base: true, as: 'span' });
}

export function DynamicIcon({ type, option, alternativeText }) {
    // The real component ANIMATES. A static mark is a deliberate downgrade —
    // catalogued at fidelity 0.5 so nobody reads this as equivalent.
    return boundary('DynamicIcon', { type, option, alternativeText },
        h('span', {
            className: `slds-icon-typing slds-dynamic-icon-${type || 'ea'}`,
            title: alternativeText
        },
        h('span', { className: 'slds-assistive-text' }, alternativeText || type || '')),
        { base: true, as: 'span' });
}

/* Found by catalog/contract.test.js on the run that introduced it — four
 * components had been catalogued (so the codemod happily emitted them) with no
 * shim behind the name. lightning-spinner is the loud one: it appears in most
 * loading states, so every component using it rendered as a blank error. */

export function Spinner({ size, variant, alternativeText }) {
    return boundary('Spinner', { size, variant, alternativeText },
        h('div', {
            className: ['slds-spinner', size && `slds-spinner_${size}`,
                variant && `slds-spinner_${variant}`].filter(Boolean).join(' '),
            role: 'status'
        }, h('span', { className: 'slds-assistive-text' },
            alternativeText || 'Loading')),
        { base: true });
}

export function FormattedDateTime({ value, year, month, day, hour, minute, second,
    timeZone, weekday }) {
    // Intl is the right engine, but LWC defaults to the org locale and this
    // runs in the browser's. Dates can therefore differ by locale between the
    // two sides — the oracle compares the PROPS, which are locale-free.
    let text = '';
    if (value !== undefined && value !== null && value !== '') {
        const d = value instanceof Date ? value : new Date(value);
        if (!Number.isNaN(d.getTime())) {
            const opts = { year, month, day, hour, minute, second, timeZone, weekday };
            for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
            try {
                text = Object.keys(opts).length
                    ? new Intl.DateTimeFormat(undefined, opts).format(d)
                    : d.toLocaleString();
            } catch {
                // An invalid timeZone throws rather than falling back. Showing
                // the raw value beats showing nothing.
                text = d.toLocaleString();
            }
        }
    }
    return boundary('FormattedDateTime',
        { value, year, month, day, hour, minute, second, timeZone, weekday },
        h('span', { className: 'slds-form-element__static' }, text),
        { base: true, as: 'span' });
}

export function Tree({ items, header, selectedItem }) {
    // Renders fully expanded. The real component tracks per-branch expansion
    // and fires onselect; anything relying on collapse behaviour should be
    // reviewed rather than assumed working.
    const branch = (nodes, depth) => (nodes || []).map((n, i) => h('li', {
        key: n.name != null ? String(n.name) : `${depth}-${i}`,
        role: 'treeitem',
        'aria-level': depth,
        'aria-selected': selectedItem != null && n.name === selectedItem
    },
    h('span', { className: 'slds-tree__item-label' }, n.label),
    n.items && n.items.length
        ? h('ul', { role: 'group' }, branch(n.items, depth + 1))
        : null));

    return boundary('Tree', { items, header, selectedItem },
        h('div', { className: 'slds-tree_container' },
            header ? h('h4', { className: 'slds-tree__group-header' }, header) : null,
            h('ul', { className: 'slds-tree', role: 'tree' }, branch(items, 1))),
        { base: true });
}

export function PillContainer({ items, label, isCollapsible, isExpanded }) {
    return boundary('PillContainer', { items, label, isCollapsible, isExpanded },
        h('div', { className: 'slds-pill_container' },
            label ? h('span', { className: 'slds-form-element__label' }, label) : null,
            h('ul', {
                className: 'slds-listbox slds-listbox_horizontal',
                role: 'listbox'
            }, (items || []).map((it, i) => h('li', {
                key: it.name != null ? String(it.name) : String(i),
                role: 'option',
                className: 'slds-listbox-item'
            }, h('span', { className: 'slds-pill' },
                h('span', { className: 'slds-pill__label' }, it.label)))))),
        { base: true });
}
