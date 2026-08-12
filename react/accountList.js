import React from 'react';
import { boundary } from '../shim/boundary.js';
import { Card, Button, FormattedText } from '../shim/components.js';

/**
 * Hand-written React equivalent of force-app/.../lwc/accountList.
 * This is the target the migration agent will eventually have to produce
 * on its own. For now it is written by hand so the oracle has two sides
 * to compare.
 *
 * Data is passed in rather than wired: the wire-adapter half of the shim
 * (useQuery + enabled guards) is a separate build step. Keeping it as props
 * means this file tests the RENDER contract only, which is what the
 * boundary-tree diff covers.
 */

const h = React.createElement;

export function AccountList({ accounts = [], error = false, onAccountSelected }) {
    let body;

    // Branch order must mirror the LWC lwc:if / lwc:elseif / lwc:else exactly.
    if (accounts.length > 0) {
        body = h('ul', { className: 'slds-has-dividers_bottom-space' },
            accounts.map((account) =>
                h('li', { key: account.Id, className: 'account-row slds-item' },
                    h('p', { className: 'account-name' }, account.Name),
                    h(FormattedText, { value: account.Industry }),
                    h(Button, {
                        label: 'View',
                        variant: 'neutral',
                        dataId: account.Id,
                        onClick: () => onAccountSelected
                            && onAccountSelected({ accountId: account.Id })
                    })
                )
            )
        );
    } else if (error) {
        body = h('p', { className: 'error-state' }, 'Unable to load accounts');
    } else {
        body = h('p', { className: 'empty-state' }, 'No accounts to display');
    }

    return boundary('AccountList', {},
        h(Card, { title: 'Accounts', iconName: 'standard:account' }, body)
    );
}

/**
 * A DELIBERATELY WRONG conversion, kept as a negative control.
 *
 * The defect: the migration dropped the Industry field. It is the most
 * boring possible mistake and exactly the kind a human reviewer skims past
 * on a 40-component PR. If the oracle cannot fail on this, it is decorative.
 * Used by accountList.react.test.js — do not "fix" it.
 */
export function AccountListDroppedField({ accounts = [], onAccountSelected }) {
    if (accounts.length === 0) {
        return boundary('AccountList', {},
            h(Card, { title: 'Accounts', iconName: 'standard:account' },
                h('p', { className: 'empty-state' }, 'No accounts to display')));
    }
    return boundary('AccountList', {},
        h(Card, { title: 'Accounts', iconName: 'standard:account' },
            h('ul', { className: 'slds-has-dividers_bottom-space' },
                accounts.map((account) =>
                    h('li', { key: account.Id, className: 'account-row slds-item' },
                        h('p', { className: 'account-name' }, account.Name),
                        // <FormattedText value={Industry}/> — MISSING
                        h(Button, {
                            label: 'View',
                            variant: 'neutral',
                            dataId: account.Id,
                            onClick: () => onAccountSelected
                                && onAccountSelected({ accountId: account.Id })
                        })
                    )
                )
            )
        )
    );
}
