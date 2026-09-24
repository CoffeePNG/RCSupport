const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runner = path.resolve(__dirname, '../deploy/ptero-runner.sh');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-startup-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const bin = path.join(root,'tools'); fs.mkdirSync(bin);
  const app = path.join(root,'app'); fs.mkdirSync(app);
  const log = path.join(root,'calls');
  const write = (name,content) => { const file=path.join(app,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); };
  write('package.json',JSON.stringify({scripts:{build:'tsc',start:'node dist/index.js'},dependencies:{'test-dep':'1'},devDependencies:{typescript:'1'}}));
  write('package-lock.json','{}'); write('tsconfig.json','{}'); write('src/index.ts','initial');
  fs.writeFileSync(path.join(bin,'npm'),`#!/usr/bin/env bash
set -eu
case "$*" in
  --version) printf '%s\\n' "\${MOCK_PM_VERSION:-10.0.0}" ;;
  ci*|install*)
    echo install >> "$TEST_LOG"
    if [[ "\${FAIL_INSTALL:-0}" == 1 ]]; then exit 21; fi
    mkdir -p node_modules/test-dep node_modules/typescript node_modules/.bin
    printf '{}' > node_modules/test-dep/package.json
    printf '{}' > node_modules/typescript/package.json
    touch node_modules/.bin/tsc
    ;;
  'run build')
    echo build >> "$TEST_LOG"
    if [[ "\${FAIL_BUILD:-0}" == 1 ]]; then exit 22; fi
    mkdir -p dist
    for file in src/*.ts; do cp "$file" "dist/$(basename "$file" .ts).js"; done
    ;;
  *) echo "unexpected npm arguments: $*" >&2; exit 99 ;;
esac
`,{mode:0o755});
  fs.writeFileSync(path.join(bin,'git'),`#!/usr/bin/env bash
set -eu
case "$*" in
  'rev-parse HEAD') cat "$MOCK_HEAD" ;;
  'branch --show-current') echo main ;;
  fetch*) if [[ "\${FAIL_FETCH:-0}" == 1 ]]; then exit 31; fi ;;
  merge*)
    if [[ "\${FAIL_MERGE:-0}" == 1 ]]; then exit 32; fi
    printf '%s\\n' "\${MOCK_NEW_HEAD:-a}" > "$MOCK_HEAD"
    ;;
  *) echo "unexpected git arguments: $*" >&2; exit 98 ;;
esac
`,{mode:0o755});
  const head=path.join(root,'head'); fs.writeFileSync(head,'a\n');
  const run = (extra={}) => spawnSync('bash',[runner],{encoding:'utf8',timeout:20000,env:{...process.env,
    PATH:bin+path.delimiter+process.env.PATH,SERVER_ROOT:app,TEST_LOG:log,MOCK_HEAD:head,
    PACKAGE_MANAGER:'npm',INSTALL_COMMAND:'auto',BUILD_COMMAND:'auto',AUTO_UPDATE:'0',
    INSTALL_ON_START:'0',BUILD_ON_START:'0',GIT_TOKEN:'',BOT_TOKEN:'',NODE_ENV:'production',
    START_COMMAND:'printf "start\\n" >> "$TEST_LOG"',...extra}});
  const ok = (extra={}) => {const result=run(extra); assert.equal(result.status,0,result.stdout+result.stderr); return result;};
  const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n'):[];
  const clear=()=>fs.writeFileSync(log,'');
  return {app,write,run,ok,calls,clear,npm:path.join(bin,'npm')};
}

test('bootstrap ignores legacy marker; unchanged/docs-only updates skip both; code only builds', t=>{
  const f=fixture(t); f.write('.ptero/deployed',''); f.ok();
  assert.deepEqual(f.calls(),['install','build','start']);
  f.clear(); f.ok(); assert.deepEqual(f.calls(),['start']);
  fs.mkdirSync(path.join(f.app,'.git')); f.write('README.md','docs only');
  f.clear(); f.ok({AUTO_UPDATE:'1',MOCK_NEW_HEAD:'b'}); assert.deepEqual(f.calls(),['start']);
  f.write('src/index.ts','changed source'); f.clear(); f.ok(); assert.deepEqual(f.calls(),['build','start']);
});

test('dependency/package-manager inputs and missing dependencies trigger install and rebuild',t=>{
  const f=fixture(t); f.ok();
  f.write('package-lock.json','{"changed":true}'); f.clear(); f.ok(); assert.deepEqual(f.calls(),['install','build','start']);
  f.clear(); f.ok({MOCK_PM_VERSION:'11.0.0'}); assert.deepEqual(f.calls(),['install','build','start']);
  fs.rmSync(path.join(f.app,'node_modules/test-dep'),{recursive:true});
  f.clear(); f.ok({MOCK_PM_VERSION:'11.0.0'}); assert.deepEqual(f.calls(),['install','build','start']);
});

