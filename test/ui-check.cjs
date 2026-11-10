const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Workshop } = require("../lib/workshop.cjs");
const { blank } = require("../lib/model.cjs");
const { write } = require("../lib/files.cjs");
const root = path.resolve(__dirname, "..");
const base = path.join(root, ".cache/ui-check");
fs.mkdirSync(base, { recursive: true });
const dir = fs.mkdtempSync(path.join(base, "run-"));
fs.cpSync(path.join(root, "ui"), path.join(dir, "ui"), { recursive: true });
fs.cpSync(path.join(root, "templates"), path.join(dir, "templates"), {
  recursive: true,
});
const w = new Workshop(dir);
if (process.env.ISLANDENGINE_TEST_CLONE) {
  w.library = path.join(dir, "library");
  write(
    path.join(w.library, "framework/data/config.xml"),
    "<framework_config><islands><island><name>Train</name><islandMain>TrainMain</islandMain><clusterName>Mystery Train</clusterName></island></islands></framework_config>",
  );
  for (const name of [
    "framework.swf",
    "gameplay.swf",
    "scenes/islandTrain/sceneTrainMain.swf",
  ])
    write(path.join(w.library, name), "fixture");
  write(
    path.join(w.library, "game/data/scenes/carrot/island.xml"),
    "<island><name>24 Carrot</name><gameVersion>AS3</gameVersion><firstScene><scene>game.scenes.carrot.mainStreet.MainStreet</scene></firstScene></island>",
  );
  write(
    path.join(w.library, "game/data/scenes/carrot/mainStreet/scene.xml"),
    '<scene id="mainStreet"/>',
  );
}
const p = blank("uiCheck", "Editor check");
p.scenes.push({
  ...structuredClone(p.scenes[0]),
  id: "second",
  title: "Second",
});
p.scenes[1].objects[0].hideWhen = "old_flag";
if (!process.env.ISLANDENGINE_TEST_EMPTY) w.save(p);
write(path.join(w.dir(p.id), "src/extra/Rule.as"), "// first version");
let browser,
  timer,
  done = false;
const results = [];
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (error)
    results.push({ name: "Runner", passed: false, detail: String(error) });
  fs.writeFileSync(
    path.join(base, "results.json"),
    JSON.stringify(results, null, 2),
  );
  for (const r of results) console.log(JSON.stringify(r));
  if (browser?.pid)
    spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  w.close();
  process.exitCode = results.length && results.every((r) => r.passed) ? 0 : 1;
}
async function main() {
  const serve = w.serve.bind(w);
  w.serve = async (req, res) => {
    if (req.url === "/ui-probes.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(
        fs.readFileSync(
          path.join(
            __dirname,
            process.env.ISLANDENGINE_TEST_CLONE
              ? "ui-clone-probes.js"
              : process.env.ISLANDENGINE_TEST_EMPTY
                ? "ui-new-probes.js"
                : "ui-probes.js",
          ),
        ),
      );
      return;
    }
    if (req.url === "/__done") {
      if (req.headers["x-workshop-token"] !== w.token) {
        res.writeHead(403);
        res.end();
        return;
      }
      let body = "";
      for await (const part of req) body += part;
      results.push(...JSON.parse(body));
      res.end("{}");
      setImmediate(() => finish());
      return;
    }
    return serve(req, res);
  };
  const html = path.join(dir, "ui/index.html");
  fs.writeFileSync(
    html,
    fs
      .readFileSync(html, "utf8")
      .replace("</body>", '<script src="/ui-probes.js" defer></script></body>'),
  );
  const origin = await w.start(0);
  const log = fs.openSync(path.join(dir, "chrome.log"), "w");
  browser = spawn(
    process.env.ISLANDENGINE_TEST_CHROME ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--noerrdialogs",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      "--mute-audio",
      "--window-size=1280,900",
      "--user-data-dir=" + path.join(dir, "profile"),
      origin,
    ],
    { windowsHide: true, stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  browser.on("error", (e) => finish(e.message));
  browser.on("exit", (code) => {
    if (!done) finish("Browser exited: " + code);
  });
  timer = setTimeout(() => finish("UI checks timed out"), 45000);
}
main().catch((e) => finish(e.stack));
