const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { write } = require("./files.cjs");
function fixLegacyMemory(code) {
  return code.replace('_lso = SharedObject.getLocal("poptropica",param1);', 'var candidate:SharedObject = SharedObject.getLocal("poptropica",param1);\n            if(candidate != null && candidate.size > 0) _lso = candidate;');
}
// The original AS3 art (ShellLoader.swf, hud.swf, the loading screen) is 960 x 640,
// and the toolbar keeps the icon positions drawn for that width. The rebuilt
// Shell.swf sizes its viewport 1010 x 645 to match the AS2 page, which leaves a
// gap right of the toolbar and puts the classic inventory's Close button off screen.
function fitOriginalViewport(code) {
  const count = (pattern) => (code.match(pattern) || []).length;
  if (count(/= 1010;/g) !== 3 || count(/= 645;/g) !== 3)
    throw Error("Cannot locate the original screen size.");
  return code.replace(/= 1010;/g, "= 960;").replace(/= 645;/g, "= 640;");
}
// The classic inventory lists Char.inventory[island], which nothing fills for AS3
// islands. This callback lets the page read the current island's cards.
function addInventoryList(code) {
  const register = 'ExternalInterface.addCallback("AS3_InventoryShellGo"';
  const method = "public function inventoryShellGo() : Boolean";
  if (!code.includes(register) || !code.includes(method))
    throw Error("Cannot locate the inventory callbacks.");
  return code
    .replace(
      register,
      'ExternalInterface.addCallback("islandengineInventory",Console.guardCallback("islandengineInventory",islandengineInventory));\n               ' +
        register,
    )
    .replace(
      method,
      `public function islandengineInventory() : String
      {
         var cards:Array = [];
         try
         {
            for each(var card:String in shellApi.itemManager.getMakeSet(shellApi.island).cardIds)
            {
               cards.push(card);
            }
         }
         catch(e:Error)
         {
         }
         return JSON.stringify({"island":_inventoryIsland,"set":shellApi.island,"cards":cards});
      }

      ` + method,
    );
}
// Card pictures for the classic inventory are rendered by the open Inventory
// popup; the rebuilt Shell only rendered when no inventory was open. Ruffle
// returns nothing from BitmapData.encode, so the picture goes to the page as
// raw ARGB pixels prefixed with "<width>x<height>:" and the page makes the PNG.
function renderCardsForPage(code) {
  const check = "if(current && current._renderMode)",
    encode = "_loc4_.encode(_loc4_.rect,new PNGEncoderOptions(),_loc5_);",
    report = "_loc3_ = base64(_loc5_);";
  if (!code.includes(check) || !code.includes(encode) || !code.includes(report))
    throw Error("Cannot locate the card renderer.");
  return code
    .replace(check, "if(current)")
    .replace(
      encode,
      '_loc5_ = _loc4_.getPixels(_loc4_.rect);\n            var pixelSize:String = _loc4_.width + "x" + _loc4_.height + ":";',
    )
    .replace(report, "_loc3_ = pixelSize + base64(_loc5_);");
}
async function nativeUi(root, config, source, version, run, log) {
  const key = crypto
    .createHash("sha256")
    .update(fs.readFileSync(source))
    .update(version === "AS2" ? "island-ui-4" : "island-ui-8")
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
  if (version === "AS2") {
    const startup = path.join(dir, "startup.as"), toolbar = path.join(dir, "toolbar.as");
    write(startup, 'iconList=["Settings","SettingsDim","Wardrobe","Inventory"];numIcons=iconList.length;');
    write(toolbar, `var islandengineHiddenButtons=["btnHome","btnFriends","btnRealms","btnMap","btnMapDim","btnSave","btnStore","btnShop"];
iconList=["Settings","SettingsDim","Wardrobe","Inventory"];numIcons=iconList.length;
for(var islandengineButton in islandengineHiddenButtons) {
  var islandengineClip=navBar[islandengineHiddenButtons[islandengineButton]];
  islandengineClip._visible=false;islandengineClip.enabled=false;
}`);
    await run(java, ["-cp", [path.join(root, "tools/vendor/compiler"), jar, path.join(root, "tools/vendor/lib/*")].join(path.delimiter), "AppendAs2Scripts", source, path.join(dir, "pending.swf"), "1", startup, "5", toolbar], log);
    fs.renameSync(path.join(dir, "pending.swf"), output);
    return output;
  }
  const selected =
    version === "AS3"
      ? ["-selectclass", "game.ui.hud.Hud,game.scene.template.ui.CardGroup,game.managers.LongTermMemoryManager,game.managers.ScreenManager,game.ui.inventory.Inventory"]
      : [];
  await run(
    java,
    [...args, ...selected, "-export", "script", dir, source],
    log,
  );
  const scripts = path.join(dir, "scripts");
  if (version === "AS3") {
    const memory = path.join(scripts, "game/managers/LongTermMemoryManager.as");
    if (fs.existsSync(memory)) write(memory, fixLegacyMemory(fs.readFileSync(memory, "utf8")));
    const screen = path.join(scripts, "game/managers/ScreenManager.as");
    write(screen, addInventoryList(fitOriginalViewport(fs.readFileSync(screen, "utf8"))));
    const inventory = path.join(scripts, "game/ui/inventory/Inventory.as");
    write(inventory, renderCardsForPage(fs.readFileSync(inventory, "utf8")));
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
module.exports = { nativeUi, fixLegacyMemory, fitOriginalViewport, addInventoryList, renderCardsForPage };
