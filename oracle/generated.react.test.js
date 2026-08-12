/**
 * D-5 — THE CLOSED LOOP.
 *
 * Takes the component the codemod GENERATED (no human editing, no LLM), runs
 * it against the same fixtures as the original LWC, and diffs the boundary
 * trees with the same normaliser.
 *
 * This is the difference between "the codemod emits plausible code" and "the
 * codemod emits code that provably behaves like the original on observed
 * paths". Everything upstream — the AST traps, the shim's enabled guards, the
 * two-tier diff alignment — only matters if this passes.
 */
import { createElement } from 'lwc';
import AccountListLwc from 'c/accountList';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AccountList as Generated } from '../react/generated/AccountList.jsx';
import { SalesforceRuntimeProvider, createSalesforceQueryClient } from '../shim/runtime.js';
import { normalise, render, reactAdapter } from './normalise';
import { diffTrees, formatDiff } from './diff';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS = [
    { Id: '001xx000000001', Name: 'Acme Corporation', Industry: 'Manufacturing' },
    { Id: '001xx000000002', Name: 'Global Media', Industry: 'Media' },
    { Id: '001xx000000003', Name: 'Northern Trail Outfitters', Industry: 'Retail' }
];

const flush = () => Promise.resolve();
const settle = async (n = 3) => {
    for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
};

async function lwcTree({ accounts = ACCOUNTS, error = false } = {}) {
    const el = createElement('c-account-list', { is: AccountListLwc });
    document.body.appendChild(el);
    if (error) getAccounts.error();
    else getAccounts.emit(accounts);
    await flush();
    return normalise(el);
}

const roots = [];
async function generatedTree({ accounts = ACCOUNTS, error = false } = {}) {
    const transport = {
        callApex: () => (error
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(accounts)),
        getRecord: () => Promise.resolve(null),
        getObjectInfo: () => Promise.resolve({}),
        getPicklistValues: () => Promise.resolve({})
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const client = createSalesforceQueryClient({});
    await act(async () => {
        root.render(React.createElement(
            SalesforceRuntimeProvider,
            { transport, client },
            React.createElement(Generated, {})
        ));
    });
    await settle();
    return normalise(container.firstElementChild, reactAdapter);
}

describe('CLOSED LOOP — generated React vs original LWC', () => {
    afterEach(async () => {
        await act(async () => { roots.forEach((r) => r.unmount()); });
        roots.length = 0;
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('LOADED — codemod output matches the LWC boundary tree', async () => {
        const lwc = await lwcTree();
        const gen = await generatedTree();

        console.log('\nLWC:\n' + render(lwc));
        console.log('\nGENERATED:\n' + render(gen));

        const diffs = diffTrees(lwc, gen);
        if (diffs.length) console.log('\n' + formatDiff(diffs));
        expect(diffs).toEqual([]);
    });

    it('EMPTY — codemod output matches', async () => {
        const lwc = await lwcTree({ accounts: [] });
        const gen = await generatedTree({ accounts: [] });
        expect(formatDiff(diffTrees(lwc, gen)))
            .toBe('IDENTICAL — no structural difference.');
    });

    it('ERROR — codemod output matches', async () => {
        const lwc = await lwcTree({ error: true });
        const gen = await generatedTree({ error: true });
        expect(formatDiff(diffTrees(lwc, gen)))
            .toBe('IDENTICAL — no structural difference.');
    });
});
