/**
 * GENERATED from force-app/.../lwc/propertySummary by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 2 item(s) need review; see the TODO block below.
 */
import React from 'react';
import styles from './PropertySummary.module.css';
import { useApex, useRecord } from '@migration/salesforce-runtime';
import { Boundary, Card, FormattedNumber } from '@migration/salesforce-runtime/components';
import { getFieldValue } from '@migration/salesforce-runtime';
import NAME_FIELD from '@salesforce/schema/Property__c.Name';
import PRICE_FIELD from '@salesforce/schema/Property__c.Price__c';
import { BrokerCard } from './BrokerCard.jsx';
import getBroker from '@salesforce/apex/PropertyController.getBroker';

/* REVIEW REQUIRED:
 *  [template-event-casing] Custom event "contact" — LWC lowercases event names, so the original camelCase cannot be recovered. Emitted "onContact"; verify.
 *  [lifecycle-manual] renderedCallback requires human translation (DOM timing / imperative access).
 */

const FIELDS = [NAME_FIELD, PRICE_FIELD];

export function PropertySummary({ recordId, onBrokerselected }) {
  const [error, setError] = React.useState(undefined);
  const [renderCount, setRenderCount] = React.useState(0);
  const property = useRecord({ recordId: recordId, fields: FIELDS });
  const broker = useApex(getBroker, { propertyId: recordId });
  const hasProperty = Boolean(property && property.data);
  const propertyName = getFieldValue(property.data, NAME_FIELD);
  const propertyPrice = getFieldValue(property.data, PRICE_FIELD);
  const brokerName = broker && broker.data ? broker.data.Name : '';
  const brokerId = broker && broker.data ? broker.data.Id : null;
  const handleBrokerContact = (event) => {
        onBrokerselected?.({ brokerId: event.detail.brokerId });
    };
  // TODO(renderedCallback): NOT auto-converted — Tier A. Original body:
  //   {
  //   renderCount += 1;
  //   if (_initialised) return;
  //   _initialised = true;
  //   }

  return (
    <Boundary name="PropertySummary" props={{ recordId }}>
      <Card title="Property Summary" iconName="standard:account">
        {hasProperty ? (
          <>
            <div className={styles.pAroundMedium}>
              <h2 className="property-name">
                {propertyName}
              </h2>
              <FormattedNumber value={propertyPrice} formatStyle="currency" currencyCode="USD" />
              <BrokerCard brokerName={brokerName} brokerId={brokerId} onContact={handleBrokerContact} />
            </div>
          </>
        ) : (
          <>
            <p className="empty-state">
              Select a property to see details here
            </p>
          </>
        )}
      </Card>
    </Boundary>
  );
}
