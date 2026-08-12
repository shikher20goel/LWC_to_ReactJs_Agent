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
