package com.migration.salesforce.accountcontroller;

import org.springframework.web.bind.annotation.*;

/**
 * GENERATED REST surface for AccountController.
 *
 * Consumed by the React app through the BFF. Read methods are GET (the Apex was
 * cacheable, so it performs no DML); write methods are POST.
 *
 * SECURITY: this controller performs NO authorisation. On-platform, sharing and
 * FLS were enforced by Apex and the platform. Here they are not enforced by
 * anything until someone adds it — see MIGRATION.md.
 */
@RestController
@RequestMapping("/api/sf/accountcontroller")
public class AccountControllerController {

    private final AccountControllerService service;

    public AccountControllerController(AccountControllerService service) {
        this.service = service;
    }

    @GetMapping("/getAccounts")
    public java.util.List<java.util.Map<String, Object>> getAccounts() {
        return service.getAccounts();
    }
}
