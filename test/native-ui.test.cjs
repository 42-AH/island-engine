const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fitOriginalViewport, addInventoryList, renderCardsForPage } = require("../lib/native-ui.cjs");

// Shape of the decompiled ScreenManager in the rebuilt Shell.swf.
const screenManager = `
      public static const GAME_WIDTH:Number = 1010;
      public static const GAME_HEIGHT:Number = 645;
         if(_loc15_)
         {
            _loc1_ = 1010;
            _loc12_ = 645;
         }
         else
         {
            _loc1_ = 645;
            _loc12_ = 1010;
         }
         _avm1Container.x = (shellApi.viewportWidth - 800 * 1.25) / 2;`;

test("AS3 viewport returns to the original 960 x 640 in both orientations", () => {
  const code = fitOriginalViewport(screenManager);
  assert.match(code, /GAME_WIDTH:Number = 960;/);
  assert.match(code, /GAME_HEIGHT:Number = 640;/);
  assert.match(code, /_loc1_ = 960;\s+_loc12_ = 640;/);
  assert.match(code, /_loc1_ = 640;\s+_loc12_ = 960;/);
  assert.doesNotMatch(code, /1010|645/);
  assert.match(code, /800 \* 1\.25/);
});

test("AS3 viewport patch refuses code it does not recognise", () => {
  assert.throws(() => fitOriginalViewport(screenManager.replace("_loc1_ = 1010;", "")), /screen size/);
  assert.throws(() => fitOriginalViewport("var w = 960;"), /screen size/);
});

// Shape of the decompiled callback registration and Inventory renderer.
const callbacks = `
               ExternalInterface.addCallback("AS3_InventoryShellGo",Console.guardCallback("AS3_InventoryShellGo",inventoryShellGo));
      public function inventoryShellGo() : Boolean
      {`;
const renderer = `
         if(current && current._renderMode)
         {
            _loc5_ = new ByteArray();
            _loc4_.encode(_loc4_.rect,new PNGEncoderOptions(),_loc5_);
            _loc4_.dispose();
            _loc3_ = base64(_loc5_);`;

test("the page can ask an AS3 island for its collected cards", () => {
  const code = addInventoryList(callbacks);
  assert.match(code, /addCallback\("islandengineInventory",[^\n]*\n\s*ExternalInterface\.addCallback\("AS3_InventoryShellGo"/);
  assert.match(code, /public function islandengineInventory\(\) : String[\s\S]*public function inventoryShellGo\(\)/);
  assert.match(code, /getMakeSet\(shellApi\.island\)\.cardIds/);
  assert.match(code, /"island":_inventoryIsland,"set":shellApi\.island,"cards":cards/);
  assert.throws(() => addInventoryList("public function inventoryShellGo() : Boolean"), /inventory callbacks/);
});

test("AS3 cards render for the page while the inventory is open", () => {
  const code = renderCardsForPage(renderer);
  assert.match(code, /if\(current\)\n/);
  assert.doesNotMatch(code, /encode\(|_renderMode\)/);
  assert.match(code, /_loc5_ = _loc4_\.getPixels\(_loc4_\.rect\);\s+var pixelSize:String = _loc4_\.width \+ "x" \+ _loc4_\.height \+ ":";\s+_loc4_\.dispose\(\);/);
  assert.match(code, /_loc3_ = pixelSize \+ base64\(_loc5_\);/);
  assert.throws(() => renderCardsForPage(renderer.replace("PNGEncoderOptions", "JPEGEncoderOptions")), /card renderer/);
});
