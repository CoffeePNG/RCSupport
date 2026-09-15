const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {Collection,PermissionFlagsBits}=require('discord.js');
const {migrateDatabase}=require('../dist/db/migrations');
const db=new DatabaseSync(':memory:');
const adapter={exec:sql=>db.exec(sql),prepare:sql=>db.prepare(sql),transaction:fn=>()=>{db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
migrateDatabase(adapter);
require.cache[require.resolve('../dist/db/connect')]={exports:{db}};
const controls=require('../dist/features/bugReports/caseControls');
const state=require('../dist/features/bugReports/caseControlRepo');
const repo=require('../dist/features/bugReports/repo');
after(()=>db.close());
let next=100;
function harness(linked=false) {
  const post=String(next++), tags=['open','acknowledged','in_progress','resolved','wontfix'].map(name=>({id:name,name}));
  tags.push({id:'closed',name:'Closed'});
  let allowed=['lead','other'],admins=['admin'], apiCalls=0, lost=false, failTags=false,tail=Promise.resolve();
  const starter={id:post,author:{id:'bot'},editable:true,content:'Reporter: <@reporter>',embeds:[{title:'Original',description:'Keep this'}],components:[],
    async edit(payload){assert.equal(payload.embeds,undefined);this.content=payload.content;this.components=payload.components;this.last=payload;}};
  const sent=new Collection();
  const thread={id:post,parentId:'forum',appliedTags:['open'],client:{user:{id:'bot'}},
    guild:{members:{fetch:async({user})=>({id:user,displayName:user,permissions:{has:flag=>admins.includes(user)}})}},
    permissionsFor:()=>({has:()=>true}),
    fetchStarterMessage:async()=>starter,
    setAppliedTags:async values=>{if(failTags){failTags=false;throw new Error('Discord down');}thread.appliedTags=values;},
    messages:{fetch:async()=>sent},
    send:async payload=>{const m={id:String(900000000000000000n+BigInt(sent.size)),content:payload.content,author:{id:'bot'},createdTimestamp:Date.now()};sent.set(m.id,m);return m;}
  };
  if(linked)repo.storePluginPost(Number(post),post,'reporter');else repo.storeNativePost(post);
  let snapshot={ticket:{id:Number(post),status:'open',discord_post_id:post},revision:0};
  const ctx={api:{ticket:async()=>snapshot,status:async(id,status,actor,revision)=>{
      assert.equal(id,Number(post));assert.equal(revision,snapshot.revision);apiCalls++;
      snapshot={ticket:{...snapshot.ticket,status},revision:snapshot.revision+1};
      if(lost){lost=false;throw new Error('Response lost');}
    }},
    getForum:()=>({id:'forum',guildId:'guild',availableTags:tags,threads:{fetch:async id=>id===post?thread:null}}),
    config:{forumChannelId:'forum'},tag:s=>s,tagSignature:(id,t)=>id+':'+[...t].sort().join(','),
    ownTagUpdates:new Map(),leads:()=>allowed,reportSyncError:()=>{},serial:(id,work)=>{const next=tail.catch(()=>{}).then(work);tail=next;return next;}
  };
  return {post,thread,starter,ctx,sent,get apiCalls(){return apiCalls;},set lost(v){lost=v;},set failTags(v){failTags=v;},
    revoke:()=>allowed=[], external:status=>{snapshot={ticket:{...snapshot.ticket,status},revision:snapshot.revision+1};},
    async reconcile(){// Isolate this report from previous test fixtures.
      for(const id of state.candidates()) if(id!==post)repo.recordThreadDeleted(id,'test');
      await controls.reconcileControls(ctx);
    }};
}
test('buttons change with status and preserve the original embed without pinging',async()=>{
  const h=harness();
  await controls.renderControls(h.ctx,h.thread,'open');
  assert.deepEqual(h.starter.embeds,[{title:'Original',description:'Keep this'}]);
  assert.deepEqual(h.starter.last.allowedMentions,{parse:[]});
  assert.deepEqual(h.starter.components[0].toJSON().components.map(b=>b.label),['Claim','Close']);
  await controls.applyAction(h.ctx,h.post,'lead','claim',0);
  assert.equal(state.get(h.post).claimant,'lead');assert.ok(h.starter.content.includes('<@lead>'));
  assert.deepEqual(h.thread.appliedTags,['in_progress']);
  assert.deepEqual(h.starter.components[0].toJSON().components.map(b=>b.label),['Release','Close']);
});
test('concurrent claims have exactly one winner and survive repeated migrations',async()=>{
  const h=harness();
  const results=await Promise.allSettled(['lead','other'].map(u=>controls.applyAction(h.ctx,h.post,u,'claim',0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(state.get(h.post).claimant,'lead');
  migrateDatabase(adapter);assert.equal(state.get(h.post).claimant,'lead');
});
test('only claimant or admin releases; outsiders cannot operate controls',async()=>{
  const h=harness();
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'outsider','claim',0),/Only bug-report leads/);
  await controls.applyAction(h.ctx,h.post,'lead','claim',0);
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'other','release',1),/Only the claimant/);
  await controls.applyAction(h.ctx,h.post,'admin','release',1);
  assert.equal(state.get(h.post).claimant,null);assert.equal(state.get(h.post).status,'open');
});
test('native close and reopen preserve claims on close, clear on reopen and record one closure',async()=>{
  const h=harness();await controls.applyAction(h.ctx,h.post,'lead','claim',0);
  await controls.applyAction(h.ctx,h.post,'other','resolved',1);
  assert.deepEqual(h.thread.appliedTags,['resolved','closed']);assert.equal(h.sent.size,1);
  assert.deepEqual(h.starter.components[0].toJSON().components.map(b=>b.label),['Reopen']);
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'lead','resolved',1),/changed/);
  await controls.applyAction(h.ctx,h.post,'lead','reopen',2);
  assert.equal(state.get(h.post).claimant,null);assert.deepEqual(h.thread.appliedTags,['open']);
});
test('linked actions use expected revisions and recover a lost response without sending twice',async()=>{
  const h=harness(true);h.lost=true;
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'lead','claim',0),/saved for retry/);
  assert.equal(state.get(h.post).pending_status,'in_progress');
  await h.reconcile();assert.equal(h.apiCalls,1);
  assert.equal(state.get(h.post).claimant,'lead');assert.equal(state.get(h.post).pending_status,null);
});
test('pending action never overwrites a newer Minecraft status',async()=>{
  const h=harness(true);h.ctx.api.status=async()=>{throw new Error('offline');};
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'lead','claim',0),/saved for retry/);
  h.external('resolved');await h.reconcile();
  assert.equal(state.get(h.post).status,'resolved');assert.equal(state.get(h.post).claimant,null);
});
test('native Discord write failure is retried with the saved claimant',async()=>{
  const h=harness();h.failTags=true;
  await assert.rejects(()=>controls.applyAction(h.ctx,h.post,'lead','claim',0),/saved for retry/);
  await h.reconcile();assert.equal(state.get(h.post).claimant,'lead');assert.equal(state.get(h.post).pending_status,null);
});
function interaction(h,action,user='lead',id='confirm-token') {
  return {customId:'rcsupport:case:'+action,id,channelId:h.post,guildId:'guild',user:{id:user},message:{id:h.post},client:{user:{id:'bot'}},
    deferred:false,replied:false,
    async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},
    async editReply(p){this.result=p;},async reply(p){this.result=p;this.replied=true;},async update(p){this.result=p;this.replied=true;}};
}
test('close requires choice and one-shot confirmation bound to the initiating user',async()=>{
  const h=harness(),open=interaction(h,'close:0');await controls.handleControl(h.ctx,open);
  assert.match(open.result.content,/Choose how/);assert.equal(state.get(h.post).status,'open');
  const wrong=interaction(h,'choose_resolved:confirm-token','other');await controls.handleControl(h.ctx,wrong);
  assert.match(wrong.result.content,/expired/);
  const choose=interaction(h,'choose_wontfix:confirm-token');await controls.handleControl(h.ctx,choose);
  assert.match(choose.result.content,/Close this report/);assert.equal(state.get(h.post).status,'open');
  const confirm=interaction(h,'confirm:confirm-token');await controls.handleControl(h.ctx,confirm);
  assert.equal(state.get(h.post).status,'wontfix');
  const replay=interaction(h,'confirm:confirm-token');await controls.handleControl(h.ctx,replay);
  assert.match(replay.result.content,/expired/);assert.equal(h.sent.size,1);
});
test('confirmation rechecks permissions and cancellation changes nothing',async()=>{
  const h=harness();await controls.handleControl(h.ctx,interaction(h,'close:0','lead','revoked'));
  await controls.handleControl(h.ctx,interaction(h,'choose_resolved:revoked'));
  h.revoke();const confirm=interaction(h,'confirm:revoked');await controls.handleControl(h.ctx,confirm);
  assert.match(confirm.result.content,/Only bug-report leads/);assert.equal(state.get(h.post).status,'open');
  const other=harness();await controls.handleControl(other.ctx,interaction(other,'close:0','lead','cancel'));
  await controls.handleControl(other.ctx,interaction(other,'cancel:cancel'));
  assert.equal(state.get(other.post).status,'open');
});
test('forged controls on a different message cannot act',async()=>{
  const h=harness(),i=interaction(h,'claim:0');i.message.id='different';
  await controls.handleControl(h.ctx,i);assert.match(i.result.content,/original report/);
  assert.equal(state.get(h.post),undefined);
});

