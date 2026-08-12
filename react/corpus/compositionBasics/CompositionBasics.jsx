/**
 * GENERATED from force-app/.../lwc/compositionBasics by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import styles from './CompositionBasics.module.css';
import { Boundary, Card } from '@migration/salesforce-runtime/components';
import { ContactTile } from '../contactTile/ContactTile.jsx';
import { ViewSource } from '../viewSource/ViewSource.jsx';

export function CompositionBasics({  }) {
  const [contact, setContact] = React.useState({
        Name: 'Amy Taylor',
        Title: 'VP of Engineering',
        Phone: '6172559632',
        Picture__c:
            'https://s3-us-west-2.amazonaws.com/dev-or-devrl-s3-bucket/sample-apps/people/amy_taylor.jpg'
    });

  return (
    <Boundary name="CompositionBasics" props={{}}>
      <Card title="CompositionBasics" iconName="custom:custom57">
        <div className={styles.varMAroundMedium}>
          <fieldset className={styles.varPHorizontalXSmall}>
            <legend>
              c-contact-tile
            </legend>
            <ContactTile className={styles.showIsRelative} contact={contact} />
          </fieldset>
        </div>
        <ViewSource source="lwc/compositionBasics">
          Nest a child component into a parent component and pass data to the child component using its public (@api) properties.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
