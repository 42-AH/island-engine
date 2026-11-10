const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { read, framed, rectangle, tag, transform } = require("../lib/swf.cjs");
function fixture() {
  const id = Buffer.from([1, 0]);
  const shape = tag(
    32,
    Buffer.concat([
      id,
      rectangle([-400, 1600, -200, 800]),
      Buffer.from([0, 0, 0, 0]),
    ]),
  );
  const place = tag(26, Buffer.from([6, 1, 0, 1, 0, 0]));
  const sprite = tag(
    39,
    Buffer.concat([Buffer.from([2, 0, 1, 0]), place, tag(1), tag(0)]),
  );
  const root = tag(26, Buffer.from([6, 1, 0, 2, 0, 0]));
  const body = Buffer.concat([
    rectangle([0, 20000, 0, 10000]),
    Buffer.from([0, 30, 1, 0]),
    shape,
    sprite,
    root,
    tag(1),
    tag(0),
  ]);
  const header = Buffer.alloc(8);
  header.write("FWS");
  header[3] = 10;
  header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
test("finds art inside nested SWF sprites", () => {
  const movie = read(fixture());
  assert.equal(movie.symbols.size, 2);
  assert.deepEqual(movie.symbols.get(2).bounds, [-400, 1600, -200, 800]);
});
test("centers negative-origin art with equal padding", () => {
  const movie = read(framed(fixture(), 2));
  assert.deepEqual(movie.header.bounds, [0, 2080, 0, 1080]);
  assert.deepEqual(movie.bounds, [40, 2040, 40, 1040]);
});
test("frames the whole timeline without the original empty stage margins", () => {
  const movie = read(framed(fixture()));
  assert.deepEqual(movie.header.bounds, [0, 2080, 0, 1080]);
  assert.deepEqual(movie.bounds, [40, 2040, 40, 1040]);
});
test("reads compressed art without changing the source", () => {
  const original = fixture(),
    header = Buffer.from(original.subarray(0, 8));
  header.write("CWS");
  const compressed = Buffer.concat([
    header,
    zlib.deflateSync(original.subarray(8)),
  ]);
  assert.deepEqual(read(compressed).bounds, read(original).bounds);
  assert.equal(compressed.toString("ascii", 0, 3), "CWS");
});
test("transforms bounds through rotation and reflection", () => {
  assert.deepEqual(
    transform([0, 20, 0, 10], [0, 1, -1, 0, 100, 200]),
    [90, 100, 200, 220],
  );
});
test("includes button artwork when framing a complete file", () => {
  const original = fixture(),
    movie = read(original);
  const button = tag(34, Buffer.from([3, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0]));
  const data = Buffer.concat([
    original.subarray(0, movie.header.end + 4),
    ...movie.list.filter((t) => ![0, 1, 26].includes(t.type)).map((t) => t.raw),
    button,
    tag(26, Buffer.from([6, 1, 0, 3, 0, 0])),
    tag(1),
    tag(0),
  ]);
  data.writeUInt32LE(data.length, 4);
  assert.deepEqual(read(framed(data)).bounds, [40, 2040, 40, 1040]);
});
test("rejects missing symbols and damaged input", () => {
  assert.throws(() => framed(fixture(), 500), /not found/);
  assert.throws(
    () => read(fixture().subarray(0, 25)),
    /Truncated|bounds|offset|range/i,
  );
});
