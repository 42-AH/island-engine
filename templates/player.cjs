const { app, BrowserWindow, session, dialog } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const entry = JSON.parse(fs.readFileSync(path.join(__dirname, "entry.json")));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".swf": "application/x-shockwave-flash",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
};
let server, win;
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (win) {
    win.show();
    win.focus();
  }
});
app
  .whenReady()
  .then(async () => {
    server = http.createServer((req, res) => {
      try {
        if (req.headers.host !== "127.0.0.1:18843") {
          res.writeHead(403);
          res.end();
          return;
        }
        const url = new URL(req.url, "http://127.0.0.1:18843"),
          name = decodeURIComponent(url.pathname);
        if (name === "/preview.json") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(entry));
          return;
        }
        if (name.endsWith(".php")) {
          res.end("<response><status>success</status></response>");
          return;
        }
        const isGameFile = (n) =>
          n.startsWith("/game/") ||
          n.startsWith("/ruffle/") ||
          [
            "scenes",
            "framework",
            "avatarParts",
            "popups",
            "items",
            "images",
            "externalAssets",
            "creatorClips",
            "games",
            "brain",
          ].some((dir) => n.startsWith("/" + dir + "/")) ||
          /^\/[\w-]+\.swf$/.test(n);
        const find = (n) => {
          const root = path.join(__dirname, isGameFile(n) ? "library" : "ui");
          const f = path.resolve(root, "." + (n === "/" ? "/player.html" : n));
          return f.startsWith(root + path.sep) &&
            fs.existsSync(f) &&
            fs.statSync(f).isFile()
            ? f
            : null;
        };
        // AS3 islands run with Ruffle's base set to /game/. The classic inventory
        // asks for root files under /game/ and for /game/sound files without it.
        const rest = name.startsWith("/game/") ? name.slice(5) : null;
        const fallback =
          rest && !rest.startsWith("/game/") && isGameFile(rest)
            ? rest
            : name.startsWith("/sound/")
              ? "/game" + name
              : null;
        const file = find(name) || (fallback && find(fallback));
        if (!file) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.setHeader(
          "Content-Type",
          mime[path.extname(file)] || "application/octet-stream",
        );
        fs.createReadStream(file).pipe(res);
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(18843, "127.0.0.1", resolve);
    });
    const origin = "http://127.0.0.1:18843";
    session.defaultSession.webRequest.onBeforeRequest((d, done) => {
      const u = new URL(d.url);
      done({
        cancel:
          u.origin !== origin &&
          !["data:", "blob:", "devtools:"].includes(u.protocol),
      });
    });
    session.defaultSession.setPermissionRequestHandler((_w, _p, done) =>
      done(false),
    );
    win = new BrowserWindow({
      width: 1100,
      height: 780,
      title: entry.title,
      autoHideMenuBar: true,
      backgroundColor: "#132733",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, u) => {
      if (new URL(u).origin !== origin) e.preventDefault();
    });
    win.loadURL(origin + "/");
  })
  .catch((error) => {
    dialog.showErrorBox(entry.title, error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => server?.close());
