const zlib = require("node:zlib");

class Bits {
  constructor(data, byte = 0) {
    this.data = data;
    this.bit = byte * 8;
  }
  read(count, signed = false) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (this.bit >= this.data.length * 8) throw Error("Truncated SWF record");
      value =
        value * 2 + ((this.data[this.bit >> 3] >> (7 - (this.bit++ & 7))) & 1);
    }
    return signed && count && value >= 2 ** (count - 1)
      ? value - 2 ** count
      : value;
  }
  get byte() {
    return Math.ceil(this.bit / 8);
  }
}
function rect(data, offset = 0) {
  const bits = new Bits(data, offset),
    size = bits.read(5);
  const values = Array.from({ length: 4 }, () => bits.read(size, true));
  return { bounds: values, end: bits.byte };
}
function matrix(data, offset) {
  const b = new Bits(data, offset);
  let a = 1,
    d = 1,
    c = 0,
    e = 0;
  if (b.read(1)) {
    const n = b.read(5);
    a = b.read(n, true) / 65536;
    d = b.read(n, true) / 65536;
  }
  if (b.read(1)) {
    const n = b.read(5);
    c = b.read(n, true) / 65536;
    e = b.read(n, true) / 65536;
  }
  const n = b.read(5),
    x = b.read(n, true),
    y = b.read(n, true);
  return { values: [a, c, e, d, x, y], end: b.byte };
}
function tags(data, offset) {
  const result = [];
  while (offset + 2 <= data.length) {
    const start = offset,
      header = data.readUInt16LE(offset);
    offset += 2;
    const type = header >> 6;
    let length = header & 63;
    if (length === 63) {
      length = data.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + length > data.length) throw Error("Truncated SWF tag");
    result.push({
      type,
      data: data.subarray(offset, offset + length),
      raw: data.subarray(start, offset + length),
    });
    offset += length;
    if (type === 0) break;
  }
  return result;
}
const kinds = new Map([
  [2, "shape"],
  [22, "shape"],
  [32, "shape"],
  [83, "shape"],
  [46, "morphshape"],
  [84, "morphshape"],
  [39, "sprite"],
  [6, "image"],
  [21, "image"],
  [35, "image"],
  [90, "image"],
  [20, "image"],
  [36, "image"],
  [7, "button"],
  [34, "button"],
  [11, "text"],
  [33, "text"],
  [37, "text"],
  [10, "font"],
  [48, "font"],
  [75, "font"],
  [91, "font"],
]);
function union(a, b) {
  if (!a) return b?.slice() || null;
  if (!b) return a;
  return [
    Math.min(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}
function transform(bounds, m) {
  if (!bounds) return null;
  const points = [];
  for (const x of [bounds[0], bounds[1]])
    for (const y of [bounds[2], bounds[3]])
      points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[1])),
  ];
}
function placement(tag, previous) {
  const data = tag.data;
  if (tag.type === 4)
    return {
      id: data.readUInt16LE(0),
      depth: data.readUInt16LE(2),
      matrix: matrix(data, 4).values,
    };
  if (![26, 70, 94].includes(tag.type)) return null;
  const flags = data[0],
    flags2 = tag.type === 26 ? 0 : data[1];
  let at = tag.type === 26 ? 1 : 2;
  const depth = data.readUInt16LE(at);
  at += 2;
  if (flags2 & 8 || (flags2 & 16 && flags & 2)) {
    while (at < data.length && data[at++]);
  }
  const old = previous.get(depth) || {};
  const id = flags & 2 ? data.readUInt16LE(at) : old.id;
  if (flags & 2) at += 2;
  return {
    id,
    depth,
    matrix:
      flags & 4 ? matrix(data, at).values : old.matrix || [1, 0, 0, 1, 0, 0],
  };
}
function skipFilters(data, at) {
  const count = data[at++];
  for (let i = 0; i < count; i++) {
    const kind = data[at++];
    if (kind === 0) at += 23;
    else if (kind === 1) at += 9;
    else if (kind === 2) at += 15;
    else if (kind === 3) at += 27;
    else if (kind === 4 || kind === 7) {
      const colors = data[at++];
      at += colors * 5 + 19;
    } else if (kind === 5) {
      const x = data[at++],
        y = data[at++];
      at += 13 + x * y * 4;
    } else if (kind === 6) at += 80;
    else throw Error("Unknown SWF filter: " + kind);
  }
  return at;
}
function imageBounds(tag) {
  const data = tag.data;
  if ([20, 36].includes(tag.type))
    return [0, data.readUInt16LE(3) * 20, 0, data.readUInt16LE(5) * 20];
  const offset = tag.type === 90 ? 8 : tag.type === 35 ? 6 : 2;
  const image = data.subarray(offset);
  if (image[0] === 137 && image.toString("ascii", 1, 4) === "PNG")
    return [0, image.readUInt32BE(16) * 20, 0, image.readUInt32BE(20) * 20];
  if (image.toString("ascii", 0, 3) === "GIF")
    return [0, image.readUInt16LE(6) * 20, 0, image.readUInt16LE(8) * 20];
  for (let i = 0; i + 9 < image.length; i++) {
    if (
      image[i] === 255 &&
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(image[i + 1])
    )
      return [
        0,
        image.readUInt16BE(i + 7) * 20,
        0,
        image.readUInt16BE(i + 5) * 20,
      ];
  }
  return null;
}
function read(input, calculateBounds = true) {
  const signature = input.toString("ascii", 0, 3);
  if (!["FWS", "CWS"].includes(signature))
    throw Error("Unsupported SWF compression: " + signature);
  const data =
    signature === "CWS"
      ? Buffer.concat([
          input.subarray(0, 8),
          zlib.inflateSync(input.subarray(8), {
            maxOutputLength: 128 * 1024 * 1024,
          }),
        ])
      : input;
  const header = rect(data, 8),
    list = tags(data, header.end + 4),
    symbols = new Map(),
    names = new Map();
  for (const tag of list) {
    if (kinds.has(tag.type) && tag.data.length >= 2) {
      const id = tag.data.readUInt16LE(0);
      symbols.set(id, { id, type: kinds.get(tag.type), tag });
    }
    if ([56, 76].includes(tag.type)) {
      let at = 2;
      for (let i = 0; i < tag.data.readUInt16LE(0); i++) {
        const id = tag.data.readUInt16LE(at);
        at += 2;
        const end = tag.data.indexOf(0, at);
        if (end < 0) throw Error("Invalid symbol name");
        names.set(id, tag.data.toString("utf8", at, end));
        at = end + 1;
      }
    }
  }
  function timeline(list, visiting) {
    let bounds = null;
    const placed = new Map();
    for (const tag of list) {
      const p = placement(tag, placed);
      if (p) {
        placed.set(p.depth, p);
        bounds = union(
          bounds,
          transform(symbolBounds(p.id, visiting), p.matrix),
        );
      }
      if (tag.type === 28) placed.delete(tag.data.readUInt16LE(0));
      if (tag.type === 5) placed.delete(tag.data.readUInt16LE(2));
    }
    return bounds;
  }
  function symbolBounds(id, visiting = new Set()) {
    const s = symbols.get(id);
    if (!s || visiting.has(id)) return null;
    if (s.bounds !== undefined) return s.bounds;
    visiting = new Set(visiting);
    visiting.add(id);
    let bounds = null;
    if (["shape", "text", "morphshape"].includes(s.type)) {
      const first = rect(s.tag.data, 2);
      bounds = first.bounds;
      if (s.type === "morphshape")
        bounds = union(bounds, rect(s.tag.data, first.end).bounds);
    }
    if (s.type === "sprite") bounds = timeline(tags(s.tag.data, 4), visiting);
    if (s.type === "image") bounds = imageBounds(s.tag);
    if (s.type === "button") {
      const data = s.tag.data;
      let at = s.tag.type === 34 ? 5 : 2;
      while (at < data.length) {
        const flags = data[at++];
        if (!flags) break;
        const child = data.readUInt16LE(at);
        at += 4;
        const m = matrix(data, at);
        at = m.end;
        if (flags & 7)
          bounds = union(
            bounds,
            transform(symbolBounds(child, visiting), m.values),
          );
        if (s.tag.type === 34) {
          const color = new Bits(data, at),
            add = color.read(1),
            multiply = color.read(1),
            n = color.read(4);
          color.read(n * 4 * (add + multiply));
          at = color.byte;
          if (flags & 16) at = skipFilters(data, at);
          if (flags & 32) at++;
        }
      }
    }
    s.bounds = bounds;
    return bounds;
  }
  for (const s of symbols.values()) {
    s.name = names.get(s.id) || `${s.type} ${s.id}`;
    s.bounds = calculateBounds ? symbolBounds(s.id) : null;
  }
  return {
    data,
    header,
    list,
    symbols,
    bounds: calculateBounds ? timeline(list, new Set()) : null,
    version: input[3],
  };
}
function signedBits(values) {
  return Math.max(
    1,
    ...values.map((v) => Math.ceil(Math.log2(Math.abs(Math.round(v)) + 1)) + 1),
  );
}
function pack(fields) {
  const bits = [];
  for (const [value, size] of fields) {
    let n = value < 0 ? 2 ** size + value : value;
    for (let i = size - 1; i >= 0; i--) bits.push(Math.floor(n / 2 ** i) % 2);
  }
  const out = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((v, i) => (out[i >> 3] |= v << (7 - (i & 7))));
  return out;
}
function rectangle(values) {
  values = values.map(Math.round);
  const n = signedBits(values);
  return pack([[n, 5], ...values.map((v) => [v, n])]);
}
function tag(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(data.length < 63 ? 2 : 6);
  head.writeUInt16LE((type << 6) | Math.min(63, data.length));
  if (data.length >= 63) head.writeUInt32LE(data.length, 2);
  return Buffer.concat([head, data]);
}
function framed(input, id = null) {
  const swf = read(input),
    symbol = id === null ? null : swf.symbols.get(Number(id));
  if (id !== null && !symbol) throw Error("Art symbol not found");
  if (symbol && ["image", "font", "button"].includes(symbol.type))
    throw Error("This art type uses a still preview.");
  const bounds = symbol ? symbol.bounds : swf.bounds;
  if (!bounds || bounds[1] <= bounds[0] || bounds[3] <= bounds[2])
    throw Error("This asset has no visible bounds.");
  const padding = 40,
    width = Math.ceil(bounds[1] - bounds[0]) + padding * 2,
    height = Math.ceil(bounds[3] - bounds[2]) + padding * 2;
  const controls = new Set([0, 1, 4, 5, 9, 12, 26, 28, 43, 59, 70, 94]);
  const defs = swf.list
    .filter((t) => !controls.has(t.type) && t.type !== 76)
    .map((t) => t.raw);
  // Omit the document class so the preview does not start the original scene.
  for (const t of swf.list.filter((t) => t.type === 76)) {
    const entries = [];
    let at = 2;
    for (let n = 0; n < t.data.readUInt16LE(0); n++) {
      const start = at,
        ref = t.data.readUInt16LE(at);
      at = t.data.indexOf(0, at + 2) + 1;
      if (at === 0) throw Error("Invalid symbol class");
      if (ref !== 0) entries.push(t.data.subarray(start, at));
    }
    const count = Buffer.alloc(2);
    count.writeUInt16LE(entries.length);
    defs.push(tag(76, Buffer.concat([count, ...entries])));
  }
  let target = id;
  if (id === null) {
    target = Math.max(0, ...swf.symbols.keys()) + 1;
    if (target > 65535) throw Error("No free symbol ID");
    const header = Buffer.alloc(4);
    header.writeUInt16LE(target);
    header.writeUInt16LE(swf.data.readUInt16LE(swf.header.end + 2), 2);
    const timeline = swf.list
      .filter((t) => controls.has(t.type) && ![9, 12, 59].includes(t.type))
      .map((t) => t.raw);
    defs.push(tag(39, Buffer.concat([header, ...timeline])));
  }
  const x = Math.round(padding - bounds[0]),
    y = Math.round(padding - bounds[2]),
    n = signedBits([x, y]);
  const move = pack([
    [0, 1],
    [0, 1],
    [n, 5],
    [x, n],
    [y, n],
  ]);
  const place = Buffer.alloc(5);
  place[0] = 6;
  place.writeUInt16LE(1, 1);
  place.writeUInt16LE(target, 3);
  const frames = Buffer.from([0, 30, 1, 0]);
  const body = Buffer.concat([
    rectangle([0, width, 0, height]),
    frames,
    ...defs,
    tag(26, Buffer.concat([place, move])),
    tag(1),
    tag(0),
  ]);
  const header = Buffer.alloc(8);
  header.write("FWS");
  header[3] = swf.version;
  header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
module.exports = { read, framed, rect, rectangle, tag, transform, union };
