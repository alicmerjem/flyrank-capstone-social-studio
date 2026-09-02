# Buildlog
Honest log of where AI (Claude) helped, where it was wrong, and what changed. 

## Design phase
Claude helped draft the inital data model, API surface, and constraint profile tale based on my picks (Discord as the real platform, 4 mock platforms). I reviewed and could explain every field before building against it. 

## Phase 2 - bug caught during testing
The first version of variant generation always truncated content to fit each platform's length limit before validating it - which meant validation could never actually reject anything, since generated content was engineered to always pass. This silently broke the capstone's own requirement ("*a rule-breaking variant is blocked*"). Caught this by actually trying to test the blocking behavior and getting nothing to block. Fixed by adding an overrides field so custom/edited content bypasses auto-truncation and goes through real, un-cushioned validation - this also turned out to be a genuinely useful feature (a real user editing a variant before approval would want exactly this).

## Phase 4-5: debugging along the way
- Windows PowerShell repeatedly mangled JSON string bodies with escaped quotes `(\"...\")` passed inline to `Invoke-RestMethod`. Fixed by building the request body as a PowerShell hashtable and piping through `ConvertTo-Json` instead of hand-escaping strings - a more reliable pattern used for the rest of the build.
- On the first durability test, `/publish-history` showed no new entry after restarting the server and waiting - turned out the scheduler worker code (the `setInterval` polling loop) had been described but never actually written into `server.js` before that test run. Confirmed by reading the actual file contents, added the missing block, and reran the test - it then worked correctly on the next attempt.

## Hardening pass - 4 gaps closed after review
After the core system worked, 4 gaps were identified and fixed rather than left as-is:
1) **URL ingestion was fake**. The original `/posts` route jut stored a URL string without fetching it. Added `fetch()` + HTML-stripping so a URL source now returns an actual extractedpage text. A limitation that came with that is that extractoin includes site navigation/UI text alongside the article body. A real production system would target the specific content region of the page, not the whole document. 
2) **A duplicate route silently shadowed the fix**. After adding the URL-ingestion route, an old duplicate `app.post('/posts', ...)` route (without URL handling) was still present further down the file. Express used the first-registered route, so the new logic never ran despite the fact that it was correct. Found by testing and noticing the behaviour did not match the code. The duplicate was deleted afterwards. 
3) **Tone was a label with no real enforcement**. Added `checkTone()`: professional tone platforms (LinkedIn) reject content containing emojis; hooky/aesthetic tone platforms (TikTok, Instagram) require at least one. Verified all 5 default templates still pass their own delcared tone rule after enforcement was added, and confirmed an emoji-laden LinkedIn variant gets correctly rejected. 
4) **Powershell was silently corrupting emoji test input**. When testing the new tone rule, a LinkedIn variant containing 🚀 was not being blocked, which made it look like te tone check itself was broken. Actual cause was that the Powershell's default string handling replaced the emoji with literal `??` characters before the request even made it to the client, so the server correctly found 0 emojis and allowed it through, which in one hand did confirm the validation logic was fine. Fixed by explicitly encoding the JSON body as UTF-8 bytes (`[System.Text.Encoding]::UTF8.GetBytes(...)`) instead of letting Powershell guess the encoding. 
5) **Adapter swap and multi slot durability were not explicitly proven, but architecturally supported**. Ran two dedicated tests: (a) the same near identical content publicjed through `MockXPublisher` and `MockInstagramPublisher` via the identical `/slots/:id/publish` route with zero platform-specific code; (b) a 3-slot batch (X, LinkedIn, Discord) scheduled together, server restarted mid-wait, and all 3 confirmed published exactly once with no duplicates - the exact scenario the capstone brief describes.

## Stretch goals implemented (all 4 of them)
1) **Multi-tenant isolation** - every request requires an `X-Tenant-Id` header; posts and variants are scoped per tenant at the query level, not just the UI. Proven: tenant B gets a 404 trying to access tenant A's post.
2) **Grounding check** - variants are validated against the source post: any numeric claim (percentage, dollar amount, number) not found in the source is blocked before reaching review. Proven: a planted fake statistic (999%) gets caught and named in the rejection reason.
3) **A/B variants with pick-the-winner** - `POST /posts/:id/generate-ab` produces two differently-phrased variants per platform; `POST /variants/:id/pick-winner` approves the chosen one and automatically rejects its pair.
4) **Automated test suite** - npm test runs 12 tests covering every scary case from the brief: blocked variants (length/tone/grounding), refused unapproved scheduling, duplicate-publish prevention, adapter swap across two mock platforms, and tenant isolation. All 12 pass.

## AI generation upgrade and some bugs I found through testing
After the core system was working with static templates, real AI generation was added (OpenRouter free tier), with graceful fallback to templates if the AI call fails or is disabled - the same generation-then-validate-then-repair pipeline already built for `/normalize` was reused directly, since variant validation (length, tone, hashtags, grounding) works identically regardless of whether the content came from AI or a template.

