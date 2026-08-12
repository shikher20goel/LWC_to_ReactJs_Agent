import React from 'react';
import { createRoot } from 'react-dom/client';
import '../shim/runtime.css';
import {
    SalesforceRuntimeProvider, createSalesforceQueryClient
} from '../shim/runtime.js';

import { ApiProperty } from '../react/corpus/apiProperty/ApiProperty.jsx';
import { ChartBar } from '../react/corpus/chartBar/ChartBar.jsx';
import { CompositionBasics } from '../react/corpus/compositionBasics/CompositionBasics.jsx';
import { ContactList } from '../react/corpus/contactList/ContactList.jsx';
import { ContactListItem } from '../react/corpus/contactListItem/ContactListItem.jsx';
import { ContactTile } from '../react/corpus/contactTile/ContactTile.jsx';
import { EventWithData } from '../react/corpus/eventWithData/EventWithData.jsx';
import { Hello } from '../react/corpus/hello/Hello.jsx';
import { HelloConditionalRendering } from '../react/corpus/helloConditionalRendering/HelloConditionalRendering.jsx';
import { HelloForEach } from '../react/corpus/helloForEach/HelloForEach.jsx';
import { HelloIterator } from '../react/corpus/helloIterator/HelloIterator.jsx';
import { ViewSource } from '../react/corpus/viewSource/ViewSource.jsx';
import { WireGetRecordStaticContact } from '../react/corpus/wireGetRecordStaticContact/WireGetRecordStaticContact.jsx';

const REPO = 'https://github.com/trailheadapps/lwc-recipes/tree/main/force-app/main/default/lwc';

/* ---- SAMPLE data. Synthetic by construction (CLAUDE.md rule 7). ---- */
const CONTACTS = [
    { Id: '003x1', Name: 'Amy Taylor', Title: 'VP of Engineering', Phone: '4152568563', Email: 'amy@demo.invalid' },
    { Id: '003x2', Name: 'Michael Jones', Title: 'VP of Sales', Phone: '4158526633', Email: 'michael@demo.invalid' },
    { Id: '003x3', Name: 'Jennifer Wu', Title: 'CEO', Phone: '4158521463', Email: 'jennifer@demo.invalid' }
];

const CONTACT_RECORD = {
    id: '003x1', apiName: 'Contact',
    fields: {
        Name: { value: 'Amy Taylor', displayValue: null },
        Title: { value: 'VP of Engineering', displayValue: null },
        Phone: { value: '4152568563', displayValue: null },
        Email: { value: 'amy@demo.invalid', displayValue: null }
    }
};

const transport = {
    callApex: () => Promise.resolve(CONTACTS),
    getRecord: () => Promise.resolve(CONTACT_RECORD),
    getObjectInfo: () => Promise.resolve({ apiName: 'Contact', fields: {} }),
    getPicklistValues: () => Promise.resolve({ values: [] })
};

