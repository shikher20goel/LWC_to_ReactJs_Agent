/**
 * GENERATED from force-app/.../lwc/brokerCard by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import styles from './BrokerCard.module.css';
import { Boundary, Button } from '@migration/salesforce-runtime/components';

export function BrokerCard({ brokerName, brokerId, onContact }) {
  const handleContact = () => {
        onContact?.({ brokerId: brokerId });
    };

  return (
    <Boundary name="BrokerCard" props={{ brokerName, brokerId }}>
      <div className={`${styles.box} broker-card`}>
        <p className="broker-name">
          {brokerName}
        </p>
        <Button label="Contact" variant="brand" iconName="utility:email" onClick={handleContact} />
        {props.slots?.footer}
      </div>
    </Boundary>
  );
}
