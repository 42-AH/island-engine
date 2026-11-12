const $ = (s) => document.querySelector(s);
const call = (method, args = {}) =>
  window.workshop
    ? window.workshop.call(method, args)
    : fetch("/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workshop-Token": window.workshopToken,
        },
        body: JSON.stringify({ method, args }),
      }).then(async (r) => {
        if (!r.ok) throw Error(await r.text());
        return r.json();
      });
let project,
  room,
  selected,
  dirty = false,
  history = [],
  future = [],
  scale = 1,
  pan = { x: 30, y: 30 },
  drag = null,
  file = null,
  codeSaved = "",
  assetPage = 0,
  searchTimer;
const canvas = $("#canvas"),
  ctx = canvas.getContext("2d");
const images = new Map();
function assetImage(asset) {
  if (!/\.(png|jpe?g|svg|swf)$/i.test(asset || "")) return null;
  const key = project.id + "/" + asset;
  if (!images.has(key)) {
    const img = new Image();
    images.set(key, img);
    img.onload = draw;
    img.onerror = () => {
      if (/\.swf$/i.test(asset)) return;
      if (!img.dataset.fallback) {
        img.dataset.fallback = "1";
        img.src = "/library/" + asset;
      }
    };
    img.src = /\.swf$/i.test(asset)
      ? "/art-thumbnail?project=" +
        project.id +
        "&asset=" +
        encodeURIComponent(asset)
      : "/project-art/" + project.id + "/" + asset;
  }
  const img = images.get(key);
  return img.complete && img.naturalWidth ? img : null;
}
const colors = {
  platform: "#7e9275",
  wall: "#8c8272",
  climb: "#b89e6d",
  water: "#598daa",
  hazard: "#a86561",
  bounce: "#a394ba",
  movingPlatform: "#7c9994",
  npc: "#d5b77c",
  item: "#d6b05f",
  door: "#768a98",
  switch: "#889b79",
  trigger: "#c086a9",
  art: "#8995a2",
};
function status(text) {
  $("#status").textContent = text;
}
async function task(fn) {
  try {
    await fn();
  } catch (e) {
    const compiler = e.message.match(/(?:AVM2ParseException|AVM2CompilationException): ([^\r\n]+)/);
    const explanation = compiler ? "Compile error: " + compiler[1] + ". Your code is saved. The build log has the details." : e.message;
    status(compiler ? "Build failed. Check Build log." : e.message);
    await message("Could not finish", explanation);
  }
}
function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (className) n.className = className;
  return n;
}
// One dialog element serves every prompt. The primary button is the only
// submit button, so Enter confirms and Escape cancels. `check` can return a
// problem to show inline, which keeps the dialog and its typed values open.
function dialog(title, content, buttons, check) {
  const modal = $("#modal"), formNode = modal.querySelector("form");
  modal.returnValue = "";
  $("#modalTitle").textContent = title;
  $("#modalBody").replaceChildren(...content);
  $("#modalError").textContent = "";
  const actions = $("#modalActions");
  actions.replaceChildren();
  for (const b of buttons) {
    const node = el("button", b.label, b.primary ? "primary" : "");
    node.value = b.value;
    node.type = b.primary ? "submit" : "button";
    if (!b.primary) node.onclick = () => modal.close(b.value);
    actions.append(node);
  }
  modal.showModal();
  const first = $("#modalBody").querySelector("input,select,textarea");
  if (first) {
    first.focus();
    first.select?.();
  } else actions.querySelector(".primary")?.focus();
  // Select menus don't submit a form on Enter by themselves.
  formNode.onkeydown = (event) => {
    if (event.key === "Enter" && event.target.tagName === "SELECT") {
      event.preventDefault();
      formNode.requestSubmit();
    }
  };
  return new Promise((resolve) => {
    formNode.onsubmit = async (event) => {
      event.preventDefault();
      const primary = buttons.find((b) => b.primary);
      if (check) {
        let problem;
        try {
          problem = await check();
        } catch (error) {
          problem = error.message;
        }
        if (problem) {
          $("#modalError").textContent = problem;
          return;
        }
      }
      modal.close(primary.value);
    };
    modal.onclose = () => {
      formNode.onsubmit = null;
      resolve(modal.returnValue);
    };
  });
}
async function form(title, fields, { ok = "OK", check } = {}) {
  const content = [];
  for (const f of fields) {
    const label = el("label", f.label);
    const input = document.createElement(
      f.options ? "select" : f.multiline ? "textarea" : "input",
    );
    input.name = f.id;
    if (f.options)
      for (const o of f.options) {
        const opt = el("option", o.label || o);
        opt.value = o.value ?? o;
        input.append(opt);
      }
    input.value = f.value ?? (f.options ? input.value : "");
    if (f.placeholder) input.placeholder = f.placeholder;
    label.append(input);
    content.push(label);
    if (f.hint) content.push(el("p", f.hint, "muted"));
  }
  const values = () =>
    Object.fromEntries(
      [...$("#modalBody").querySelectorAll("input,select,textarea")].map((n) => [n.name, n.value]),
    );
  const answer = await dialog(
    title,
    content,
    [{ label: "Cancel", value: "cancel" }, { label: ok, value: "ok", primary: true }],
    check && (() => check(values())),
  );
  return answer === "ok" ? values() : null;
}
async function message(title, text) {
  await dialog(title, [el("p", text)], [{ label: "OK", value: "ok", primary: true }]);
}
// Returns the value of the chosen button, or "" when the dialog is dismissed.
function choose(title, text, buttons) {
  return dialog(title, [el("p", text)], buttons);
}
function snapshot() {
  history.push(JSON.stringify(project));
  if (history.length > 80) history.shift();
  future = [];
  dirty = true;
}
function changed() {
  dirty = true;
  updateSaveState();
  $("#undo").disabled = !history.length;
  $("#redo").disabled = !future.length;
  draw();
}
const codeUnsaved = () => !$("#codeView").hidden && !!file && $("#source").value !== codeSaved;
const hasUnsaved = () => !!project && (dirty || !!window.liveEditor?.hasUnsaved || codeUnsaved());
function updateSaveState() {
  const unsaved = hasUnsaved();
  $("#save").disabled = !project || !unsaved || buildBusy;
  $("#save").textContent = project && !unsaved ? "Saved" : "Save";
  if (project) $("#projectName").textContent = project.title + (unsaved ? " •" : "");
  $("#projectName").title = unsaved ? "Unsaved changes" : "";
}
window.addEventListener("islandengine-live-change", updateSaveState);
window.hasUnsavedWork = hasUnsaved;
async function saveCurrent() {
  if (codeUnsaved()) await saveCode();
  await save();
}
window.saveCurrent = saveCurrent;
async function save() {
  if (!project) return;
  await call("save", { project });
  await window.liveEditor?.save();
  dirty = false;
  updateSaveState();
  status("Saved");
}
// Asks before leaving unsaved work. Returns false when the user cancels.
async function settleUnsaved(action) {
  if (!hasUnsaved()) return true;
  const answer = await choose(
    "Save changes to " + project.title + "?",
    "You have unsaved changes. Save them before you " + action + "?",
    [
      { label: "Cancel", value: "cancel" },
      { label: "Don't save", value: "discard" },
      { label: "Save", value: "save", primary: true },
    ],
  );
  if (answer === "save") {
    await saveCurrent();
    return true;
  }
  if (answer !== "discard") return false;
  dirty = false;
  window.liveEditor?.discard?.();
  codeSaved = $("#source").value;
  updateSaveState();
  return true;
}
async function open(id) {
  if (project && !(await settleUnsaved("open another island"))) return false;
  stopPlay();
  closeCodeView();
  project = await call("open", { id });
  try { localStorage.setItem("islandengine-last-project", id); } catch { /* Opening still works without it. */ }
  room =
    project.scenes.find((r) => r.id === project.start) || project.scenes[0];
  selected = null;
  history = [];
  future = [];
  dirty = false;
  $("#existingHelp").hidden = project.mode !== "existing";
  $("#addRoom").textContent =
    project.version === "AS2" ? "+ Copy a room" : "+ Add room";
  $("#engineClass").textContent =
    project.version === "AS2" ? "Open AS2 SWF" : "Open engine class";
  updateWorkspace();
  await renderRooms();
  inspect();
  fit();
  await files();
  switchTab("rooms");
  status(project.mode === "existing" ? "Choose a room to open its files, or press Play." : "Ready");
  return true;
}
async function renderRooms() {
  const list = $("#roomList");
  list.replaceChildren();
  if (project?.mode === "existing") {
    const id = project.id;
    const rows = await call("rooms", { project: id });
    if (project.id !== id) return;
    for (const r of rows) {
      const b = el("button", r.title, "room");
      b.onclick = () =>
        task(async () => {
          if (project.version === "AS2") {
            status("Opening room code…");
            const source = await call("decompileSwf", {
              project: id,
              file: r.file,
            });
            await files();
            const first =
              source.find((f) => f.endsWith("/scripts/frame_1/DoAction.as")) ||
              source[0];
            if (first) await openCode(first);
            status("Save and build to try your code changes.");
          } else await openCode("overlay/" + r.file);
          switchTab("code");
        });
      list.append(b);
    }
    if (!rows.length) list.append(el("p", "No room files were found in this copy.", "muted"));
    renderExistingRooms(rows);
    return;
  }
  for (const r of project?.scenes || []) {
    const b = el(
      "button",
      r.title || r.id,
      "room" + (room === r ? " active" : ""),
    );
    b.append(
      el(
        "small",
        `${r.id === project.start ? "Start · " : ""}${r.width} × ${r.height}`,
      ),
    );
    b.onclick = () =>
      task(async () => {
        if (codeUnsaved()) await saveCode();
        closeCodeView();
        room = project.scenes.find((scene) => scene.id === r.id);
        selected = null;
        renderRooms();
        inspect();
        fit();
      });
    list.append(b);
  }
}
function switchTab(name) {
  for (const n of document.querySelectorAll("nav button"))
    n.classList.toggle("active", n.dataset.tab === name);
  for (const n of document.querySelectorAll(".tab")) n.hidden = n.id !== name;
  if (name === "assets") assets();
  if (name === "items") renderItems();
  if (name === "code") files();
}
document
  .querySelectorAll("nav button")
  .forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function field(parent, key, value, onchange, type = "text") {
  const label = el("label", key);
  const input = document.createElement(
    type === "textarea" ? "textarea" : "input",
  );
  input.type = type;
  input.setAttribute("aria-label", key);
  if (type === "text" && /flag/i.test(key)) {
    let choices = $("#flagNames");
    if (!choices) { choices = el("datalist"); choices.id = "flagNames"; document.body.append(choices); }
    const flags = new Set(project?.flags || []);
    const collect = (value) => {
      for (const name of ["requires", "unless", "showWhen", "hideWhen"]) if (value[name]) flags.add(value[name]);
      if (value.type === "flag" && value.id) flags.add(value.id);
      for (const action of value.actions || []) collect(action);
    };
    for (const scene of project?.scenes || []) for (const object of scene.objects || []) collect(object);
    for (const item of project?.items || []) collect(item);
    choices.replaceChildren(...[...flags].sort().map((name) => { const option = el("option"); option.value = name; return option; }));
    input.setAttribute("list", "flagNames");
  }
  input.value = value ?? "";
  let accepted = input.value;
  input.onchange = () => {
    if (type === "number" && (input.value.trim() === "" || !Number.isFinite(Number(input.value)))) {
      input.value = accepted;
      status(key + " needs a number.");
      return;
    }
    accepted = input.value;
    snapshot();
    onchange(type === "number" ? Number(input.value) : input.value);
    changed();
  };
  parent.append(label, input);
  return input;
}
// Puts short fields side by side. Each field adds a label and an input, so
// wrap each pair to keep the grid cells together.
function pair(parent, build) {
  const row = el("div", null, "pair");
  build(row);
  const nodes = [...row.children];
  row.replaceChildren();
  for (let i = 0; i < nodes.length; i += 2) {
    const cell = el("div");
    cell.append(nodes[i], nodes[i + 1]);
    row.append(cell);
  }
  parent.append(row);
}
function section(parent, title, open = true) {
  const box = el("details", null, "inspectorSection");
  box.open = open;
  box.append(el("summary", title));
  parent.append(box);
  return box;
}
const kindTitles = {
  npc: "Character",
  movingPlatform: "Moving platform",
  art: "Scenery",
  switch: "Switch",
  trigger: "Trigger",
  platform: "Platform",
  wall: "Wall",
  climb: "Climbing area",
  water: "Water",
  hazard: "Hazard",
  bounce: "Bounce pad",
  item: "Item",
  door: "Door",
  custom: "Custom object",
};
const activation = {
  npc: "Runs when the player clicks this character.",
  switch: "Runs when the player clicks this switch.",
  door: "The player walks to the door, then these actions run before the room changes.",
  item: "Runs when the player picks up this item.",
  trigger: "Runs once when the player walks into this area.",
  custom: "Runs when the player clicks this object.",
};
function inspect() {
  const box = $("#inspector");
  box.replaceChildren();
  renderObjects();
  updateKeyHints();
  if (!project) return;
  if (selected?.kind === "inventory") {
    inspectItem(box);
    return;
  }
  if (!selected) {
    if (!room) {
      box.append(el("h3", "Island"));
      field(box, "Island name", project.title, (v) => {
        project.title = v;
        updateSaveState();
        renderRooms();
      });
      return;
    }
    inspectRoom(box);
    return;
  }
  inspectObject(box);
}
function inspectRoom(box) {
  box.append(el("h3", room.title || room.id), el("p", "Room · click an object to edit it", "muted"));
  const settings = section(box, "Room");
  field(settings, "Room name", room.title, (v) => {
    room.title = v;
    renderRooms();
    inspect();
  });
  pair(settings, (row) => {
    field(row, "Width", room.width, (v) => (room.width = v), "number");
    field(row, "Height", room.height, (v) => (room.height = v), "number");
  });
  field(settings, "Background", room.background, (v) => (room.background = v), "color");
  pair(settings, (row) => {
    field(row, "Start X", room.spawn.x, (v) => (room.spawn.x = v), "number");
    field(row, "Start Y", room.spawn.y, (v) => (room.spawn.y = v), "number");
  });
  field(settings, "Music file", room.music || "", (v) => (room.music = v));
  const b = el("button", "Make this the first room", "wide");
  b.title = "New games start in this room.";
  b.onclick = () => {
    snapshot();
    project.start = room.id;
    changed();
    renderRooms();
    inspect();
    status("New games now start in " + (room.title || room.id) + ".");
  };
  if (project.start === room.id) {
    b.disabled = true;
    b.textContent = "New games start here";
  }
  settings.append(b);
  const island = section(box, "Island", false);
  field(island, "Island name", project.title, (v) => {
    project.title = v;
    updateSaveState();
  });
  const code = section(box, "Room code", false);
  field(code, "ActionScript class", room.script || "", (v) => (room.script = v));
  code.append(el("p", "Leave empty to use the standard room. See Code for an example class.", "muted"));
  const remove = el("button", "Delete room", "wide danger");
  remove.disabled = project.scenes.length < 2;
  remove.title = remove.disabled ? "An island needs at least one room." : "";
  remove.onclick = () =>
    task(async () => {
      const answer = await choose("Delete " + (room.title || room.id) + "?", "This removes the room and its objects. Ctrl+Z brings them back.", [
        { label: "Cancel", value: "cancel" },
        { label: "Delete room", value: "delete", primary: true },
      ]);
      if (answer !== "delete") return;
      snapshot();
      project.scenes = project.scenes.filter((s) => s !== room);
      if (project.start === room.id) project.start = project.scenes[0].id;
      room = project.scenes[0];
      selected = null;
      renderRooms();
      inspect();
      fit();
      changed();
      status("Room deleted. Press Ctrl+Z to undo.");
    });
  box.append(remove);
}
function inspectObject(box) {
  const o = selected;
  box.append(el("h3", o.label || o.id), el("p", kindTitles[o.kind] || o.kind, "muted"));
  if (activation[o.kind]) box.append(el("p", activation[o.kind], "hint"));
  if (o.kind === "door") {
    const door = section(box, "Where it leads");
    selectField(
      door,
      "Destination room",
      o.target,
      project.scenes.map((r) => ({ value: r.id, label: r.title || r.id })),
      (value) => {
        o.target = value;
        const destination = project.scenes.find((s) => s.id === value);
        o.targetX = destination.spawn.x;
        o.targetY = destination.spawn.y;
        inspect();
      },
    );
    pair(door, (row) => {
      field(row, "Arrive at X", o.targetX ?? 160, (v) => (o.targetX = v), "number");
      field(row, "Arrive at Y", o.targetY ?? 650, (v) => (o.targetY = v), "number");
    });
  }
  if (o.kind === "item") {
    const item = section(box, "Item");
    selectField(item, "Gives the player", o.itemId || o.id, itemChoices(), (value) => (o.itemId = value));
  }
  if (o.kind === "movingPlatform") {
    const motion = section(box, "Movement");
    pair(motion, (row) => {
      field(row, "Travel X", o.travelX ?? 200, (v) => (o.travelX = v), "number");
      field(row, "Travel Y", o.travelY ?? 200, (v) => (o.travelY = v), "number");
    });
    field(motion, "Speed", o.speed ?? 1, (v) => (o.speed = v), "number");
  }
  if (o.kind === "bounce") {
    const bounce = section(box, "Bounce");
    field(bounce, "Bounce strength", o.strength ?? 750, (v) => (o.strength = v), "number");
  }
  // What an object says and does matters more than where it sits, since
  // position is easier to change by dragging.
  if (["npc", "item", "door", "switch", "trigger", "custom"].includes(o.kind)) {
    const talk = section(box, "Dialogue and locks");
    field(talk, "Dialogue", o.text || "", (v) => (o.text = v), "textarea");
    selectField(talk, "Needs item", o.requiresItem || "", [{ value: "", label: "None" }, ...itemChoices()], (v) => (o.requiresItem = v));
    pair(talk, (row) => {
      field(row, "Needs flag", o.requires || "", (v) => (o.requires = v));
      field(row, "Stops after flag", o.unless || "", (v) => (o.unless = v));
    });
    field(talk, "Reply when locked", o.lockedText || "", (v) => (o.lockedText = v));
    renderActions(box);
  }
  const place = section(box, "Position and size");
  pair(place, (row) => {
    field(row, "X", o.x, (v) => (o.x = v), "number");
    field(row, "Y", o.y, (v) => (o.y = v), "number");
  });
  pair(place, (row) => {
    field(row, "Width", o.width, (v) => (o.width = v), "number");
    field(row, "Height", o.height, (v) => (o.height = v), "number");
  });
  const look = section(box, "Look");
  field(look, "Name", o.label || "", (v) => {
    o.label = v;
    inspect();
  });
  field(look, "Art file", o.asset || "", (v) => (o.asset = v));
  const browse = el("button", "Choose art…", "wide");
  browse.onclick = () => {
    switchTab("assets");
    status("Find art, then press Use to put it on " + (o.label || o.id) + ".");
  };
  look.append(browse);
  if (!o.asset) field(look, "Color", o.color || colors[o.kind], (v) => (o.color = v), "color");
  selectField(look, "Artwork", String(!o.hidden), [
    { value: "true", label: "Visible" }, { value: "false", label: "Hidden (collision still works)" },
  ], (v) => (o.hidden = v === "false"));
  pair(look, (row) => {
    field(row, "Show after flag", o.showWhen || "", (v) => (o.showWhen = v));
    field(row, "Hide after flag", o.hideWhen || "", (v) => (o.hideWhen = v));
  });
  if (o.kind === "npc") {
    const outfit = section(box, "Character look", false);
    outfit.append(el("p", "Use part IDs from the asset library.", "muted"));
    for (const [k, title] of [["gender", "Gender"], ["skinColor", "Skin color"], ["hairColor", "Hair color"], ["hair", "Hair"], ["shirt", "Shirt"], ["pants", "Pants"]])
      field(outfit, title, o[k] || "", (v) => (o[k] = v));
  }
  const advanced = section(box, "Advanced", false);
  field(advanced, "Object ID", o.id, (v) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(v) || room.objects.some((other) => other !== o && other.id === v)) {
      status("Object IDs must be unique and use letters, numbers, or underscores.");
      inspect();
      return;
    }
    o.id = v;
    inspect();
  });
  field(
    advanced,
    "Actions as JSON",
    JSON.stringify(o.actions || [], null, 2),
    (v) => {
      try {
        const actions = JSON.parse(v);
        if (!Array.isArray(actions)) throw Error("Actions must be a list");
        o.actions = actions;
        inspect();
        status("Actions updated");
      } catch {
        status("Actions must be a JSON list, like [ ].");
      }
    },
    "textarea",
  );
  const all = el("button", "Edit all properties as JSON…", "wide");
  all.onclick = () =>
    task(async () => {
      const result = await form("Object properties", [
        { id: "json", label: "JSON", value: JSON.stringify(selected, null, 2), multiline: true },
      ], {
        ok: "Apply",
        check: async ({ json }) => {
          let next;
          try {
            next = JSON.parse(json);
          } catch (error) {
            return "This is not valid JSON: " + error.message;
          }
          if (!next || typeof next !== "object" || Array.isArray(next)) return "Keep the object's id, kind, position, and size in the JSON.";
          const draft = structuredClone(project);
          draft.scenes.find((r) => r.id === room.id).objects[room.objects.indexOf(selected)] = next;
          const errors = await call("validate", { project: draft, forSave: true });
          return errors.join("\n");
        },
      });
      if (!result) return;
      const next = JSON.parse(result.json);
      snapshot();
      room.objects[room.objects.indexOf(selected)] = next;
      selected = next;
      inspect();
      changed();
    });
  advanced.append(all);
  const tools = el("div", null, "row objectButtons");
  const duplicate = el("button", "Duplicate");
  duplicate.title = "Ctrl+D";
  duplicate.onclick = () => pasteObject(selected);
  const remove = el("button", "Delete", "danger");
  remove.title = "Delete key";
  remove.onclick = removeSelected;
  tools.append(duplicate, remove);
  box.append(tools);
}
function unique(kind) {
  let i = 1;
  while (room.objects.some((o) => o.id === kind + i)) i++;
  return kind + i;
}
function removeSelected() {
  if (!selected || selected.kind === "inventory") return;
  snapshot();
  room.objects = room.objects.filter((o) => o !== selected);
  selected = null;
  inspect();
  changed();
}
function fit() {
  if (!room) return;
  scale = Math.min(
    (canvas.clientWidth - 70) / room.width,
    (canvas.clientHeight - 70) / room.height,
  );
  pan = {
    x: (canvas.clientWidth - room.width * scale) / 2,
    y: (canvas.clientHeight - room.height * scale) / 2,
  };
  draw();
}
// Zooms to the selected object, or to the whole room when nothing is selected.
function frameSelected() {
  if (!room || !selected || !room.objects.includes(selected)) return fit();
  const top = selected.kind === "npc" ? selected.y - selected.height : selected.y;
  scale = Math.min(4, (canvas.clientWidth * 0.5) / Math.max(selected.width, 40), (canvas.clientHeight * 0.5) / Math.max(selected.height, 40));
  pan = {
    x: canvas.clientWidth / 2 - (selected.x + selected.width / 2) * scale,
    y: canvas.clientHeight / 2 - (top + selected.height / 2) * scale,
  };
  draw();
}
const shortcutGroups = [
  ["Everywhere", [
    ["Ctrl+S", "Save"],
    ["F5", "Play"],
    ["Shift+F5", "Stop"],
    ["? or F1", "This list"],
  ]],
  ["Room editor", [
    ["1 to 8", "Select, Scenery, Platform, Character, Item, Door, Switch, Trigger"],
    ["Esc", "Back to Select, then clear the selection"],
    ["Arrows", "Nudge 1 px (Shift: 10 px)"],
    ["Delete or X", "Delete object"],
    ["Ctrl+C, Ctrl+X, Ctrl+V", "Copy, cut, paste"],
    ["Ctrl+D or Shift+D", "Duplicate"],
    ["Ctrl+Z, Ctrl+Y", "Undo, redo (Ctrl+Shift+Z also redoes)"],
    ["F", "Zoom to the selected object"],
    ["Home", "Fit the room"],
    ["Wheel, Alt-drag", "Zoom, pan"],
    ["Shift while dragging", "Ignore snapping"],
  ]],
  ["Play and Inspect", [
    ["Tab", "Switch between Play and Inspect"],
    ["Click, Alt+click", "Select, cycle through overlapping objects"],
    ["Arrows", "Nudge 1 px (Shift: 10 px)"],
    ["Ctrl+Z, Ctrl+Y", "Undo, redo"],
    ["P", "Pause or resume"],
    ["F", "Focus on the selected object"],
    ["Home", "Fit"],
    ["L", "Lock the selected object"],
    ["Space-drag", "Pan"],
    ["Esc", "Cancel a drag, then clear the selection"],
  ]],
];
// The footer shows the few keys that matter for what you're doing right now.
function updateKeyHints() {
  let hints = "";
  if (document.body.classList.contains("playing"))
    hints = window.liveEditor?.inspecting
      ? window.liveEditor.selected
        ? "Drag handle to move · Arrows nudge · F focus · Esc clear"
        : "Click to select · Alt+click cycles · P pause · Tab play"
      : "Tab inspect · Shift+F5 stop";
  else if (project && project.mode !== "existing" && $("#codeView").hidden) {
    const tool = $("#tool").dataset.active;
    if (tool && tool !== "select") hints = "Click to place · Esc cancel";
    else if (selected && room?.objects.includes(selected)) hints = "Drag to move · Arrows nudge · Del delete · Ctrl+D duplicate · F zoom";
    else hints = "1–8 tools · Home fit · F5 play";
  }
  $("#keyHints").textContent = hints;
}
window.updateKeyHints = updateKeyHints;
$("#shortcutsButton").onclick = showShortcuts;
function showShortcuts() {
  const content = [];
  for (const [title, rows] of shortcutGroups) {
    content.push(el("h3", title));
    const table = el("table", null, "shortcuts");
    for (const [keys, what] of rows) {
      const row = el("tr");
      row.append(el("th", keys), el("td", what));
      table.append(row);
    }
    content.push(table);
  }
  dialog("Keyboard shortcuts", content, [{ label: "Close", value: "close", primary: true }]);
}
function resize() {
  const d = devicePixelRatio;
  canvas.width = canvas.clientWidth * d;
  canvas.height = canvas.clientHeight * d;
  draw();
}
new ResizeObserver(resize).observe($("#stage"));
function draw() {
  const d = devicePixelRatio;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!room) return;
  ctx.translate(pan.x, pan.y);
  ctx.scale(scale, scale);
  ctx.fillStyle = room.background;
  ctx.fillRect(0, 0, room.width, room.height);
  if ($("#grid").checked) {
    ctx.strokeStyle = "#ffffff15";
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = 0; x < room.width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, room.height);
    }
    for (let y = 0; y < room.height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(room.width, y);
    }
    ctx.stroke();
  }
  for (const o of room.objects) {
    const y = o.kind === "npc" ? o.y - o.height : o.y;
    const img = assetImage(o.asset);
    ctx.globalAlpha = o.hidden ? 0.2 : o.kind === "trigger" ? 0.35 : 1;
    ctx.fillStyle = o.color || colors[o.kind];
    if (img) ctx.drawImage(img, o.x, y, o.width, o.height);
    else ctx.fillRect(o.x, y, o.width, o.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o === selected ? "#fff" : "#14282d70";
    ctx.lineWidth = (o === selected ? 2 : 1) / scale;
    ctx.strokeRect(o.x, y, o.width, o.height);
    if (!img || o === selected) {
      ctx.fillStyle = "#17272e";
      ctx.font = `${Math.max(13, 10 / scale)}px Segoe UI`;
      ctx.fillText(o.label || o.id, o.x + 5, y + Math.max(17, 13 / scale));
    }
    if (o === selected) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(
        o.x + o.width - 5 / scale,
        y + o.height - 5 / scale,
        10 / scale,
        10 / scale,
      );
    }
  }
  ctx.fillStyle = "#e5ffe8";
  ctx.beginPath();
  ctx.arc(room.spawn.x, room.spawn.y, 9 / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#203b2b";
  ctx.font = `${12 / scale}px Segoe UI`;
  ctx.fillText("START", room.spawn.x + 14 / scale, room.spawn.y);
  $("#zoomLabel").textContent = Math.round(scale * 100) + "%";
}
function point(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - pan.x) / scale,
    y: (e.clientY - r.top - pan.y) / scale,
  };
}
canvas.onpointerdown = (e) => {
  if (!room || project.mode === "existing") return;
  canvas.setPointerCapture(e.pointerId);
  const p = point(e);
  if (e.button === 1 || e.altKey) {
    drag = { pan: true, x: e.clientX, y: e.clientY, start: { ...pan } };
    return;
  }
  const tool = $("#tool").dataset.active || "select";
  if (tool !== "select") {
    snapshot();
    const o = {
      id: unique(tool),
      kind: tool,
      x: Math.round(p.x / 10) * 10,
      y: Math.round(p.y / 10) * 10,
      width: tool === "npc" ? 60 : 120,
      height: tool === "npc" ? 110 : tool === "platform" ? 24 : 80,
      color: colors[tool],
    };
    if (tool === "door") o.target = room.id;
    room.objects.push(o);
    selected = o;
    chooseTool("select");
    changed();
  } else
    selected = [...room.objects].reverse().find((o) => {
      const y = o.kind === "npc" ? o.y - o.height : o.y;
      return (
        p.x >= o.x &&
        p.x <= o.x + o.width + 8 / scale &&
        p.y >= y &&
        p.y <= y + o.height + 8 / scale
      );
    });
  if (selected) {
    const y =
      selected.kind === "npc" ? selected.y - selected.height : selected.y;
    drag = {
      x: p.x,
      y: p.y,
      start: { ...selected },
      moved: false, wasDirty: dirty, previousFuture: future,
      resize:
        Math.abs(p.x - selected.x - selected.width) < 12 / scale &&
        Math.abs(p.y - y - selected.height) < 12 / scale,
    };
  }
  inspect();
  draw();
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  if (drag.pan) {
    pan.x = drag.start.x + e.clientX - drag.x;
    pan.y = drag.start.y + e.clientY - drag.y;
    draw();
    return;
  }
  const p = point(e);
  if (!drag.moved) {
    if (Math.hypot(p.x - drag.x, p.y - drag.y) * scale < 4) return;
    snapshot(); drag.moved = true;
  }
  const snap = (n) => (!$("#grid").checked || e.shiftKey ? n : Math.round(n / 10) * 10);
  if (drag.resize) {
    selected.width = Math.max(10, snap(drag.start.width + p.x - drag.x));
    selected.height = Math.max(10, snap(drag.start.height + p.y - drag.y));
  } else {
    selected.x = snap(drag.start.x + p.x - drag.x);
    selected.y = snap(drag.start.y + p.y - drag.y);
  }
  changed();
};
canvas.onpointerup = () => {
  drag = null;
  inspect();
};
canvas.onwheel = (e) => {
  e.preventDefault();
  const p = point(e),
    r = canvas.getBoundingClientRect();
  scale = Math.max(0.03, Math.min(4, scale * Math.exp(-e.deltaY * 0.001)));
  pan.x = e.clientX - r.left - p.x * scale;
  pan.y = e.clientY - r.top - p.y * scale;
  draw();
};
$("#fit").onclick = fit;
$("#grid").onchange = draw;
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(project));
  const id = room?.id, selectedId = selected?.id, selectedKind = selected?.kind;
  project = JSON.parse(from.pop());
  room = project.scenes.find((s) => s.id === id) || project.scenes[0];
  // Keep the same object selected when it still exists after the step.
  selected =
    selectedKind === "inventory"
      ? project.items?.find((i) => i.id === selectedId) || null
      : room?.objects.find((o) => o.id === selectedId) || null;
  renderItems();
  renderRooms();
  inspect();
  changed();
}
$("#undo").onclick = () => restore(history, future);
$("#redo").onclick = () => restore(future, history);
$("#save").onclick = () => task(saveCurrent);
$("#projects").onclick = () =>
  task(async () => {
    const s = await call("status");
    if (!s.projects.length) {
      await message("No saved islands", "Choose New island to make one, or Copy island to edit an original.");
      return;
    }
    const kind = (p) => (p.mode === "existing" ? "copied island" : "new island");
    const r = await form("Open island", [
      {
        id: "id",
        label: "Island",
        value: project?.id,
        options: s.projects
          .slice()
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((p) => ({ value: p.id, label: p.title + " (" + kind(p) + ")" })),
      },
    ], { ok: "Open" });
    if (r && r.id !== project?.id) await open(r.id);
  });
