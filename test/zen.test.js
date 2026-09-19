const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const transpile = stripTypeScriptTypes
  ? source => stripTypeScriptTypes(source, { mode: 'transform' })
  : source => require('typescript').transpile(source, { target: 8, module: 99 });
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');

// Exercise the service without a Discord connection or the incomplete local dependencies.
let source = transpile(readFileSync(join(__dirname, '../src/services/zen.ts'), 'utf8'))
  .replace(/^import .* from "discord.js";$/m, 'const { ChannelType, OverwriteType, PermissionFlagsBits } = mocks;')
  .replace(/^import (.*) from "(node:[^"]+)";$/gm, 'const $1 = require("$2");')
  .replace(/export /g, '');
const names = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];
const context = { require, console, setInterval, mocks: { ChannelType: { GuildText: 0 }, OverwriteType: { Role: 0 }, PermissionFlagsBits: Object.fromEntries(names.map(n => [n,n])) } };
vm.runInNewContext(source + '\nthis.ZenService = ZenService;', context);

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'rcsupport-zen-'));
  const cache = new Map();
  const overwrite = (id, type, allow=[], deny=[]) => ({ id, type, allow: new Set(allow), deny: new Set(deny) });
  cache.set('role', overwrite('role', 0, ['SendMessages']));
  cache.set('member', overwrite('member', 1, ['SendMessages']));
  cache.set('bot', overwrite('bot', 1, ['SendMessages']));
  let failOnce = false;
  const channel = { id: 'channel', guild: { id: 'guild' }, type: 0, fetch: async () => channel,
    permissionOverwrites: { cache, edit: async (id, values) => {
      if (failOnce && id === 'role') { failOnce = false; throw Error('API failure'); }
      const value = cache.get(id) || overwrite(id, 0);
      for (const [key, state] of Object.entries(values)) {
        value.allow.delete(key); value.deny.delete(key);
        if (state === true) value.allow.add(key);
        if (state === false) value.deny.add(key);
      }
      cache.set(id, value);
    } } };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => channel } };
  const path = join(directory, 'zen.json');
  return { cache, channel, client, path, service: new context.ZenService(client, path), fail: () => { failOnce = true; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('zen locks role and member allows, preserves bot access, and restores after restart', async () => {
  const f = setup();
  try {
    await f.service.lock(f.channel, -1);
    assert(f.cache.get('guild').deny.has('SendMessages'));
    assert(f.cache.get('role').deny.has('SendMessages'));
    assert(f.cache.get('member').deny.has('SendMessages'));
    assert(f.cache.get('bot').allow.has('SendMessages'));
    await assert.rejects(f.service.lock(f.channel, 1000), /already/);
    f.cache.get('role').allow.add('UnrelatedPermission');
    await new context.ZenService(f.client, f.path).expire();
    assert(f.cache.get('role').allow.has('SendMessages'));
    assert(f.cache.get('member').allow.has('SendMessages'));
    assert(f.cache.get('role').allow.has('UnrelatedPermission'));
    assert.equal(f.cache.get('guild').deny.size, 0);
    assert.deepEqual(JSON.parse(readFileSync(f.path)), []);
  } finally { f.cleanup(); }
});

test('partial lock failure rolls back changes', async () => {
  const f = setup();
  try {
    f.fail();
    await assert.rejects(f.service.lock(f.channel, 60000), /API failure/);
    assert.equal(f.cache.get('guild').deny.size, 0);
    assert(f.cache.get('role').allow.has('SendMessages'));
    assert.deepEqual(JSON.parse(readFileSync(f.path)), []);
  } finally { f.cleanup(); }
});