test('reconciliation attaches controls to existing bot posts and reflects external status',async()=>{
  const h=harness(true);
  assert.equal(h.starter.components.length,0);
  await h.reconcile();
  assert.deepEqual(h.starter.components[0].toJSON().components.map(b=>b.label),['Claim','Close']);
  h.external('resolved');await h.reconcile();
  assert.deepEqual(h.starter.components[0].toJSON().components.map(b=>b.label),['Reopen']);
  assert.deepEqual(h.starter.embeds,[{title:'Original',description:'Keep this'}]);
});
test('expired and stale confirmations cannot close a changed report',async()=>{
  const h=harness();
  await controls.handleControl(h.ctx,interaction(h,'close:0','lead','expires'));
  const now=Date.now;Date.now=()=>now()+61000;
  try {
    const i=interaction(h,'choose_resolved:expires');await controls.handleControl(h.ctx,i);
    assert.match(i.result.content,/expired/);
  } finally {Date.now=now;}
  await controls.handleControl(h.ctx,interaction(h,'close:0','lead','stale'));
  await controls.handleControl(h.ctx,interaction(h,'choose_resolved:stale'));
  await controls.applyAction(h.ctx,h.post,'other','claim',0);
  const i=interaction(h,'confirm:stale');await controls.handleControl(h.ctx,i);
  assert.match(i.result.content,/changed/);assert.equal(state.get(h.post).status,'in_progress');
});
test('new native and Minecraft report starters include controls immediately',async()=>{
  const {createNativePost,createPluginPost}=require('../dist/features/bugReports/posts');
  const payloads=[],fake={id:'create-forum',threads:{create:async payload=>{
    payloads.push(payload);return {id:String(700+payloads.length),send:async()=>{}};
  }}};
  const ctx={getForum:()=>fake,mentionLeads:async()=>[],tag:s=>s,api:{setPost:async()=>{}},};
  fake.availableTags=[{id:'open',name:'open'}];
  await createNativePost(ctx,'A Discord report','reporter');
  await createPluginPost(ctx,{id:701,description:'A Minecraft report',reporter_name:'Tester',reporter_uuid:'uuid',discord_id:'reporter',server_id:'test',status:'open',created_at:1});
  for(const payload of payloads)assert.deepEqual(payload.message.components[0].toJSON().components.map(b=>b.label),['Claim','Close']);
});