// Turns a display name into an unused project folder name.
async function projectId(title, fallback = "island") {
  const base = title.replace(/[^A-Za-z0-9_]/g, "") || fallback;
  const prefix = /^[A-Za-z]/.test(base) ? base : fallback + base;
  const used = new Set((await call("status")).projects.map((p) => p.id.toLowerCase()));
  let id = prefix,
    suffix = 2;
  while (used.has(id.toLowerCase())) id = prefix + suffix++;
  return id;
}
const engineChoices = [
  { value: "AS3", label: "AS3 (newer islands, visual room editor)" },
  { value: "AS2", label: "AS2 (classic islands, script editing)" },
];
$("#newProject").onclick = () =>
  task(async () => {
    const r = await form(
      "New island",
      [
        { id: "title", label: "Island name", value: "", placeholder: "My island" },
        {
          id: "version",
          label: "Engine",
          options: engineChoices,
          hint: "AS3 starts with an empty room you can build visually. AS2 starts from a copy of a classic island.",
        },
      ],
      { ok: "Create island", check: (v) => (v.title.trim() ? "" : "Give your island a name.") },
    );
    if (!r) return;
    if (project && !(await settleUnsaved("create a new island"))) return;
    const title = r.title.trim();
    const id = await projectId(title);
    if (r.version === "AS2") {
      const islands = await call("islands", { version: "AS2" });
      if (!islands.length) throw Error("No AS2 islands were found in the game folder.");
      const starter = await form("Choose a starting island", [
        { id: "island", label: "Start from a copy of", options: islands },
      ], { ok: "Create island" });
      if (!starter) return;
      status("Copying island…");
      await call("importIsland", { id, title, version: "AS2", island: starter.island });
    } else await call("create", { id, title });
    dirty = false;
    await open(id);
    status(project.mode === "existing" ? "Choose a room to open its files, or press Play." : "Pick an object above the room, then click in the room to place it.");
  });
