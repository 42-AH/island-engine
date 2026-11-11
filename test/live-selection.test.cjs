const {test}=require('node:test');
const assert=require('node:assert/strict');
const {candidates,hits}=require('../ui/live-selection.js');
const object=(path,name,left,top,width,height,uid)=>({path,name,left,top,width,height,uid,shown:true,kind:'MovieClip',depth:path.split('/').length});
const character=object('stage/room/person','person',100,100,80,150,3);
const eye=object('stage/room/person/eye','eye',120,120,5,5,4);
const room=object('stage/room','room',0,0,960,640,1);
const sign=object('stage/room/sign','sign',130,130,100,80,5);
const hud=object('stage/hud~Sprite[0]','hud',0,0,50,50,6);
const scene={width:960,height:640,objects:[room,character,eye,sign,hud]};
test('ordinary picking groups character parts and excludes large containers and HUD',()=>{
 assert.deepEqual(candidates(scene).map(o=>o.name),['person','sign']);
 assert.deepEqual(hits(candidates(scene),{x:121,y:121}).map(o=>o.name),['person']);
});
test('parts and advanced views retain access to every display object',()=>{
 assert.deepEqual(candidates(scene,{parts:character.path}).map(o=>o.name),['eye']);
 assert.equal(candidates(scene,{advanced:true}).length,5);
});
test('anonymous runtime character assemblies stay whole and scene overlays stay out',()=>{
 const room=object('stage/instanceRoom','instance120',0,0,1600,900,10);
 const person=object(room.path+'/instance198','instance198',200,200,61.5,108.75,11);
 const body=object(person.path+'/body','body',200,230,40,60,12);
 const color=object(body.path+'/colorFill','colorFill',205,235,30,40,13);
 const hair=object(person.path+'/hairShape','hairShape',200,200,61.5,30,14);
 const hud=object('stage/sceneOverlayContainer','sceneOverlayContainer',10,10,40,40,15);
 const hudPart=object(hud.path+'/instance300','instance300',10,10,40,40,16);
 const scene={width:960,height:640,objects:[room,person,body,color,hair,hud,hudPart]};
 assert.deepEqual(candidates(scene).map(o=>o.uid),[11]);
 assert.deepEqual(hits(candidates(scene),{x:210,y:240}).map(o=>o.uid),[11]);
 assert.equal(candidates(scene,{parts:person.path}).length,3);
 assert.equal(candidates(scene,{advanced:true}).length,7);
});
test('search, locks and hit testing use the same filtered candidates',()=>{
 assert.deepEqual(hits(candidates(scene,{query:'sign'}),{x:140,y:140}).map(o=>o.name),['sign']);
 assert.deepEqual(hits(candidates(scene,{locked:new Set([5])}),{x:140,y:140}).map(o=>o.name),['person']);
 assert.deepEqual(hits(candidates(scene),{x:140,y:140}).map(o=>o.name),['sign','person']);
 assert.equal(candidates(scene,{advanced:true,locked:new Set([3])}).some(o=>o.name==='eye'),false);
});
test('background scope exposes large artwork without exposing enclosing scene containers',()=>{
 const backdrop=object(room.path+'/bitmap','instance88',0,0,3707,910,90);
 const scene={width:960,height:640,objects:[room,backdrop,character,eye]};
 assert.deepEqual(candidates(scene).map(o=>o.name),['person']);
 assert.deepEqual(candidates(scene,{backgrounds:true}).map(o=>o.name),['instance88','person']);
});
test('AS2 navigation and known advertising hit areas stay in the advanced view',()=>{
 const nav=object('stage/navBar','navBar',0,0,789,599,91),hit=object('stage/camera/scene/adPrepHit1','adPrepHit1',0,0,216,56,92);
 const state={width:1136,height:673,objects:[nav,hit,character]};
 assert.deepEqual(candidates(state).map(o=>o.name),['person']);
 assert.equal(candidates(state,{advanced:true}).length,3);
});

test('separate named objects in a small group remain selectable',()=>{
 const group=object('stage/props','props',100,100,300,200,100);
 const sign=object('stage/props/sign','sign',100,100,100,80,101);
 const door=object('stage/props/door','door',250,100,80,180,102);
 const state={width:960,height:640,objects:[group,sign,door]};
 assert.deepEqual(candidates(state).map(o=>o.name),['sign','door']);
});
test('search can reveal a named part without exposing unrelated parts',()=>{
 const result=candidates(scene,{query:'eye'});
 assert.deepEqual(result.map(o=>o.name),['eye']);
 assert.deepEqual(hits(result,{x:122,y:122}).map(o=>o.name),['eye']);
});

test('hidden setup clips do not split an AS2 character into loose parts',()=>{
 const char=object('stage/char','char',100,100,80,150,110);
 const avatar=object('stage/char/avatar','avatar',100,100,80,150,111);
 const head=object(avatar.path+'/head','head',100,100,60,60,112);
 const body=object(avatar.path+'/body','body',110,160,40,80,113);
 const helper1=object(avatar.path+'/colorSetter','colorSetter',0,0,0,0,114);
 const helper2=object(avatar.path+'/breath','breath',0,0,0,0,115);
 assert.deepEqual(candidates({width:960,height:640,objects:[char,avatar,head,body,helper1,helper2]}).map(o=>o.uid),[110]);
});
