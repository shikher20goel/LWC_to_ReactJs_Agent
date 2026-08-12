/**
 * GENERATED from force-app/.../lwc/wireGetRecordStaticContact by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 1 item(s) need review; see the TODO block below.
 */
import React from 'react';
import styles from './WireGetRecordStaticContact.module.css';
import { useRecord } from '@migration/salesforce-runtime';
import { Boundary, Card, FormattedEmail, FormattedPhone } from '@migration/salesforce-runtime/components';
import { getFieldValue } from '@migration/salesforce-runtime';
import NAME_FIELD from '@salesforce/schema/Contact.Name';
import TITLE_FIELD from '@salesforce/schema/Contact.Title';
import PHONE_FIELD from '@salesforce/schema/Contact.Phone';
import EMAIL_FIELD from '@salesforce/schema/Contact.Email';
import { ViewSource } from './ViewSource.jsx';

/* REVIEW REQUIRED:
 *  [missing-dependency] <ErrorPanel> is used but was not part of this conversion set. Convert it too, or the generated file will not resolve.
 */

const fields = [NAME_FIELD, TITLE_FIELD, PHONE_FIELD, EMAIL_FIELD];

export function WireGetRecordStaticContact({ recordId }) {
  const contact = useRecord({ recordId: recordId, fields: fields });
  const name = getFieldValue(contact.data, NAME_FIELD);
  const title = getFieldValue(contact.data, TITLE_FIELD);
  const phone = getFieldValue(contact.data, PHONE_FIELD);
  const email = getFieldValue(contact.data, EMAIL_FIELD);

  return (
    <Boundary name="WireGetRecordStaticContact" props={{ recordId }}>
      <Card title="WireGetRecordStaticContact" iconName="standard:contact">
        {contact.data ? (
          <>
            <div className={styles.varMAroundMedium}>
              <p>
                {name}
              </p>
              <p>
                {title}
              </p>
              <p>
                <FormattedPhone value={phone} />
              </p>
              <p>
                <FormattedEmail value={email} />
              </p>
            </div>
          </>
        ) : contact.error ? (
          <>
            <ErrorPanel errors={contact.error} />
          </>
        ) : null}
        <ViewSource source="lwc/wireGetRecordStaticContact">
          Create an ad-hoc UI for a specific record. This recipe uses a static schema definition (fields are explicitly imported).
        </ViewSource>
      </Card>
    </Boundary>
  );
}
