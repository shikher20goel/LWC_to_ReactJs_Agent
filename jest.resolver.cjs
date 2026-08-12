/**
 * Resolver: @salesforce/* means two different things in this repo.
 *
 * On the LWC SIDE it is a real module that sfdx-lwc-jest resolves to a proper
 * stub — @salesforce/schema/Property__c.Name must come back with a usable
 * fieldApiName, because the LWC under test passes it to a wire and the oracle
 * compares the result.
 *
 * On the REACT SIDE it is a token that does not exist off-platform at all. The
 * generated component imports it only so the reference resolves; the value is
 * never meaningful, because the data arrives through the transport instead.
 *
 * A moduleNameMapper cannot tell them apart — it matches the request, not the
 * requester — so mapping @salesforce/* globally to a stub made the React
 * components load and broke three oracle tests that depend on the real schema
 * stub. Both behaviours are needed, so the discriminator has to be WHO is
 * importing, which only a resolver sees.
 *
 * Generated React lives under react/ and nothing else does. That is the test.
 */
const path = require('path');

const lwcResolver = require('@salesforce/sfdx-lwc-jest/src/resolver.js');

const REACT_ROOT = `${path.sep}react${path.sep}`;
const STUB = path.join(__dirname, 'console', 'sf-stub.js');

module.exports = function resolve(request, options) {
    if (request.startsWith('@salesforce/')) {
        const from = options.basedir || '';
        // Normalise so the check works whichever separator jest hands us.
        const norm = from.split('/').join(path.sep);
        if (norm.includes(REACT_ROOT)) return STUB;
    }
    return lwcResolver(request, options);
};
