const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AlertModeCache } = require('../dist/rcsupport/api');
const { shouldCreatePost, shouldForwardReply, shouldSyncStatus } = require('../dist/rcsupport/policy');

const plugin = { discordPostId: 'post-1', pluginTicketId: 4, reporterDiscordId: 'reporter', apiAcknowledged: true };
const native = { discordPostId: 'post-2', pluginTicketId: null, reporterDiscordId: null, apiAcknowledged: false };

test('plugin post mapping and API post ID each prevent duplicate creation', () => {
  assert.equal(shouldCreatePost(plugin, null), false);
  assert.equal(shouldCreatePost(null, 'post-1'), false);
  assert.equal(shouldCreatePost(null, null), true);
  assert.equal(shouldCreatePost(null, undefined), true);
  assert.equal(shouldCreatePost(plugin, undefined), false);
});
test('reporter, bot, and Discord-native messages are not forwarded', () => {
  assert.equal(shouldForwardReply(plugin, 'reporter', false), false);
  assert.equal(shouldForwardReply(plugin, 'staff', true), false);
  assert.equal(shouldForwardReply(native, 'staff', false), false);
  assert.equal(shouldForwardReply(plugin, 'staff', false), true);
});
test('only plugin posts trigger status sync', () => {
  assert.equal(shouldSyncStatus(plugin), true);
  assert.equal(shouldSyncStatus(native), false);
  assert.equal(shouldSyncStatus(null), false);
});
test('alert mode cache refreshes after its TTL', async () => {
  let now = 0, calls = 0;
  const cache = new AlertModeCache(async () => { calls++; return calls === 1 ? 'broadcast' : 'leads'; }, 1000, () => now);
  assert.equal(await cache.get(), 'broadcast');
  now = 999; assert.equal(await cache.get(), 'broadcast');
  assert.equal(calls, 1);
  now = 1000; assert.equal(await cache.get(), 'leads');
  assert.equal(calls, 2);
});
