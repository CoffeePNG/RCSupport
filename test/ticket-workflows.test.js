const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const {PermissionsBitField,PermissionFlagsBits,TextChannel,EmbedBuilder,ChannelType}=require('discord.js');
const {migrateDatabase}=require('../dist/db/migrations');
function load(relative,overrides={}) {
  const file=require.resolve(relative),mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
  const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(overrides,id)?overrides[id]:original(id);
  mod._compile(fs.readFileSync(file,'utf8'),file);return mod.exports;
}
const lead='100000000000000001',owner='100000000000000002',other='100000000000000003';
function fixture(t) {
  const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');t.after(()=>raw.close());
  const db={exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>(...args)=>{
    raw.exec('BEGIN');try{const result=fn(...args);raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}
  }};
  migrateDatabase(db);
  const repo=load('../dist/features/tickets/ticketRepo',{'../../db/connect':{db}});
  const configs=load('../dist/features/tickets/ticketConfigRepo',{'../../db/connect':{db}});
  const type=configs.ensureTicketType({guildId:'guild',typeKey:'help',displayName:'Help',department:'Support',channelPrefix:'help',openMessage:'Hello',claimMessage:'Claimed by {claimant}',optionDescription:'Get help'});
  configs.addLead(type.id,lead);configs.addLead(type.id,other);
  const ticket=repo.createTicket('guild','help',owner,'ticket-channel','Original answers');repo.setMessageId(ticket.id,'starter');
  const calls={updates:[],exports:[],deletes:0,failExport:false,failDelete:false,truncated:false,collects:0,failControls:false};
  const channel=Object.assign(Object.create(TextChannel.prototype),{id:'ticket-channel',guildId:'guild',
    messages:{fetch:async()=>({embeds:[],edit:async payload=>{if(calls.failControls)throw Error('Cannot edit');calls.updates.push(payload);}})},
    delete:async()=>{calls.deletes++;if(calls.failDelete)throw Error('Missing permission');}});
  const review=Object.assign(Object.create(TextChannel.prototype),{id:'review',guildId:'guild',messages:{fetch:async id=>({id})},
    send:async payload=>{if(calls.failExport)throw Error('Archive unavailable');calls.exports.push(payload);return {id:'export'};}});
  const client={channels:{fetch:async id=>id==='review'?review:channel}};
  const handler=load('../dist/features/tickets/ticketHandler',{
    './ticketRepo':repo,'./ticketConfigRepo':configs,'./cleanup':{retryTicketCleanup:async()=>{}},
    '../../utils/transcript':{collectTranscript:async()=>{calls.collects++;return {text:'Conversation',truncated:calls.truncated};}},
    '../../utils/permissions':{canManageTicket:(user,permissions,id)=>permissions?.has(PermissionFlagsBits.ManageGuild)||configs.isLead(id,user)},
  });
  function interaction(prefix,user=lead,overrides={}) {
    const replies=[];return {replies,guildId:'guild',channelId:channel.id,channel,client,user:{id:user},
      customId:prefix+ticket.id,memberPermissions:new PermissionsBitField(0n),
      deferReply:async()=>{},deferUpdate:async()=>{},reply:async p=>replies.push(p),editReply:async p=>replies.push(p),followUp:async p=>replies.push(p),...overrides};
  }
  const cleanup=load('../dist/features/tickets/cleanup',{'./ticketRepo':repo});
  return {raw,db,repo,configs,type,ticket,channel,client,review,calls,handler,interaction,cleanup};
}
async function quiet(fn) {const previous=console.error;console.error=()=>{};try{return await fn();}finally{console.error=previous;}}

