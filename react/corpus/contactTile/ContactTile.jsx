/**
 * GENERATED from force-app/.../lwc/contactTile by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, FormattedPhone, Icon, Layout, LayoutItem } from '@migration/salesforce-runtime/components';

export function ContactTile({ contact }) {


  return (
    <Boundary name="ContactTile" props={{ contact }}>
      {contact ? (
        <>
          <Layout verticalAlign="center">
            <LayoutItem>
              {contact.Picture__c ? (
                <>
                  <img src={contact.Picture__c} alt="Profile photo" />
                </>
              ) : (
                <>
                  <Icon iconName="standard:avatar" alternativeText="Missing profile photo" size="medium" title="Missing profile photo" />
                </>
              )}
            </LayoutItem>
            <LayoutItem padding="around-small">
              <p>
                {contact.Name}
              </p>
              <p>
                {contact.Title}
              </p>
              <p>
                <FormattedPhone value={contact.Phone} />
              </p>
            </LayoutItem>
          </Layout>
        </>
      ) : (
        <>
          <p>
            No contact data available.
          </p>
        </>
      )}
    </Boundary>
  );
}
