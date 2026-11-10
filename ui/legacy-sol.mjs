// Ruffle 0.6 writes AMF3 despite SharedObject.objectEncoding=0. Its AVM1
// reader loses AMF3 integers and dense array entries. Convert the bridge
// objects before starting an older island; leave the AS3 profile untouched.
const utf8 = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: true });
class XmlValue {
  constructor(xml) {
    this.xml = xml;
  }
}
class Reader {
  constructor(bytes) {
    this.b = new Uint8Array(bytes);
    this.p = 0;
    this.strings = [];
    this.objects = [];
    this.traits = [];
  }
  take(n) {
    if (n < 0 || this.p + n > this.b.length) throw Error("Truncated save");
    const b = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return b;
  }
  byte() {
    return this.take(1)[0];
  }
  u16() {
    return new DataView(this.take(2).slice().buffer).getUint16(0);
  }
  u32() {
    return new DataView(this.take(4).slice().buffer).getUint32(0);
  }
  double() {
    return new DataView(this.take(8).slice().buffer).getFloat64(0);
  }
  utf(n) {
    return text.decode(this.take(n));
  }
  u29() {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.byte();
      n = n * 128 + (b & 127);
      if (!(b & 128)) return n;
    }
    return n * 256 + this.byte();
  }
  ref(list, i) {
    if (i >= list.length) throw Error("Invalid save reference");
    return list[i];
  }
  string() {
    const h = this.u29();
    if (!(h & 1)) return this.ref(this.strings, h >>> 1);
    const s = this.utf(h >>> 1);
    if (s) this.strings.push(s);
    return s;
  }
  value0(depth = 0) {
    if (depth > 100) throw Error("Save nesting limit");
    const type = this.byte();
    if (type === 0) return this.double();
    if (type === 1) return this.byte() !== 0;
    if (type === 2) return this.utf(this.u16());
    if (type === 5) return null;
    if (type === 6) return undefined;
    if (type === 7) return this.ref(this.objects, this.u16());
    if (type === 11) {
      const date = new Date(this.double());
      this.u16();
      this.objects.push(date);
      return date;
    }
    if (type === 12) return this.utf(this.u32());
    if (type === 15) {
      const xml = new XmlValue(this.utf(this.u32()));
      this.objects.push(xml);
      return xml;
    }
    if (![3, 8, 10].includes(type))
      throw Error("Unsupported bridge value " + type);
    const value = type === 3 ? Object.create(null) : [];
    this.objects.push(value);
    if (type !== 3) {
      const length = this.u32();
      if (length > this.b.length) throw Error("Invalid array length");
      value.length = length;
      if (type === 10) {
        for (let i = 0; i < length; i++) value[i] = this.value0(depth + 1);
        return value;
      }
    }
    while (true) {
      const key = this.utf(this.u16());
      if (!key && this.b[this.p] === 9) {
        this.p++;
        break;
      }
      Object.defineProperty(value, key, {
        value: this.value0(depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return value;
  }
  value(depth = 0) {
    if (depth > 100) throw Error("Save nesting limit");
    const type = this.byte();
    if (type === 0) return undefined;
    if (type === 1) return null;
    if (type === 2 || type === 3) return type === 3;
    if (type === 4) {
      const n = this.u29();
      return n & 0x10000000 ? n - 0x20000000 : n;
    }
    if (type === 5) return this.double();
    if (type === 6) return this.string();
    if (![7, 8, 9, 10, 11].includes(type))
      throw Error("Unsupported legacy save value " + type);
    const h = this.u29();
    if (!(h & 1)) return this.ref(this.objects, h >>> 1);
    if (type === 8) {
      const date = new Date(this.double());
      this.objects.push(date);
      return date;
    }
    if (type === 7 || type === 11) {
      const xml = new XmlValue(this.utf(h >>> 1));
      this.objects.push(xml);
      return xml;
    }
    if (type === 9) {
      const n = h >>> 1;
      if (n > this.b.length) throw Error("Invalid array length");
      const a = [];
      this.objects.push(a);
      for (let key = this.string(); key; key = this.string())
        Object.defineProperty(a, key, {
          value: this.value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      for (let i = 0; i < n; i++) a[i] = this.value(depth + 1);
      return a;
    }
    let trait;
    if (!(h & 2)) trait = this.ref(this.traits, h >>> 2);
    else {
      if (h & 4) throw Error("Externalizable data is not an AS2 save");
      trait = { name: this.string(), dynamic: !!(h & 8), keys: [] };
      const n = h >>> 4;
      if (n > this.b.length) throw Error("Invalid trait length");
      for (let i = 0; i < n; i++) trait.keys.push(this.string());
      this.traits.push(trait);
    }
    // Bridge data is plain dynamic data, never custom class instances.
    if (trait.name) throw Error("Typed data is not an AS2 bridge save");
    const o = Object.create(null);
    this.objects.push(o);
    for (const key of trait.keys) o[key] = this.value(depth + 1);
    if (trait.dynamic)
      for (let key = this.string(); key; key = this.string())
        o[key] = this.value(depth + 1);
    return o;
  }
}
class Writer {
  constructor() {
    this.parts = [];
    this.refs = new Map();
  }
  bytes(b) {
    this.parts.push(b);
  }
  byte(n) {
    this.bytes(Uint8Array.of(n));
  }
  u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n);
    this.bytes(b);
  }
  u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n);
    this.bytes(b);
  }
  double(n) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n);
    this.bytes(b);
  }
  key(s) {
    const b = utf8.encode(s);
    if (b.length > 65535) throw Error("Save key too long");
    this.u16(b.length);
    this.bytes(b);
  }
  value(v, depth = 0) {
    if (depth > 100) throw Error("Save nesting limit");
    if (v === undefined) {
      this.byte(6);
      return;
    }
    if (v === null) {
      this.byte(5);
      return;
    }
    if (typeof v === "number") {
      this.byte(0);
      this.double(v);
      return;
    }
    if (typeof v === "boolean") {
      this.byte(1);
      this.byte(+v);
      return;
    }
    if (typeof v === "string") {
      const b = utf8.encode(v);
      this.byte(b.length > 65535 ? 12 : 2);
      if (b.length > 65535) this.u32(b.length);
      else this.u16(b.length);
      this.bytes(b);
      return;
    }
    if (this.refs.has(v)) {
      this.byte(7);
      this.u16(this.refs.get(v));
      return;
    }
    if (this.refs.size >= 65536) throw Error("Too many save references");
    this.refs.set(v, this.refs.size);
    if (v instanceof Date) {
      this.byte(11);
      this.double(v.getTime());
      this.u16(0);
      return;
    }
    if (v instanceof XmlValue) {
      const b = utf8.encode(v.xml);
      this.byte(15);
      this.u32(b.length);
      this.bytes(b);
      return;
    }
    this.byte(Array.isArray(v) ? 8 : 3);
    if (Array.isArray(v)) this.u32(v.length);
    for (const key of Object.keys(v)) {
      this.key(key);
      this.value(v[key], depth + 1);
    }
    this.u16(0);
    this.byte(9);
  }
  finish() {
    const n = this.parts.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(n);
    let p = 0;
    for (const b of this.parts) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }
}
export function legacySol(bytes) {
  if (bytes.length > 4 * 1024 * 1024) throw Error("Save too large");
  const r = new Reader(bytes);
  if (r.u16() !== 0x00bf) throw Error("Invalid save signature");
  r.u32();
  if (r.utf(4) !== "TCSO") throw Error("Invalid save signature");
  r.take(6);
  const name = r.utf(r.u16());
  const version = r.u32();
  if (version === 0) return bytes;
  if (version !== 3 || !["Char", "TransitToken"].includes(name))
    throw Error("Unexpected legacy save");
  const w = new Writer();
  w.bytes(bytes.subarray(0, r.p - 4));
  w.u32(0);
  while (r.p < bytes.length) {
    const key = r.string();
    w.key(key);
    w.value(r.value());
    if (r.byte() !== 0) throw Error("Invalid save terminator");
    w.byte(0);
  }
  const out = w.finish();
  new DataView(out.buffer).setUint32(2, out.length - 6);
  return out;
}
export function prepareLegacySaves(storage, hostname) {
  const changes = [];
  for (const name of ["Char", "TransitToken"]) {
    const key = hostname + "//" + name,
      original = storage.getItem(key);
    if (!original) continue;
    const bytes = Uint8Array.from(atob(original), (c) => c.charCodeAt(0));
    const converted = legacySol(bytes);
    if (converted === bytes) continue;
    let binary = "";
    for (let i = 0; i < converted.length; i += 8192)
      binary += String.fromCharCode(...converted.subarray(i, i + 8192));
    changes.push({ key, original, value: btoa(binary) });
  }
  // Parse both before writing either; keep a bounded original copy and roll
  // back partial writes if the browser is out of storage space.
  try {
    for (const c of changes) {
      storage.setItem("poptropica:legacy-original:" + c.key, c.original);
      storage.setItem(c.key, c.value);
    }
  } catch (error) {
    for (const c of changes) storage.setItem(c.key, c.original);
    throw error;
  }
}