$("#startIsland").onclick = () => $("#newProject").click();
$("#openIsland").onclick = () => $("#projects").click();
$("#copyOriginal").onclick = () => $("#importIsland").click();
$("#emptyLibrary").onclick = () => $("#library").click();
$("#addRoom").onclick = () =>
  task(async () => {
    if (!project) return;
    if (project.version === "AS2") {
      const rooms = await call("rooms", { project: project.id });
      const r = await form("Copy a room", [
        { id: "file", label: "Copy from", options: rooms.map((r) => ({ value: r.file, label: r.title })) },
        { id: "name", label: "New room name", value: "NewRoom", hint: "Letters, numbers, and underscores. Start with a letter." },
      ], {
        ok: "Copy room",
        check: (v) =>
          !/^[A-Za-z][A-Za-z0-9_]*$/.test(v.name)
            ? "Start the name with a letter and use only letters, numbers, or underscores."
            : rooms.some((room) => room.title.toLowerCase() === v.name.toLowerCase())
              ? "A room with that name already exists."
              : "",
      });
      if (!r) return;
      await call("copyRoom", { project: project.id, ...r });
      await renderRooms();
      status("Room copied. Edit its code to change the exits.");
      return;
    }
    if (project.mode === "existing") return;
    let next = project.scenes.length + 1;
    while (project.scenes.some((s) => s.id === "room" + next)) next++;
    const r = await form("Add room", [
      { id: "title", label: "Room name", value: "Room " + next },
    ], { ok: "Add room", check: (v) => (v.title.trim() ? "" : "Give the room a name.") });
    if (!r) return;
    const stem = r.title.replace(/[^A-Za-z0-9_]/g, "");
    let id = /^[A-Za-z]/.test(stem) ? stem[0].toLowerCase() + stem.slice(1) : "room" + next;
    for (let n = 2; project.scenes.some((s) => s.id === id); n++) id = id.replace(/\d*$/, "") + n;
    snapshot();
    room = {
      id,
      title: r.title.trim(),
      width: 1600,
      height: 900,
      background: "#b0d9df",
      spawn: { x: 160, y: 650 },
      objects: [{ id: "ground", kind: "platform", x: 0, y: 760, width: 1600, height: 140, color: "#655b44" }],
    };
    project.scenes.push(room);
    selected = null;
    renderRooms();
    inspect();
    fit();
    changed();
    status("Room added. Put a door in another room to lead here.");
  });
