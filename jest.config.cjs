const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');
module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        '^@salesforce/apex/PropertyController.getBroker$':
            '<rootDir>/force-app/test/jest-mocks/apex/getBroker.js',
        '^@salesforce/apex/AccountController.getAccounts$':
            '<rootDir>/force-app/test/jest-mocks/apex/getAccounts.js'
    },
    testMatch: [
        '<rootDir>/oracle/**/*.test.js',
        '<rootDir>/codemod/**/*.test.js'
    ]
};
