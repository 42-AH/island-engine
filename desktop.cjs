const { app, BrowserWindow, session, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { Workshop } = require("./lib/workshop.cjs");
let main, workshop;
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (main) {
    main.show();
    main.focus();
  }
});
app
  .whenReady()
  .then(async () => {
    workshop = new Workshop(__dirname);
    await workshop.start(18842);
    const origin = workshop.origin;
    session.defaultSession.webRequest.onBeforeRequest((details, done) => {
      const url = new URL(details.url);
      done({
        cancel: !(
          ["data:", "blob:", "devtools:"].includes(url.protocol) ||
          url.origin === origin
        ),
      });
    });
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, done) => done(false),
    );
    ipcMain.handle("workshop", async (event, method, args) => {
      if (
        event.sender !== main.webContents ||
        event.senderFrame.url !== origin + "/"
      )
        throw Error("Unknown window");
      if (method === "chooseLibrary") {
        const result = await dialog.showOpenDialog(main, {
          title: "Choose the game asset folder",
          properties: ["openDirectory"],
        });
        return result.canceled
          ? null
          : workshop.setLibrary(result.filePaths[0]);
      }
      if (method === "importArt") {
        const result = await dialog.showOpenDialog(main, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "Art and audio",
              extensions: ["png", "jpg", "jpeg", "swf", "mp3"],
            },
          ],
        });
        return result.canceled
          ? []
          : workshop.importArt(args.project, result.filePaths);
      }
      return workshop.call(method, args || {});
    });
    main = new BrowserWindow({
      width: 1510,
      height: 960,
      minWidth: 1000,
      minHeight: 680,
      title: "islandengine",
      backgroundColor: "#171b22",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    main.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    main.loadURL(origin + "/");
  })
  .catch((error) => {
    dialog.showErrorBox("islandengine", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => workshop?.close());
