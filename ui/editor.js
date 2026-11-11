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
    const explanation = compiler ? "ActionScript compile error: " + compiler[1] + ". Your source is saved. Check Build log, fix the code, and build again." : e.message;
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
async function form(title, fields) {
  $("#modalTitle").textContent = title;
  const body = $("#modalBody");
  body.replaceChildren();
  for (const f of fields) {
    body.append(el("label", f.label));
    const input = document.createElement(
      f.options ? "select" : f.multiline ? "textarea" : "input",
    );
    input.name = f.id;
    input.value = f.value || "";
    if (f.options)
      for (const o of f.options) {
        const opt = el("option", o.label || o);
        opt.value = o.value || o;
        input.append(opt);
      }
    if (f.options && f.value != null) input.value = f.value;
    body.append(input);
  }
  $("#modalOK").textContent =
    {
      "New island": "Create island",
      "Add room": "Add room",
      "Open island": "Open",
      "Copy an island": "Continue",
      "Copy a room": "Copy room",
    }[title] || "OK";
  const d = $("#modal");
  d.showModal();
  return new Promise((resolve) => {
    d.onclose = () =>
      resolve(
        d.returnValue === "ok"
          ? Object.fromEntries(
              [...body.querySelectorAll("input,select,textarea")].map((n) => [
                n.name,
                n.value,
              ]),
            )
          : null,
      );
  });
}
async function message(title, text) {
  $("#modalTitle").textContent = title;
  $("#modalBody").replaceChildren(el("p", text));
  $("#modalOK").textContent = "OK";
  $("#modal").showModal();
  return new Promise((r) => ($("#modal").onclose = r));
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
  draw();
}
function updateSaveState() {
  if (project) $("#projectName").textContent = project.title + (dirty || window.liveEditor?.hasUnsaved ? " • Unsaved" : "");
}
window.addEventListener("islandengine-live-change", updateSaveState);
async function saveCurrent() {
  if (!$("#codeView").hidden && file) await saveCode();
  await save();
}
window.saveCurrent = saveCurrent;
async function save() {
  if (!project) return;
  await call("save", { project });
  await window.liveEditor?.save();
  dirty = false;
  $("#projectName").textContent = project.title;
  status("Saved");
}
async function open(id) {
  await window.liveEditor?.save();
  $("#stopPlay").click();
  if (!$("#codeView").hidden && file) await saveCode();
  $("#codeView").hidden = true;
  file = null;
  if (dirty) await save();
  project = await call("open", { id });
  room =
    project.scenes.find((r) => r.id === project.start) || project.scenes[0];
  selected = null;
  history = [];
  future = [];
  dirty = false;
  $("#projectName").textContent = project.title;
  $("#empty").hidden = !!project;
  $("#existingHelp").hidden = project.mode !== "existing";
  $("#addRoom").textContent =
    project.version === "AS2" ? "Copy room" : "+ Add room";
  $("#addRoom").disabled =
    project.mode === "existing" && project.version !== "AS2";
  $("#newCode").disabled = project.version === "AS2";
  $("#newCode").title =
    project.version === "AS2" ? "Open a room or SWF to edit its scripts." : "";
  $("#engineClass").textContent =
    project.version === "AS2" ? "Open AS2 SWF" : "Open engine class";
  $("#existingHelp").textContent =
    project.mode === "existing"
      ? (project.version || "AS3") +
        ": choose a room on the left to edit its files."
      : "";
  updateWorkspace();
  await renderRooms();
  inspect();
  fit();
  await files();
  if (project.mode === "existing") {
    status("Choose a room to edit its files, or press Play.");
    switchTab("rooms");
  }
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
    renderExistingRooms(rows);
    $("#roomTitle").textContent = project.title;
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
        if (!$("#codeView").hidden && file) await saveCode();
        room = project.scenes.find((scene) => scene.id === r.id);
        selected = null;
        $("#codeView").hidden = true;
        renderRooms();
        inspect();
        fit();
      });
    list.append(b);
  }
  $("#roomTitle").textContent = room?.title || project?.title || "Scene";
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
  input.onchange = () => {
    snapshot();
    onchange(type === "number" ? Number(input.value) : input.value);
    changed();
  };
  parent.append(label, input);
  return input;
}
function inspect() {
  const box = $("#inspector");
  box.replaceChildren();
  renderObjects();
  if (!project) return;
  if (selected?.kind === "inventory") {
    inspectItem(box);
    return;
  }
  if (!selected) {
    box.append(el("h3", room ? "Room" : "Island"));
    field(box, "Title", project.title, (v) => {
      project.title = v;
      renderRooms();
    });
    if (!room) {
      if (project.mode === "existing")
        field(box, "Starting scene", project.entry, (v) => (project.entry = v));
      return;
    }
    field(box, "Room title", room.title, (v) => {
      room.title = v;
      renderRooms();
    });
    field(box, "Width", room.width, (v) => (room.width = v), "number");
    field(box, "Height", room.height, (v) => (room.height = v), "number");
    const codeSettings = el("details");
    codeSettings.append(el("summary", "Room code"));
    field(
      codeSettings,
      "ActionScript class",
      room.script || "",
      (v) => (room.script = v),
    );
    box.append(codeSettings);
    field(
      box,
      "Background",
      room.background,
      (v) => (room.background = v),
      "color",
    );
    field(box, "Spawn X", room.spawn.x, (v) => (room.spawn.x = v), "number");
    field(box, "Spawn Y", room.spawn.y, (v) => (room.spawn.y = v), "number");
    field(box, "Music", room.music || "", (v) => (room.music = v));
    const b = el("button", "Use as starting room", "wide");
    b.onclick = () => {
      snapshot();
      project.start = room.id;
      changed();
      renderRooms();
      inspect();
      status("Starting room: " + room.id);
    };
    b.disabled = project.start === room.id;
    if (b.disabled) b.textContent = "Starting room";
    box.append(b);
    return;
  }
  box.append(
    el(
      "h3",
      {
        npc: "Character",
        movingPlatform: "Moving platform",
        art: "Art",
        switch: "Switch",
        trigger: "Trigger",
        platform: "Platform",
        wall: "Wall",
        climb: "Climb",
        water: "Water",
        hazard: "Hazard",
        bounce: "Bounce pad",
        item: "Item",
        door: "Door",
        custom: "Custom object",
      }[selected.kind] || selected.kind,
    ),
  );
  for (const k of ["id", "x", "y", "width", "height"])
    field(
      box,
      { id: "Object ID", x: "X", y: "Y", width: "Width", height: "Height" }[k],
      selected[k],
      (v) => (selected[k] = v),
      k === "id" ? "text" : "number",
    );
  field(
    box,
    "color",
    selected.color || colors[selected.kind],
    (v) => (selected.color = v),
    "color",
  );
  field(box, "Name", selected.label || "", (v) => (selected.label = v));
  selectField(box, "Visible artwork", String(!selected.hidden), [
    { value: "true", label: "Visible" }, { value: "false", label: "Invisible (collision stays active)" },
  ], (v) => (selected.hidden = v === "false"));
  field(box, "Show after flag", selected.showWhen || "", (v) => (selected.showWhen = v));
  field(box, "Hide after flag", selected.hideWhen || "", (v) => (selected.hideWhen = v));
  if (selected.kind === "bounce") field(box, "Bounce strength", selected.strength ?? 750, (v) => (selected.strength = v), "number");
  if (selected.kind === "item")
    selectField(
      box,
      "Inventory item",
      selected.itemId || selected.id,
      itemChoices(),
      (value) => (selected.itemId = value),
    );
  field(box, "Art file", selected.asset || "", (v) => (selected.asset = v));
  const browse = el("button", "Choose art", "wide");
  browse.onclick = () => switchTab("assets");
  box.append(browse);
  if (["npc", "item", "door", "switch", "trigger"].includes(selected.kind)) {
    field(
      box,
      "Dialogue",
      selected.text || "",
      (v) => (selected.text = v),
      "textarea",
    );
    field(
      box,
      "Required flag",
      selected.requires || "",
      (v) => (selected.requires = v),
    );
    field(box, "Disable after flag", selected.unless || "", (v) => (selected.unless = v));
    selectField(
      box,
      "Required item",
      selected.requiresItem || "",
      [{ value: "", label: "None" }, ...itemChoices()],
      (v) => (selected.requiresItem = v),
    );
    field(
      box,
      "Reply when locked",
      selected.lockedText || "",
      (v) => (selected.lockedText = v),
    );
  }
  if (selected.kind === "door") {
    selectField(
      box,
      "Exit to room",
      selected.target,
      project.scenes.map((r) => ({ value: r.id, label: r.title || r.id })),
      (value) => {
        selected.target = value;
        const destination = project.scenes.find((s) => s.id === value);
        selected.targetX = destination.spawn.x;
        selected.targetY = destination.spawn.y;
        inspect();
      },
    );
    field(
      box,
      "Arrival X",
      selected.targetX ?? 160,
      (v) => (selected.targetX = v),
      "number",
    );
    field(
      box,
      "Arrival Y",
      selected.targetY ?? 650,
      (v) => (selected.targetY = v),
      "number",
    );
  }
  if (selected.kind === "movingPlatform")
    for (const k of ["travelX", "travelY", "speed"])
      field(
        box,
        k,
        selected[k] ?? (k === "speed" ? 1 : 200),
        (v) => (selected[k] = v),
        "number",
      );
  if (selected.kind === "npc")
    for (const k of [
      "gender",
      "skinColor",
      "hairColor",
      "hair",
      "shirt",
      "pants",
    ])
      field(box, k, selected[k] || "", (v) => (selected[k] = v));
  if (
    ["npc", "item", "door", "switch", "trigger", "custom"].includes(
      selected.kind,
    )
  )
    renderActions(box);
  const raw = el("details");
  raw.append(el("summary", "Action code (JSON)"));
  field(
    raw,
    "Actions (JSON)",
    JSON.stringify(selected.actions || [], null, 2),
    (v) => {
      try {
        const actions = JSON.parse(v);
        if (!Array.isArray(actions)) throw Error("Actions must be a list");
        selected.actions = actions;
        inspect();
        status("Actions updated");
      } catch {
        status("Actions must be a JSON array");
      }
    },
    "textarea",
  );
  box.append(raw);
  const advanced = el("button", "All properties", "wide");
  advanced.onclick = () =>
    task(async () => {
      const result = await form("Object properties", [
        {
          id: "json",
          label: "JSON",
          value: JSON.stringify(selected, null, 2),
          multiline: true,
        },
      ]);
      if (result) {
        const next = JSON.parse(result.json);
        if (!next || typeof next !== "object" || Array.isArray(next))
          throw Error(
            "Keep the object’s id, kind, position, and size in the JSON.",
          );
        const draft = structuredClone(project);
        draft.scenes.find((r) => r.id === room.id).objects[
          room.objects.indexOf(selected)
        ] = next;
        const errors = await call("validate", { project: draft });
        if (errors.length) throw Error(errors.join("\n"));
        snapshot();
        room.objects[room.objects.indexOf(selected)] = next;
        selected = next;
        inspect();
        changed();
      }
    });
  box.append(advanced);
  const duplicate = el("button", "Duplicate", "wide");
  duplicate.onclick = () => {
    snapshot();
    const o = structuredClone(selected);
    o.id = unique(o.kind);
    o.x += 30;
    o.y += 30;
    room.objects.push(o);
    selected = o;
    inspect();
    changed();
  };
  const remove = el("button", "Delete object", "wide");
  remove.onclick = removeSelected;
  box.append(duplicate, remove);
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
  const tool = $("#tool").value;
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
  const id = room?.id;
  project = JSON.parse(from.pop());
  room = project.scenes.find((s) => s.id === id) || project.scenes[0];
  selected = null;
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
      await message(
        "No saved islands",
        "Choose New island to make one, or Copy island to edit an original.",
      );
      return;
    }
    const r = await form("Open island", [
      {
        id: "id",
        label: "Project",
        options: s.projects.map((p) => ({ value: p.id, label: p.title })),
      },
    ]);
    if (r) await open(r.id);
  });
