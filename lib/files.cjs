const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
function inside(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.includes("\0") ||
    path.isAbsolute(relative)
  )
    throw Error("Invalid relative path");
  const resolved = path.resolve(root, relative),
    prefix = path.resolve(root) + path.sep;
  if (!resolved.startsWith(prefix)) throw Error("Path leaves the project");
  let cursor = resolved;
  while (cursor.startsWith(prefix)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw Error("Linked files are not supported");
    cursor = path.dirname(cursor);
  }
  return resolved;
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), ".islandengine-" + randomUUID() + ".tmp");
  const fd = fs.openSync(temp, "wx");
  try {
    try {
      fs.writeFileSync(fd, content);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
function json(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
function walk(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) =>
      e.isSymbolicLink()
        ? []
        : e.isDirectory()
          ? walk(path.join(root, e.name), prefix + e.name + "/")
          : [prefix + e.name],
    );
}
const xml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
module.exports = { inside, write, json, walk, xml };
