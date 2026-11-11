(function(root) {
  const parent = o => o.path.slice(0, o.path.lastIndexOf('/'));
  const generic = o => /^(instance\d+|instance|shape|movieclip|sprite|bitmap|sharedbitmap|text(field)?)$/i.test(o.name || '') || !o.name;
  const internal = o => /(?:^|[\/_:~])(?:transitionContainer|sceneOverlayContainer|navBar|adPrepHit\d*|hud|uiContainer|loading|overlay|menu|cursor)(?:[\/_[~:]|$)/i.test(o.path) || /^(transitionContainer|sceneOverlayContainer|navBar|adPrepHit\d*|hud|uiContainer|shell|loading|overlay|menu|cursor)$/i.test(o.name || '');
  const huge = (o,s) => o.width * o.height > s.width * s.height * .65;
  const types = ['characters','platforms','items','doors','scenery','backgrounds','internal'];
  function bounds(o,state) {
    const v=o.inRoom&&state?.viewport;
    if(!v)return {left:o.left,top:o.top,width:o.width,height:o.height};
    const left=Math.max(o.left,v.left),top=Math.max(o.top,v.top);
    return {left,top,width:Math.max(0,Math.min(o.left+o.width,v.left+v.width)-left),height:Math.max(0,Math.min(o.top+o.height,v.top+v.height)-top)};
  }
  function category(o,state,index=null) {
    if(internal(o))return 'internal';
    if(types.includes(o.category))return o.category;
    let ancestor=index?.nodes.get(parent(o));
    while(ancestor){if(types.includes(ancestor.category))return ancestor.category;ancestor=index.nodes.get(parent(ancestor));}
    if(/(?:^|\/)(?:char|player|avatar)(?:~|\[|\/|$)/i.test(o.path))return 'characters';
    const children=index?(index.children.get(o.path)||[]):state.objects.filter(child=>parent(child)===o.path);
    if(children.some(child=>/^head$/i.test(child.name))&&children.some(child=>/^body$/i.test(child.name)))return 'characters';
    return huge(o,state)?'backgrounds':'scenery';
  }
  function candidates(state, {advanced=false, backgrounds=false, categories=null, parts=null, query='', visible=true, locked=new Set()}={}) {
    const nodes = new Map(state.objects.map(o=>[o.path,o]));
    const parents = new Set(state.objects.map(parent));
    const children = new Map();
    for(const o of state.objects){const key=parent(o);if(!children.has(key))children.set(key,[]);children.get(key).push(o);}
    const partName = o => /^(?:head|body|eye|mouth|hair|arm|leg|hand|foot|feet|shirt|pants|pupil|lid|skin|neck|hit|marks|outline|colorFill)/i.test(o.name||'');
    const collection = o => !o.category && (/^(?:stage|room|scene|camera|shell|background|group)(?:Container)?$/i.test(o.name||'') ||
      (children.get(o.path)||[]).filter(child=>child.shown&&child.width>0&&child.height>0&&!generic(child)&&!partName(child)).length>1);
    const screen = o => {const b=bounds(o,state);return o.shown && b.width>0 && b.height>0 && b.left+b.width>0 && b.top+b.height>0 && b.left<state.width && b.top<state.height;};
    const group = o => {
      if(advanced || parts) return o;
      if(o.category || o.readOnly)return o;
      let result=o, p=nodes.get(parent(o));
      while(p && (!huge(p,state)||p.category) && !internal(p) && !collection(p)) {
        // Anonymous clips also assemble characters. Stop at room-sized or UI
        // containers, rather than making eyes and clothing the default targets.
        result=p;
        if(p.category)break;
        p=nodes.get(parent(p));
      }
      return result;
    };
    const rows = new Map();
    for(const node of state.objects) {
      let o=group(node);
      // A search may name a part inside a group. Keep that exact match reachable.
      const matches = item => [item.name,item.kind,item.source,item.path].join(' ').toLowerCase().includes(query.toLowerCase());
      if(query && !matches(o) && matches(node))o=node;
      const type=collection(o)?'internal':category(o,state,{nodes,children}),showInternal=categories?.has('internal')&&type==='internal';
      if(!advanced && !parts && !showInternal && collection(o))continue;
      if(parts && !o.path.startsWith(parts+'/'))continue;
      if(!advanced && !parts && !showInternal && (internal(o)||(huge(o,state)&&!o.category&&!((backgrounds||categories?.has('backgrounds'))&&!parents.has(o.path)))))continue;
      if(categories && !parts && !categories.has(type))continue;
      if(visible && !screen(o))continue;
      let ancestor=o,blocked=false;
      while(ancestor){if(locked.has(ancestor.uid ?? ancestor.path)){blocked=true;break;}ancestor=nodes.get(parent(ancestor));}
      if(blocked)continue;
      if(query && ![o.name,o.kind,o.source,o.path].join(' ').toLowerCase().includes(query.toLowerCase()))continue;
      rows.set(o.path,o);
    }
    return [...rows.values()];
  }
  function hits(rows,p,state=null) { return rows.filter(o=>{const b=bounds(o,state);return b.width>0&&b.height>0&&p.x>=b.left&&p.x<=b.left+b.width&&p.y>=b.top&&p.y<=b.top+b.height;}).sort((a,b)=>a.width*a.height-b.width*b.height||b.depth-a.depth); }
  const api={parent,generic,category,bounds,candidates,hits};
  if(typeof module!=='undefined')module.exports=api;else root.liveSelection=api;
})(typeof window==='undefined'?globalThis:window);