$("#importIsland").onclick = () =>
  task(async () => {
    const choice = await form("Copy an island", [
      {
        id: "version",
        label: "Engine",
        options: engineChoices,
        hint: "A copy keeps the original art and scripts. Change it through Code and Inspect.",
      },
    ], { ok: "Next" });
    if (!choice) return;
    const islands = await call("islands", choice);
    if (!islands.length) throw Error("No " + choice.version + " islands were found in the game folder.");
    const r = await form("Copy an island", [
      { id: "island", label: "Island", options: islands },
      { id: "title", label: "Name for your copy", value: "", placeholder: "Leave empty to use the island's name" },
    ], { ok: "Copy island" });
    if (!r) return;
    if (project && !(await settleUnsaved("open the copy"))) return;
    const title = r.title.trim() || "Copy of " + islands.find((i) => i.value === r.island).label;
    const id = await projectId("copy" + r.island, "copy");
    status("Copying island…");
    await call("importIsland", { ...r, ...choice, id, title });
    dirty = false;
    await open(id);
  });
$("#library").onclick = () =>
  task(async () => {
    $("#projectMenu").hidePopover?.();
    if (!window.workshop) throw Error("Choose the game folder in the desktop app.");
    const s = await call("chooseLibrary");
    if (s) {
      showLibrary(s);
      status("Game folder set.");
    }
  });
