/**
 * GENERATED from force-app/.../lwc/apiProperty by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Card, Input } from '@migration/salesforce-runtime/components';
import { ChartBar } from './ChartBar.jsx';
import { ViewSource } from './ViewSource.jsx';

export function ApiProperty({  }) {
  const [percentage, setPercentage] = React.useState(50);
  const handlePercentageChange = (event) => {
        setPercentage(event.target.value);
    };

  return (
    <Boundary name="ApiProperty" props={{}}>
      <Card title="ApiProperty" iconName="standard:product_consumed">
        <div className="slds-var-m-around_medium">
          <Input label="Percentage" type="number" min="0" max="100" value={percentage} onChange={handlePercentageChange} />
          <fieldset className="slds-var-p-around_x-small">
            <legend>
              c-chart-bar
            </legend>
            <ChartBar percentage={percentage} />
          </fieldset>
        </div>
        <ViewSource source="lwc/apiProperty">
          Parent-to-child communication. Pass data to a child component using its public (@api) properties.
        </ViewSource>
      </Card>
    </Boundary>
  );
}
