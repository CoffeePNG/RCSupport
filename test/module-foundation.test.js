const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PermissionFlagsBits}=require('discord.js');
const {resolveGuildConfiguration}=require('../dist/config/guilds');
const {isGuildAllowed,accessDenial}=require('../dist/security/access');
const {dispatchComponent,route,prefix}=require('../dist/interactions/router');
const publicId='111111111111111111',staffId='222222222222222222';

test('semantic guilds preserve cleanup targets and replace the legacy archive pin',()=>{
  const config=resolveGuildConfiguration({PUBLIC_GUILD_ID:publicId,STAFF_GUILD_ID:staffId,
    DISCORD_GUILD_IDS:`old,${publicId},old`,ARCHIVE_GUILD_IDS:'legacy-staff'});
  assert.deepEqual(config.deploymentIds,['old',publicId,staffId]);
  assert.deepEqual(config.publicIds,[publicId]);assert.deepEqual(config.staffIds,[staffId]);
});
test('legacy deployments retain ticket availability and archive restrictions',()=>{
  const config=resolveGuildConfiguration({DISCORD_GUILD_ID:'old'});
  assert.deepEqual(config.deploymentIds,['old']);assert.equal(config.publicIds,undefined);
  assert.deepEqual(config.staffIds,['903819888903200798']);
  assert.deepEqual(resolveGuildConfiguration({ARCHIVE_GUILD_IDS:'a,b,a'}).staffIds,['a','b']);
});
test('partial, malformed and identical semantic guild configuration is rejected',()=>{
  for(const env of [{PUBLIC_GUILD_ID:publicId},{STAFF_GUILD_ID:staffId},
    {PUBLIC_GUILD_ID:'bad',STAFF_GUILD_ID:staffId},{PUBLIC_GUILD_ID:publicId,STAFF_GUILD_ID:publicId}]) {
    assert.throws(()=>resolveGuildConfiguration(env));
  }
});
test('shared authorization intersects scopes, supports administrator and fails closed',()=>{
  const policy={module:{id:'tickets',guildIds:['a','b']},guildIds:['b','c'],requiredPermissions:PermissionFlagsBits.ManageGuild};
  assert.equal(isGuildAllowed(policy,'a'),false);assert.equal(isGuildAllowed(policy,'b'),true);
  assert.ok(accessDenial(policy,{guildId:'b',permissions:0n}));
  assert.equal(accessDenial(policy,{guildId:'b',permissions:PermissionFlagsBits.ManageGuild}),undefined);
  assert.equal(accessDenial(policy,{guildId:'b',permissions:PermissionFlagsBits.Administrator}),undefined);
  assert.ok(accessDenial(policy,{guildId:'c',permissions:PermissionFlagsBits.Administrator}));
  assert.equal(isGuildAllowed({module:{id:'disabled',guildIds:[]}},'b'),false);
  assert.equal(isGuildAllowed(policy,null),false);
});
test('saved components in another guild cannot reach handlers, including select menus',async()=>{
  for(const kind of ['button','modal','stringSelect','userSelect']) {
    let executed=0,replies=0;
    const routes=[route(kind,prefix('ticket:'),async()=>executed++,{module:{id:'tickets',guildIds:[publicId]}})];
    const interaction={customId:'ticket:saved',guildId:staffId,
      isButton:()=>kind==='button',isModalSubmit:()=>kind==='modal',
      isStringSelectMenu:()=>kind==='stringSelect',isUserSelectMenu:()=>kind==='userSelect',reply:async()=>replies++};
    assert.equal(await dispatchComponent(interaction,routes),true);
    assert.equal(executed,0);assert.equal(replies,1);
    await dispatchComponent({...interaction,guildId:publicId},routes);assert.equal(executed,1);
  }
});
test('real command deployment filters tickets and archive without moving unreviewed features',()=>{
  // A separate module cache avoids existing test files' global repository stubs.
  const output=execFileSync(process.execPath,['-e',`
    const assert=require('node:assert/strict');
    require.cache[require.resolve('./dist/db/connect')]={exports:{db:{}}};
    const {commandBodyFor,syncGuildCommands}=require('./dist/commands/registration');
    const names=id=>commandBodyFor(id).map(c=>c.name);
    const pub=names('${publicId}'),staff=names('${staffId}'),old=names('old');
    for(const name of ['ticket','ticket-panel','ticket-config','staff-assign','staff-status']) {
      assert.ok(pub.includes(name),name);assert.ok(!staff.includes(name),name);assert.ok(!old.includes(name),name);
    }
    assert.ok(staff.includes('staff'));assert.ok(!pub.includes('staff'));assert.ok(!old.includes('staff'));
    assert.ok(staff.includes('archive'));assert.ok(!pub.includes('archive'));assert.ok(!old.includes('archive'));
    for(const name of ['purge','todo','bugreport','servers','vault']) {
      assert.ok(pub.includes(name),name);assert.ok(staff.includes(name),name);
    }
    const {commands}=require('./dist/commands/index');
    const {PermissionFlagsBits}=require('discord.js');
    for(const name of ['ticket-panel','ticket-config','staff-assign','staff-status']) {
      assert.equal(commands.find(c=>c.data.name===name).requiredPermissions,PermissionFlagsBits.ManageGuild);
    }
    const {handleInteraction}=require('./dist/events/interactionCreate');
    (async()=>{
      await syncGuildCommands({put:async(_,payload)=>assert.deepEqual(payload.body,commandBodyFor('old'))},'bot','old');
      for(const [kind,id] of [['button','ticket_claim:1'],['modal','ticket_panel_edit'],
        ['modal','ticket_create_modal:application'],['select','ticket_panel_select']]) {
        let replies=0;
        await handleInteraction({guildId:'${staffId}',customId:id,
          isChatInputCommand:()=>false,isAutocomplete:()=>false,
          isButton:()=>kind==='button',isModalSubmit:()=>kind==='modal',
          isStringSelectMenu:()=>kind==='select',isUserSelectMenu:()=>false,
          isRepliable:()=>true,reply:async payload=>{assert.match(payload.content,/available in this server/);replies++;}
        },new Map());
        assert.equal(replies,1,id);
      }
      console.log('ok');
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,
    PUBLIC_GUILD_ID:publicId,STAFF_GUILD_ID:staffId,DISCORD_GUILD_IDS:'old'}});
  assert.match(output,/ok/);
});
