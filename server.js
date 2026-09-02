const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = new DatabaseSync('studio.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    source TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS variants (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_slots (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS publish_history (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    result TEXT NOT NULL,
    external_ref TEXT,
    created_at TEXT NOT NULL
  );
`);

// ---------- Constraint profiles ----------

const PROFILES = {
  discord:   { maxLength: 2000, maxHashtags: 3,  tone: 'casual' },
  x:         { maxLength: 280,  maxHashtags: 3,  tone: 'punchy' },
  linkedin:  { maxLength: 3000, maxHashtags: 5,  tone: 'professional' },
  tiktok:    { maxLength: 150,  maxHashtags: 5,  tone: 'hooky' },
  instagram: { maxLength: 2200, maxHashtags: 10, tone: 'casual/aesthetic' }
};

function countHashtags(text) {
  const matches = text.match(/#\w+/g);
  return matches ? matches.length : 0;
}

function validateVariant(platform, content) {
  const profile = PROFILES[platform];
  if (!profile) return { valid: false, reason: `Unknown platform: ${platform}` };

  if (content.length > profile.maxLength) {
    return { valid: false, reason: `Exceeds max length for ${platform}: ${content.length}/${profile.maxLength} chars` };
  }

  const hashtagCount = countHashtags(content);
  if (hashtagCount > profile.maxHashtags) {
    return { valid: false, reason: `Too many hashtags for ${platform}: ${hashtagCount}/${profile.maxHashtags}` };
  }

  return { valid: true };
}

// ---------- Variant generation (template-based, no AI required) ----------

function generateVariant(platform, sourceContent) {
  const profile = PROFILES[platform];
  const truncated = sourceContent.slice(0, profile.maxLength - 30); // leave room for hashtags/suffix

  const templates = {
    discord:   () => `📢 New post: ${truncated}\n#update`,
    x:         () => `${truncated} #newpost`,
    linkedin:  () => `Excited to share: ${truncated}\n\n#professional #growth`,
    tiktok:    () => `${truncated.slice(0, 100)}... watch till the end 👀 #fyp #viral`,
    instagram: () => `${truncated} ✨\n\n#content #newpost #instagood`
  };

  const generator = templates[platform];
  if (!generator) throw new Error(`No template for platform: ${platform}`);

  return generator();
}

// ---------- Routes ----------

app.post('/posts', (req, res) => {
  const { source, content } = req.body;

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ error: 'content is required' });
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare('INSERT INTO posts (id, source, content, created_at) VALUES (?, ?, ?, ?)')
    .run(id, source || null, content, createdAt);

  res.status(201).json({ id, source, content, created_at: createdAt });
});

app.post('/posts/:id/generate', (req, res) => {
  const { id } = req.params;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const platforms = req.body?.platforms || Object.keys(PROFILES);
  const overrides = req.body?.overrides || {}; // optional: { "x": "custom text..." }
  const results = [];

  for (const platform of platforms) {
    let variantContent;

    if (overrides[platform] !== undefined) {
      // custom content; no auto-truncation, real validation applies
      variantContent = overrides[platform];
    } else {
      try {
        variantContent = generateVariant(platform, post.content);
      } catch (err) {
        results.push({ platform, blocked: true, reason: err.message });
        continue;
      }
    }

    const validation = validateVariant(platform, variantContent);

    if (!validation.valid) {
      results.push({ platform, blocked: true, reason: validation.reason });
      continue; // a rule-breaking variant never reaches review
    }

    const variantId = randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare('INSERT INTO variants (id, post_id, platform, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(variantId, id, platform, variantContent, 'draft', createdAt);

    results.push({ id: variantId, platform, content: variantContent, status: 'draft' });
  }

  res.status(201).json({ post_id: id, variants: results });
});

app.get('/variants/:id', (req, res) => {
  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(req.params.id);
  if (!variant) return res.status(404).json({ error: 'Variant not found' });
  res.status(200).json(variant);
});

app.post('/variants/:id/approve', (req, res) => {
  const { id } = req.params;
  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);

  if (!variant) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  db.prepare('UPDATE variants SET status = ? WHERE id = ?').run('approved', id);
  res.status(200).json({ id, status: 'approved' });
});

app.post('/variants/:id/reject', (req, res) => {
  const { id } = req.params;
  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);

  if (!variant) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  db.prepare('UPDATE variants SET status = ? WHERE id = ?').run('rejected', id);
  res.status(200).json({ id, status: 'rejected' });
});

app.post('/variants/:id/edit', (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);

  if (!variant) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  const validation = validateVariant(variant.platform, content);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason });
  }

  db.prepare('UPDATE variants SET content = ? WHERE id = ?').run(content, id);
  res.status(200).json({ id, content, status: variant.status });
});

app.post('/variants/:id/schedule', (req, res) => {
  const { id } = req.params;
  const { scheduledAt } = req.body;
  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);

  if (!variant) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  if (variant.status !== 'approved') {
    return res.status(400).json({ error: `Cannot schedule a variant with status "${variant.status}" — only approved variants can be scheduled` });
  }

  const slotId = randomUUID();
  const idempotencyKey = `${id}-${scheduledAt}`;

  try {
    db.prepare('INSERT INTO schedule_slots (id, variant_id, scheduled_at, idempotency_key, status) VALUES (?, ?, ?, ?, ?)')
      .run(slotId, id, scheduledAt, idempotencyKey, 'pending');
  } catch (err) {
    return res.status(409).json({ error: 'This variant is already scheduled for this time' });
  }

  res.status(201).json({ slot_id: slotId, variant_id: id, scheduled_at: scheduledAt, status: 'pending' });
});

const { getPublisher } = require('./publishers');

app.post('/slots/:id/publish', async (req, res) => {
  const { id } = req.params;
  const slot = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(id);

  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }

  // idempotency: if already published, return the original result instead of publishing again
  if (slot.status === 'published') {
    const existingHistory = db.prepare('SELECT * FROM publish_history WHERE slot_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
    return res.status(200).json({ slot_id: id, status: 'already_published', history: existingHistory });
  }

  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(slot.variant_id);
  const publisher = getPublisher(variant.platform);

  const result = await publisher.publish(variant.content);
  const historyId = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare('INSERT INTO publish_history (id, slot_id, variant_id, platform, result, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(historyId, id, variant.id, variant.platform, result.success ? 'success' : 'failure', result.externalRef || result.error, createdAt);

  if (result.success) {
    db.prepare('UPDATE schedule_slots SET status = ?, published_at = ? WHERE id = ?')
      .run('published', createdAt, id);
    db.prepare('UPDATE variants SET status = ? WHERE id = ?').run('published', variant.id);
  } else {
    db.prepare('UPDATE schedule_slots SET status = ? WHERE id = ?').run('failed', id);
  }

  res.status(result.success ? 201 : 502).json({ slot_id: id, ...result });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});