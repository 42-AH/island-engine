const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const path = require("node:path");
const { Workshop } = require("../lib/workshop.cjs");
const { blank, validate } = require("../lib/model.cjs");
const { sceneSpec, sourceFiles } = require("../lib/build.cjs");
const { walk, write } = require("../lib/files.cjs");
function fixture(t) {
  const base = path.resolve(__dirname, "../.cache/editing-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "run-"));
  t.after(() => {
    if (!path.resolve(root).startsWith(base + path.sep))
      throw Error("Test directory escaped its parent");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
test("copying a project preserves source and assets without copying generated output", async (t) => {
  const root = fixture(t), w = new Workshop(root), p = blank("original", "Original");
  w.save(p);
  for (const file of ["src/IslandScene.as", "src/scenes/Room.as", "overrides/Engine.as", "overlay/game/custom.xml", "assets/card.png", "generated/Room.as", "build/game/Shell.swf", ".history/old.json"])
    write(path.join(w.dir(p.id), file), "original " + file);
  await w.call("copyProject", { project: p.id, id: "copied", title: "Copied" });
  assert.equal(w.project("copied").title, "Copied");
  assert.equal(w.project("original").id, "original");
  for (const file of ["src/IslandScene.as", "src/scenes/Room.as", "overrides/Engine.as", "overlay/game/custom.xml", "assets/card.png"])
    assert.equal(fs.readFileSync(path.join(w.dir("copied"), file), "utf8"), "original " + file);
  for (const folder of ["build", "generated", ".history"]) assert.equal(fs.existsSync(path.join(w.dir("copied"), folder)), false);
  await assert.rejects(w.call("copyProject", { project: p.id, id: "original" }), /already exists/);
  await assert.rejects(w.call("copyProject", { project: p.id, id: "../escape" }), /Invalid project/);
});
test("copying edited AS2 projects retains the SWF compilation baselines", async (t) => {
  const root = fixture(t), w = new Workshop(root);
  w.save({ ...blank("classic"), version: "AS2", mode: "existing" });
  const original = ".history/as2-originals/scenes/islandTrain/sceneTrainMain.swf";
  write(path.join(w.dir("classic"), original), "original SWF");
  write(path.join(w.dir("classic"), "as2-sources.json"), JSON.stringify([{ original }]));
  await w.call("copyProject", { project: "classic", id: "copyClassic" });
  assert.equal(fs.readFileSync(path.join(w.dir("copyClassic"), original), "utf8"), "original SWF");
});
test("room, object, and action settings survive scene generation", () => {
  const room = blank().scenes[0];
  room.weather = "rain";
  room.data = { route: [1, 2], note: '<gate>&"' };
  room.objects[0].data = { damage: 3 };
  room.objects[0].actions = [
    { type: "custom", id: "gate", data: { keys: ["blue", "red"] } },
  ];
  const spec = sceneSpec(room);
  assert.match(spec, /weather="rain"/);
  const data = [...spec.matchAll(/<data>(.*?)<\/data>/g)].map((m) =>
    JSON.parse(
      m[1]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    ),
  );
  assert.deepEqual(data, [
    room.data,
    room.objects[0].data,
    room.objects[0].actions[0].data,
  ]);
});
test("room scripts can compile in dependency order", (t) => {
  const root = fixture(t);
  for (const name of ["AChild.as", "ZBase.as"])
    write(path.join(root, "src/scenes", name), "");
  const order = ["ZBase.as", "AChild.as"];
  assert.deepEqual(
    sourceFiles(root, "src/scenes", order, "sceneSourceOrder").map((p) =>
      path.basename(p),
    ),
    order,
  );
  for (const invalid of [
    null,
    ["AChild.as"],
    ["AChild.as", "AChild.as"],
    ["../outside.as"],
  ])
    assert.throws(
      () => sourceFiles(root, "src/scenes", invalid, "sceneSourceOrder"),
      /sceneSourceOrder/,
    );
});
test("editing source keeps earlier contents and skips unchanged saves", async (t) => {
  const w = new Workshop(fixture(t));
  w.save(blank("demo"));
  const args = { project: "demo", file: "src/extra/Rule.as", text: "first" };
  await w.call("write", args);
  await w.call("write", { ...args, text: "second" });
  await w.call("write", { ...args, text: "second" });
  const history = walk(path.join(w.dir("demo"), ".history/source"));
  assert.equal(history.length, 1);
  assert.equal(
    fs.readFileSync(
      path.join(w.dir("demo"), ".history/source", history[0]),
      "utf8",
    ),
    "first",
  );
  assert.equal(await w.call("read", args), "second");
});
test("source saves reject generated paths, history paths, and a changed island ID", async (t) => {
  const w = new Workshop(fixture(t));
  w.save(blank("demo"));
  for (const file of [
    "build/Main.as",
    "src/../generated/Main.as",
    "src/../.history/old.as",
    "build\\Main.as",
  ])
    await assert.rejects(
      w.call("write", { project: "demo", file, text: "changed" }),
      /generated output or saved history/,
    );
  await assert.rejects(
    w.call("write", {
      project: "demo",
      file: "./island.json",
      text: JSON.stringify(blank("other")),
    }),
    /match its project folder/,
  );
  assert.equal(w.project("demo").id, "demo");
});
test("validation reports missing sound, move, and custom action fields", () => {
  const p = blank();
  p.scenes[0].objects[0].actions = [
    { type: "sound" },
    { type: "move" },
    { type: "custom" },
  ];
  assert.equal(validate(p).length, 3);
  for (const value of [null, [], { id: "demo", scenes: [null] }])
    assert.ok(validate(value).length);
  p.scenes[0].objects = [null];
  assert.match(validate(p).join(), /each object/);
});

test("item definitions keep custom settings and scripted use actions", () => {
  const p = blank();
  p.items = [{id:"tool",kind:"inventory",data:{charges:3},actions:[{type:"custom",id:"useTool",data:{range:250}}]}];
  assert.deepEqual(validate(p), []);
  const spec = sceneSpec(p.scenes[0], p.items);
  assert.match(spec, /<inventory><item/);
  assert.match(spec, /charges/);
  assert.match(spec, /range/);
  assert.match(spec, /type="custom" id="useTool"/);
});

test("bad item IDs and broken item actions stop the build", () => {
  const p = blank();
  p.items = [{id:"../outside",actions:[{type:"travel",room:"missing"}]}];
  assert.match(validate(p).join(), /Item IDs/);
  assert.match(validate(p).join(), /missing room/);
  p.items = [{id:"key"},{id:"key"}];
  assert.match(validate(p).join(), /unique/);
});
