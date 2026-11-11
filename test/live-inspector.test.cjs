const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture(){
 const listeners={},registry=new Map();
 class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.hidden=false;this.style={};this.clientWidth=960;this.clientHeight=640;this.attributes={};}
  set id(value){this._id=value;registry.set('#'+value,this);}get id(){return this._id;}
  append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=nodes;}
  setAttribute(k,v){this.attributes[k]=v;}scrollIntoView(){}setPointerCapture(){}
  contains(){return false;}closest(){return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName)?this:null;}
  getBoundingClientRect(){return {left:0,top:0,width:960,height:640};}
  querySelector(selector){if(selector.startsWith('#'))return registry.get(selector);return null;}
 }
 const drawing={strokeRect(){},setTransform(){},clearRect(){},fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},measureText:s=>({width:s.length*6})};
 const document={createElement:tag=>new Element(tag),querySelector:s=>registry.get(s),addEventListener:(name,fn)=>listeners[name]=fn,activeElement:null};
 for(const id of ['game','liveOverlay','liveInspector','liveInspect','liveWalk','liveOverlaps','playView','inspector','modal']){const e=new Element();e.id=id;}
 const overlay=registry.get('#liveOverlay');overlay.parentElement=new Element();overlay.getContext=()=>drawing;
 const base={uid:1,path:'stage/sign',name:'sign',kind:'MovieClip',x:100,y:100,left:100,top:100,width:100,height:80,originX:100,originY:100,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:true,shown:true,depth:2};let objects=[{...base}],stored=[];
 const bridge={ready:true,snapshot:()=>({room:'test',width:960,height:640,objects:structuredClone(objects)}),edit:(room,p,values,uid)=>{const o=objects.find(o=>o.path===p&&o.uid===uid);if(!o)return {error:'Missing'};if(values.dragX!=null)values={x:values.dragX,y:values.dragY};Object.assign(o,values);o.left=o.originX=o.x;o.top=o.originY=o.y;return {values:structuredClone(o)};},setRules:rules=>{objects=[{...base}];for(const r of rules)Object.assign(objects[0],r.values);objects[0].left=objects[0].originX=objects[0].x;objects[0].top=objects[0].originY=objects[0].y;}};
 const frame=registry.get('#game');frame.src='player.html';frame.contentWindow={liveBridge:bridge,gamePlayer:{ruffle:()=>({resume(){},suspend(){}})}};
 const sandbox={document,window:{dispatchEvent(){}},Event:class{},structuredClone,devicePixelRatio:1,selected:null,project:{id:'test',mode:'existing',liveEdits:[]},dirty:false,setInterval(){},liveSelection:require('../ui/live-selection.js'),call:async(name,args)=>{if(name==='liveEdit'){stored=stored.filter(r=>r.path!==args.edit.path);if(Object.keys(args.edit.values).length)stored.push(args.edit);return structuredClone(stored);}},task:fn=>fn()};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/live-edit.js'),'utf8'),sandbox);registry.get('#liveInspect').onclick();sandbox.window.liveEditor.select(objects[0]);
 return {api:sandbox.window.liveEditor,objects:()=>objects,registry,listeners,Element,overlay,sandbox,bridge};
}
test('live properties undo and redo, including an undo after saving',async()=>{
 const f=fixture();f.api.apply({x:130});assert.equal(f.objects()[0].x,130);assert.equal(f.api.hasUnsaved,true);
 f.api.undo();assert.equal(f.objects()[0].x,100);f.api.redo();assert.equal(f.objects()[0].x,130);
 await f.api.save();assert.equal(f.api.hasUnsaved,false);f.api.undo();assert.equal(f.objects()[0].x,100);assert.equal(f.api.hasUnsaved,true);
});
test('only handle drags move objects; whole drag is one undo step; Escape cancels',()=>{
 const f=fixture(),event=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){}});
 f.overlay.onpointerdown(event(110,110));f.overlay.onpointermove(event(120,120));f.overlay.onpointerup();assert.equal(f.objects()[0].x,100);
 f.overlay.onpointerdown(event(150,140));f.overlay.onpointermove(event(160,140));f.overlay.onpointermove(event(170,140));f.overlay.onpointerup();assert.equal(f.objects()[0].x,120);
 f.api.undo();assert.equal(f.objects()[0].x,100);
 f.overlay.onpointerdown(event(150,140));f.overlay.onpointermove(event(180,140));f.listeners.keydown({key:'Escape',target:new f.Element(),preventDefault(){}});assert.equal(f.objects()[0].x,100);
});
test('text focus keeps native shortcuts and UID replacement clears selection',()=>{
 const f=fixture();let intercepted=false;
 f.listeners.keydown({key:'ArrowRight',target:new f.Element('input'),preventDefault(){intercepted=true;}});assert.equal(intercepted,false);assert.equal(f.objects()[0].x,100);
 f.objects()[0].uid=2;f.api.refresh();f.api.apply({x:400});assert.equal(f.objects()[0].x,100);assert.match(f.registry.get('#liveNotice').textContent,/left the scene/);
});
test('parts navigation appears immediately and retains its whole object',()=>{
 const f=fixture(),whole=f.objects()[0];f.objects().push({...whole,path:whole.path+'/eye',name:'eye',uid:2,width:5,height:5});f.api.refresh();f.api.select(whole);
 const find=(element,text)=>element.children.find(n=>n.textContent===text)||element.children.map(n=>find(n,text)).find(Boolean);
 find(f.registry.get('#liveProperties'),'Edit parts').onclick();assert.ok(find(f.registry.get('#liveProperties'),'Back to whole object'));
 f.api.select(f.objects()[1]);assert.equal(find(f.registry.get('#liveProperties'),'Edit parts'),undefined);
 find(f.registry.get('#liveProperties'),'Back to whole object').onclick();assert.equal(f.registry.get('#liveProperties').children[0].textContent,'sign');
});
test('a restarted player reapplies drafts but drops history tied to the old runtime',()=>{
 const f=fixture(),snapshot=f.bridge.snapshot;let epoch='one';f.bridge.snapshot=()=>({...snapshot(),epoch});f.api.refresh();f.api.apply({x:140});epoch='two';f.api.refresh();
 assert.equal(f.api.hasUnsaved,true);assert.equal(f.objects()[0].x,140);f.api.undo();assert.equal(f.objects()[0].x,140);
 assert.match(f.registry.get('#liveNotice').textContent,/restarted/);
});
test('lost pointer capture cancels the active drag',()=>{
 const f=fixture(),event=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){}});
 f.overlay.onpointerdown(event(150,140));f.overlay.onpointermove(event(180,140));assert.equal(f.objects()[0].x,130);f.overlay.onlostpointercapture();assert.equal(f.objects()[0].x,100);
});
test('view zoom and pan never edit objects and Walk restores the normal view',()=>{
 const f=fixture();let view;f.bridge.setView=value=>view={...value};
 const find=(element,text)=>element.children.find(n=>n.textContent===text)||element.children.map(n=>find(n,text)).find(Boolean);
 find(f.registry.get('#liveInspector'),'+').onclick();assert.equal(view.zoom,1.25);
 f.listeners.keydown({key:' ',code:'Space',target:new f.Element(),preventDefault(){}});
 const event=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){}});
 f.overlay.onpointerdown(event(50,50));f.overlay.onpointermove(event(80,70));f.overlay.onpointerup();assert.equal(view.x,30);assert.equal(view.y,20);assert.equal(f.api.hasUnsaved,false);
 f.registry.get('#liveWalk').onclick();assert.equal(view.zoom,1);assert.equal(view.x,0);f.registry.get('#liveWalk').onclick();assert.equal(view.zoom,1.25);assert.equal(view.x,30);
 find(f.registry.get('#liveInspector'),'Focus selected').onclick();assert.ok(view.zoom>1);f.api.close();assert.equal(view.zoom,1);
});
test('resetting one property preserves other edits and can be undone',()=>{
 const f=fixture();f.api.apply({x:140,alpha:.5});
 const find=(element,label)=>element.children.find(n=>n.attributes['aria-label']===label)||element.children.map(n=>find(n,label)).find(Boolean);
 find(f.registry.get('#liveProperties'),'Reset X').onclick();assert.equal(f.objects()[0].x,100);assert.equal(f.objects()[0].alpha,.5);f.api.undo();assert.equal(f.objects()[0].x,140);assert.equal(f.objects()[0].alpha,.5);
});
test('walking resumes animation paused for inspection',()=>{
 const f=fixture();let playing=true;f.registry.get('#game').contentWindow.gamePlayer.ruffle=()=>({resume(){playing=true;},suspend(){playing=false;}});
 const pause=f.registry.get('#livePause');pause.onclick({currentTarget:pause});assert.equal(playing,false);assert.equal(pause.textContent,'Resume');
 f.registry.get('#liveWalk').onclick();assert.equal(playing,true);assert.equal(pause.textContent,'Pause');assert.equal(pause.attributes['aria-pressed'],'false');
 f.registry.get('#liveWalk').onclick();assert.equal(playing,true);
});
test('Focus reveals offscreen objects in the list and canvas picking follows the view',()=>{
 const f=fixture(),object=f.objects()[0];Object.assign(object,{left:1200,x:1200,originX:1200});f.api.refresh();
 assert.equal(f.registry.get('#liveList').children.length,0);f.api.select(object);
 const find=(element,text)=>element.children.find(n=>n.textContent===text)||element.children.map(n=>find(n,text)).find(Boolean);
 find(f.registry.get('#liveInspector'),'Focus selected').onclick();assert.equal(f.registry.get('#liveList').children.length,1);
 find(f.registry.get('#liveProperties'),'Clear selection').onclick();
 f.overlay.onpointerdown({button:0,clientX:480,clientY:320,pointerId:1,preventDefault(){}});
 assert.equal(f.registry.get('#liveProperties').children[0].textContent,'sign');
 find(f.registry.get('#liveInspector'),'Fit').onclick();assert.equal(f.registry.get('#liveList').children.length,0);
});
