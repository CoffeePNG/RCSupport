const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
// Exercise persistence with SQLite without requiring the production native addon.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE rcsupport_forum_settings (singleton INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT); CREATE TABLE rcsupport_posts (discord_post_id TEXT);');
require.cache[require.resolve('../dist/db/connect')] = { exports: { db } };
const { RCSupportForum } = require('../dist/rcsupport/forum');

test('Forum setup preserves tags, persists selection, and rejects another guild', async () => {
  const original = { id: 'existing', name: 'custom', moderated: true, emoji: null };
  let edits = 0, listeners = 0;
  const channel = {
    id: 'forum', guildId: 'guild', type: ChannelType.GuildForum,
    availableTags: [original],
    permissionsFor: () => ({ has: () => true }),
    async setAvailableTags(tags) { edits++; this.availableTags = tags.map((tag, i) => ({ ...tag, id: tag.id || `tag-${i}` })); },
  };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => channel }, on: () => { listeners++; } };
  const config = () => ({ forumChannelId: '', baseUrl: new URL('https://localhost'), token: 'test', pollIntervalMs: 20000, alertModeCacheMs: 60000 });
  const service = new RCSupportForum(config());
  service.poll = async () => {};
  const restored = new RCSupportForum(config());
  restored.poll = async () => {};
  try {
    await service.setup(client, 'guild', 'forum');
    assert.equal(channel.availableTags.length, 6);
    assert.deepEqual(channel.availableTags[0], original);
    await service.setup(client, 'guild', 'forum');
    assert.equal(edits, 1);
    assert.equal(listeners, 2);
    await restored.start(client);
    assert.equal(restored.getForum().id, 'forum');
    await assert.rejects(service.setup(client, 'other-guild', 'forum'), /current Forum/);
  } finally {
    service.stop(); restored.stop(); db.close();
  }
});
