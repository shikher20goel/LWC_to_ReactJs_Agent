/**
 * GENERATED from force-app/.../lwc/helloIterator by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 1 item(s) need review; see the TODO block below.
 */
import React from 'react';
import { Boundary, Card } from '@migration/salesforce-runtime/components';
import { ViewSource } from './ViewSource.jsx';

/* REVIEW REQUIRED:
 *  [template-iterator] iterator:it exposes .value/.index/.first/.last — emitted a shim object; verify.
 */

export function HelloIterator({  }) {
  const [contacts, setContacts] = React.useState([
        {
            Id: '003171931112854375',
            Name: 'Amy Taylor',
            Title: 'VP of Engineering'
        },
        {
            Id: '003192301009134555',
            Name: 'Michael Jones',
            Title: 'VP of Sales'
        },
        {
            Id: '003848991274589432',
            Name: 'Jennifer Wu',
            Title: 'CEO'
        }
    ]);

  return (
    <Boundary name="HelloIterator" props={{}}>
      <Card title="HelloIterator" iconName="custom:custom14">
        <ul className="slds-var-m-around_medium">
          {contacts.map((__v, __i, __a) => { const it = { value: __v, index: __i, first: __i === 0, last: __i === __a.length - 1 }; return (
              <li key={it.value.Id}>
                {it.first ? (
                  <>
                    <div className="list-first" />
                  </>
                ) : null}
                {it.value.Name}
                ,
                {it.value.Title}
                {it.last ? (
                  <>
                    <div className="list-last" />
                  </>
                ) : null}
              </li>
          ); })}
        </ul>
        <ViewSource source="lwc/helloIterator">
          Loop through an array with special behavior for the first and last items.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
