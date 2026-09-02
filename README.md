# Social Media Studio
Turn one blog post into a tailored campaign across multiple platforms - a short punchy version for X, a professional one for LinkedIn, a hooky caption for TikTok, and more - with human approval before anything publishes, and a scheduler that guarantess each approved post goes out exactly once, even under retries or a crash mid batch. 

Built as a capstone project for the FlyRank AI Backend Engineering internship. 

## What it does
1) **Ingest a blog post** (URL or raw text) - stored once as the single source of truth.
2) **Generate** a platform specific variant for each configured platform, validates against that platform's constraint profile (length, tone, hashtag limits) - a rule-breaking variant never reaches the view. 
3) **Review** each variant: approve, edit or reject. Only approved variants can be scheduled. 
4) **Schedule and publish**: an approved variant is scheduled for a time slot; a durable, crash-sage worker publishes it *exactly* once through a `SocialPublisher` adapter - a real Discord webhook, or a mock adapter (X, LinkedIn, TikTok, Instagram) that records what it would have posted. 

## Architecture
*(diagram + full writeup added as the build progresses)*

## Setup 
*(run steps added once the system is runmable end to end)*

## Constraint profiles
See `DESIGN.md` for the full table. 

## Evidence
See `EVIDENCE.md` for proof of each requirement (idempotent publishing, constraint reinforcement, review workflow, adapter swap, etc.).

## AI Usage
See `BUILDLOG.md` for an honest log where AI helped, where it was wrong and what changed. 

## Limitations
*(filled in as the build progresses)*