import { LightningElement, api } from 'lwc';
export default class BrokerCard extends LightningElement {
    @api brokerName;
    @api brokerId;
    handleContact() {
        this.dispatchEvent(new CustomEvent('contact', {
            detail: { brokerId: this.brokerId },
            bubbles: true,
            composed: true
        }));
    }
}
