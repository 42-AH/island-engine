const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { write } = require("./files.cjs");

function validateEdit(edit) {
  if (!edit || typeof edit.room !== "string" || !edit.room || edit.room.length > 512 || typeof edit.path !== "string" || !edit.path || edit.path.length > 4096)
    throw Error("Select an object in the running room first.");
  const result = { room: edit.room, path: edit.path, values: {} };
  for (const [key, value] of Object.entries(edit.values || {})) {
    if (["x", "y", "scaleX", "scaleY", "rotation", "alpha"].includes(key)) {
      if (!Number.isFinite(value) || Math.abs(value) > 100000 || (key === "alpha" && (value < 0 || value > 1))) throw Error("Invalid " + key);
    } else if (key === "visible") {
      if (typeof value !== "boolean") throw Error("Visible must be true or false.");
    } else if (key === "text") {
      if (typeof value !== "string" || value.length > 10000) throw Error("Text is too long.");
    } else throw Error("This property cannot be changed here: " + key);
    result.values[key] = value;
  }
  return result;
}

async function liveEditRuntime(root, config, source, version, run, log) {
  const template = path.join(root, "templates", version === "AS2" ? "LiveEdit.as2" : "LiveEdit.as");
  const key = crypto.createHash("sha256").update(fs.readFileSync(source)).update(fs.readFileSync(template)).update("live-edit-3").digest("hex");
  const dir = path.join(root, ".cache/live-edit", version + "-" + key), output = path.join(dir, "player.swf");
  if (fs.existsSync(output)) return output;
  fs.mkdirSync(dir, { recursive: true });
  const java = path.resolve(root, config.java), jar = path.resolve(root, config.ffdec);
  const args = ["-Xmx2048m", "-Djava.awt.headless=true", "-jar", jar, "-config", "parallelSpeedUp=0"];
  log("Adding live object editing…\n");
  let input = source;
  if (version === "AS3") {
    input = path.join(dir, "classes.swf");
    await run(java, ["-Xmx2048m", "-Djava.awt.headless=true", "-cp", [path.join(root, "tools/vendor/compiler"), jar, path.join(root, "tools/vendor/lib/*")].join(path.delimiter), "AppendAs3Classes", source, input, template], log);
    await run(java, [...args, "-selectclass", "game.ui.hud.Hud", "-export", "script", dir, input], log);
    const file = path.join(dir, "scripts/game/ui/hud/Hud.as");
    let code = fs.readFileSync(file, "utf8");
    const anchor = "super.groupReady();";
    if (!code.includes(anchor)) throw Error("Could not attach the live inspector to this AS3 toolbar.");
    code = code.replace(anchor, anchor + "\n         islandengine.LiveEdit.start(super.shellApi, this.screen.stage);");
    write(file, code);
  } else {
    await run(java, ["-cp", [path.join(root, "tools/vendor/compiler"), jar, path.join(root, "tools/vendor/lib/*")].join(path.delimiter), "AppendAs2Scripts", source, path.join(dir, "pending.swf"), "1", template], log);
    fs.renameSync(path.join(dir, "pending.swf"), output);
    return output;
  }
  await run(java, [...args, "-importScript", input, path.join(dir, "pending.swf"), path.join(dir, version === "AS3" ? "scripts" : "changed")], log);
  fs.renameSync(path.join(dir, "pending.swf"), output);
  return output;
}
module.exports = { liveEditRuntime, validateEdit };
