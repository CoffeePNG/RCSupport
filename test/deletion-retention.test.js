const {test,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');
const adapter={exec:sql=>db.exec(sql),prepare:sql=>db.prepare(sql),transaction:fn=>()=>{db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
require('../dist/db/migrations').migrateDatabase(adapter);
require.cache[require.resolve('../dist/db/connect')]={exports:{db:adapter}};
const repo=require('../dist/features/bugReports/repo');
const sync=require('../dist/features/bugReports/deletionSync');
after(()=>db.close());
beforeEach(()=>{for(const t of ['rcsupport_posts','rcsupport_deleted_threads','rcsupport_deletion_cleanup','rcsupport_history_sync','rcsupport_closure_notices','rcsupport_case_controls','rcsupport_reply_receipts'])db.exec(`DELETE FROM ${t}`);});
function context(fetch=async()=>null){return {config:{forumChannelId:'forum'},getForum:()=>({id:'forum',client:{user:{id:'bot'}},threads:{fetch}}),serial:async(id,fn)=>fn(),poll:async()=>{},reportSyncError:()=>{},api:{pendingDeletions:async()=>[],confirmThreadDeleted:async()=>{}}};}
test('history expires at 72 hours, repeat marks retain the deadline and report mappings survive',()=>{
  repo.storePluginPost(1,'post','reporter');repo.recordThreadDeleted('post','admin');
  db.prepare('UPDATE rcsupport_deleted_threads SET deleted_at=100 WHERE post_id=?').run('post');
  repo.recordThreadDeleted('post','again');
  assert.equal(db.prepare('SELECT deleted_at FROM rcsupport_deleted_threads').get().deleted_at,100);
  repo.queueClosure('closure','post','admin',99);repo.saveHistoryCursor('post',{last_seen:'123',before_id:null,sweep_high:null});
  repo.purgeDeletedHistory(100+72*3600-1);assert.ok(repo.closureNotice('closure'));
  repo.purgeDeletedHistory(100+72*3600);assert.equal(repo.closureNotice('closure'),undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rcsupport_history_sync').get().n,0);
  assert.ok(repo.byPost('post'));assert.ok(repo.threadDeleted('post'));assert.equal(repo.pendingDeletions().length,1);
  repo.purgeDeletedHistory(100+72*3600+1);
});
test('direct Discord deletion ignores unrelated threads and durably retries bridge notification',async()=>{
  repo.storePluginPost(1,'post','reporter');const ctx=context();
  await sync.onThreadDelete(ctx,{id:'post',parentId:'other'});assert.equal(repo.threadDeleted('post'),false);
  await sync.onThreadDelete(ctx,{id:'post',parentId:'forum'});assert.equal(repo.threadDeleted('post'),true);
  ctx.api.confirmThreadDeleted=async()=>{throw new Error('offline');};
  await sync.reconcileDeletions(ctx);assert.equal(repo.pendingDeletions().length,1);
  ctx.api.confirmThreadDeleted=async()=>{};
  await sync.reconcileDeletions(ctx);assert.equal(repo.pendingDeletions().length,0);
});
test('Minecraft deletion requires the mapped bot-owned forum thread; permission errors never count as deletion',async()=>{
  const ticket={id:1,discord_post_id:'post',discord_id:'reporter'};let deletes=0,acks=0;
  const thread={parentId:'forum',ownerId:'bot',delete:async()=>{deletes++;}};
  const ctx=context(async()=>thread);ctx.api.pendingDeletions=async()=>[ticket];ctx.api.confirmThreadDeleted=async()=>{acks++;};
  thread.parentId='other';await sync.reconcileDeletions(ctx);assert.equal(deletes,0);assert.equal(acks,0);
  thread.parentId='forum';await sync.reconcileDeletions(ctx);assert.equal(deletes,1);assert.equal(acks,1);assert.ok(repo.threadDeleted('post'));
  const other=context(async()=>{throw Object.assign(new Error('no access'),{code:50001});});other.api.pendingDeletions=async()=>[{...ticket,id:2,discord_post_id:'other'}];
  await sync.reconcileDeletions(other);assert.equal(repo.threadDeleted('other'),false);
  const missing=context(async()=>{throw Object.assign(new Error('missing'),{code:10003});});missing.api.pendingDeletions=other.api.pendingDeletions;
  await sync.reconcileDeletions(missing);assert.ok(repo.threadDeleted('other'));
});
test('closed reports retain history indefinitely',()=>{
  repo.storeNativePost('closed');repo.queueClosure('closure','closed','admin',1);
  repo.purgeDeletedHistory(9999999999);assert.ok(repo.closureNotice('closure'));
});