function showLibrary(s) {
  $("#libraryInfo").textContent = s.library
    ? s.assets.toLocaleString() + " files · " + (s.artSymbols || 0).toLocaleString() + " art pieces"
    : "No game folder chosen.";
  $("#libraryInfo").title = s.library || "";
  const missing = !s.library;
  $("#emptyLibrary").hidden = !missing;
  $("#startIsland").hidden = missing;
  $("#copyOriginal").hidden = missing;
  $("#openIsland").hidden = missing;
  $("#emptyText").textContent = missing
    ? "Choose the Poptropica game folder first. It contains the game and ruffle folders."
    : "Start with an empty room, or copy an original island to change its artwork and scripts.";
}
let buildBusy = false;
// Lists unfinished links and actions before a build, so a broken door or an
// empty action shows up by name instead of as a compiler failure.
async function checkProblems(verb) {
  if (project.mode === "existing") return true;
  const problems = await call("validate", { project });
  if (!problems.length) return true;
  const list = el("ul", null, "problemList");
  for (const text of problems.slice(0, 12)) list.append(el("li", text));
  if (problems.length > 12) list.append(el("li", "…and " + (problems.length - 12) + " more"));
  await dialog("Fix these before you " + verb, [list], [{ label: "OK", value: "ok", primary: true }]);
  status(problems.length === 1 ? "1 thing to fix before you " + verb + "." : problems.length + " things to fix before you " + verb + ".");
  return false;
}
async function buildOperation(play = false, exporting = false) {
  if (buildBusy) return;
  if (!project) throw Error("Open an island first.");
  buildBusy = true;
  updateSaveState();
  const started = Date.now(), disabled = new Map();
  for (const id of ["build", "play", "applyPlay", "export", "newProject", "projects", "importIsland", "stopPlay"]) {
    const node = $("#" + id); disabled.set(node, node.disabled); node.disabled = true;
  }
  let stage = "Saving…", polling = false, shown = false;
  function feedback() {
    $("#buildStage").textContent = stage;
    const seconds = Math.floor((Date.now() - started) / 1000);
    $("#buildElapsed").textContent = seconds + " s" + (seconds > 20 ? " · The first build of an island takes longest." : "");
  }
  function showProgress() {
    shown = true;
    $("#buildProgress").hidden = false;
    $("#buildProgress").setAttribute("aria-busy", "true");
  }
  async function poll() {
    feedback(); if (polling) return; polling = true;
    try { const result = await call("status"); $("#log").textContent = result.logs.join(""); }
    catch { /* The build request reports its own error. */ }
    finally { polling = false; }
  }
  feedback(); const timer = setInterval(poll, 700);
  try {
    await saveCurrent();
    if (!(await checkProblems(exporting ? "export" : play ? "play" : "build"))) return;
    showProgress();
    stage = exporting ? "Building the export…" : "Building the island…"; feedback();
    if (exporting) {
      const dir = await call("export", { project: project.id });
      status("Exported to " + dir);
      const answer = await dialog("Export finished", [
        el("p", "Open islandengine.exe in this folder to play. To share the game, zip the whole folder."),
        el("code", dir, "path"),
      ], window.workshop
        ? [{ label: "Close", value: "close" }, { label: "Show folder", value: "show", primary: true }]
        : [{ label: "OK", value: "close", primary: true }]);
      if (answer === "show") await call("showFolder", { path: dir });
      return;
    }
    const result = await call("build", { project: project.id });
    if (play) {
      stage = "Getting the player ready…"; feedback();
      await call("play", { project: project.id });
      window.liveEditor?.close();
      stage = "Starting the game…"; feedback();
      const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(Error("The game didn't start within 90 seconds. Check the build log, then press Play again.")); }, 90000);
        function cleanup() { clearTimeout(timeout); window.removeEventListener("message", receive); }
        function receive(event) {
          if (event.source !== $("#game").contentWindow || event.origin !== location.origin) return;
          if (event.data?.type === "islandengine-player-ready") { cleanup(); resolve(); }
          if (event.data?.type === "islandengine-player-error") { cleanup(); reject(Error(event.data.message || "The game didn't start. Check the build log.")); }
        }
        window.addEventListener("message", receive);
      });
      closeCodeView();
      $("#game").src = "/player.html?build=" + Date.now();
      $("#playView").hidden = false;
      document.body.classList.add("playing");
      await ready;
      window.liveEditor?.open?.();
      status("Playing. Choose Inspect to select objects in the game.");
    } else status("Build finished.");
    return result;
  } catch (error) { $("#log").hidden = false; throw error; }
  finally {
    clearInterval(timer); await poll(); buildBusy = false;
    if (shown) { $("#buildProgress").hidden = true; $("#buildProgress").setAttribute("aria-busy", "false"); }
    for (const [node, wasDisabled] of disabled) node.disabled = wasDisabled;
    updateSaveState();
  }
}
async function doBuild() { return buildOperation(); }
function stopPlay() {
  window.liveEditor?.close();
  $("#game").src = "about:blank";
  $("#playView").hidden = true;
  document.body.classList.remove("playing", "previewing");
  if (project) inspect();
}
function closePreview() {
  $("#game").src = "about:blank";
  $("#playView").hidden = true;
  document.body.classList.remove("previewing");
}
$("#closePreview").onclick = closePreview;
$("#build").onclick = () => task(doBuild);
$("#play").onclick = () => task(() => buildOperation(true));
$("#applyPlay").onclick = () => $("#play").click();
$("#stopPlay").onclick = () => {
  stopPlay();
  status("Stopped. Your changes are kept.");
};
$("#export").onclick = () => task(() => buildOperation(false, true));
$("#buildLogOpen").onclick = () => { $("#log").hidden = false; };
$("#logToggle").onclick = () => ($("#log").hidden = !$("#log").hidden);
async function assets() {
  const r = await call("catalog", {
    query: $("#assetSearch").value,
    type: $("#assetType").value,
    offset: assetPage * 150,
  });
  $("#assetCount").textContent =
    r.total.toLocaleString() + " entries · page " + (assetPage + 1);
  $("#previousAssets").disabled = assetPage === 0;
  $("#moreAssets").disabled = (assetPage + 1) * 150 >= r.total;
  $("#assetList").replaceChildren();
  for (const asset of r.rows) {
    const n = el("div", null, "asset");
    n.append(el("strong", asset.name), el("small", asset.path));
    const buttons = el("div", null, "row"),
      preview = el("button", "Preview"),
      use = el("button", "Use");
    preview.onclick = () => {
      if (document.body.classList.contains("playing")) stopPlay();
      closeCodeView();
      $("#game").src =
        "/asset.html?path=" +
        encodeURIComponent(asset.path) +
        (asset.symbol != null ? "&symbol=" + asset.symbol : "");
      $("#playView").hidden = false;
      document.body.classList.add("previewing");
      $("#playMode").textContent = "Preview: " + asset.name;
    };
    use.onclick = () =>
      task(async () => {
        if (!selected) {
          await message("Choose where the art goes", project.mode === "existing"
            ? "Use puts art on objects in new AS3 islands. In a copied island, import the file and use it from code."
            : "Select an object or an item card first.");
          return;
        }
        const target = selected;
        if (asset.type === "font") {
          status(
            "Fonts can't be placed. Use them from text code, or import the lettering as an image.",
          );
          return;
        }
        if (
          ![
            "shape",
            "sprite",
            "image",
            "button",
            "morphshape",
            "text",
            "swf",
            "png",
            "jpg",
            "jpeg",
          ].includes(asset.type)
        ) {
          status("Choose an image or a piece of SWF art.");
          return;
        }
        status("Copying art…");
        const result = asset.path.endsWith(".swf")
          ? await call("useArt", {
              project: project.id,
              path: asset.path,
              symbol: asset.symbol,
            })
          : { asset: asset.path };
        snapshot();
        target.asset = result.asset;
        inspect();
        changed();
        if (document.body.classList.contains("previewing")) closePreview();
        status("Art added to " + (target.label || target.id) + ".");
      });
    buttons.append(preview, use);
    n.append(buttons);
    $("#assetList").append(n);
  }
}
$("#assetSearch").oninput = () => {
  clearTimeout(searchTimer);
  assetPage = 0;
  searchTimer = setTimeout(() => task(assets), 250);
};
$("#assetType").onchange = () => {
  assetPage = 0;
  task(assets);
};
$("#moreAssets").onclick = () => {
  assetPage++;
  task(assets);
};
$("#previousAssets").onclick = () => {
  assetPage = Math.max(0, assetPage - 1);
  task(assets);
};
$("#scanArt").onclick = () =>
  task(async () => {
    $("#scanArt").disabled = true;
    status("Finding art inside SWFs…");
    try {
      const result = await call("scanArt");
      assetPage = 0;
      await assets();
      status(
        result.symbols.toLocaleString() +
          " art symbols found" +
          (result.unreadable.length
            ? " · " + result.unreadable.length + " files could not be read"
            : ""),
      );
    } finally {
      $("#scanArt").disabled = false;
    }
  });
