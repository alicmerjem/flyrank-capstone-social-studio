# Design doc - Social Media Studio
## Problem
Turning one piece of content (a blog post) into a platform-appropriate social posts is repetitive manual work. Each platform has different length limits, tone expectations, and hashtag conventions. Marketing teams do this by hand, repeatedly, for every post they publish. 

## Data model
### posts 
- id, source (URL or raw markdown), content (stored text), created_at

### variants
- id, post_id (FK), platform, content, status (draft / approved / rejected / published), created_at

### schedule_slots
- id, variant_id (FK), scheduled_at, idempotency_key (unique), status (pending / publishing / published / failed), published_at

### publish_history
- id, slot_id (FK), variant_id (FK), platform, result (success, failure), external_ref (e.g. Discord message id), created_at

## API surface
- `POST /posts` - ingest a post (URL or markdown), stored as source of truth
- `POST /posts/:id/generate` - generate one variant per configured platform, enforcing each platform's constraint profile
- `GET /variants/:id` - view a variant
- `POST /variants/:id/approve | /reject` - review workflow
- `POST /variants/:id/schedule` - schedule an approved variant for a future time (rejects unapproved variants with 4xx)
- `GET /publish-history` - view all publish attempts and results

## SocialPublisher interface
```
interface SocialPublisher {
  publish(content: string): Promise<{ success: boolean, externalRef?: string, error?: string }>
}
```

Implementations: `DiscordPublisher` (real, via webhook), `MockXPublisher`, `MockLinkedInPublisher`, `MockTikTokPublisher`, `MockInstagramPublisher` (all record what they would post into the database and return a mock success).

## Constraint profiles 
| Platform            | Max length           | Tone              | Max hashtags |
|---------------------|----------------------|-------------------|--------------|
| Discord             | 2000 chars           | casual            | 3            |
| X (mock)            | 280 chars            | punchy            | 3            |
| LinkedIn (mock)     | 3000 chars           | professional      | 5            |
| TikTok (mock)       | 150 chars (caption)  | hooky/casual      | 5            |
| Instagram (mock)    | 2200 chars           | casual/aesthetic  | 10           |

## Scheduling architecture
Rather than adding Redis/BullMQ as an external dependency, scheduling is implemented as a DB-backed job table + polling worker: `schedule_slots` rows are the durable job store (living in SQLite, not in memory), and a worker loop polls for due, non-published slots every N seconds. Because the job's state lives in the database rather than in the worker process's memory, a worker restart mid-batch resumes correctly - it just re-queries for pending due slots and continues, using the idempotency key to guarantee any slot already marked `published` is never re-published, both in the automatic worker path and the manual `/slots/:id/publish` endpoint.

This was proven directly: a slot was scheduled, the server was killed and restarted before the scheduled time arrived, and the publish history afterward showed exactly one successful publish for that slot - no duplicate.

## Stretch goals implemented (all 4 of them)
1) **Multi-tenant isolation** - every request requires an `X-Tenant-Id` header; posts and variants are scoped per tenant at the query level, not just the UI. Proven: tenant B gets a 404 trying to access tenant A's post.
2) **Grounding check** - variants are validated against the source post: any numeric claim (percentage, dollar amount, number) not found in the source is blocked before reaching review. Proven: a planted fake statistic (999%) gets caught and named in the rejection reason.
3) **A/B variants with pick-the-winner** - `POST /posts/:id/generate-ab` produces two differently-phrased variants per platform; `POST /variants/:id/pick-winner` approves the chosen one and automatically rejects its pair.
4) **Automated test suite** - npm test runs 12 tests covering every scary case from the brief: blocked variants (length/tone/grounding), refused unapproved scheduling, duplicate-publish prevention, adapter swap across two mock platforms, and tenant isolation. All 12 pass.

Cost tracking is not implemented (yet, I might) since no AI is used anywhere in this build (variant generation is template based, as the brief allows), there is no LLM cost to track. 

## Non-goal
This capstone **does not** implement real posting to actual X, LinkedIn, TikTok, or Instagram accounts - those are mock adapters only, per the brief's explicit scope. Only Discord is a real, live publishing target. 