// Inspect: select and adjust objects in the running game.
//
// The player page exposes `liveBridge`, which returns snapshots of the game's
// display objects and applies edits by path. Edits are kept as drafts here
// until saved, then stored in the project as `liveEdits` and replayed by the
// runtime each time the room loads.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const frame = $("#game"), overlay = $("#liveOverlay"), panel = $("#liveInspector");
  const inspectButton = $("#liveInspect"), playButton = $("#liveWalk"), overlaps = $("#liveOverlaps");
  const context = overlay.getContext("2d");
  const typeTitles = liveSelection.typeTitles;
  const commonTypes = ["characters", "platforms", "items", "doors", "triggers", "switches"];
  const transformFields = [["x", "X"], ["y", "Y"], ["scaleX", "Scale X"], ["scaleY", "Scale Y"], ["rotation", "Rotation"], ["alpha", "Opacity"]];

  // Session state. `active` means the player is running with this panel open.
  // `picking` is Inspect mode: clicks select objects instead of reaching the game.
  let active = false, picking = false, paused = false, owner = null;
  let state = null, chosen = null, hovered = null, parts = null;
  let drag = null, pan = null, spaceHeld = false;
  let view = { zoom: 1, x: 0, y: 0 };
  let labels = [], moveHandle = null, signature = "", runtimeEpoch = null, listLimit = 150;
  let saving = false, savePromise = null, snapOn = false;
  const drafts = new Map(), locked = new Set(), undoStack = [], redoStack = [];

  const bridge = () => frame.contentWindow?.liveBridge;
  const key = (room, path) => JSON.stringify([room, path]);
  const create = (tag, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.assign(node, attrs);
    return node;
  };
  const button = (text, onclick, attrs = {}) => {
    const node = create("button", text, attrs);
    node.type = "button";
    node.onclick = onclick;
    return node;
  };
  const editableTarget = (target) => target.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');
  const notice = (text) => {
    const node = panel.querySelector("#liveNotice");
    if (node) node.textContent = text;
  };

  // ---- Names and descriptions ----

  function displayName(o) {
    if (o.entityName && !liveSelection.generic({ name: o.entityName })) return o.entityName;
    if (!liveSelection.generic(o)) return o.name;
    if (o.readOnly) return o.category === "triggers" ? "Trigger area" : o.category === "doors" ? "Door area" : singular[o.category] || "Collision shape";
    if (o.text) return "Text: " + o.text.slice(0, 28);
    return { characters: "Character", items: "Item", doors: "Door", platforms: "Platform", triggers: "Trigger", switches: "Switch" }[o.category] || "Unnamed artwork";
  }
  const singular = {
    characters: "Character", platforms: "Platform", items: "Item", doors: "Door", triggers: "Trigger", switches: "Switch",
    movingPlatforms: "Moving platform", walls: "Wall or ceiling", climbs: "Climbing area", water: "Water", hazards: "Hazard",
    bounce: "Bounce pad", scenery: "Scenery", backgrounds: "Background", custom: "Other object", internal: "Game internal",
  };
  const typeOf = (o) => (state ? liveSelection.category(o, state) : o.category);
  function typeName(o) {
    if (o.readOnly) return o.category === "triggers" ? "Trigger area" : o.category === "doors" ? "Door area" : (singular[o.category] || "Surface") + " collision";
    return singular[typeOf(o)] || "Object";
  }
  // Common, specific types first. Scenery, backgrounds, and unknown objects last.
  const typeOrder = Object.keys(typeTitles);
  const rank = (o) => typeOrder.indexOf(typeOf(o)) + (o.readOnly ? 0.5 : 0);
  function description(o) {
    return typeName(o) + " · " + Math.round(o.width) + " × " + Math.round(o.height) + " px";
  }

  // ---- Filters and the object list ----

  const typeCheck = (type) => panel.querySelector("#liveType_" + type);
  const categories = () => new Set(Object.keys(typeTitles).filter((type) => typeCheck(type)?.checked));
  function rows(onScreenOnly = true) {
    if (!state) return [];
    const found = liveSelection.candidates(state, {
      categories: categories(),
      parts,
      query: panel.querySelector("#liveSearch")?.value || "",
      visible: false,
      locked,
    });
    return onScreenOnly ? found.filter(onScreen) : found;
  }
  function typeSummary() {
    const count = categories().size, total = Object.keys(typeTitles).length;
    if (count === total) return "All types";
    if (count === total - 1 && !typeCheck("internal").checked) return "All but game internals";
    if (!count) return "No types";
    if (count <= 2) return [...categories()].map((type) => typeTitles[type]).join(", ");
    return count + " of " + total + " types";
  }
  function filterChanged() {
    const count = categories().size, all = panel.querySelector("#liveAllTypes");
    if (all) {
      all.checked = count === Object.keys(typeTitles).length;
      all.indeterminate = count > 0 && !all.checked;
    }
    const summary = panel.querySelector("#liveTypesSummary");
    if (summary) summary.textContent = "Show: " + typeSummary();
    listLimit = 150;
    hovered = null;
    overlaps.hidden = true;
    if (chosen && !rows(false).some((o) => o.path === chosen.path)) clearSelection();
    list();
    draw();
  }
  function list() {
    if (!state) return;
    const onlyOnScreen = panel.querySelector("#liveVisible").checked;
    const order = new Map(rows(onlyOnScreen).map((o) => [o, rank(o)]));
    const items = [...order.keys()].sort((a, b) => order.get(a) - order.get(b) || displayName(a).localeCompare(displayName(b)));
    panel.querySelector("#liveCount").textContent =
      items.length + (items.length === 1 ? " object" : " objects") + (onlyOnScreen ? " on screen" : " in this room");
    const container = panel.querySelector("#liveList");
    container.replaceChildren();
    const shown = items.slice(0, listLimit), selectedRow = items.find((o) => o.path === chosen?.path);
    if (selectedRow && !shown.includes(selectedRow)) shown.unshift(selectedRow);
    // Several objects can share a name, such as layers of one background.
    const seen = new Map(), total = new Map();
    for (const o of shown) total.set(displayName(o), (total.get(displayName(o)) || 0) + 1);
    for (const o of shown) {
      const name = displayName(o), count = (seen.get(name) || 0) + 1;
      seen.set(name, count);
      const row = button(total.get(name) > 1 ? name + " (" + count + ")" : name, () => select(o));
      row.className = "liveObject" + (o.path === chosen?.path ? " active" : "");
      row.onpointerenter = () => { hovered = o.path; draw(); };
      row.onpointerleave = () => { hovered = null; draw(); };
      row.title = o.path;
      row.append(create("small", description(o) + (o.shown ? "" : " · hidden")));
      container.append(row);
    }
    if (!items.length) {
      const reason = !parts && !categories().size
        ? "Choose an object type above."
        : panel.querySelector("#liveSearch").value
          ? "No matches. Try another name."
          : onlyOnScreen
            ? "Nothing matching on screen. Turn off On screen only to list the whole room."
            : "Nothing matching in this room.";
      container.append(create("p", reason, { className: "liveMuted" }));
    }
    if (items.length > listLimit) container.append(button("Show 150 more", () => { listLimit += 150; list(); }));
    const unlock = panel.querySelector("#liveUnlock");
    unlock.hidden = !locked.size;
    unlock.textContent = locked.size === 1 ? "Unlock 1 object" : "Unlock " + locked.size + " objects";
  }

  // ---- Coordinates ----

  function geometry() {
    const camera = picking ? view : { zoom: 1, x: 0, y: 0 };
    const w = overlay.clientWidth, h = overlay.clientHeight;
    const scale = Math.min(w / state.width, h / state.height) * camera.zoom;
    return { scale, x: (w - state.width * scale) / 2 + camera.x, y: (h - state.height * scale) / 2 + camera.y };
  }
  function onScreen(o) {
    if (!o.shown || o.width <= 0 || o.height <= 0) return false;
    const b = liveSelection.bounds(o, state), g = geometry();
    const left = g.x + b.left * g.scale, top = g.y + b.top * g.scale;
    return b.width > 0 && b.height > 0 && left + b.width * g.scale > 0 && top + b.height * g.scale > 0 &&
      left < overlay.clientWidth && top < overlay.clientHeight;
  }
  // AS2 rooms are drawn inside a viewport within the game shell. Keep room
  // outlines inside it so they never float over the shell.
  function screenLimits(o, g) {
    const v = o.inRoom && state.viewport;
    if (!v) return { left: 0, top: 0, right: overlay.clientWidth, bottom: overlay.clientHeight };
    return {
      left: Math.max(0, g.x + v.left * g.scale),
      top: Math.max(0, g.y + v.top * g.scale),
      right: Math.min(overlay.clientWidth, g.x + (v.left + v.width) * g.scale),
      bottom: Math.min(overlay.clientHeight, g.y + (v.top + v.height) * g.scale),
    };
  }
  function point(e) {
    const r = overlay.getBoundingClientRect(), g = geometry();
    return { x: (e.clientX - r.left - g.x) / g.scale, y: (e.clientY - r.top - g.y) / g.scale };
  }
  function setView(next) {
    view = { ...view, ...next };
    if (picking) bridge()?.setView?.(view);
    if (state) list();
    draw();
  }
  // AS2 rooms play in a small viewport inside the game shell. Fit zooms to
  // that viewport so the room fills the space. Other games fit as a whole.
  function fitView() {
    const v = state?.viewport;
    if (!v) {
      setView({ zoom: 1, x: 0, y: 0 });
      return;
    }
    const w = overlay.clientWidth, h = overlay.clientHeight, base = Math.min(w / state.width, h / state.height);
    const zoom = Math.min(4, Math.min(w / (v.width * base), h / (v.height * base)) * 0.98), scale = base * zoom;
    setView({ zoom, x: (state.width / 2 - v.left - v.width / 2) * scale, y: (state.height / 2 - v.top - v.height / 2) * scale });
  }
  function focusSelected() {
    if (!chosen || !state) return;
    const visible = liveSelection.bounds(chosen, state);
    if (chosen.inRoom && state.viewport && (visible.width <= 0 || visible.height <= 0)) {
      notice("It's off screen. Press Tab, walk closer, then Tab back.");
      return;
    }
    const w = overlay.clientWidth, h = overlay.clientHeight, fit = Math.min(w / state.width, h / state.height);
    const zoom = Math.max(0.5, Math.min(4, Math.min(w / (Math.max(chosen.width, 1) * fit * 2), h / (Math.max(chosen.height, 1) * fit * 2))));
    const scale = fit * zoom;
    setMode(true);
    setView({ zoom, x: (state.width / 2 - chosen.left - chosen.width / 2) * scale, y: (state.height / 2 - chosen.top - chosen.height / 2) * scale });
  }

  // ---- Drawing outlines ----

  function strokeBox(left, top, right, bottom, color, width) {
    // A dark edge under a bright one keeps the outline visible over any artwork.
    context.strokeStyle = "#10202b";
    context.lineWidth = width * 2;
    context.strokeRect(left, top, right - left, bottom - top);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.strokeRect(left, top, right - left, bottom - top);
  }
  function draw() {
    const rect = frame.getBoundingClientRect(), parent = overlay.parentElement.getBoundingClientRect();
    overlay.style.left = rect.left - parent.left + "px";
    overlay.style.top = rect.top - parent.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    const ratio = devicePixelRatio || 1;
    overlay.width = Math.round(rect.width * ratio);
    overlay.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    labels = [];
    moveHandle = null;
    if (!state) return;
    const g = geometry(), allowed = new Set(rows().map((o) => o.path)), outlineAll = panel.querySelector("#liveOutlines")?.checked;
    // Draw the selection last so it sits on top.
    const layer = (o) => (o.path === chosen?.path ? 2 : o.path === hovered ? 1 : 0);
    for (const o of [...state.objects].sort((a, b) => layer(a) - layer(b))) {
      if (!onScreen(o)) continue;
      const isChosen = o.path === chosen?.path, isHovered = o.path === hovered;
      if (!isChosen && (!allowed.has(o.path) || (!isHovered && !outlineAll))) continue;
      const b = liveSelection.bounds(o, state), limits = screenLimits(o, g);
      const x = g.x + b.left * g.scale, y = g.y + b.top * g.scale, w = b.width * g.scale, h = b.height * g.scale;
      // Large artwork can extend past the view. Bring its edge inside so it stays visible.
      const left = Math.max(limits.left + 4, x), top = Math.max(limits.top + 4, y);
      const right = Math.min(limits.right - 4, x + w), bottom = Math.min(limits.bottom - 4, y + h);
      if (right > left && bottom > top) {
        if (o.readOnly && !isChosen) context.setLineDash?.([6, 4]);
        strokeBox(left, top, right, bottom, isChosen ? "#ffcf66" : isHovered ? "#ffffff" : o.readOnly ? "#f0a8d0" : "#a5e8d6", isChosen ? 3 : isHovered ? 2.5 : 1.5);
        context.setLineDash?.([]);
      }
      if (isChosen || (isHovered && !chosen)) drawLabel(o, x, y, limits, isChosen);
    }
    drawMoveHandle(g);
  }
  function drawLabel(o, x, y, limits, isChosen) {
    const text = displayName(o).slice(0, 42);
    context.font = "11px system-ui";
    const width = context.measureText(text).width + 8;
    if (width > limits.right - limits.left || limits.bottom - limits.top < 16) return;
    const left = Math.max(limits.left, Math.min(x, limits.right - width));
    const baseline = Math.max(limits.top + 13, Math.min(y, limits.bottom - 2));
    context.fillStyle = isChosen ? "#ffcf66" : "#15252ee8";
    context.fillRect(left, baseline - 13, width, 14);
    context.fillStyle = isChosen ? "#14232b" : "#eff9f5";
    context.fillText(text, left + 4, baseline - 2);
    labels.push({ object: o, left, top: baseline - 13, width, height: 14 });
  }
  function drawMoveHandle(g) {
    if (!chosen || chosen.readOnly || !picking || !onScreen(chosen)) return;
    const b = liveSelection.bounds(chosen, state), limits = screenLimits(chosen, g);
    if (limits.right - limits.left < 26 || limits.bottom - limits.top < 40) return;
    const x = Math.max(limits.left + 13, Math.min(limits.right - 13, g.x + b.left * g.scale + (b.width * g.scale) / 2));
    const y = Math.max(limits.top + 26, Math.min(limits.bottom - 13, g.y + b.top * g.scale + (b.height * g.scale) / 2));
    context.fillStyle = "#10202b";
    context.fillRect(x - 13, y - 13, 26, 26);
    context.fillStyle = "#ffcf66";
    context.fillRect(x - 10, y - 10, 20, 20);
    context.strokeStyle = "#14232b";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x - 6, y);
    context.lineTo(x + 6, y);
    context.moveTo(x, y - 6);
    context.lineTo(x, y + 6);
    context.stroke();
    moveHandle = { x, y };
  }

  // ---- Drafts, undo, and saving ----

  function combinedRules() {
    const all = new Map((project.liveEdits || []).map((r) => [key(r.room, r.path), r]));
    for (const [id, rule] of drafts) all.set(id, rule);
    return [...all.values()];
  }
  function checkpoint() {
    return { rules: structuredClone(combinedRules()), chosen: chosen ? { ...chosen } : null };
  }
  function remember(before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    undoStack.push({ before, after });
    redoStack.length = 0;
    updateSave();
  }
  function restoreCheckpoint(saved) {
    drafts.clear();
    const wanted = new Map(saved.rules.map((r) => [key(r.room, r.path), r]));
    // A rule saved since the checkpoint must be cleared, not just left alone.
    for (const r of project.liveEdits || []) if (!wanted.has(key(r.room, r.path))) wanted.set(key(r.room, r.path), { room: r.room, path: r.path, values: {} });
    for (const [id, rule] of wanted) {
      const stored = (project.liveEdits || []).find((x) => key(x.room, x.path) === id);
      if (JSON.stringify(rule) !== JSON.stringify(stored)) drafts.set(id, rule);
    }
    bridge()?.setRules(combinedRules());
    refresh();
    if (saved.chosen && state?.room === saved.chosen.room) {
      const o = state.objects.find((o) => (saved.chosen.uid != null ? o.uid === saved.chosen.uid : o.path === saved.chosen.path));
      if (o) select(o);
    }
    updateSave();
  }
  function historyStep(from, to) {
    if (saving || !from.length) return;
    const entry = from.pop();
    restoreCheckpoint(from === undoStack ? entry.before : entry.after);
    to.push(entry);
    updateSave();
    notice(from === undoStack ? "Undone." : "Redone.");
  }
  function updateSave() {
    $("#liveUndo").disabled = saving || !undoStack.length;
    $("#liveRedo").disabled = saving || !redoStack.length;
    const changes = panel.querySelector("#liveChanges");
    if (changes) {
      changes.hidden = !drafts.size;
      panel.querySelector("#liveChangesText").textContent = saving
        ? "Saving…"
        : drafts.size === 1 ? "1 object changed, not saved" : drafts.size + " objects changed, not saved";
    }
    window.dispatchEvent(new Event("islandengine-live-change"));
  }
  function saveEdits() {
    if (savePromise) return savePromise;
    if (!drafts.size) return Promise.resolve();
    savePromise = flushEdits().finally(() => { savePromise = null; });
    return savePromise;
  }
  async function flushEdits() {
    saving = true;
    updateSave();
    const savingProject = project, projectId = project.id;
    try {
      if (dirty) await call("save", { project: savingProject });
      for (const [id, edit] of [...drafts]) {
        savingProject.liveEdits = await call("liveEdit", { project: projectId, edit });
        drafts.delete(id);
      }
      bridge()?.setRules(project.liveEdits || []);
      notice("Saved.");
    } catch (e) {
      notice(e.message);
      throw e;
    } finally {
      saving = false;
      updateSave();
    }
  }
  function discardDrafts(recordUndo = true) {
    if (saving || !drafts.size) return;
    const before = checkpoint();
    drafts.clear();
    bridge()?.setRules(project.liveEdits || []);
    refresh();
    renderProperties();
    if (recordUndo) remember(before, checkpoint());
    updateSave();
  }

  // ---- Editing ----

  function apply(values, record = true) {
    if (chosen?.readOnly) {
      notice(chosen.category === "triggers" ? "Change this trigger in the room editor or its source." : "Collision shapes can't be moved here. Open the room source to change them.");
      return;
    }
    const before = record && !drag ? checkpoint() : null;
    if (saving) { notice("Finishing the save…"); return; }
    if (!chosen || !bridge()?.ready) return;
    const answer = bridge().edit(chosen.room, chosen.path, values, chosen.uid);
    if (answer?.error) { notice(answer.error); return; }
    if (!answer?.values) { notice("The game did not accept this change."); return; }
    const id = key(chosen.room, chosen.path);
    const previous = drafts.get(id) || (project.liveEdits || []).find((r) => key(r.room, r.path) === id);
    // A drag sends screen coordinates. Store the local position the game reports back.
    const patch = values.dragX === undefined ? values : { x: answer.values.x, y: answer.values.y };
    drafts.set(id, { room: chosen.room, path: chosen.path, values: { ...previous?.values, ...patch } });
    Object.assign(chosen, answer.values);
    updateSave();
    refresh();
    if (before) remember(before, checkpoint());
  }
  function resetValues(names) {
    if (saving || !chosen) return;
    const before = checkpoint(), id = key(chosen.room, chosen.path);
    const values = { ...combinedRules().find((r) => key(r.room, r.path) === id)?.values };
    for (const name of names) delete values[name];
    drafts.set(id, { room: chosen.room, path: chosen.path, values: names.length ? values : {} });
    bridge()?.setRules(combinedRules());
    refresh();
    renderProperties();
    remember(before, checkpoint());
    updateSave();
  }

  // ---- Selection ----

  function select(o) {
    chosen = { ...o, room: state.room };
    hovered = o.path;
    if (!picking) setMode(true);
    renderProperties();
    list();
    draw();
    const entry = panel.querySelector(".liveObject.active"), container = panel.querySelector("#liveList");
    if (entry && container) container.scrollTop = Math.max(0, entry.offsetTop - container.offsetTop - container.clientHeight / 2);
    if (o.readOnly) notice("");
    else if (!onScreen(o)) notice("This object is hidden or outside the view. Focus zooms to it.");
    else notice("Drag the yellow handle to move it. Arrow keys nudge it, Shift+arrow by 10.");
  }
  function clearSelection() {
    chosen = null;
    hovered = null;
    overlaps.hidden = true;
    if (parts) {
      parts = null;
      panel.querySelector("#liveSearch").value = "";
    }
    renderProperties();
    list();
    draw();
  }
  function enterParts() {
    parts = chosen.path;
    chosen = null;
    panel.querySelector("#liveSearch").value = "";
    renderProperties();
    list();
    draw();
    notice("Click a part in the game or in the list.");
  }
  function leaveParts() {
    const whole = state.objects.find((o) => o.path === parts);
    parts = null;
    panel.querySelector("#liveSearch").value = "";
    if (whole) select(whole);
    else clearSelection();
  }

  // ---- Panel ----

  function authoredMatch() {
    if (!chosen || project.mode === "existing") return {};
    const authoredRoom = project.scenes.find((r) => chosen.room === "game.scenes." + project.id + "." + r.id + "::" + r.id[0].toUpperCase() + r.id.slice(1));
    return { authoredRoom, authoredObject: authoredRoom?.objects.find((o) => o.id === chosen.name) };
  }
  async function editInRoom(authoredRoom, authoredObject) {
    const current = { ...chosen };
    try {
      await saveEdits();
      if (!current.readOnly) {
        // Live position edits would override later room edits, so move the
        // position into the room object and keep the other live properties.
        snapshot();
        authoredObject.x = current.x;
        authoredObject.y = current.y;
        const values = { ...(project.liveEdits || []).find((r) => r.room === current.room && r.path === current.path)?.values };
        delete values.x;
        delete values.y;
        project.liveEdits = await call("liveEdit", { project: project.id, edit: { room: current.room, path: current.path, values } });
      }
      close();
      $("#stopPlay").click();
      room = authoredRoom;
      selected = authoredObject;
      if (!current.readOnly) changed();
      inspect();
      window.draw();
      status(current.readOnly ? "Edit the area here. Play rebuilds the room." : "Position moved into the room editor. Play rebuilds collision and behavior.");
    } catch (e) {
      notice(e.message);
    }
  }
  function openRoomSource() {
    return task(async () => {
      await saveEdits();
      const runtimeRoom = chosen.room;
      close();
      $("#stopPlay").click();
      if (project.mode !== "existing") {
        const source = await call("runtimeSource", { project: project.id });
        await files();
        await openCode(source);
      } else if (project.version === "AS2") {
        const rooms = await call("rooms", { project: project.id }), match = rooms.find((r) => r.title === runtimeRoom);
        if (!match) throw Error("This room's source was not found in the copy.");
        const sources = await call("decompileSwf", { project: project.id, file: match.file.replace(/^overlay\//, "") });
        await files();
        if (sources.length) await openCode(sources.find((f) => f.endsWith("/scripts/frame_1/DoAction.as")) || sources[0]);
      } else {
        const sources = await call("decompile", { project: project.id, className: runtimeRoom.replace("::", ".") });
        await files();
        if (sources.length) await openCode(sources[0]);
      }
    });
  }
  function renderProperties() {
    const box = panel.querySelector("#liveProperties"), browser = panel.querySelector("#liveBrowser");
    box.replaceChildren();
    panel.querySelector("#liveBrowserTitle").textContent = parts ? "Find parts" : "Find objects";
    panel.querySelector("#liveFilter").disabled = !!parts;
    panel.querySelector("#liveTypes").hidden = !!parts;
    panel.querySelector("#livePartsBar").hidden = !parts;
    browser.hidden = !!chosen;
    box.hidden = !chosen;
    window.updateKeyHints?.();
    if (!chosen) return;
    const back = button(parts ? "← All parts" : "← All objects", clearSelection, { className: "liveBack" });
    box.append(back, create("h3", displayName(chosen)), create("p", description(chosen), { className: "liveMuted" }));
    const { authoredRoom, authoredObject } = authoredMatch();
    const navigation = create("div", undefined, { className: "liveActions" });
    if (!chosen.readOnly && !parts && state.objects.some((o) => o.path.startsWith(chosen.path + "/")))
      navigation.append(button("Edit parts", enterParts, { title: "Select the smaller pieces inside this object" }));
    if (parts) navigation.append(button("Back to whole object", leaveParts));
    navigation.append(button("Focus selected", focusSelected, { title: "Zoom in on this object" }));
    navigation.append(button("Lock", () => {
      locked.add(chosen.uid ?? chosen.path);
      clearSelection();
      notice("Locked. It can't be selected in the game until you unlock it.");
    }, { title: "Stop this object from being selected by clicks" }));
    const roomButton = authoredObject && button("Edit in room", () => editInRoom(authoredRoom, authoredObject), { title: "Open this object in the room editor" });
    const sourceButton = button("Open room source", openRoomSource, { title: "Open the code that builds this room" });

    if (chosen.readOnly) {
      box.append(create("p", chosen.category === "triggers"
        ? authoredObject ? "Edit in room changes this trigger's size, position, and actions." : "Open room source to change this trigger."
        : "This is where the game detects a surface. Its art may be part of a larger background.", { className: "liveMuted" }));
      box.append(navigation);
      const links = create("div", undefined, { className: "liveActions" });
      if (roomButton) links.append(roomButton);
      links.append(sourceButton);
      box.append(links);
      const details = create("details");
      details.append(create("summary", chosen.category === "triggers" ? "Trigger details" : "Collision details"), create("p", chosen.kind), create("p", chosen.source || "Game collision"), create("code", chosen.path));
      box.append(details);
      return;
    }

    box.append(navigation);
    const fields = create("div", undefined, { className: "liveFields" });
    for (const [name, title] of transformFields) {
      const label = create("label", title);
      const input = create("input", undefined, { type: "number", step: name === "alpha" || name.startsWith("scale") ? "0.1" : "1", value: Math.round(chosen[name] * 1000) / 1000 });
      input.setAttribute("aria-label", "Live " + title);
      input.onchange = () => {
        const value = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(value) || (name === "alpha" && (value < 0 || value > 1))) {
          notice(name === "alpha" ? "Opacity runs from 0 (invisible) to 1 (solid)." : title + " needs a number.");
          input.value = Math.round(chosen[name] * 1000) / 1000;
          return;
        }
        apply({ [name]: value });
      };
      const reset = button("Reset", () => {
        resetValues([name]);
        notice(title + " reset.");
      }, { className: "liveReset" });
      reset.setAttribute("aria-label", "Reset " + title);
      label.append(input, reset);
      fields.append(label);
    }
    box.append(fields);
    const toggles = create("div", undefined, { className: "liveOptions" });
    const visibility = create("label", " Visible"), check = create("input", undefined, { type: "checkbox", checked: chosen.visible });
    check.onchange = () => apply({ visible: check.checked });
    visibility.prepend(check);
    const snapLabel = create("label", " Snap drags to 10 px"), snap = create("input", undefined, { id: "liveSnap", type: "checkbox", checked: snapOn });
    snap.onchange = () => { snapOn = snap.checked; };
    snapLabel.prepend(snap);
    toggles.append(visibility, snapLabel);
    box.append(toggles);
    if (chosen.text !== null && chosen.text !== undefined) {
      const label = create("label", "Text"), input = create("textarea", undefined, { value: chosen.text });
      input.setAttribute("aria-label", "Live text");
      input.onchange = () => apply({ text: input.value });
      label.append(input);
      box.append(label);
    }
    const links = create("div", undefined, { className: "liveActions" });
    if (roomButton) links.append(roomButton);
    links.append(sourceButton);
    const parentPath = chosen.path.slice(0, chosen.path.lastIndexOf("/")), parent = state.objects.find((o) => o.path === parentPath);
    if (parent && (parts || typeCheck("internal").checked)) links.append(button("Select enclosing object", () => select(parent)));
    links.append(button("Reset object", () => {
      resetValues([]);
      notice("Object reset to how the game draws it.");
    }, { title: "Undo every change to this object" }));
    box.append(links);
    const details = create("details"), limits = authoredObject
      ? "These changes affect how it looks. Use Edit in room to copy, delete, or change its collision."
      : "These changes affect the artwork only. Game scripts may still move it, and its collision stays put. Original objects can't be copied or deleted here.";
    details.append(
      create("summary", "About this object"),
      create("p", limits),
      create("p", "X and Y are in the object's own pixels. Scale 1 is 100%. Rotation is in degrees. Opacity runs from 0 to 1."),
      create("p", chosen.kind),
      create("p", chosen.source || "Drawn by game code"),
      create("code", chosen.path),
    );
    box.append(details);
  }

  function checkbox(id, title, checked, onchange) {
    const label = create("label", title), input = create("input", undefined, { id, type: "checkbox", checked });
    input.onchange = onchange;
    label.prepend(input);
    return label;
  }
  function buildPanel() {
    panel.replaceChildren();
    const browser = create("div", undefined, { id: "liveBrowser" });
    const heading = create("div", undefined, { className: "liveHeading" });
    heading.append(create("strong", "Find objects", { id: "liveBrowserTitle" }));
    const partsBar = create("div", undefined, { id: "livePartsBar", className: "liveActions", hidden: true });
    partsBar.append(button("Back to whole object", leaveParts));
    const search = create("input", undefined, { id: "liveSearch", type: "search", placeholder: "Search by name…" });
    search.setAttribute("aria-label", "Find objects in the game");
    search.oninput = () => { overlaps.hidden = true; list(); draw(); };

    // Types live in a collapsed section. The summary line says what is shown.
    const types = create("details", undefined, { id: "liveTypes" });
    types.append(create("summary", "Show: All but game internals", { id: "liveTypesSummary" }));
    const filter = create("fieldset", undefined, { id: "liveFilter" });
    filter.append(create("legend", "Object types"));
    filter.append(checkbox("liveAllTypes", "All types", false, () => {
      const everything = panel.querySelector("#liveAllTypes").checked;
      for (const type of Object.keys(typeTitles)) typeCheck(type).checked = everything;
      filterChanged();
    }));
    const common = create("div", undefined, { className: "liveTypeGrid" });
    const more = create("div", undefined, { className: "liveTypeGrid" });
    for (const [type, title] of Object.entries(typeTitles)) {
      const label = checkbox("liveType_" + type, title, type !== "internal", filterChanged);
      if (type === "internal") label.title = "Menus, camera, and scene containers";
      if (type === "custom") label.title = "Game objects whose type is not known";
      (commonTypes.includes(type) ? common : more).append(label);
    }
    filter.append(common, create("p", "More types", { className: "liveGroup" }), more);
    types.append(filter);
    const all = filter.querySelector("#liveAllTypes");
    all.indeterminate = true;

    const options = create("div", undefined, { className: "liveOptions" });
    options.append(
      checkbox("liveVisible", " On screen only", true, () => { overlaps.hidden = true; list(); draw(); }),
      checkbox("liveOutlines", " Outline all", false, () => { overlaps.hidden = true; draw(); }),
    );
    const unlock = button("Unlock", () => { locked.clear(); list(); draw(); notice("Every object can be selected again."); }, { id: "liveUnlock", hidden: true });
    browser.append(heading, partsBar, search, types, options, create("small", "", { id: "liveCount" }), create("div", undefined, { id: "liveList" }), unlock);

    const changes = create("div", undefined, { id: "liveChanges", hidden: true });
    changes.append(create("span", "", { id: "liveChangesText" }), button("Discard", () => {
      discardDrafts();
      notice("Changes discarded. Undo brings them back.");
    }, { title: "Throw away changes made since the last save" }));
    panel.append(browser, create("div", undefined, { id: "liveProperties", hidden: true }), changes, create("p", "", { id: "liveNotice", role: "status" }));
    filterChanged();
    updateSave();
  }

  // ---- Mode and lifecycle ----

  const canPause = (snapshot) =>
    !!snapshot?.objects && snapshot.ready !== false &&
    !snapshot.objects.some((o) => /\/transitionContainer[^/]*\//.test(o.path) && o.shown && o.width * o.height > snapshot.width * snapshot.height * 0.65);
  function setPaused(value) {
    paused = value;
    if (bridge()?.setPaused) bridge().setPaused(value);
    else frame.contentWindow?.gamePlayer?.ruffle()[value ? "suspend" : "resume"]();
    const pause = $("#livePause");
    pause.textContent = paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(paused));
  }
  function setMode(inspecting) {
    if (drag) finishDrag(!inspecting);
    finishPan();
    spaceHeld = false;
    picking = inspecting;
    if (!picking && paused) setPaused(false);
    bridge()?.setView?.(picking ? view : { zoom: 1, x: 0, y: 0 });
    if (picking && state?.viewport && view.zoom === 1 && !view.x && !view.y) fitView();
    overlay.style.pointerEvents = picking ? "auto" : "none";
    overlay.style.cursor = "crosshair";
    overlaps.hidden = true;
    inspectButton.setAttribute("aria-pressed", String(picking));
    playButton.setAttribute("aria-pressed", String(!picking));
    document.body.classList.toggle("inspecting", picking);
    // Keyboard input follows the mode: the game in Play, Inspect's shortcuts otherwise.
    if (picking) overlay.focus?.({ preventScroll: true });
    else frame.contentWindow?.focus?.();
    const label = $("#playMode");
    if (label) label.textContent = picking ? "Click an object to select it" : "Game controls are on";
    if (typeof status === "function") status(picking ? "Inspect. Click an object in the game to select it." : "Play. The game has your mouse and keyboard.");
    window.updateKeyHints?.();
    draw();
  }
  // In Play the game has keyboard focus, so Tab is caught inside its frame too.
  function listenInsideGame() {
    const win = frame.contentWindow;
    if (!win?.addEventListener || win.islandengineTabHook) return;
    win.islandengineTabHook = true;
    win.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || !active || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      setMode(!picking);
    }, true);
  }
  function open() {
    if (active) return;
    if (owner !== project?.id) {
      drafts.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      locked.clear();
      owner = project?.id;
    }
    active = true;
    state = null;
    chosen = null;
    parts = null;
    signature = "";
    buildPanel();
    $("#inspector").hidden = true;
    panel.hidden = false;
    overlay.hidden = false;
    const title = $("#rightTitle");
    if (title) title.textContent = "Objects in the game";
    setMode(false);
    refresh();
  }
  function close() {
    if (drag) finishDrag();
    finishPan();
    spaceHeld = false;
    view = { zoom: 1, x: 0, y: 0 };
    bridge()?.setView?.(view);
    if (paused) setPaused(false);
    active = false;
    picking = false;
    overlay.hidden = true;
    panel.hidden = true;
    overlaps.hidden = true;
    document.body.classList.remove("inspecting");
    inspectButton.setAttribute("aria-pressed", "false");
    playButton.setAttribute("aria-pressed", "true");
    $("#inspector").hidden = false;
    const title = $("#rightTitle");
    if (title) title.textContent = "Properties";
    // Drafts survive closing. Stopping Play only drops the preview, not unsaved edits.
  }
  function refresh() {
    if (!active) return;
    if (project?.id !== owner || $("#playView").hidden || !frame.src.includes("player.html")) {
      close();
      return;
    }
    if (!bridge()?.ready) {
      $("#livePause").disabled = true;
      notice(bridge()?.error ? "Inspect is not available: " + bridge().error : "Loading the room…");
      return;
    }
    try {
      listenInsideGame();
      const next = bridge().snapshot();
      $("#livePause").disabled = !paused && !canPause(next);
      if (!next?.objects) return;
      // While a room loads, the screen shows a loading animation, not the room.
      if (next.ready === false && state?.room !== next.room) {
        state = null;
        chosen = null;
        panel.querySelector("#liveCount").textContent = "Loading the room…";
        panel.querySelector("#liveList").replaceChildren();
        renderProperties();
        draw();
        return;
      }
      const restarted = runtimeEpoch != null && next.epoch != null && runtimeEpoch !== next.epoch;
      if (next.epoch != null) runtimeEpoch = next.epoch;
      if (restarted) {
        // A new runtime has new objects. Keep the drafts, drop anything tied to the old objects.
        chosen = null; parts = null; hovered = null; drag = null;
        locked.clear(); undoStack.length = 0; redoStack.length = 0;
        overlaps.hidden = true; signature = "";
        bridge().setRules(combinedRules());
        renderProperties();
        updateSave();
        notice("Your edits are still here. Select an object to keep editing.");
      }
      if (state?.room !== next.room) {
        chosen = null; parts = null; hovered = null;
        overlaps.hidden = true; signature = "";
        if (drafts.size) bridge().setRules(combinedRules());
        renderProperties();
        notice("Room: " + next.room.split(/::|\./).pop());
      }
      const { authoredRoom } = (() => {
        if (project.mode === "existing") return {};
        return { authoredRoom: project.scenes?.find((r) => next.room === "game.scenes." + project.id + "." + r.id + "::" + r.id[0].toUpperCase() + r.id.slice(1)) };
      })();
      if (authoredRoom)
        for (const o of next.objects) {
          const authored = authoredRoom.objects.find((item) => item.id === o.name);
          if (authored) o.category = liveSelection.authoredTypes[authored.kind] || "custom";
        }
      state = next;
      if (picking && state.viewport && view.zoom === 1 && !view.x && !view.y) fitView();
      const current = chosen && state.objects.find((o) => (chosen.uid != null ? o.uid === chosen.uid : o.path === chosen.path));
      if (chosen && !current) {
        // Never let a replacement object silently take over the selection.
        clearSelection();
        notice("That object is no longer in the room.");
      }
      if (current) Object.assign(chosen, current);
      if (current && !drag && !panel.contains(document.activeElement))
        for (const [name, title] of transformFields) {
          const input = panel.querySelector('[aria-label="Live ' + title + '"]');
          if (input) input.value = Math.round(current[name] * 1000) / 1000;
        }
      const stamp = state.room + "|" + state.objects.filter(onScreen).map((o) => o.path).join("|");
      if (stamp !== signature) {
        signature = stamp;
        list();
      }
      draw();
    } catch (e) {
      notice("Inspect: " + e.message);
    }
  }

  // ---- Pointer input ----

  function showOverlaps(hits) {
    overlaps.replaceChildren(create("strong", "Objects here"));
    overlaps.append(button("Close", () => { overlaps.hidden = true; hovered = null; draw(); }, { className: "liveClose" }));
    for (const o of hits) {
      const choice = button(displayName(o) + " · " + typeName(o), () => { select(o); overlaps.hidden = true; });
      choice.classList.toggle("active", o.path === chosen?.path);
      choice.onpointerenter = choice.onfocus = () => { hovered = o.path; draw(); };
      choice.onpointerleave = () => { hovered = null; draw(); };
      overlaps.append(choice);
    }
    overlaps.append(create("small", "Alt+click in the game cycles through these."));
    overlaps.hidden = hits.length < 2;
  }
  overlay.onpointerdown = (e) => {
    if (!state || !picking || e.button !== 0) return;
    e.preventDefault();
    // preventDefault keeps focus where it was, which may be the game. Take it,
    // so shortcuts such as Ctrl+Z reach Inspect.
    overlay.focus?.({ preventScroll: true });
    const p = point(e), r = overlay.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (spaceHeld) {
      pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: { ...view } };
      overlay.setPointerCapture(e.pointerId);
      overlaps.hidden = true;
      return;
    }
    // Only the handle moves objects, so a click to select never nudges anything.
    if (!e.altKey && chosen && moveHandle && Math.abs(x - moveHandle.x) <= 12 && Math.abs(y - moveHandle.y) <= 12) {
      drag = { pointerId: e.pointerId, x: p.x, y: p.y, originX: chosen.originX, originY: chosen.originY, before: checkpoint(), moved: false };
      overlay.setPointerCapture(e.pointerId);
      overlaps.hidden = true;
      return;
    }
    const allowed = rows(), hits = liveSelection.hits(allowed, p, state);
    const label = labels.findLast((l) => x >= l.left && x <= l.left + l.width && y >= l.top && y <= l.top + l.height);
    if (label && allowed.some((o) => o.path === label.object.path)) {
      select(label.object);
      overlaps.hidden = true;
      return;
    }
    if (!hits.length) {
      clearSelection();
      offerBackgrounds(p);
      return;
    }
    if (e.altKey) {
      const index = hits.findIndex((o) => o.path === chosen?.path);
      select(hits[(index + 1) % hits.length]);
      overlaps.hidden = true;
      return;
    }
    select(hits[0]);
    // Offer the chooser only for objects of a similar size. Backgrounds behind
    // nearly everything would make it pop up on every click. Alt+click still
    // reaches them.
    const area = (o) => Math.max(1, o.width * o.height);
    showOverlaps(hits.filter((o) => area(o) <= area(hits[0]) * 25));
  };
  // A click on empty space may be on artwork that is part of a background.
  function offerBackgrounds(p) {
    if (parts || typeCheck("backgrounds").checked || panel.querySelector("#liveSearch").value) return;
    const backgrounds = liveSelection.candidates(state, { categories: new Set(["backgrounds"]), visible: false, locked }).filter(onScreen);
    if (!liveSelection.hits(backgrounds, p, state).length) return;
    notice("That spot is part of a background.");
    const include = button("Show backgrounds", () => {
      typeCheck("backgrounds").checked = true;
      filterChanged();
      const found = liveSelection.hits(rows(), p, state);
      if (found.length) {
        select(found[0]);
        showOverlaps(found);
      }
    });
    panel.querySelector("#liveNotice").append(" ", include);
  }
  overlay.onpointermove = (e) => {
    if (pan) {
      setView({ x: pan.start.x + e.clientX - pan.x, y: pan.start.y + e.clientY - pan.y });
      return;
    }
    if (!state) return;
    const p = point(e);
    if (drag) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      // A small threshold keeps a shaky click on the handle from moving anything.
      if (Math.abs(dx) + Math.abs(dy) <= 3 && !drag.moved) return;
      drag.moved = true;
      const grid = snapOn && !e.altKey ? 10 : 1;
      const x = Math.round((drag.originX + dx) / grid) * grid, y = Math.round((drag.originY + dy) / grid) * grid;
      apply({ dragX: x, dragY: y }, false);
      notice("Moving to " + Math.round(x) + ", " + Math.round(y) + (snapOn ? ". Hold Alt to ignore snapping." : ". Esc cancels."));
      return;
    }
    hovered = liveSelection.hits(rows(), p, state)[0]?.path;
    draw();
  };
  overlay.onpointerleave = () => {
    if (!drag) {
      hovered = null;
      draw();
    }
  };
  function finishDrag(cancel = false) {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (overlay.hasPointerCapture?.(current.pointerId)) overlay.releasePointerCapture(current.pointerId);
    if (cancel) restoreCheckpoint(current.before);
    else if (current.moved) remember(current.before, checkpoint());
    renderProperties();
    if (current.moved) notice(cancel ? "Move canceled." : "Moved. Ctrl+Z undoes it.");
  }
  function finishPan(cancel = false) {
    if (!pan) return;
    const previous = pan;
    pan = null;
    if (cancel) setView(previous.start);
    if (overlay.hasPointerCapture?.(previous.pointerId)) overlay.releasePointerCapture(previous.pointerId);
  }
  overlay.onpointerup = () => { finishPan(); finishDrag(); };
  overlay.onpointercancel = overlay.onlostpointercapture = () => { finishPan(true); finishDrag(true); };

  // ---- Keyboard ----

  document.addEventListener("keydown", (e) => {
    if (!active || editableTarget(e.target) || $("#modal")?.open) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.code === "Space" && picking) {
      e.preventDefault();
      spaceHeld = true;
      overlay.style.cursor = "grab";
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (pan) finishPan(true);
      else if (drag) finishDrag(true);
      else if (!overlaps.hidden) { overlaps.hidden = true; hovered = null; draw(); }
      else if (chosen || parts) clearSelection();
      return;
    }
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      if (drag) finishDrag();
      const redo = k === "y" || e.shiftKey;
      historyStep(redo ? redoStack : undoStack, redo ? undoStack : redoStack);
      return;
    }
    if (e.key === "Tab" && !mod) {
      e.preventDefault();
      setMode(!picking);
      return;
    }
    if (!picking) return;
    if (!mod && !e.altKey) {
      if (k === "p") {
        e.preventDefault();
        $("#livePause").click();
        return;
      }
      if (k === "f" && chosen) {
        focusSelected();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        fitView();
        return;
      }
      if (k === "l" && chosen) {
        locked.add(chosen.uid ?? chosen.path);
        clearSelection();
        notice("Locked. Unlock it from the object list.");
        return;
      }
    }
    if (chosen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      apply({
        x: chosen.x + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
        y: chosen.y + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
      });
      return;
    }
    if (chosen && (e.key === "Delete" || (mod && ["c", "x", "v", "d"].includes(k)))) {
      e.preventDefault();
      const { authoredObject } = authoredMatch();
      notice(chosen.readOnly
        ? "Collision shapes cannot be copied or deleted here. Open the room source to change them."
        : authoredObject
          ? "Use Edit in room to copy or delete this object."
          : "Original game objects cannot be copied or deleted here. Unchecking Visible only hides the artwork.");
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceHeld = false;
      overlay.style.cursor = "crosshair";
    }
  });

  // ---- Toolbar ----

  inspectButton.onclick = () => {
    if (!active) open();
    if (!picking) setMode(true);
  };
  playButton.onclick = () => {
    if (active && picking) setMode(false);
  };
  $("#livePause").onclick = () => {
    if (!bridge()?.ready || (!paused && !canPause(state))) return;
    setPaused(!paused);
  };
  $("#liveUndo").onclick = () => historyStep(undoStack, redoStack);
  $("#liveRedo").onclick = () => historyStep(redoStack, undoStack);
  $("#liveZoomOut").onclick = () => { setMode(true); setView({ zoom: Math.max(0.5, view.zoom / 1.25) }); };
  $("#liveZoomIn").onclick = () => { setMode(true); setView({ zoom: Math.min(4, view.zoom * 1.25) }); };
  $("#liveZoomFit").onclick = fitView;

  setInterval(refresh, 500);
  window.liveEditor = {
    get active() { return active; },
    get inspecting() { return active && picking; },
    get hasUnsaved() { return drafts.size > 0; },
    get dirty() { return drafts.size > 0; },
    get selected() { return chosen; },
    get state() { return state; },
    undo: () => historyStep(undoStack, redoStack),
    redo: () => historyStep(redoStack, undoStack),
    save: saveEdits,
    // Drops unsaved edits without an undo step, for "Don't save".
    discard: () => {
      drafts.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      if (active) bridge()?.setRules(project.liveEdits || []);
      updateSave();
    },
    open,
    close,
    refresh,
    select,
    apply,
  };
})();