$("#importArt").onclick = () =>
  task(async () => {
    if (!project) return;
    const names = await call("importArt", { project: project.id });
    if (selected && names.length) {
      snapshot();
      selected.asset = names[0];
      inspect();
      changed();
    }
    status(names.length + " files imported");
  });
async function files() {
  if (!project) return;
  const list = await call("files", { project: project.id });
  $("#fileList").replaceChildren();
  const query = $("#fileSearch").value.trim().toLowerCase();
  const matches = list.filter((f) => /\.(as|xml|json|md|txt)$/.test(f) && f.toLowerCase().includes(query));
  for (const name of matches) {
    const slash = name.lastIndexOf("/");
    const n = el("button", name.slice(slash + 1), "file" + (name === file ? " active" : ""));
    n.dataset.file = name;
    n.title = name;
    if (slash > 0) n.append(el("small", name.slice(0, slash)));
    n.onclick = () => task(() => openCode(name));
    $("#fileList").append(n);
  }
  if (!matches.length) $("#fileList").append(el("p", query ? "No file paths match." : "No code files yet.", "muted"));
}
$("#fileSearch").oninput = () => task(files);
async function openCode(name) {
  // island.json and the room editor describe the same data. Save the editor
  // first so the file shows the latest rooms.
  if (dirty && name === "island.json") await save();
  if (codeUnsaved()) await saveCode();
  const text = await call("read", { project: project.id, file: name });
  file = name;
  codeSaved = text;
  $("#source").value = text;
  $("#fileName").textContent = name;
  $("#codeView").hidden = false;
  for (const n of document.querySelectorAll("#fileList .file")) n.classList.toggle("active", n.dataset.file === name);
  updateSaveState();
}
function closeCodeView() {
  $("#codeView").hidden = true;
  file = null;
  codeSaved = "";
  updateSaveState();
}
async function saveCode() {
  if (!file) return;
  if (file === "island.json" && dirty) {
    const answer = await choose(
      "Replace your room edits?",
      "You changed rooms in the editor since opening island.json. Saving this file replaces those changes.",
      [{ label: "Cancel", value: "cancel" }, { label: "Save file", value: "save", primary: true }],
    );
    if (answer !== "save") return;
  }
  const text = $("#source").value;
  await call("write", { project: project.id, file, text });
  codeSaved = text;
  if (file === "island.json") {
    const roomId = room?.id;
    project = await call("open", { id: project.id });
    room = project.scenes.find((r) => r.id === roomId) || project.scenes[0];
    selected = null;
    history = [];
    future = [];
    dirty = false;
    renderRooms();
    inspect();
    draw();
  }
  $("#fileName").textContent = file;
  updateSaveState();
  status("Saved " + file);
}
$("#source").addEventListener("input", () => {
  $("#fileName").textContent = file + (codeUnsaved() ? " •" : "");
  updateSaveState();
});
$("#saveCode").onclick = () => task(saveCode);
$("#closeCode").onclick = () =>
  task(async () => {
    if (codeUnsaved()) await saveCode();
    if (!codeUnsaved()) closeCodeView();
  });
$("#newCode").onclick = () =>
  task(async () => {
    const r = await form("New source file", [
      { id: "file", label: "File path", value: "src/extra/MyRule.as" },
    ]);
    if (r) {
      const name = r.file.split(/[\\/]/).pop().replace(/\.as$/, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !r.file.endsWith(".as"))
        throw Error("Use a class name followed by .as.");
      const names = await call("files", { project: project.id });
      if (names.includes(r.file.replaceAll("\\", "/")))
        throw Error("Open the existing file from the file list.");
      await call("write", {
        project: project.id,
        file: r.file,
        text: project.mode !== "existing" && r.file.replaceAll("\\", "/").startsWith("src/scenes/")
          ? `package custom {\n    import islandengine.IslandScene;\n\n    public class ${name} extends IslandScene {\n        public function ${name}(island:String, room:XML) {\n            super(island, room);\n        }\n\n        override protected function onReady():void {\n        }\n    }\n}\n`
          : `package custom {\n    public class ${name} {\n        public function ${name}() {\n        }\n    }\n}\n`,
      });
      await files();
      await openCode(r.file);
    }
  });
$("#engineClass").onclick = () =>
  task(async () => {
    if (project.version === "AS2") {
      const r = await form("Open AS2 code", [
        {
          id: "file",
          label: "SWF path in the game library",
          value: "gameplay.swf",
        },
      ]);
      if (!r) return;
      status("Opening AS2 code…");
      const sources = await call("decompileSwf", {
        project: project.id,
        file: r.file,
      });
      await files();
      if (sources.length)
        await openCode(
          sources.find((f) => f.endsWith("/scripts/frame_1/DoAction.as")) ||
            sources[0],
        );
      return;
    }
    const r = await form("Open engine source", [
      {
        id: "className",
        label: "Class name (or package.*)",
        value:
          project.mode === "existing"
            ? project.entry
            : "game.components.entity.character.CharacterMotionControl",
      },
    ]);
    if (r) {
      status("Opening engine code…");
      const result = await call("decompile", { project: project.id, ...r });
      await files();
      if (result.length) await openCode(result[0]);
      status(result.length + " code files opened");
    }
  });
let objectClipboard = null;
function pasteObject(value = objectClipboard) {
  if (!value || !room || project.mode === "existing") return;
  snapshot(); const copy = structuredClone(value);
  copy.id = unique(copy.kind); copy.x += 30; copy.y += 30;
  room.objects.push(copy); selected = copy; inspect(); changed();
}
// Number keys pick tools in toolbar order.
const toolKeys = ["select", "art", "platform", "npc", "item", "door", "switch", "trigger"];
const typing = (target) =>
  target.isContentEditable ||
  target.closest?.("input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],[role=textbox]");
