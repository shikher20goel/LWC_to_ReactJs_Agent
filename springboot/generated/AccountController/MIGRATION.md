# AccountController → AccountControllerService

**Path:** A — Salesforce remains the system of record (decision D-1)
**Source:** `AccountController.cls`  ·  **Sharing:** `with sharing`
**Methods:** 1 (1 read, 0 write)

## A human must still do

- [ ] Translate each method body. The generated bodies route through the
      Apex REST bridge — correct as a transition, not as a destination.
- [ ] Decide sharing and FLS explicitly. On-platform the platform enforced
      them; here nothing does until someone writes it.
- [ ] Replace `Map<String,Object>` with real DTOs where the shape is known.
- [ ] Write tests from the Apex tests' INTENT, not by porting them
      (research/01 R-4).

## Flagged

- **[types]** Modelled as Map<String,Object> rather than invented DTOs: Account. Guessing a DTO shape from a type name produces plausible-wrong code that is expensive to unpick.