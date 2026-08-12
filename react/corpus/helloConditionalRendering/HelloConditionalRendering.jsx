/**
 * GENERATED from force-app/.../lwc/helloConditionalRendering by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import styles from './HelloConditionalRendering.module.css';
import { Boundary, Card, Input } from '@migration/salesforce-runtime/components';
import { ViewSource } from '../viewSource/ViewSource.jsx';

export function HelloConditionalRendering({  }) {
  const [areDetailsVisible, setAreDetailsVisible] = React.useState(false);
  const handleChange = (event) => {
        setAreDetailsVisible(event.target.checked);
    };

  return (
    <Boundary name="HelloConditionalRendering" props={{}}>
      <Card title="HelloConditionalRendering" iconName="custom:custom14">
        <div className={styles.varMAroundMedium}>
          <Input type="checkbox" label="Show details" onChange={handleChange} />
          <div className={styles.varMVerticalMedium}>
            {areDetailsVisible ? (
              <>
                These are the details!
              </>
            ) : (
              <>
                Not showing details.
              </>
            )}
          </div>
        </div>
        <ViewSource source="lwc/helloConditionalRendering">
          Conditionally render elements.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
