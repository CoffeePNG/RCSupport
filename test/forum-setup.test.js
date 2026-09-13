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
const { BridgeClient } = require('../dist/rcsupport/api');
BridgeClient.prototype.statusUpdates = async () => [];

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


test('startup prepares a blank Forum without duplicating tags on restart', async () => {
  const channel = {
    id: 'forum', guildId: 'guild', type: ChannelType.GuildForum, availableTags: [],
    permissionsFor: () => ({ has: () => true }),
    async setAvailableTags(tags) { this.availableTags = tags.map((tag, i) => ({ ...tag, id: String(i) })); },
  };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => channel }, on() {} };
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost'), pollIntervalMs: 20000 });
  service.poll = async () => {};
  try {
    await service.start(client);
    assert.deepEqual(channel.availableTags.map(t => t.name), ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Won’t Fix']);
    await service.start(client);
    assert.equal(channel.availableTags.length, 5);
  } finally { service.stop(); }
});

test('a failed report does not block later reports and retries without duplicating successful posts', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  let fail = true;
  const posted = [];
  service.forum = { id: 'forum', guildId: 'guild', availableTags: [{ id: 'open', name: 'open' }],
    threads: { async create(options) {
      if (options.name.startsWith('#101 ') && fail) throw Object.assign(new Error('Missing permissions'), { code: 50013 });
      posted.push(options.name);
      return { id: options.name.startsWith('#101 ') ? 'post101' : 'post102' };
    } },
  };
  service.api.tickets = async () => [101, 102].map(id => ({ id, description: 'Details', server_id: 'build1', discord_id: '123' }));
  service.api.configMode = async () => ({ alert_mode: 'broadcast' });
  service.api.setPost = async () => ({});
  await service.poll();
  assert.deepEqual(posted, ['#102 Details']);
  assert.match(service.lastSyncError, /#101.*View Channel/);
  fail = false;
  await service.poll();
  assert.deepEqual(posted, ['#102 Details', '#101 Details']);
  assert.equal(service.lastSyncError, null);
});

test('refresh restores saved wizard fields in the existing starter without changing tags or replies', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  const ticket = { id: 7, title: 'Door broken', category: 'Gameplay', description: 'Expected opening',
    reproduction_steps: '1. Click door', item_attachment: 'Material: STICK; Source plugin: Unknown',
    url_attachment: 'https://example.com/image', reporter_name: 'Builder', discord_id: '123', server_id: 'build1' };
  let edited, name;
  service.api.ticket = async () => ({ ticket, messages: [] });
  service.forum = { id: 'forum', guildId: 'guild', threads: { fetch: async postId => {
    assert.equal(postId, 'new-post');
    return { parentId: 'forum', fetchStarterMessage: async () => ({ editable: true, edit: async payload => { edited = payload; } }),
      setName: async value => { name = value; } };
  } } };
  assert.equal(await service.refreshReport('guild', 7), 'new-post');
  assert.equal(name, '#7 Door broken');
  const fields = edited.embeds[0].toJSON().fields;
  assert.equal(fields.find(f => f.name === 'Category').value, 'Gameplay');
  assert.equal(fields.find(f => f.name === 'Reproduction steps').value, '1. Click door');
  assert.equal(fields.find(f => f.name === 'Attached item').value, ticket.item_attachment);
  assert.equal(fields.find(f => f.name === 'Screenshot / video link').value, ticket.url_attachment);
  assert.deepEqual(edited.allowedMentions, { parse: [] });
  assert.equal(edited.content, undefined);
  await assert.rejects(service.refreshReport('wrong-guild', 7), /containing the bug Forum/);
});


test('setup assigns a replacement Forum after deletion even when old reports exist', async () => {
  const channel = { id: 'replacement', guildId: 'guild', type: ChannelType.GuildForum, availableTags: [],
    permissionsFor: () => ({ has: () => true }),
    async setAvailableTags(tags) { this.availableTags = tags.map((tag, i) => ({ ...tag, id: String(i) })); },
  };
  const client = { user: { id: 'bot' }, channels: { fetch: async id => {
    if (id === 'deleted') throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
    return channel;
  } }, on() {} };
  db.prepare('UPDATE rcsupport_forum_settings SET channel_id = ? WHERE singleton = 1').run('deleted');
  const countBefore = db.prepare('SELECT COUNT(*) AS total FROM rcsupport_posts').get().total;
  assert.ok(countBefore > 0);
  const service = new RCSupportForum({ forumChannelId: 'deleted', baseUrl: new URL('https://localhost'), pollIntervalMs: 20000 });
  service.poll = async () => {};
  try {
    await service.setup(client, 'guild', 'replacement');
    assert.equal(service.getForum().id, 'replacement');
    assert.equal(db.prepare('SELECT channel_id FROM rcsupport_forum_settings WHERE singleton = 1').get().channel_id, 'replacement');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM rcsupport_posts').get().total, countBefore);
    assert.equal(channel.availableTags.length, 5);
    await service.setup(client, 'guild', 'replacement');
    assert.equal(channel.availableTags.length, 5);
  } finally { service.stop(); }
});


