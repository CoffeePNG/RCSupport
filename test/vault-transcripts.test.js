const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { Collection, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { migrateDatabase } = require('../dist/db/migrations');
const db = new DatabaseSync(':memory:');
migrateDatabase(db);
after(() => db.close());
const path = require.resolve('../dist/db/connect');
const previous = require.cache[path];
require.cache[path] = { exports: { db } };
delete require.cache[require.resolve('../dist/features/vault/forum')];
const { vaultForumPost } = require('../dist/features/vault/forum');
if (previous) require.cache[path] = previous; else delete require.cache[path];
let sequence = 0;
function setup() {
  const sent = [], edits = [], creates = [], overwriteEdits = [];
  const sourceId = `${++sequence}`;
  const copied = { id: `copy-${sourceId}`, url: `https://discord.com/channels/g/v/copy-${sourceId}`,
    edit: async value => edits.push(value) };
  const target = { id: 'vault', name: 'vaulted-threads', parentId: 'category', type: ChannelType.GuildText,
    permissionOverwrites: { set: async value => overwriteEdits.push(value) },
    messages: { fetch: async () => copied },
    send: async value => { sent.push(value); return copied; } };
  const parent = { id: 'forum', name: 'support', type: ChannelType.GuildForum, parentId: 'public' };
  const channels = new Collection([['forum',parent]]);
  const guild = { id: 'guild', channels: {
    fetch: async id => id ? channels.get(id) : channels,
    create: async options => { creates.push(options); channels.set('vault', target); return target; },
  } };
  const message = id => ({ id: String(id), createdTimestamp: id, createdAt: new Date(id),
    author: { id: 'author', tag: 'Member' }, content: `message ${id}`, embeds: [],
    attachments: new Collection(), stickers: new Collection() });
  const messages = Array.from({length: 101}, (_, i) => message(i + 1));
  messages[0].attachments.set('file', { id: 'file', name: 'evidence.png', url: 'https://cdn.discordapp.com/attachments/test.png' });
  const source = { id: sourceId, name: 'Help with @everyone', url: `https://discord.com/channels/g/forum/${sourceId}`,
    parentId: 'forum', guild, locked: false, archived: false,
    edit: async options => { edits.push(options); },
    messages: { fetch: async options => new Collection(messages.filter(m => !options.before || BigInt(m.id) < BigInt(options.before))
      .reverse().slice(0,100).map(m => [m.id,m])) },
  };
  return { source, channels, target, sent, edits, creates, overwriteEdits };
}

test('creates one private transcript channel, paginates in order, copies attachments, and reuses saved transcript', async () => {
  const f = setup();
  const url = await vaultForumPost(f.source, 'category');
  assert.match(url, /copy-/);
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].type, ChannelType.GuildText);
  assert.equal(f.creates[0].name, 'vaulted-threads');
  assert.deepEqual(f.creates[0].permissionOverwrites[0].deny, [P.ViewChannel]);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [] });
  const json = JSON.parse(f.sent[0].files[1].attachment.toString());
  assert.equal(json.length, 101);
  assert.equal(json[0].id, '1');
  assert.equal(json[100].id, '101');
  assert.equal(json[0].author, 'Member');
  assert.equal(f.sent[1].files[0].name, 'evidence.png');
  assert.equal(await vaultForumPost(f.source, 'category'), url);
  assert.equal(f.sent.length, 2);
  assert.equal(f.creates.length, 1);
  assert.equal(f.overwriteEdits.length, 1);
});

test('reuses matching channel in vault and replaces public overwrites', async () => {
  const f = setup();
  f.channels.set('vault', f.target);
  await vaultForumPost(f.source, 'category');
  assert.equal(f.creates.length, 0);
  assert.deepEqual(f.overwriteEdits[0][0].deny, [P.ViewChannel]);
});

test('attachment failure restores source state, marks partial entry, and does not save success', async () => {
  const f = setup();
  const send = f.target.send;
  f.target.send = async options => {
    if (f.sent.length) throw Error('upload too large');
    return send(options);
  };
  await assert.rejects(vaultForumPost(f.source, 'category'), /upload too large/);
  assert(f.edits.some(e => e.content?.startsWith('INCOMPLETE')));
  assert.equal(f.edits.at(-1).locked, false);
  assert.equal(f.edits.at(-1).archived, false);
  assert.equal(db.prepare('SELECT * FROM vault_thread_transcripts WHERE source_id = ?').get(f.source.id), undefined);
});

test('rejects non-forum threads before creating or changing channels', async () => {
  const f = setup();
  f.channels.get('forum').type = ChannelType.GuildText;
  await assert.rejects(vaultForumPost(f.source, 'category'), /Only posts inside a forum/);
  assert.equal(f.creates.length, 0);
  assert.equal(f.edits.length, 0);
});
