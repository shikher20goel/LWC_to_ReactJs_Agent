/**
 * GENERATED from force-app/.../lwc/recordEditFormStaticContact by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 1 item(s) need review; see the TODO block below.
 */
import React from 'react';
import styles from './RecordEditFormStaticContact.module.css';
import { Boundary, Card } from '@migration/salesforce-runtime/components';
import ACCOUNT_FIELD from '@salesforce/schema/Contact.AccountId';
import NAME_FIELD from '@salesforce/schema/Contact.Name';
import TITLE_FIELD from '@salesforce/schema/Contact.Title';
import PHONE_FIELD from '@salesforce/schema/Contact.Phone';
import EMAIL_FIELD from '@salesforce/schema/Contact.Email';
import { ViewSource } from '../viewSource/ViewSource.jsx';

/* REVIEW REQUIRED:
 *  [tier-h] lightning-record-edit-form
 */

export function RecordEditFormStaticContact({ recordId, objectApiName }) {
  const [accountField, setAccountField] = React.useState(ACCOUNT_FIELD);
  const [nameField, setNameField] = React.useState(NAME_FIELD);
  const [titleField, setTitleField] = React.useState(TITLE_FIELD);
  const [phoneField, setPhoneField] = React.useState(PHONE_FIELD);
  const [emailField, setEmailField] = React.useState(EMAIL_FIELD);

  return (
    <Boundary name="RecordEditFormStaticContact" props={{ recordId, objectApiName }}>
      <Card title="RecordEditFormStaticContact" iconName="standard:contact">
        <div className={styles.varMAroundMedium}>
          {/* TIER-H: <lightning-record-edit-form> not auto-converted. Metadata-driven layout / FLS. Emit a spec and build by hand. */}
        </div>
        <ViewSource source="lwc/recordEditFormStaticContact">
          Create an edit-mode form for a specific record. This recipe uses a static schema definition (fields are explicitly imported).
        </ViewSource>
      </Card>
    </Boundary>
  );
}
