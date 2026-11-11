// Real compiler and library, disposable projects, isolated headless profile.
const fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Workshop } = require("../lib/workshop.cjs");
const root = path.resolve(__dirname, "..");
const artCheck = process.env.ISLANDENGINE_ART_CHECK === "1";
const liveCheck = process.env.ISLANDENGINE_LIVE_CHECK;
const base = path.join(root, liveCheck ? ".cache/live-check-"+liveCheck : artCheck ? ".cache/art-check" : ".cache/author-check");
fs.mkdirSync(base, { recursive: true });
const dir = fs.mkdtempSync(path.join(base, "run-"));
const w = new Workshop(root);
w.dir = (id) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) throw Error("Invalid project ID");
  return path.join(dir, "projects", id);
};
// Never enumerate or open the user's projects.
w.status = () => ({ library: w.library, assets: w.catalog.length, logs: w.logs, busy: w.busy,
  projects: fs.existsSync(path.join(dir, "projects")) ? fs.readdirSync(path.join(dir, "projects")).map((id) => ({ id, title: w.project(id).title })) : [] });
w.export = async (id) => { await w.build(id); if(w.project(id).liveEdits?.length)await w.prepareLiveEdit(w.project(id)); return w.pack(id, path.join(dir, "exports")); };
let browser, timer, done = false;
const results = [];
async function screenshot(name) {
  const port = fs.readFileSync(path.join(dir, "profile/DevToolsActivePort"), "utf8").split("\n")[0];
  const tabs = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
    ws.onerror = reject;
    ws.onmessage = (event) => { const r = JSON.parse(event.data); if (r.id !== 1) return; ws.close(); if (r.error) return reject(Error(r.error.message)); fs.writeFileSync(path.join(dir, name + ".png"), Buffer.from(r.result.data, "base64")); resolve(); };
  });
}
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (error) results.push({ name: "Author workflow", passed: false, detail: String(error) });
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(base, "latest.json"), JSON.stringify({ dir, results }, null, 2));
  results.forEach((r) => console.log(JSON.stringify(r)));
  console.log("Artifacts: " + dir);
  if (browser?.pid) spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  w.close();
  process.exitCode = results.length && results.every((r) => r.passed) ? 0 : 1;
}
async function main() {
  const serve = w.serve.bind(w);
  w.serve = async (req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(fs.readFileSync(path.join(root, "ui/index.html"), "utf8").replace("</body>", '<script src="/author-probes.js" defer></script></body>'));
      return;
    }
    if (req.url === "/author-probes.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(__dirname, liveCheck ? "live-probes.js" : artCheck ? "art-probes.js" : "author-probes.js")));
      return;
    }
    if (req.url === "/author-runtime") { res.end(fs.readFileSync(path.join(__dirname, "author-probes.as.txt"))); return; }
    if (req.url === "/live-mode") { res.end(liveCheck || ""); return; }
    if (req.url === "/__screenshot") {
      if (req.headers["x-workshop-token"] !== w.token) { res.writeHead(403); res.end(); return; }
      await screenshot(w.preview ? "play" : "editor"); res.end("{}"); return;
    }
    if (req.url === "/__done") {
      if (req.headers["x-workshop-token"] !== w.token) { res.writeHead(403); res.end(); return; }
      let body = "";
      for await (const chunk of req) body += chunk;
      results.push(...JSON.parse(body)); res.end("{}"); setImmediate(() => finish()); return;
    }
    return serve(req, res);
  };
  const origin = await w.start(0);
  const log = fs.openSync(path.join(dir, "chrome.log"), "w");
  browser = spawn(process.env.ISLANDENGINE_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--window-size="+(process.env.ISLANDENGINE_TEST_SIZE||"1280,900"), "--user-data-dir=" + path.join(dir, "profile"), origin,
  ], { windowsHide: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  browser.on("error", finish);
  browser.on("exit", (code) => { if (!done) finish("Browser exited: " + code); });
  timer = setTimeout(() => finish("Timed out"), 240000);
}
main().catch(finish);