function cancelCanvasDrag() {
  if (drag.pan) pan = drag.start;
  else if (selected) {
    Object.assign(selected, drag.start);
    if (drag.moved) {
      history.pop();
      future = drag.previousFuture;
      dirty = drag.wasDirty;
      updateSaveState();
    }
  }
  drag = null;
}
document.addEventListener("keydown", (e) => {
  const command = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (command && key === "s") {
    e.preventDefault();
    if (!buildBusy) task(saveCurrent);
    return;
  }
  if ($("#modal").open) return;
  if (key === "escape" && document.body.classList.contains("previewing")) {
    closePreview();
    return;
  }
  // These work everywhere, including Play, but never while typing.
  if (!typing(e.target)) {
    if (e.key === "F5" && project) {
      e.preventDefault();
      if (e.shiftKey) $("#stopPlay").click();
      else $("#play").click();
      return;
    }
    if (e.key === "?" || e.key === "F1") {
      e.preventDefault();
      showShortcuts();
      return;
    }
  }
  if (window.liveEditor?.active || !$("#playView").hidden || !$("#codeView").hidden) return;
  if (typing(e.target) || !project || project.mode === "existing") return;

  if (command && (key === "z" || key === "y")) {
    e.preventDefault();
    const redo = key === "y" || e.shiftKey;
    restore(redo ? future : history, redo ? history : future);
    return;
  }
  if (key === "escape") {
    if (drag) cancelCanvasDrag();
    else if ($("#tool").dataset.active !== "select") chooseTool("select");
    else selected = null;
    inspect();
    draw();
    return;
  }
  if (!command && !e.altKey && /^[1-8]$/.test(e.key)) {
    chooseTool(toolKeys[Number(e.key) - 1]);
    return;
  }
  if (e.key === "Home") {
    e.preventDefault();
    fit();
    return;
  }
  if (key === "f" && !command) {
    frameSelected();
    return;
  }
  const editable = selected && room?.objects.includes(selected);
  if (command && ["c", "x", "d", "v"].includes(key)) {
    e.preventDefault();
    if (key === "v") pasteObject();
    else if (editable && key === "d") pasteObject(selected);
    else if (editable) {
      objectClipboard = structuredClone(selected);
      if (key === "x") removeSelected();
      else status("Copied. Ctrl+V pastes.");
    }
    return;
  }
  if (!editable) return;
  if (e.shiftKey && key === "d") {
    e.preventDefault();
    pasteObject(selected);
    return;
  }
  if (key === "delete" || key === "backspace" || (key === "x" && !command)) {
    e.preventDefault();
    removeSelected();
    return;
  }
  const movement = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
  if (movement) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    snapshot();
    selected.x += movement[0] * step;
    selected.y += movement[1] * step;
    inspect();
    changed();
  }
});
$("#source").onkeydown = (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const t = e.target,
      start = t.selectionStart;
    t.setRangeText("    ", start, t.selectionEnd, "end");
  }
};
task(async () => {
  const s = await call("status");
  showLibrary(s);
  let last = null;
  try { last = localStorage.getItem("islandengine-last-project"); } catch { /* No saved preference. */ }
  const reopen = s.projects.find((p) => p.id === last) || (s.projects.length === 1 ? s.projects[0] : null);
  if (reopen) await open(reopen.id);
  else updateWorkspace();
  if (!s.library) status("Choose your game folder to get started.");
  else if (!project && s.projects.length) status("Open an island, or make a new one.");
});
const toolNames = {
  art: "scenery",
  platform: "a platform",
  wall: "a wall",
  climb: "a climbing area",
  water: "water",
  hazard: "a hazard",
  bounce: "a bounce pad",
  movingPlatform: "a moving platform",
  npc: "a character",
  item: "an item",
  door: "a door",
  switch: "a switch",
  trigger: "a trigger area",
  custom: "a custom object",
};
function chooseTool(kind) {
  const tool = $("#tool");
  tool.dataset.active = kind;
  // The More menu shows the active tool when it is one of its entries.
  tool.value = [...tool.options].some((o) => o.value === kind) ? kind : "";
  tool.classList.toggle("active", !!tool.value);
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === kind);
    b.setAttribute("aria-pressed", String(b.dataset.tool === kind));
  });
  $("#toolHelp").textContent =
    kind === "select"
      ? ""
      : "Click in the room to place " + (toolNames[kind] || "the object") + ". Esc cancels.";
  canvas.style.cursor = kind === "select" ? "default" : "crosshair";
  updateKeyHints();
}
document.querySelectorAll("[data-tool]").forEach((b, index) => {
  b.onclick = () => chooseTool(b.dataset.tool);
  b.title = b.textContent + " (" + (index + 1) + ")";
});
$("#tool").onchange = () => chooseTool($("#tool").value || "select");
function updateWorkspace() {
  for (const id of ["play", "export", "addRoom", "copyProject", "newCode", "engineClass", "importArt", "projectCode"])
    $("#" + id).disabled = !project;
  if (project) {
    $("#addRoom").disabled = project.mode === "existing" && project.version !== "AS2";
    $("#addRoom").hidden = $("#addRoom").disabled;
    $("#newCode").disabled = project.version === "AS2";
    $("#newCode").title = project.version === "AS2" ? "Open a room or SWF to edit its scripts." : "";
  }
  const visual = !!project && project.mode !== "existing";
  $("#projectInfo").hidden = !project;
  $("#projectVersion").textContent = !project
    ? ""
    : (project.version || "AS3") + (project.mode === "existing" ? " copy" : "");
  $("#projectVersion").title = !project
    ? ""
    : project.mode === "existing"
      ? "A copy of an original " + (project.version || "AS3") + " island. Change it through its files and in Play."
      : "A new AS3 island built with the room editor.";
  $("#empty").hidden = !!project;
  document.body.classList.toggle("noProject", !project);
  renderItems();
  $("#runtimeCode").disabled = !project || project.mode === "existing";
  $("#runtimeCode").hidden = !!project && project.mode === "existing";
  $("#roomToolbar").hidden = !visual;
  $("#toolHelp").hidden = !visual;
  $("#objectSection").hidden = !visual;
  document.body.classList.toggle("existingProject", !!project && !visual);
  updateSaveState();
  chooseTool("select");
}
function renderObjects() {
  const list = $("#objectList");
  list.replaceChildren();
  if (!room || project.mode === "existing") return;
  for (const o of room.objects) {
    const b = el(
      "button",
      o.label || o.id,
      "objectRow" + (o === selected ? " active" : ""),
    );
    b.append(el("small", kindTitles[o.kind] || o.kind));
    b.onclick = () => {
      selected = o;
      inspect();
      draw();
    };
    list.append(b);
  }
  if (!room.objects.length) list.append(el("p", "Nothing here yet. Pick an object above the room, then click in the room.", "muted"));
}
function renderExistingRooms(rows) {
  const box = $("#existingHelp");
  const as2 = project.version === "AS2";
  const steps = el("ol", null, "steps");
  for (const text of [
    "Press Play to try it. In Play, Inspect lets you move, hide, or restyle objects.",
    as2
      ? "Click a room to open its scripts. Save, then press Play."
      : "Click a room to open its scene XML. Dialogue, items, and engine classes are under Code.",
    as2
      ? "Use + Copy a room to add a room, then edit its scripts to connect the exits."
      : "The room editor and Items tab are for new AS3 islands. Change this copy through Code and Inspect.",
  ])
    steps.append(el("li", text));
  box.replaceChildren(
    el("h2", project.title),
    el("p", "A copy of an original " + (project.version || "AS3") + " island. It keeps the original artwork and scripts.", "muted"),
    steps,
  );
  box.append(el("label", "Starting room"));
  const start = el("select");
  start.id = "startingRoom";
  for (const r of project.version === "AS2" ? rows : []) {
    const option = el("option", r.title);
    option.value =
      project.version === "AS2"
        ? r.file
            .split("/")
            .pop()
            .replace(/^scene|\.swf$/g, "")
        : r.id;
    start.append(option);
  }
  // Room folder names may differ from the starting class, so keep the current entry too.
  if (![...start.options].some((o) => o.value === project.entry)) {
    const current = el("option", project.entry);
    current.value = project.entry;
    start.prepend(current);
  }
  start.value = project.entry;
  start.onchange = () => {
    snapshot();
    project.entry = start.value;
    changed();
    inspect();
  };
  if (project.version !== "AS2") {
    const input = el("input");
    input.value = project.entry;
    input.setAttribute("aria-label", "Starting scene class");
    input.onchange = () => {
      snapshot();
      project.entry = input.value;
      changed();
      inspect();
    };
    box.append(input);
  } else box.append(start);
  box.append(el("p", as2 ? "Play opens this room first." : "Play opens this scene class first.", "muted"));
}
const actionFields = {
  say: ["Say", ["text", "Dialogue"], ["speaker", "Speaker"]],
  flag: ["Set flag", ["id", "Flag"], ["value", "Value (true or false)"]],
  give: ["Give item", ["id", "Item ID"], ["label", "Item name"]],
  take: ["Remove item", ["id", "Item ID"]],
  travel: [
    "Go to room",
    ["room", "Room ID"],
    ["x", "Arrival X"],
    ["y", "Arrival Y"],
  ],
  sound: ["Play sound", ["asset", "Sound file"]],
  wait: ["Wait", ["seconds", "Seconds"]],
  complete: ["Finish island", ["text", "Message"]],
  checkpoint: ["Set checkpoint"],
  camera: ["Follow character", ["id", "Character"]],
  move: ["Move character", ["id", "Character"], ["x", "X"], ["y", "Y"]],
  custom: ["Run custom action", ["id", "Action name"]],
};
function renderActions(box) {
  const section = el("details", null, "inspectorSection objectActions");
  section.open = true;
  section.append(
    el("summary", selected.kind === "inventory" ? "When used" : "Actions"),
  );
  if (!selected.actions?.length) section.append(el("p", "No actions yet. Actions run in order, top to bottom.", "muted"));
  (selected.actions || []).forEach((action, index) => {
    const row = el("div", null, "actionRow");
    const spec = actionFields[action.type];
    row.append(el("strong", index + 1 + ". " + (spec?.[0] || action.type)));
    if (spec)
      for (const [key, name] of spec.slice(1)) {
        const update = (value) => {
          action[key] = value;
          const raw = $('#inspector [aria-label="Actions as JSON"]');
          if (raw) raw.value = JSON.stringify(selected.actions, null, 2);
        };
        if (key === "room") {
          selectField(row, "Destination room", action.room || "", [{ value: "", label: "Choose a room" }, ...project.scenes.map((s) => ({ value: s.id, label: s.title || s.id }))], (value) => {
            update(value);
            const destination = project.scenes.find((s) => s.id === value);
            if (destination) { action.x = destination.spawn.x; action.y = destination.spawn.y; }
            inspect();
          });
          continue;
        }
        if (key === "speaker" || (key === "id" && ["camera", "move"].includes(action.type))) {
          selectField(row, name, action[key] || "player", [{ value: "player", label: "Player" }, ...(room?.objects || []).filter((o) => o.kind === "npc").map((o) => ({ value: o.id, label: o.label || o.id }))], update);
          continue;
        }
        if (action.type === "flag" && key === "value") {
          selectField(row, "Flag value", String(action.value ?? true), [{ value: "true", label: "Set" }, { value: "false", label: "Clear" }], (v) => update(v === "true"));
          continue;
        }
        if (key === "id" && ["give", "take"].includes(action.type)) {
          selectField(
            row,
            "Item",
            action.id || "",
            [{ value: "", label: "Choose an item" }, ...itemChoices()],
            (value) => {
              action.id = value;
              const raw = $('#inspector [aria-label="Actions as JSON"]');
              if (raw) raw.value = JSON.stringify(selected.actions, null, 2);
            },
          );
          continue;
        }
        field(
          row,
          name,
          action[key],
          (value) => {
            action[key] = ["x", "y", "seconds"].includes(key)
              ? Number(value)
              : value;
            const raw = $('#inspector [aria-label="Actions as JSON"]');
            if (raw) raw.value = JSON.stringify(selected.actions, null, 2);
          },
          key === "text" ? "textarea" : ["x", "y", "seconds"].includes(key) ? "number" : "text",
        );
      }
    else row.append(el("p", "Edit this action under Action code (JSON).", "muted"));
    const conditions = el("details");
    conditions.append(el("summary", "Action conditions"));
    for (const [key, label] of [["requires", "Only after flag"], ["unless", "Unless flag"], ["requiresItem", "Only with item"]]) {
      const update = (value) => {
        action[key] = value;
        const raw = $('#inspector [aria-label="Actions as JSON"]');
        if (raw) raw.value = JSON.stringify(selected.actions, null, 2);
      };
      if (key === "requiresItem") selectField(conditions, label, action[key] || "", [{ value: "", label: "None" }, ...itemChoices()], update);
      else field(conditions, label, action[key] || "", update);
    }
    row.append(conditions);
    const remove = el("button", "Remove action");
    remove.onclick = () => {
      snapshot();
      selected.actions.splice(index, 1);
      changed();
      inspect();
    };
    const up = el("button", "Move up");
    up.disabled = index === 0;
    up.onclick = () => {
      snapshot();
      const actions = selected.actions;
      [actions[index - 1], actions[index]] = [
        actions[index],
        actions[index - 1],
      ];
      changed();
      inspect();
    };
    row.append(up, remove);
    section.append(row);
  });
  const controls = el("div", null, "row"),
    choice = el("select");
  choice.setAttribute("aria-label", "Action type");
  for (const [type, spec] of Object.entries(actionFields)) {
    const o = el("option", spec[0]);
    o.value = type;
    choice.append(o);
  }
  const add = el("button", "Add action");
  add.onclick = () => {
    snapshot();
    (selected.actions ||= []).push({ type: choice.value });
    changed();
    inspect();
  };
  controls.append(choice, add);
  section.append(controls);
  box.append(section);
}

