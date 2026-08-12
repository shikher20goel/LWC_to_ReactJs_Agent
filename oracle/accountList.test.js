/**
 * ACCOUNT LIST — first oracle run against a deployable, org-shaped component.
 *
 * What this covers that propertySummary does NOT:
 *  - ITERATION. for:each over an Apex result. The normaliser had never been
 *    exercised against a repeated boundary; a list is where structural diffing
 *    earns its keep (wrong order, dropped row, duplicated row).
 *  - A THREE-WAY branch (lwc:if / lwc:elseif / lwc:else) rather than if/else.
 *  - An error branch driven by the Apex adapter's error shape.
 */
import { createElement } from 'lwc';
import AccountList from 'c/accountList';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';
import { normalise, render } from './normalise';

const ACCOUNTS = [
    { Id: '001xx000000001', Name: 'Acme Corporation', Industry: 'Manufacturing' },
    { Id: '001xx000000002', Name: 'Global Media', Industry: 'Media' },
    { Id: '001xx000000003', Name: 'Northern Trail Outfitters', Industry: 'Retail' }
];

const flush = () => Promise.resolve();

function mount() {
    const el = createElement('c-account-list', { is: AccountList });
    document.body.appendChild(el);
    return el;
}

async function loaded(data = ACCOUNTS) {
    const el = mount();
    getAccounts.emit(data);
    await flush();
    return el;
}

// Depth-first helpers over the boundary tree.
function collect(tree, pred, out = []) {
    if (!tree) return out;
    if (pred(tree)) out.push(tree);
    for (const c of tree.children || []) collect(c, pred, out);
    return out;
}
function find(tree, pred) {
    return collect(tree, pred)[0];
}

describe('ACCOUNT LIST — real-component validation', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('produces a canonical boundary tree — LOADED state', async () => {
        const el = await loaded();
        console.log('\n' + render(normalise(el)));
    });

    it('renders one row per account, in order, with names as TEXT', async () => {
        const tree = normalise(await loaded());
        const rows = collect(tree, (n) => n.tag === 'li');
        expect(rows).toHaveLength(3);

        // Names must survive as text. If they don't, [object Object] detection
        // is dead for every list component in the org (F4).
        const names = collect(tree, (n) => n.text).map((n) => n.text);
        expect(names).toEqual(
            expect.arrayContaining([
                'Acme Corporation',
                'Global Media',
                'Northern Trail Outfitters'
            ])
        );
        // Order is a real regression signal, not noise (R3.2).
        const rowNames = rows.map((r) => find(r, (n) => n.tag === 'p').text);
        expect(rowNames).toEqual([
            'Acme Corporation',
            'Global Media',
            'Northern Trail Outfitters'
        ]);
    });

    it('carries base-component props per row, and no base-rendered text', async () => {
        const tree = normalise(await loaded());
        const industries = collect(tree, (n) => n.tag === 'FormattedText');
        expect(industries).toHaveLength(3);
        expect(industries.map((n) => n.props.value))
            .toEqual(['Manufacturing', 'Media', 'Retail']);
        // Base components render nothing off-platform — diff props, never text.
        expect(industries.every((n) => n.text === undefined)).toBe(true);

        const buttons = collect(tree, (n) => n.tag === 'Button');
        expect(buttons).toHaveLength(3);
        expect(buttons.every((b) => b.props.label === 'View')).toBe(true);
    });

    it('EMPTY state renders the empty branch and zero rows', async () => {
        const el = await loaded([]);
        const tree = normalise(el);
        console.log('\n' + render(tree));
        expect(find(tree, (n) => n.text === 'No accounts to display')).toBeDefined();
        expect(collect(tree, (n) => n.tag === 'li')).toHaveLength(0);
    });

    it('ERROR state renders the error branch, not the empty one', async () => {
        const el = mount();
        getAccounts.error();
        await flush();
        const tree = normalise(el);
        console.log('\n' + render(tree));
        expect(find(tree, (n) => n.text === 'Unable to load accounts')).toBeDefined();
        expect(find(tree, (n) => n.text === 'No accounts to display')).toBeUndefined();
    });

    it('emits accountselected with the row id when View is clicked', async () => {
        const el = await loaded();
        const handler = jest.fn();
        el.addEventListener('accountselected', handler);

        const buttons = el.shadowRoot.querySelectorAll('lightning-button');
        expect(buttons).toHaveLength(3);
        buttons[1].click();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ accountId: '001xx000000002' });
    });

    it('is byte-stable across identical renders', async () => {
        const snap = async () => {
            const el = await loaded();
            const s = render(normalise(el));
            document.body.removeChild(el);
            return s;
        };
        expect(await snap()).toBe(await snap());
    });
});