// Read only the original engines' bridge documents. The much larger AS3
// profile is deliberately outside this editor and stays in the whole bundle.
export function readBridgeSol(bytes, expectedName) {
  if (
    !["Char", "TransitToken", "Backup"].includes(expectedName) ||
    bytes.length > 4 * 1024 * 1024
  )
    throw Error("Unexpected bridge document");
  const r = new Reader(bytes);
  if (r.u16() !== 191 || r.u32() !== bytes.length - 6 || r.utf(4) !== "TCSO")
    throw Error("Invalid save signature");
  r.take(6);
  const name = r.utf(r.u16()),
    version = r.u32();
  if (name !== expectedName || ![0, 3].includes(version))
    throw Error("Unexpected bridge document");
  const data = Object.create(null);
  while (r.p < bytes.length) {
    const key = version === 0 ? r.utf(r.u16()) : r.string();
    Object.defineProperty(data, key, {
      value: version === 0 ? r.value0() : r.value(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (r.byte() !== 0) throw Error("Invalid save terminator");
  }
  return data;
}
export function writeBridgeSol(name, data) {
  if (!["Char", "TransitToken", "Backup"].includes(name))
    throw Error("Unexpected bridge document");
  const w = new Writer();
  w.u16(191);
  w.u32(0);
  w.bytes(utf8.encode("TCSO"));
  w.bytes(Uint8Array.of(0, 4, 0, 0, 0, 0));
  w.key(name);
  w.u32(0);
  for (const key of Object.keys(data)) {
    w.key(key);
    w.value(data[key]);
    w.byte(0);
  }
  const out = w.finish();
  if (out.length > 4 * 1024 * 1024) throw Error("Save too large");
  new DataView(out.buffer).setUint32(2, out.length - 6);
  return out;
}
export function editBridgeSaves(storage, hostname, names, edit) {
  const documents = Object.create(null),
    originals = new Map();
  for (const name of names) {
    const key = hostname + "//" + name,
      original = storage.getItem(key);
    originals.set(name, { key, original });
    documents[name] =
      original === null
        ? null
        : readBridgeSol(
            Uint8Array.from(atob(original), (c) => c.charCodeAt(0)),
            name,
          );
  }
  const result = edit(documents),
    changes = [];
  for (const name of names) {
    if (documents[name] === null) continue;
    const bytes = writeBridgeSol(name, documents[name]);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const previous = originals.get(name),
      value = btoa(binary);
    if (value !== previous.original) changes.push({ ...previous, value });
  }
  try {
    for (const c of changes) {
      if (c.original !== null)
        storage.setItem("poptropica:legacy-original:" + c.key, c.original);
      storage.setItem(c.key, c.value);
    }
  } catch (error) {
    for (const c of changes) {
      if (c.original === null) storage.removeItem(c.key);
      else storage.setItem(c.key, c.original);
    }
    throw error;
  }
  return result;
}
