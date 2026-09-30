const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const {ChannelType,Collection,PermissionsBitField,PermissionFlagsBits}=require('discord.js');
const {migrateDatabase}=require('../dist/db/migrations');
function load(relative,overrides={}) {
 const file=require.resolve(relative),mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
 const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(overrides,id)?overrides[id]:original(id);
 mod._compile(fs.readFileSync(file,'utf8'),file);return mod.exports;
}
function fixture(t) {
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 const db={exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>(...args)=>{raw.exec('BEGIN');try{const result=fn(...args);raw.exec('COMMIT');return result;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 migrateDatabase(db);
 const tickets=load('../dist/features/tickets/ticketRepo',{'../../db/connect':{db}});
 const configs=load('../dist/features/tickets/ticketConfigRepo',{'../../db/connect':{db}});
 const repo=load('../dist/features/tickets/workflowRepo',{'../../db/connect':{db},'./ticketRepo':tickets});
 const seed=(guildId,typeKey)=>configs.ensureTicketType({guildId,typeKey,displayName:typeKey,department:typeKey,channelPrefix:typeKey,openMessage:'Hi',claimMessage:'Hi',optionDescription:null});
 const source=seed('guild','help'),dest=seed('guild','appeal');seed('other','help');
 configs.addLead(source.id,'lead');configs.addLead(dest.id,'destination');
 const ticket=tickets.createTicket('guild','help','requester','channel','Original answers');tickets.setMessageId(ticket.id,'starter');
 const calls={edits:[],sends:[],controls:[],fail:false};
 const perms=new PermissionsBitField([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]);
 const channel={id:'channel',guildId:'guild',type:ChannelType.GuildText,
  permissionOverwrites:{cache:new Collection([['lead',{id:'lead',type:1,allow:perms,deny:new PermissionsBitField()}],['requester',{id:'requester',type:1,allow:perms,deny:new PermissionsBitField()}]])},
  permissionsFor:()=>({has:()=>true}),
  edit:async payload=>{if(calls.fail)throw Error('Discord offline');calls.edits.push(payload);channel.permissionOverwrites.cache=new Collection(payload.permissionOverwrites.map(o=>[o.id,{...o,allow:new PermissionsBitField(o.allow),deny:new PermissionsBitField(o.deny)}]));},
  messages:{fetch:async()=>({embeds:[],edit:async payload=>calls.controls.push(payload)})},
  send:async payload=>{if(calls.fail)throw Error('Discord offline');calls.sends.push(payload);},
  guild:{members:{fetchMe:async()=>({id:'bot'}),fetch:async id=>({id,user:{bot:false},permissions:new PermissionsBitField(id==='manager'?PermissionFlagsBits.ManageGuild:0n)})},channels:{fetch:async()=>({type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>true})})}}
 };
 const client={channels:{fetch:async()=>channel}};
 const runtime=load('../dist/features/tickets/workflowRuntime',{'./ticketRepo':tickets,'./ticketConfigRepo':configs,'./workflowRepo':repo,'../../modules/catalog':{ticketModule:{}},'../../security/access':{isGuildAllowed:()=>true}});
 const commands=load('../dist/features/tickets/workflowCommands',{'./ticketRepo':tickets,'./ticketConfigRepo':configs,'./workflowRepo':repo,'./workflowRuntime':runtime});
 function interaction(sub,user='lead',values={}) {
  const replies=[];return {replies,guildId:'guild',channelId:'channel',client,guild:channel.guild,user:{id:user},memberPermissions:new PermissionsBitField(user==='manager'?PermissionFlagsBits.ManageGuild:0n),
   options:{getSubcommand:()=>sub,getString:key=>values[key]??null,getInteger:key=>values[key]??null,getUser:key=>values[key]?{id:values[key]}:null},
   deferReply:async()=>{},editReply:async p=>replies.push(p),reply:async p=>replies.push(p)};
 }
 return {raw,db,tickets,configs,repo,runtime,commands,interaction,ticket,source,dest,calls,channel};
}
test('history filters current type access and guild before pagination; transcripts deny outsiders',async t=>{
 const f=fixture(t);for(let n=0;n<12;n++)f.tickets.createTicket('guild','appeal','requester','private-'+n);
 f.tickets.createTicket('other','help','requester','other-channel');
 const result=f.repo.ticketHistory({guildId:'guild',userId:'lead',manager:false,page:1});
 assert.equal(result.total,1);assert.equal(result.tickets[0].id,f.ticket.id);
 assert.equal(f.repo.ticketHistory({guildId:'guild',userId:'manager',manager:true,page:1}).total,13);
 f.tickets.saveCloseExport(f.ticket.id,'Private transcript',null,'lead');f.tickets.finishTicketClose(f.ticket.id,'lead');
 for(const user of ['outsider','destination','requester']) {
  const i=f.interaction('transcript',user,{id:f.ticket.id});await f.commands.executeWorkflowCommand(i);assert.match(i.replies[0],/not found|do not have access/);
 }
 const i=f.interaction('transcript','lead',{id:f.ticket.id});await f.commands.executeWorkflowCommand(i);assert.equal(i.replies[0].files[0].attachment.toString(),'Private transcript');
 i.guildId='other';i.replies.length=0;await f.commands.executeWorkflowCommand(i);assert.match(i.replies[0],/not found/);
});
test('transfer requires both types, updates lead access, clears claims, and preserves submission/channel',async t=>{
 const f=fixture(t);f.tickets.claimTicket(f.ticket.id,'lead');
 const denied=f.interaction('reassign','lead',{type:'appeal'});await f.commands.executeWorkflowCommand(denied);assert.match(denied.replies[0],/both/);assert.equal(f.calls.edits.length,0);
 const i=f.interaction('reassign','manager',{type:'appeal',reason:'Appeal review'});await f.commands.executeWorkflowCommand(i);
 const changed=f.tickets.getTicketById(f.ticket.id);assert.equal(changed.typeKey,'appeal');assert.equal(changed.claimedBy,null);assert.equal(changed.channelId,'channel');assert.equal(changed.submissionText,'Original answers');
 assert.equal(f.channel.permissionOverwrites.cache.has('lead'),false);assert.equal(f.channel.permissionOverwrites.cache.has('destination'),true);assert.equal(f.channel.permissionOverwrites.cache.has('requester'),true);
 assert.equal(f.repo.ticketHistory({guildId:'guild',userId:'lead',manager:false,page:1}).total,0);
 assert.match(f.repo.ticketActivity(f.ticket.id)[0].details,/Appeal review/);
});
test('staff reassignment validates destination membership and allows a destination lead',async t=>{
 const f=fixture(t),bad=f.interaction('reassign','manager',{type:'appeal',staff:'outsider'});await f.commands.executeWorkflowCommand(bad);assert.match(bad.replies[0],/destination ticket lead/);
 const good=f.interaction('reassign','manager',{type:'appeal',staff:'destination'});await f.commands.executeWorkflowCommand(good);assert.equal(f.tickets.getTicketById(f.ticket.id).claimedBy,'destination');
});
test('failed transfer remains durable, freezes controls and completes once after retry',async t=>{
 const f=fixture(t);f.calls.fail=true;
 await f.commands.executeWorkflowCommand(f.interaction('reassign','manager',{type:'appeal'}));
 assert.equal(f.tickets.getTicketById(f.ticket.id).typeKey,'help');assert.ok(f.tickets.hasPendingReassignment(f.ticket.id));
 migrateDatabase(f.db);f.calls.fail=false;await f.runtime.runTicketWorkflows(f.interaction('history').client);await f.runtime.runTicketWorkflows(f.interaction('history').client);
 assert.equal(f.tickets.getTicketById(f.ticket.id).typeKey,'appeal');assert.equal(f.tickets.hasPendingReassignment(f.ticket.id),false);assert.equal(f.repo.ticketActivity(f.ticket.id).filter(a=>a.action==='REASSIGN').length,1);
});
test('reminders default off, send once, persist across migrations, and respect closed state',async t=>{
 const f=fixture(t);f.raw.prepare('UPDATE tickets SET created_at=?').run(Date.now()-120000);
 assert.deepEqual(f.repo.dueReminders(),[]);f.repo.configureReminders('guild','help','manager',1,1);
 await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.calls.sends.length,1);assert.deepEqual(f.calls.sends[0].allowedMentions.users,['lead']);
 migrateDatabase(f.db);await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.calls.sends.length,1);
 f.repo.setWaiting(f.ticket.id,'requester','lead');f.raw.prepare('UPDATE ticket_waiting SET since=?').run(Date.now()-120000);
 await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.calls.sends.length,2);assert.deepEqual(f.calls.sends[1].allowedMentions.users,['requester']);
 f.repo.setWaiting(f.ticket.id,'staff','lead');f.raw.prepare('UPDATE ticket_waiting SET since=?').run(Date.now()-120000);f.tickets.closeTicket(f.ticket.id,'lead');
 await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.calls.sends.length,2);
});
test('expected human reply clears waiting; other participants, bots, and stale messages do not',async t=>{
 const f=fixture(t);f.repo.setWaiting(f.ticket.id,'requester','lead');
 const msg={guildId:'guild',channelId:'channel',author:{id:'lead',bot:false},createdTimestamp:Date.now()+1,member:{permissions:new PermissionsBitField()}};
 await f.runtime.observeTicketReply(msg);assert.ok(f.repo.getWaiting(f.ticket.id));
 await f.runtime.observeTicketReply({...msg,author:{id:'requester',bot:true}});assert.ok(f.repo.getWaiting(f.ticket.id));
 await f.runtime.observeTicketReply({...msg,author:{id:'requester',bot:false},createdTimestamp:1});assert.ok(f.repo.getWaiting(f.ticket.id));
 await f.runtime.observeTicketReply({...msg,author:{id:'requester',bot:false}});assert.equal(f.repo.getWaiting(f.ticket.id),undefined);
 f.repo.setWaiting(f.ticket.id,'staff','lead');await f.runtime.observeTicketReply({...msg,createdTimestamp:Date.now()+1});assert.equal(f.repo.getWaiting(f.ticket.id),undefined);
});
test('failed reminders retain retry state without hot-looping or losing the notification',async t=>{
 const f=fixture(t);f.repo.configureReminders('guild','help','manager',1,0);f.raw.prepare('UPDATE tickets SET created_at=?').run(Date.now()-120000);
 f.calls.fail=true;await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.repo.dueReminders().length,0);
 assert.match(f.raw.prepare('SELECT last_error FROM ticket_unclaimed_reminders').get().last_error,/offline/);
 f.calls.fail=false;f.raw.exec('UPDATE ticket_unclaimed_reminders SET retry_after=0');await f.runtime.runTicketWorkflows(f.interaction('history').client);assert.equal(f.calls.sends.length,1);
});
test('commands validate Discord payloads and waiting access; notification bounds enforced',async t=>{
 const f=fixture(t),defs=require('../dist/features/tickets/workflowDefinitions');for(const d of [...defs.workflowSubcommands,defs.remindersSubcommand])assert.ok(d.toJSON().name);
 const denied=f.interaction('waiting','requester',{on:'staff'});await f.commands.executeWorkflowCommand(denied);assert.equal(f.repo.getWaiting(f.ticket.id),undefined);
 const allowed=f.interaction('waiting','lead',{on:'requester'});await f.commands.executeWorkflowCommand(allowed);assert.equal(f.repo.getWaiting(f.ticket.id).party,'requester');
 assert.throws(()=>f.repo.configureReminders('guild','help','manager',-1,1),/between/);
});
test('manager can correct a partially applied transfer without leaving destination grants behind',async t=>{
 const f=fixture(t);
 f.raw.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON ticket_activity BEGIN SELECT RAISE(ABORT,'audit failed'); END");
 await f.commands.executeWorkflowCommand(f.interaction('reassign','manager',{type:'appeal',staff:'destination'}));
 assert.ok(f.repo.pendingReassignment(f.ticket.id));assert.equal(f.channel.permissionOverwrites.cache.has('destination'),true);
 assert.equal(f.tickets.getTicketById(f.ticket.id).typeKey,'help');
 f.raw.exec('DROP TRIGGER fail_activity');
 await f.commands.executeWorkflowCommand(f.interaction('reassign','manager',{type:'help',staff:'lead'}));
 assert.equal(f.channel.permissionOverwrites.cache.has('destination'),false);assert.equal(f.channel.permissionOverwrites.cache.has('lead'),true);
 assert.equal(f.repo.pendingReassignment(f.ticket.id),undefined);assert.equal(f.tickets.getTicketById(f.ticket.id).claimedBy,'lead');
});
test('releasing a claim starts a new reminder timer rather than reusing the original ticket age',t=>{
 const f=fixture(t);f.repo.configureReminders('guild','help','manager',60,0);f.raw.prepare('UPDATE tickets SET created_at=?').run(Date.now()-7200000);
 assert.equal(f.repo.dueReminders().length,1);f.repo.recordReminder(f.ticket.id,'unclaimed',null);f.tickets.claimTicket(f.ticket.id,'lead');f.tickets.releaseTicket(f.ticket.id,'lead');
 assert.equal(f.repo.dueReminders().length,0);assert.equal(f.repo.dueReminders(Date.now()+3600001).length,1);
});
test('pending transfers block claim and close handlers before they change ownership or close',async t=>{
 const f=fixture(t);f.repo.queueReassignment(f.ticket.id,'appeal',null,'manager','');
 const handler=load('../dist/features/tickets/ticketHandler',{'./ticketRepo':f.tickets,'./ticketConfigRepo':f.configs,'./cleanup':{},'../../utils/permissions':{canManageTicket:()=>true}});
 const replies=[];const i={guildId:'guild',channelId:'channel',customId:`ticket_claim:${f.ticket.id}`,user:{id:'lead'},deferReply:async()=>{},deferUpdate:async()=>{},editReply:async p=>replies.push(p)};
 await handler.handleTicketClaim(i);assert.equal(f.tickets.getTicketById(f.ticket.id).claimedBy,null);
 i.customId=`ticket_close_confirm:${f.ticket.id}`;await handler.handleTicketCloseConfirm(i);assert.equal(f.tickets.getTicketById(f.ticket.id).status,'open');
 assert.equal(replies.length,2);
});
