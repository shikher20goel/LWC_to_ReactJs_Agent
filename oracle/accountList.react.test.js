/**
 * THE DIFFERENTIAL ORACLE, END TO END.
 *
 * Renders the ORIGINAL LWC and the CANDIDATE React against identical
 * fixtures, normalises both with the SAME function, and diffs.
 *
 * The negative control at the bottom matters as much as the positive tests:
 * an oracle that has never failed is not known to work.
 */
import { createElement } from 'lwc';
import AccountListLwc from 'c/accountList';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountList, AccountListDroppedField } from '../react/accountList.js';

import { normalise, render, reactAdapter } from './normalise';
import { diffTrees, formatDiff } from './diff';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS = [
    { Id: '001xx000000001', Name: 'Acme Corporation', Industry: 'Manufacturing' },
    { Id: '001xx000000002', Name: 'Global Media', Industry: 'Media' },
    { Id: '001xx000000003', Name: 'Northern Trail Outfitters', Industry: 'Retail' }
];

const flush = () => Promise.resolve();

/* ---------- LWC side ---------- */
async function lwcTree({ accounts = ACCOUNTS, error = false } = {}) {
    const el = createElement('c-account-list', { is: AccountListLwc });
    document.body.appendChild(el);
    if (error) getAccounts.error();
    else getAccounts.emit(accounts);
    await flush();
    return normalise(el);
}

/* ---------- React side ---------- */
const roots = [];
async function reactTree(Component, props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => { root.render(React.createElement(Component, props)); });
    return normalise(container.firstElementChild, reactAdapter);
}

describe('DIFFERENTIAL ORACLE — accountList: LWC vs React', () => {
    afterEach(async () => {
        await act(async () => { roots.forEach((r) => r.unmount()); });
        roots.length = 0;
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('LOADED — React matches the LWC boundary tree exactly', async () => {
        const lwc = await lwcTree();
        const react = await reactTree(AccountList, { accounts: ACCOUNTS });

        console.log('\nLWC:\n' + render(lwc));
        console.log('\nREACT:\n' + render(react));

        const diffs = diffTrees(lwc, react);
        if (diffs.length) console.log('\n' + formatDiff(diffs));
        expect(diffs).toEqual([]);
        expect(render(react)).toBe(render(lwc));
    });

    it('EMPTY — React matches', async () => {
        const lwc = await lwcTree({ accounts: [] });
        const react = await reactTree(AccountList, { accounts: [] });
        expect(formatDiff(diffTrees(lwc, react))).toBe('IDENTICAL — no structural difference.');
    });

    it('ERROR — React matches', async () => {
        const lwc = await lwcTree({ error: true });
        const react = await reactTree(AccountList, { accounts: [], error: true });
        expect(formatDiff(diffTrees(lwc, react))).toBe('IDENTICAL — no structural difference.');
    });

    /* ---------- negative control ---------- */

    it('CATCHES a dropped field — the oracle must be able to fail', async () => {
        const lwc = await lwcTree();
        const react = await reactTree(AccountListDroppedField, { accounts: ACCOUNTS });

        const diffs = diffTrees(lwc, react);
        console.log('\nNEGATIVE CONTROL — dropped Industry field:\n' + formatDiff(diffs));

        expect(diffs.length).toBeGreaterThan(0);
        // Every row lost its FormattedText, so the oracle should say so.
        expect(diffs.some((d) => JSON.stringify(d.lwc).includes('FormattedText'))).toBe(true);
    });
});
