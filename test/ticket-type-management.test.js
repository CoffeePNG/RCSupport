const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const {migrateDatabase}=require('../dist/db/migrations');
const {ChannelType}=require('discord.js');
function load(relative,overrides={}) {
  const file=require.resolve(relative),mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
  const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(overrides,id)?overrides[id]:original(id);
  mod._compile(fs.readFileSync(file,'utf8'),file);return mod.exports;
}
function fixture(t) {
  const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
  const db={exec:sql=>raw.exec(sql),prepare:sql=>raw.prepare(sql),transaction:fn=>(...args)=>{
    raw.exec('BEGIN');try{const value=fn(...args);raw.exec('COMMIT');return value;}catch(error){raw.exec('ROLLBACK');throw error;}
  }};migrateDatabase(db);
  const config=load('../dist/features/tickets/ticketConfigRepo',{'../../db/connect':{db}});
  const tickets=load('../dist/features/tickets/ticketRepo',{'../../db/connect':{db}});
  const input={key:'custom_help',name:'Custom Help',department:'Support',prefix:'custom-help'};
  return {raw,db,config,tickets,input};
}
test('custom type creation is locked, validated, isolated by guild and atomically audited',t=>{
  const f=fixture(t);const created=f.config.createCustomTicketType('guild','actor',f.input);
  assert.equal(created.enabled,false);assert.equal(created.typeKey,'custom_help');
  assert.equal(f.config.getTicketTypes('other').length,0);
  assert.throws(()=>f.config.createCustomTicketType('guild','actor',{...f.input,name:'Overwrite'}),/already exists/);
  assert.equal(f.config.getTicketType('guild','custom_help').displayName,'Custom Help');
  for(const changes of [{key:'invalid:key'},{prefix:'bad prefix'},{name:' '},{department:' '}])
    assert.throws(()=>f.config.createCustomTicketType('guild','actor',{...f.input,...changes}));
  const audit=f.raw.prepare('SELECT * FROM ticket_config_audit').all();assert.equal(audit.length,1);
  assert.equal(audit[0].actor_id,'actor');assert.equal(audit[0].action,'TYPE_CREATE');
  f.raw.exec("CREATE TRIGGER reject_config_audit BEFORE INSERT ON ticket_config_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.throws(()=>f.config.createCustomTicketType('guild','actor',{...f.input,key:'rollback'}),/audit unavailable/);
  assert.equal(f.config.getTicketType('guild','rollback'),null);
});
test('lock survives migrations and default seeding; existing tickets remain claimable',t=>{
  const f=fixture(t),seed={guildId:'guild',typeKey:'help',displayName:'Help',department:'Support',channelPrefix:'help',openMessage:'Hello',claimMessage:'Hello',optionDescription:null};
  const original=f.config.ensureTicketType(seed);assert.equal(original.enabled,true);
  const ticket=f.tickets.createTicket('guild','help','user','channel');
  f.config.setTicketTypeEnabled('guild','help',false,'actor');migrateDatabase(f.db);f.config.ensureTicketType(seed);
  assert.equal(f.config.getTicketType('guild','help').enabled,false);
  assert.throws(()=>f.tickets.createTicket('guild','help','user',''),/locked/);
  assert.equal(f.tickets.claimTicket(ticket.id,'lead').status,'claimed');
  f.config.setTicketTypeEnabled('guild','help',false,'actor');
  f.config.setTicketTypeEnabled('guild','help',true,'actor');
  assert.ok(f.tickets.createTicket('guild','help','user','new-channel'));
  assert.deepEqual(f.raw.prepare('SELECT action FROM ticket_config_audit ORDER BY id').all().map(row=>row.action),['TYPE_LOCK','TYPE_UNLOCK']);
});
test('creation enforces the panel type limit without partially saving the rejected type',t=>{
  const f=fixture(t);
  for(let i=0;i<25;i++) f.config.createCustomTicketType('guild','actor',{...f.input,key:`type-${i}`});
  assert.throws(()=>f.config.createCustomTicketType('guild','actor',{...f.input,key:'overflow'}),/25 ticket types/);
  assert.equal(f.config.getTicketTypes('guild').length,25);
});
test('all-locked panel removes selectable controls; unlock restores only enabled types',t=>{
  const f=fixture(t);f.config.createCustomTicketType('guild','actor',f.input);
  const panel=load('../dist/features/tickets/ticketPanel',{'./ticketConfigRepo':f.config,
    '../../db/guildSettingsRepo':{getGuildSettings:()=>({panelTitle:null,panelDescription:'Configured custom description'})}});
  let content=panel.buildPanelContent('guild');assert.equal(content.row,null);assert.match(content.embed.toJSON().description,/temporarily locked/);
  f.config.setTicketTypeEnabled('guild','custom_help',true,'actor');f.config.createCustomTicketType('guild','actor',{...f.input,key:'locked'});
  content=panel.buildPanelContent('guild');assert.deepEqual(content.row.toJSON().components[0].options.map(o=>o.value),['custom_help']);
  assert.equal(content.embed.toJSON().description,'Configured custom description');
});
test('public autocomplete hides locked types while administrative autocomplete can find them',async t=>{
  const f=fixture(t);f.config.createCustomTicketType('guild','actor',f.input);
  const autocomplete=load('../dist/features/tickets/ticketTypeAutocomplete',{'./ticketConfigRepo':f.config});
  const results=[],interaction={guildId:'guild',options:{getFocused:()=>''},respond:async value=>results.push(value)};
  await autocomplete.respondTicketTypeAutocomplete(interaction,false);assert.deepEqual(results[0],[]);
  await autocomplete.respondTicketTypeAutocomplete(interaction);assert.equal(results[1][0].name,'Custom Help (locked)');
});
test('stale forms are blocked both before opening and when lock occurs during channel validation',async t=>{
  const f=fixture(t);f.config.createCustomTicketType('guild','actor',f.input);
  const {openTicketForm}=require('../dist/features/tickets/ticketModal');let replied='',created=0;
  await openTicketForm({reply:async p=>{replied=p.content;},showModal:async()=>{throw Error('must not open');}},f.config.getTicketType('guild','custom_help'));
  assert.match(replied,/locked/);
  f.config.setTicketTypeEnabled('guild','custom_help',true,'actor');f.config.setTicketCategory('guild','custom_help','category');
  const handler=load('../dist/features/tickets/ticketHandler',{'./ticketConfigRepo':f.config,'./ticketRepo':f.tickets,'./cleanup':{},'../../utils/permissions':{}});
  const interaction={guildId:'guild',customId:'ticket_create_modal:custom_help',user:{id:'user',username:'User'},
    fields:{getTextInputValue:()=> 'Details'},deferReply:async()=>{},reply:async p=>{replied=p.content;},editReply:async p=>{replied=p;},
    guild:{members:{fetchMe:async()=>({})},channels:{fetch:async()=>{
      f.config.setTicketTypeEnabled('guild','custom_help',false,'actor');return {type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>true})};
    },create:async()=>{created++;throw Error('must not create');}}}};
  const previous=console.error;console.error=()=>{};
  try {await handler.handleTicketCreateModal(interaction);}finally{console.error=previous;}
  assert.match(replied,/locked/);assert.equal(created,0);assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,0);
});
test('real configuration commands enforce Manage Server and preserve saved lock when panel refresh fails',async t=>{
  const f=fixture(t),calls=[];
  const {ticketConfigCommand}=load('../dist/features/tickets/commands/ticket-config',{
    '../workflowCommands':{...require('../dist/features/tickets/workflowDefinitions')},
    '../ticketConfigRepo':f.config,'../ticketRepo':f.tickets,'../configInspection':{},'../configHandler':{},'../ticketTypeAutocomplete':{},
    '../ticketPanel':{refreshPostedPanel:async()=>{throw Error('Panel unavailable');}},
  });
  let sub='create',allowed=false;
  const values={key:'custom_help',name:'Custom Help',department:'Support',type:'custom_help'};
  const interaction={guildId:'guild',user:{id:'actor'},client:{},memberPermissions:{has:()=>allowed},
    options:{getSubcommand:()=>sub,getString:key=>values[key]??null},deferReply:async()=>{},reply:async p=>calls.push(p),editReply:async p=>calls.push(p)};
  await ticketConfigCommand.execute(interaction);assert.equal(f.config.getTicketTypes('guild').length,0);
  const previous=console.error;console.error=()=>{};
  try {
    allowed=true;await ticketConfigCommand.execute(interaction);assert.equal(f.config.getTicketType('guild','custom_help').enabled,false);
    sub='unlock';await ticketConfigCommand.execute(interaction);assert.equal(f.config.getTicketType('guild','custom_help').enabled,true);
    sub='lock';await ticketConfigCommand.execute(interaction);assert.equal(f.config.getTicketType('guild','custom_help').enabled,false);
    assert.match(calls.at(-1).content,/No published panel was refreshed/);
  }finally{console.error=previous;}
  assert.ok(ticketConfigCommand.data.toJSON().options.some(option=>option.name==='create'));
});
