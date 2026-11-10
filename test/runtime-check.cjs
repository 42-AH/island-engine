const fs = require("node:fs");
const path = require("node:path");
const { build } = require("../lib/build.cjs");
const { write } = require("../lib/files.cjs");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, ".cache/runtime-check");
const config = JSON.parse(fs.readFileSync(path.join(root, "local.json")));
const object = (id, kind, x, y, width, height, rest = {}) => ({
  id,
  kind,
  x,
  y,
  width,
  height,
  ...rest,
});
const project = {
  id: "mechanicCheck",
  title: "Mechanics check",
  items: [
    {
      id: "coin",
      kind: "inventory",
      label: "Brass coin",
      asset: "coin.png",
      description: "A worn brass coin.",
    },
    {
      id: "handle",
      kind: "inventory",
      label: "Handle",
      requiresItem: "blade",
      actions: [
        { type: "take", id: "blade" },
        { type: "take", id: "handle" },
        { type: "give", id: "tool" },
      ],
    },
    { id: "blade", kind: "inventory", label: "Blade" },
    {
      id: "tool",
      kind: "inventory",
      label: "Repaired tool",
      actions: [{ type: "flag", id: "tool_used" }],
    },
  ],
  start: "arrival",
  scenes: [
    {
      id: "arrival",
      script: "custom.CheckRules",
      title: "Arrival",
      width: 2400,
      height: 1100,
      background: "#b0d9df",
      spawn: { x: 180, y: 650 },
      objects: [
        object("ground", "platform", 0, 800, 2400, 300),
        object("hiddenTrigger", "trigger", 100, 100, 100, 100, {
          showWhen: "revealed",
          actions: [{ type: "flag", id: "revealed_trigger_ran" }],
        }),
        object("hiddenTarget", "switch", 100, 100, 30, 30, {
          hideWhen: "obsolete",
          requiresItem: "tool",
          actions: [{ type: "flag", id: "obsolete_used" }],
        }),
        object("collectedTarget", "item", 100, 100, 30, 30, {
          requiresItem: "tool",
          actions: [{ type: "flag", id: "collected_used" }],
        }),
        object("visibleTarget", "switch", 100, 100, 30, 30, {
          showWhen: "revealed",
          requiresItem: "tool",
          actions: [{ type: "flag", id: "visible_used" }],
        }),
        object("bounce", "bounce", 300, 700, 120, 80, { strength: 800 }),
        object("hazard", "hazard", 500, 600, 120, 180),
        object("water", "water", 700, 650, 220, 140),
        object("rope", "climb", 1100, 400, 50, 390),
        object("lift", "movingPlatform", 1400, 600, 220, 30, {
          travelX: 200,
          travelY: 0,
          speed: 1,
        }),
        object("wall", "wall", 1850, 400, 60, 400),
        object("once", "trigger", 2050, 650, 100, 150, {
          actions: [{ type: "flag", id: "crossed" }],
        }),
        object("coin", "item", 200, 700, 40, 40, {
          itemId: "coin",
          asset: "coin.png",
        }),
        object("gate", "switch", 400, 700, 40, 40, {
          requiresItem: "coin",
          actions: [
            { type: "take", id: "coin" },
            { type: "flag", id: "gate_open" },
          ],
        }),
        object("delay", "switch", 650, 700, 40, 40, {
          actions: [
            { type: "wait", seconds: 0.2 },
            { type: "flag", id: "wait_done" },
          ],
        }),
        object("checkpoint", "switch", 200, 600, 30, 30, {
          actions: [{ type: "checkpoint" }],
        }),
        object("sound", "switch", 650, 700, 30, 30, {
          actions: [
            { type: "sound", asset: "effects/door_pushbar_open_02.mp3" },
            { type: "flag", id: "sound_called" },
          ],
        }),
        object("exit", "door", 2250, 680, 80, 120, {
          target: "nextRoom",
          targetX: 180,
          targetY: 650,
        }),
      ],
    },
    {
      id: "nextRoom",
      title: "Next room",
      width: 1600,
      height: 1000,
      background: "#b0d9df",
      spawn: { x: 180, y: 650 },
      objects: [
        object("ground", "platform", 0, 800, 1600, 200),
        object("once", "trigger", 100, 650, 200, 150, {
          actions: [{ type: "flag", id: "second_trigger" }],
        }),
        object("coin", "item", 200, 700, 40, 40, {
          itemId: "coin",
          asset: "coin.png",
        }),
      ],
    },
  ],
};
async function prepare() {
  write(path.join(dir, "island.json"), JSON.stringify(project, null, 2));
  write(
    path.join(dir, "assets/coin.png"),
    fs.readFileSync(path.join(__dirname, "fixtures/backdrop.png")),
  );
  let source = fs.readFileSync(
    path.join(root, "templates/IslandScene.as"),
    "utf8",
  );
  source = source.replace(
    "state.data.room=String(spec.@id);",
    "state.data.room=String(spec.@id);",
  );
  source = source.replace(
    "import flash.utils.getTimer;",
    "import flash.utils.getTimer;\n    import flash.utils.setTimeout;\n    import engine.components.Interaction;",
  );
  const end = source.lastIndexOf("\n    }");
  source =
    source.slice(0, end) +
    fs.readFileSync(path.join(__dirname, "runtime-probes.as.txt"), "utf8") +
    source.slice(end);
  source = source.replace(
    "clock=getTimer();",
    "SceneUtil.addTimedEvent(this,new TimedEvent(1,1,beginChecks));\n            clock=getTimer();",
  );
  write(path.join(dir, "src/IslandScene.as"), source);
  write(
    path.join(dir, "src/scenes/CheckRules.as"),
    fs.readFileSync(path.join(__dirname, "CheckRules.as")),
  );
  await build(root, dir, config.library, config, project);
  console.log("Built runtime checks.");
}
if (require.main === module)
  prepare().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { root, dir, project };
