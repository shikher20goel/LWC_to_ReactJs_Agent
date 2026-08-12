/**
 * GENERATED from force-app/.../lwc/hello by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Card } from '@migration/salesforce-runtime/components';
import { ViewSource } from './ViewSource.jsx';

export function Hello({  }) {
  const [greeting, setGreeting] = React.useState('World');

  return (
    <Boundary name="Hello" props={{}}>
      <Card title="Hello" iconName="custom:custom14">
        <div className="slds-var-m-around_medium">
          Hello,
          {greeting}
          !
        </div>
        <ViewSource source="lwc/hello">
          Bind an HTML element to a component property.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
