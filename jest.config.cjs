const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');
module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        '^@salesforce/apex/PropertyController.getBroker$':
            '<rootDir>/force-app/test/jest-mocks/apex/getBroker.js',
        '^@salesforce/apex/AccountController.getAccounts$':
            '<rootDir>/force-app/test/jest-mocks/apex/getAccounts.js',
        // Generated components import the runtime by package name. In a real
        // build this is a workspace package; here it maps to shim/.
        '^@migration/salesforce-runtime/components$': '<rootDir>/shim/components.js',
        '^@migration/salesforce-runtime$': '<rootDir>/shim/runtime.js'
    },
    // Generated React components are emitted as .jsx so they get the React
    // transform WITHOUT touching the LWC transform, which owns .js/.html/.css.
    // Overlapping those would break LWC template compilation.
    moduleFileExtensions: [...jestConfig.moduleFileExtensions, 'jsx'],
    transform: {
        ...jestConfig.transform,
        '^.+\\.jsx$': ['babel-jest', {
            presets: [['@babel/preset-react', { runtime: 'automatic' }]],
            // Jest runs CJS. preset-react only handles JSX, not ES modules —
            // without this the file parses as CJS and `import` throws.
            plugins: ['@babel/plugin-transform-modules-commonjs']
        }]
    },
    testMatch: [
        '<rootDir>/oracle/**/*.test.js',
        '<rootDir>/codemod/**/*.test.js',
        '<rootDir>/census/**/*.test.js',
        '<rootDir>/shim/**/*.test.js',
        '<rootDir>/fixtures/**/*.test.js',
        '<rootDir>/catalog/**/*.test.js'
    ]
};
