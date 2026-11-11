const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto");
const { inside, write, json, walk } = require("./files.cjs");
const { blank, validate, identifier, className } = require("./model.cjs");
const { build, run, sourceFiles } = require("./build.cjs");
const { nativeUi } = require("./native-ui.cjs");
const { liveEditRuntime, validateEdit } = require("./live-edit.cjs");
const {
  islandInfo,
  classicIslands,
  bootConfig,
  classicFolders,
  isGameFile,
} = require("./islands.cjs");
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
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};
class Workshop {
  constructor(root, options = {}) {
    this.nativeUi = options.nativeUi || nativeUi;
    this.liveEditRuntime = options.liveEditRuntime || liveEditRuntime;
    this.root = root;
    this.config = json(path.join(root, "local.json"), {});
    this.library = this.config.library;
    this.catalog = [];
    this.logs = [];
    this.busy = false;
    this.preview = null;
    this.token = crypto.randomBytes(24).toString("hex");
  }
  async start(port = 0) {
    if (this.library) this.index();
    this.server = http.createServer((req, res) =>
      this.serve(req, res).catch((e) => {
        res.statusCode = 400;
        res.end(e.message);
      }),
    );
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", resolve);
    });
    this.origin = "http://127.0.0.1:" + this.server.address().port;
    return this.origin;
  }
  close() {
    this.server?.close();
  }
  index() {
    this.catalog = walk(this.library)
      .filter(
        (p) =>
          /\.(swf|png|jpe?g|svg|mp3|ogg|wav|xml)$/i.test(p) &&
          !p.startsWith("admin/"),
      )
      .map((p) => ({
        path: p,
        name: path.basename(p),
        type: path.extname(p).slice(1),
        island: (p.match(/(?:data|assets)\/scenes\/([^/]+)/) || [])[1] || "",
      }));
    const { ArtLibrary } = require("./art.cjs");
    this.art = new ArtLibrary(this.root, this.library, this.config);
  }
  setLibrary(folder) {
    if (!fs.existsSync(path.join(folder, "game/Shell.swf")))
      throw Error("Choose the public folder containing game/Shell.swf.");
    this.library = folder;
    this.config.library = folder;
    write(
      path.join(this.root, "local.json"),
      JSON.stringify(this.config, null, 2),
    );
    this.index();
    return this.status();
  }
  dir(id) {
    if (!identifier.test(id)) throw Error("Invalid project ID");
    return inside(path.join(this.root, "projects"), id);
  }
  project(id) {
    return json(path.join(this.dir(id), "island.json"));
  }
  status() {
    return {
      library: this.library || "",
      assets: this.catalog.length,
      artSymbols: this.art?.rows.length || 0,
      artProgress: this.art?.progress,
      unreadableArt: this.art?.errors || [],
      projects: fs.existsSync(path.join(this.root, "projects"))
        ? fs
            .readdirSync(path.join(this.root, "projects"))
            .filter((id) =>
              fs.existsSync(path.join(this.dir(id), "island.json")),
            )
            .map((id) => {
              const p = this.project(id);
              return { id, title: p.title, mode: p.mode || "native" };
            })
        : [],
      busy: this.busy,
      logs: this.logs.slice(-150),
      preview: this.preview,
    };
  }
  async call(method, a) {
    switch (method) {
      case "status":
        return this.status();
      case "catalog": {
        let rows = [...this.catalog, ...(this.art?.rows || [])].filter(
          (r) =>
            (!a.query ||
              (r.path + " " + r.name + " " + (r.symbol || ""))
                .toLowerCase()
                .includes(a.query.toLowerCase())) &&
            (!a.type ||
              (a.type === "art"
                ? /^(shape|sprite|image|button|morphshape|text|font|png|jpg|jpeg|svg)$/.test(
                    r.type,
                  )
                : r.type === a.type)) &&
            (!a.island || r.island === a.island),
        );
        return {
          total: rows.length,
          rows: rows.slice(a.offset || 0, (a.offset || 0) + 150),
        };
      }
      case "scanArt":
        return this.art.scan(
          this.catalog.filter((r) => r.type === "swf").map((r) => r.path),
        );
      case "useArt": {
        const source = await this.art.prepare(a.path, a.symbol);
        const hash = crypto
          .createHash("sha256")
          .update(a.path + "|" + (a.symbol ?? "file"))
          .digest("hex")
          .slice(0, 10);
        const name =
          path.basename(a.path, ".swf") + "-" + hash + path.extname(source);
        const target = inside(path.join(this.dir(a.project), "assets"), name);
        if (!fs.existsSync(target)) write(target, fs.readFileSync(source));
        return { asset: name };
      }
      case "islands": {
        if (a.version === "AS2")
          return classicIslands(this.library)
            .filter((i) => i.supported)
            .map((i) => ({ value: i.id, label: i.title }))
            .sort((a, b) => a.label.localeCompare(b.label));
        const folder = path.join(this.library, "game/data/scenes");
        return fs
          .readdirSync(folder, { withFileTypes: true })
          .filter((f) => f.isDirectory())
          .flatMap((f) => {
            try {
              const info = islandInfo(this.library, f.name);
              return info.supported && info.version === "AS3"
                ? [{ value: info.id, label: info.title }]
                : [];
            } catch {
              return [];
            }
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      }
      case "create": {
        if (!identifier.test(a.id))
          throw Error(
            "Use letters, numbers and underscores, starting with a letter.",
          );
        if (fs.existsSync(this.dir(a.id)))
          throw Error("That project already exists.");
        const p = blank(a.id, a.title);
        this.save(p);
        return p;
      }
      case "open":
        return this.project(a.id);
      case "copyProject": {
        const source = this.dir(a.project), destination = this.dir(a.id);
        if (fs.existsSync(destination)) throw Error("That project already exists.");
        const p = structuredClone(this.project(a.project));
        if (!p) throw Error("Open a saved island first.");
        const baselines = json(path.join(source, "as2-sources.json"), [])
          .filter((record) => record.original)
          .map((record) => ({ file: record.original, bytes: fs.readFileSync(inside(source, record.original)) }));
        if(p.mode!=="existing")for(const edit of p.liveEdits||[]) {
          const prefix="game.scenes."+p.id+".";
          if(edit.room.startsWith(prefix))edit.room="game.scenes."+a.id+"."+edit.room.slice(prefix.length);
        }
        p.id = a.id;
        p.title = a.title?.trim() || p.title + " copy";
        fs.cpSync(source, destination, { recursive: true, filter: (file) => {
          const relative = path.relative(source, file).replaceAll("\\", "/");
          return !["build", "generated", ".history", ".cache"].some((folder) => relative === folder || relative.startsWith(folder + "/")) && relative !== "island.json";
        } });
        // AS2 compilation reads these baselines, not the already-patched overlay.
        for (const baseline of baselines) write(inside(destination, baseline.file), baseline.bytes);
        this.save(p);
        return p;
      }
      case "save":
        return this.save(a.project);
      case "validate":
        return validate(a.project);
      case "rooms": {
        const p = this.project(a.project),
          dir = this.dir(a.project);
        if (p.mode !== "existing") return [];
        return walk(path.join(dir, "overlay"))
          .filter((f) =>
            p.version === "AS2"
              ? /^scenes\/island[^/]+\/scene[^/]+\.swf$/.test(f)
              : /\/scene\.xml$/.test(f),
          )
          .map((file) => ({
            file,
            title:
              p.version === "AS2"
                ? path.basename(file, ".swf").replace(/^scene/, "")
                : file.split("/").at(-2),
          }));
      }
      case "copyRoom": {
        const p = this.project(a.project);
        if (p.version !== "AS2") throw Error("This command copies AS2 rooms.");
        if (!identifier.test(a.name))
          throw Error(
            "Start the room name with a letter and use letters, numbers, or underscores.",
          );
        const folder = "scenes/island" + p.legacyIsland;
        if (
          !a.file.startsWith(folder + "/scene") ||
          !a.file.endsWith(".swf") ||
          a.file.slice(folder.length + 1).includes("/")
        )
          throw Error("Choose a room in this island.");
        const dir = path.join(this.dir(a.project), "overlay"),
          source = inside(dir, a.file),
          target = inside(dir, folder + "/scene" + a.name + ".swf");
        if (fs.existsSync(target)) throw Error("That room already exists.");
        write(target, fs.readFileSync(source));
        return true;
      }
      case "decompileSwf":
        return this.decompileSwf(a.project, a.file);
      case "files":
        return walk(this.dir(a.project)).filter(
          (f) => !["build/", "generated/", ".history/", ".cache/"].some((prefix) => f.startsWith(prefix)),
        );
      case "read": {
        const f = inside(this.dir(a.project), a.file);
        if (fs.statSync(f).size > 4e6)
          throw Error("This file is over 4 MB. Open it in an external text editor.");
        return fs.readFileSync(f, "utf8");
      }
      case "runtimeSource": {
        const project = this.project(a.project);
        if (project.mode === "existing")
          throw Error("Open an engine class or AS2 SWF for a copied island.");
        const file = "src/IslandScene.as";
        const target = inside(this.dir(a.project), file);
        if (!fs.existsSync(target))
          write(
            target,
            fs.readFileSync(path.join(this.root, "templates/IslandScene.as")),
          );
        return file;
      }
      case "write": {
        a.file = a.file.replaceAll("\\", "/");
        if (!/\.(as|xml|json|txt|md)$/i.test(a.file))
          throw Error("Save as AS, XML, JSON, TXT, or MD in this editor.");
        const f = inside(this.dir(a.project), a.file);
        const relative = path
          .relative(this.dir(a.project), f)
          .replaceAll("\\", "/");
        if (
          ["build/", "generated/", ".history/"].some((prefix) =>
            relative.startsWith(prefix),
          )
        )
          throw Error(
            "This file is generated output or saved history. Edit the source under src/ or overrides/ instead.",
          );
        if (relative === "island.json") {
          const p = JSON.parse(a.text);
          if (!p || p.id !== a.project)
            throw Error("The island ID must match its project folder.");
          this.save(p);
          return true;
        }
        if (fs.existsSync(f)) {
          const previous = fs.readFileSync(f, "utf8");
          if (previous === a.text) return true;
          write(
            inside(
              this.dir(a.project),
              ".history/source/" +
                Date.now() +
                "-" +
                crypto.randomBytes(4).toString("hex") +
                "/" +
                relative,
            ),
            previous,
          );
        }
        write(f, a.text);
        return true;
      }
      case "build":
        return this.build(a.project);
      case "liveEdit": {
        const p = this.project(a.project), edit = validateEdit(a.edit);
        const rules = (p.liveEdits || []).filter((r) => r.room !== edit.room || r.path !== edit.path);
        if (Object.keys(edit.values).length) rules.push(edit);
        p.liveEdits = rules;
        this.save(p);
        return rules;
      }
      case "play": {
        const p = this.project(a.project);
        if (
          !this.preview ||
          this.preview.project !== p.id ||
          !fs.existsSync(this.preview.out)
        )
          throw Error("Build this project before playing.");
        try { await this.prepareLiveEdit(p); }
        catch(error) { this.preview.inspectorError=error.message;this.logs.push("Live inspector unavailable: "+error.message+"\n"); }
        return "/player.html";
      }
      case "previewAsset":
        return "/asset.html?path=" + encodeURIComponent(a.path);
      case "importIsland":
        return this.importIsland(a.island, a.id, a.version, a.title);
      case "decompile":
        return this.decompile(a.project, a.className);
      case "export":
        return this.export(a.project);
      default:
        throw Error("Unknown command: " + method);
    }
  }
  save(p) {
    const errors = p.mode === "existing" ? [] : validate(p);
    if (errors.length) throw Error(errors.join("\n"));
    const file = path.join(this.dir(p.id), "island.json");
    if (fs.existsSync(file))
      write(
        path.join(this.dir(p.id), ".history", Date.now() + ".json"),
        fs.readFileSync(file),
      );
    write(file, JSON.stringify(p, null, 2));
    return p;
  }
  async build(id) {
    if (this.busy) throw Error("A build is already running.");
    this.busy = true;
    this.logs = [];
    const p = this.project(id),
      dir = this.dir(id);
    const log = (t) => {
      this.logs.push(t);
    };
    try {
      if (p.mode === "existing") {
        const info = islandInfo(this.library, p.originalIsland, p.version);
        if (!info.supported)
          throw Error(
            info.title +
              " uses " +
              info.version +
              " or is missing its starting room. Choose an island with its room files installed.",
          );
        const out = path.join(dir, "overlay");
        if (info.version === "AS2") {
          const sceneFolder = "scenes/island" + info.legacyIsland;
          if (!fs.existsSync(inside(out, sceneFolder)))
            fs.cpSync(
              inside(this.library, sceneFolder),
              inside(out, sceneFolder),
              { recursive: true },
            );
          p.version = "AS2";
          p.legacyIsland = info.legacyIsland;
          if (!p.entry || p.entry.startsWith("game.scenes."))
            p.entry = info.entry;
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(p.entry) ||
            !fs.existsSync(
              inside(out, sceneFolder + "/scene" + p.entry + ".swf"),
            )
          )
            throw Error("The starting AS2 scene is missing from the project.");
          this.save(p);
          const edits = json(path.join(dir, "as2-sources.json"), []);
          for (const edit of edits) {
            const target = inside(out, edit.swf);
            const original = edit.original
              ? inside(dir, edit.original)
              : inside(this.library, edit.swf);
            const temp = path.join(dir, ".cache", "compiled.swf");
            fs.mkdirSync(path.dirname(temp), { recursive: true });
            const sourceDir = inside(dir, edit.sources);
            const changed = walk(sourceDir).filter(
              (f) =>
                f.endsWith(".as") &&
                (!edit.hashes ||
                  crypto
                    .createHash("sha256")
                    .update(fs.readFileSync(inside(sourceDir, f)))
                    .digest("hex") !== edit.hashes[f]),
            );
            if (!changed.length) {
              write(target, fs.readFileSync(original));
              continue;
            }
            const imports = fs.mkdtempSync(
              path.join(dir, ".cache", "as2-import-"),
            );
            for (const file of changed)
              write(
                inside(imports, file),
                fs.readFileSync(inside(sourceDir, file)),
              );
            await run(
              path.resolve(this.root, this.config.java),
              [
                "-Djava.awt.headless=true",
                "-jar",
                path.resolve(this.root, this.config.ffdec),
                "-config",
                "parallelSpeedUp=0",
                "-importScript",
                original,
                temp,
                imports,
              ],
              log,
            );
            write(target, fs.readFileSync(temp));
          }
          const gameplay = path.join(out, "gameplay.swf");
          const patched =
            p.nativeUi === false
              ? fs.existsSync(gameplay)
                ? gameplay
                : path.join(this.library, "gameplay.swf")
              : await this.nativeUi(
                  this.root,
                  this.config,
                  fs.existsSync(gameplay)
                    ? gameplay
                    : path.join(this.library, "gameplay.swf"),
                  "AS2",
                  run,
                  log,
                );
          if (patched !== gameplay) write(gameplay, fs.readFileSync(patched));
          this.preview = {
            project: id,
            first: p.entry,
            out,
            version: "AS2",
            legacyIsland: p.legacyIsland,
          };
          return this.preview;
        }
        const configFile = path.join(out, "game/data/game/browser/game.xml");
        const configSource = fs.existsSync(configFile)
          ? configFile
          : path.join(this.library, "game/data/game/browser/game.xml");
        write(
          configFile,
          bootConfig(
            fs.readFileSync(configSource, "utf8"),
            p.entry,
            p.originalIsland,
          ),
        );
        fs.mkdirSync(path.join(out, "game"), { recursive: true });
        const shell =
          p.nativeUi === false
            ? path.join(this.library, "game/Shell.swf")
            : await this.nativeUi(
                this.root,
                this.config,
                path.join(this.library, "game/Shell.swf"),
                "AS3",
                run,
                log,
              );
        const args = [
          "-Xmx2048m",
          "-Djava.awt.headless=true",
          "-jar",
          path.resolve(this.root, this.config.ffdec),
          "-config",
          "parallelSpeedUp=0",
          "-importScript",
          shell,
          path.join(out, "game/Shell.swf"),
          path.join(dir, "overrides"),
        ];
        if (walk(path.join(dir, "overrides")).some((f) => f.endsWith(".as")))
          await run(path.resolve(this.root, this.config.java), args, log);
        else fs.copyFileSync(shell, path.join(out, "game/Shell.swf"));
        const helpers = [
          ...sourceFiles(dir, "src/extra", p.sourceOrder, "sourceOrder"),
          ...sourceFiles(dir, "src/scenes", p.sceneSourceOrder, "sceneSourceOrder"),
        ];
        if (helpers.length) {
          log("Compiling custom AS3 classes…\n");
          const compiled = path.join(dir, ".cache/custom-classes.swf");
          fs.mkdirSync(path.dirname(compiled), { recursive: true });
          await run(path.resolve(this.root, this.config.java), [
            "-Xmx2048m", "-Djava.awt.headless=true", "-cp",
            [path.join(this.root, "tools/vendor/compiler"), path.resolve(this.root, this.config.ffdec), path.join(this.root, "tools/vendor/lib/*")].join(path.delimiter),
            "AppendAs3Classes", path.join(out, "game/Shell.swf"), compiled, ...helpers,
          ], log);
          fs.copyFileSync(compiled, path.join(out, "game/Shell.swf"));
        }
        this.preview = { project: id, first: p.entry, out };
      } else
        this.preview = {
          project: id,
          resume: true,
          rooms: p.scenes.map((s) => s.id),
          ...(await build(this.root, dir, this.library, this.config, p, log)),
        };
      return this.preview;
    } finally {
      this.busy = false;
    }
  }
  async prepareLiveEdit(p) {
    if(this.busy)throw Error("Wait for the current build.");
    this.busy=true;
    const preview=this.preview;
    try {
    const version = p.version === "AS2" ? "AS2" : "AS3";
    const relative = version === "AS2" ? "gameplay.swf" : "game/Shell.swf";
    const local = inside(preview.out, relative);
    const source = fs.existsSync(local) ? local : inside(this.library, relative);
    preview.liveRuntime = await this.liveEditRuntime(this.root, this.config, source, version, run, (line) => this.logs.push(line));
    preview.liveFile = relative;
    if(this.preview!==preview)throw Error("The playtest changed. Open it again.");
    } finally { this.busy=false; }
  }
  importIsland(island, id, version = "AS3", title) {
    if (!identifier.test(island) || !identifier.test(id))
      throw Error("Invalid island ID");
    if (fs.existsSync(this.dir(id))) throw Error("Project already exists.");
    const data = inside(this.library, "game/data/scenes/" + island),
      assets = inside(this.library, "game/assets/scenes/" + island);
    const info = islandInfo(this.library, island, version);
    if (!info.supported)
      throw Error(
        info.title +
          " cannot run in this player. Choose an island with its room files installed.",
      );
    const entry = info.entry;
    const dir = this.dir(id);
    if (info.version === "AS2") {
      const sceneDir = "scenes/island" + info.legacyIsland;
      fs.cpSync(
        inside(this.library, sceneDir),
        inside(dir, "overlay/" + sceneDir),
        { recursive: true },
      );
      const popups = "popups/" + info.legacyIsland;
      if (fs.existsSync(inside(this.library, popups)))
        fs.cpSync(
          inside(this.library, popups),
          inside(dir, "overlay/" + popups),
          { recursive: true },
        );
      const p = {
        format: 1,
        id,
        title: title || "Copy of " + info.title,
        mode: "existing",
        version: "AS2",
        originalIsland: info.id,
        legacyIsland: info.legacyIsland,
        entry,
        scenes: [],
        items: [],
        flags: [],
      };
      this.save(p);
      return p;
    }
    fs.cpSync(data, path.join(dir, "overlay/game/data/scenes", island), {
      recursive: true,
    });
    if (fs.existsSync(assets))
      fs.cpSync(assets, path.join(dir, "overlay/game/assets/scenes", island), {
        recursive: true,
      });
    const p = {
      format: 1,
      id,
      title: title || "Copy of " + info.title,
      version: "AS3",
      mode: "existing",
      originalIsland: island,
      entry,
      scenes: [],
      items: [],
      flags: [],
    };
    this.save(p);
    return p;
  }
  async decompileSwf(id, file) {
    if (this.busy) throw Error("Wait for the current build.");
    if (!file.endsWith(".swf")) throw Error("Choose a SWF file.");
    const dir = this.dir(id),
      original = inside(path.join(dir, "overlay"), file);
    if (!fs.existsSync(original)) {
      if (!isGameFile(file)) throw Error("Choose a game SWF from the library.");
      const from = inside(this.library, file);
      if (!fs.existsSync(from))
        throw Error("The library does not contain that SWF.");
      write(original, fs.readFileSync(from));
    }
    const sources = "src/as2/" + file.slice(0, -4);
    const records = json(path.join(dir, "as2-sources.json"), []);
    if (!records.some((r) => r.swf === file)) {
      this.busy = true;
      try {
        await run(path.resolve(this.root, this.config.java), [
          "-Djava.awt.headless=true",
          "-jar",
          path.resolve(this.root, this.config.ffdec),
          "-config",
          "parallelSpeedUp=0",
          "-export",
          "script",
          inside(dir, sources),
          original,
        ]);
        const baseline = ".history/as2-originals/" + file;
        write(inside(dir, baseline), fs.readFileSync(original));
        const scripts = inside(dir, sources + "/scripts"),
          hashes = {};
        for (const name of walk(scripts).filter((f) => f.endsWith(".as")))
          hashes[name] = crypto
            .createHash("sha256")
            .update(fs.readFileSync(inside(scripts, name)))
            .digest("hex");
        records.push({
          swf: file,
          sources: sources + "/scripts",
          original: baseline,
          hashes,
        });
        write(
          path.join(dir, "as2-sources.json"),
          JSON.stringify(records, null, 2),
        );
      } finally {
        this.busy = false;
      }
    }
    return walk(inside(dir, sources))
      .filter((f) => f.endsWith(".as"))
      .map((f) => sources + "/" + f);
  }
  async decompile(id, className) {
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(\.\*)?$/.test(className))
      throw Error(
        "Enter a class name, for example game.scenes.carrot.mainStreet.MainStreet",
      );
    if (this.busy) throw Error("Wait for the current build");
    this.busy = true;
    this.logs = [];
    try {
      const dir = path.join(this.dir(id), "decompiled");
      await run(
        path.resolve(this.root, this.config.java),
        [
          "-Xmx2048m",
          "-Djava.awt.headless=true",
          "-jar",
          path.resolve(this.root, this.config.ffdec),
          "-config",
          "parallelSpeedUp=0",
          "-selectclass",
          className,
          "-export",
          "script",
          dir,
          path.join(this.library, "game/Shell.swf"),
        ],
        (t) => this.logs.push(t),
      );
      const source = path.join(dir, "scripts");
      const files = walk(source).filter((f) => f.endsWith(".as"));
      for (const f of files) {
        const to = inside(path.join(this.dir(id), "overrides"), f);
        if (!fs.existsSync(to)) write(to, fs.readFileSync(inside(source, f)));
      }
      return files.map((f) => "overrides/" + f);
    } finally {
      this.busy = false;
    }
  }
  importArt(id, files) {
    return files.map((f) => {
      if (!/\.(png|jpg|jpeg|swf|mp3)$/i.test(f))
        throw Error("Import a PNG, JPEG, SWF, or MP3 file.");
      const name = path.basename(f);
      const target = inside(path.join(this.dir(id), "assets"), name);
      if (fs.existsSync(target)) throw Error("A file with this name already exists in assets/: " + name);
      write(target, fs.readFileSync(f));
      return name;
    });
  }
  async export(id) {
    if (this.busy) throw Error("Wait for the build to finish");
    await this.build(id);
    if (this.project(id).liveEdits?.length) await this.prepareLiveEdit(this.project(id));
    return this.pack(id);
  }
  async pack(id, folder = path.join(this.root, "exports")) {
    if (this.busy) throw Error("Wait for the current build.");
    if (this.preview?.project !== id)
      throw Error("Build this island before packing it.");
    this.busy = true;
    try {
      const dest = path.join(
        folder,
        id + "-" + new Date().toISOString().replace(/[:.]/g, "-"),
      );
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(path.join(this.root, "runtime"), dest, { recursive: true });
      fs.renameSync(
        path.join(dest, "electron.exe"),
        path.join(dest, "islandengine.exe"),
      );
      const app = path.join(dest, "resources/app");
      fs.mkdirSync(app, { recursive: true });
      fs.cpSync(
        path.join(this.library, "game"),
        path.join(app, "library/game"),
        { recursive: true },
      );
      fs.cpSync(
        path.join(this.library, "ruffle"),
        path.join(app, "library/ruffle"),
        {
          recursive: true,
          filter: (p) => !p.endsWith(".br") && !p.endsWith(".map"),
        },
      );
      if (this.preview.version === "AS2") {
        for (const folder of classicFolders) {
          const from = path.join(this.library, folder);
          if (fs.existsSync(from))
            fs.cpSync(from, path.join(app, "library", folder), {
              recursive: true,
            });
        }
        for (const name of fs
          .readdirSync(this.library)
          .filter((f) => f.endsWith(".swf")))
          fs.copyFileSync(
            path.join(this.library, name),
            path.join(app, "library", name),
          );
      }
      fs.cpSync(this.preview.out, path.join(app, "library"), {
        recursive: true,
      });
      if (this.preview.liveRuntime) write(path.join(app, "library", this.preview.liveFile), fs.readFileSync(this.preview.liveRuntime));
      fs.cpSync(path.join(this.root, "ui"), path.join(app, "ui"), {
        recursive: true,
      });
      write(
        path.join(app, "package.json"),
        JSON.stringify({ name: id, version: "1.0.0", main: "player.cjs" }),
      );
      write(
        path.join(app, "entry.json"),
        JSON.stringify({
          first: this.preview.first,
          version: this.preview.version || "AS3",
          legacyIsland: this.preview.legacyIsland,
          title: this.project(id).title,
          project: id,
          resume: this.project(id).mode !== "existing",
          rooms: this.project(id).scenes.map((s) => s.id),
          liveEdits: this.project(id).liveEdits || [],
        }),
      );
      fs.copyFileSync(
        path.join(this.root, "templates/player.cjs"),
        path.join(app, "player.cjs"),
      );
      write(
        path.join(dest, "Read me.txt"),
        "Open islandengine.exe to play.\r\n",
      );
      return dest;
    } finally {
      this.busy = false;
    }
  }
  async serve(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (req.headers.host !== new URL(this.origin || "http://127.0.0.1").host) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (pathname === "/api" && req.method === "POST") {
      if (
        req.headers.origin !== this.origin ||
        req.headers["x-workshop-token"] !== this.token
      )
        throw Error("Untrusted request");
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4e6) throw Error("Request too large");
      }
      const a = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(await this.call(a.method, a.args || {})));
      return;
    }
    if (pathname === "/boot.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("window.workshopToken=" + JSON.stringify(this.token));
      return;
    }
    if (pathname === "/preview.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          this.preview
            ? {
                first: this.preview.first,
                project: this.preview.project,
                version: this.preview.version || "AS3",
                legacyIsland: this.preview.legacyIsland,
                resume: this.preview.resume || false,
                rooms: this.preview.rooms,
                inspector: !!this.preview.liveRuntime,
                inspectorError: this.preview.inspectorError,
                liveEdits: this.project(this.preview.project)?.liveEdits || [],
              }
            : {},
        ),
      );
      return;
    }
    if (pathname.endsWith(".php")) {
      res.setHeader("Content-Type", "application/xml");
      res.end("<response><status>success</status></response>");
      return;
    }
    let file;
    if (pathname === "/art-thumbnail") {
      const asset = url.searchParams.get("asset"),
        project = url.searchParams.get("project");
      const custom = inside(path.join(this.dir(project), "assets"), asset);
      const source = fs.existsSync(custom)
        ? custom
        : inside(this.library, asset);
      file = await this.art.thumbnail(source);
    } else if (pathname === "/art-preview") {
      file = await this.art.prepare(
        url.searchParams.get("path"),
        url.searchParams.has("symbol")
          ? Number(url.searchParams.get("symbol"))
          : undefined,
      );
    } else if (pathname.startsWith("/project-art/")) {
      const parts = pathname.slice(13).split("/");
      const id = parts.shift();
      file = inside(path.join(this.dir(id), "assets"), parts.join("/"));
    } else if (pathname.startsWith("/library/"))
      file = inside(this.library, pathname.slice(9));
    else if (isGameFile(pathname.slice(1))) {
      const relative = pathname.slice(1),
        overlay = this.preview ? inside(this.preview.out, relative) : null;
      file = this.preview?.liveRuntime && relative === this.preview.liveFile
        ? this.preview.liveRuntime
        : overlay && fs.existsSync(overlay)
          ? overlay
          : inside(this.library, relative);
    } else
      file = inside(
        path.join(this.root, "ui"),
        pathname === "/" ? "index.html" : pathname.slice(1),
      );
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  }
}
module.exports = { Workshop };
if (require.main === module) {
  const w = new Workshop(path.resolve(__dirname, ".."));
  w.start(Number(process.env.PORT) || 18840).then((o) => console.log(o));
}