test('closed status updates retry failed/deleted posts without blocking others or losing custom tags', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  const statuses = ['Open','Acknowledged','In Progress','Resolved','Won’t Fix'];
  const pending = [301,302].map(id => ({ revision: 1, ticket: { id, status: 'resolved', discord_post_id: `mapped${id}`, discord_id: '123' } }));
  const acks = [], edits = [];
  let unavailable = true;
  const threads = new Map(pending.map(({ticket}) => [ticket.discord_post_id, {
    id: ticket.discord_post_id, parentId: 'forum', appliedTags: ['custom','s0'],
    async setAppliedTags(tags) { edits.push([this.id, tags]); this.appliedTags = tags; },
  }]));
  service.forum = { id: 'forum', availableTags: statuses.map((name,i) => ({id:`s${i}`,name})),
    threads: { fetch: async id => { if (id === 'mapped301' && unavailable) throw new Error('Deleted post'); return threads.get(id); } },
  };
  service.api.tickets = async () => [];
  service.api.statusUpdates = async () => pending.filter(u => !acks.includes(u.ticket.id));
  service.api.ticket = async id => ({ ticket: pending.find(u => u.ticket.id === id).ticket, revision: 1 });
  service.api.acknowledgeStatus = async (id, revision) => { assert.equal(revision, 1); acks.push(id); return { acknowledged: true }; };
  await service.poll(); assert.deepEqual(acks, [302]); assert.match(service.lastSyncError, /#301/);
  assert.deepEqual(edits, [['mapped302', ['custom','s3']]]);
  unavailable = false;
  await service.poll(); assert.deepEqual(acks, [302,301]); assert.equal(service.lastSyncError, null);
  await service.poll(); assert.equal(edits.length, 2);
});

test('a failed acknowledgement retries without another tag edit', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  const ticket = { id: 303, discord_id: '123', status: 'resolved', discord_post_id: 'mapped303' };
  let edits = 0, acknowledgements = 0;
  const thread = { parentId: 'forum', appliedTags: ['s0'], async setAppliedTags(tags) { edits++; this.appliedTags = tags; } };
  service.forum = { id: 'forum', availableTags: [{id:'s0',name:'Open'},{id:'s3',name:'Resolved'}], threads: {fetch:async () => thread} };
  service.api.ticket = async () => ({ticket, revision: 2});
  service.api.acknowledgeStatus = async () => { if (++acknowledgements === 1) throw new Error('Network interrupted'); return {acknowledged:true}; };
  await assert.rejects(service.syncStatusUpdate({ticket, revision:2}), /Network/);
  await service.syncStatusUpdate({ticket, revision:2});
  assert.equal(edits, 1); assert.equal(acknowledgements, 2);
});

test('Discord status changes use revision checks and ignore delayed bot echoes', async () => {
  db.prepare('INSERT INTO rcsupport_posts VALUES (?, ?, ?, 1)').run('mapped304',304,'reporter');
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  service.forum = {id:'forum', availableTags: ['Open','Acknowledged','In Progress','Resolved','Won’t Fix'].map((name,i) => ({id:`s${i}`,name}))};
  let statusCalls = [], polls = 0;
  service.api.ticket = async () => ({ticket:{id:304,status:'open'},revision:7});
  service.api.status = async (...args) => {statusCalls.push(args);};
  service.poll = async () => { polls++; };
  const oldThread = {id:'mapped304',parentId:'forum',appliedTags:['s0']};
  const updated = {...oldThread,appliedTags:['s3']};
  service.ownTagUpdates.set(service.tagSignature(updated.id,updated.appliedTags),Date.now()+300000);
  await service.onThreadUpdate(oldThread,updated); assert.equal(statusCalls.length,0);
  await service.onThreadUpdate(oldThread,updated); assert.deepEqual(statusCalls,[[304,'resolved',undefined,7]]);
  service.api.ticket = async () => ({ticket:{id:304,status:'in_progress'},revision:8});
  await service.onThreadUpdate(oldThread,updated); assert.equal(statusCalls.length,1); assert.equal(polls,1);
});

test('a mapped post in a replaced Forum is preserved and is not acknowledged as synchronized', async () => {
  const service = new RCSupportForum({forumChannelId:'replacement',baseUrl:new URL('https://localhost')});
  const ticket = {id:305,discord_id:'123',status:'resolved',discord_post_id:'old-post'};
  service.api.ticket = async () => ({ticket,revision:1});
  service.api.acknowledgeStatus = async () => { throw new Error('must not acknowledge'); };
  service.forum = {id:'replacement',threads:{fetch:async () => ({parentId:'old-forum'})}};
  await assert.rejects(service.syncStatusUpdate({ticket,revision:1}), /earlier Forum/);
});


test('batched recovery advances past failures in the first page', async () => {
  const service = new RCSupportForum({forumChannelId:'forum',baseUrl:new URL('https://localhost')});
  service.forum = {id:'forum'};
  const cursors = [], attempted = [];
  service.api.statusUpdates = async after => { cursors.push(after); return Array.from({length:after===0?50:2},(_,i)=>({ticket:{id:after+i+1},revision:1})); };
  service.api.tickets = async () => [];
  service.syncStatusUpdate = async u => { attempted.push(u.ticket.id); if(u.ticket.id===1) throw new Error('Missing post'); };
  await service.poll(); assert.deepEqual(cursors,[0,50]); assert.equal(attempted.length,52); assert.equal(attempted.at(-1),52);
});
