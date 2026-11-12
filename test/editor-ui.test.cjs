const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ui/editor.js'),'utf8');
function setup(extra={}) {
 const nodes=new Map(),listeners=new Map(),calls=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,disabled:false,textContent:'',setAttribute(){},contentWindow:{}});return nodes.get(id);};
 const context=vm.createContext({$,project:{id:'test'},Date,Map,Error,location:{origin:'http://local'},setTimeout,clearTimeout,setInterval,clearInterval,
 document:{body:{classList:{add(){},remove(){}}}},updateSaveState(){},closeCodeView(){},el(){return {append(){}};},dialog:async()=>'ok',
 window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),liveEditor:{close(){},open(){}}},
 saveCurrent:async()=>calls.push('save'),status:text=>calls.push(text),message:async()=>{},call:async name=>{calls.push(name);return name==='status'?{logs:['log']}:{};},...extra});
 vm.runInContext(source.slice(source.indexOf('let buildBusy = false;'),source.indexOf('async function doBuild()')),context);
 return {context,$,calls,listeners,run:()=>vm.runInContext('buildOperation(true)',context)};
}
test('Play remains busy through inspector preparation and player readiness; repeated Play does not rebuild',async()=>{
 let release;const gate=new Promise(r=>release=r);const env=setup();
 env.context.call=async name=>{env.calls.push(name);if(name==='play')await gate;return name==='status'?{logs:[]}:{};};
 const running=env.run();await new Promise(setImmediate);
 assert.equal(env.$('#buildStage').textContent,'Getting the player ready…');assert.equal(env.$('#play').disabled,true);
 await env.run();assert.equal(env.calls.filter(x=>x==='build').length,1);
 release();await new Promise(setImmediate);
 assert.equal(env.$('#buildStage').textContent,'Starting the game…');assert.equal(env.$('#buildProgress').hidden,false);
 env.listeners.get('message')({source:env.$('#game').contentWindow,origin:'http://local',data:{type:'islandengine-player-ready'}});
 await running;assert.equal(env.$('#buildProgress').hidden,true);assert.equal(env.$('#play').disabled,false);
 assert.equal(env.calls.includes('Build complete'),false);
});
test('build failure restores controls and exposes log',async()=>{
 const env=setup({call:async name=>{if(name==='build')throw Error('compiler failed');return {logs:[]};}});
 await assert.rejects(env.run(),/compiler failed/);
 assert.equal(env.$('#play').disabled,false);assert.equal(env.$('#log').hidden,false);assert.equal(env.$('#buildProgress').hidden,true);
});
function keys() {
 let handler;const nodes={'#playView':{hidden:true},'#codeView':{hidden:true},'#modal':{open:false},'#tool':{dataset:{active:'select'}}};
 const object={id:'art1',kind:'art',x:10,y:20};const events=[];
 const ctx=vm.createContext({structuredClone,window:{},document:{addEventListener:(_,fn)=>handler=fn},$:id=>nodes[id],project:{mode:'new'},room:{objects:[object]},selected:object,history:[],future:[],drag:null,buildBusy:false,
 snapshot:()=>events.push('snapshot'),unique:()=> 'art2',inspect(){},changed(){},status(){},restore:()=>events.push('restore'),removeSelected:()=>events.push('remove'),task:fn=>fn(),saveCurrent:()=>events.push('save')});
 vm.runInContext(source.slice(source.indexOf('let objectClipboard = null;'),source.indexOf('$("#source").onkeydown')),ctx);
 return {ctx,events,press:(key,options={})=>handler({key,target:{closest:()=>false},preventDefault(){events.push('prevent');},...options})};
}
test('text fields keep clipboard, undo and arrow keys; Save uses common save',()=>{
 const k=keys();for(const key of ['c','v','x','z','ArrowLeft','Delete'])k.press(key,{ctrlKey:true,target:{closest:()=>true}});
 assert.deepEqual(k.events,[]);k.press('s',{ctrlKey:true});assert.deepEqual(k.events,['prevent','save']);
});
test('canvas copy/paste preserves source and nudges selection with undo snapshot',()=>{
 const k=keys();k.press('c',{ctrlKey:true});k.press('v',{ctrlKey:true});
 assert.equal(k.ctx.room.objects.length,2);assert.equal(k.ctx.room.objects[0].x,10);assert.equal(k.ctx.selected.x,40);
 k.press('ArrowRight',{shiftKey:true});assert.equal(k.ctx.selected.x,50);assert.equal(k.events.filter(x=>x==='snapshot').length,2);
});
