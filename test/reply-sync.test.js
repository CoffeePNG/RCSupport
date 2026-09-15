const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {Collection}=require('discord.js');
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE rcsupport_reply_receipts(reply_id INTEGER,post_id TEXT,attempted_at INTEGER,message_id TEXT,PRIMARY KEY(reply_id,post_id)); CREATE TABLE rcsupport_deleted_threads(post_id TEXT PRIMARY KEY); CREATE TABLE rcsupport_posts(discord_post_id TEXT,plugin_ticket_id INTEGER);");
require.cache[require.resolve('../dist/db/connect')]={exports:{db}};
const {deliverReply,reconcileReplies}=require('../dist/features/bugReports/replySync');
after(()=>db.close());
const reply=id=>({id,ticket_id:id,post_id:'123456789012345678',author:'Admin',body:'literal **text** @everyone',created_at:1});
function thread() {
  const messages=new Collection();let sends=0,payload;
  return {client:{user:{id:'bot'}},parentId:'forum',messages:{fetch:async()=>messages},
    send:async data=>{sends++;payload=data;const m={id:String(223456789012345678n+BigInt(sends)),author:{id:'bot'},embeds:data.embeds,createdTimestamp:Date.now()};messages.set(m.id,m);return m;},
    get sends(){return sends;},get payload(){return payload;}};
}
test('durable receipts prevent duplicate sends and disable mention parsing',async()=>{
  const t=thread(),r=reply(1);const id=await deliverReply(t,r);
  assert.equal(await deliverReply(t,r),id);assert.equal(t.sends,1);
  assert.deepEqual(t.payload.allowedMentions,{parse:[]});assert.equal(t.payload.enforceNonce,true);
  assert.equal(t.payload.embeds[0].author.name,'Admin (Minecraft)');
  assert.ok(t.payload.embeds[0].description.includes('\\*'));
});
test('ambiguous send recovers from Discord history after receipt loss, even after close',async()=>{
  const t=thread(),r=reply(2);const id=await deliverReply(t,r);
  db.prepare('UPDATE rcsupport_reply_receipts SET message_id=NULL WHERE reply_id=?').run(r.id);
  t.archived=true;
  assert.equal(await deliverReply(t,r,false),id);assert.equal(t.sends,1);
});
test('closed and locked threads cannot receive a new reply',async()=>{
  const t=thread();
  assert.equal(await deliverReply(t,reply(3),false),null);
  t.locked=true;await assert.rejects(()=>deliverReply(t,reply(4)),/locked/);assert.equal(t.sends,0);
});
test('reconciliation retries a lost bridge acknowledgment without sending again',async()=>{
  const t=thread(),r=reply(5);let ack=0,errors=0;
  const ctx={api:{outboundReplies:async()=>[r],ticket:async()=>({ticket:{discord_post_id:r.post_id,status:'open'}}),
    acknowledgeReply:async(_r,result)=>{assert.ok(result.message_id);if(++ack===1)throw new Error('ack lost');}},
    serial:async(_id,work)=>work(),getForum:()=>({id:'forum',threads:{fetch:async()=>t}}),reportSyncError:()=>errors++};
  await reconcileReplies(ctx);await reconcileReplies(ctx);
  assert.equal(t.sends,1);assert.equal(ack,2);assert.equal(errors,1);
});
test('unmapped and closed reports fail explicitly without sending',async()=>{
  const t=thread(),r=reply(6),failures=[];
  const ctx={api:{outboundReplies:async()=>[r],ticket:async()=>({ticket:{discord_post_id:'other',status:'open'}}),
    acknowledgeReply:async(_r,result)=>failures.push(result.failure)},
    serial:async(_id,work)=>work(),getForum:()=>({id:'forum',threads:{fetch:async()=>t}}),reportSyncError:(_id,_op,e)=>{throw e;}};
  await reconcileReplies(ctx);assert.deepEqual(failures,['Thread mapping changed']);
  ctx.api.ticket=async()=>({ticket:{discord_post_id:r.post_id,status:'resolved'}});
  await reconcileReplies(ctx);assert.equal(failures[1],'Report closed');assert.equal(t.sends,0);
});
