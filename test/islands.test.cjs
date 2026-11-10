const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { write } = require("../lib/files.cjs");
const { islandInfo, bootConfig } = require("../lib/islands.cjs");
const { Workshop } = require("../lib/workshop.cjs");
function fixture(t) {
  const base = path.resolve(__dirname, "../.cache/islands-test");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "run-"));
  t.after(() => {
    if (!root.startsWith(base + path.sep)) throw Error("Bad test path");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const library = path.join(root, "library");
  write(
    path.join(root, "local.json"),
    JSON.stringify({ library, java: "unused", ffdec: "unused" }),
  );
  write(
    path.join(library, "framework/data/config.xml"),
    "<framework_config><islands><island><name>Train</name><islandMain>TrainMain</islandMain><clusterName>Mystery Train</clusterName></island></islands></framework_config>",
  );
  for (const file of [
    "framework.swf",
    "gameplay.swf",
    "scenes/islandTrain/sceneTrainMain.swf",
  ])
    write(path.join(library, file), "fixture");
  write(
    path.join(library, "game/data/scenes/train/island.xml"),
    "<island><name>Mystery Train</name><gameVersion>AS2</gameVersion><firstScene><!-- <scene>game.scenes.train.mainStreet.MainStreet</scene> --><scene>TrainMain</scene></firstScene></island>",
  );
  write(
    path.join(library, "game/data/scenes/carrot/island.xml"),
    "<island><name>24 Carrot</name><gameVersion>AS3</gameVersion><firstScene><scene>game.scenes.carrot.mainStreet.MainStreet</scene></firstScene></island>",
  );
  write(
    path.join(library, "game/data/scenes/carrot/mainStreet/scene.xml"),
    "<scene/>",
  );
  write(path.join(library, "game/Shell.swf"), "shell fixture");
  write(
    path.join(library, "game/data/game/browser/game.xml"),
    "<game><islands>carrot</islands><firstScene>home</firstScene><defaultScene>home</defaultScene><overrideScene/></game>",
  );
  return {
    w: new Workshop(root, {
      nativeUi: async (_root, _config, source) => source,
    }),
    library,
  };
}
test("AS2 entry ignores the old AS3 class in XML comments", (t) => {
  const { library } = fixture(t);
  const info = islandInfo(library, "train");
  assert.equal(info.entry, "TrainMain");
  assert.equal(info.version, "AS2");
  assert.equal(info.supported, true);
});
test("copy dialog lists installed islands for the chosen engine", async (t) => {
  const { w } = fixture(t);
  assert.deepEqual(
    (await w.call("islands", { version: "AS2" })).map((i) => i.value),
    ["Train"],
  );
  assert.deepEqual(
    (await w.call("islands", { version: "AS3" })).map((i) => i.value),
    ["carrot"],
  );
});
test("AS3 copies start in their own scene, not the home screen", async (t) => {
  const { w, library } = fixture(t);
  w.importIsland("carrot", "copyCarrot", "AS3");
  await w.build("copyCarrot");
  const xml = fs.readFileSync(
    path.join(w.preview.out, "game/data/game/browser/game.xml"),
    "utf8",
  );
  for (const tag of ["firstScene", "defaultScene", "overrideScene"])
    assert.ok(
      xml.includes(
        "<" + tag + ">game.scenes.carrot.mainStreet.MainStreet</" + tag + ">",
      ),
    );
  assert.ok(
    fs
      .readFileSync(
        path.join(library, "game/data/game/browser/game.xml"),
        "utf8",
      )
      .includes("<defaultScene>home</defaultScene>"),
  );
  await w.call("play", { project: "copyCarrot" });
  assert.equal(w.preview.first, "game.scenes.carrot.mainStreet.MainStreet");
});
test("AS2 copies preserve source files and keep their engine at Play", async (t) => {
  const { w, library } = fixture(t);
  w.importIsland("Train", "copyTrain", "AS2");
  await w.build("copyTrain");
  await w.call("play", { project: "copyTrain" });
  assert.equal(w.preview.version, "AS2");
  assert.equal(w.preview.first, "TrainMain");
  assert.equal(
    (await w.call("rooms", { project: "copyTrain" }))[0].title,
    "TrainMain",
  );
  write(
    path.join(w.preview.out, "scenes/islandTrain/sceneTrainMain.swf"),
    "edited",
  );
  assert.equal(
    fs.readFileSync(
      path.join(library, "scenes/islandTrain/sceneTrainMain.swf"),
      "utf8",
    ),
    "fixture",
  );
});
test("boot configuration also handles missing and empty entry tags", () => {
  const first = "game.scenes.example.arrival.Arrival";
  const result = bootConfig(
    "<game><islands>carrot</islands><overrideScene/></game>",
    first,
    "example",
  );
  assert.equal((result.match(new RegExp(first, "g")) || []).length, 3);
  assert.match(result, /<islands>example,carrot<\/islands>/);
});
