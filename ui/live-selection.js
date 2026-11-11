(function(root) {
  const parent = o => o.path.slice(0, o.path.lastIndexOf('/'));
  const generic = o => /^(instance\d+|instance|shape|movieclip|sprite|bitmap|sharedbitmap|text(field)?)$/i.test(o.name || '') || !o.name;
  const internal = o => /(?:^|[\/_:~])(?:transitionContainer|sceneOverlayContainer|navBar|adPrepHit\d*|hud|uiContainer|loading|overlay|menu|cursor)(?:[\/_[~:]|$)/i.test(o.path) || /^(transitionContainer|sceneOverlayContainer|navBar|adPrepHit\d*|hud|uiContainer|shell|loading|overlay|menu|cursor)$/i.test(o.name || '');
  const huge = (o,s) => o.width * o.height > s.width * s.height * .65;
  function candidates(state, {advanced=false, backgrounds=false, parts=null, query='', visible=true, locked=new Set()}={}) {
    const nodes = new Map(state.objects.map(o=>[o.path,o]));
    const parents = new Set(state.objects.map(parent));
    const screen = o => o.shown && o.width>0 && o.height>0 && o.left+o.width>0 && o.top+o.height>0 && o.left<state.width && o.top<state.height;
    const group = o => {
      if(advanced || parts) return o;
      let result=o, p=nodes.get(parent(o));
      while(p && !huge(p,state) && !internal(p)) {
        // Anonymous clips also assemble characters. Stop at room-sized or UI
        // containers, rather than making eyes and clothing the default targets.
        result=p;
        p=nodes.get(parent(p));
      }
      return result;
    };
    const rows = new Map();
    for(const node of state.objects) {
      const o=group(node);
      if(parts && !o.path.startsWith(parts+'/'))continue;
      if(!advanced && !parts && (internal(o)||(huge(o,state)&&!(backgrounds&&!parents.has(o.path)))))continue;
      if(visible && !screen(o))continue;
      let ancestor=o,blocked=false;
      while(ancestor){if(locked.has(ancestor.uid ?? ancestor.path)){blocked=true;break;}ancestor=nodes.get(parent(ancestor));}
      if(blocked)continue;
      if(query && ![o.name,o.kind,o.source,o.path].join(' ').toLowerCase().includes(query.toLowerCase()))continue;
      rows.set(o.path,o);
    }
    return [...rows.values()];
  }
  function hits(rows,p) { return rows.filter(o=>p.x>=o.left&&p.x<=o.left+o.width&&p.y>=o.top&&p.y<=o.top+o.height).sort((a,b)=>a.width*a.height-b.width*b.height||b.depth-a.depth); }
  const api={parent,generic,candidates,hits};
  if(typeof module!=='undefined')module.exports=api;else root.liveSelection=api;
})(typeof window==='undefined'?globalThis:window);
