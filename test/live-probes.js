(async()=>{
 const results=[],check=(name,passed,detail="")=>{results.push({name,passed:!!passed,detail});if(!passed)throw Error(name);};
 const wait=async(fn,ms=300000)=>{const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+String(fn));await new Promise(r=>setTimeout(r,100));}};
 try{
  await wait(()=>$('#libraryInfo').textContent.trim().length>0);
  const mode=await fetch('/live-mode').then(r=>r.text());
  if(mode==='new')await call('save',{project:{id:'liveProbe',title:'Live editor test',version:'AS3',start:'arrival',items:[],scenes:[{id:'arrival',width:1600,height:900,spawn:{x:160,y:650},objects:[{id:'ground',kind:'platform',x:0,y:760,width:1600,height:140},{id:'testBox',kind:'switch',x:300,y:630,width:120,height:90,label:'A test object',actions:[]}]}]}});
  else await call('importIsland',{island:mode==='AS2'?'Train':'carrot',id:'liveProbe',version:mode});
  await open('liveProbe');$('#play').click();await wait(()=>!$('#playView').hidden&&$('#game').contentWindow.liveBridge?.ready);
  $('#liveInspect').click();await wait(()=>liveEditor.state?.objects.length>20);
  await wait(()=>!$('#livePause').disabled);$('#livePause').click();
  check('Animation can be paused',$('#livePause').textContent==='Resume');
  const candidatesFor=s=>liveSelection.candidates(s).filter(o=>!o.readOnly&&o.shown&&o.width>15&&o.height>15&&o.width<500&&o.height<500&&o.left>=0&&o.top>=0&&o.left+o.width<s.width&&o.top+o.height<s.height&&!/(?:^|\/)(?:char|player)(?:\/|~|$)/i.test(o.path));
  let target,stableKey='',stableSince=0;
  await wait(()=>{
   liveEditor.refresh();const s=liveEditor.state;if(!s||s.ready===false)return false;
   const candidates=candidatesFor(s);
   const candidate=mode==='new'?candidates.find(o=>o.name==='testBox'):candidates.find(o=>!/instance|player|char|hud|button/i.test(o.name))||candidates[0];
   if(!candidate)return false;
   const key=[s.room,candidate.path,Math.round(candidate.left),Math.round(candidate.top)].join('|');
   if(key!==stableKey){stableKey=key;stableSince=Date.now();return false;}
   target=candidate;return Date.now()-stableSince>1500;
  });
  check('Live display tree is available',liveEditor.state.objects.length>20,String(liveEditor.state.objects.length));
  const objects=liveEditor.state.objects;
  check('A visible object can be selected',!!target,target?.name||JSON.stringify({width:liveEditor.state.width,height:liveEditor.state.height,rows:objects.filter(o=>o.shown&&/\/scenes\//i.test(o.source)).slice(0,15)}));
  liveEditor.select(target);
  const search=$('#liveSearch');search.value=target.name;search.dispatchEvent(new Event('input'));
  check('Search finds the selected object',[...$('#liveList').querySelectorAll('button')].some(b=>b.title===target.path));
  const controls=$('#liveType_internal');controls.checked=true;controls.dispatchEvent(new Event('change'));
  check('Adding game controls keeps the selected object reachable',[...$('#liveList').querySelectorAll('button')].some(b=>b.title===target.path));
  controls.checked=false;controls.dispatchEvent(new Event('change'));
  check('All outlines are off by default',!$('#liveOutlines').checked);
  const overlay=$('#liveOverlay'),rect=overlay.getBoundingClientRect(),s=liveEditor.state,scale=Math.min(rect.width/s.width,rect.height/s.height);
  const startX=rect.left+(rect.width-s.width*scale)/2+(target.left+target.width/2)*scale,startY=rect.top+(rect.height-s.height*scale)/2+(target.top+target.height/2)*scale;
  const capture=overlay.setPointerCapture;overlay.setPointerCapture=()=>{};
  overlay.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:startX,clientY:startY,bubbles:true}));
  overlay.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:startX+12*scale,clientY:startY+8*scale,bubbles:true}));
  overlay.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));overlay.setPointerCapture=capture;
  const moved=$('#game').contentWindow.liveBridge.snapshot().objects.find(o=>o.path===target.path);
  check('Dragging the move handle moves the selected native object',Math.abs(moved.originX-target.originX-12)<2&&Math.abs(moved.originY-target.originY-8)<2,JSON.stringify({before:[target.originX,target.originY],after:[moved.originX,moved.originY]}));
  liveEditor.undo();let restored=$('#game').contentWindow.liveBridge.snapshot().objects.find(o=>o.uid===target.uid);
  check('A handle drag is undone in one step',Math.abs(restored.x-target.x)<.1&&Math.abs(restored.y-target.y)<.1);
  liveEditor.redo();restored=$('#game').contentWindow.liveBridge.snapshot().objects.find(o=>o.uid===target.uid);
  check('Redo restores the handle drag',Math.abs(restored.x-moved.x)<.1&&Math.abs(restored.y-moved.y)<.1);
  const alpha=$('[aria-label="Live Opacity"]');alpha.value='0.45';alpha.dispatchEvent(new Event('change'));
  await saveCurrent();await wait(()=>!liveEditor.hasUnsaved);
  check('Live edit is saved in the project',(await call('open',{id:'liveProbe'})).liveEdits.some(r=>r.path===target.path&&r.values.alpha===0.45));
  const result=$('#game').contentWindow.liveBridge.snapshot().objects.find(o=>o.path===target.path);
  check('Live property reaches the native object',Math.abs(result.alpha-.45)<.02,String(result.alpha));
  search.value='';search.dispatchEvent(new Event('input'));
  const playerElement=$('#game').contentDocument.querySelector('#player'),fitTransform=playerElement.style.transform;
  $('[aria-label="Zoom in"]').click();check('Zoom enlarges the player',playerElement.style.transform!==fitTransform);
  $('#liveZoomFit').click();check('Fit restores the player view',playerElement.style.transform===fitTransform);
  await fetch('/__screenshot',{headers:{'X-Workshop-Token':window.workshopToken}});
  $('#liveWalk').click();check('Walk mode leaves game input available',$('#liveOverlay').style.pointerEvents==='none');check('Walk resumes paused animation',$('#livePause').textContent==='Pause');$('#liveInspect').click();
  const oldEpoch=$('#game').contentWindow.liveBridge.snapshot().epoch;
  $('#game').contentWindow.location.reload();await wait(()=>$('#game').contentWindow.liveBridge?.ready&&$('#game').contentWindow.liveBridge.snapshot()?.epoch!==oldEpoch);
  await wait(()=>{const o=$('#game').contentWindow.liveBridge.snapshot()?.objects.find(o=>o.path===target.path);return o&&Math.abs(o.alpha-.45)<.02;});
  check('Saved edit survives player reload',true);
  check('Editor fits the viewport',document.documentElement.scrollWidth<=innerWidth);
  if(mode==='new') {
   liveEditor.refresh();liveEditor.select(liveEditor.state.objects.find(o=>o.path===target.path));
   [...$('#liveProperties').querySelectorAll('button')].find(b=>b.textContent==='Edit in room').click();
   await wait(()=>!liveEditor.active&&selected?.id==='testBox');
   check('Room properties carries the dragged position',Math.abs(selected.x-moved.x)<.1&&Math.abs(selected.y-moved.y)<.1);
   selected.x=450;changed();await save();
   const saved=await call('open',{id:'liveProbe'});
   const rule=saved.liveEdits.find(r=>r.path===target.path);
   check('Room edits replace live position but keep other properties',saved.scenes[0].objects.find(o=>o.id==='testBox').x===450&&rule?.values.x===undefined&&rule?.values.y===undefined&&rule?.values.alpha===.45);
  }
 }catch(e){results.push({name:'Live editor sequence',passed:false,detail:e.stack+'\n'+$('#status').textContent});await fetch('/__screenshot',{headers:{'X-Workshop-Token':window.workshopToken}});}
 await fetch('/__done',{method:'POST',headers:{'X-Workshop-Token':window.workshopToken},body:JSON.stringify(results)});
})();
