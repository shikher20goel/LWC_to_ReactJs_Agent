const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');
module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        // ORDER MATTERS — jest takes the first matching pattern.
        '^@salesforce/apex/PropertyController.getBroker$':
            '<rootDir>/force-app/test/jest-mocks/apex/getBroker.js',
        '^@salesforce/apex/AccountController.getAccounts$':
            '<rootDir>/force-app/test/jest-mocks/apex/getAccounts.js',
        // `c/*` resolves through sfdx-project.json, which points at force-app
        // — the user's org retrieval — so probe bundles are mapped explicitly.
        //
        // They live in fixtures/probes, NOT fixtures/force-app, because that
        // tree is the census corpus and its tests assert on the exact bundle
        // list. Dropping a probe in there broke bundle discovery immediately.
        // Corpus and instrument are different things; keep them apart.
        '^c/nullSafetyProbeDeep$':
            '<rootDir>/fixtures/probes/lwc/nullSafetyProbeDeep/nullSafetyProbeDeep.js',
        '^c/nullSafetyProbe$':
            '<rootDir>/fixtures/probes/lwc/nullSafetyProbe/nullSafetyProbe.js',
        // Generated components import the runtime by package name. In a real
        // build this is a workspace package; here it maps to shim/.
        '^@migration/salesforce-runtime/components$': '<rootDir>/shim/components.js',
        '^@migration/salesforce-runtime$': '<rootDir>/shim/runtime.js',
        // jsdom resolves the "browser" export condition, which for this package
        // is an ESM build jest cannot load. Point at the CJS build directly —
        // changing customExportConditions globally would break react-dom.
        '^@apexdevtools/apex-parser$':
            '<rootDir>/node_modules/@apexdevtools/apex-parser/dist/cjs/index.cjs'
        // Every OTHER @salesforce/* import is handled by jest.resolver.cjs,
        // which stubs them for generated React and leaves the LWC side to
        // sfdx-lwc-jest. It has to be a resolver, not a mapper, because the
        // right answer depends on WHO is importing — see that file.
    },
    resolver: '<rootDir>/jest.resolver.cjs',
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
        '<rootDir>/catalog/**/*.test.js',
        '<rootDir>/apex/**/*.test.js',
        '<rootDir>/agent/**/*.test.js'
    ]
};
