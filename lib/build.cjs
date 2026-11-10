const fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const { write, xml, inside, walk } = require("./files.cjs");
const { validate, className } = require("./model.cjs");
const { bootConfig } = require("./islands.cjs");
const { nativeUi } = require("./native-ui.cjs");
function run(exe, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let output = "";
    const read = (b) => {
      output += b;
      log?.(b.toString());
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(Error(output.slice(-12000) || "Compiler failed: " + code)),
    );
  });
}
function attrs(o) {
  return Object.entries(o)
    .filter(
      ([k, v]) => k !== "data" && typeof v !== "object" && v !== undefined,
    )
    .map(([k, v]) => {
      if (!/^[A-Za-z_][\w.-]*$/.test(k))
        throw Error("Invalid property name: " + k);
      return `${k}="${xml(v)}"`;
    })
    .join(" ");
}
function dataSpec(value) {
  return value === undefined
    ? ""
    : "<data>" + xml(JSON.stringify(value)) + "</data>";
}
function sceneSpec(scene, items = []) {
  return (
    "<room " +
    attrs(scene) +
    ">" +
    dataSpec(scene.data) +
    "<inventory>" +
    items
      .map(
        (i) =>
          "<item " +
          attrs(i) +
          ">" +
          dataSpec(i.data) +
          (i.actions || [])
            .map(
              (a) =>
                "<action " + attrs(a) + ">" + dataSpec(a.data) + "</action>",
            )
            .join("") +
          "</item>",
      )
      .join("") +
    "</inventory>" +
    scene.objects
      .map(
        (o) =>
          "<object " +
          attrs(o) +
          ">" +
          dataSpec(o.data) +
          (o.actions || [])
            .map(
              (a) =>
                "<action " + attrs(a) + ">" + dataSpec(a.data) + "</action>",
            )
            .join("") +
          "</object>",
      )
      .join("") +
    "</room>"
  );
}
function sourceFiles(projectDir, folder, requested, setting) {
  const base = path.join(projectDir, folder);
  const found = walk(base)
    .filter((f) => f.endsWith(".as"))
    .sort();
  const order = requested === undefined ? found : requested;
  if (
    !Array.isArray(order) ||
    new Set(order).size !== order.length ||
    found.some((f) => !order.includes(f)) ||
    order.some((f) => !found.includes(f))
  )
    throw Error(
      setting +
        " must list every .as file under " +
        folder +
        " exactly once, with dependencies first.",
    );
  return order.map((f) => inside(base, f));
}
async function build(root, projectDir, library, config, p, log = () => {}) {
  const errors = validate(p);
  if (errors.length) throw Error(errors.join("\n"));
  const out = path.join(projectDir, "build");
  fs.mkdirSync(out, { recursive: true });
  const sources = sourceFiles(
    projectDir,
    "src/extra",
    p.sourceOrder,
    "sourceOrder",
  );
  const baseSource = path.join(projectDir, "src/IslandScene.as");
  if (fs.existsSync(baseSource)) {
    const previous = fs.readFileSync(baseSource, "utf8");
    const hash = require("node:crypto")
      .createHash("sha256")
      .update(previous.replace(/\r\n/g, "\n").trim())
      .digest("hex");
    if (
      hash ===
      "f56191f130a75e129b04edf5288657aa266cb102125cc0c5a83e859202d4a5db" ||
      hash === "7c24b61bf1a303fb95fa30f18167d28125ea242a5607b891049ee8f6ebb63c62"
    ) {
      write(
        path.join(
          projectDir,
          hash === "7c24b61bf1a303fb95fa30f18167d28125ea242a5607b891049ee8f6ebb63c62"
            ? ".history/source/IslandScene-before-interaction-fixes.as"
            : ".history/source/IslandScene-before-native-inventory.as",
        ),
        previous,
      );
      write(
        baseSource,
        fs.readFileSync(path.join(root, "templates/IslandScene.as")),
      );
    }
  }
  if (!fs.existsSync(baseSource))
    write(
      baseSource,
      fs.readFileSync(path.join(root, "templates/IslandScene.as")),
    );
  sources.push(baseSource);
  sources.push(
    ...sourceFiles(
      projectDir,
      "src/scenes",
      p.sceneSourceOrder,
      "sceneSourceOrder",
    ),
  );
  function soundFile(name, music = false) {
    const local = inside(path.join(projectDir, "assets"), name);
    if (!fs.existsSync(local)) return name.replace(/^game\/sound\//, "");
    if (path.extname(local).toLowerCase() !== ".mp3")
      throw Error("Use MP3 audio in the game: " + name);
    const relative = `${music ? "music" : "effects"}/${p.id}/${name}`;
    write(
      inside(path.join(out, "game/sound"), relative),
      fs.readFileSync(local),
    );
    return relative;
  }
  const inventory = structuredClone(p.items || []);
  for (const item of inventory)
    for (const action of item.actions || [])
      if (action.type === "sound") action.asset = soundFile(action.asset);
  const cards = new Map();
  for (const scene of p.scenes)
    for (const object of scene.objects) {
      if (object.kind === "item") cards.set(object.itemId || object.id, object);
      for (const action of object.actions || [])
        if (action.type === "give" && !cards.has(action.id))
          cards.set(action.id, action);
    }
  for (const item of p.items || [])
    cards.set(item.id, { ...item, kind: "inventory" });
  for (const [id, item] of cards) {
    let art = "";
    if (item.asset && ["item", "inventory"].includes(item.kind)) {
      const custom = inside(path.join(projectDir, "assets"), item.asset);
      const from = fs.existsSync(custom) ? custom : inside(library, item.asset);
      const name = id + path.extname(from);
      write(
        path.join(out, "game/assets/items", p.id, name),
        fs.readFileSync(from),
      );
      art = `<asset id="islandengineArt"><assetPath>items/${xml(p.id)}/${xml(name)}</assetPath></asset>`;
    }
    write(
      path.join(out, "game/data/items", p.id, id + ".xml"),
      `<item id="${xml(id)}"><type>island</type><subType>${xml(p.id)}</subType><textfields><text id="title"><value>${xml(item.label || id)}</value></text>${item.description ? `<text id="description"><value>${xml(item.description)}</value></text>` : ""}</textfields><buttons><btn><label>USE</label><actions><action type="triggerEvent"><parameters><param id="event">islandengine_use_${xml(id)}</param></parameters></action></actions></btn></buttons><assets><asset id="cardBack"><assetPath>items/carrot/background.swf</assetPath></asset>${art}</assets></item>`,
    );
  }
  for (const s of p.scenes) {
    const dir = path.join(out, "game/data/scenes", p.id, s.id),
      assetDir = path.join(out, "game/assets/scenes", p.id, s.id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.copyFileSync(
      path.join(root, "templates/empty.swf"),
      path.join(assetDir, "interactive.swf"),
    );
    let assetNames = [];
    const spec = structuredClone(s);
    const music = s.music
      ? soundFile(s.music, true).replace(/^music\//, "")
      : "";
    for (const o of spec.objects) {
      for (const action of o.actions || []) {
        if (action.type === "sound") action.asset = soundFile(action.asset);
      }
      if (o.asset) {
        const filename = o.id + path.extname(o.asset),
          custom = inside(path.join(projectDir, "assets"), o.asset),
          original = inside(library, o.asset);
        const from = fs.existsSync(custom) ? custom : original;
        if (!fs.existsSync(from)) throw Error("Missing art: " + o.asset);
        if (
          ![".swf", ".png", ".jpg", ".jpeg"].includes(
            path.extname(from).toLowerCase(),
          )
        )
          throw Error("In-game art must be PNG, JPEG or SWF: " + o.asset);
        fs.copyFileSync(from, path.join(assetDir, filename));
        assetNames.push(filename);
        o.asset = filename;
      }
    }
    write(
      path.join(dir, "scene.xml"),
      `<scene><sceneType>default</sceneType><cameraLimits><left>0</left><top>0</top><right>${s.width}</right><bottom>${s.height}</bottom></cameraLimits><bounds><left>0</left><top>0</top><right>${s.width}</right><bottom>${s.height}</bottom></bounds><data>hits.xml,npcs.xml,dialog.xml,sounds.xml</data><assets>${assetNames.map(xml).join(",")}</assets><layers><layer id="interactive" hit="true" bitmap="false"><asset>interactive.swf</asset><rate>1</rate></layer></layers><player><defaultPosition><x>${s.spawn.x}</x><y>${s.spawn.y}</y></defaultPosition><defaultDirection>right</defaultDirection></player></scene>`,
    );
    write(
      path.join(dir, "hits.xml"),
      '<hits><hit id="floor" color="0x00ff00" platform="true"><component type="platform"/></hit><hit id="wall" color="0xff6600"><component type="wall"/></hit><hit id="climb" color="0xffff00"><component type="climb"/></hit><hit id="water" color="0x0000ff"><component type="water"/></hit></hits>',
    );
    write(
      path.join(dir, "npcs.xml"),
      "<npcs>" +
        s.objects
          .filter((o) => o.kind === "npc")
          .map(
            (o) =>
              `<npc id="${xml(o.id)}"><skin><gender>${xml(o.gender || "female")}</gender><skinColor>${xml(o.skinColor || "0xb97c50")}</skinColor><hairColor>${xml(o.hairColor || "0x38261e")}</hairColor><hair>${xml(o.hair || "ce_ranger")}</hair><shirt>${xml(o.shirt || "stor_winter_jack")}</shirt><pants>${xml(o.pants || "wwgenericguy")}</pants><mouth>10</mouth></skin><position><x>${o.x}</x><y>${o.y}</y></position><direction>${o.direction || "left"}</direction></npc>`,
          )
          .join("") +
        "</npcs>",
    );
    write(
      path.join(dir, "dialog.xml"),
      '<dialogs><character id="player"><statement id="ready">...</statement></character>' +
        s.objects
          .filter((o) => o.kind === "npc")
          .map(
            (o) =>
              `<character id="${xml(o.id)}"><statement id="ready">${xml(o.text || "Hello.")}</statement></character>`,
          )
          .join("") +
        "</dialogs>",
    );
    write(
      path.join(dir, "sounds.xml"),
      music
        ? `<sounds><sound type="music"><asset loop="true">${xml(music)}</asset></sound></sounds>`
        : "<sounds/>",
    );
    const generated = path.join(
      projectDir,
      "generated",
      p.id,
      s.id,
      className(s.id) + ".as",
    );
    write(
      generated,
      `package game.scenes.${p.id}.${s.id} { import ${s.script || "islandengine.IslandScene"}; public class ${className(s.id)} extends ${(s.script || "islandengine.IslandScene").split(".").pop()} { public function ${className(s.id)}() { super(${JSON.stringify(p.id)},new XML(${JSON.stringify(sceneSpec(spec, inventory))})); } } }`,
    );
    sources.push(generated);
  }
  const eventFile = path.join(projectDir, "generated", p.id, "IslandEvents.as");
  write(
    eventFile,
    `package game.scenes.${p.id} { import game.data.island.IslandEvents; ${p.scenes.map((s) => `import game.scenes.${p.id}.${s.id}.${className(s.id)};`).join(" ")} public class CustomEvents extends IslandEvents { public function CustomEvents(){super(); island=${JSON.stringify(p.id)}; accessible=true; earlyAccess=false; scenes=[${p.scenes.map((s) => className(s.id)).join(",")}];} } }`,
  );
  sources.push(eventFile);
  const flags = new Set([
    ...(p.flags || []),
    "island_complete",
    ...p.scenes.flatMap((s) =>
      s.objects.flatMap((o) =>
        (o.actions || []).filter((a) => a.type === "flag").map((a) => a.id),
      ),
    ),
  ]);
  const first = `game.scenes.${p.id}.${p.start}.${className(p.start)}`;
  write(
    path.join(out, "game/data/scenes", p.id, "island.xml"),
    `<island><name>${xml(p.title)}</name><eventsClass>game.scenes.${p.id}.CustomEvents</eventsClass><gameVersion>AS3</gameVersion><island>${p.id}</island><permanentEvents>${[...flags].map((f) => `<event>${xml(f)}</event>`).join("")}</permanentEvents><firstScene><scene>${first}</scene><x>160</x><y>650</y><direction>right</direction></firstScene></island>`,
  );
  write(
    path.join(out, "game/data/scenes", p.id, "eventGroups.xml"),
    "<groups/>",
  );
  let game = fs.readFileSync(
    path.join(library, "game/data/game/browser/game.xml"),
    "utf8",
  );
  game = bootConfig(game, first, p.id);
  write(path.join(out, "game/data/game/browser/game.xml"), game);
  const java = path.resolve(root, config.java),
    jar = path.resolve(root, config.ffdec);
  let shell =
    p.nativeUi === false
      ? path.join(library, "game/Shell.swf")
      : await nativeUi(
          root,
          config,
          path.join(library, "game/Shell.swf"),
          "AS3",
          run,
          log,
        );
  const overrides = path.join(projectDir, "overrides");
  if (walk(overrides).some((f) => f.endsWith(".as"))) {
    const patched = path.join(out, "patched.swf");
    log("Compiling engine changes…\n");
    await run(
      java,
      [
        "-Xmx2048m",
        "-Djava.awt.headless=true",
        "-jar",
        jar,
        "-config",
        "parallelSpeedUp=0",
        "-importScript",
        shell,
        patched,
        overrides,
      ],
      log,
    );
    shell = patched;
  }
  log("Compiling island classes…\n");
  await run(
    java,
    [
      "-Xmx2048m",
      "-Djava.awt.headless=true",
      "-cp",
      [
        path.join(root, "tools/vendor/compiler"),
        jar,
        path.join(root, "tools/vendor/lib/*"),
      ].join(path.delimiter),
      "AppendAs3Classes",
      shell,
      path.join(out, "game/Shell.swf"),
      ...sources,
    ],
    log,
  );
  const overlay = path.join(projectDir, "overlay");
  for (const file of walk(overlay))
    write(inside(out, file), fs.readFileSync(inside(overlay, file)));
  log("Build complete.\n");
  return { first, out };
}
module.exports = { build, run, sceneSpec, sourceFiles };
