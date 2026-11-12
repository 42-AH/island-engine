# Changing the game

Build after each change, then play the room that uses it. Compiler errors appear in the build log.

Your work is saved as ordinary files in the project folder. Use **Code → Open island.json** for project settings and **Open room runtime** for a new AS3 island’s shared runtime, even before the first build. **Open engine class** decompiles native AS3 classes. **Open AS2 SWF** exposes classic timeline scripts.

## Where to work

| Change                                                | File                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Rooms, objects, dialogue, and puzzle steps            | Your project's `island.json`                                  |
| Rules shared by every room                            | Your project's `src/IslandScene.as`                           |
| Rules for one room                                    | A class under `src/scenes/`                                   |
| Helper classes                                        | Classes under `src/extra/`                                    |
| Original movement, character parts, or engine systems | Classes under `overrides/`, opened with **Open engine class** |
| Editor controls and layout                            | `ui/editor.js`, `ui/index.html`, `ui/style.css`               |
| Project checks                                        | `lib/model.cjs`                                               |
| Generated scenes and compilation                      | `lib/build.cjs`                                               |
| Project files, imports, and export                    | `lib/workshop.cjs`                                            |
| Desktop window and local player                       | `desktop.cjs`, `ui/player.js`                                 |

Edit source files outside `generated/` and `build/`, which are replaced on each build.

## AS2 scripts

Click a room to decompile its SWF, or use **Open AS2 SWF** for a game file such as `gameplay.swf`. Edit the `.as` files under `src/as2/`, then save and build. Only changed scripts are recompiled. Keep their exported paths: they identify the timeline, frame, or class inside the SWF.

Use **+ Copy a room** to duplicate a room’s SWF, then edit its scripts and exits. Set **Starting room** to the new room to test it.

## Copied AS3 islands

Copied AS3 builds compile custom classes under `src/extra/` and `src/scenes/`. Engine overrides compile first, then those new classes in dependency order. A new class can extend an existing original room class and be selected as the starting scene. You still need to connect it to any original XML or scripts that should use it.

An override can’t refer to a helper that will only compile in the later step. That helper must already be available to the compiler. Copied islands don’t include `IslandScene.as` by default. Use the original room class’s hooks for those projects.

## A room script for a new AS3 island

Copy `examples/RoomRules.as` into your project's `src/scenes/`. In the room's **Room code** section, set **ActionScript class** to `custom.RoomRules`. Assign the class to each room that needs it. Copying the file alone won’t change a room.

- `onReady()` runs after the room and player are loaded.
- `onTick(seconds)` runs each frame. Use `seconds` for movement that should stay the same speed at different frame rates.
- `onAction(action)` handles an action whose type is `custom`.
- `onUseItem(id)` handles the original inventory’s USE button. Return `true` if your code handled it. `false` checks nearby objects with a matching `requiresItem`.

The example rotates an object named `windmill` and handles this switch action:

```json
{ "type": "custom", "id": "turnLamp" }
```

`mark("lamp_on", true)` sets a saved flag. `flag("lamp_on")` reads it. `sprites` contains the drawn room objects, and `objects` contains their XML settings. Moving a picture does not automatically move its collision. Edit the native entity's Motion, Spatial, or hit component when that is what the mechanic needs.

Return `false` when a custom action finishes immediately. For an action that takes time, return `true` to pause the list and call `next()` once to resume it. Use the game's timed events for a delay. Do not put a waiting loop in `onAction`.

## Your own settings

Put nested settings in a room, object, or action’s `data` field:

```json
"data": {
  "startFlag": "entered_cellar",
  "lock": { "combination": [3, 1, 4] }
}
```

The builder stores it as JSON text in a `<data>` child. Read room settings with:

```actionscript
var settings:Object = JSON.parse(String(spec.data));
```

Use `objects["lock"].data` for an object's settings, or `action.data` inside `onAction`. Check `data.length()` before parsing an optional field. Ordinary string, number, and boolean properties become XML attributes. Nested fields outside `data` are not copied into the scene.

`examples/ConfiguredRoom.as` reads `startFlag` when the room loads. It extends `RoomRules`, so copy both files into `src/scenes/`.

## Class dependencies

Helpers compile first, followed by `IslandScene.as`, room scripts, and generated room classes. When a class depends on another class in the same folder, list the base class first in `island.json`:

```json
"sourceOrder": ["Counter.as", "Puzzle.as"],
"sceneSourceOrder": ["RoomRules.as", "ConfiguredRoom.as"]
```

`sourceOrder` lists paths under `src/extra/`. `sceneSourceOrder` lists paths under `src/scenes/`. Each list must contain every `.as` file in that folder, including subfolders, exactly once. Without a list, files compile alphabetically. Keep helpers independent of room subclasses, because the compiler cannot resolve circular dependencies.

## Recover an earlier edit

Saving a changed code file puts its previous contents under your project's `.history/source/`. Unchanged saves do not make another copy. To undo a saved edit, copy the earlier file back to its original path. Save the current file elsewhere first if you want to keep both versions.

For files changed outside the app, use your text editor’s history or Git. Unsaved edits are not backed up.

## Before exporting

Play from a fresh save and finish the island. Check every room exit, both sides of each locked interaction, item use, death or respawn, and the ending. Close and reopen the player to check saved progress. Test custom code in the rooms that use it.

The supplied checks cover the built-in mechanics and a 32-room compile. They can’t check a puzzle you’ve just written. Play through that yourself.

The author and export checks also exercise a complete two-room puzzle made through editor controls. Test ActionScript calls `activate` and `useItem` directly. That checks the compiled interactions, but a passing result doesn’t tell you whether the player can walk to every object. Check placement and walking routes in your own island.

The toolbar patch is in `lib/native-ui.cjs`. AS3 overrides compile after that patch. The builder recognizes one older, unmodified room runtime and replaces it on build, saving the old file under `.history/source/`. It keeps edited runtimes. To add the current inventory behavior to an edited runtime, compare it with `templates/IslandScene.as` and bring over the methods you need.

## Replacing the built-in behavior

Edit `src/IslandScene.as` to change room interactions, inventory, drawing, or saves. It also handles room-specific movement such as bounce pads and moving platforms. For the character’s general movement rules, open the relevant engine class under `overrides/`.

A room's script class can also use your own base class instead of IslandScene. Its constructor must accept `(island:String, room:XML)`. Helpers under `src/extra/` and engine replacements under `overrides/` compile with the project.

New AS3 projects can put replacement game files under `overlay/`, using paths such as `overlay/game/data/items/myIsland/key.xml`. These files copy over generated output after compilation and are included in exports. Set `nativeUi: false` in island.json to skip the stock toolbar patch when building a new AS3 project.

Item scripts can call `giveItem(id, name)`, `takeItem(id)`, `hasItem(id)`, and `useItem(id)`. Override `onUseItem(id)` and return true to handle a card without the default proximity or recipe rules. Item definitions also accept a `data` object, available through `spec.inventory.item`.

The desktop app, editor, validator, builder, and player are source files in this repository. Change `ui/`, `lib/`, `desktop.cjs`, or `templates/player.cjs` when the change belongs to the tool itself. The game code still runs within the selected AS2 or AS3 runtime.

**Copy this project** preserves editable source and assets. For AS2 it also preserves the original SWFs referenced by `as2-sources.json`. Removing those baselines breaks recompilation. Copies of original islands retain their internal island identifiers and native save conventions. Review hard-coded identifiers before treating a source copy as an independent game.
