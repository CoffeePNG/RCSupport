const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ChannelType, MessageFlags } = require('discord.js');
const { migrateDatabase } = require('../dist/db/migrations');
const { ServerStatusPanel, statusEmbed, validateSnapshot } = require('../dist/features/serverStatus/panel');
const { serversCommand, serverStatusCommand } = require('../dist/features/serverStatus/command');
const snapshot = () => ({ checked_at: Math.floor(Date.now()/1000), servers: [
  {id:'survival',name:'Survival',online:true}, {id:'build',name:'Build',online:false},
] });
function fixture() {
  const db = new Database(':memory:'); migrateDatabase(db);
  const calls = {sent:[], edits:[], api:0};
  let deleted = false, failed = false;
  const message = {id:'message',author:{id:'bot'},edit:async payload => {calls.edits.push(payload); return message;}};
  const channel = {id:'channel',guildId:'guild',type:ChannelType.GuildText,
    messages:{fetch:async () => {if(deleted) throw Object.assign(new Error('gone'),{code:10008}); return message;}},
    send:async payload => { calls.sent.push(payload); deleted=false; return message; }};
  const client = {user:{id:'bot'},channels:{fetch:async () => channel}};
  const api = {serverStatus:async () => {calls.api++; if(failed) throw Error('API unavailable'); return snapshot();}};
  return {db,calls,channel,client,api,panel:new ServerStatusPanel(client,api,db),
    deleteMessage:() => {deleted=true;},failApi:() => {failed=true;}};
}
test('renders exact online/offline wording and rejects malformed or stale status', () => {
  const embed = statusEmbed(validateSnapshot(snapshot())).toJSON();
  assert.match(embed.description, /\[Survival\]\*\* - Online ✅/);
  assert.match(embed.description, /\[Build\]\*\* - Offline ❌/);
  assert.doesNotMatch(statusEmbed(null).toJSON().description, /Offline/);
  assert.throws(() => validateSnapshot({...snapshot(),checked_at:1}), /stale/);
  assert.throws(() => validateSnapshot({...snapshot(),servers:[{id:'x',name:'x'}]}), /Invalid/);
  assert.throws(() => validateSnapshot({...snapshot(),servers:Array(26).fill(snapshot().servers[0])}), /Invalid/);
  assert.match(statusEmbed({...snapshot(),servers:[]}).toJSON().description, /No servers configured/);
});
test('persists one panel across restart, honours interval, and updates instead of reposting', async () => {
  const f=fixture();
  try {
    await f.panel.setup('guild','channel');
    assert.equal(f.calls.sent.length,1);
    await f.panel.tick(); assert.equal(f.calls.api,1);
    const restarted=new ServerStatusPanel(f.client,f.api,f.db);
    await restarted.tick(true);
    assert.equal(f.calls.sent.length,1); assert.equal(f.calls.edits.length,1);
    f.db.prepare('UPDATE server_status_panels SET updated_at=0').run();
    await restarted.tick(); assert.equal(f.calls.edits.length,2);
    assert.equal(f.db.prepare('SELECT interval_minutes FROM server_status_panels').get().interval_minutes,120);
  } finally { f.db.close(); }
});
test('deleting the Discord panel stops monitoring and never recreates it automatically', async () => {
  const f=fixture();
  try {
    await f.panel.setup('guild','channel'); f.deleteMessage();
    await f.panel.tick(true); await f.panel.tick(true);
    assert.equal(f.calls.sent.length,1); assert.equal(f.calls.api,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM server_status_panels').get().n,0);
    await f.panel.setup('guild','channel'); assert.equal(f.calls.sent.length,2);
  } finally {f.db.close();}
});
test('bridge outages replace stale green statuses with an unavailable notice', async () => {
  const f=fixture();
  try {
    await f.panel.setup('guild','channel'); f.failApi(); await f.panel.refresh('guild');
    const description=f.calls.edits.at(-1).embeds[0].toJSON().description;
    assert.match(description,/unavailable/); assert.doesNotMatch(description,/Online|Offline/);
  } finally { f.db.close(); }
});
test('Discord permission failures retain saved panel and never cause duplicate posts', async () => {
  const f=fixture();
  try {
    await f.panel.setup('guild','channel');
    f.channel.messages.fetch=async () => {throw Object.assign(Error('Forbidden'),{code:50013});};
    await assert.rejects(f.panel.refresh('guild'),/Forbidden/);
    assert.equal(f.calls.sent.length,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM server_status_panels').get().n,1);
  } finally { f.db.close(); }
});
test('/servers is ephemeral, independent of a saved panel, and has no admin restriction', async () => {
  let deferred, response;
  const interaction={guildId:'guild',options:{getString:()=>null},deferReply:async x=>{deferred=x;},editReply:async x=>{response=x;}};
  await serversCommand.execute(interaction,{api:{serverStatus:async()=>snapshot()}});
  assert.equal(deferred.flags,MessageFlags.Ephemeral);
  assert.match(response.embeds[0].toJSON().description,/Online ✅/);
  assert.equal(serversCommand.data.toJSON().default_member_permissions,undefined);
  assert.deepEqual(serverStatusCommand.data.toJSON().options.map(x=>x.name),['setup','refresh']);
  await serversCommand.execute(interaction,{api:{serverStatus:async()=>{throw Error('unreachable');}}});
  assert.match(response.embeds[0].toJSON().description,/unavailable/);
});
test('simultaneous updates are serialized and invalid intervals are rejected', async () => {
  const f=fixture();
  try {
    const pending=f.panel.setup('guild','channel');
    await assert.rejects(f.panel.setup('guild','channel'),/already running/); await pending;
    await assert.rejects(f.panel.setup('guild','channel',0),/Interval/);
    assert.equal(f.calls.sent.length,1);
  } finally {f.db.close();}
});
test('maximum configured names fit Discord embed limits without dropping servers', () => {
  const data={...snapshot(),servers:Array.from({length:25},(_,i)=>({id:String(i),name:'*'.repeat(80),online:false}))};
  const embed=statusEmbed(validateSnapshot(data));
  const json=embed.toJSON();
  assert.ok(embed.length<=6000);
  if(json.description) assert.ok(json.description.length<=4096);
  else {assert.equal(json.fields.length,25); assert.ok(json.fields.every(f=>f.name.length<=256));}
});
test('panel deleted during a probe is forgotten without recreating it', async () => {
  const f=fixture();
  try {
    await f.panel.setup('guild','channel');
    const original=f.channel.messages.fetch;
    f.channel.messages.fetch=async (...args)=>({...await original(...args),edit:async()=>{throw Object.assign(Error('deleted during check'),{code:10008});}});
    await f.panel.refresh('guild');
    assert.equal(f.calls.sent.length,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM server_status_panels').get().n,0);
  } finally {f.db.close();}
});
test('proxy appears first separated from backends in configured order without mutating the response', () => {
  const data=snapshot();
  data.servers.splice(1,0,{id:'proxy',name:'Proxy',online:true});
  const before=JSON.stringify(data);
  assert.equal(statusEmbed(data).toJSON().description,
    '**[Proxy]** - Online ✅\n\n**[Survival]** - Online ✅\n**[Build]** - Offline ❌');
  assert.equal(JSON.stringify(data),before);
  assert.equal(statusEmbed({...data,servers:[{id:'proxy',name:'Proxy',online:false}]}).toJSON().description,
    '**[Proxy]** - Offline ❌');
});
test('setup and refresh require Administrator even when Discord command visibility is overridden', async () => {
  const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
  assert.equal(serverStatusCommand.data.toJSON().default_member_permissions, String(PermissionFlagsBits.Administrator));
  for (const sub of ['setup','refresh']) {
    for (const permissions of [new PermissionsBitField(),new PermissionsBitField(PermissionFlagsBits.ManageGuild),null]) {
      let response;
      await serverStatusCommand.execute({guildId:'guild',memberPermissions:permissions,
        options:{getSubcommand:()=>sub},reply:async value=>{response=value;},
        deferReply:async()=>assert.fail('non-admin must not start the action')});
      assert.match(response.content,/Only server administrators/);
      assert.equal(response.flags,MessageFlags.Ephemeral);
    }
  }
});
test('/servers info selects one configured server and remains ephemeral', async () => {
  let deferred, response, requested;
  const info={checked_at:Math.floor(Date.now()/1000),id:'prod',name:'Production Server',hostname:'republicraft.net',online:true,version:'1.21.8',whitelist:false};
  const interaction={guildId:'guild',options:{getString:()=> 'prod'},deferReply:async value=>{deferred=value;},editReply:async value=>{response=value;}};
  await serversCommand.execute(interaction,{api:{serverInfo:async id=>{requested=id;return info;},serverStatus:async()=>assert.fail('info should select one server')}});
  assert.equal(requested,'prod'); assert.equal(deferred.flags,MessageFlags.Ephemeral);
  const embed=response.embeds[0].toJSON();
  assert.equal(embed.title,'Server Information');
  for(const text of ['Hostname: `republicraft.net`','Status: `ONLINE` ✅','Version: `1.21.8`','Whitelist: `INACTIVE`']) assert.ok(embed.description.includes(text));
  const {informationEmbed,validateInformation}=require('../dist/features/serverStatus/info');
  assert.match(informationEmbed({...info,whitelist:null,version:null,hostname:null}).toJSON().description,/Whitelist: `UNKNOWN`/);
  assert.throws(()=>validateInformation({...info,id:'other'},'prod'),/Invalid/);
  assert.throws(()=>validateInformation({...info,whitelist:'false'},'prod'),/Invalid/);
});
