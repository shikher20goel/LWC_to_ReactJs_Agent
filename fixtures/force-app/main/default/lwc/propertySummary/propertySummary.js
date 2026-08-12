import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import getBroker from '@salesforce/apex/PropertyController.getBroker';
import NAME_FIELD from '@salesforce/schema/Property__c.Name';
import PRICE_FIELD from '@salesforce/schema/Property__c.Price__c';
const FIELDS = [NAME_FIELD, PRICE_FIELD];
export default class PropertySummary extends LightningElement {
    @api recordId;
    error;
    renderCount = 0;
    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    property;
    @wire(getBroker, { propertyId: '$recordId' })
    broker;
    get hasProperty() { return Boolean(this.property && this.property.data); }
    get propertyName() { return getFieldValue(this.property.data, NAME_FIELD); }
    get propertyPrice() { return getFieldValue(this.property.data, PRICE_FIELD); }
    get brokerName() {
        return this.broker && this.broker.data ? this.broker.data.Name : '';
    }
    get brokerId() {
        return this.broker && this.broker.data ? this.broker.data.Id : null;
    }
    renderedCallback() {
        this.renderCount += 1;
        if (this._initialised) return;
        this._initialised = true;
    }
    handleBrokerContact(event) {
        this.dispatchEvent(new CustomEvent('brokerselected', {
            detail: { brokerId: event.detail.brokerId }
        }));
    }
}
