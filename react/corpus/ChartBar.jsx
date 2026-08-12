/**
 * GENERATED from force-app/.../lwc/chartBar by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary, Layout, LayoutItem, cssToStyle } from '@migration/salesforce-runtime/components';

export function ChartBar({ percentage }) {
  const style = `width: ${percentage}%`;

  return (
    <Boundary name="ChartBar" props={{ percentage }}>
      <div className="container">
        <Layout verticalAlign="center">
          <LayoutItem>
            {percentage}
            %
          </LayoutItem>
          <LayoutItem flexibility="grow">
            <div className="bar" style={cssToStyle(style)} />
          </LayoutItem>
        </Layout>
      </div>
    </Boundary>
  );
}
