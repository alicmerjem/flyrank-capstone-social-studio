const { randomUUID } = require('crypto');

// ---------- SocialPublisher interface ----------
// Every publisher implements: async publish(content) -> { success, externalRef?, error? }

class DiscordPublisher {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  async publish(content) {
    if (!this.webhookUrl) {
      return { success: false, error: 'DISCORD_WEBHOOK_URL not configured' };
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Discord returned ${res.status}: ${text}` };
      }

      return { success: true, externalRef: `discord-webhook-${Date.now()}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

function makeMockPublisher(platformName) {
  return {
    async publish(content) {
      const ref = `mock-${platformName}-${randomUUID()}`;
      return { success: true, externalRef: ref };
    }
  };
}

function getPublisher(platform) {
  if (platform === 'discord') {
    return new DiscordPublisher(process.env.DISCORD_WEBHOOK_URL);
  }
  return makeMockPublisher(platform);
}

module.exports = { DiscordPublisher, getPublisher };