/** A generated component must never take the whole page down. */
class Boundary extends React.Component {
    constructor(p) { super(p); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    render() {
        if (this.state.err) {
            return <div className="err">Render failed: {String(this.state.err.message || this.state.err)}</div>;
        }
        return this.props.children;
    }
}

const ITEMS = [
    { name: 'Hello', tier: 'M', src: 'hello', el: <Hello />, note: 'Baseline: static template + property binding.' },
    { name: 'HelloConditionalRendering', tier: 'M', src: 'helloConditionalRendering', el: <HelloConditionalRendering />, note: 'lwc:if / lwc:else — the .else chain trap.' },
    { name: 'HelloForEach', tier: 'M', src: 'helloForEach', el: <HelloForEach />, note: 'for:each iteration.' },
    { name: 'HelloIterator', tier: 'M', src: 'helloIterator', el: <HelloIterator />, note: 'iterator:* → ForOf, with .first/.last shim. FLAGGED for review.' },
    { name: 'ApiProperty', tier: 'M', src: 'apiProperty', el: <ApiProperty />, note: '@api property + lightning-input.' },
    { name: 'ChartBar', tier: 'M', src: 'chartBar', el: <ChartBar percentage={62} />, note: '@api prop driving inline style.' },
    { name: 'ContactTile', tier: 'M', src: 'contactTile', el: <ContactTile contact={CONTACTS[0]} />, note: 'lightning-layout / icon / formatted-phone.' },
    { name: 'ContactListItem', tier: 'M', src: 'contactListItem', el: <ContactListItem contact={CONTACTS[1]} onSelect={() => {}} />, note: 'CustomEvent → callback prop.' },
    { name: 'ContactList', tier: 'M', src: 'contactList', el: <ContactList />, note: '@wire Apex → useApex, with enabled guard.' },
    { name: 'CompositionBasics', tier: 'M', src: 'compositionBasics', el: <CompositionBasics />, note: 'Parent composing a child c-* component.' },
    { name: 'EventWithData', tier: 'M', src: 'eventWithData', el: <EventWithData />, note: 'Parent/child event with detail payload.' },
    { name: 'WireGetRecordStaticContact', tier: 'M', src: 'wireGetRecordStaticContact', el: <WireGetRecordStaticContact recordId="003x1" />, note: 'LDS @wire getRecord → useRecord.' },
    { name: 'ViewSource', tier: 'M', src: 'viewSource', el: <ViewSource source="lwc/hello" />, note: 'Slot + @api.' }
];

function App() {
    return (
        <>
            <h1>Generated React — LWC → React migration</h1>
            <p className="sub">
                Every component below was produced by <code>codemod/component.js</code> from
                real LWC source in <a href="https://github.com/trailheadapps/lwc-recipes">trailheadapps/lwc-recipes</a> (CC0-1.0).
                No hand editing.
            </p>

            <div className="warn">
                <b>What this page does and does not prove</b>
                This shows the generated React <i>runs</i>. It does <b>not</b> prove visual fidelity.
                The base components in <code>shim/components.js</code> are plausible SLDS-classed
                stand-ins, not reimplementations of Salesforce's — so this will not look
                pixel-identical to Lightning, and pixel-parity was deliberately removed from the
                plan (research/01, change C-2). What the oracle proves is
                <b> component-boundary, prop and text equivalence</b> against the original LWC.
                Data is synthetic sample data, not from any org.
            </div>

            {ITEMS.map((it) => (
                <div className="card" key={it.name}>
                    <div className="head">
                        <h2>{it.name}</h2>
                        <span className={`tag ${it.tier}`}>Tier {it.tier}</span>
                        <span className="src">
                            <a href={`${REPO}/${it.src}`} target="_blank" rel="noreferrer">source ↗</a>
                        </span>
                    </div>
                    <div className="body"><Boundary>{it.el}</Boundary></div>
                    <div className="todo">{it.note}</div>
                </div>
            ))}

            <div className="card">
                <div className="head">
                    <h2>RecordEditFormStaticContact</h2>
                    <span className="tag H">Tier H — refused</span>
                    <span className="src">
                        <a href={`${REPO}/recordEditFormStaticContact`} target="_blank" rel="noreferrer">source ↗</a>
                    </span>
                </div>
                <div className="body">
                    <p style={{ margin: 0, fontSize: 14 }}>
                        Not rendered on purpose. <code>lightning-record-edit-form</code> is
                        metadata-driven (layout, FLS, validation rules, DML). The codemod emitted a
                        stub and escalated instead of guessing — replacing it is a product build,
                        not a translation.
                    </p>
                </div>
                <div className="todo">[tier-h] lightning-record-edit-form</div>
            </div>
        </>
    );
}

createRoot(document.getElementById('root')).render(
    <SalesforceRuntimeProvider transport={transport} client={createSalesforceQueryClient({})}>
        <App />
    </SalesforceRuntimeProvider>
);
