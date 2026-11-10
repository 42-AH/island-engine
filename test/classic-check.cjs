const fs = require("node:fs"),
  path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Workshop } = require("../lib/workshop.cjs");
const { run } = require("../lib/build.cjs");
const { write } = require("../lib/files.cjs");
const { bootConfig } = require("../lib/islands.cjs");
const as3 = process.env.ISLANDENGINE_TEST_AS3 === "1";
const root = path.resolve(__dirname, ".."),
  config = require("../local.json");
const dir = path.join(root, ".cache/classic-check");
fs.mkdirSync(dir, { recursive: true });
const runDir = fs.mkdtempSync(path.join(dir, "run-"));
const w = new Workshop(root);
w.index = () => {};
w.dir = (id) => path.join(runDir, "projects", id);
let browser,
  timer,
  finished = false;
const results = [],
  missing = [];
let projectId = "classicCheck";
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (error)
    results.push({
      name: "Classic player",
      passed: false,
      detail: String(error),
    });
  write(
    path.join(dir, as3 ? "as3-results.json" : "results.json"),
    JSON.stringify({ results, missing }, null, 2),
  );
  results.forEach((r) => console.log(JSON.stringify(r)));
  if (browser?.pid)
    spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  w.close();
  process.exitCode = results.length && results.every((r) => r.passed) ? 0 : 1;
}
async function main() {
  if (!fs.existsSync(w.dir("classicCheck")))
    w.importIsland(
      as3 ? "carrot" : "Train",
      "classicCheck",
      as3 ? "AS3" : "AS2",
    );
  if (as3) write(path.join(w.dir("classicCheck"), "src/extra/CopyRules.as"),
    'package custom { public class CopyRules { public static function works():Boolean { return true; } } }');
  await w.build("classicCheck");
  if (!as3)
    for (const name of ["TrainMain", "CoachCar"]) {
      const swf = "scenes/islandTrain/scene" + name + ".swf";
      const files = await w.decompileSwf("classicCheck", swf);
      const first = files.find((f) =>
        f.endsWith("/scripts/frame_1/DoAction.as"),
      );
      if (!first) throw Error("Missing scene script: " + name);
      const file = path.join(w.dir("classicCheck"), first);
      fs.appendFileSync(
        file,
        `
var checkTicks = 0;
var checkTimer = setInterval(function() {
  checkTicks++;
  var c = _root.camera.scene.char;
  if(c.loadingFinished == true || checkTicks > 25) {
    clearInterval(checkTimer);
    _root.navBar.btnHudClosed.onRelease();
    flash.external.ExternalInterface.call("classicResult", c.loadingFinished == true && !_root.navBar.btnHome._visible && !_root.navBar.btnFriends._visible && !_root.navBar.btnRealms._visible && _root.navBar.btnInventory._visible && !_root.popupBack._visible && (c.avatar.FunBrain_so.data.gender == 0 || c.avatar.FunBrain_so.data.gender == 1), String(_root.desc), String(c._x), String(c._y), String(_root.camera.scene.roomName));
  }
}, 1000);`,
      );
    }
  if (!as3) {
    await w.call("copyProject", { project: "classicCheck", id: "copiedClassic", title: "Copied edited classic" });
    projectId = "copiedClassic";
  }
  await w.build(projectId);
  if (as3) {
    const source = path.join(runDir, "EditorCheck.as");
    write(
      source,
      `package game.scenes.carrot.mainStreet {
     import flash.external.ExternalInterface;
     import engine.components.Spatial;
     import game.data.TimedEvent;
     import game.util.SceneUtil;
     public class EditorCheck extends MainStreet {
       public function EditorCheck(){super();}
       override public function loaded():void {
         super.loaded();
         SceneUtil.addTimedEvent(this,new TimedEvent(3,1,report));
       }
       private function report():void {
         var position:Spatial=player.get(Spatial);
         ExternalInterface.call("classicResult",position!=null && custom.CopyRules.works(),"mainStreet",String(position.x),String(position.y),"24 Carrot with custom helper");
       }
     }
   }`,
    );
    const shell = path.join(w.preview.out, "game/Shell.swf"),
      compiled = path.join(runDir, "checked.swf");
    await run(config.java, [
      "-Djava.awt.headless=true",
      "-cp",
      [
        path.join(root, "tools/vendor/compiler"),
        path.resolve(root, config.ffdec),
        path.join(root, "tools/vendor/lib/*"),
      ].join(path.delimiter),
      "AppendAs3Classes",
      shell,
      compiled,
      source,
    ]);
    fs.copyFileSync(compiled, shell);
    w.preview.first = "game.scenes.carrot.mainStreet.EditorCheck";
    const settings = path.join(
      w.preview.out,
      "game/data/game/browser/game.xml",
    );
    write(
      settings,
      bootConfig(fs.readFileSync(settings, "utf8"), w.preview.first, "carrot"),
    );
  }
  const serve = w.serve.bind(w);
  w.serve = async (req, res) => {
    if (req.url === "/classic-check.html") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        fs
          .readFileSync(path.join(root, "ui/player.html"), "utf8")
          .replace(
            "<head>",
            `<head><script>window.classicResult=(loaded,room,x,y,title)=>fetch('/__result',{method:'POST',headers:{'X-Test-Token':${JSON.stringify(w.token)}},body:JSON.stringify({name:'Imported scene and character loaded',passed:loaded&&['TrainMain','CoachCar','mainStreet'].includes(room)&&Number.isFinite(Number(x))&&Number.isFinite(Number(y)),detail:{room,x,y,title}})}).then(()=>{if(room==='TrainMain')window.POSTToBase('CoachCar','Train');else fetch('/__done',{method:'POST',headers:{'X-Test-Token':${JSON.stringify(w.token)}}});});</script>`,
          ),
      );
      return;
    }
    if (req.url === "/__done" || req.url === "/__result") {
      if (req.headers["x-test-token"] !== w.token) {
        res.writeHead(403);
        res.end();
        return;
      }
      let body = "";
      for await (const part of req) body += part;
      if (body) results.push(JSON.parse(body));
      res.end("{}");
      if (req.url === "/__done") setImmediate(() => finish());
      return;
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) missing.push(req.url);
    });
    await serve(req, res);
  };
  const origin = await w.start(0),
    profile = fs.mkdtempSync(path.join(dir, "profile-")),
    log = fs.openSync(path.join(dir, "browser.log"), "w");
  browser = spawn(
    process.env.ISLANDENGINE_TEST_CHROME ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--noerrdialogs",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-gpu",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--mute-audio",
      "--user-data-dir=" + profile,
      origin + "/classic-check.html",
    ],
    { windowsHide: true, stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  browser.on("error", (e) => finish(e.message));
  browser.on("exit", (code) => {
    if (!finished) finish("Browser exited " + code);
  });
  timer = setTimeout(() => finish("Timed out loading AS2 scene"), 60000);
}
main().catch((e) => finish(e.stack));
