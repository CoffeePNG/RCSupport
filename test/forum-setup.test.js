const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
// Exercise persistence with SQLite without requiring the production native addon.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE rcsupport_forum_settings (singleton INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT);
CREATE TABLE rcsupport_posts (discord_post_id TEXT PRIMARY KEY, plugin_ticket_id INTEGER UNIQUE, reporter_discord_id TEXT, api_acknowledged INTEGER DEFAULT 0);
CREATE TABLE rcsupport_poll_state (singleton INTEGER PRIMARY KEY, last_poll_timestamp INTEGER);
INSERT INTO rcsupport_poll_state VALUES (1, 9999999999);`);
after(() => db.close());
require.cache[require.resolve('../dist/db/connect')] = { exports: { db } };
require.cache[require.resolve('../dist/rcsupport/events')] = { exports: { subscribeReports: () => () => {} } };
const { RCSupportForum } = require('../dist/rcsupport/forum');

test('notification during a poll queues another reconciliation', async () => {
  const service = new RCSupportForum({ baseUrl: new URL('https://localhost') });
  service.forum = { id: 'forum' };
  let release, calls = 0;
  service.api.tickets = async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    return [];
  };
  const first = service.poll();
  await new Promise(resolve => setImmediate(resolve));
  await service.poll();
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

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
    service.stop(); restored.stop();
  }
});

test('poll handles Gson-omitted fields and a future saved cursor without duplicate posts', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost'),
    token: 'test', pollIntervalMs: 20000, alertModeCacheMs: 60000 });
  let creates = 0, acknowledgements = 0;
  service.forum = {
    id: 'forum', guildId: 'guild', availableTags: [{ id: 'open-tag', name: 'open' }],
    threads: { create: async (options) => {
      assert.equal(options.message.embeds[0].toJSON().fields.find(field => field.name === 'Location').value, 'Not recorded');
      creates++; return { id: 'new-post' };
    } },
  };
  const ticket = { id: 7, description: 'Clock skew report', server_id: 'build1', discord_id: 'reporter',
    world: 'world', updated_at: 100 };
  service.api.tickets = async (since) => {
    assert.equal(since, 0);
    return [ticket];
  };
  service.api.configMode = async () => ({ alert_mode: 'broadcast' });
  service.api.setPost = async (id, post) => {
    assert.equal(id, 7); assert.equal(post, 'new-post'); acknowledgements++; return ticket;
  };
  await service.poll();
  await service.poll();
  assert.equal(creates, 1);
  assert.equal(acknowledgements, 1);
  assert.equal(db.prepare('SELECT api_acknowledged FROM rcsupport_posts WHERE plugin_ticket_id = 7').get().api_acknowledged, 1);
});