$("#newProject").onclick = () =>
  task(async () => {
    const r = await form("New island", [
      { id: "title", label: "Island name", value: "" },
      {
        id: "version",
        label: "Game version",
        options: [
          { value: "AS3", label: "AS3 — newer islands" },
          { value: "AS2", label: "AS2 — classic islands" },
        ],
      },
    ]);
    if (r) {
      const title = r.title.trim();
      if (!title) throw Error("Give your island a name.");
      const base = title.replace(/[^A-Za-z0-9_]/g, "") || "island";
      const prefix = /^[A-Za-z]/.test(base) ? base : "island" + base;
      const used = new Set(
        (await call("status")).projects.map((p) => p.id.toLowerCase()),
      );
      let id = prefix,
        suffix = 2;
      while (used.has(id.toLowerCase())) id = prefix + suffix++;
      if (r.version === "AS2") {
        const islands = await call("islands", { version: "AS2" });
        if (!islands.length)
          throw Error("No AS2 island files were found in the library.");
        const starter = await form("AS2 starting island", [
          { id: "island", label: "Start from a copy of", options: islands },
        ]);
        if (!starter) return;
        await call("importIsland", {
          id,
          title,
          version: "AS2",
          island: starter.island,
        });
      } else await call("create", { id, title });
      await open(id);
      switchTab("rooms");
      status(
        project.mode === "existing"
          ? "Choose a room to edit, or press Play."
          : "Add art or a platform, then press Play.",
      );
    }
  });
