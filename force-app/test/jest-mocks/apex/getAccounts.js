const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
module.exports = { default: createApexTestWireAdapter(jest.fn()) };
