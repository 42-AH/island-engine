const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function download(pkg, cache) {
  const file = path.join(cache, pkg.id + '.zip'), partial = file + '.part';
  if (fs.existsSync(file) && await hash(file) === pkg.sha256) return file;
  const offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  console.log(`Downloading ${pkg.name}${offset ? ' (continuing)' : ''}...`);
  if (offset !== pkg.size) {
    const response = await fetch(pkg.url, { headers: offset ? { Range: `bytes=${offset}-` } : {} });
    if (!response.ok) { await response.body?.cancel(); throw Error(`${pkg.name} download returned HTTP ${response.status}. Open Start islandengine.cmd to try again.`); }
    const resumed = offset > 0 && response.status === 206;
    if (resumed && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) {
      await response.body.cancel(); throw Error('The download server returned the wrong file range.');
    }
    let received = resumed ? offset : 0, last = 0;
    const progress = new Transform({ transform(chunk, encoding, done) {
      received += chunk.length;
      if (Date.now() - last > 5000) {
        console.log(`${pkg.name}: ${(received / 1e9).toFixed(2)} / ${(pkg.size / 1e9).toFixed(2)} GB`);
        last = Date.now();
      }
      done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partial, { flags: resumed ? 'a' : 'w' }));
  }
  console.log(`Checking ${pkg.name}...`);
  if (fs.statSync(partial).size !== pkg.size || await hash(partial) !== pkg.sha256) {
    fs.unlinkSync(partial);
    throw Error(`${pkg.name} download did not pass its checksum. Open Start islandengine.cmd to download it again.`);
  }
  fs.renameSync(partial, file);
  return file;
}
function read(fd, start, length) {
  const buffer = Buffer.alloc(length);
  if (fs.readSync(fd, buffer, 0, length, start) !== length) throw Error('The ZIP is incomplete.');
  return buffer;
}
function entries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, tailSize = Math.min(size, 65557), tail = read(fd, size - tailSize, tailSize);
    const end = tail.lastIndexOf(Buffer.from('504b0506', 'hex'));
    if (end < 0 || end + 22 > tail.length) throw Error('Invalid ZIP directory.');
    let offset = tail.readUInt32LE(end + 16), length = tail.readUInt32LE(end + 12);
    if (offset === 0xffffffff || length === 0xffffffff) {
      const locator = end - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw Error('Missing ZIP64 directory.');
      const zip64 = read(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
      offset = Number(zip64.readBigUInt64LE(48)); length = Number(zip64.readBigUInt64LE(40));
    }
    if (length > 64 * 1024 * 1024 || offset + length > size) throw Error('Invalid ZIP directory size.');
    const directory = read(fd, offset, length), result = [];
    for (let p = 0; p < directory.length;) {
      if (directory.readUInt32LE(p) !== 0x02014b50) throw Error('Invalid ZIP entry.');
      const names = directory.readUInt16LE(p + 28), extras = directory.readUInt16LE(p + 30), comment = directory.readUInt16LE(p + 32);
      const name = directory.toString('utf8', p + 46, p + 46 + names);
      let unpacked = directory.readUInt32LE(p + 24), compressed = directory.readUInt32LE(p + 20), start = directory.readUInt32LE(p + 42);
      const extra = directory.subarray(p + 46 + names, p + 46 + names + extras);
      for (let i = 0; i + 4 <= extra.length;) {
        const id = extra.readUInt16LE(i), count = extra.readUInt16LE(i + 2);
        if (id === 1) {
          let q = i + 4;
          if (unpacked === 0xffffffff) { unpacked = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (compressed === 0xffffffff) { compressed = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (start === 0xffffffff) start = Number(extra.readBigUInt64LE(q));
        }
        i += count + 4;
      }
      if ((directory.readUInt32LE(p + 38) >>> 16 & 0xf000) === 0xa000) throw Error('ZIP links are not supported.');
      result.push({ name, unpacked, compressed, start, method: directory.readUInt16LE(p + 10) });
      p += 46 + names + extras + comment;
    }
    return result;
  } finally { fs.closeSync(fd); }
}
function destination(root, relative) {
  if (relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => p === '..' || p === '.')) throw Error('Invalid ZIP file path.');
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('ZIP path leaves the game folder.');
  return file;
}
async function extract(file, root, select) {
  const chosen = new Map();
  for (const entry of entries(file)) {
    if (entry.name.endsWith('/')) continue;
    const match = select(entry.name);
    if (!match) continue;
    const target = destination(root, match.name);
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    if (!chosen.has(key) || match.priority >= chosen.get(key).priority) chosen.set(key, { ...entry, target, priority: match.priority });
  }
  const fd = fs.openSync(file, 'r');
  try {
    let count = 0;
    for (const entry of chosen.values()) {
      const target = entry.target;
      if (![0, 8].includes(entry.method)) throw Error('Unsupported ZIP compression.');
      const header = read(fd, entry.start, 30);
      if (header.readUInt32LE(0) !== 0x04034b50) throw Error('Invalid ZIP file header.');
      const start = entry.start + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!entry.compressed) fs.writeFileSync(target, '');
      else {
        const input = fs.createReadStream(file, { start, end: start + entry.compressed - 1 });
        const output = fs.createWriteStream(target);
        if (entry.method === 8) await pipeline(input, zlib.createInflateRaw(), output);
        else await pipeline(input, output);
      }
      if (fs.statSync(target).size !== entry.unpacked) throw Error('An extracted file has the wrong size.');
      if (++count % 5000 === 0) console.log(`Unpacking game files: ${count} / ${chosen.size}`);
    }
    return chosen.size;
  } finally { fs.closeSync(fd); }
}
function gameEntry(name) {
  const match = /^(original|derived)\/www\.poptropica\.com\/(.+)$/.exec(name);
  return match && { name: match[2] === 'avatarstudio' ? 'avatarstudio/index.html' : match[2], priority: match[1] === 'derived' ? 1 : 0 };
}
async function install(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/setup-downloads.json')));
  const cache = path.join(root, '.cache/setup'); fs.mkdirSync(cache, { recursive: true });
  const library = path.join(root, 'library', manifest.game.id);
  const marker = path.join(library, '.islandengine-library.json');
  const required = ['game/Shell.swf', 'gameplay.swf', 'framework.swf', 'framework/data/config.xml', 'ruffle/ruffle.js'];
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker)).sha256 === manifest.game.sha256 && required.every(f => fs.existsSync(path.join(library, f)))) return library;
  const disk = fs.statfsSync(root);
  const needed = 7e9 + (fs.existsSync(path.join(cache, manifest.game.id + '.zip')) ? 0 : manifest.game.size);
  if (disk.bavail * disk.bsize < needed) throw Error('Setup needs about 15 GB of free space for the game files and download.');
  console.log('The game download is about 6 GB. You can close setup and open it again to continue the download.');
  const game = await download(manifest.game, cache), ruffle = await download(manifest.ruffle, cache);
  if (fs.existsSync(library)) throw Error(`An incomplete game folder already exists at ${library}. Keep it or move it before running setup again.`);
  const staging = path.join(root, 'library', '.install-' + crypto.randomUUID());
  fs.mkdirSync(staging, { recursive: true });
  console.log('Unpacking the game files...');
  await extract(game, staging, gameEntry);
  await extract(ruffle, path.join(staging, 'ruffle'), name => ({ name, priority: 0 }));
  for (const file of required) if (!fs.existsSync(path.join(staging, file))) throw Error('The game archive is missing ' + file);
  fs.writeFileSync(path.join(staging, '.islandengine-library.json'), JSON.stringify({ source: manifest.game.url, sha256: manifest.game.sha256 }));
  fs.renameSync(staging, library);
  return library;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  install(root).then(library => {
    fs.writeFileSync(path.join(root, '.cache/setup/game-library.json'), JSON.stringify({ library }));
    console.log('Game files ready.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { download, entries, destination, extract, gameEntry, install };
