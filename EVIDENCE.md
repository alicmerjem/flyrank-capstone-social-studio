# Evidence
One pasted proof per requirement, from real test runs. 

## Ingestion: a post enters and is stored
```
POST /posts
{"source":"test","content":"We just shipped a brand new AI-powered feature..."}

→ 201
{
  "id": "04748ef1-96e7-480e-bd7f-fd130016b20b",
  "source": "test",
  "content": "We just shipped a brand new AI-powered feature..."
}
```

## Constraint profiles enforced by code 
### Two different variants from one post:
```
POST /posts/04748ef1.../generate {"platforms":["x","linkedin"]}

x:        "We just shipped a brand new AI-powered feature... #newpost" (short, 1 hashtag)
linkedin: "Excited to share: We just shipped a brand new AI-powered feature...\n\n#professional #growth" (longer, framed differently, 2 hashtags)
```

### A rule breaking variant is blocked, naming the broken rule
```
POST /posts/04748ef1.../generate
{"platforms":["x"], "overrides":{"x":"<301-character string>"}}

→ 201
{"post_id":"04748ef1...","variants":[{"platform":"x","blocked":true,"reason":"Exceeds max length for x: 301/280 chars"}]}
```

## Review workflow: only approved variants can be scheduled
### Unapproved schedule attempt - rejected:
```
POST /variants/abeb2f53.../schedule {"scheduledAt":"2026-09-05T12:00:00Z"}
→ 400 {"error":"Cannot schedule a variant with status \"draft\" — only approved variants can be scheduled"}
```

After approval, schedule succeeds:
```
POST /variants/abeb2f53.../approve → 200 {"id":"abeb2f53...","status":"approved"}
POST /variants/abeb2f53.../schedule {"scheduledAt":"2026-09-05T12:00:00Z"}
→ 201 {"slot_id":"7d1f8429...","variant_id":"abeb2f53...","scheduled_at":"2026-09-05T12:00:00Z","status":"pending"}
```

## Adapter layer: real platform + mock adapters, swappable via config 
A real message was published to a live Discord channel via `DiscordPublisher` (webhook), confirmed visually in the channel. Mock adapters (`MockXPublisher` etc.) implement the same `SocialPublisher.publish(content)` interface and are selected purely by the platform string passed to `getPublisher()` — swapping platforms requires no business logic changes, only which adapter getPublisher returns.

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

## Durable schedling: worker survies a restart with zero duplicates
1) Scheduled a variant (`x`, mock platform) for ~1 minute in the future.
2) Killed the server (`Ctrl+C`) and restarted it (`npm start`) immediately after scheduling, before the scheduled time arrived.
Waited for the scheduled time to pass.
3) Checked `/publish-history` - the slot was published automatically by the worker with no manual publish call, and appears **exactly once**:
```
GET /publish-history
[
  { "slot_id": "68b27cbc...", "platform": "x", "result": "success", "external_ref": "mock-x-6e474864..." },
  ...
]
```

Every `slot_id` in the full history appears exactly once - no slot was ever published twice, including across the restart.

## Publish history: every attempt recorded
`GET /publish-history` returns every publish attempt (both automatic worker-triggered and manual), each with platform, result, and an external reference - visible proof of what happened and when.