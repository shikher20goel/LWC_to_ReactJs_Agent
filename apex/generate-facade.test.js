/**
 * Apex facade tests.
 *
 * These are security assertions. Every failure mode they cover produces a
 * facade that COMPILES AND WORKS — it just also exposes more than intended.
 */
import { analyseApexClass, generateFacade } from './generate-facade.js';

const CONTROLLER = `
public with sharing class DemoController {
    @AuraEnabled(cacheable=true)
    public static List<Account> getAccounts() {
        return [SELECT Id, Name FROM Account WITH USER_MODE LIMIT 10];
    }
    @AuraEnabled(cacheable=true)
    public static Account findOne(String searchKey, Integer maxResults) {
        return null;
    }
    @AuraEnabled
    public static void deleteEverything(Id recordId) {
        // a write path
    }
}
`;

describe('APEX FACADE — read-only is platform-enforced, not promised', () => {
    const cls = analyseApexClass(CONTROLLER, 'DemoController.cls');

    it('detects cacheable=true correctly', () => {
        const byName = Object.fromEntries(cls.methods.map((m) => [m.name, m]));
        expect(byName.getAccounts.cacheable).toBe(true);
        expect(byName.findOne.cacheable).toBe(true);
        expect(byName.deleteEverything.cacheable).toBe(false);
    });

    it('detects static — getText() strips whitespace, so /\\bstatic\\b/ never fires', () => {
        // This exact bug excluded every method as "not static" and the facade
        // still generated cleanly, just empty. Silent and total.
        expect(cls.methods.every((m) => m.isStatic)).toBe(true);
    });

    it('EXCLUDES every non-cacheable method as a write path', () => {
        const { included, excluded } = generateFacade([cls]);
        expect(included.map((m) => m.name).sort()).toEqual(['findOne', 'getAccounts']);
        expect(excluded).toHaveLength(1);
        expect(excluded[0].name).toBe('deleteEverything');
        expect(excluded[0].reason).toMatch(/WRITE path/);
    });

    it('emits no DML-capable operation, so the endpoint cannot mutate', () => {
        const { apex } = generateFacade([cls]);
        expect(apex).not.toContain('deleteEverything');
        expect(apex).toContain('getAccounts');
    });
});

describe('APEX FACADE — the allowlist is compile-time', () => {
    const { apex } = generateFacade([analyseApexClass(CONTROLLER, 'DemoController.cls')]);

    it('dispatches through a switch, never through reflection', () => {
        // Reflection over a client-supplied class/method name would expose
        // EVERY @AuraEnabled method in the org, not just the migrated ones.
        expect(apex).toContain('switch on req.op');
        expect(apex).not.toMatch(/Type\.forName|\.newInstance\(|Callable/);
    });

    it('has a default branch that refuses unknown operations', () => {
        expect(apex).toContain('when else');
        expect(apex).toContain('Unknown operation');
    });

    it('does NOT echo the requested op back on a miss', () => {
        // Echoing confirms which names exist and turns the 404 into an oracle
        // for enumerating the allowlist.
        const whenElse = apex.slice(apex.indexOf('when else'));
        expect(whenElse).not.toContain('req.op');
    });

    it('declares with sharing', () => {
        expect(apex).toMatch(/global with sharing class/);
    });

    it('returns type and message on error, never a stack trace', () => {
        // A stack trace discloses class and field names the caller cannot
        // otherwise see.
        expect(apex).toContain('e.getTypeName()');
        expect(apex).not.toContain('getStackTraceString');
    });

    it('warns against the /s/sfsites/aura shortcut in the generated header', () => {
        expect(apex).toContain('/s/sfsites/aura');
        expect(apex).toMatch(/attack technique/i);
    });
});

describe('APEX FACADE — typed parameters', () => {
    const { apex } = generateFacade([analyseApexClass(CONTROLLER, 'DemoController.cls')]);

    it('casts primitives directly', () => {
        expect(apex).toContain("String searchKey = (String) args.get('searchKey');");
        expect(apex).toContain("Integer maxResults = (Integer) args.get('maxResults');");
    });

    it('round-trips complex types through JSON rather than casting blindly', () => {
        const wrapper = analyseApexClass(`
            public class W {
                @AuraEnabled(cacheable=true)
                public static String go(MyWrapper w) { return null; }
            }`, 'W.cls');
        const out = generateFacade([wrapper]).apex;
        expect(out).toContain('JSON.deserialize(JSON.serialize(args.get(\'w\')), MyWrapper.class)');
    });

    it('passes arguments in declaration order', () => {
        expect(apex).toContain('DemoController.findOne(searchKey, maxResults)');
    });
});

describe('APEX FACADE — against the real lwc-recipes controllers', () => {
    it('reads sharing declarations', () => {
        expect(analyseApexClass(CONTROLLER, 'D.cls').sharing).toBe('with sharing');
        expect(analyseApexClass('public without sharing class X { }', 'X.cls').sharing)
            .toBe('without sharing');
    });

    it('produces an empty-but-valid facade when nothing is bridgeable', () => {
        const onlyWrites = analyseApexClass(`
            public class W {
                @AuraEnabled public static void mutate() {}
            }`, 'W.cls');
        const { apex, included } = generateFacade([onlyWrites]);
        expect(included).toHaveLength(0);
        expect(apex).toContain('when else');   // still a valid class
    });
});
