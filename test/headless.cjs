const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { root, dir, project } = require("./runtime-check.cjs");
const { Workshop } = require("../lib/workshop.cjs");
const chrome =
  process.env.ISLANDENGINE_TEST_CHROME ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
let browser,
  workshop,
  timer,
  finished = false,
  reloaded = false,
  soundReported = false;
const results = [];
async function main() {
  if (!fs.existsSync(chrome))
    throw Error("Set ISLANDENGINE_TEST_CHROME to a Chrome executable.");
  const profile = fs.mkdtempSync(path.join(dir, "headless-"));
  workshop = new Workshop(root);
  workshop.index = () => {};
  workshop.preview = {
    project: project.id,
    first: "game.scenes.mechanicCheck.arrival.Arrival",
    out: path.join(dir, "build"),
  };
  const serve = workshop.serve.bind(workshop);
  workshop.serve = async (req, res) => {
    if (req.url === "/check.html") {
      const report = `<script>
      const reports=[];
      const send=(url,data)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Token':${JSON.stringify(workshop.token)}},body:JSON.stringify(data)});
      window.islandTest=(name,passed,detail)=>reports.push(send('/__result',{name,passed,detail}));
      window.islandTestsDone=()=>Promise.all(reports).then(()=>send('/__done',{})).then(r=>r.json()).then(r=>{if(r.reload)location.reload();});
      window.addEventListener('error',e=>send('/__result',{name:'Runtime error',passed:false,detail:e.message}));
      </script>`;
      res.setHeader("Content-Type", "text/html");
      res.end(
        fs
          .readFileSync(path.join(root, "ui/player.html"), "utf8")
          .replace("<head>", "<head>" + report),
      );
      return;
    }
    if (["/__result", "/__done"].includes(req.url)) {
      if (req.headers["x-test-token"] !== workshop.token) {
        res.writeHead(403);
        res.end();
        return;
      }
      let body = "";
      for await (const part of req) body += part;
      if (req.url === "/__result") {
        const row = JSON.parse(body);
        results.push(row);
        console.log(JSON.stringify(row));
      }
      if (req.url === "/__done" && !reloaded) {
        reloaded = true;
        res.end('{"reload":true}');
        return;
      }
      res.end("{}");
      if (req.url === "/__done") setImmediate(() => finish());
      return;
    }
    if (req.url.includes("/game/sound/effects/door_pushbar_open_02.mp3"))
      res.on("finish", () => {
        if (soundReported) return;
        soundReported = true;
        const row = {
          name: "sound file requested by native engine",
          passed: res.statusCode === 200,
        };
        results.push(row);
        console.log(JSON.stringify(row));
      });
    await serve(req, res);
  };
  const origin = await workshop.start(0);
  const log = fs.openSync(path.join(dir, "headless.log"), "w");
  browser = spawn(
    chrome,
    [
      "--headless=new",
      ...(process.env.ISLANDENGINE_DEBUG ? ["--remote-debugging-port=0"] : []),
      "--noerrdialogs",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--mute-audio",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=960,640",
      "--user-data-dir=" + profile,
      origin + "/check.html",
    ],
    { windowsHide: true, stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  if (process.env.ISLANDENGINE_DEBUG)
    (async () => {
      let port;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          port = fs
            .readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
            .split("\n")[0];
          break;
        } catch {}
      }
      const tabs = await (
        await fetch("http://127.0.0.1:" + port + "/json")
      ).json();
      const ws = new WebSocket(
        tabs.find((t) => t.type === "page").webSocketDebuggerUrl,
      );
      await new Promise((r) => (ws.onopen = r));
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.method === "Runtime.consoleAPICalled")
          console.log(
            "CONSOLE",
            JSON.stringify(d.params.args.map((a) => a.value || a.description)),
          );
        if (d.method === "Runtime.exceptionThrown")
          console.log("EXCEPTION", JSON.stringify(d.params));
      };
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    })().catch(console.error);

  browser.on("error", (error) => finish(error.message));
  browser.on("exit", (code) => {
    if (!finished)
      finish("Headless renderer exited before the checks finished: " + code);
  });
  try {
    os.setPriority(browser.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
  timer = setTimeout(() => finish("Runtime checks timed out"), 60000);
}
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (error) {
    results.push({ name: error, passed: false });
    console.error(error);
  }
  if (!soundReported)
    results.push({ name: "native sound file request", passed: false });
  fs.writeFileSync(
    path.join(dir, "headless-results.json"),
    JSON.stringify(results, null, 2),
  );
  if (browser?.pid) {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else browser.kill();
  }
  workshop?.close();
  process.exitCode = results.length && results.every((r) => r.passed) ? 0 : 1;
}
main().catch((error) => finish(error.message));
