/**
 * GENERATED from force-app/.../lwc/helloConditionalRendering by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Card, Input } from '@migration/salesforce-runtime/components';
import { ViewSource } from './ViewSource.jsx';

export function HelloConditionalRendering({  }) {
  const [areDetailsVisible, setAreDetailsVisible] = React.useState(false);
  const handleChange = (event) => {
        setAreDetailsVisible(event.target.checked);
    };

  return (
    <Boundary name="HelloConditionalRendering" props={{}}>
      <Card title="HelloConditionalRendering" iconName="custom:custom14">
        <div className="slds-var-m-around_medium">
          <Input type="checkbox" label="Show details" onChange={handleChange} />
          <div className="slds-var-m-vertical_medium">
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
