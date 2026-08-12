/**
 * GENERATED from force-app/.../lwc/viewSource by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { Boundary } from '@migration/salesforce-runtime/components';

export function ViewSource({ source, children }) {
  const [baseURL, setBaseURL] = React.useState('https://github.com/trailheadapps/lwc-recipes/tree/main/force-app/main/default/');
  const sourceURL = baseURL + source;

  return (
    <Boundary name="ViewSource" props={{ source }}>
      <div className="description">
        {children}
      </div>
      <p>
        <a className="slds-text-link" href={sourceURL} target="source">
          View Source
        </a>
      </p>
    </Boundary>
  );
}
