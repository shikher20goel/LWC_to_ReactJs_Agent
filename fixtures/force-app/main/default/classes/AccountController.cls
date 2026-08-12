public with sharing class AccountController {
    /**
     * Accounts for the accountList LWC.
     * WITH USER_MODE enforces FLS and sharing at the query layer — the
     * migration must preserve this, it is not decoration. See CLAUDE.md
     * hard rule 4 on FLS/sharing-dependent behaviour.
     */
    @AuraEnabled(cacheable=true)
    public static List<Account> getAccounts() {
        return [
            SELECT Id, Name, Industry
            FROM Account
            WITH USER_MODE
            ORDER BY Name
            LIMIT 50
        ];
    }
}