function selectField(parent, title, value, options, change) {
  const label = el("label", title),
    select = el("select");
  select.setAttribute("aria-label", title);
  if (value && !options.some((o) => String(o.value) === String(value))) options = [{ value, label: value + " (custom)" }, ...options];
  for (const option of options) {
    const node = el("option", option.label);
    node.value = option.value;
    select.append(node);
  }
  select.value = value;
  select.onchange = () => {
    snapshot();
    change(select.value);
    changed();
  };
  parent.append(label, select);
  return select;
}

function itemChoices() {
  const items = new Map();
  for (const scene of project?.scenes || [])
    for (const object of scene.objects) {
      if (object.kind === "item")
        items.set(object.itemId || object.id, object.label || object.id);
      for (const action of object.actions || [])
        if (action.type === "give")
          items.set(action.id, action.label || action.id);
    }
  for (const item of project?.items || [])
    items.set(item.id, item.label || item.id);
  return [...items]
    .filter(([id]) => id)
    .map(([value, label]) => ({ value, label }));
}
function renderItems() {
  const list = $("#itemList");
  list.replaceChildren();
  $("#newItem").disabled = !project || project.mode === "existing";
  if (project?.mode === "existing") {
    list.append(
      el(
        "p",
        "Copied islands keep their original inventory. Edit it under Code.",
        "muted",
      ),
    );
    return;
  }
  for (const item of itemChoices()) {
    const button = el("button", item.label, "room");
    button.append(el("small", item.value));
    button.onclick = () => {
      let definition = project.items?.find((i) => i.id === item.value);
      if (!definition) {
        const pickup = project.scenes
          .flatMap((s) => s.objects)
          .find((o) => o.kind === "item" && (o.itemId || o.id) === item.value);
        snapshot();
        definition = {
          id: item.value,
          kind: "inventory",
          label: item.label,
          asset: pickup?.asset || "",
          actions: [],
        };
        (project.items ||= []).push(definition);
        changed();
      }
      definition.kind = "inventory";
      selected = definition;
      inspect();
      draw();
    };
    list.append(button);
  }
}
$("#newItem").onclick = () =>
  task(async () => {
    if (!project || project.mode === "existing") return;
    const answer = await form("New item", [
      { id: "label", label: "Item name", value: "" },
    ]);
    if (!answer) return;
    if (!answer.label.trim()) throw Error("Give the item a name.");
    const stem = answer.label.replace(/[^A-Za-z0-9_]/g, "") || "item";
    const prefix = /^[A-Za-z]/.test(stem) ? stem : "item" + stem;
    const ids = new Set(itemChoices().map((i) => i.value));
    let id = prefix,
      n = 2;
    while (ids.has(id)) id = prefix + n++;
    snapshot();
    selected = {
      id,
      kind: "inventory",
      label: answer.label.trim(),
      asset: "",
      description: "",
      actions: [],
    };
    (project.items ||= []).push(selected);
    changed();
    renderItems();
    inspect();
  });
function inspectItem(box) {
  const item = selected;
  box.append(el("h3", "Inventory item"), el("p", "ID: " + item.id, "muted"));
  field(box, "Item name", item.label, (value) => {
    item.label = value;
    renderItems();
  });
  field(
    box,
    "Description",
    item.description || "",
    (value) => (item.description = value),
    "textarea",
  );
  field(box, "Card art", item.asset || "", (value) => (item.asset = value));
  const art = el("button", "Choose art", "wide");
  art.onclick = () => switchTab("assets");
  box.append(art);
  const combine = el("button", "Combine with another item", "wide");
  combine.onclick = () => task(async () => {
    const choices = itemChoices().filter((i) => i.value !== item.id);
    if (choices.length < 2) throw Error("Create the other ingredient and the result in Items first.");
    const answer = await form("Item combination", [
      { id: "ingredient", label: "Other ingredient", options: choices },
      { id: "result", label: "Result item", options: choices, value: choices[1].value },
      { id: "reply", label: "Reply if missing", value: "I need the other part first." },
    ]);
    if (!answer) return;
    if (answer.ingredient === answer.result) throw Error("Choose a result different from the ingredients.");
    if (item.actions?.length) throw Error("This item already has use actions. Edit or remove them before setting a combination.");
    snapshot();
    item.requiresItem = answer.ingredient;
    item.lockedText = answer.reply;
    item.actions = [{ type: "take", id: item.id }, { type: "take", id: answer.ingredient }, { type: "give", id: answer.result }];
    changed();
    inspect();
    status("Combination set. Press USE on this card in the game to combine.");
  });
  box.append(combine);
  const place = el("button", "Place in " + (room?.title || "room"), "wide");
  place.disabled = !room;
  place.onclick = () => {
    snapshot();
    const pickup = {
      id: unique("item"),
      itemId: item.id,
      kind: "item",
      label: item.label,
      asset: item.asset,
      x: room.spawn.x + 100,
      y: room.spawn.y,
      width: 60,
      height: 60,
    };
    room.objects.push(pickup);
    selected = pickup;
    switchTab("rooms");
    changed();
    inspect();
  };
  box.append(place);
  box.append(
    el(
      "p",
      "To hand this item over in a conversation, add a Give item action to the character.",
      "muted",
    ),
  );
  selectField(
    box,
    "Required item to use",
    item.requiresItem || "",
    [
      { value: "", label: "None" },
      ...itemChoices().filter((i) => i.value !== item.id),
    ],
    (value) => (item.requiresItem = value),
  );
  field(
    box,
    "Reply if missing",
    item.lockedText || "",
    (value) => (item.lockedText = value),
  );
  renderActions(box);
  const raw = section(box, "Advanced", false);
  field(
    raw,
    "Actions as JSON",
    JSON.stringify(item.actions || [], null, 2),
    (value) => {
      try {
        const actions = JSON.parse(value);
        if (!Array.isArray(actions)) throw Error();
        item.actions = actions;
        inspect();
      } catch {
        status("Actions must be a JSON array");
      }
    },
    "textarea",
  );
  box.append(raw);
}

$("#projectCode").onclick = () =>
  task(async () => {
    if (project) await openCode("island.json");
  });
$("#copyProject").onclick = () => task(async () => {
  if (!project) throw Error("Open an island first.");
  const answer = await form("Copy this project", [{ id: "title", label: "Copy name", value: project.title + " copy" }]);
  if (!answer) return;
  if (!answer.title.trim()) throw Error("Give the copy a name.");
  if (!$("#codeView").hidden) await saveCode();
  await save();
  const stem = answer.title.replace(/[^A-Za-z0-9_]/g, "") || "island";
  const prefix = /^[A-Za-z]/.test(stem) ? stem : "island" + stem;
  const used = new Set((await call("status")).projects.map((p) => p.id.toLowerCase()));
  let id = prefix, suffix = 2;
  while (used.has(id.toLowerCase())) id = prefix + suffix++;
  await call("copyProject", { project: project.id, id, title: answer.title });
  await open(id);
  status("Project copied. Check custom code for hard-coded island IDs.");
});
$("#runtimeCode").onclick = () =>
  task(async () => {
    if (!project) return;
    const source = await call("runtimeSource", { project: project.id });
    await files();
    await openCode(source);
  });
