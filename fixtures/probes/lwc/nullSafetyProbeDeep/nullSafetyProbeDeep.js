import { LightningElement, api } from 'lwc';

/** obj is left undefined. The template reads obj.length — ONE hop. */
export default class NullSafetyProbeDeep extends LightningElement {
    @api obj;
}