Two real bugs were found and fixed while testing this with genuine, specific content (not throwaway test strings):
1) **Free-tier response time variance caused a silent fallback.** One request to the x platform timed out at 30 seconds and correctly fell back to the template, which was confirmed via the server log (`"AI generation failed for x, falling back to template: request timed out"`). This is honest, expected behavior for a free-tier router that load-balances across many underlying models, but the default timeout was too tight for the slower end of that range. Increased to 45 seconds.
2) **A leaked classifier label passed validation as if it were real content.** One response from the free-tier router returned the literal string `"User Safety: safe"`; apparently an internal safety-classification label rather than an actual attempt to write a post. This passed every existing validation rule (short, no hashtags, no fabricated claims) because none of those rules check whether content is actually a real post. Found this only because the output looked suspicious on manual inspection, not because any test caught it automatically. Added a pattern check for label-shaped output (`Word: word`) to `validateVariant`, which now correctly triggers the repair-retry (and template fallback, if the retry also fails) instead of silently accepting garbage.

Neither of these would have been found without testing against real, unpredictable model output rather than only the deterministic template path - a genuine argument for why "the AI is optional but the validation is what's graded" (the capstone brief's own framing) matters in practice, not just in theory.

## Hashtag formatting bug
The first AI-generated LinkedIn post included hashtag-style words without the actual `# `symbol (e.g. `ProductDevelopment` instead of `#ProductDevelopment`), which passed validation since the hashtag counter only recognizes strings starting with `#`. Fixed by explicitly instructing the model in the system prompt that every hashtag must include the # symbol. Confirmed fixed on the next real generation.

## Dashboard and design pass
Added a full browser dashboard (`public/index.html`) so the system could be tested and used without the terminal - a static file served directly by Express (`express.static('public')`), with vanilla JS calling the existing API, no build step or framework added.

The first version was functional but visually generic. Went through an explicit two-pass design process (plan first, then build) to land on a deliberate light-theme identity: a warm off-white/ochre palette distinct from common AI-generated-design defaults, a Zilla Slab + Space Grotesk font pairing, flat bordered buttons instead of the generic soft-shadow rounded-pill treatment, and a left-rail layout reflecting the actual 4-step pipeline (Post → Generate → Review → Schedule) rather than a generic nav.

Added a loading indicator during AI generation (since calls can take up to 45s) and a "source" badge on each variant (AI-written / Template / Manual) so it's visually clear which variants actually came from the model versus the fallback path — this required a small backend change (tracking and returning a source field per variant in the /generate response) alongside the frontend work.

## Bugs found while building the tenant scoped history/scheduling
While adding `tenant_id` to `schedule_slots` and `publish_history` (closing a gap where publish history wasn't tenant-isolated), hit 3 bugs in quick succession, all found through actual testing rather than code review:
1) A `.run()` call was missing the new `tenant_id` argument even though the SQL column list included it, caused a parameter-count mismatch.
2) A misleading catch-all error handler reported "already scheduled" for any database error, hiding the real cause (the bug above) behind a wrong message. Fixed to only show that message for a genuine uniqueness-constraint violation, and surface the real error otherwise.
3) A typo (`err.mesage` instead of `err.message`) in that same fixed error handler caused a new crash the first time a real error occurred — caught immediately on the next test run.
4) A property-name mismatch (`slot.tenantId` vs. the actual `slot.tenant_id` from SQLite) in the background worker's publish path, would have caused every automatic (non-manual) publish to fail with a NOT NULL constraint violation, since undefined was being inserted as the tenant.

All four were found by insisting on rerunning real end-to-end tests after each change rather than assuming the change was correct from reading it, consistent with the same discipline used throughout this build.

## Decision: no hosting/deplyoment
Considered deploying to Vercel for a live demo link, but the app's architecture (a long-running background scheduler polling every 5s, plus local SQLite disk writes) is fundamentally incompatible with Vercel's stateless serverless model. Per the capstone's own stated scope ("hosting: none required — everything runs locally"), deployment was intentionally left out rather than pursued as unnecessary scope creep, with a note in the README on which platforms would actually support this architecture if deployment is wanted later.

## What I built and checked myself
I wrote/approved the actual constraint profile values (length limits, hashtag caps per platform), picked Discord as the real integration target, and personally ran every checkpoint test against the live system (generation, blocking, review workflow, idempotent publish, and the restart-durability test) rather than accepting any of it on Claude's word - the Discord message and the publish-history output are real, not simulated.

## What I'd flag as AI assisted but fully understood
The idempotency check (skip publishing if a slot's status is already published) and the durable-worker pattern (job state in SQLite, not in memory, so a restart just re-queries) were both explained to me as concepts before being implemented, and I could describe why each one works, not just that it works.