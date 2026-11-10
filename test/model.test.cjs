const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { blank, validate } = require("../lib/model.cjs");
const { inside, xml } = require("../lib/files.cjs");
const { sceneSpec } = require("../lib/build.cjs");
test("new islands have a valid starting room", () =>
  assert.deepEqual(validate(blank()), []));
test("missing room links stop the build", () => {
  const p = blank();
  p.scenes[0].objects.push({
    id: "door",
    kind: "door",
    x: 20,
    y: 20,
    width: 30,
    height: 60,
    target: "missing",
  });
  assert.match(validate(p).join(), /destination/);
});
test("duplicate IDs stop the build", () => {
  const p = blank();
  p.scenes.push(structuredClone(p.scenes[0]));
  assert.match(validate(p).join(), /unique/);
});
test("invalid geometry and actions stop the build", () => {
  const p = blank();
  p.scenes[0].objects[0].width = NaN;
  p.scenes[0].objects[0].actions = [
    { type: "travel", room: "bad" },
    { type: "wait", seconds: -1 },
  ];
  assert.equal(validate(p).length, 3);
});
test("file paths cannot escape a project", () => {
  const root = path.join(os.tmpdir(), "islandengine-test");
  for (const p of ["../private", "C:/outside", "/outside", "a/../../outside"])
    assert.throws(() => inside(root, p));
  assert.equal(inside(root, "src/test.as"), path.join(root, "src/test.as"));
});
test(
  "links cannot expose files outside a project",
  { skip: process.platform === "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ie-"));
    fs.symlinkSync(os.tmpdir(), path.join(root, "linked"));
    assert.throws(() => inside(root, "linked/secret"));
  },
);
test("dialogue stays data when it contains quotes or XML", () => {
  const s = blank().scenes[0];
  s.objects[0].text = '"<room>&';
  assert.ok(sceneSpec(s).includes("&quot;&lt;room&gt;&amp;"));
  assert.equal(xml("'<>&"), "&apos;&lt;&gt;&amp;");
});

test("custom room classes and actions are accepted", () => {
  const p = blank();
  p.scenes[0].script = "custom.RoomRules";
  p.scenes[0].objects[0].actions = [{ type: "custom", id: "turnLamp" }];
  assert.deepEqual(validate(p), []);
});
test("invalid room scripts and spawn points are rejected", () => {
  const p = blank();
  p.scenes[0].script = "custom.Invalid;";
  p.scenes[0].spawn.x = -1;
  assert.equal(validate(p).length, 2);
});
test("moving objects need finite settings", () => {
  const p = blank();
  p.scenes[0].objects[0].speed = "fast";
  assert.match(validate(p).join(), /speed must be a number/);
});