$("#startIsland").onclick = () => $("#newProject").click();
$("#openIsland").onclick = () => $("#projects").click();
$("#addRoom").onclick = () =>
  task(async () => {
    if (!project) return;
    if (project.version === "AS2") {
      const rooms = await call("rooms", { project: project.id });
      const r = await form("Copy a room", [
        {
          id: "file",
          label: "Copy from",
          options: rooms.map((r) => ({ value: r.file, label: r.title })),
        },
        { id: "name", label: "New room name", value: "NewRoom" },
      ]);
      if (!r) return;
      await call("copyRoom", { project: project.id, ...r });
      await renderRooms();
      status("Open the copied room’s code, or set it as the starting scene.");
      return;
    }
    if (project.mode === "existing") return;
    const r = await form("Add room", [
      {
        id: "id",
        label: "Room ID",
        value: "room" + (project.scenes.length + 1),
      },
      { id: "title", label: "Name", value: "New room" },
    ]);
    if (r) {
      if (
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(r.id) ||
        project.scenes.some((s) => s.id === r.id)
      )
        throw Error(
          "Choose an unused room ID. Start with a letter and use only letters, numbers, or underscores.",
        );
      snapshot();
      room = {
        ...r,
        width: 1600,
        height: 900,
        background: "#b0d9df",
        spawn: { x: 160, y: 650 },
        objects: [
          {
            id: "ground",
            kind: "platform",
            x: 0,
            y: 760,
            width: 1600,
            height: 140,
            color: "#655b44",
          },
        ],
      };
      project.scenes.push(room);
      selected = null;
      renderRooms();
      inspect();
      fit();
      changed();
    }
  });
