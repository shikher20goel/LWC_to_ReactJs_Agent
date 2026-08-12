import React from 'react';
import { boundary, slot } from './boundary.js';

export { Boundary } from './boundary.js';

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
        { base: true });
}
