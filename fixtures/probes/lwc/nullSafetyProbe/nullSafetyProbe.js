import { LightningElement, api } from 'lwc';

/**
 * Deliberately leaves undefinedList undefined and obj shallow. The template
 * reads THROUGH the missing values. See nullSafetyProbe.test.js.
 */
export default class NullSafetyProbe extends LightningElement {
    @api undefinedList;
    @api obj = {};
}
