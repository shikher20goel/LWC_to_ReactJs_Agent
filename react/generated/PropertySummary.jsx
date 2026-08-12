/**
 * GENERATED from force-app/.../lwc/propertySummary by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * 2 item(s) need review; see the TODO block below.
 */
import React from 'react';
import { useApex, useRecord } from '@migration/salesforce-runtime';
import { Boundary, Card, FormattedNumber } from '@migration/salesforce-runtime/components';
import getBroker from '@salesforce/apex/PropertyController.getBroker';

/* REVIEW REQUIRED:
 *  [template-event-casing] Custom event "contact" — LWC lowercases event names, so the original camelCase cannot be recovered. Emitted "onContact"; verify.
 *  [lifecycle-manual] renderedCallback requires human translation (DOM timing / imperative access).
 */

export function PropertySummary({ recordId, onBrokerselected }) {
  // field: error — LWC instance state
  const [error] = React.useState(undefined);
  // field: renderCount — LWC instance state
  const [renderCount] = React.useState(0);
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
            <div className="slds-p-around_medium">
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
