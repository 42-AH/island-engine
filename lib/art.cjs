const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { read, framed } = require("./swf.cjs");
const { inside, write, walk, json } = require("./files.cjs");
const { run } = require("./build.cjs");
class ArtLibrary {
  constructor(root, library, config) {
    this.root = root;
    this.library = library;
    this.config = config;
    this.cache = path.join(root, ".cache/art");
    this.indexFile = path.join(this.cache, "index.json");
    const saved = json(this.indexFile, {});
    this.rows = saved.library === library ? saved.rows || [] : [];
    this.errors = saved.library === library ? saved.errors || [] : [];
    this.progress = null;
    this.pending = new Map();
    this.renderTail = Promise.resolve();
  }
  async scan(files, merge = false) {
    if (this.progress) return;
    this.progress = { done: 0, total: files.length };
    const requested = new Set(files);
    const rows = merge ? this.rows.filter((r) => !requested.has(r.path)) : [],
      errors = merge ? this.errors.filter((r) => !requested.has(r.path)) : [];
    try {
      for (const file of files) {
        try {
          const swf = read(
            await this.readSource(inside(this.library, file)),
            false,
          );
          for (const s of swf.symbols.values())
            rows.push({
              path: file,
              symbol: s.id,
              type: s.type,
              name: s.name,
              bounds: s.bounds,
              island:
                (file.match(/(?:assets|data)\/scenes\/([^/]+)/) || [])[1] || "",
            });
        } catch (error) {
          errors.push({ path: file, error: error.message });
        }
        this.progress.done++;
        if (this.progress.done % 4 === 0)
          await new Promise((resolve) => setImmediate(resolve));
      }
      this.rows = rows;
      this.errors = errors;
      write(
        this.indexFile,
        JSON.stringify({ library: this.library, rows, errors }),
      );
    } finally {
      this.progress = null;
    }
    return { symbols: rows.length, unreadable: errors };
  }
  async prepare(file, id) {
    const source = inside(this.library, file),
      stat = fs.statSync(source);
    if (!file.toLowerCase().endsWith(".swf")) return source;
    if (id !== undefined && id !== null && !Number.isInteger(Number(id)))
      throw Error("Invalid art ID");
    const key = crypto
      .createHash("sha256")
      .update([file, stat.size, stat.mtimeMs, id ?? "file", "v2"].join("|"))
      .digest("hex")
      .slice(0, 24);
    if (this.pending.has(key)) return this.pending.get(key);
    const job = this.extract(source, id, key);
    this.pending.set(key, job);
    try {
      return await job;
    } finally {
      this.pending.delete(key);
    }
  }
  async extract(source, id, key) {
    const folder = path.join(this.cache, key),
      swfFile = path.join(folder, "art.swf");
    if (fs.existsSync(swfFile)) return swfFile;
    const existing = walk(folder).find((f) => f.endsWith(".png"));
    if (existing) return inside(folder, existing);
    const input = await this.readSource(source),
      swf = read(input);
    const symbol = id == null ? null : swf.symbols.get(Number(id));
    if (id != null && !symbol) throw Error("Art symbol not found");
    if (symbol?.type === "font")
      throw Error(
        "Use this font in your artwork program or game text code.",
      );
    if (!symbol || !["image", "button"].includes(symbol.type)) {
      write(swfFile, framed(input, id == null ? null : Number(id)));
      return swfFile;
    }
    fs.mkdirSync(folder, { recursive: true });
    await this.render([
      "-Djava.awt.headless=true",
      "-Xmx512m",
      "-jar",
      path.resolve(this.root, this.config.ffdec),
      "-config",
      "parallelSpeedUp=0",
      "-onerror",
      "abort",
      "-exportTimeout",
      "30",
      "-selectid",
      String(id),
      "-select",
      "all:1",
      "-format",
      `${symbol.type}:png`,
      "-export",
      symbol.type,
      folder,
      source,
    ]);
    const file = walk(folder).find((f) => f.endsWith(".png"));
    if (!file) throw Error("No image was exported for this symbol.");
    return inside(folder, file);
  }
  async thumbnail(source) {
    const stat = fs.statSync(source);
    const key =
      crypto
        .createHash("sha256")
        .update(source + "|" + stat.size + "|" + stat.mtimeMs)
        .digest("hex")
        .slice(0, 24) + "-thumb";
    const folder = path.join(this.cache, key);
    const existing = walk(folder).find((f) => f.endsWith(".png"));
    if (existing) return inside(folder, existing);
    if (this.pending.has(key)) return this.pending.get(key);
    const job = (async () => {
      fs.mkdirSync(folder, { recursive: true });
      const swf = read(await this.readSource(source), false),
        b = swf.header.bounds;
      const zoom = Math.min(
        1,
        1024 / Math.max(1, (b[1] - b[0]) / 20),
        768 / Math.max(1, (b[3] - b[2]) / 20),
      );
      await this.render([
        "-Djava.awt.headless=true",
        "-Xmx512m",
        "-jar",
        path.resolve(this.root, this.config.ffdec),
        "-config",
        "parallelSpeedUp=0",
        "-onerror",
        "abort",
        "-exportTimeout",
        "30",
        "-select",
        "1",
        "-zoom",
        String(zoom),
        "-format",
        "frame:png",
        "-export",
        "frame",
        folder,
        source,
      ]);
      const file = walk(folder).find((f) => f.endsWith(".png"));
      if (!file) throw Error("No thumbnail could be made for this art.");
      return inside(folder, file);
    })();
    this.pending.set(key, job);
    try {
      return await job;
    } finally {
      this.pending.delete(key);
    }
  }
  render(args) {
    const job = this.renderTail
      .catch(() => {})
      .then(() => run(path.resolve(this.root, this.config.java), args));
    this.renderTail = job;
    return job;
  }
  async readSource(source) {
    const input = fs.readFileSync(source);
    if (input.toString("ascii", 0, 3) !== "ZWS") return input;
    const stat = fs.statSync(source);
    const key = crypto
      .createHash("sha256")
      .update(source + "|" + stat.size + "|" + stat.mtimeMs)
      .digest("hex")
      .slice(0, 24);
    const out = path.join(this.cache, key + "-uncompressed.swf");
    if (!fs.existsSync(out)) {
      fs.mkdirSync(this.cache, { recursive: true });
      await this.render([
        "-Djava.awt.headless=true",
        "-Xmx512m",
        "-jar",
        path.resolve(this.root, this.config.ffdec),
        "-decompress",
        source,
        out,
      ]);
    }
    return fs.readFileSync(out);
  }
}
module.exports = { ArtLibrary };