test('only one claimant wins; another lead cannot release it, but the owner can',async t=>{
  const f=fixture(t);
  await Promise.all([f.handler.handleTicketClaim(f.interaction('ticket_claim:',lead)),f.handler.handleTicketClaim(f.interaction('ticket_claim:',other))]);
  assert.equal(f.repo.getTicketById(f.ticket.id).claimedBy,lead);
  await f.handler.handleTicketRelease(f.interaction('ticket_release:',other));assert.equal(f.repo.getTicketById(f.ticket.id).claimedBy,lead);
  await f.handler.handleTicketRelease(f.interaction('ticket_release:',lead));assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');
  assert.equal(f.repo.getTicketById(f.ticket.id).claimedAt,null);
  await f.handler.handleTicketClaim(f.interaction('ticket_claim:',other));assert.equal(f.repo.getTicketById(f.ticket.id).claimedBy,other);
});
test('stale or forged ticket controls cannot operate in another guild or channel',async t=>{
  const f=fixture(t);
  for(const overrides of [{guildId:'different'},{channelId:'different'}]) {
    await f.handler.handleTicketClaim(f.interaction('ticket_claim:',lead,overrides));
    await f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner,overrides));
  }
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');assert.equal(f.calls.collects,0);
});
test('queue authorization precedes pagination and filters claims without leaking other types or guilds',t=>{
  const f=fixture(t);
  for(let i=0;i<12;i++) f.repo.createTicket('guild','help',owner,`help-${i}`);
  f.repo.createTicket('guild','private',owner,'private');f.repo.createTicket('elsewhere','help',owner,'other-guild');
  f.repo.createTicket('guild','help',owner,''); // reserved channel is not a working ticket
  const filter={guildId:'guild',userId:lead,manager:false,status:'all',page:1};
  assert.equal(f.repo.listTicketQueue(filter).total,13);assert.equal(f.repo.listTicketQueue(filter).tickets.length,10);
  assert.equal(f.repo.listTicketQueue({...filter,page:2}).tickets.length,3);
  assert.equal(f.repo.listTicketQueue({...filter,userId:'outsider'}).total,0);
  assert.equal(f.repo.listTicketQueue({...filter,manager:true}).total,14);
  f.repo.claimTicket(f.ticket.id,lead);
  assert.equal(f.repo.listTicketQueue({...filter,status:'mine'}).total,1);
  assert.equal(f.repo.listTicketQueue({...filter,status:'open'}).total,12);
  assert.equal(f.repo.listTicketQueue({...filter,typeKey:'private'}).total,0);
});
test('failed archive delivery leaves ticket active and transcript saved; retry closes once then cleanup retries durably',async t=>{
  const f=fixture(t);f.configs.setReviewChannel('guild','help','review');f.calls.failExport=true;
  await quiet(()=>f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)));
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');assert.equal(f.calls.deletes,0);
  assert.match(f.repo.getCloseExport(f.ticket.id).transcript,/Original answers/);
  assert.equal(f.repo.pendingTicketCleanup().length,0);
  f.calls.failExport=false;
  await Promise.all([f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)),f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner))]);
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'closed');assert.equal(f.calls.exports.length,1);
  assert.equal(f.repo.getCloseExport(f.ticket.id).review_message_id,'export');
  f.raw.exec('UPDATE ticket_close_exports SET delete_after=0');f.calls.failDelete=true;
  await quiet(()=>f.cleanup.retryTicketCleanup(f.client));
  assert.equal(f.raw.prepare('SELECT delete_pending FROM ticket_close_exports').get().delete_pending,1);
  f.raw.exec('UPDATE ticket_close_exports SET delete_after=0');f.calls.failDelete=false;
  // A fresh worker demonstrates that retry state survives process-local state loss.
  const restarted=load('../dist/features/tickets/cleanup',{'./ticketRepo':f.repo});await restarted.retryTicketCleanup(f.client);
  assert.equal(f.raw.prepare('SELECT delete_pending FROM ticket_close_exports').get().delete_pending,0);
  assert.equal(f.calls.deletes,2);
});
test('missing review destination, ticket-channel archive, and truncated transcript never close or delete the ticket',async t=>{
  const f=fixture(t);f.configs.setReviewChannel('guild','help','ticket-channel');
  await quiet(()=>f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)));
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');
  f.configs.setReviewChannel('guild','help','review');f.review.guildId='other';
  await quiet(()=>f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)));
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');f.review.guildId='guild';f.calls.truncated=true;
  await quiet(()=>f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)));
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');assert.equal(f.calls.deletes,0);assert.equal(f.calls.exports.length,0);
});
test('no review channel still retains a transcript before close, and a lost starter message does not block closure',async t=>{
  const f=fixture(t);f.calls.failControls=true;
  await quiet(()=>f.handler.handleTicketCloseConfirm(f.interaction('ticket_close_confirm:',owner)));
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'closed');assert.ok(f.repo.getCloseExport(f.ticket.id).transcript);
  assert.equal(f.calls.exports.length,0);
});
test('configuration inspection identifies missing channels without changing settings',async t=>{
  const f=fixture(t);f.configs.setTicketCategory('guild','help','missing');f.configs.setReviewChannel('guild','help','review');
  const inspection=load('../dist/features/tickets/configInspection',{'./ticketRepo':f.repo,'./ticketConfigRepo':f.configs,
    '../../db/guildSettingsRepo':{getGuildSettings:()=>({panelChannelId:null,panelMessageId:null})}});
  const guild={id:'guild',members:{fetchMe:async()=>({permissions:new PermissionsBitField(0n)})},
    channels:{fetch:async id=>id==='review'?{type:ChannelType.GuildText,permissionsFor:()=>new PermissionsBitField(0n)}:null}};
  const before=f.configs.getTicketType('guild','help');const lines=await inspection.checkTicketConfiguration(guild,before);
  assert.match(lines.join('\n'),/category no longer exists/);assert.match(lines.join('\n'),/Attach Files/);
  assert.deepEqual(f.configs.getTicketType('guild','help'),before);
  assert.match(JSON.stringify(inspection.ticketConfigSummary(before).toJSON()),/100000000000000001/);
});
test('status redraws replace ownership fields and release buttons never reopen closed tickets',()=>{
  const {applyTicketStatus,buildTicketButtons}=require('../dist/features/tickets/ticketEmbeds');
  const embed=new EmbedBuilder().addFields({name:'Question',value:'Original answer'});
  applyTicketStatus(embed,{status:'claimed',claimedBy:lead});applyTicketStatus(embed,{status:'claimed',claimedBy:other});
  assert.equal(embed.data.fields.filter(field=>field.name==='Ticket status').length,1);
  applyTicketStatus(embed,{status:'open'});assert.deepEqual(embed.data.fields,[{name:'Question',value:'Original answer'},{name:'Ticket status',value:'Unclaimed',inline:true}]);
  assert.equal(buildTicketButtons(1,true,false).toJSON().components[0].label,'Release claim');
  assert.equal(buildTicketButtons(1,true,true).toJSON().components[0].disabled,true);
});
test('close persistence refuses missing transcripts and unacknowledged configured exports',t=>{
  const f=fixture(t);
  assert.throws(()=>f.repo.finishTicketClose(f.ticket.id,owner),/saved transcript/);
  f.repo.saveCloseExport(f.ticket.id,'Transcript','review',owner);
  assert.throws(()=>f.repo.finishTicketClose(f.ticket.id,owner),/archive must receive/);
  assert.equal(f.repo.getTicketById(f.ticket.id).status,'open');
});
test('real queue command and autocomplete expose only authorized ticket types',async t=>{
  const f=fixture(t);
  const {ticketCreateCommand}=load('../dist/features/tickets/commands/ticket-create',{
    '../workflowCommands':{...require('../dist/features/tickets/workflowDefinitions'),executeWorkflowCommand:async()=>false},
    '../ticketRepo':f.repo,'../ticketConfigRepo':f.configs,'../ticketHandler':f.handler,'../ticketTypeAutocomplete':{},
  });
  const replies=[];
  const interaction={guildId:'guild',channelId:'ticket-channel',user:{id:lead},memberPermissions:new PermissionsBitField(0n),
    options:{getSubcommand:()=> 'queue',getString:()=>null,getInteger:()=>null,getFocused:()=>''},reply:async p=>replies.push(p),respond:async p=>replies.push(p)};
  await ticketCreateCommand.execute(interaction);assert.match(JSON.stringify(replies[0]),/ticket-channel/);
  await ticketCreateCommand.autocomplete(interaction);assert.deepEqual(replies[1],[{name:'Help',value:'help'}]);
  interaction.user.id='outsider';await ticketCreateCommand.execute(interaction);
  assert.match(replies[2].content,/Only ticket leads/);
  await ticketCreateCommand.autocomplete(interaction);assert.deepEqual(replies[3],[]);
  assert.equal(ticketCreateCommand.data.toJSON().options.some(o=>o.name==='release'),true);
});
test('original questionnaire fields named like status fields remain intact',()=>{
  const {applyTicketStatus}=require('../dist/features/tickets/ticketEmbeds');
  const embed=new EmbedBuilder().addFields({name:'Ticket status',value:'The application is pending'}, {name:'Claimed by',value:`<@${lead}>`});
  applyTicketStatus(embed,{status:'claimed',claimedBy:lead});applyTicketStatus(embed,{status:'open'});
  assert.equal(embed.data.fields[0].value,'The application is pending');assert.equal(embed.data.fields[1].value,`<@${lead}>`);
  assert.equal(embed.data.fields.filter(field=>field.name==='Ticket status'&&field.inline).length,1);
});
