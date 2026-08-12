package com.migration.salesforce.accountcontroller;

import org.springframework.stereotype.Service;

/**
 * GENERATED from Apex class AccountController — regenerate, do not hand-edit the structure.
 *
 * PATH A (decision D-1): Salesforce remains the system of record. This service
 * holds the logic; data access goes through SalesforceClient.
 *
 * Method BODIES are intentionally NOT translated. Apex and Java look alike
 * enough that a syntactic port reads as finished while losing SOQL semantics,
 * sharing context and null handling. Each method currently routes through the
 * generated Apex REST bridge, which is correct as a transition and must be
 * replaced when the class genuinely moves.
 *
 * Original sharing declaration: with sharing
 */
@Service
public class AccountControllerService {

    private final SalesforceClient salesforce;

    public AccountControllerService(SalesforceClient salesforce) {
        this.salesforce = salesforce;
    }

    /**
     * Apex: @AuraEnabled(cacheable=true) List<Account> getAccounts()
     *
     * READ path. Cacheable in Apex, so it performs no DML.
     */
    public java.util.List<java.util.Map<String, Object>> getAccounts() {
        // TODO(human): translate the Apex body. The structure below calls the
        // existing Apex through the generated REST bridge, which is correct as
        // a TRANSITION. Replace it with real Java + Salesforce API calls when
        // this class actually moves.
        return salesforce.call("AccountController.getAccounts", java.util.Map.of(), new org.springframework.core.ParameterizedTypeReference<>() {});
    }
}
