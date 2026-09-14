const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
// Exercise persistence with SQLite without requiring the production native addon.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE rcsupport_forum_settings (singleton INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT);
CREATE TABLE rcsupport_posts (discord_post_id TEXT PRIMARY KEY, plugin_ticket_id INTEGER UNIQUE, reporter_discord_id TEXT, api_acknowledged INTEGER DEFAULT 0);
CREATE TABLE rcsupport_poll_state (singleton INTEGER PRIMARY KEY, last_poll_timestamp INTEGER);
INSERT INTO rcsupport_poll_state VALUES (1, 9999999999);
CREATE TABLE IF NOT EXISTS rcsupport_history_sync (
  post_id TEXT PRIMARY KEY, last_seen TEXT NOT NULL DEFAULT '0', before_id TEXT, sweep_high TEXT, checked_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rcsupport_closure_notices (
  event_key TEXT PRIMARY KEY, post_id TEXT NOT NULL, actor TEXT NOT NULL, closed_at INTEGER NOT NULL,
  message_id TEXT, attempted_at INTEGER
);
CREATE TABLE IF NOT EXISTS rcsupport_deleted_threads (post_id TEXT PRIMARY KEY, deleted_by TEXT NOT NULL, deleted_at INTEGER NOT NULL);
`);
after(() => db.close());
require.cache[require.resolve('../dist/db/connect')] = { exports: { db } };
require.cache[require.resolve('../dist/features/bugReports/events')] = { exports: { subscribeReports: () => () => {} } };
const { RCSupportForum } = require('../dist/features/bugReports/forum');
const { BridgeClient } = require('../dist/features/bugReports/api');
const realReconcileHistories = RCSupportForum.prototype.reconcileHistories;
RCSupportForum.prototype.reconcileHistories = async () => {}; // Legacy status tests isolate history I/O.
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
    assert.equal(channel.availableTags.length, 7);
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
    assert.deepEqual(channel.availableTags.map(t => t.name), ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Won’t Fix', 'Closed']);
    await service.start(client);
    assert.equal(channel.availableTags.length, 6);
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
    assert.equal(channel.availableTags.length, 6);
    await service.setup(client, 'guild', 'replacement');
    assert.equal(channel.availableTags.length, 6);
  } finally { service.stop(); }
});


test('closed status updates retry failed/deleted posts without blocking others or losing custom tags', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  const statuses = ['Open','Acknowledged','In Progress','Resolved','Won’t Fix','Closed'];
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
  assert.deepEqual(edits, [['mapped302', ['custom','s3','s5']]]);
  unavailable = false;
  await service.poll(); assert.deepEqual(acks, [302,301]); assert.equal(service.lastSyncError, null);
  await service.poll(); assert.equal(edits.length, 2);
});

test('a failed acknowledgement retries without another tag edit', async () => {
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  const ticket = { id: 303, discord_id: '123', status: 'resolved', discord_post_id: 'mapped303' };
  let edits = 0, acknowledgements = 0;
  const thread = { parentId: 'forum', appliedTags: ['s0'], async setAppliedTags(tags) { edits++; this.appliedTags = tags; } };
  service.forum = { id: 'forum', availableTags: [{id:'s0',name:'Open'},{id:'s3',name:'Resolved'},{id:'s5',name:'Closed'}], threads: {fetch:async () => thread} };
  service.api.ticket = async () => ({ticket, revision: 2});
  service.api.acknowledgeStatus = async () => { if (++acknowledgements === 1) throw new Error('Network interrupted'); return {acknowledged:true}; };
  await assert.rejects(service.syncStatusUpdate({ticket, revision:2}), /Network/);
  await service.syncStatusUpdate({ticket, revision:2});
  assert.equal(edits, 1); assert.equal(acknowledgements, 2);
});

test('Discord status changes use revision checks and ignore delayed bot echoes', async () => {
  db.prepare('INSERT INTO rcsupport_posts VALUES (?, ?, ?, 1)').run('mapped304',304,'reporter');
  const service = new RCSupportForum({ forumChannelId: 'forum', baseUrl: new URL('https://localhost') });
  service.forum = {id:'forum', availableTags: ['Open','Acknowledged','In Progress','Resolved','Won’t Fix','Closed'].map((name,i) => ({id:`s${i}`,name}))};
  let statusCalls = [], polls = 0;
  service.closingActor = async () => ({name:'Developer',time:123,key:'audit'});
  service.api.ticket = async () => ({ticket:{id:304,status:'open'},revision:7});
  service.api.status = async (...args) => {statusCalls.push(args);};
  service.poll = async () => { polls++; };
  const oldThread = {id:'mapped304',parentId:'forum',appliedTags:['s0']};
  const updated = {...oldThread,appliedTags:['s3']};
  service.ownTagUpdates.set(service.tagSignature(updated.id,updated.appliedTags),Date.now()+300000);
  await service.onThreadUpdate(oldThread,updated); assert.equal(statusCalls.length,0);
  await service.onThreadUpdate(oldThread,updated); assert.deepEqual(statusCalls,[[304,'resolved','Developer',7]]);
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

const { Collection, PermissionFlagsBits, ButtonStyle } = require('discord.js');
const repo = require('../dist/features/bugReports/repo');
const { closureContent, deliverClosure } = require('../dist/features/bugReports/closureNotice');
const { confirmThreadDeletion } = require('../dist/features/bugReports/deleteThread');
const completeTags = ['Open','Acknowledged','In Progress','Resolved','Won’t Fix','Closed'].map((name,i)=>({id:`s${i}`,name}));
function closureThread(id) {
  const messages = new Collection();
  return { id, parentId:'forum', appliedTags:['s0'], client:{user:{id:'bot'}},
    messages:{fetch:async()=>messages}, sent:0,
    async setAppliedTags(tags) {this.appliedTags=tags;},
    async send(payload) { this.sent++; assert.deepEqual(payload.allowedMentions,{parse:[]}); assert.equal(payload.enforceNonce,true);
      const message={id:String(10000000000000000n+BigInt(this.sent)),author:{id:'bot'},content:payload.content,createdTimestamp:Date.now()};
      messages.set(message.id,message); return message; }
  };
}
test('closure notices strip UUIDs, escape names and preserve timestamp formats', () => {
  assert.equal(closureContent('Builder (550e8400-e29b-41d4-a716-446655440000)',1234),'This report has been closed by **Builder** - <t:1234:T> · <t:1234:d>');
  assert.match(closureContent('bad**name\nnext',1234),/bad\\\*\\\*name next/);
});
test('closure delivery recovers an uncertain send and ignores stale notice snapshots', async () => {
  const thread=closureThread('uncertain');
  const notice=repo.queueClosure('test-uncertain',thread.id,'Builder',1234);
  const send=thread.send.bind(thread);
  thread.send=async payload=>{await send(payload);throw new Error('Response lost');};
  await assert.rejects(deliverClosure(thread,notice),/Response lost/);
  thread.send=send;
  await deliverClosure(thread,notice);
  await deliverClosure(thread,notice);
  assert.equal(thread.sent,1); assert.ok(repo.closureNotice(notice.event_key).message_id);
});
test('plugin closure announcements are delivered once across failed acknowledgements', async () => {
  const service=new RCSupportForum({forumChannelId:'forum',baseUrl:new URL('https://localhost')});
  const thread=closureThread('mapped401');
  const ticket={id:401,status:'resolved',discord_id:'reporter',discord_post_id:thread.id};
  const update={ticket,revision:2,closures:[{id:1,revision:2,actor:'Builder',closed_at:1234}]};
  service.forum={id:'forum',availableTags:completeTags,threads:{fetch:async()=>thread}};
  service.api.ticket=async()=>({ticket,revision:2});
  let acks=0; service.api.acknowledgeStatus=async()=>{if(++acks===1)throw new Error('Ack lost');return {acknowledged:true};};
  await assert.rejects(service.syncStatusUpdate(update),/Ack lost/);
  await service.syncStatusUpdate(update);
  assert.deepEqual(thread.appliedTags,['s3','s5']);assert.equal(thread.sent,1);assert.equal(acks,2);
});
test('native closure retries its label and message, and reopening removes Closed', async () => {
  const service=new RCSupportForum({forumChannelId:'forum',baseUrl:new URL('https://localhost')});
  const thread=closureThread('native501');repo.storeNativePost(thread.id);
  service.forum={id:'forum',availableTags:completeTags,threads:{fetch:async()=>thread}};
  service.api.tickets=async()=>[];service.api.statusUpdates=async()=>[];
  service.closingActor=async()=>({name:'Developer',time:1234,key:'audit501'});
  const old={...thread,appliedTags:['s0']};thread.appliedTags=['s3'];
  const set=thread.setAppliedTags.bind(thread);thread.setAppliedTags=async()=>{throw new Error('Transient tag failure');};
  await assert.rejects(service.onThreadUpdate(old,thread),/Transient/);assert.equal(thread.sent,0);
  thread.setAppliedTags=set;await service.poll();
  assert.deepEqual(thread.appliedTags,['s3','s5']);assert.equal(thread.sent,1);
  const closed={...thread,appliedTags:[...thread.appliedTags]};thread.appliedTags=['s0','s5'];
  await service.onThreadUpdate(closed,thread);assert.deepEqual(thread.appliedTags,['s0']);assert.equal(thread.sent,1);
});
test('Discord closure actor requires a unique matching audit entry', async () => {
  const service=new RCSupportForum({baseUrl:new URL('https://localhost')});
  const entry={id:'audit',target:{id:'thread'},executor:{username:'Nick'},createdTimestamp:Date.now(),changes:[{key:'applied_tags',new:['s3']}]};
  const thread={id:'thread',guild:{fetchAuditLogs:async()=>({entries:new Collection([['audit',entry]])})}};
  assert.equal((await service.closingActor(thread,['s3'])).name,'Nick');
  assert.equal((await service.closingActor(thread,['s0'])).name,'Unknown staff member');
});
test('deletion checks both permissions and the exact tracked Forum, preserving mapping and suppressing recreation', async () => {
  const service=new RCSupportForum({forumChannelId:'forum',baseUrl:new URL('https://localhost')});
  const thread=closureThread('delete601');let deleted=false;
  const rights=new Set([PermissionFlagsBits.ManageGuild,PermissionFlagsBits.ManageThreads]);
  thread.permissionsFor=()=>({has:()=>true});thread.delete=async()=>{deleted=true;};
  repo.storePluginPost(601,thread.id,'reporter');repo.acknowledge(thread.id);
  service.forum={id:'forum',guildId:'guild',guild:{members:{fetch:async()=>({permissions:{has:p=>rights.has(p)}})}},threads:{fetch:async()=>deleted?null:thread}};
  await assert.rejects(service.deletionTarget('other',thread.id,'admin'),/configured/);
  rights.delete(PermissionFlagsBits.ManageThreads);
  await assert.rejects(service.deleteReportThread('guild',thread.id,'admin'),/Manage Server and Manage Threads/);assert.equal(deleted,false);
  rights.add(PermissionFlagsBits.ManageThreads);thread.parentId='unrelated';
  await assert.rejects(service.deleteReportThread('guild',thread.id,'admin'),/tracked/);thread.parentId='forum';
  repo.queueClosure('delete-pending',thread.id,'Nick',1234);
  await service.deleteReportThread('guild',thread.id,'admin');
  assert.equal(deleted,true);assert.ok(repo.threadDeleted(thread.id));assert.ok(repo.byPluginTicket(601));
  assert.equal(repo.closureNotice('delete-pending').message_id,'thread-deleted');
  service.api.acknowledgeStatus=async()=>({acknowledged:true});
  await service.syncStatusUpdate({ticket:{id:601,discord_post_id:thread.id},revision:3});
  await assert.rejects(service.deleteReportThread('guild',thread.id,'admin'),/tracked/);
});
for(const choice of ['confirm','cancel','timeout']) test(`thread deletion confirmation: ${choice}`,async()=>{
  let deletes=0,updates=[];
  const interaction={id:'interaction',guildId:'guild',channelId:'123456789012345678',user:{id:'admin'},options:{getString:()=>null},
    deferReply:async()=>{},editReply:async payload=>{updates.push(payload);return {awaitMessageComponent:async options=>{
      assert.equal(options.filter({user:{id:'other'},customId:'rcsupport:delete:interaction'}),false);
      assert.equal(options.filter({user:{id:'admin'},customId:'unrelated'}),false);
      if(choice==='timeout')throw new Error('Timeout');
      return {customId:choice==='confirm'?'rcsupport:delete:interaction':'rcsupport:keep:interaction',update:async p=>updates.push(p)};
    }};}};
  const forum={deletionTarget:async()=>({name:'Report'}),deleteReportThread:async(guild,id,user)=>{assert.equal(guild,'guild');assert.equal(id,interaction.channelId);assert.equal(user,'admin');deletes++;}};
  await confirmThreadDeletion(interaction,forum);
  assert.equal(deletes,choice==='confirm'?1:0);
  assert.equal(updates[0].components[0].toJSON().components[0].style,ButtonStyle.Danger);
  assert.deepEqual(updates.at(-1).components,[]);
});

const { importHistoryMessage, importHistoryPage } = require('../dist/features/bugReports/history');
const snowflake = n => String(100000000000000000n + BigInt(n));
function humanMessage(n, author='staff') {
  return {id:snowflake(n), type:0, author:{id:author,username:author,bot:false}, webhookId:null,
    content:`Message ${n}`, attachments:new Collection(), stickers:new Collection(),createdTimestamp:n*1000};
}
test('history includes reporter and staff text/attachments; only live staff replies notify',async()=>{
  const calls=[];const api={importHistory:async(id,message)=>{calls.push(message);}};
  const mapping={pluginTicketId:701,discordPostId:'history701',reporterDiscordId:'reporter'};
  await importHistoryMessage(api,mapping,humanMessage(1,'reporter'),true);
  await importHistoryMessage(api,mapping,humanMessage(2),true);
  await importHistoryMessage(api,mapping,humanMessage(3),false);
  const attachment=humanMessage(4);attachment.content='';attachment.attachments.set('file',{name:'image.png',url:'https://example.com/image.png'});
  await importHistoryMessage(api,mapping,attachment,false);
  const automated=humanMessage(5);automated.author.bot=true;await importHistoryMessage(api,mapping,automated,true);
  assert.equal(calls.length,4);assert.deepEqual(calls.map(m=>m.notify),[false,true,false,false]);
  assert.equal(calls[0].created_at,1);assert.match(calls[3].body,/image.png.*https:\/\/example.com/);
});
test('history import resumes persisted pages, catches new arrivals and never regresses its cursor',async()=>{
  const mapping={pluginTicketId:702,discordPostId:'history702',reporterDiscordId:'reporter'};
  const all=Array.from({length:205},(_,i)=>humanMessage(i+1));
  const stored=new Map();let calls=0;
  const api={importHistory:async(id,message)=>{calls++;stored.set(message.message_id,message);}};
  const thread={client:{user:{id:'bot'}},permissionsFor:()=>({has:()=>true}),messages:{fetch:async({before})=>new Collection(all.filter(m=>!before||BigInt(m.id)<BigInt(before)).slice(-100).reverse().map(m=>[m.id,m]))}};
  await importHistoryPage(api,mapping,thread);
  assert.equal(stored.size,100);assert.equal(repo.historyCursor(mapping.discordPostId).before_id,snowflake(106));
  all.push(humanMessage(206));
  await importHistoryPage(api,mapping,thread);await importHistoryPage(api,mapping,thread);
  assert.equal(stored.size,205);assert.equal(repo.historyCursor(mapping.discordPostId).last_seen,snowflake(205));
  await importHistoryPage(api,mapping,thread);assert.equal(stored.size,206);assert.equal(calls,206);
  all.splice(0);await importHistoryPage(api,mapping,thread);
  assert.equal(repo.historyCursor(mapping.discordPostId).last_seen,snowflake(206));
  assert.ok([...stored.values()].every(m=>!m.notify));
});
test('failed history imports retry the same page and permission denial leaves cursor unchanged',async()=>{
  const mapping={pluginTicketId:703,discordPostId:'history703',reporterDiscordId:'reporter'};
  const stored=new Map();let fail=true,allowed=true;
  const api={importHistory:async(id,message)=>{stored.set(message.message_id,message);if(fail){fail=false;throw new Error('Response lost');}}};
  const thread={client:{user:{id:'bot'}},permissionsFor:()=>({has:()=>allowed}),messages:{fetch:async()=>new Collection([1,2].map(n=>[snowflake(n),humanMessage(n)]))}};
  await assert.rejects(importHistoryPage(api,mapping,thread),/Response lost/);assert.equal(repo.historyCursor(mapping.discordPostId).last_seen,'0');
  await importHistoryPage(api,mapping,thread);assert.equal(stored.size,2);assert.equal(repo.historyCursor(mapping.discordPostId).last_seen,snowflake(2));
  allowed=false;await assert.rejects(importHistoryPage(api,mapping,thread),/Read Message History/);assert.equal(repo.historyCursor(mapping.discordPostId).last_seen,snowflake(2));
});
test('history reconciliation continues after one thread fails and skips deleted mappings',async()=>{
  const service=new RCSupportForum({forumChannelId:'forum',baseUrl:new URL('https://localhost')});
  const candidates=repo.historyCandidates;
  repo.storePluginPost(704,'history704','reporter');repo.acknowledge('history704');repo.recordThreadDeleted('history704','admin');
  assert.ok(!repo.historyCandidates().some(m=>m.discordPostId==='history704'));
  const good={pluginTicketId:706,discordPostId:'history706',reporterDiscordId:'reporter'};
  repo.historyCandidates=()=>[{...good,discordPostId:'missing705',pluginTicketId:705},good];
  const imported=[];
  service.api.importHistory=async(id,message)=>{imported.push(id);};
  const thread={parentId:'forum',client:{user:{id:'bot'}},permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>new Collection([[snowflake(1),humanMessage(1)]])}};
  service.forum={id:'forum',threads:{fetch:async id=>{if(id==='missing705')throw new Error('Unavailable');return thread;}}};
  try{await realReconcileHistories.call(service);assert.deepEqual(imported,[706]);assert.equal(repo.historyCursor('missing705').last_seen,'0');}
  finally{repo.historyCandidates=candidates;}
});


test('history, deletion and status synchronization share the same per-thread queue', async () => {
  const service = new RCSupportForum({forumChannelId:'forum', baseUrl:new URL('https://localhost')});
  const id = 'queue801';
  repo.storePluginPost(801, id, 'reporter'); repo.acknowledge(id);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const order = [];
  service.api.importHistory = async () => {
    order.push('history'); entered();
    await new Promise(resolve => { release = resolve; });
    throw new Error('retry history later');
  };
  const message = {id:'999801', channelId:id, channel:{isThread:()=>true,parentId:'forum'},
    author:{id:'staff',username:'Staff',bot:false},type:0,content:'Update',
    attachments:new Map(),stickers:new Map(),createdTimestamp:1234000};
  const history = assert.rejects(service.onMessage(message), /retry history later/);
  await started;
  service.deletionTarget = async () => ({delete:async()=>{order.push('delete');}});
  const deletion = service.deleteReportThread('guild',id,'admin');
  service.api.ticket = async () => { throw new Error('deleted thread must not be fetched'); };
  service.api.acknowledgeStatus = async () => {order.push('ack');return {acknowledged:true};};
  const status = service.syncStatusUpdate({ticket:{id:801,discord_post_id:id},revision:1});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order,['history']);
  release();
  await Promise.all([history,deletion,status]);
  assert.deepEqual(order,['history','delete','ack']);
  assert.equal(service.statusWork.size,0);
});
