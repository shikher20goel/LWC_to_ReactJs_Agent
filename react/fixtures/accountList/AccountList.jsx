/**
 * GENERATED from force-app/.../lwc/accountList by codemod/component.js.
 * Do not edit by hand — regenerate. Review every TODO before shipping.
 * No review items flagged.
 */
import React from 'react';
import { useApex } from '@migration/salesforce-runtime';
import { Boundary, Button, Card, FormattedText } from '@migration/salesforce-runtime/components';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';

export function AccountList({ onAccountselected }) {
  const response = useApex(getAccounts, {});
  const accounts = () => (response && response.data ? response.data : []);
  const hasAccounts = () => (accounts().length > 0);
  const hasError = () => (Boolean(response && response.error));
  const handleView = (event) => {
        onAccountselected?.({ accountId: event.target.dataset.id });
    };

  return (
    <Boundary name="AccountList" props={{}}>
      <Card title="Accounts" iconName="standard:account">
        {hasAccounts() ? (
          <>
            <ul>
              {(accounts() ?? []).map((account) => (
                  <li className="account-row" key={account.Id}>
                    <p className="account-name">
                      {account.Name}
                    </p>
                    <FormattedText value={account.Industry} />
                    <Button data-id={account.Id} label="View" variant="neutral" onClick={handleView} />
                  </li>
              ))}
            </ul>
          </>
        ) : hasError() ? (
          <>
            <p className="error-state">
              Unable to load accounts
            </p>
          </>
        ) : (
          <>
            <p className="empty-state">
              No accounts to display
            </p>
          </>
        )}
      </Card>
    </Boundary>
  );
}
