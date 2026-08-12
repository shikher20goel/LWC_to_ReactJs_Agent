/**
 * GENERATED from force-app/.../lwc/eventWithData by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 2 item(s) need review; see the TODO block below.
 */
import React from 'react';
import { useApex } from '@migration/salesforce-runtime';
import { Boundary, Card, FormattedEmail, FormattedPhone, Layout, LayoutItem } from '@migration/salesforce-runtime/components';
import { ContactListItem } from './ContactListItem.jsx';
import { ViewSource } from './ViewSource.jsx';
import getContactList from '@salesforce/apex/ContactController.getContactList';

/* REVIEW REQUIRED:
 *  [template-event-casing] Custom event "select" — LWC lowercases event names, so the original camelCase cannot be recovered. Emitted "onSelect"; verify.
 *  [missing-dependency] <ErrorPanel> is used but was not part of this conversion set. Convert it too, or the generated file will not resolve.
 */

export function EventWithData({  }) {
  const [selectedContact, setSelectedContact] = React.useState(undefined);
  const contacts = useApex(getContactList, {});
  const handleSelect = (event) => {
        const contactId = event.detail;
        setSelectedContact(contacts.data.find( (contact) => contact.Id === contactId ));
    };

  return (
    <Boundary name="EventWithData" props={{}}>
      <Card title="EventWithData" iconName="standard:logging">
        {contacts.data ? (
          <>
            <Layout className="slds-var-m-around_medium">
              <LayoutItem>
                {contacts.data.map((contact) => (
                    <fieldset className="slds-var-p-horizontal_x-small" key={contact.Id}>
                      <legend>
                        c-contact-list-item
                      </legend>
                      <ContactListItem className="slds-show slds-is-relative" contact={contact} onSelect={handleSelect} />
                    </fieldset>
                ))}
              </LayoutItem>
              <LayoutItem className="slds-var-m-left_medium">
                {selectedContact ? (
                  <>
                    <img src={selectedContact.Picture__c} alt="Profile photo" />
                    <p>
                      {selectedContact.Name}
                    </p>
                    <p>
                      {selectedContact.Title}
                    </p>
                    <p>
                      <FormattedPhone value={selectedContact.Phone} />
                    </p>
                    <p>
                      <FormattedEmail value={selectedContact.Email} />
                    </p>
                  </>
                ) : null}
              </LayoutItem>
            </Layout>
          </>
        ) : contacts.error ? (
          <>
            <ErrorPanel errors={contacts.error} />
          </>
        ) : null}
        <ViewSource source="lwc/eventWithData">
          Child-to-parent communication using a custom event that passes data to the parent component. Click an item in the list to see the recipe in action.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
