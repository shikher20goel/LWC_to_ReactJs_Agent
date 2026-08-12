const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');
module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        '^@salesforce/apex/PropertyController.getBroker$':
            '<rootDir>/force-app/test/jest-mocks/apex/getBroker.js'
    },
    testMatch: ['<rootDir>/oracle/**/*.test.js']
};
