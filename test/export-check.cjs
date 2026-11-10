// Run only the disposable export produced by author-check.cjs.
const fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const latest = JSON.parse(fs.readFileSync(path.join(root, ".cache/author-check/latest.json")));
const exportResult = latest.results.find((r) => r.id === "standalone-export" && r.passed);
if (!exportResult || !path.resolve(exportResult.detail).startsWith(path.resolve(latest.dir) + path.sep)) throw Error("Run author-check first.");
const folder = exportResult.detail;
const html = path.join(folder, "resources/app/ui/player.html");
const original = fs.readFileSync(html, "utf8");
let child, ws, sequence = 0;
const pending = new Map(), results = [];
const wait = async (fn, ms = 60000) => { const end = Date.now() + ms; while (!await fn()) { if (Date.now() > end) throw Error("Export check timed out"); await new Promise((r) => setTimeout(r, 100)); } };
function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function main() {
  fs.writeFileSync(html, original.replace("<head>", "<head><script>window.authorResults=[];window.authorResult=(name,passed)=>authorResults.push({name,passed});window.authorDone=false;</script>"));
  let debugPort;
  const log = fs.createWriteStream(path.join(latest.dir, "export-player.log"));
  child = spawn(path.join(folder, "islandengine.exe"), ["--remote-debugging-port=0", "--user-data-dir=" + path.join(latest.dir, "export-profile"), "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"], { cwd: folder, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => log.write(b));
  child.stderr.on("data", (b) => { log.write(b); const m = String(b).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) debugPort = m[1]; });
  let exited;
  child.on("exit", (code) => { exited = code; });
  await wait(() => { if (exited !== undefined) throw Error("Export exited: " + exited); return debugPort; }, 15000);
  const tabs = await (await fetch("http://127.0.0.1:" + debugPort + "/json")).json();
  ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => { const r = JSON.parse(event.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result); };
  await wait(() => evaluate("window.authorDone === true"));
  results.push(...await evaluate("window.authorResults"));
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(latest.dir, "export-play.png"), Buffer.from(shot.data, "base64"));
  await cdp("Page.reload");
  await wait(() => evaluate("window.authorDone === true && window.authorResults.some(r => r.name.includes('survive restart'))"));
  results.push(...await evaluate("window.authorResults"));
  results.push({ name: "Standalone exported app completes and resumes offline", passed: results.length >= 8 && results.every((r) => r.passed) });
}
main().catch((e) => results.push({ name: "Standalone export", passed: false, detail: e.stack })).finally(() => {
  ws?.close();
  if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  fs.writeFileSync(html, original);
  fs.writeFileSync(path.join(latest.dir, "export-results.json"), JSON.stringify(results, null, 2));
  results.forEach((r) => console.log(JSON.stringify(r)));
  process.exitCode = results.length && results.every((r) => r.passed) ? 0 : 1;
});
