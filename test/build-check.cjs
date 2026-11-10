const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Workshop } = require("../lib/workshop.cjs");
const { build } = require("../lib/build.cjs");
const { validate } = require("../lib/model.cjs");
const { write } = require("../lib/files.cjs");
const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "local.json")));
const workshop = new Workshop(path.join(root, ".cache/build-check"));
const object = (id, kind, x, y, width, height, extra = {}) => ({
  id,
  kind,
  x,
  y,
  width,
  height,
  ...extra,
});
const scenes = Array.from({ length: 32 }, (_, index) => ({
  id: "room" + index,
  title: "Room " + index,
  width: 2000,
  height: 1000,
  background: "#b0d9df",
  spawn: { x: 160, y: 650 },
  script: "custom.ConfiguredRoom",
  data: { startFlag: "entered_" + index, route: ["harbor", "shed"] },
  objects: [
    object("backdrop", "art", 0, 0, 2000, 1000, { asset: "backdrop.png" }),
    object("ground", "platform", 0, 800, 2000, 200),
    object("ladder", "climb", 250, 400, 40, 390),
    object("pool", "water", 350, 700, 150, 90),
    object("lift", "movingPlatform", 600, 600, 160, 24, {
      travelX: 180,
      travelY: 60,
      speed: 1,
    }),
    object("bounce", "bounce", 800, 730, 100, 50, { strength: 750 }),
    object("hazard", "hazard", 1000, 740, 100, 50),
    object("wall", "wall", 1200, 650, 50, 150),
    object("once", "trigger", 1400, 700, 80, 100, {
      actions: [{ type: "flag", id: "visited_" + index }],
    }),
    object("coin" + index, "item", 1500, 700, 35, 35),
    object("lamp", "switch", 1600, 700, 50, 50, {
      actions: [{ type: "custom", id: "turnLamp" }],
    }),
    object("exit", "door", 1800, 650, 80, 150, {
      target: "room" + ((index + 1) % 32),
      targetX: 160,
      targetY: 650,
    }),
  ],
}));
scenes[31].objects.push(
  object("finish", "switch", 1700, 700, 50, 50, {
    requiresItem: "coin0",
    actions: [
      { type: "take", id: "coin0" },
      { type: "complete", text: "The last room is open." },
    ],
  }),
);
const project = {
  sceneSourceOrder: ["RoomRules.as", "ConfiguredRoom.as"],
  format: 1,
  id: "fullIslandCheck",
  title: "Full island build check",
  start: "room0",
  scenes,
};
async function main() {
  assert.deepEqual(validate(project), []);
  workshop.save(project);
  assert.deepEqual(workshop.project(project.id), project);
  const dir = workshop.dir(project.id);
  write(
    path.join(dir, "assets/backdrop.png"),
    fs.readFileSync(path.join(root, "test/fixtures/backdrop.png")),
  );
  write(
    path.join(dir, "src/IslandScene.as"),
    fs.readFileSync(path.join(root, "templates/IslandScene.as")),
  );
  write(
    path.join(dir, "src/scenes/RoomRules.as"),
    fs.readFileSync(path.join(root, "examples/RoomRules.as")),
  );
  write(
    path.join(dir, "src/scenes/ConfiguredRoom.as"),
    fs.readFileSync(path.join(root, "examples/ConfiguredRoom.as")),
  );
  const result = await build(root, dir, config.library, config, project);
  for (const scene of scenes) {
    assert.ok(
      fs.existsSync(
        path.join(
          result.out,
          "game/data/scenes",
          project.id,
          scene.id,
          "scene.xml",
        ),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          result.out,
          "game/assets/scenes",
          project.id,
          scene.id,
          "backdrop.png",
        ),
      ),
    );
  }
  assert.ok(
    fs.statSync(path.join(result.out, "game/Shell.swf")).size > 1000000,
  );
  write(
    path.join(root, ".cache/build-check/result.json"),
    JSON.stringify(
      {
        rooms: scenes.length,
        objects: scenes.reduce((n, s) => n + s.objects.length, 0),
        customScene: "custom.ConfiguredRoom",
        customData: true,
        orderedInheritance: true,
        saved: true,
        compiled: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "32 connected rooms, 385 objects, custom room code, and island ending saved and compiled.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
