(() => {
  const frame = document.querySelector("#game"), overlay = document.querySelector("#liveOverlay"), panel = document.querySelector("#liveInspector");
  const toggle = document.querySelector("#liveInspect"), walk = document.querySelector("#liveWalk"), overlaps = document.querySelector("#liveOverlaps");
  const context = overlay.getContext("2d"), drafts = new Map();
  let labels = [];
  let active = false, picking = true, paused = false, state, chosen, hovered, drag, owner, signature = "", saving = false, savePromise, listLimit=150;
  const bridge = () => frame.contentWindow?.liveBridge;
  const key = (room, path) => JSON.stringify([room, path]);
  const create = (tag, text, attrs = {}) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; Object.assign(n, attrs); return n; };
  const button = (text, fn) => { const n = create("button", text); n.type = "button"; n.onclick = fn; return n; };
  const short = (o) => /^instance\d+$/.test(o.name) ? o.kind.split(/::|\./).pop() : o.name || o.kind;
  const notice = (text) => { const n = panel.querySelector("#liveNotice"); if(n)n.textContent = text; };
  function geometry() {
    const w = overlay.clientWidth, h = overlay.clientHeight, scale = Math.min(w / state.width, h / state.height);
    return { scale, x: (w - state.width * scale) / 2, y: (h - state.height * scale) / 2 };
  }
  function onScreen(o) { return o.shown && o.width > 0 && o.height > 0 && o.left + o.width > 0 && o.top + o.height > 0 && o.left < state.width && o.top < state.height; }
  function point(e) { const r = overlay.getBoundingClientRect(), g = geometry(); return {x:(e.clientX-r.left-g.x)/g.scale,y:(e.clientY-r.top-g.y)/g.scale}; }
  function draw() {
    const rect = frame.getBoundingClientRect(), parent = overlay.parentElement.getBoundingClientRect();
    overlay.style.left = rect.left - parent.left + "px"; overlay.style.top = rect.top - parent.top + "px";
    overlay.style.width = rect.width + "px"; overlay.style.height = rect.height + "px";
    const ratio = devicePixelRatio || 1;
    overlay.width = Math.round(rect.width * ratio); overlay.height = Math.round(rect.height * ratio);
    context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,rect.width,rect.height);
    labels = [];
    if (!state) return;
    const g = geometry(), query = (panel.querySelector("#liveSearch")?.value || "").toLowerCase();
    for (const o of [...state.objects].sort((a,b)=>Number(a.path===chosen?.path||a.path===hovered)-Number(b.path===chosen?.path||b.path===hovered))) {
      if (!onScreen(o)) continue;
      const selected = o.path === chosen?.path, hot = o.path === hovered;
      if (query && !matches(o, query) && !selected) continue;
      const x = g.x + o.left*g.scale, y = g.y + o.top*g.scale, w = o.width*g.scale, h = o.height*g.scale;
      context.strokeStyle = selected ? "#ffcf66" : hot ? "#fff" : "#7bd7c080";
      context.lineWidth = selected || hot ? 2 : 1; context.strokeRect(x,y,w,h);
      if (panel.querySelector("#liveLabels")?.checked || selected || hot) {
        const label = short(o).slice(0,42); context.font = "11px system-ui";
        const labelWidth = context.measureText(label).width+8;
        const lx = Math.max(0,Math.min(x,rect.width-labelWidth)), ly = Math.max(13,Math.min(y,rect.height-2));
        context.fillStyle = selected ? "#ffcf66" : "#15252ee8"; context.fillRect(lx,ly-13,labelWidth,14);
        context.fillStyle = selected ? "#14232b" : "#eff9f5"; context.fillText(label,lx+4,ly-2);
        labels.push({object:o,left:lx,top:ly-13,width:labelWidth,height:14});
      }
    }
  }
  function matches(o,q) { return [o.name,o.kind,o.source,o.path].join(" ").toLowerCase().includes(q); }
  function selectable(o) { const q=(panel.querySelector("#liveSearch")?.value||"").toLowerCase();return onScreen(o)&&(!q||matches(o,q)||o.path===chosen?.path); }
  function list() {
    if(!state)return;
    const q=panel.querySelector("#liveSearch").value.toLowerCase(), only=panel.querySelector("#liveVisible").checked;
    const rows=state.objects.filter(o=>(!only||onScreen(o))&&matches(o,q));
    panel.querySelector("#liveCount").textContent = rows.length + " objects" + (only ? " on screen" : " in this room");
    const container=panel.querySelector("#liveList"); container.replaceChildren();
    for(const o of rows.slice(0,listLimit)) {
      const b=button(short(o),()=>select(o)); b.className="liveObject"+(o.path===chosen?.path?" active":"");
      b.title=o.path; b.append(create("small",o.kind.split(/::|\./).pop()+(o.shown?"":" · hidden"))); container.append(b);
    }
    if(rows.length>listLimit)container.append(button("Show 150 more",()=>{listLimit+=150;list();}));
  }
  function select(o) {
    chosen={...o,room:state.room}; selected=null; hovered=o.path; renderProperties(); list(); draw();
    notice(onScreen(o)?"Drag the selected object, or change its properties below.":"This object is hidden or outside the current view.");
  }
  function combinedRules() {
    const all=new Map((project.liveEdits||[]).map(r=>[key(r.room,r.path),r]));
    for(const [k,r] of drafts)all.set(k,r);return [...all.values()];
  }
  function apply(values) {
    if(saving){notice("Finishing the save…");return;}
    if(!chosen || !bridge()?.ready)return;
    const answer=bridge().edit(chosen.room,chosen.path,values);
    if(answer?.error) { notice(answer.error);return; }
    if(!answer?.values){notice("The player did not accept this edit.");return;}
    const id=key(chosen.room,chosen.path), previous=drafts.get(id)||(project.liveEdits||[]).find(r=>key(r.room,r.path)===id);
    const patch=values.dragX===undefined?values:{x:answer.values.x,y:answer.values.y};
    drafts.set(id,{room:chosen.room,path:chosen.path,values:{...previous?.values,...patch}});
    Object.assign(chosen,answer.values);notice("Unsaved edits — Save edits keeps them in the project.");updateSave();refresh();
  }
  function updateSave() { const b=panel.querySelector("#liveSave");if(b){b.disabled=saving||!drafts.size;b.textContent=drafts.size?"Save edits ("+drafts.size+")":"Save edits";} }
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
      bridge()?.setRules(project.liveEdits||[]);notice("Edits saved. They will load with this island and its exports.");
    } catch(e){notice(e.message);throw e;} finally{saving=false;updateSave();}
  }
  function renderProperties() {
    const box=panel.querySelector("#liveProperties");box.replaceChildren();if(!chosen)return;
    box.append(create("h3",short(chosen)),create("p",chosen.kind,{className:"liveMuted"}));
    const authoredRoom=project.mode!=="existing"?project.scenes.find(r=>chosen.room==="game.scenes."+project.id+"."+r.id+"::"+r.id[0].toUpperCase()+r.id.slice(1)):null;
    const authoredObject=authoredRoom?.objects.find(o=>o.id===chosen.name);
    box.append(create("p",authoredObject?"Preview transforms below. Use Room properties to change collision, artwork, dialogue, and actions.":"Visual editing. Original scripts may control movement and collision.",{className:"liveMuted"}));
    if(authoredObject)box.append(button("Room properties",async()=>{
      const current={...chosen};
      try{
        await saveEdits();
        snapshot();
        authoredObject.x=current.x;authoredObject.y=current.y;
        const values={...(project.liveEdits||[]).find(r=>r.room===current.room&&r.path===current.path)?.values};
        delete values.x;delete values.y;
        project.liveEdits=await call("liveEdit",{project:project.id,edit:{room:current.room,path:current.path,values}});
        close();document.querySelector('#stopPlay').click();room=authoredRoom;selected=authoredObject;
        changed();inspect();window.draw();
        status("Position copied to Room properties. Play rebuilds collision and behavior.");
      }catch(e){notice(e.message);}
    }));
    box.append(button("Open room source",()=>task(async()=>{
      await saveEdits();const runtimeRoom=chosen.room;close();document.querySelector('#stopPlay').click();
      if(project.mode!=="existing") {const source=await call('runtimeSource',{project:project.id});await files();await openCode(source);}
      else if(project.version==='AS2') {const rooms=await call('rooms',{project:project.id}),match=rooms.find(r=>r.title===runtimeRoom);if(!match)throw Error('Select a loaded room first.');const sources=await call('decompileSwf',{project:project.id,file:match.file.replace(/^overlay\//,'')});await files();if(sources.length)await openCode(sources.find(f=>f.endsWith('/scripts/frame_1/DoAction.as'))||sources[0]);}
      else {const sources=await call('decompile',{project:project.id,className:runtimeRoom.replace('::','.')});await files();if(sources.length)await openCode(sources[0]);}
    })));
    const fields=create("div",undefined,{className:"liveFields"});
    for(const [name,title] of [["x","X"],["y","Y"],["scaleX","Scale X"],["scaleY","Scale Y"],["rotation","Rotation"],["alpha","Opacity"]]) {
      const label=create("label",title),input=create("input",undefined,{type:"number",step:name==="alpha"?"0.1":"any",value:Math.round(chosen[name]*1000)/1000});
      input.setAttribute("aria-label","Live "+title);input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||(name==="alpha"&&(value<0||value>1))){notice("Enter a valid "+title.toLowerCase()+".");return;}apply({[name]:value});};
      label.append(input);fields.append(label);
    }
    box.append(fields);
    const visibility=create("label"," Visible"), check=create("input",undefined,{type:"checkbox",checked:chosen.visible});check.onchange=()=>apply({visible:check.checked});visibility.prepend(check);box.append(visibility);
    if(chosen.text!==null && chosen.text!==undefined) { const label=create("label","Text"),input=create("textarea",undefined,{value:chosen.text});input.setAttribute("aria-label","Live text");input.onchange=()=>apply({text:input.value});label.append(input);box.append(label); }
    const parentPath=chosen.path.slice(0,chosen.path.lastIndexOf("/")),parent=state.objects.find(o=>o.path===parentPath);
    if(parent)box.append(button("Select enclosing object",()=>select(parent)));
    box.append(button("Reset this object's edits",async()=>{
      if(saving)return;
      try{drafts.delete(key(chosen.room,chosen.path));project.liveEdits=await call("liveEdit",{project:project.id,edit:{room:chosen.room,path:chosen.path,values:{}}});bridge()?.setRules(combinedRules());updateSave();refresh();notice("Object edits removed.");}catch(e){notice(e.message);}
    }));
    const details=create("details"),summary=create("summary","Source and object path");details.append(summary,create("p",chosen.source||"Drawn by game code"),create("code",chosen.path));box.append(details);
    box.append(create("p","These are visual transforms. Collision and scripted behavior may need changes in the room settings or source.",{className:"liveMuted"}));
  }
  function buildPanel() {
    panel.replaceChildren();panel.append(create("h3","Live objects"));
    const search=create("input",undefined,{id:"liveSearch",type:"search",placeholder:"Find a name, type, or art file…"});search.setAttribute("aria-label","Find live objects");search.oninput=()=>{list();draw();};panel.append(search);
    const options=create("div",undefined,{className:"liveOptions"});
    for(const [id,title,checked] of [["liveVisible","On screen",true],["liveLabels","Labels",true]]) {const label=create("label",title),check=create("input",undefined,{id,type:"checkbox",checked});check.onchange=()=>{list();draw();};label.prepend(check);options.append(label);}
    options.append(button("Pause",e=>{paused=!paused;frame.contentWindow.gamePlayer.ruffle()[paused?"pause":"play"]();e.currentTarget.textContent=paused?"Resume":"Pause";}));panel.append(options);
    panel.append(create("p","Loading objects…",{id:"liveNotice",role:"status"}),create("small","",{id:"liveCount"}),create("div",undefined,{id:"liveList"}));
    const actions=create("div",undefined,{className:"liveActions"}),saveButton=button("Save edits",()=>saveEdits().catch(()=>{}));saveButton.id="liveSave";saveButton.className="primary";
    actions.append(saveButton,button("Undo unsaved",()=>{if(saving)return;drafts.clear();bridge()?.setRules(project.liveEdits||[]);updateSave();refresh();notice("Unsaved edits undone.");}));panel.append(actions,create("div",undefined,{id:"liveProperties"}));updateSave();
  }
  function refresh() {
    if(!active)return;
    if(project?.id!==owner || document.querySelector("#playView").hidden || !frame.src.includes("player.html")) { close();return; }
    if(!bridge()?.ready){notice(bridge()?.error||"Waiting for the room to load…");return;}
    try {
      const next=bridge().snapshot();if(!next?.objects)return;
    if(state?.room!==next.room){chosen=null;signature="";if(drafts.size)bridge().setRules(combinedRules());panel.querySelector("#liveProperties").replaceChildren();notice("Room: "+next.room.split(/::|\./).pop());}
      state=next;
      const current=state.objects.find(o=>o.path===chosen?.path);
      if(current && !drag && !panel.contains(document.activeElement)) {Object.assign(chosen,current);for(const [name,title] of [["x","X"],["y","Y"],["scaleX","Scale X"],["scaleY","Scale Y"],["rotation","Rotation"],["alpha","Opacity"]]){const input=panel.querySelector('[aria-label="Live '+title+'"]');if(input)input.value=Math.round(current[name]*1000)/1000;}}
      const stamp=state.room+"|"+state.objects.filter(onScreen).map(o=>o.path).join("|");
      if(stamp!==signature){signature=stamp;list();}
      draw();
    }catch(e){notice("Inspector: "+e.message);}
  }
  function close() {
    if(paused)frame.contentWindow?.gamePlayer?.ruffle().play();paused=false;active=false;
    overlay.hidden=true;panel.hidden=true;overlaps.hidden=true;walk.hidden=true;document.querySelector("#inspector").hidden=false;toggle.setAttribute("aria-pressed","false");toggle.textContent="Inspect";
    // Drafts survive toggling Inspect; stopping Play discards their preview, not their saved form.
  }
  toggle.onclick=()=>{
    if(active){close();return;}
    if(owner!==project?.id){drafts.clear();owner=project?.id;}
    active=true;picking=true;state=null;chosen=null;signature="";buildPanel();
    document.querySelector("#inspector").hidden=true;panel.hidden=false;overlay.hidden=false;overlay.style.pointerEvents="auto";
    walk.hidden=false;walk.textContent="Walk";toggle.textContent="Done";toggle.setAttribute("aria-pressed","true");refresh();
  };
  walk.onclick=()=>{picking=!picking;overlay.style.pointerEvents=picking?"auto":"none";walk.textContent=picking?"Walk":"Select";overlaps.hidden=true;notice(picking?"Click an object to select it. Drag the selected object to move it.":"Walk normally. Labels follow the room; choose Select to edit.");};
  overlay.onpointerdown=e=>{
    if(!state||!picking)return;e.preventDefault();const p=point(e);
    const hits=state.objects.filter(o=>selectable(o)&&p.x>=o.left&&p.x<=o.left+o.width&&p.y>=o.top&&p.y<=o.top+o.height).sort((a,b)=>a.width*a.height-b.width*b.height||b.depth-a.depth);
    const r=overlay.getBoundingClientRect(),label=labels.findLast(l=>e.clientX-r.left>=l.left&&e.clientX-r.left<=l.left+l.width&&e.clientY-r.top>=l.top&&e.clientY-r.top<=l.top+l.height);
    if(label&&!hits.includes(label.object))hits.unshift(label.object);
    if(!hits.length)return;
    const hit=label?.object||hits.find(o=>o.path===chosen?.path)||hits[0];select(hit);
    drag={x:p.x,y:p.y,originX:hit.originX,originY:hit.originY,moved:false};overlay.setPointerCapture(e.pointerId);
    overlaps.replaceChildren();for(const o of hits)overlaps.append(button(short(o)+" · "+o.kind.split(/::|\./).pop(),()=>{select(o);overlaps.hidden=true;}));
    overlaps.hidden=hits.length<2;
  };
  overlay.onpointermove=e=>{
    if(!state)return;const p=point(e);
    if(drag){const dx=p.x-drag.x,dy=p.y-drag.y;if(Math.abs(dx)+Math.abs(dy)>2){drag.moved=true;overlaps.hidden=true;apply({dragX:drag.originX+dx,dragY:drag.originY+dy});}return;}
    hovered=state.objects.filter(o=>selectable(o)&&p.x>=o.left&&p.x<=o.left+o.width&&p.y>=o.top&&p.y<=o.top+o.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0]?.path;draw();
  };
  overlay.onpointerup=()=>{if(drag?.moved)renderProperties();drag=null;};overlay.onpointercancel=()=>{drag=null;};
  setInterval(refresh,500);
  window.liveEditor={get active(){return active;},save:saveEdits,close,refresh,get state(){return state;},select,apply};
})();
