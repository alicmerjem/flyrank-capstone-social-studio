# Evidence
One pasted proof per requirement, from real test runs. 

## Ingestion: a post enters as a URL or text, and is stored
### URL ingestion (real fetch + text extraction)
```
POST /posts {"source":"https://en.wikipedia.org/wiki/Red_fox"}
→ content: "Red fox - Wikipedia Jump to content Main menu Main menu move to sidebar hide..."
```

(Real page content was fetched and HTML-stripped - known limitation: extraction includes site navigation text, not just the article body; noted in`README.md`). 

### Plain text ingestion
```
POST /posts {"source":"Just a plain text post about foxes."}
→ content: "Just a plain text post about foxes."
```

## Constraint profiles enforced by code 
### Two different variants from one post:
```
POST /posts/.../generate {"platforms":["x","linkedin"]}
x:        short, punchy, 1 hashtag
linkedin: longer, framed as an announcement, 2 hashtags
```

### A rule breaking variant is blocked (length)
```
POST /posts/.../generate {"platforms":["x"],"overrides":{"x":"<301-char string>"}}
→ blocked: true, reason: "Exceeds max length for x: 301/280 chars"
```

### A rule breaking variant is blocked (tone):
```
POST /posts/.../generate 
{"platforms":["linkedin"],"overrides":{"linkedin":"Excited to announce our new product launch! 🚀 #growth"}}
→ blocked: true, reason: "Tone violation for linkedin: professional tone should not include emojis"
```

### Default templates for all 5 platforms still pass every rule (length, hashtag, and tone) after tone enforcement was added:
```
POST /posts/.../generate {"platforms":["discord","x","linkedin","tiktok","instagram"]}
→ all 5 returned as real drafts, none blocked
```

## Review workflow: only approved variants can be scheduled
### Unapproved schedule attempt - rejected:
```
POST /variants/abeb2f53.../schedule {"scheduledAt":"2026-09-05T12:00:00Z"}
→ 400 {"error":"Cannot schedule a variant with status \"draft\" — only approved variants can be scheduled"}
```

### After approval, schedule succeeds:
```
POST /variants/abeb2f53.../approve → 200 {"id":"abeb2f53...","status":"approved"}
POST /variants/abeb2f53.../schedule {"scheduledAt":"2026-09-05T12:00:00Z"}
→ 201 {"slot_id":"7d1f8429...","variant_id":"abeb2f53...","scheduled_at":"2026-09-05T12:00:00Z","status":"pending"}
```

## Adapter layer: real platform + mock adapters, swapped with zero code changes
A real message was published to a live Discord channel via `DiscordPublisher` (webhook), confirmed visually in the channel. 

**Explicit adapter-swap proof** - two different mock adapters (`MockXPublisher`, `MockInstagramPublisher`) were published through the exact same `/slots/:id/publish` route, one second apart, with zero platform-specific logic in the route - `getPublisher(variant.platform)` selects the correct adapter automatically:
```
GET /publish-history
{ "platform": "x",         "result": "success", "external_ref": "mock-x-8cfcf153..." }
{ "platform": "instagram", "result": "success", "external_ref": "mock-instagram-19b27af1..." }
```

Both records timestamped within the same second, from calls to the identical publish endpoint. 

![proof](image.png)

## Idempotent publish: same slot, same request, one post
```
POST /slots/42f8f91c.../publish
→ 201 {"slot_id":"42f8f91c...","success":true,"externalRef":"discord-webhook-1788353456004"}
(real message appeared in Discord channel)

POST /slots/42f8f91c.../publish   (called again, same slot)
→ 200 {"slot_id":"42f8f91c...","status":"already_published","history":{...same original record...}}
(no second message appeared in Discord)
```

## Durable schedling: worker survies a restart with zero duplicates (proven w/ a 3 slot batch)
1) Generated 3 variants from one post (x, linkedin, discord), approved all 3, scheduled all 3 for the same time (~1 minute out).
2) Restarted the server (`Ctrl+C`, `npm start`) immediately after scheduling, before any slot was due.
3) Waited for the scheduled time to pass.
4) Checked `/publish-history`:
```
slot_id                              platform  result  created_at
93d88660-e017-4956-a6c2-9ae58a2554ee discord   success 2026-09-02T13:42:35.211Z
686164b4-8e0b-41b3-8563-51935a72303c linkedin  success 2026-09-02T13:42:34.696Z
48df247b-741c-4aee-89a2-4cdffc6ad4fd x         success 2026-09-02T13:42:34.665Z
```

All 3 slots from the same batch published exactly once each, automatically, with no manual publish calls, proving the durable worker correctly resumed and processed the entire pending batch after a mid-wait restart, with no duplicates across any of the 3 slots.

## Publish history: every attempt recorded
`GET /publish-history` returns every publish attempt (both automatic worker-triggered and manual), each with platform, result, and an external reference - visible proof of what happened and when.