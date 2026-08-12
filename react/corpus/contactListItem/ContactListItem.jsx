/**
 * GENERATED from force-app/.../lwc/contactListItem by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Layout, LayoutItem } from '@migration/salesforce-runtime/components';

export function ContactListItem({ contact, onSelect }) {
  const handleClick = (event) => {
        // 1. Prevent default behavior of anchor tag click which is to navigate to the href url
        event.preventDefault();
        // 2. Read about event best practices at http://developer.salesforce.com/docs/component-library/documentation/lwc/lwc.events_best_practices
        const selectEvent = new CustomEvent('select', {
            detail: contact.Id
        });
        // 3. Fire the custom event
        dispatchEvent(selectEvent);
    };

  return (
    <Boundary name="ContactListItem" props={{ contact }}>
      <a href="#" onClick={handleClick}>
        <Layout verticalAlign="center">
          <LayoutItem>
            <img src={contact.Picture__c} alt="Profile photo" />
          </LayoutItem>
          <LayoutItem padding="around-small">
            <p>
              {contact.Name}
            </p>
          </LayoutItem>
        </Layout>
      </a>
    </Boundary>
  );
}
