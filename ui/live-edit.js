(() => {
  const frame = document.querySelector("#game"), overlay = document.querySelector("#liveOverlay"), panel = document.querySelector("#liveInspector");
  const toggle = document.querySelector("#liveInspect"), walk = document.querySelector("#liveWalk"), overlaps = document.querySelector("#liveOverlaps");
  const context = overlay.getContext("2d"), drafts = new Map();
  let labels = [], moveHandle, parts=null, runtimeEpoch, spaceHeld=false, pan;
  let view={zoom:1,x:0,y:0};
  const locked=new Set(), undoStack=[], redoStack=[];
  let active = false, picking = true, paused = false, state, chosen, hovered, drag, owner, signature = "", saving = false, savePromise, listLimit=150;
  const bridge = () => frame.contentWindow?.liveBridge;
  const canPause = snapshot => !!snapshot?.objects && snapshot.ready!==false && !snapshot.objects.some(o=>/\/transitionContainer[^/]*\//.test(o.path)&&o.shown&&o.width*o.height>snapshot.width*snapshot.height*.65);
  const pausePlayer = value => bridge()?.setPaused ? bridge().setPaused(value) : frame.contentWindow?.gamePlayer?.ruffle()[value?'suspend':'resume']();
  const key = (room, path) => JSON.stringify([room, path]);
  const create = (tag, text, attrs = {}) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; Object.assign(n, attrs); return n; };
  const button = (text, fn) => { const n = create("button", text); n.type = "button"; n.onclick = fn; return n; };
  const short = o => {
    if(o.entityName&&!liveSelection.generic({name:o.entityName}))return o.entityName;
    if(!liveSelection.generic(o))return o.name;
    if(o.readOnly)return o.category==='doors'?'Door collision':o.category==='platforms'?'Terrain collision':'Collision shape';
    return o.text?'Text: '+o.text.slice(0,28):({characters:'Character',items:'Item',doors:'Door',platforms:'Terrain'})[o.category]||'Unnamed artwork';
  };
  const categoryTitles={characters:'Characters',platforms:'Platforms & terrain',items:'Items',doors:'Doors',scenery:'Scenery',backgrounds:'Backgrounds',internal:'Game internals'};
  const categories = () => new Set(Object.keys(categoryTitles).filter(type=>panel.querySelector('#liveType_'+type)?.checked));
  const description = o => (o.readOnly?'Collision · ':'')+Math.round(o.width)+' × '+Math.round(o.height)+' px · '+Math.round(o.left)+', '+Math.round(o.top);
  const rows = (visible=true) => state ? liveSelection.candidates(state,{categories:categories(),parts,query:panel.querySelector('#liveSearch')?.value||'',visible:false,locked}).filter(o=>!visible||onScreen(o)) : [];
  function filterChanged() {
    listLimit=150;hovered=null;overlaps.hidden=true;
    if(chosen&&!rows(false).some(o=>o.path===chosen.path))clearSelection();
    list();draw();
  }
  const editableTarget = target => target.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');
  function remember(before, after) { if(JSON.stringify(before)!==JSON.stringify(after)){undoStack.push({before,after});redoStack.length=0;updateSave();} }
  function checkpoint() { return {rules:structuredClone(combinedRules()),chosen:chosen?{...chosen}:null}; }
  function restoreCheckpoint(saved) {
    drafts.clear(); const wanted=new Map(saved.rules.map(r=>[key(r.room,r.path),r]));
    for(const r of project.liveEdits||[])if(!wanted.has(key(r.room,r.path)))wanted.set(key(r.room,r.path),{room:r.room,path:r.path,values:{}});
    for(const [id,r] of wanted)if(JSON.stringify(r)!==JSON.stringify((project.liveEdits||[]).find(x=>key(x.room,x.path)===id)))drafts.set(id,r);
    bridge()?.setRules(combinedRules());refresh();
    if(saved.chosen && state?.room===saved.chosen.room){const o=state.objects.find(o=>saved.chosen.uid!=null?o.uid===saved.chosen.uid:o.path===saved.chosen.path);if(o)select(o);}
    updateSave();
  }
  function historyStep(from,to) { if(saving||!from.length)return;const entry=from.pop();restoreCheckpoint(from===undoStack?entry.before:entry.after);to.push(entry);updateSave();notice(from===undoStack?'Change undone.':'Change redone.'); }
  function clearSelection() { chosen=null;hovered=null;overlaps.hidden=true;if(parts){parts=null;panel.querySelector('#liveSearch').value='';}panel.querySelector('#liveBrowserTitle').textContent='Find objects';panel.querySelector('#liveFilter').disabled=false;panel.querySelector('#liveBrowser').open=true;panel.querySelector('#liveProperties')?.replaceChildren(create('p','Click something in the game to edit it.',{className:'liveMuted'}));list();draw(); }

  const setMode = text => { const label=document.querySelector("#playMode"); if(label)label.textContent=text; if(typeof status==="function")status(text==="Inspect"?"Inspect · Click an object to edit it.":text==="Walk"?"Walk · Game controls are on.":"Playing · Choose Inspect to edit objects."); };
  const notice = (text) => { const n = panel.querySelector("#liveNotice"); if(n)n.textContent = text; };
  function geometry() {
    const camera=picking?view:{zoom:1,x:0,y:0};
    const w = overlay.clientWidth, h = overlay.clientHeight, scale = Math.min(w / state.width, h / state.height)*camera.zoom;
    return { scale, x: (w - state.width * scale) / 2+camera.x, y: (h - state.height * scale) / 2+camera.y };
  }
  function setView(next) { view={...view,...next};if(picking)bridge()?.setView?.(view);if(state)list();draw(); }
  function focusSelected() {
    if(!chosen||!state)return;
    const w=overlay.clientWidth,h=overlay.clientHeight,fit=Math.min(w/state.width,h/state.height);
    const zoom=Math.max(.5,Math.min(4,Math.min(w/(Math.max(chosen.width,1)*fit*2),h/(Math.max(chosen.height,1)*fit*2))));
    const scale=fit*zoom;setView({zoom,x:(state.width/2-chosen.left-chosen.width/2)*scale,y:(state.height/2-chosen.top-chosen.height/2)*scale});
  }
  function onScreen(o) {
    if(!o.shown||o.width<=0||o.height<=0)return false;
    const b=liveSelection.bounds(o,state),g=geometry(),left=g.x+b.left*g.scale,top=g.y+b.top*g.scale;
    return b.width>0&&b.height>0&&left+b.width*g.scale>0&&top+b.height*g.scale>0&&left<overlay.clientWidth&&top<overlay.clientHeight;
  }
  function screenLimits(o,g) {
    const v=o.inRoom&&state.viewport;
    return v?{left:Math.max(0,g.x+v.left*g.scale),top:Math.max(0,g.y+v.top*g.scale),right:Math.min(overlay.clientWidth,g.x+(v.left+v.width)*g.scale),bottom:Math.min(overlay.clientHeight,g.y+(v.top+v.height)*g.scale)}:{left:0,top:0,right:overlay.clientWidth,bottom:overlay.clientHeight};
  }
  function point(e) { const r = overlay.getBoundingClientRect(), g = geometry(); return {x:(e.clientX-r.left-g.x)/g.scale,y:(e.clientY-r.top-g.y)/g.scale}; }
  function draw() {
    const rect = frame.getBoundingClientRect(), parent = overlay.parentElement.getBoundingClientRect();
    overlay.style.left = rect.left - parent.left + "px"; overlay.style.top = rect.top - parent.top + "px";
    overlay.style.width = rect.width + "px"; overlay.style.height = rect.height + "px";
    const ratio = devicePixelRatio || 1;
    overlay.width = Math.round(rect.width * ratio); overlay.height = Math.round(rect.height * ratio);
    context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,rect.width,rect.height);
    labels = [];moveHandle=null;
    if (!state) return;
    const g = geometry(), allowed=new Set(rows().map(o=>o.path)), all=panel.querySelector("#liveOutlines")?.checked;
    for (const o of [...state.objects].sort((a,b)=>(a.path===chosen?.path?2:a.path===hovered?1:0)-(b.path===chosen?.path?2:b.path===hovered?1:0))) {
      if (!onScreen(o)) continue;
      const selected = o.path === chosen?.path, hot = o.path === hovered;
      if (!selected && (!allowed.has(o.path) || (!hot && !all))) continue;
      const b=liveSelection.bounds(o,state),limits=screenLimits(o,g);
      const x = g.x + b.left*g.scale, y = g.y + b.top*g.scale, w = b.width*g.scale, h = b.height*g.scale;
      // Keep the edge visible over both bright and dark artwork. Large artwork
      // can extend beyond the player, so bring its outline inside the view.
      const ox=Math.max(limits.left+4,x),oy=Math.max(limits.top+4,y),right=Math.min(limits.right-4,x+w),bottom=Math.min(limits.bottom-4,y+h);
      if(right>ox&&bottom>oy){
        context.strokeStyle="#10202b";context.lineWidth=selected||hot?6:3;context.strokeRect(ox,oy,right-ox,bottom-oy);
        context.strokeStyle=selected?"#ffcf66":hot?"#ffffff":"#a5e8d6";
        context.lineWidth=selected?3:hot?2.5:1.5;context.strokeRect(ox,oy,right-ox,bottom-oy);
      }
      if (selected || (hot && !chosen)) {
        const label = short(o).slice(0,42); context.font = "11px system-ui";
        const labelWidth = context.measureText(label).width+8;
        if(labelWidth>limits.right-limits.left||limits.bottom-limits.top<16)continue;
        const lx = Math.max(limits.left,Math.min(x,limits.right-labelWidth)), ly = Math.max(limits.top+13,Math.min(y,limits.bottom-2));
        context.fillStyle = selected ? "#ffcf66" : "#15252ee8"; context.fillRect(lx,ly-13,labelWidth,14);
        context.fillStyle = selected ? "#14232b" : "#eff9f5"; context.fillText(label,lx+4,ly-2);
        labels.push({object:o,left:lx,top:ly-13,width:labelWidth,height:14});
      }
    }
    if(chosen && !chosen.readOnly && onScreen(chosen)) {
      const b=liveSelection.bounds(chosen,state),limits=screenLimits(chosen,g);
      if(limits.right-limits.left<26||limits.bottom-limits.top<40)return;
      const x=Math.max(limits.left+13,Math.min(limits.right-13,g.x+b.left*g.scale+b.width*g.scale/2)),y=Math.max(limits.top+26,Math.min(limits.bottom-13,g.y+b.top*g.scale+b.height*g.scale/2));
      context.fillStyle='#10202b';context.fillRect(x-13,y-13,26,26);context.fillStyle='#ffcf66';context.fillRect(x-10,y-10,20,20);context.strokeStyle='#14232b';context.lineWidth=2;context.beginPath();context.moveTo(x-6,y);context.lineTo(x+6,y);context.moveTo(x,y-6);context.lineTo(x,y+6);context.stroke();moveHandle={x,y};
    }
  }
  function list() {
    if(!state)return;
    const only=panel.querySelector("#liveVisible").checked;
    const items=rows(only);
    panel.querySelector("#liveCount").textContent = items.length + " objects" + (only ? " on screen" : " in this room");
    const container=panel.querySelector("#liveList"); container.replaceChildren();
    const shown=items.slice(0,listLimit),selectedRow=items.find(o=>o.path===chosen?.path);
    if(selectedRow&&!shown.includes(selectedRow))shown.unshift(selectedRow);
    for(const o of shown) {
      const b=button(short(o),()=>select(o)); b.className="liveObject"+(o.path===chosen?.path?" active":"");
      b.onpointerenter=()=>{hovered=o.path;draw();};b.onpointerleave=()=>{hovered=null;draw();};b.title=o.path; b.append(create("small",description(o)+(o.shown?"":" · hidden"))); container.append(b);
    }
    if(!items.length)container.append(create('p',!parts&&!categories().size?'Choose an object type above.':panel.querySelector('#liveSearch').value?'No matches. Try another name.':only?'No matching objects on screen. Turn off On screen to look around the room.':'No matching objects in this room.',{className:'liveMuted'}));
    if(items.length>listLimit)container.append(button("Show 150 more",()=>{listLimit+=150;list();}));
  }
  function select(o) {
    chosen={...o,room:state.room}; panel.querySelector('#liveBrowser').open=false; selected=null; hovered=o.path; renderProperties(); list(); draw();
    const entry=panel.querySelector(".liveObject.active"),container=panel.querySelector('#liveList');
    if(entry && container)container.scrollTop=Math.max(0,entry.offsetTop-container.offsetTop-container.clientHeight/2);
    notice(o.readOnly?'This outline shows collision, not separate artwork.':onScreen(o)?"Drag the yellow handle to move. Use arrow keys to move. Hold Shift for bigger steps.":"This object is hidden or outside the current view.");
  }
  function combinedRules() {
    const all=new Map((project.liveEdits||[]).map(r=>[key(r.room,r.path),r]));
    for(const [k,r] of drafts)all.set(k,r);return [...all.values()];
  }
  function apply(values, record=true) {
    if(chosen?.readOnly){notice('Collision shapes cannot be moved here. Open room source to change them.');return;}
    const before=record&&!drag?checkpoint():null;
    if(saving){notice("Finishing the save…");return;}
    if(!chosen || !bridge()?.ready)return;
    const answer=bridge().edit(chosen.room,chosen.path,values,chosen.uid);
    if(answer?.error) { notice(answer.error);return; }
    if(!answer?.values){notice("The player did not accept this edit.");return;}
    const id=key(chosen.room,chosen.path), previous=drafts.get(id)||(project.liveEdits||[]).find(r=>key(r.room,r.path)===id);
    const patch=values.dragX===undefined?values:{x:answer.values.x,y:answer.values.y};
    drafts.set(id,{room:chosen.room,path:chosen.path,values:{...previous?.values,...patch}});
    Object.assign(chosen,answer.values);notice("Unsaved changes");updateSave();refresh();if(before)remember(before,checkpoint());
  }
  function updateSave() {
    const b=panel.querySelector('#liveSave');if(b){b.disabled=saving||!drafts.size;b.textContent=saving?'Saving...':'Save';}
    const undo=panel.querySelector('#liveUndo'),redo=panel.querySelector('#liveRedo');if(undo)undo.disabled=saving||!undoStack.length;if(redo)redo.disabled=saving||!redoStack.length;
    window.dispatchEvent(new Event('islandengine-live-change'));
  }
  function saveEdits() {
    if(savePromise)return savePromise;
    if(!drafts.size)return Promise.resolve();
    savePromise=flushEdits().finally(()=>{savePromise=null;});return savePromise;
  }
  async function flushEdits() {
    saving=true;updateSave();const savingProject=project, projectId=project.id;
    try {
      if(dirty)await call("save",{project:savingProject});
      for(const [id,edit] of [...drafts]) { savingProject.liveEdits=await call("liveEdit",{project:projectId,edit});drafts.delete(id); }
      bridge()?.setRules(project.liveEdits||[]);notice("Saved.");
    } catch(e){notice(e.message);throw e;} finally{saving=false;updateSave();}
  }
  function renderProperties() {
    const box=panel.querySelector("#liveProperties");box.replaceChildren();
    panel.querySelector('#liveBrowserTitle').textContent=parts?'Find parts':'Find objects';
    panel.querySelector('#liveFilter').disabled=!!parts;
    if(!chosen)return;
    box.append(create("h3",short(chosen)),create("p",description(chosen),{className:"liveMuted"}));
    const navigation=create("div",undefined,{className:"liveActions"});
    if(!chosen.readOnly && !parts && state.objects.some(o=>o.path.startsWith(chosen.path+"/")))navigation.append(button("Edit parts",()=>{parts=chosen.path;panel.querySelector('#liveSearch').value='';panel.querySelector('#liveBrowser').open=true;renderProperties();list();draw();notice("Click a part in the game or the list.");}));
    if(parts)navigation.append(button("Back to whole object",()=>{const o=state.objects.find(o=>o.path===parts);parts=null;panel.querySelector('#liveSearch').value='';if(o)select(o);else clearSelection();}));
    navigation.append(button("Lock object",()=>{locked.add(chosen.uid??chosen.path);clearSelection();notice("Locked. Use Unlock all to select it again.");}),button("Clear selection",clearSelection));
    const authoredRoom=project.mode!=="existing"?project.scenes.find(r=>chosen.room==="game.scenes."+project.id+"."+r.id+"::"+r.id[0].toUpperCase()+r.id.slice(1)):null;
    const authoredObject=authoredRoom?.objects.find(o=>o.id===chosen.name);
    if(authoredObject)navigation.append(button("Edit in room",async()=>{
      const current={...chosen};
      try{
        await saveEdits();
        if(!current.readOnly){
          snapshot();
          authoredObject.x=current.x;authoredObject.y=current.y;
          const values={...(project.liveEdits||[]).find(r=>r.room===current.room&&r.path===current.path)?.values};
          delete values.x;delete values.y;
          project.liveEdits=await call("liveEdit",{project:project.id,edit:{room:current.room,path:current.path,values}});
        }
        close();document.querySelector('#stopPlay').click();room=authoredRoom;selected=authoredObject;
        if(!current.readOnly)changed();inspect();window.draw();
        status(current.readOnly?'Edit the collision in Room properties. Play rebuilds the room.':"Position copied to Room properties. Play rebuilds collision and behavior.");
      }catch(e){notice(e.message);}
    }));
    const sourceButton=button("Open room source",()=>task(async()=>{
      await saveEdits();const runtimeRoom=chosen.room;close();document.querySelector('#stopPlay').click();
      if(project.mode!=="existing") {const source=await call('runtimeSource',{project:project.id});await files();await openCode(source);}
      else if(project.version==='AS2') {const rooms=await call('rooms',{project:project.id}),match=rooms.find(r=>r.title===runtimeRoom);if(!match)throw Error('Select a loaded room first.');const sources=await call('decompileSwf',{project:project.id,file:match.file.replace(/^overlay\//,'')});await files();if(sources.length)await openCode(sources.find(f=>f.endsWith('/scripts/frame_1/DoAction.as'))||sources[0]);}
      else {const sources=await call('decompile',{project:project.id,className:runtimeRoom.replace('::','.')});await files();if(sources.length)await openCode(sources[0]);}
    }));
    if(chosen.readOnly){
      box.append(create('p','This shape marks where the game detects a surface or interaction. Its artwork may belong to a larger background.',{className:'liveMuted'}),navigation,sourceButton);
      const details=create('details');details.append(create('summary','Collision details'),create('p',chosen.kind),create('p',chosen.source||'Game collision'),create('code',chosen.path));box.append(details);return;
    }
    const fields=create("div",undefined,{className:"liveFields"});
    for(const [name,title] of [["x","X"],["y","Y"],["scaleX","Scale X"],["scaleY","Scale Y"],["rotation","Rotation"],["alpha","Opacity"]]) {
      const label=create("label",title),input=create("input",undefined,{type:"number",step:name==="alpha"||name.startsWith("scale")?"0.1":"1",value:Math.round(chosen[name]*1000)/1000});
      input.setAttribute("aria-label","Live "+title);input.onchange=()=>{const value=Number(input.value);if(input.value.trim()===""||!Number.isFinite(value)||(name==="alpha"&&(value<0||value>1))){notice("Enter a valid "+title.toLowerCase()+".");return;}apply({[name]:value});};
      const reset=button('Reset',()=>{
        if(saving)return;const before=checkpoint(),id=key(chosen.room,chosen.path),values={...combinedRules().find(r=>key(r.room,r.path)===id)?.values};
        delete values[name];drafts.set(id,{room:chosen.room,path:chosen.path,values});bridge()?.setRules(combinedRules());refresh();renderProperties();remember(before,checkpoint());updateSave();notice(title+' reset. Save to keep this change.');
      });reset.className='liveReset';reset.setAttribute('aria-label','Reset '+title);label.append(input,reset);fields.append(label);
    }
    box.append(fields);
    const visibility=create("label"," Visible"), check=create("input",undefined,{type:"checkbox",checked:chosen.visible});check.onchange=()=>apply({visible:check.checked});visibility.prepend(check);box.append(visibility);
    if(chosen.text!==null && chosen.text!==undefined) { const label=create("label","Text"),input=create("textarea",undefined,{value:chosen.text});input.setAttribute("aria-label","Live text");input.onchange=()=>apply({text:input.value});label.append(input);box.append(label); }
    const parentPath=chosen.path.slice(0,chosen.path.lastIndexOf("/")),parent=state.objects.find(o=>o.path===parentPath);
    box.append(navigation);
    if(parent && (parts || panel.querySelector('#liveType_internal').checked))box.append(button("Select enclosing object",()=>select(parent)));
    box.append(button("Reset object",()=>{
      if(saving)return;const before=checkpoint();drafts.set(key(chosen.room,chosen.path),{room:chosen.room,path:chosen.path,values:{}});bridge()?.setRules(combinedRules());refresh();renderProperties();remember(before,checkpoint());updateSave();notice('Object reset. Save to keep this change.');
    }));
    const details=create("details"),summary=create("summary","Object details");details.append(summary,create('p',authoredObject?'Edit in room to copy or delete this object and change collision.':'Game scripts may still move this object or control collision. Copy and delete are not available here.'),create('p','X and Y use local pixels. Scale 1 means 100%. Rotation uses degrees. Opacity runs from 0 to 1.'),create("p",chosen.kind),create("p",chosen.source||"Drawn by game code"),create("code",chosen.path),sourceButton);box.append(details);
  }

  function buildPanel() {
    panel.replaceChildren();
    const options=create('div',undefined,{className:'liveOptions'});
    const pause=button('Pause',e=>{if(!bridge()?.ready||(!paused&&!canPause(state)))return;paused=!paused;pausePlayer(paused);e.currentTarget.textContent=paused?'Resume':'Pause';e.currentTarget.setAttribute('aria-pressed',String(paused));});pause.id='livePause';pause.disabled=true;pause.title='Pause animation';
    const snapLabel=create('label','Snap to 10 px'),snap=create('input',undefined,{id:'liveSnap',type:'checkbox'});snapLabel.prepend(snap);options.append(snapLabel);
    const viewTools=create('div',undefined,{className:'liveActions'});
    const zoomOut=button('-',()=>setView({zoom:Math.max(.5,view.zoom/1.25)})),zoomIn=button('+',()=>setView({zoom:Math.min(4,view.zoom*1.25)}));zoomOut.setAttribute('aria-label','Zoom out');zoomIn.setAttribute('aria-label','Zoom in');
    viewTools.append(zoomOut,zoomIn,button('Fit',()=>setView({zoom:1,x:0,y:0})),button('Focus selected',focusSelected));viewTools.title='Hold Space and drag to pan';
    const actions=create('div',undefined,{className:'liveActions'}),saveButton=button('Save',()=>{});saveButton.id='liveSave';saveButton.className='primary';
    // The editor supplies the shared save entry point; fall back for embedded previews.
    saveButton.onclick=()=>typeof saveCurrent==="function"?task(saveCurrent):saveEdits().catch(()=>{});
    const undo=button('Undo',()=>historyStep(undoStack,redoStack)),redo=button('Redo',()=>historyStep(redoStack,undoStack));undo.id='liveUndo';redo.id='liveRedo';
    actions.append(saveButton,undo,redo,pause);panel.append(actions);
    const types=create('fieldset',undefined,{id:'liveFilter'});types.append(create('legend','Object types'));
    for(const [type,title] of Object.entries(categoryTitles)){
      const label=create('label',title),check=create('input',undefined,{id:'liveType_'+type,type:'checkbox',checked:type!=='internal'});
      if(type==='internal')label.title='Menus, camera, and scene containers';
      check.onchange=filterChanged;label.prepend(check);types.append(label);
    }
    const outlineOptions=create('div',undefined,{className:'liveOptions'}),outlineLabel=create('label','Show outlines'),outlineCheck=create('input',undefined,{id:'liveOutlines',type:'checkbox',checked:false});
    outlineCheck.onchange=()=>{overlaps.hidden=true;draw();};outlineLabel.prepend(outlineCheck);outlineOptions.append(outlineLabel);panel.append(types,outlineOptions);
    const browser=create('details',undefined,{id:'liveBrowser',open:true});browser.append(create('summary','Find objects',{id:'liveBrowserTitle'}));
    const search=create('input',undefined,{id:'liveSearch',type:'search',placeholder:'Find an object...'});search.setAttribute('aria-label','Find live objects');search.oninput=()=>{overlaps.hidden=true;list();draw();};browser.append(search);
    const filters=create('div',undefined,{className:'liveOptions'});
    const visibleLabel=create('label','On screen'),visibleCheck=create('input',undefined,{id:'liveVisible',type:'checkbox',checked:true});visibleCheck.onchange=()=>{overlaps.hidden=true;list();draw();};visibleLabel.prepend(visibleCheck);filters.append(visibleLabel);
    filters.append(button('Unlock all',()=>{locked.clear();list();draw();}));browser.append(filters,create('small','',{id:'liveCount'}),create('div',undefined,{id:'liveList'}));panel.append(browser,create('div',undefined,{id:'liveProperties'}),options,viewTools,create('p','Click something in the game to edit it.',{id:'liveNotice',role:'status'}));
    const discard=button('Discard unsaved changes',()=>{if(saving||!drafts.size)return;const before=checkpoint();drafts.clear();bridge()?.setRules(project.liveEdits||[]);refresh();renderProperties();remember(before,checkpoint());updateSave();notice('Unsaved changes discarded. Undo brings them back.');});panel.append(discard);updateSave();
  }
  function refresh() {
    if(!active)return;
    if(project?.id!==owner || document.querySelector("#playView").hidden || !frame.src.includes("player.html")) { close();return; }
    if(!bridge()?.ready){panel.querySelector("#livePause").disabled=true;notice(bridge()?.error||"Waiting for the room to load…");return;}
    try {
      const next=bridge().snapshot();panel.querySelector("#livePause").disabled=!paused&&!canPause(next);if(!next?.objects)return;
      const restarted=runtimeEpoch!=null && next.epoch!=null && runtimeEpoch!==next.epoch;
      if(next.epoch!=null)runtimeEpoch=next.epoch;
      if(restarted){chosen=null;parts=null;hovered=null;drag=null;locked.clear();undoStack.length=0;redoStack.length=0;overlaps.hidden=true;signature='';bridge().setRules(combinedRules());panel.querySelector('#liveProperties').replaceChildren();panel.querySelector('#liveBrowser').open=true;panel.querySelector('#liveBrowserTitle').textContent='Find objects';panel.querySelector('#liveFilter').disabled=false;updateSave();notice('Your edits are still here. Select an object to keep editing.');}
    if(state?.room!==next.room){chosen=null;parts=null;hovered=null;overlaps.hidden=true;signature="";if(drafts.size)bridge().setRules(combinedRules());panel.querySelector("#liveProperties").replaceChildren();panel.querySelector("#liveBrowser").open=true;panel.querySelector("#liveBrowserTitle").textContent="Find objects";panel.querySelector("#liveFilter").disabled=false;notice("Room: "+next.room.split(/::|\./).pop());}
      const authoredRoom=project.mode!=='existing'?project.scenes?.find(r=>next.room==='game.scenes.'+project.id+'.'+r.id+'::'+r.id[0].toUpperCase()+r.id.slice(1)):null;
      if(authoredRoom)for(const o of next.objects){const authored=authoredRoom.objects.find(item=>item.id===o.name);if(authored)o.category=({npc:'characters',platform:'platforms',movingPlatform:'platforms',bounce:'platforms',hazard:'platforms',wall:'platforms',water:'platforms',climb:'platforms',item:'items',door:'doors'})[authored.kind]||'scenery';}
      state=next;
      const current=chosen&&state.objects.find(o=>chosen.uid!=null?o.uid===chosen.uid:o.path===chosen.path);
      if(chosen&&!current){clearSelection();notice("That object is no longer in the room.");}
      if(current)Object.assign(chosen,current);
      if(current && !drag && !panel.contains(document.activeElement)) {for(const [name,title] of [["x","X"],["y","Y"],["scaleX","Scale X"],["scaleY","Scale Y"],["rotation","Rotation"],["alpha","Opacity"]]){const input=panel.querySelector('[aria-label="Live '+title+'"]');if(input)input.value=Math.round(current[name]*1000)/1000;}}
      const stamp=state.room+"|"+state.objects.filter(onScreen).map(o=>o.path).join("|");
      if(stamp!==signature){signature=stamp;list();}
      draw();
    }catch(e){notice("Inspector: "+e.message);}
  }
  function close() {
    if(drag)finishDrag();finishPan();spaceHeld=false;view={zoom:1,x:0,y:0};bridge()?.setView?.(view);if(paused)pausePlayer(false);paused=false;active=false;setMode("Playtest");
    overlay.hidden=true;panel.hidden=true;overlaps.hidden=true;walk.hidden=true;document.querySelector("#inspector").hidden=false;toggle.setAttribute("aria-pressed","false");toggle.textContent="Inspect";
    // Drafts survive toggling Inspect; stopping Play discards their preview, not their saved form.
  }
  toggle.onclick=()=>{
    if(active){close();return;}
    if(owner!==project?.id){drafts.clear();undoStack.length=0;redoStack.length=0;locked.clear();owner=project?.id;}
    active=true;picking=true;setMode("Inspect");state=null;chosen=null;signature="";buildPanel();
    document.querySelector("#inspector").hidden=true;panel.hidden=false;overlay.hidden=false;overlay.style.pointerEvents="auto";
    walk.hidden=false;walk.textContent="Walk";toggle.textContent="Done";toggle.setAttribute("aria-pressed","true");refresh();
  };
  walk.onclick=()=>{if(drag)finishDrag(true);finishPan();spaceHeld=false;picking=!picking;setMode(picking?"Inspect":"Walk");
    if(!picking&&paused){pausePlayer(false);paused=false;const pause=panel.querySelector('#livePause');pause.textContent='Pause';pause.setAttribute('aria-pressed','false');}
    bridge()?.setView?.(picking?view:{zoom:1,x:0,y:0});overlay.style.pointerEvents=picking?"auto":"none";walk.textContent=picking?"Walk":"Select";overlaps.hidden=true;draw();notice(picking?"Click an object to select it. Drag its yellow handle to move it.":"Walking - game controls are on. Choose Select to edit.");};
  function showOverlaps(hits) {
    overlaps.replaceChildren(create('strong','Choose an object'));
    overlaps.append(button('Close',()=>{overlaps.hidden=true;hovered=null;draw();}));
    for(const o of hits){const b=button(short(o)+' - '+description(o),()=>{select(o);overlaps.hidden=true;});b.onpointerenter=b.onfocus=()=>{hovered=o.path;draw();};b.onpointerleave=()=>{hovered=null;draw();};overlaps.append(b);}
    overlaps.append(create('small','Alt+click cycles through these objects.'));overlaps.hidden=hits.length<2;
  }
  overlay.onpointerdown=e=>{
    if(!state||!picking||e.button!==0)return;e.preventDefault();const p=point(e),r=overlay.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    if(spaceHeld){pan={pointerId:e.pointerId,x:e.clientX,y:e.clientY,start:{...view}};overlay.setPointerCapture(e.pointerId);overlaps.hidden=true;return;}
    if(!e.altKey && chosen && moveHandle && Math.abs(x-moveHandle.x)<=12 && Math.abs(y-moveHandle.y)<=12){drag={pointerId:e.pointerId,x:p.x,y:p.y,originX:chosen.originX,originY:chosen.originY,before:checkpoint(),moved:false};overlay.setPointerCapture(e.pointerId);overlaps.hidden=true;return;}
    const hits=liveSelection.hits(rows(),p,state),label=labels.findLast(l=>x>=l.left&&x<=l.left+l.width&&y>=l.top&&y<=l.top+l.height);
    if(label && rows().some(o=>o.path===label.object.path)){select(label.object);overlaps.hidden=true;return;}
    if(!hits.length){clearSelection();
      if(!parts && !panel.querySelector('#liveType_backgrounds').checked && !panel.querySelector('#liveSearch').value && liveSelection.hits(liveSelection.candidates(state,{categories:new Set(['backgrounds']),visible:false,locked}).filter(onScreen),p,state).length){
        notice('This is part of a larger piece of artwork.');
        panel.querySelector('#liveProperties').append(button('Include backgrounds',()=>{panel.querySelector('#liveType_backgrounds').checked=true;list();draw();const backgrounds=liveSelection.hits(rows(),p,state);if(backgrounds.length){select(backgrounds[0]);showOverlaps(backgrounds);}}));
      }return;
    }
    if(e.altKey){const index=hits.findIndex(o=>o.path===chosen?.path);select(hits[(index+1)%hits.length]);overlaps.hidden=true;return;}
    select(hits[0]);showOverlaps(hits);
  };
  overlay.onpointermove=e=>{
    if(pan){setView({x:pan.start.x+e.clientX-pan.x,y:pan.start.y+e.clientY-pan.y});return;}
    if(!state)return;const p=point(e);
    if(drag){let dx=p.x-drag.x,dy=p.y-drag.y;if(Math.abs(dx)+Math.abs(dy)>3||drag.moved){drag.moved=true;let x=drag.originX+dx,y=drag.originY+dy;if(panel.querySelector('#liveSnap').checked&&!e.altKey){x=Math.round(x/10)*10;y=Math.round(y/10)*10;}apply({dragX:x,dragY:y},false);notice('On screen: '+Math.round(x)+', '+Math.round(y)+' px'+(panel.querySelector('#liveSnap').checked?' - Hold Alt to ignore snapping':''));}return;}
    hovered=liveSelection.hits(rows(),p,state)[0]?.path;draw();
  };
  overlay.onpointerleave=()=>{if(!drag){hovered=null;draw();}};
  function finishDrag(cancel=false){if(!drag)return;const current=drag;drag=null;if(overlay.hasPointerCapture?.(current.pointerId))overlay.releasePointerCapture(current.pointerId);if(cancel)restoreCheckpoint(current.before);else if(current.moved)remember(current.before,checkpoint());renderProperties();}
  function finishPan(cancel=false){if(!pan)return;const previous=pan;pan=null;if(cancel)setView(previous.start);if(overlay.hasPointerCapture?.(previous.pointerId))overlay.releasePointerCapture(previous.pointerId);}
  overlay.onpointerup=()=>{finishPan();finishDrag();};overlay.onpointercancel=overlay.onlostpointercapture=()=>{finishPan(true);finishDrag(true);};
  document.addEventListener('keydown',e=>{
    if(!active||editableTarget(e.target)||document.querySelector('#modal')?.open)return;
    const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(e.code==='Space'&&picking){e.preventDefault();spaceHeld=true;overlay.style.cursor='grab';return;}
    if(e.key==='Escape'){e.preventDefault();if(pan)finishPan(true);else if(drag)finishDrag(true);else if(!overlaps.hidden){overlaps.hidden=true;hovered=null;draw();}else clearSelection();return;}
    if(mod && (k==='z'||k==='y')){e.preventDefault();if(drag)finishDrag();historyStep(k==='y'||e.shiftKey?redoStack:undoStack,k==='y'||e.shiftKey?undoStack:redoStack);return;}
    if(!picking)return;
    if(chosen&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const n=e.shiftKey?10:1;apply({x:chosen.x+(e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0),y:chosen.y+(e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0)});return;}
    if(chosen&&(e.key==='Delete'||mod&&['c','x','v','d'].includes(k))){e.preventDefault();notice(chosen.readOnly?'Collision shapes cannot be copied or deleted here. Open room source to change them.':project.mode==='existing'?'Original game objects cannot be copied or deleted here. Visibility only hides their artwork.':'Use Edit in room to copy or remove this object.');}
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceHeld=false;overlay.style.cursor='crosshair';}});
  setInterval(refresh,500);
  window.liveEditor={get active(){return active;},get hasUnsaved(){return drafts.size>0;},get dirty(){return drafts.size>0;},undo:()=>historyStep(undoStack,redoStack),redo:()=>historyStep(redoStack,undoStack),save:saveEdits,close,refresh,get state(){return state;},select,apply};
})();
