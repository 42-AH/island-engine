const { app, BrowserWindow, session, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { Workshop } = require("./lib/workshop.cjs");
let main, workshop;
// Checks run with a separate profile so they never touch the user's settings.
if (process.env.ISLANDENGINE_PROFILE) app.setPath("userData", path.resolve(process.env.ISLANDENGINE_PROFILE));
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
      if (method === "showFolder") {
        // Only folders the app wrote, such as exports, are opened here.
        const folder = path.resolve(String(args?.path || ""));
        const exports = path.join(__dirname, "exports") + path.sep;
        if (!folder.startsWith(exports)) throw Error("Only export folders can be opened.");
        const error = await shell.openPath(folder);
        if (error) throw Error(error);
        return true;
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
    // Ask before closing with unsaved work. The editor knows what is unsaved,
    // so the check runs in the page.
    let closing = false;
    main.on("close", async (event) => {
      if (closing) return;
      event.preventDefault();
      let unsaved = false;
      try {
        // A frozen page must not keep the window open forever.
        unsaved = await Promise.race([
          main.webContents.executeJavaScript("!!window.hasUnsavedWork?.()"),
          new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
      } catch {
        unsaved = false;
      }
      if (unsaved) {
        const { response } = await dialog.showMessageBox(main, {
          type: "warning",
          buttons: ["Save", "Don't save", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          title: "islandengine",
          message: "Save your changes before closing?",
          detail: "Unsaved changes are lost if you don't save.",
        });
        if (response === 2) return;
        if (response === 0) {
          const error = await main.webContents.executeJavaScript(
            "window.saveCurrent().then(() => '', (e) => e.message)",
          );
          if (error) {
            dialog.showErrorBox("Could not save", error);
            return;
          }
        }
      }
      closing = true;
      main.close();
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