$("#importIsland").onclick = () =>
  task(async () => {
    const choice = await form("Copy an island", [
      {
        id: "version",
        label: "Game version",
        options: [
          { value: "AS3", label: "AS3 — newer islands" },
          { value: "AS2", label: "AS2 — classic islands" },
        ],
      },
    ]);
    if (!choice) return;
    const islands = await call("islands", choice);
    if (!islands.length)
      throw Error(
        "No " + choice.version + " island files were found in the library.",
      );
    const r = await form("Copy an island", [
      { id: "island", label: "Island", options: islands },
      { id: "title", label: "Name for your copy (optional)", value: "" },
    ]);
    if (r) {
      const title =
        r.title.trim() ||
        "Copy of " + islands.find((i) => i.value === r.island).label;
      const prefix = "copy" + r.island,
        used = new Set(
          (await call("status")).projects.map((p) => p.id.toLowerCase()),
        );
      let id = prefix,
        n = 2;
      while (used.has(id.toLowerCase())) id = prefix + n++;
      status("Copying island…");
      await call("importIsland", { ...r, ...choice, id, title });
      await open(id);
    }
  });
$("#library").onclick = () =>
  task(async () => {
    if (!window.workshop)
      throw Error("Choose the asset folder in the desktop app");
    const s = await call("chooseLibrary");
    if (s)
      $("#libraryInfo").textContent =
        s.assets.toLocaleString() + " local assets";
  });
