# islandengine

islandengine is a Windows editor for offline Poptropica islands. New AS3 islands have visual room and item editors. Copies of existing AS2 and AS3 islands use their original scripts and XML. Both engines run through Ruffle with the original characters and mouse controls.

You can build a puzzle, change its ActionScript, and export it as a Windows app.

## Download and setup

You need 64-bit Windows, an internet connection, and about **15 GB of free space** for setup. The first download is about **6 GB**, plus the tools. After setup, you can use the editor offline.

1. On this GitHub page, click **Code → Download ZIP**.
2. Right-click the downloaded ZIP and choose **Extract All**. Open the extracted folder; don't run it from inside the ZIP.
3. Double-click **Start islandengine.cmd**.
4. Leave the setup window open. It downloads the game files, Ruffle, Java, FFDec, and Electron, then opens the editor. You don't need to find folders, install Node.js, or run commands.
5. Press **New island** to get started.

Later launches open straight into the editor. If the game download stops, open **Start islandengine.cmd** again to continue it. Finished downloads are kept for the retry. **Setup islandengine.cmd** reruns setup if you need to repair the tools. No admin account is needed when the extracted folder is somewhere you can write to, such as Downloads.

The game files come from the [Poptropica archive on Internet Archive](https://archive.org/details/poptropica-source), linked by the [Poptropica Legacy maintainer](https://github.com/andrewleewiles/poptropica-legacy/releases). Ruffle comes from its [official releases](https://github.com/ruffle-rs/ruffle/releases). Setup checks the downloads before unpacking them and saves the game files under `library`. It doesn't run the archive's app or installer files.

### Using game files you already have

This is optional. Setup reuses your saved game folder or a `library` or `public` folder beside the launcher if it finds one. Otherwise it downloads the files for you.

"Local game folder" means the game files saved on your PC. It's often called `public`. Choose the folder that contains both `game` and `ruffle`, not either of those subfolders:

```text
public/                  ← choose this folder
  game/
    Shell.swf
    ...other game files
  ruffle/
    ruffle.js
    ...other Ruffle files
```

`Shell.swf` is part of the game's engine. `ruffle.js` is part of the player that runs it. Those two files alone aren't enough: keep the rest of the game data, artwork, sounds, and Ruffle files together in their original folders. Classic AS2 islands also need `framework.swf`, `gameplay.swf`, and their original `framework` and `scenes` folders, along with the other files those islands use.

To switch folders later, use **Choose game folder** under **Rooms → Asset library**.

### Start an island

Once the editor opens, press **New island**, enter a name, and choose AS2 or AS3. AS3 starts with an empty room. AS2 asks which classic island to copy as a starting point. Hold the mouse button to move in Play; aim above the character to jump. Click people and objects to interact.

## Build a new AS3 island

1. Press **New island** at the top of the window.
2. Enter the island name and choose **AS3**.
3. Pick a tool above the canvas, then click to place it.
4. Drag an object to move it or its bottom-right corner to resize it. For exact positions and sizes, use the inspector.
5. Add rooms with **Add room**. Place a **Door** and set **Exit to room**, **Arrival X**, and **Arrival Y**.
6. Press **Save**, then **Play**.

For AS2 or a copy of an original AS3 island, see [Edit an existing island](#edit-an-existing-island).

Use **Rooms → Copy this project** to copy your own work. The copy includes art, source, engine overrides, and replacement files. It also keeps the original AS2 SWFs needed to rebuild edited scripts. It leaves out generated builds and ordinary edit history.

Check custom code for hard-coded island IDs before using the copy as a separate game. New AS3 copies get a new project ID and separate saved progress; copied original islands keep their native save conventions.

Click a room in the left panel, or press **Settings**, to edit its size, background, spawn point, and music. The object list below the rooms selects objects that are small or covered by other art. **Use as starting room** changes where a new game begins.

The mouse wheel zooms. Alt-drag or middle-drag pans. Hold Shift while dragging to skip the 10-pixel snap. Ctrl+Z undoes a canvas edit; Ctrl+Y restores it. Ctrl+S saves. Delete removes the selected object.

### Editing during Play

Choose **Inspect** to select objects in the running game. Check any combination of characters, platforms, items, doors, triggers, and switches. **More types** includes moving platforms, walls, climbing areas, water, hazards, bounce pads, scenery, backgrounds, other objects, and game internals. **All types** checks or clears every type. **Show outlines** outlines the checked types. Otherwise, only the hovered and selected objects are outlined. Click a whole object, then **Edit parts** for its smaller pieces. **Alt+click** cycles through overlapping objects. The chooser highlights each candidate when you point at its entry.

Drag the yellow handle to move a selection. Arrow keys move by one pixel. Shift+arrow moves by ten. Turn on **Snap to 10 px** when needed and hold Alt while dragging to ignore it. **Undo** and **Redo** cover live properties and whole drags. Escape cancels a drag, closes the chooser, or clears the selection. Save and Ctrl+S keep live changes in the project. Text fields keep their usual editing shortcuts.

Use **Pause** for moving artwork, **Focus selected** to get a closer look, or Space-drag to pan. **Walk** returns input to the game. **Save & restart** saves and rebuilds the playtest.

The terrain types include collision shapes exposed by the game. These outlines show bounds around surfaces, including hidden platforms. **Triggers** also shows authored trigger areas that have no artwork. Collision-only shapes and trigger areas can be inspected but not dragged in Play. Use **Edit in room** for authored areas or **Open room source** for copied game objects. **Game internals** makes engine containers and controls available. Types come from the room settings and game data. Unidentified original interactions stay under **Other objects** or **Scenery**.

Some original artwork, including the large sign in 24 Carrot, is part of a single background bitmap and cannot be edited separately. Its collision surface may still have a separate outline. Original game objects support appearance changes, but cannot safely be copied or deleted here. Hiding them does not remove collision or scripts. For authored objects, **Edit in room** opens the room editor, where copy, cut, paste, duplicate and delete also update the authored object. Rebuild to change collision and behavior.

## Art and characters

**Assets** searches your local game library, including the artwork inside SWFs. **All art** lists shapes, sprites, embedded images, buttons, text fields, and fonts, as well as separate image files. Complete sprites and their component shapes are separate entries. Names come from the game files; unnamed pieces use their symbol IDs.

After adding game files to the library, press **Find art inside SWFs** to index their artwork. The browser can only list files you have installed.

**Preview** centers the art and trims empty space around it. Use **Fit**, **+**, and **−** to zoom; Alt-drag pans.

**Use** copies the chosen symbol into your project's assets. Shapes and sprites stay in SWF format, including sprite timelines. Embedded images and button artwork become PNG files. Fonts are listed for reference; use them through game text code. Empty sprites and text fields filled by code may have no visible art to preview. SWF art also gets a still thumbnail on the room canvas.

Use **Import art** for PNG, JPEG, or SWF files. PNG supports transparent backgrounds. Keep layered artwork as separate files if you want to move the pieces separately. Export SVG artwork to PNG before using it in a room.

Import audio as MP3. For room music, enter the imported filename in the room's music field. For an effect, use a `sound` action with that filename as its `asset`. Library sounds can use paths such as `effects/door_pushbar_open_02.mp3`; library music can use its filename under `game/sound/music/`.

Place a **Scenery** object and set its size in the inspector. Add platforms and walls over the image for collision. Set **Visible artwork** to **Invisible (collision stays active)** when collision should be hidden. **Show after flag** and **Hide after flag** control artwork visibility; they do not remove collision.

Set a **Character** object’s hair, clothes, and colors in the inspector, using part IDs from the asset library.

## Objects

| Object          | Use                                                            |
| --------------- | -------------------------------------------------------------- |
| Platform        | A surface the player can land on from above.                   |
| Wall            | A solid side boundary.                                         |
| Climb           | A rope or ladder area.                                         |
| Water           | A water area handled by the game's water physics.              |
| Hazard          | Sends the player back to the room's checkpoint.                |
| Bounce pad      | Pushes the player upward. Set **Bounce strength**.             |
| Moving platform | Travels back and forth. Set `travelX`, `travelY`, and `speed`. |
| Character       | A person with the original character rig and dialogue.         |
| Item            | Goes into inventory when collected nearby.                     |
| Door            | Walks the player to an exit, then loads another room.          |
| Switch          | A clickable object that runs actions.                          |
| Trigger         | Runs once when the player enters its rectangle.                |
| Art             | Scenery without collision.                                     |

Clicking a door makes the player approach it, but won’t find a route over platforms. Place exits within walking distance.

## Items

Open **Items**, press **New item**, and enter its name. Set **Card art** and **Description** in Properties.

- **Place in [room name]** creates a pickup. Move it on the canvas like any other object.
- **Give item** awards a card through a character, switch, or other action. **Remove item** consumes it.
- An object's **Required item** selects the item needed to use it. Set **Reply when locked** for the missing-item response.
- A card's **When used** actions run from the original inventory's **USE** button when no nearby object accepts it.
- To combine two items, create both ingredients and the result in Items. Select one ingredient and press **Combine with another item**. Choose the other ingredient, the result, and the missing-item reply. This sets the required item and adds three actions: remove both ingredients, then give the result. Press **USE** on that first ingredient’s inventory card to combine them. If the item already has use actions, edit or remove them first.

Collected items stay with the player across rooms and saves. Pickup objects remember when they have been collected. Items are unique cards, as in the original game; quantities or other rules can be added in ActionScript through `onUseItem(id)`.

The Items editor builds cards for new AS3 islands. Copied AS2 and AS3 islands keep their original item files and inventory logic, editable through Code.

## Dialogue and puzzles

An object's **Dialogue** is spoken when the player interacts with it. A character speaks its own line; other objects use the player.

Under **When activated**, choose an action and press **Add action**. Fill in its dialogue, item, flag, or destination. Actions run from top to bottom. You can also edit that list under **Action code (JSON)**:

```json
[
  {
    "type": "say",
    "speaker": "keeper",
    "text": "The gate needs a key. That’s a dinner plate."
  },
  { "type": "say", "text": "So it is." },
  { "type": "flag", "id": "met_keeper" }
]
```

Set `speaker` to a character ID in that room, or leave it out for the player.

Set an object’s **Required flag** to lock it until that flag is set. **Required item** checks the player's inventory. **Reply when locked** supplies the line spoken when either requirement is missing.

**Go to room** actions and doors offer room names and fill the destination's spawn coordinates when you choose a room. **Speaker**, **Follow character**, and **Move character** offer the player and characters in the current room. Use **Set** or **Clear** to choose what a **Set flag** action does.

Use **Disable after flag** on an interaction, or expand **Action conditions** to set **Only after flag**, **Unless flag**, and **Only with item**. For a reward that should happen once, give its action an **Unless flag**, then add a Set flag action after the reward. The same conditions remain available in JSON:

```json
[
  { "type": "say", "text": "The lamp is empty.", "unless": "lamp_fixed" },
  { "type": "say", "text": "Still shining.", "requires": "lamp_fixed" }
]
```

More actions:

| Action       | Fields                                          |
| ------------ | ----------------------------------------------- |
| `say`        | `text`, optional `speaker`                      |
| `flag`       | `id`, optional `value: false` to clear it       |
| `give`       | Item `id` and `label`                           |
| `take`       | Item `id`                                       |
| `sound`      | `asset`, relative to the game's sound folder    |
| `checkpoint` | Uses the player's current position              |
| `travel`     | `room`, `x`, `y`                                |
| `wait`       | `seconds`                                       |
| `camera`     | `id` of a character, or `player`                |
| `move`       | Character `id`, `x`, `y`; places it immediately |
| `complete`   | Ending `text`                                   |
| `custom`     | `id` and any fields your room script needs      |

**Show after flag** (`showWhen`) and **Hide after flag** (`hideWhen`) affect artwork. If a puzzle needs to open a physical passage, change its collision in ActionScript too.

To use a required item, interact with the object that needs it or press **USE** on the item’s native inventory card while nearby. You don’t need to drag the card onto the scene. Flags and items save locally between runs.

Trigger progress and collected-object markers belong to their room, so reusing a trigger ID in another room does not disable it. Set `"repeat": true` on a trigger to run it each time the player enters. Checkpoints remember the respawn point separately for each room.

## Write code

Gameplay uses **ActionScript 2 or 3**, and the editor uses JavaScript. To change movement, edit the engine code; the room hooks below apply to new AS3 islands.

Open **Code** to edit project files. For a new AS3 island, **Open room runtime** creates `src/IslandScene.as` if it’s missing. The first build does this too. That file handles objects, dialogue, inventory, and room rules. Saved source edits keep the previous file under `.history/source/`.

For a room script, copy [RoomRules.as](examples/RoomRules.as) into `src/scenes/` and set **Room code → ActionScript class** to `custom.RoomRules`. The example uses three hooks:

- `onReady()` runs when the room is loaded.
- `onTick(seconds)` runs each frame.
- `onAction(action)` handles custom puzzle actions.

To edit an engine class, press **Open engine class** and enter its name:

```text
game.components.entity.character.CharacterMotionControl
```

Enter a package followed by `.*` to open all its classes. Edit the files under `overrides/`, then build to compile them into the project’s `Shell.swf`.

[Changing the game](CODE.md) covers custom settings, helper classes, compile order, and where to find the editor and exporter code. Check the build log when a change won’t compile.

Don’t edit `generated/` or `build/`: the next build replaces them.

## Edit an existing island

Choose **Copy island**, select AS2 or AS3, then pick an installed island and name the copy. Leave the name blank to use the default. The list requires each island’s starting-room files to be installed. To copy your own work, use **Rooms → Copy this project** instead.

**Play** builds the project and opens its starting room directly. The inspector's **Starting scene** field chooses that room. A copied island keeps its original layout and scripts; it is not converted into canvas objects.

For **AS3**, click a room on the left to open its XML. Use **Open engine class** for its ActionScript classes.

The search field in **Code** filters file paths. Use it to find dialogue files, item XML, or a class; it doesn’t search inside the files.

New classes under `src/extra/` and `src/scenes/` also compile into copied AS3 islands. Write those classes for the original island’s engine. Copied rooms don’t use `IslandScene`, and you still need to connect a new class to the room or interaction that uses it.

For **AS2**, click a room to open the scripts from its SWF. Edit them, save, and build. **Open AS2 SWF** also opens engine files such as `gameplay.swf` or `char.swf`. **Copy room** duplicates a room SWF inside the project. Edit that copy's scripts to change its rules and exits; change **Starting scene** to try it first.

AS2 source lives under `src/as2/`. The editor records which SWF each source folder belongs to in `as2-sources.json`. Builds compile changed scripts into the project's SWFs. Original SWFs are kept under `.history/as2-originals/`.

## Export

Press **Export** to build the project into a dated folder under `exports/`.

Open **islandengine.exe** inside the export folder to play. When sharing a game, zip the whole folder: the EXE needs the files beside it.

The export includes the selected engine’s game files. Saves go in the player’s Windows profile.

New AS3 playtests and exports resume in the last visited room and retain inventory, puzzle flags, and checkpoints. The editor and exported player use separate save profiles. Copy a new AS3 project to test it with a fresh project ID without erasing the original's progress.

The player blocks outside network requests. Island scripts cannot call Node.js.

## Project files

```text
island.json       Rooms, objects, dialogue, and actions
assets/           Imported art
src/              Your island code
overrides/        Edited classes from the original engine
overlay/          Existing-island data and art
generated/        Room classes written by the builder
build/            Compiled game files
.history/         Earlier project saves
```

## Source setup

The launcher sets up the tools on 64-bit Windows. It keeps them inside the app folder and checks each download against its SHA-256 checksum. Downloads come from the official [Temurin](https://github.com/adoptium/temurin8-binaries/releases), [FFDec](https://github.com/jindrapetrik/jpexs-decompiler/releases), and [Electron](https://github.com/electron/electron/releases) releases. Versions and checksums are in `tools/setup-downloads.json`.

You can also run setup from PowerShell and point it at your game folder:

```powershell
.\tools\setup.ps1 -Library 'D:\Poptropica\public'
```

To use tools you already have, pass `-JavaHome`, `-FFDec`, and optionally `-Javac`. Otherwise setup downloads them. **Setup islandengine.cmd** reruns setup and opens the editor when it's done. Without an existing game folder, it also downloads and prepares the game files.

Node.js is only needed to run the source checks:

```text
node --test test/*.test.cjs
```

Run `powershell -NoProfile -ExecutionPolicy Bypass -File test/setup-check.ps1` for the offline setup checks.

Keep one editor open at a time. It serves files over a local loopback connection; exported players use a separate port.

## Current limits

- The packaged app runs on Windows.
- Copied islands keep their original files. Adding rooms and puzzles to those copies usually means editing XML or ActionScript.
- Fonts and empty symbols filled by code may have nothing to show in an art preview.
- SWF canvas thumbnails show the first frame. Play the island to check its animation and script-driven changes.
- The Items editor builds cards for new AS3 islands. Edit copied islands’ inventory definitions and scripts through Code.
- Old islands may need repairs where they used retired online services or missing files.

## Runtime checks

With the local tools and game library installed, these commands build a test
island and run it in Chrome's headless mode. They use a separate profile and
muted audio. They do not send desktop mouse or keyboard input.

```text
node test/runtime-check.cjs
node test/headless.cjs
```

Set `ISLANDENGINE_TEST_CHROME` if Chrome is installed somewhere else.
`node test/build-check.cjs` checks saving and compiling a 32-room island.
See `CHECKS.txt` for the checks completed on this copy and their limits.

To check the editor without desktop input, run `node test/ui-check.cjs`.
It opens headless Chrome with a separate profile and creates a disposable
project under `.cache/ui-check/`. It checks the real editor's save and property
controls. Results are written to `.cache/ui-check/results.json`.

Run `node test/classic-check.cjs` to check AS2 source compilation and a room transition. Set `ISLANDENGINE_TEST_AS3=1` for the copied-AS3-room check. These tests use separate projects and headless Chrome.

`node test/author-check.cjs` creates a two-room puzzle through DOM-driven editor controls, adds a test room class, builds, completes the puzzle, reloads saved progress, and exports. It saves screenshots and results under `.cache/author-check/`. Test ActionScript drives gameplay by calling the runtime’s interaction methods. These checks don’t establish whether a player can reach every object with the mouse.

Run `node test/export-check.cjs` after that check to launch its standalone export with an isolated profile, complete the same puzzle, and verify reload. It temporarily adds a reporting script to the disposable export and restores the file afterward. `node test/art-check.cjs` checks installed SWF symbol browsing, centered preview, zoom, extraction, and saved artwork. Both need the local runtime and game library.
