const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { write } = require("../lib/files.cjs");
const { islandInfo, bootConfig, gameFileFallback } = require("../lib/islands.cjs");
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
      liveEditRuntime: async (_root, _config, source) => source,
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

test("live edits validate values, replace one object, and reset without changing other edits", async (t) => {
  const {w}=fixture(t);
  await w.call("create",{id:"liveTest",title:"Live test"});
  const edit={room:"game.scenes.liveTest.arrival::Arrival",path:"stage/box",values:{x:40,alpha:0.5}};
  await w.call("liveEdit",{project:"liveTest",edit});
  await w.call("liveEdit",{project:"liveTest",edit:{...edit,path:"stage/other",values:{visible:false}}});
  await w.call("liveEdit",{project:"liveTest",edit:{...edit,values:{x:90}}});
  assert.equal(w.project("liveTest").liveEdits.length,2);
  assert.deepEqual(w.project("liveTest").liveEdits.find(r=>r.path===edit.path).values,{x:90});
  await assert.rejects(w.call("liveEdit",{project:"liveTest",edit:{...edit,values:{alpha:2}}}),/Invalid alpha/);
  await assert.rejects(w.call("liveEdit",{project:"liveTest",edit:{...edit,values:{script:"run"}}}),/cannot be changed/);
  await w.call("liveEdit",{project:"liveTest",edit:{...edit,values:{}}});
  assert.equal(w.project("liveTest").liveEdits.length,1);
  const copied=await w.call("copyProject",{project:"liveTest",id:"liveCopy"});
  assert.equal(copied.liveEdits[0].room,"game.scenes.liveCopy.arrival::Arrival");
  assert.equal(w.project("liveTest").liveEdits[0].room,edit.room);
});

test("inspector compilation failure leaves copied islands playable", async (t) => {
  const {w}=fixture(t);
  w.importIsland("Train","liveFail","AS2");
  await w.build("liveFail");
  w.liveEditRuntime=async()=>{throw Error("Custom toolbar");};
  await w.call("play",{project:"liveFail"});
  assert.equal(w.preview.inspectorError,"Custom toolbar");
  assert.equal(w.busy,false);
  assert.equal(w.preview.first,"TrainMain");
});

test("exports carry the edited runtime and rules without enabling the inspector", async (t) => {
  const {w,library}=fixture(t);
  w.importIsland("carrot","liveExport","AS3");
  const edit={room:"game.scenes.carrot.mainStreet::MainStreet",path:"stage/sign",values:{text:"Welcome"}};
  await w.call("liveEdit",{project:"liveExport",edit});
  await w.build("liveExport");
  for(const file of ["runtime/electron.exe","ui/player.html","templates/player.cjs"])write(path.join(w.root,file),"fixture");
  write(path.join(library,"ruffle/ruffle.js"),"fixture");
  const patched=path.join(w.root,"patched.swf");write(patched,"edited runtime");
  w.preview.liveRuntime=patched;w.preview.liveFile="game/Shell.swf";
  const dest=await w.pack("liveExport",path.join(w.root,"exports"));
  const app=path.join(dest,"resources/app"),entry=JSON.parse(fs.readFileSync(path.join(app,"entry.json")));
  assert.deepEqual(entry.liveEdits,[edit]);
  assert.equal(entry.inspector,undefined);
  assert.equal(fs.readFileSync(path.join(app,"library/game/Shell.swf"),"utf8"),"edited runtime");
  assert.equal(fs.readFileSync(path.join(library,"game/Shell.swf"),"utf8"),"shell fixture");
});

test("classic inventory paths requested from AS3 islands map to library files", () => {
  assert.equal(gameFileFallback("game/char.swf"), "char.swf");
  assert.equal(gameFileFallback("game/popups/inventory.swf"), "popups/inventory.swf");
  assert.equal(gameFileFallback("sound/effects/ui_open_bag.mp3"), "game/sound/effects/ui_open_bag.mp3");
  assert.equal(gameFileFallback("game/data/items/a.xml"), null);
  assert.equal(gameFileFallback("game/game/Shell.swf"), null);
  assert.equal(gameFileFallback("game/local.json"), null);
  assert.equal(gameFileFallback("char.swf"), null);
});

test("the editor serves the classic inventory to AS3 islands", async (t) => {
  const {w,library}=fixture(t);
  write(path.join(library,"char.swf"),"char");
  write(path.join(library,"popups/inventory.swf"),"popup");
  write(path.join(library,"game/sound/effects/ui_open_bag.mp3"),"bag");
  write(path.join(library,"game/hud.swf"),"own game file");
  w.index=()=>{};
  await w.start(0);
  t.after(()=>w.server.close());
  const get=async(p)=>{const r=await fetch(w.origin+p);return [r.status,await r.text()];};
  assert.deepEqual(await get("/game/char.swf"),[200,"char"]);
  assert.deepEqual(await get("/game/popups/inventory.swf"),[200,"popup"]);
  assert.deepEqual(await get("/sound/effects/ui_open_bag.mp3"),[200,"bag"]);
  assert.deepEqual(await get("/game/hud.swf"),[200,"own game file"]);
  assert.equal((await get("/game/missing.swf"))[0],404);
  assert.equal((await get("/game/local.json"))[0],404);
});

test("AS3 exports include the classic inventory files", async (t) => {
  const {w,library}=fixture(t);
  w.importIsland("carrot","invExport","AS3");
  await w.build("invExport");
  for(const file of ["runtime/electron.exe","ui/player.html","templates/player.cjs"])write(path.join(w.root,file),"fixture");
  write(path.join(library,"ruffle/ruffle.js"),"fixture");
  write(path.join(library,"inventory_shell.swf"),"shell");
  write(path.join(library,"char.swf"),"char");
  write(path.join(library,"popups/inventory.swf"),"popup");
  write(path.join(library,"items/as3/as3card.swf"),"card");
  write(path.join(library,"items/item100.swf"),"classic card");
  const app=path.join(await w.pack("invExport",path.join(w.root,"exports")),"resources/app/library");
  for(const file of ["inventory_shell.swf","char.swf","popups/inventory.swf","items/as3/as3card.swf"])
    assert.ok(fs.existsSync(path.join(app,file)),file);
  assert.equal(fs.existsSync(path.join(app,"framework")),false);
  assert.equal(fs.existsSync(path.join(app,"items/item100.swf")),false);
});
