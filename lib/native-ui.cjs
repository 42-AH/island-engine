const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { write } = require("./files.cjs");
async function nativeUi(root, config, source, version, run, log) {
  const key = crypto
    .createHash("sha256")
    .update(fs.readFileSync(source))
    .update(version === "AS2" ? "island-ui-3" : "island-ui-2")
    .digest("hex");
  const dir = path.join(root, ".cache/native-ui", version + "-" + key);
  const output = path.join(dir, "player.swf");
  if (fs.existsSync(output)) return output;
  fs.mkdirSync(dir, { recursive: true });
  const java = path.resolve(root, config.java),
    jar = path.resolve(root, config.ffdec);
  const args = [
    "-Djava.awt.headless=true",
    "-jar",
    jar,
    "-config",
    "parallelSpeedUp=0",
  ];
  const selected =
    version === "AS3"
      ? ["-selectclass", "game.ui.hud.Hud,game.scene.template.ui.CardGroup"]
      : [];
  await run(
    java,
    [...args, ...selected, "-export", "script", dir, source],
    log,
  );
  const scripts = path.join(dir, "scripts");
  if (version === "AS3") {
    const hud = path.join(scripts, "game/ui/hud/Hud.as");
    let code = fs.readFileSync(hud, "utf8");
    const anchor = "this.createDebugConsoleButton();";
    if (!code.includes(anchor))
      throw Error("Cannot locate the original toolbar setup.");
    code = code.replace(
      anchor,
      anchor +
        '\n         hideButton("Home");hideButton("Friends");hideButton("Realms");hideButton("Store");hideButton("Map");\n         if(screen.bottomRow.saveBtn){screen.bottomRow.saveBtn.visible=false;screen.bottomRow.saveBtn.mouseEnabled=false;screen.bottomRow.saveBtn.mouseChildren=false;}',
    );
    write(hud, code);
    const card = path.join(scripts, "game/scene/template/ui/CardGroup.as");
    code = fs.readFileSync(card, "utf8");
    code = code.replace(
      "import flash.display.DisplayObjectContainer;",
      "import flash.display.DisplayObjectContainer;\n   import flash.display.DisplayObject;",
    );
    code = code.replace(
      "assetLoaded(param1:DisplayObjectContainer,",
      "assetLoaded(param1:DisplayObject,",
    );
    const art = "         param2.bitmapHolder.addChild(param1);";
    if (!code.includes(art))
      throw Error("Cannot locate the original inventory art loader.");
    code = code.replace(
      art,
      `         if(param3.id == "islandengineArt") {
            var artBounds:Rectangle=param1.getBounds(param1);
            var fit:Number=Math.min(210/artBounds.width,185/artBounds.height);
            if(artBounds.width>0 && artBounds.height>0) {
               param1.scaleX=param1.scaleY=fit;
               param1.x=-(artBounds.x+artBounds.width/2)*fit;
               param1.y=-(artBounds.y+artBounds.height/2)*fit;
            }
         }
` + art,
    );
    write(card, code);
  } else {
    const file = path.join(scripts, "frame_5/DoAction.as");
    let code = fs.readFileSync(file, "utf8");
    if (!code.includes("islandengineHiddenButtons"))
      code += `\nvar islandengineHiddenButtons=["btnHome","btnFriends","btnRealms","btnMap","btnMapDim","btnSave","btnStore","btnShop"];
iconList=["Settings","SettingsDim","Wardrobe","Inventory"];
numIcons=iconList.length;
for(var islandengineButton in islandengineHiddenButtons) {
  var islandengineClip=navBar[islandengineHiddenButtons[islandengineButton]];
  islandengineClip._visible=false;
  islandengineClip.enabled=false;
}\n`;
    const first = path.join(scripts, "frame_1/DoAction.as");
    let startup = fs.readFileSync(first, "utf8");
    const icons = /var iconList = \[[^\]]+\];/;
    if (!icons.test(startup))
      throw Error("Cannot locate the classic toolbar icons.");
    startup = startup.replace(
      icons,
      'var iconList = ["Settings","SettingsDim","Wardrobe","Inventory"];',
    );
    write(path.join(dir, "changed/frame_1/DoAction.as"), startup);
    const changed = path.join(dir, "changed/frame_5/DoAction.as");
    write(changed, code);
  }
  await run(
    java,
    [
      ...args,
      "-importScript",
      source,
      path.join(dir, "pending.swf"),
      version === "AS3" ? scripts : path.join(dir, "changed"),
    ],
    log,
  );
  fs.renameSync(path.join(dir, "pending.swf"), output);
  return output;
}
module.exports = { nativeUi };
