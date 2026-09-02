// Automated test suite covering the "scary cases":
// blocked variant, refused schedule, duplicate publish, adapter swap, tenant isolation

const BASE_URL = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function req(path, options = {}, tenantId = 'test-tenant') {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      ...(options.headers || {})
    }
  });
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS — ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL — ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Running test suite against', BASE_URL);
  console.log('---');

  let postId, variantId, slotId;

  await check('Post ingestion succeeds', async () => {
    const res = await req('/posts', { method: 'POST', body: JSON.stringify({ source: 'A test post about testing things.' }) });
    assert(res.status === 201, `expected 201, got ${res.status}`);
    const data = await res.json();
    postId = data.id;
    assert(postId, 'no post id returned');
  });

  await check('A rule-breaking variant is blocked (length)', async () => {
    const longText = 'x'.repeat(301);
    const res = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['x'], overrides: { x: longText } })
    });
    const data = await res.json();
    const variant = data.variants[0];
    assert(variant.blocked === true, 'expected variant to be blocked');
    assert(variant.reason.includes('length'), `expected length reason, got: ${variant.reason}`);
  });

  await check('A rule-breaking variant is blocked (tone)', async () => {
    const res = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['linkedin'], overrides: { linkedin: 'Announcing our launch! 🚀 #growth' } })
    });
    const data = await res.json();
    const variant = data.variants[0];
    assert(variant.blocked === true, 'expected variant to be blocked');
    assert(variant.reason.includes('Tone'), `expected tone reason, got: ${variant.reason}`);
  });

  await check('A rule-breaking variant is blocked (ungrounded claim)', async () => {
    const res = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['x'], overrides: { x: 'We grew by 999% this year! #wow' } })
    });
    const data = await res.json();
    const variant = data.variants[0];
    assert(variant.blocked === true, 'expected variant to be blocked');
    assert(variant.reason.includes('Ungrounded'), `expected grounding reason, got: ${variant.reason}`);
  });

  await check('A valid variant is created', async () => {
    const res = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['x'] })
    });
    const data = await res.json();
    const variant = data.variants[0];
    assert(variant.id, 'expected a real variant id');
    variantId = variant.id;
  });

  await check('Scheduling an unapproved variant is refused', async () => {
    const res = await req(`/variants/${variantId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt: '2026-09-05T12:00:00Z' })
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await check('Approving then scheduling succeeds', async () => {
    await req(`/variants/${variantId}/approve`, { method: 'POST' });
    const res = await req(`/variants/${variantId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt: '2026-09-05T12:00:00Z' })
    });
    assert(res.status === 201, `expected 201, got ${res.status}`);
    const data = await res.json();
    slotId = data.slot_id;
    assert(slotId, 'no slot id returned');
  });

  await check('Publishing a slot succeeds', async () => {
    const res = await req(`/slots/${slotId}/publish`, { method: 'POST' });
    assert(res.status === 201, `expected 201, got ${res.status}`);
  });

  await check('Publishing the same slot again does not create a duplicate', async () => {
    const historyBefore = await (await req('/publish-history', { method: 'GET' })).json();
    const countBefore = historyBefore.filter(h => h.slot_id === slotId).length;

    const res = await req(`/slots/${slotId}/publish`, { method: 'POST' });
    const data = await res.json();
    assert(data.status === 'already_published', `expected already_published, got: ${JSON.stringify(data)}`);

    const historyAfter = await (await req('/publish-history', { method: 'GET' })).json();
    const countAfter = historyAfter.filter(h => h.slot_id === slotId).length;
    assert(countAfter === countBefore, `expected history count to stay at ${countBefore}, got ${countAfter}`);
  });

  await check('Adapter swap: same content publishes through two different mock adapters', async () => {
    const genRes = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['x', 'linkedin'], overrides: { x: 'Swap test.', linkedin: 'Swap test.' } })
    });
    const genData = await genRes.json();
    const xVariant = genData.variants.find(v => v.platform === 'x');
    const liVariant = genData.variants.find(v => v.platform === 'linkedin');

    for (const v of [xVariant, liVariant]) {
      await req(`/variants/${v.id}/approve`, { method: 'POST' });
      const schedRes = await req(`/variants/${v.id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: '2026-09-07T12:00:00Z' })
      });
      const schedData = await schedRes.json();
      const pubRes = await req(`/slots/${schedData.slot_id}/publish`, { method: 'POST' });
      const pubData = await pubRes.json();
      assert(pubData.success === true, `expected successful publish, got: ${JSON.stringify(pubData)}`);
    }
  });

  await check('Tenant isolation: another tenant cannot access this post', async () => {
    const res = await req(`/posts/${postId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['x'] })
    }, 'other-tenant');
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  await check('Missing X-Tenant-Id header is rejected', async () => {
    const res = await fetch(`${BASE_URL}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'no tenant header' })
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  console.log('---');
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();