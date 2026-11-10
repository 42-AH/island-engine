const fs = require("node:fs");
const path = require("node:path");
const { inside, xml } = require("./files.cjs");
const strip = (text) => text.replace(/<!--[\s\S]*?-->/g, "");
const value = (text, tag) =>
  (text.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">")) ||
    [])[1]?.trim() || "";
function classicIslands(library) {
  const file = path.join(library, "framework/data/config.xml");
  if (!fs.existsSync(file)) return [];
  return [
    ...strip(fs.readFileSync(file, "utf8")).matchAll(
      /<island>([\s\S]*?)<\/island>/g,
    ),
  ].flatMap((m) => {
    const name = value(m[1], "name"),
      entry = value(m[1], "islandMain");
    if (
      !/^[A-Za-z][\w]*$/.test(name) ||
      !/^[A-Za-z][\w]*$/.test(entry) ||
      entry === "GlobalAS3Embassy"
    )
      return [];
    const supported = [
      "framework.swf",
      "gameplay.swf",
      "scenes/island" + name + "/scene" + entry + ".swf",
    ].every((p) => fs.existsSync(inside(library, p)));
    return [
      {
        id: name,
        title: value(m[1], "clusterName") || name,
        entry,
        version: "AS2",
        legacyIsland: name,
        supported,
      },
    ];
  });
}
function islandInfo(library, id, version) {
  const legacy = classicIslands(library).find(
    (i) => i.id.toLowerCase() === id.toLowerCase(),
  );
  if (version === "AS2") {
    if (!legacy) throw Error("The AS2 island files are missing.");
    return legacy;
  }
  const dir = inside(library, "game/data/scenes/" + id);
  const source = strip(fs.readFileSync(path.join(dir, "island.xml"), "utf8"));
  const first = value(value(source, "firstScene"), "scene");
  const engine = value(source, "gameVersion");
  if (engine === "AS2" && legacy) return legacy;
  const parts = first.split(".");
  const room =
    parts.length === 5 &&
    parts[0] === "game" &&
    parts[1] === "scenes" &&
    parts[2] === id
      ? parts[3]
      : "";
  const supported =
    engine === "AS3" &&
    !!room &&
    fs.existsSync(inside(dir, room + "/scene.xml"));
  return {
    id,
    title: value(source, "name").replace(/&amp;/g, "&") || id,
    entry: first,
    version: engine,
    supported,
  };
}
function bootConfig(source, entry, island) {
  if (
    !/^game\.scenes\.[A-Za-z][\w]*\.[A-Za-z][\w]*\.[A-Za-z][\w]*$/.test(entry)
  )
    throw Error("The starting scene is not a valid game class.");
  let result = source;
  for (const tag of ["firstScene", "defaultScene", "overrideScene"]) {
    const node = "<" + tag + ">" + xml(entry) + "</" + tag + ">";
    const pattern = new RegExp(
      "<" + tag + "(?:\\s*/>|>[\\s\\S]*?</" + tag + ">)",
    );
    result = pattern.test(result)
      ? result.replace(pattern, node)
      : result.replace("</game>", node + "</game>");
  }
  result = result.replace(
    /<islands>([\s\S]*?)<\/islands>/,
    (_, list) =>
      "<islands>" +
      [
        ...new Set([
          island,
          ...list
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ]),
      ].join(",") +
      "</islands>",
  );
  return result;
}
const classicFolders = [
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
];
function isGameFile(name) {
  return (
    name.startsWith("game/") ||
    name.startsWith("ruffle/") ||
    classicFolders.some((dir) => name.startsWith(dir + "/")) ||
    /^[\w-]+\.swf$/.test(name)
  );
}
module.exports = {
  islandInfo,
  classicIslands,
  bootConfig,
  classicFolders,
  isGameFile,
};