let buildBusy = false;
async function buildOperation(play = false, exporting = false) {
  if (buildBusy) return;
  if (!project) throw Error("Open an island first.");
  buildBusy = true;
  const started = Date.now(), disabled = new Map();
  for (const id of ["build", "play", "applyPlay", "export", "newProject", "projects", "importIsland", "copyProject", "stopPlay"]) {
    const node = $("#" + id); disabled.set(node, node.disabled); node.disabled = true;
  }
  let stage = "Saving your work…", polling = false;
  $("#buildProgress").hidden = false;
  $("#buildProgress").setAttribute("aria-busy", "true");
  function feedback() {
    $("#buildStage").textContent = stage;
    $("#buildElapsed").textContent = Math.floor((Date.now() - started) / 1000) + "s · The first build can take longer.";
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
    stage = exporting ? "Building your export…" : "Building your island…"; feedback();
    if (exporting) {
      const dir = await call("export", { project: project.id });
      status("Export saved"); await message("Export ready", dir); return;
    }
    const result = await call("build", { project: project.id });
    if (play) {
      stage = "Preparing Inspect…"; feedback();
      await call("play", { project: project.id });
      window.liveEditor?.close();
      stage = "Opening the player…"; feedback();
      const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(Error("The player is taking longer than expected. Check the build log, then try Play again.")); }, 90000);
        function cleanup() { clearTimeout(timeout); window.removeEventListener("message", receive); }
        function receive(event) {
          if (event.source !== $("#game").contentWindow || event.origin !== location.origin) return;
          if (event.data?.type === "islandengine-player-ready") { cleanup(); resolve(); }
          if (event.data?.type === "islandengine-player-error") { cleanup(); reject(Error(event.data.message || "The player could not open. Check the build log.")); }
        }
        window.addEventListener("message", receive);
      });
      $("#game").src = "/player.html?build=" + Date.now();
      $("#playView").hidden = false; await ready;
      status("Playing · Choose Inspect to edit objects.");
    } else status("Build complete · Play to try it.");
    return result;
  } catch (error) { $("#log").hidden = false; throw error; }
  finally {
    clearInterval(timer); await poll(); buildBusy = false;
    $("#buildProgress").hidden = true; $("#buildProgress").setAttribute("aria-busy", "false");
    for (const [node, wasDisabled] of disabled) node.disabled = wasDisabled;
  }
}
async function doBuild() { return buildOperation(); }
$("#build").onclick = () => task(doBuild);
$("#play").onclick = () => task(() => buildOperation(true));
$("#applyPlay").onclick = () => $("#play").click();
$("#stopPlay").onclick = () => {
  window.liveEditor?.close(); $("#game").src = "about:blank"; $("#playView").hidden = true; status("Stopped");
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
      $("#game").src =
        "/asset.html?path=" +
        encodeURIComponent(asset.path) +
        (asset.symbol != null ? "&symbol=" + asset.symbol : "");
      $("#playView").hidden = false;
    };
    use.onclick = () =>
      task(async () => {
        if (!selected) {
          status("Select a room object or an item card first");
          return;
        }
        const target = selected;
        if (asset.type === "font") {
          status(
            "Use this font in your text code, or import the lettering as an image.",
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
        $("#playView").hidden = true;
        $("#game").src = "about:blank";
        status("Art added to " + (target.label || target.id));
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
  for (const name of list.filter((f) => /\.(as|xml|json|md|txt)$/.test(f) && f.toLowerCase().includes(query))) {
    const n = el("div", name, "file");
    n.onclick = () => task(() => openCode(name));
    $("#fileList").append(n);
  }
}
$("#fileSearch").oninput = () => task(files);
async function openCode(name) {
  if (dirty) await save();
  if (!$("#codeView").hidden && file) await saveCode();
  const text = await call("read", { project: project.id, file: name });
  file = name;
  $("#source").value = text;
  $("#fileName").textContent = name;
  $("#codeView").hidden = false;
}
async function saveCode() {
  if (!file) return;
  await call("write", {
    project: project.id,
    file,
    text: $("#source").value,
  });
  if (file === "island.json") {
    const roomId = room?.id;
    project = await call("open", { id: project.id });
    room = project.scenes.find((r) => r.id === roomId) || project.scenes[0];
    selected = null;
    history = [];
    future = [];
    dirty = false;
    $("#projectName").textContent = project.title;
    renderRooms();
    inspect();
    draw();
  }
  status("File saved");
  $("#fileName").textContent = file;
}
$("#source").addEventListener("input", () => {
  $("#fileName").textContent = file + " •";
});
$("#saveCode").onclick = () => task(saveCode);
$("#closeCode").onclick = () =>
  task(async () => {
    await saveCode();
    $("#codeView").hidden = true;
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
document.addEventListener("keydown", (e) => {
  const command = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (command && key === "s") { e.preventDefault(); if (!buildBusy) task(saveCurrent); return; }
  if (window.liveEditor?.active || !$("#playView").hidden || !$("#codeView").hidden) return;
  if (e.target.isContentEditable || e.target.closest?.("input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],[role=textbox]") || $("#modal").open || !project || project.mode === "existing") return;
  if (command && (key === "z" || key === "y")) {
    e.preventDefault(); const redo = key === "y" || e.shiftKey;
    restore(redo ? future : history, redo ? history : future); return;
  }
  if (key === "escape") {
    if (drag) { if (drag.pan) pan = drag.start; else if (selected) { Object.assign(selected, drag.start); if (drag.moved) { history.pop(); future = drag.previousFuture; dirty = drag.wasDirty; updateSaveState(); } } drag = null; }
    else selected = null;
    inspect(); draw(); return;
  }
  const editable = selected && room?.objects.includes(selected);
  if (command && ["c", "x", "d", "v"].includes(key)) {
    e.preventDefault();
    if (key === "v") pasteObject();
    else if (editable) {
      if (key === "d") pasteObject(selected);
      else { objectClipboard = structuredClone(selected); if (key === "x") removeSelected(); else status("Object copied · Ctrl+V to paste in a room."); }
    }
    return;
  }
  if (!editable) return;
  if (key === "delete" || key === "backspace") { e.preventDefault(); removeSelected(); }
  const movement = {arrowleft:[-1,0], arrowright:[1,0], arrowup:[0,-1], arrowdown:[0,1]}[key];
  if (movement) { e.preventDefault(); snapshot(); selected.x += movement[0] * (e.shiftKey ? 10 : 1); selected.y += movement[1] * (e.shiftKey ? 10 : 1); inspect(); changed(); }
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
  $("#libraryInfo").textContent =
    s.assets.toLocaleString() +
    " files · " +
    (s.artSymbols || 0).toLocaleString() +
    " art symbols";
  if (s.projects.length) await open(s.projects[0].id);
  else updateWorkspace();
  if (!s.library) {
    document.querySelector('.librarySettings').open = true;
    $('#libraryInfo').textContent = 'Choose the Poptropica game folder to build and play islands. It should contain game/Shell.swf and ruffle/ruffle.js.';
    status('Choose your game folder to get started.');
  }
});

function chooseTool(kind) {
  $("#tool").value = kind;
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === kind);
    b.setAttribute("aria-pressed", String(b.dataset.tool === kind));
  });
  $("#toolHelp").textContent =
    kind === "select"
      ? "Click an object to edit it. Drag to move. Drag the bottom-right corner to resize. Scroll to zoom."
      : "Click in the room to place " +
        ({
          art: "scenery",
          npc: "a character",
          item: "an item",
          door: "a door",
          platform: "a platform",
        }[kind] || "the object") +
        ".";
  canvas.style.cursor = kind === "select" ? "default" : "crosshair";
}
document
  .querySelectorAll("[data-tool]")
  .forEach((b) => (b.onclick = () => chooseTool(b.dataset.tool)));
$("#tool").onchange = () => chooseTool($("#tool").value);
$("#roomSettings").onclick = () => {
  selected = null;
  inspect();
};
function updateWorkspace() {
  for (const id of [
    "save",
    "build",
    "play",
    "export",
    "addRoom",
    "copyProject",
    "roomSettings",
    "newCode",
    "engineClass",
    "importArt",
  ])
    $("#" + id).disabled = !project;
  if (project) {
    $("#addRoom").disabled =
      project.mode === "existing" && project.version !== "AS2";
    $("#newCode").disabled = project.version === "AS2";
  }
  const visual = project && project.mode !== "existing";
  $("#projectVersion").textContent = project?.version || "AS3";
  renderItems();
  $("#projectCode").disabled = !project;
  $("#runtimeCode").disabled = !project || project.mode === "existing";
  $("#roomToolbar").hidden = !visual;
  $("#placementTools").hidden = !visual;
  $("#toolHelp").hidden = !visual;
  $("#objectList").hidden = !visual;
  document.body.classList.toggle("existingProject", !!project && !visual);
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
    b.append(el("small", o.kind));
    b.onclick = () => {
      selected = o;
      inspect();
      draw();
    };
    list.append(b);
  }
}
function renderExistingRooms(rows) {
  const box = $("#existingHelp");
  box.replaceChildren(
    el("h2", project.title),
    el("p", "Choose a room to edit its files. Press Play to build and open the starting room."),
    el("p", project.version === "AS2"
      ? "This AS2 copy uses the original SWF scripts. Use Copy room to add a room, then edit its scripts to connect exits and change puzzles. The visual room and Items editors are for new AS3 islands."
      : "This AS3 copy uses the original XML and engine classes. Click a room to open its scene XML, or open Code to find dialogue and item files. The visual room and Items editors are for new AS3 islands."),
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
  const cards = el("div", null, "existingRooms");
  const buttons = [...$("#roomList").querySelectorAll("button")];
  rows.forEach((r, i) => {
    const b = el("button", r.title);
    b.append(el("small", "Edit room files"));
    b.onclick = () => buttons[i].click();
    cards.append(b);
  });
  box.append(cards);
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
  const section = el("section", null, "objectActions");
  section.append(
    el("h4", selected.kind === "inventory" ? "When used" : "When activated"),
  );
  (selected.actions || []).forEach((action, index) => {
    const row = el("div", null, "actionRow");
    const spec = actionFields[action.type];
    row.append(el("strong", index + 1 + ". " + (spec?.[0] || action.type)));
    if (spec)
      for (const [key, name] of spec.slice(1)) {
        const update = (value) => {
          action[key] = value;
          const raw = $("#inspector details textarea");
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
              const raw = $("#inspector details textarea");
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
            const raw = $("#inspector details textarea");
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
        const raw = $("#inspector details textarea");
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
        "This copy keeps its original inventory. Open Code to edit the item files and scripts.",
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
    status("Press USE on this inventory card to combine the ingredients.");
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
      "To give this item after a conversation, add Give item after the character’s dialogue.",
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
  const raw = el("details");
  raw.append(el("summary", "Action code (JSON)"));
  field(
    raw,
    "Actions",
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
