const {test}=require('node:test');
const assert=require('node:assert/strict');
const {confirmThreadDeletion}=require('../dist/features/bugReports/deleteThread');
function fixture(choice='confirm') {
  const replies=[];let deletes=0;
  const i={id:'click',guildId:'guild',channelId:'123456789012345678',user:{id:'admin'},client:{user:{id:'bot'}},message:{id:'starter'},
    isButton:()=>true,isChatInputCommand:()=>false,deferReply:async()=>{},
    editReply:async value=>{replies.push(value);return {awaitMessageComponent:async options=>{
      assert.equal(options.filter({user:{id:'other'},customId:'rcsupport:delete:click'}),false);
      if(choice==='timeout')throw new Error('expired');
      return {customId:choice==='cancel'?'rcsupport:keep:click':'rcsupport:delete:click',update:async()=>{}};
    }};},
  };
  const forum={deletionTarget:async(g,p,u,closed)=>{assert.equal(closed,true);return {name:'Closed report',fetchStarterMessage:async()=>({id:'starter',author:{id:'bot'}})};},
    deleteReportThread:async(g,p,u,closed)=>{assert.equal(closed,true);assert.equal(u,'admin');deletes++;}};
  return {i,forum,replies,deletes:()=>deletes};
}
for(const choice of ['confirm','cancel','timeout'])test('Delete button confirmation: '+choice,async()=>{
  const f=fixture(choice);await confirmThreadDeletion(f.i,f.forum);
  assert.equal(f.deletes(),choice==='confirm'?1:0);
  assert.ok(f.replies[0].embeds[0].toJSON().description.includes('cannot be undone'));
});
test('non-admins and forged starter buttons cannot reach the deletion confirmation',async()=>{
  const denied=fixture();denied.forum.deletionTarget=async()=>{throw new Error('Manage Server and Manage Threads are required.');};
  await confirmThreadDeletion(denied.i,denied.forum);assert.equal(denied.deletes(),0);assert.match(denied.replies[0].content,/Manage Server/);
  const forged=fixture();forged.i.message.id='other';await confirmThreadDeletion(forged.i,forged.forum);
  assert.equal(forged.deletes(),0);assert.match(forged.replies[0].content,/original report/);
});
