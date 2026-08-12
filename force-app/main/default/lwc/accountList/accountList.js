import { LightningElement, wire } from 'lwc';
import getAccounts from '@salesforce/apex/AccountController.getAccounts';

export default class AccountList extends LightningElement {
    @wire(getAccounts)
    response;

    get accounts() {
        return this.response && this.response.data ? this.response.data : [];
    }

    get hasAccounts() {
        return this.accounts.length > 0;
    }

    get hasError() {
        return Boolean(this.response && this.response.error);
    }

    handleView(event) {
        this.dispatchEvent(new CustomEvent('accountselected', {
            detail: { accountId: event.target.dataset.id }
        }));
    }
}
