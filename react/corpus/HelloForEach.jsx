/**
 * GENERATED from force-app/.../lwc/helloForEach by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Card } from '@migration/salesforce-runtime/components';
import { ViewSource } from './ViewSource.jsx';

export function HelloForEach({  }) {
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
    <Boundary name="HelloForEach" props={{}}>
      <Card title="HelloForEach" iconName="custom:custom14">
        <ul className="slds-var-m-around_medium">
          {contacts.map((contact) => (
              <li key={contact.Id}>
                {contact.Name}
                ,
                {contact.Title}
              </li>
          ))}
        </ul>
        <ViewSource source="lwc/helloForEach">
          Loop through an array of items in a template.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
