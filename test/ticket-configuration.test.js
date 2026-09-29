const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const Module=require('node:module');
const path=require('node:path');
const fs=require('node:fs');
const {ChannelType,PermissionFlagsBits}=require('discord.js');
const {migrateDatabase}=require('../dist/db/migrations');
const {buildTicketDetailsModal,openTicketForm,ticketQuestionId}=require('../dist/features/tickets/ticketModal');
function load(relative,overrides={}) {
  const file=require.resolve(relative),mod=new Module(file,module);
  mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
  const original=mod.require.bind(mod);
  mod.require=id=>Object.hasOwn(overrides,id)?overrides[id]:original(id);
  mod._compile(fs.readFileSync(file,'utf8'),file);return mod.exports;
}
function database() {
  const raw=new DatabaseSync(':memory:');
  const db={exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>()=>fn()};
  migrateDatabase(db);
  const repo=load('../dist/features/tickets/ticketConfigRepo',{'../../db/connect':{db}});
  repo.ensureTicketType({guildId:'guild',typeKey:'application',displayName:'Staff Application',department:'leadership',channelPrefix:'application',openMessage:'Thanks {creator}',claimMessage:'Claimed',optionDescription:'Apply'});
  return {raw,db,repo};
}
function setup() {
  const f=database(),calls={};
  const handler=load('../dist/features/tickets/ticketHandler',{
    './ticketConfigRepo':f.repo,
    './ticketRepo':{discardUncreatedTicket:()=>{calls.discarded=true;},createTicket:(...args)=>{calls.submission=args[4];calls.reserved=true;return {id:1,creatorId:'user',status:'open',createdAt:1};},setChannelId:()=>{},setMessageId:()=>{}},
    '../../utils/permissions':{},
  });
  const interaction={guildId:'guild',customId:'ticket_create_modal:application',
    guild:{channels:{fetch:async()=>({type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>true})}),
      create:async options=>{calls.created=options;return {id:'ticket',send:async payload=>{calls.sent=payload;return {id:'message'};}};}},
      members:{fetchMe:async()=>({})},roles:{everyone:{id:'everyone'}}},
    client:{user:{id:'bot'}},user:{id:'user',username:'Applicant',tag:'Applicant'},
    fields:{getTextInputValue:id=>{if(!(id in calls.values))throw Error('Missing field');return calls.values[id];}},
    reply:async p=>{calls.reply=p;},deferReply:async p=>{calls.defer=p;},editReply:async p=>{calls.result=p;},
    showModal:async modal=>{calls.modal=modal.toJSON();}};
  calls.values={details:'Hello'};
  return {...f,calls,handler,interaction};
}
test('configuration survives repeat migrations and isolates guilds and role question sets',()=>{
 const f=database();try {
  f.repo.setTicketCategory('guild','application','category');
  f.repo.setTicketQuestions('guild','application',['General question?']);
  f.repo.setApplicationRole('guild','application','Developer',['Languages?','Portfolio?']);
  f.repo.setApplicationRole('guild','application','Modeler',['Models?']);
  f.repo.setApplicationRole('guild','application','developer',['Experience?']);
  migrateDatabase(f.db);
  const config=f.repo.getTicketType('guild','application');
  assert.equal(config.categoryId,'category');assert.deepEqual(config.questions,['General question?']);
  assert.equal(config.applicationRoles.length,2);assert.deepEqual(config.applicationRoles[0].questions,['Experience?']);
  assert.equal(f.repo.getTicketType('other','application'),null);
  assert.throws(()=>f.repo.setApplicationRole('guild','application','Empty',[]));
  assert.throws(()=>f.repo.setTicketQuestions('guild','application',Array(6).fill('Question?')));
  assert.equal(f.repo.removeApplicationRole('guild','application','DEVELOPER'),true);
  f.repo.setTicketCategory('guild','application',null);assert.equal(f.repo.getTicketType('guild','application').categoryId,null);
 } finally {f.raw.close();}
});
test('role choice opens only the selected form; legacy types still open directly',async()=>{
 const f=setup();try {
  await openTicketForm(f.interaction,f.repo.getTicketType('guild','application'));
  assert.equal(f.calls.modal.components[0].components[0].custom_id,'details');
  f.repo.setApplicationRole('guild','application','Developer',['Languages?']);
  f.repo.setApplicationRole('guild','application','Modeler',['Models?']);
  const config=f.repo.getTicketType('guild','application');
  await openTicketForm(f.interaction,config);
  assert.equal(f.calls.reply.flags,64);
  assert.deepEqual(f.calls.reply.components[0].toJSON().components[0].options.map(o=>o.label),['Developer','Modeler']);
  f.interaction.customId='ticket_application_role:application';f.interaction.values=[config.applicationRoles[1].id];
  await f.handler.handleApplicationRoleSelect(f.interaction);
  assert.equal(f.calls.modal.components[0].components[0].label,'Models?');
 }finally{f.raw.close();}
});
test('application answers and role survive creation in configured category with private overwrites',async()=>{
 const f=setup();try {
  f.repo.setTicketCategory('guild','application','category');
  const questions=Array.from({length:5},(_,i)=>`Question ${i}?`);
  f.repo.setApplicationRole('guild','application','Developer',questions);
  const role=f.repo.getTicketType('guild','application').applicationRoles[0];
  f.interaction.customId+=`:${role.id}`;
  f.calls.values=Object.fromEntries(questions.map((q,i)=>[ticketQuestionId(questions,i),String(i).repeat(1000)]));
  await f.handler.handleTicketCreateModal(f.interaction);
  assert.equal(f.calls.created.parent,'category');
  assert.deepEqual(f.calls.created.permissionOverwrites[0],{id:'everyone',deny:[PermissionFlagsBits.ViewChannel]});
  const embed=f.calls.sent.embeds[0].toJSON();
  assert.equal(embed.fields.find(v=>v.name==='Application role').value,'Developer');
  for(let i=0;i<5;i++)assert.equal(embed.fields.find(v=>v.name===questions[i]).value,String(i).repeat(1000));
  assert.ok(f.calls.sent.embeds[0].length<6000);assert.equal(f.calls.defer.flags,64);
  assert.match(f.calls.result.content,/<#ticket>/);
  assert.ok(f.calls.submission.includes('Application role: Developer'));
  assert.ok(f.calls.submission.includes('4'.repeat(1000)));
 }finally{f.raw.close();}
});
test('missing categories, removed roles, stale forms, and empty required answers do not create tickets',async()=>{
 for(const kind of ['category','role','stale','empty']) {
  const f=setup();try {
   if(kind==='category') {f.repo.setTicketCategory('guild','application','gone');f.interaction.guild.channels.fetch=async()=>null;}
   if(kind==='role') f.interaction.customId+=':removed';
   if(kind==='stale') f.repo.setTicketQuestions('guild','application',['New question?']);
   if(kind==='empty') f.calls.values.details='   ';
   await f.handler.handleTicketCreateModal(f.interaction);
   assert.equal(f.calls.created,undefined,kind);assert.equal(f.calls.reserved,undefined,kind);
   assert.ok(f.calls.reply||f.calls.result,kind);
  }finally{f.raw.close();}
 }
});
test('admin question editor saves role questions and rechecks Manage Server on submission',async()=>{
 const f=setup();try {
  const config=load('../dist/features/tickets/configHandler',{'./ticketConfigRepo':f.repo,'../../db/guildSettingsRepo':{},'./ticketPanel':{}});
  const modal=config.buildConfigEditModal('questions',f.repo.getTicketType('guild','application'),'Moderator').toJSON();
  assert.equal(modal.components.length,5);f.interaction.customId=modal.custom_id;
  f.calls.values=Object.fromEntries(Array.from({length:5},(_,i)=>[`question_${i}`,i===0?'How would you handle a dispute?':'']));
  f.interaction.memberPermissions={has:()=>false};
  await config.handleConfigEditModalSubmit(f.interaction);
  assert.equal(f.repo.getTicketType('guild','application').applicationRoles.length,0);
  f.interaction.memberPermissions={has:()=>true};await config.handleConfigEditModalSubmit(f.interaction);
  assert.deepEqual(f.repo.getTicketType('guild','application').applicationRoles[0].questions,['How would you handle a dispute?']);
 }finally{f.raw.close();}
});

test('original answers persist independently of later configuration and survive migration',()=>{
 const f=database();try {
  const tickets=load('../dist/features/tickets/ticketRepo',{'../../db/connect':{db:f.db}});
  const ticket=tickets.createTicket('guild','application','user','channel','Application role: Developer\nLanguages?\nJava');
  f.repo.setApplicationRole('guild','application','Developer',['Changed question?']);
  migrateDatabase(f.db);
  assert.equal(tickets.getTicketById(ticket.id).submissionText,'Application role: Developer\nLanguages?\nJava');
  tickets.discardUncreatedTicket(ticket.id);assert.ok(tickets.getTicketById(ticket.id));
  const pending=tickets.createTicket('guild','application','user','');
  tickets.discardUncreatedTicket(pending.id);assert.equal(tickets.getTicketById(pending.id),null);
 }finally{f.raw.close();}
});
test('failed category channel creation finishes response and clears its uncreated reservation',async()=>{
 const f=setup();const previous=console.error;try {
  console.error=()=>{};
  f.interaction.guild.channels.create=async()=>{throw Error('Category full');};
  await f.handler.handleTicketCreateModal(f.interaction);
  assert.equal(f.calls.discarded,true);assert.match(f.calls.result,/category capacity/);
 }finally{console.error=previous;f.raw.close();}
});
test('category command validates permissions, stores the destination, and can clear it',async()=>{
 const f=setup();try {
  const {ticketConfigCommand}=load('../dist/features/tickets/commands/ticket-config',{
   '../ticketConfigRepo':f.repo,'../configHandler':{},'../ticketTypeAutocomplete':{}
  });
  const definition=ticketConfigCommand.data.toJSON();
  assert.deepEqual(definition.options.find(o=>o.name==='category').options[1].channel_types,[ChannelType.GuildCategory]);
  let sub='category';
  f.interaction.options={getString:()=> 'application',getSubcommand:()=>sub,getChannel:()=>({id:'category'})};
  f.interaction.memberPermissions={has:()=>false};
  await ticketConfigCommand.execute(f.interaction);
  assert.equal(f.repo.getTicketType('guild','application').categoryId,null);
  f.interaction.memberPermissions={has:()=>true};
  f.interaction.guild.channels.fetch=async()=>({id:'category',type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>false})});
  await ticketConfigCommand.execute(f.interaction);
  assert.equal(f.repo.getTicketType('guild','application').categoryId,null);
  f.interaction.guild.channels.fetch=async()=>({id:'category',type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>true})});
  await ticketConfigCommand.execute(f.interaction);
  assert.equal(f.repo.getTicketType('guild','application').categoryId,'category');
  sub='clear-category';await ticketConfigCommand.execute(f.interaction);
  assert.equal(f.repo.getTicketType('guild','application').categoryId,null);
 }finally{f.raw.close();}
});
