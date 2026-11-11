const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const electron = path.join(repo, 'runtime/electron.exe');
const runtime = fs.existsSync(electron) ? electron : process.execPath;
const helper = path.join(repo, 'tools/setup-game-library.ps1');
function fixture(t, script) {
  const base = path.join(repo, '.cache/setup-tests'); fs.mkdirSync(base, {recursive:true});
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  t.after(() => { if (!root.startsWith(base + path.sep)) throw Error('Invalid fixture'); fs.rmSync(root, {recursive:true, force:true}); });
  fs.mkdirSync(path.join(root, 'tools'), {recursive:true});
  fs.mkdirSync(path.join(root, '.cache/setup'), {recursive:true});
  fs.writeFileSync(path.join(root, 'tools/game-library.cjs'), script);
  return root;
}
function run(root) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Root', root, '-Runtime', runtime], {encoding:'utf8', timeout:15000, windowsHide:true});
}
test('Windows setup waits for async installer and validates its handoff', {skip:process.platform !== 'win32'}, t => {
  const root=fixture(t, `const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');
    console.log('Installer started');setTimeout(()=>{const library=path.join(root,'library');
    for(const file of ['game/Shell.swf','ruffle/ruffle.js']){const dest=path.join(library,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'fixture');}
    fs.writeFileSync(path.join(root,'.cache/setup/game-library.json'),JSON.stringify({library}));console.log('Installer finished');},400);`);
  const result=run(root);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Installer finished/);
  assert.ok(result.stdout.includes(path.join(root,'library')));
  assert.ok(fs.existsSync(path.join(root,'.cache/setup/game-library.json')));
});
test('Windows setup rejects a successful exit without a fresh result', {skip:process.platform !== 'win32'}, t => {
  const root=fixture(t, 'setTimeout(()=>console.log("Closed early"),100);');
  fs.writeFileSync(path.join(root,'.cache/setup/game-library.json'),JSON.stringify({library:'stale'}));
  const result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/without reporting a game folder/);
  assert.equal(fs.existsSync(path.join(root,'.cache/setup/game-library.json')),false);
});
test('Windows setup reports installer failure instead of reading missing JSON', {skip:process.platform !== 'win32'}, t => {
  const root=fixture(t, 'setTimeout(()=>{process.exitCode=7},100);');
  const result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/Game setup stopped/);
  assert.doesNotMatch(result.stderr,/Cannot find path/);
});
