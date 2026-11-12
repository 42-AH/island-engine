const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fitOriginalViewport } = require("../lib/native-ui.cjs");

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
