const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {PermissionFlagsBits}=require('discord.js');
const {migrateStaff}=require('../dist/features/staff/schema');
const {StaffRepository}=require('../dist/features/staff/repository');
const {StaffService}=require('../dist/features/staff/service');
const {StaffSynchronizer}=require('../dist/features/staff/sync');
const {renderRoster}=require('../dist/features/staff/renderer');
const {positions,validateAssignment}=require('../dist/features/staff/hierarchy');
function fixture(t,settings={adminRoleIds:[],permissions:{},roleBindings:[]}) {
  const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');t.after(()=>raw.close());
  const db={exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>(...args)=>{
    raw.exec('BEGIN');try{const result=fn(...args);raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}
  }};
  migrateStaff(db);
  const repo=new StaffRepository(db,'staff'),service=new StaffService(repo,settings);
  const actor={guildId:'staff',userId:'manager',roleIds:[],permissions:PermissionFlagsBits.Administrator,source:'/staff test'};
  const input={position:'moderator',senior:false,designation:''};
  return {raw,db,repo,service,actor,input,settings};
}
test('hierarchy distinguishes shared Helper, senior Administrator and the separate Senior Moderator rank',()=>{
  assert.equal(positions.filter(p=>p.id==='helper').length,1);
  assert.equal(positions.find(p=>p.id==='helper').department,'Shared Support');
  assert.ok(positions.some(p=>p.id==='senior-moderator'));
  assert.throws(()=>validateAssignment({position:'moderator',senior:true,designation:''}));
  assert.throws(()=>validateAssignment({position:'senior-moderator',senior:true,designation:''}));
  assert.equal(validateAssignment({position:'community-administrator',senior:true,designation:' E '}).designation,'E');
  assert.throws(()=>validateAssignment({position:'helper',senior:false,designation:'@everyone'}));
});
test('staff hire and assignment preserve history and atomic audit across repeat migrations',t=>{
  const f=fixture(t),{service,repo,actor,input}=f;
  service.add(actor,'hire','alice',input);
  service.add(actor,'assign','alice',{...input,position:'helper'});
  assert.throws(()=>service.add(actor,'hire','alice',input),/already staff/);
  assert.throws(()=>service.add(actor,'assign','bob',input),/Hire/);
  assert.throws(()=>service.add(actor,'assign','alice',input),/already exists/);
  const id=repo.assignments('alice').find(a=>a.position==='moderator').id;
  service.remove(actor,'alice',id);migrateStaff(f.db);
  assert.equal(repo.assignments('alice').length,1);
  assert.ok(f.raw.prepare('SELECT ended_at FROM staff_assignments WHERE id=?').get(id).ended_at);
  const audit=f.raw.prepare('SELECT * FROM staff_audit ORDER BY id').all();
  assert.deepEqual(audit.map(a=>a.action),['STAFF_HIRE','STAFF_ASSIGN','STAFF_REMOVE']);
  assert.equal(audit[2].actor_id,'manager');assert.equal(audit[2].target_id,'alice');
  assert.equal(JSON.parse(audit[2].before_json).position,'moderator');assert.equal(repo.syncState().pending,1);
});
test('a failed audit rolls back staff data and sync revision',t=>{
  const f=fixture(t);
  f.raw.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON staff_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
  assert.throws(()=>f.service.add(f.actor,'hire','alice',f.input),/audit failed/);
  assert.equal(f.repo.member('alice'),undefined);assert.deepEqual(f.repo.assignments(),[]);assert.equal(f.repo.syncState(),undefined);
});
test('capabilities are separate, Administrator cannot cross guilds, and assignment IDs are user scoped',t=>{
  const f=fixture(t,{adminRoleIds:[],permissions:{hire:['hiring'],vacancy:['vacancies']},roleBindings:[]});
  const limited={...f.actor,permissions:0n,roleIds:['hiring']};
  f.service.add(limited,'hire','alice',f.input);
  assert.throws(()=>f.service.add(limited,'assign','alice',{...f.input,position:'helper'}),/permission/);
  assert.throws(()=>f.service.add({...f.actor,guildId:'public'},'hire','bob',f.input),/permission/);
  assert.throws(()=>f.service.remove(f.actor,'bob',f.repo.assignments('alice')[0].id),/no longer active/);
  const other=new StaffRepository(f.db,'other');assert.deepEqual(other.assignments(),[]);
  const id=f.service.vacancy(f.actor,'create',{...f.input,position:'helper'});
  assert.throws(()=>f.service.vacancy({...limited,roleIds:['vacancies']},'fill',undefined,id,'alice'),/assign permission/);
  assert.equal(f.repo.vacancies().length,1);
});
test('vacancy fill is atomic, rejects duplicate assignment, and cannot be replayed',t=>{
  const f=fixture(t);f.service.add(f.actor,'hire','alice',f.input);
  const duplicate=f.service.vacancy(f.actor,'create',f.input);
  assert.throws(()=>f.service.vacancy(f.actor,'fill',undefined,duplicate,'alice'),/already exists/);
  assert.equal(f.repo.vacancies().length,1);
  const id=f.service.vacancy(f.actor,'create',{...f.input,position:'helper'});
  f.service.vacancy(f.actor,'fill',undefined,id,'alice');
  assert.equal(f.repo.assignments('alice').length,2);assert.equal(f.repo.vacancies().length,1);
  assert.throws(()=>f.service.vacancy(f.actor,'fill',undefined,id,'alice'),/no longer open/);
});
test('fire requires the original actor, unexpired confirmation and unchanged assignments',t=>{
  const f=fixture(t);f.service.add(f.actor,'hire','alice',f.input);
  const first=f.service.requestFire(f.actor,'alice');
  assert.throws(()=>f.service.confirmFire({...f.actor,userId:'other'},first.id),/another staff member/);
  f.service.add(f.actor,'assign','alice',{...f.input,position:'helper'});
  assert.throws(()=>f.service.confirmFire(f.actor,first.id),/assignments changed/);
  const expired=f.service.requestFire(f.actor,'alice');
  f.raw.prepare('UPDATE staff_confirmations SET expires_at=0 WHERE id=?').run(expired.id);
  assert.throws(()=>f.service.confirmFire(f.actor,expired.id),/expired/);
  const cancelled=f.service.requestFire(f.actor,'alice');f.service.confirmFire(f.actor,cancelled.id,true);
  assert.equal(f.repo.assignments('alice').length,2);
  const confirmed=f.service.requestFire(f.actor,'alice');f.service.confirmFire(f.actor,confirmed.id);
  assert.equal(f.repo.member('alice').status,'inactive');assert.deepEqual(f.repo.assignments('alice'),[]);
  assert.throws(()=>f.service.confirmFire(f.actor,confirmed.id),/expired/);
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM staff_assignments').get().n,2);
  f.service.add(f.actor,'hire','alice',f.input);assert.equal(f.repo.member('alice').status,'active');
});
test('roster renders tree, real vacancies and shared Helpers once, splitting large rosters safely',()=>{
  const assignment=(id,position,senior=false)=>({id:String(id),user_id:String(id),position,senior,designation:'',effective_at:0});
  const rows=[assignment(1,'helper'),assignment(2,'community-administrator',true),assignment(3,'senior-moderator')];
  const pages=renderRoster(rows,[{id:'vacancy',position:'support-administrator',senior:false,designation:'GT',created_at:0}]);
  const rendered=pages.join('\n');assert.match(rendered,/Sr\. Administrator • <@2>/);assert.match(rendered,/Sr\. Moderator • <@3>/);
  assert.equal(rendered.split('Helper •').length-1,1);assert.match(rendered,/Administrator \[GT\] • \*Vacant\*/);
  assert.ok(!rendered.includes('> **'));assert.ok(rendered.includes('└` '));assert.ok(!rendered.includes('──'));
  const nested=renderRoster([assignment(10,'moderation-administrator'),assignment(11,'senior-moderator'),assignment(12,'moderator'),assignment(13,'junior-moderator')],[]).join('\n');
  assert.match(nested,/`│   └` Administrator • <@10>\n`│       ├` Sr\. Moderator • <@11>\n`│       ├` Moderator • <@12>\n`│       └` Jr\. Moderator • <@13>/);
  const empty=renderRoster([],[]).join('\n');
  assert.ok(empty.includes('`│   └` *No assignments or vacancies recorded*'));
  assert.ok(empty.includes('`    └` *No assignments or vacancies recorded*'));
  assert.ok([...nested.matchAll(/`([^`\n]*)`/g)].every(match => !match[1].includes('<@')));
  const large=renderRoster(Array.from({length:200},(_,i)=>assignment(i,'moderator')),[]);
  assert.ok(large.length>1);assert.ok(large.every(page=>page.length<=1900));
  for(let i=0;i<200;i++) assert.equal(large.join('\n').split(`<@${i}>`).length-1,1);
});
test('failed Discord updates remain queued, retries reuse roster IDs and shared roles survive assignment removal',async t=>{
  const settings={adminRoleIds:[],permissions:{},roleBindings:[
    {position:'moderator',guildId:'public',roleId:'staff-role'},{position:'helper',guildId:'public',roleId:'staff-role'}]};
  const f=fixture(t,settings);let fail=true;const calls=[],messages=[];
  const sync=new StaffSynchronizer(f.repo,settings,{role:async(...args)=>{calls.push(args);if(fail)throw Error('Discord unavailable');},
    message:async(channel,id,content)=>{messages.push({channel,id,content});return id||'roster-1';},deleteMessage:async()=>{}});
  f.service.add(f.actor,'hire','alice',f.input);f.service.add(f.actor,'assign','alice',{...f.input,position:'helper'});
  f.service.publish(f.actor,'channel');await sync.sync();
  assert.equal(f.repo.syncState().pending,1);assert.match(f.repo.syncState().last_error,/Discord unavailable/);
  assert.deepEqual(f.repo.roster().messageIds,['roster-1']);
  fail=false;await sync.sync();assert.equal(f.repo.syncState().pending,0);assert.equal(messages[1].id,'roster-1');
  calls.length=0;f.service.remove(f.actor,'alice',f.repo.assignments('alice').find(a=>a.position==='moderator').id);await sync.sync();
  assert.deepEqual(calls,[['public','alice','staff-role',true]]);
  const request=f.service.requestFire(f.actor,'alice');f.service.confirmFire(f.actor,request.id);await sync.sync();
  assert.deepEqual(calls.at(-1),['public','alice','staff-role',false]);
});
test('in-flight synchronization cannot clear a newer revision and concurrent calls share one worker',async t=>{
  const f=fixture(t);f.service.add(f.actor,'hire','alice',f.input);f.service.publish(f.actor,'channel');
  let release,entered;const started=new Promise(r=>entered=r);const blocked=new Promise(r=>release=r);let writes=0;
  const sync=new StaffSynchronizer(f.repo,f.settings,{role:async()=>{},deleteMessage:async()=>{},message:async()=>{writes++;entered();await blocked;return 'm';}});
  const first=sync.sync();await started;const second=sync.sync();assert.equal(first,second);
  f.service.add(f.actor,'assign','alice',{...f.input,position:'helper'});release();await first;
  assert.equal(f.repo.syncState().pending,1);await sync.sync();assert.equal(f.repo.syncState().pending,0);assert.equal(writes,2);
});
test('shrinking roster deletes surplus messages only after successful refresh',async t=>{
  const f=fixture(t);f.service.publish(f.actor,'channel');f.repo.saveMessages(['a','b','c']);let fail=true;const deleted=[];
  const sync=new StaffSynchronizer(f.repo,f.settings,{role:async()=>{},message:async(_,id)=>{if(fail)throw Error('no access');return id;},deleteMessage:async(_,id)=>deleted.push(id)});
  await sync.sync();assert.deepEqual(deleted,[]);assert.equal(f.repo.syncState().pending,1);
  fail=false;await sync.sync();assert.deepEqual(deleted,['c','b']);assert.deepEqual(f.repo.roster().messageIds,['a']);
  assert.throws(()=>f.service.publish(f.actor,'different-channel'),/already published/);
});
function loadCommand(runtime) {
  const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
  const file=require.resolve('../dist/features/staff/command'),mod=new Module(file,module);
  mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));const original=mod.require.bind(mod);
  mod.require=id=>id==='./runtime'?{getStaffRuntime:()=>runtime}:original(id);
  mod._compile(fs.readFileSync(file,'utf8'),file);return mod.exports;
}
function commandInteraction(sub,values={},group=null) {
  const replies=[];
  return {replies,client:{},guildId:'staff',user:{id:'manager'},member:{roles:[]},memberPermissions:{bitfield:PermissionFlagsBits.Administrator},
    options:{getSubcommand:()=>sub,getSubcommandGroup:()=>group,getUser:key=>values[key]?{id:values[key]}:null,
      getString:key=>values[key]??null,getBoolean:key=>values[key]??null,getChannel:key=>values[key],
      getFocused:()=>values.focus,get:key=>values[key]?{value:values[key]}:null},
    deferReply:async()=>{},deferUpdate:async()=>{},editReply:async payload=>replies.push(payload),followUp:async payload=>replies.push(payload),respond:async choices=>replies.push(choices)};
}
test('real slash handlers hire, filter assignment autocomplete and require button confirmation to fire',async t=>{
  const f=fixture(t);let syncs=0;
  const command=loadCommand({service:f.service,sync:{sync:async()=>{syncs++;}}});
  const hire=commandInteraction('hire',{user:'alice',position:'helper'});await command.staffCommand.execute(hire);
  assert.equal(f.repo.assignments('alice')[0].position,'helper');assert.equal(syncs,1);
  const autocomplete=commandInteraction('remove',{user:'alice',focus:{name:'assignment',value:'helper'}});
  await command.staffCommand.autocomplete(autocomplete);assert.equal(autocomplete.replies[0].length,1);
  assert.equal(autocomplete.replies[0][0].value,f.repo.assignments('alice')[0].id);
  const fire=commandInteraction('fire',{user:'alice'});await command.staffCommand.execute(fire);
  assert.equal(f.repo.member('alice').status,'active');
  const buttons=fire.replies.at(-1).components[0].toJSON().components;
  const confirm={...commandInteraction(''),customId:buttons[0].custom_id};
  await command.handleStaffConfirmation(confirm);assert.equal(f.repo.member('alice').status,'inactive');
  assert.deepEqual(confirm.replies[0].components,[]);
});
test('staff autocomplete hides assignments from unauthorized callers',async t=>{
  const f=fixture(t);f.service.add(f.actor,'hire','alice',f.input);
  const command=loadCommand({service:f.service,sync:{sync:async()=>{throw Error('should not sync');}}});
  const interaction=commandInteraction('remove',{user:'alice',focus:{name:'assignment',value:''}});interaction.memberPermissions.bitfield=0n;
  await command.staffCommand.autocomplete(interaction);assert.deepEqual(interaction.replies,[[]]);
});
test('filling a vacancy hires a newcomer atomically and checks hire permission',t=>{
  const f=fixture(t,{adminRoleIds:[],permissions:{vacancy:['vacancies']},roleBindings:[]});
  const id=f.service.vacancy(f.actor,'create',f.input);
  assert.throws(()=>f.service.vacancy({...f.actor,permissions:0n,roleIds:['vacancies']},'fill',undefined,id,'newcomer'),/hire permission/);
  assert.equal(f.repo.member('newcomer'),undefined);assert.equal(f.repo.vacancies().length,1);
  f.service.vacancy(f.actor,'fill',undefined,id,'newcomer');
  assert.equal(f.repo.member('newcomer').status,'active');assert.equal(f.repo.assignments('newcomer').length,1);
  assert.deepEqual(f.repo.vacancies(),[]);
  assert.deepEqual(f.raw.prepare('SELECT action FROM staff_audit ORDER BY id').all().map(row=>row.action),['STAFF_VACANCY_CREATE','STAFF_HIRE','STAFF_VACANCY_FILL']);
});
test('invalid staff role configuration fails closed and valid mappings retain seniority',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {loadStaffSettings}=require('../dist/features/staff/settings');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rcsupport-staff-config-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'staff.json');
  fs.writeFileSync(file,JSON.stringify({adminRoleIds:[],permissions:{hire:['123456789012345678']},roleBindings:[{position:'community-administrator',senior:true,guildId:'123456789012345678',roleId:'223456789012345678'}]}));
  assert.equal(loadStaffSettings(file).roleBindings[0].senior,true);
  fs.writeFileSync(file,JSON.stringify({adminRoleIds:[],permissions:{unknown:[]},roleBindings:[]}));assert.throws(()=>loadStaffSettings(file),/Invalid/);
  fs.writeFileSync(file,JSON.stringify({adminRoleIds:[],permissions:{},roleBindings:[{position:'senior-moderator',senior:true,guildId:'123456789012345678',roleId:'223456789012345678'}]}));assert.throws(()=>loadStaffSettings(file),/Invalid/);
});
