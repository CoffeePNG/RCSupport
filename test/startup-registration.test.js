const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const {Events}=require('discord.js');
function fixture({enabled=true,failRegistration=false}={}) {
  const calls=[],handlers={},logs=[];
  let releaseForum;
  const blockedForum=new Promise(resolve=>{releaseForum=resolve;});
  class Client {
    constructor(){this.rest={};this.user={id:'bot',tag:'Bot'};this.guilds={cache:new Map([['guild',{id:'guild'}]])};}
    once(event,handler){handlers[event]=()=>handler(this);}
    on(){}
    login(){calls.push('login');}
  }
  const overrides={
    'discord.js':{Client,Events,GatewayIntentBits:{}},
    './config':{config:{token:'test',guildIds:['guild','second'],databasePath:'unused',deployCommandsOnStart:enabled}},
    './commands/index':{commands:[]},
    './commands/registration':{syncGuildCommands:async(_,id,guild)=>{calls.push(`register:${guild}`);if(failRegistration)throw Error('Discord unavailable');return 1;}},
    './events/interactionCreate':{},'./db/connect':{db:{}},
    './features/tickets/defaultTicketTypes':{seedDefaultTicketTypes:()=>calls.push('seed')},
    './features/serverStatus/panel':{startServerStatus:()=>calls.push('status')},
    './services/zen':{startZen:()=>calls.push('zen')},
    './features/bugReports/config':{loadBridgeConfig:()=>({})},
    './features/bugReports/forum':{RCSupportForum:class {start(){calls.push('forum');return blockedForum;}}},
  };
  const file=require.resolve('../dist/index'),mod=new Module(file,module);
  mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
  mod.require=id=>{assert.ok(Object.hasOwn(overrides,id),`Unexpected dependency: ${id}`);return overrides[id];};
  mod._compile(fs.readFileSync(file,'utf8'),file);
  return {calls,handlers,releaseForum,logs};
}
test('normal startup registers every guild while initial bridge sync is still blocked',async()=>{
  const f=fixture(),previous=console.log;console.log=()=>{};
  try {
    const ready=f.handlers[Events.ClientReady]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(f.calls.indexOf('register:guild')<f.calls.indexOf('forum'));
    assert.ok(f.calls.indexOf('register:guild')<f.calls.indexOf('status'));
    assert.ok(f.calls.includes('register:second'));
    f.releaseForum();await ready;
  }finally{console.log=previous;f.releaseForum();}
});
test('disabled startup registration is explicit and still starts the bridge',async()=>{
  const f=fixture({enabled:false}),previous=console.log;console.log=text=>f.logs.push(text);
  try {
    const ready=f.handlers[Events.ClientReady]();
    assert.ok(!f.calls.some(c=>c.startsWith('register:')));assert.ok(f.calls.includes('forum'));
    assert.ok(f.logs.some(line=>line.includes('DEPLOY_COMMANDS_ON_START=false')));
    f.releaseForum();await ready;
  }finally{console.log=previous;f.releaseForum();}
});
test('a registration failure cannot block services or registration of another guild',async()=>{
  const f=fixture({failRegistration:true}),previousLog=console.log,previousError=console.error;
  console.log=()=>{};console.error=(...args)=>f.logs.push(args[0]);
  try {
    const ready=f.handlers[Events.ClientReady]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(f.calls.includes('forum'));assert.ok(f.calls.includes('register:second'));
    assert.equal(f.logs.length,2);f.releaseForum();await ready;
  }finally{console.log=previousLog;console.error=previousError;f.releaseForum();}
});
