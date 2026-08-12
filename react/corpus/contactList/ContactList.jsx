/**
 * GENERATED from force-app/.../lwc/contactList by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { useApex } from '@migration/salesforce-runtime';
import { Boundary, Layout, LayoutItem } from '@migration/salesforce-runtime/components';
import getContactList from '@salesforce/apex/ContactController.getContactList';

export function ContactList({ onContactselect }) {
  const contacts = useApex(getContactList, {});
  const handleSelect = (event) => {
        // 1. Prevent default behavior of anchor tag click which is to navigate to the href url
        event.preventDefault();
        // 2. Create a custom event that bubbles. Read about event best practices at http://developer.salesforce.com/docs/component-library/documentation/lwc/lwc.events_best_practices
        const selectEvent = new CustomEvent('contactselect', {
            detail: { contactId: event.currentTarget.dataset.contactId }
        });
        // 3. Fire the custom event
        dispatchEvent(selectEvent);
    };

  return (
    <Boundary name="ContactList" props={{}}>
      {contacts.data ? (
        <>
          {contacts.data.map((contact) => (
              <a href="#" data-contact-id={contact.Id} onClick={handleSelect} key={contact.Id}>
                <Layout>
                  <LayoutItem>
                    <img src={contact.Picture__c} alt="Profile photo" />
                  </LayoutItem>
                  <LayoutItem padding="horizontal-small">
                    <p>
                      {contact.Name}
                    </p>
                  </LayoutItem>
                </Layout>
              </a>
          ))}
        </>
      ) : null}
    </Boundary>
  );
}
