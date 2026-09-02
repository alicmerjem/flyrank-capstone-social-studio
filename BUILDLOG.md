# Buildlog
Honest log of where AI (Claude) helped, where it was wrong, and what changed. 

## Design phase
Claude helped draft the inital data model, API surface, and constraint profile tale based on my picks (Discord as the real platform, 4 mock platforms). I reviewed and could explain every field before building against it. 

## Phase 2 - bug caught during testing
The first version of variant generation always truncated content to fit each platform's length limit before validating it - which meant validation could never actually reject anything, since generated content was engineered to always pass. This silently broke the capstone's own requirement ("*a rule-breaking variant is blocked*"). Caught this by actually trying to test the blocking behavior and getting nothing to block. Fixed by adding an overrides field so custom/edited content bypasses auto-truncation and goes through real, un-cushioned validation - this also turned out to be a genuinely useful feature (a real user editing a variant before approval would want exactly this).

## Phase 4-5: debugging along the way
- Windows PowerShell repeatedly mangled JSON string bodies with escaped quotes `(\"...\")` passed inline to `Invoke-RestMethod`. Fixed by building the request body as a PowerShell hashtable and piping through `ConvertTo-Json` instead of hand-escaping strings - a more reliable pattern used for the rest of the build.
- On the first durability test, `/publish-history` showed no new entry after restarting the server and waiting - turned out the scheduler worker code (the `setInterval` polling loop) had been described but never actually written into `server.js` before that test run. Confirmed by reading the actual file contents, added the missing block, and reran the test - it then worked correctly on the next attempt.

## What I built and checked myself
I wrote/approved the actual constraint profile values (length limits, hashtag caps per platform), picked Discord as the real integration target, and personally ran every checkpoint test against the live system (generation, blocking, review workflow, idempotent publish, and the restart-durability test) rather than accepting any of it on Claude's word - the Discord message and the publish-history output are real, not simulated.

## What I'd flag as AI assisted but fully understood
The idempotency check (skip publishing if a slot's status is already published) and the durable-worker pattern (job state in SQLite, not in memory, so a restart just re-queries) were both explained to me as concepts before being implemented, and I could describe why each one works, not just that it works.