test('missing/changed output is rebuilt and deleted source does not leave stale modules',t=>{
  const f=fixture(t); f.write('src/old.ts','old'); f.ok();
  fs.rmSync(path.join(f.app,'src/old.ts')); f.clear(); f.ok();
  assert.deepEqual(f.calls(),['build','start']); assert.equal(fs.existsSync(path.join(f.app,'dist/old.js')),false);
  fs.rmSync(path.join(f.app,'dist/index.js')); f.clear(); f.ok(); assert.deepEqual(f.calls(),['build','start']);
  f.write('dist/index.js','broken'); f.clear(); f.ok(); assert.deepEqual(f.calls(),['build','start']);
});

test('failed forced install invalidates old stamps and retries before starting',t=>{
  const f=fixture(t); f.ok(); f.clear();
  assert.equal(f.run({INSTALL_ON_START:'1',FAIL_INSTALL:'1'}).status,21);
  assert.deepEqual(f.calls(),['install']);
  f.clear(); f.ok(); assert.deepEqual(f.calls(),['install','build','start']);
});

test('failed forced build retries without reinstalling already valid dependencies',t=>{
  const f=fixture(t); f.ok(); f.clear();
  assert.equal(f.run({BUILD_ON_START:'1',FAIL_BUILD:'1'}).status,22);
  assert.deepEqual(f.calls(),['build']);
  f.clear(); f.ok(); assert.deepEqual(f.calls(),['build','start']);
});

test('Git fetch and fast-forward failures stop startup without installing, building or launching',t=>{
  const f=fixture(t); f.ok(); fs.mkdirSync(path.join(f.app,'.git'));
  for(const [key,code] of [['FAIL_FETCH',70],['FAIL_MERGE',71]]) {
    f.clear(); assert.equal(f.run({AUTO_UPDATE:'1',[key]:'1'}).status,code); assert.deepEqual(f.calls(),['']);
  }
});

test('skip does not certify install/build success and force flags remain supported',t=>{
  const f=fixture(t); f.ok({INSTALL_COMMAND:'skip',BUILD_COMMAND:'skip'});
  assert.deepEqual(f.calls(),['start']);
  assert.equal(fs.existsSync(path.join(f.app,'.ptero/install.sha256')),false);
  assert.equal(fs.existsSync(path.join(f.app,'.ptero/build.sha256')),false);
  f.clear(); f.ok(); assert.deepEqual(f.calls(),['install','build','start']);
  f.clear(); f.ok({BUILD_ON_START:'1'}); assert.deepEqual(f.calls(),['build','start']);
});

test('preserves configured token mapping and runtime environment',t=>{
  const f=fixture(t);
  f.ok({BOT_TOKEN:'test-only-value',TOKEN_ENV_NAME:'CUSTOM_TOKEN',SERVER_PORT:'28120',
    START_COMMAND:'test "$CUSTOM_TOKEN" = test-only-value && test "$NODE_ENV" = production && test "$PORT" = 28120 && printf "start\\n" >> "$TEST_LOG"'});
  assert.deepEqual(f.calls(),['install','build','start']);
});

test('custom install and build commands run conditionally and retry failures',t=>{
  const f=fixture(t);
  const env={MOCK_NPM_BIN:f.npm,INSTALL_COMMAND:'"$MOCK_NPM_BIN" ci --include=dev --no-audit --no-fund',BUILD_COMMAND:'"$MOCK_NPM_BIN" run build'};
  f.ok(env); assert.deepEqual(f.calls(),['install','build','start']);
  f.clear(); f.ok(env); assert.deepEqual(f.calls(),['start']);
  f.write('src/index.ts','custom-build-change'); f.clear(); f.ok(env); assert.deepEqual(f.calls(),['build','start']);
  f.clear(); assert.equal(f.run({...env,INSTALL_ON_START:'1',FAIL_INSTALL:'1'}).status,21);
  assert.deepEqual(f.calls(),['install']);
  f.clear(); f.ok(env); assert.deepEqual(f.calls(),['install','build','start']);
});

test('Node runtime version changes invalidate the dependency cache',t=>{
  const f=fixture(t); f.ok(); f.clear();
  // Simulate a changed Node identity without downloading or installing another runtime.
  f.write('mock-node-version.cjs',"Object.defineProperty(process,'version',{value:'v99.0.0-test'});");
  f.ok({NODE_OPTIONS:'--require='+path.join(f.app,'mock-node-version.cjs')});
  assert.deepEqual(f.calls(),['install','build','start']);
});
