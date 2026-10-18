import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---- 平台配置 ----
const PLATFORMS = {
  win: {
    name: 'win-x64',
    packageName: 'MetaDesk-win-x64',
    nodeUrl: 'https://nodejs.org/dist/v20.20.2/node-v20.20.2-win-x64.zip',
    nodeExtract: 'unzip',
    nodeInnerDir: 'node-v20.20.2-win-x64',
    sqliteFile: 'better-sqlite3-v11.10.0-node-v115-win32-x64.tar.gz',
  },
  mac: {
    name: 'macos-arm64',
    packageName: 'MetaDesk-macos-arm64',
    nodeUrl: 'https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-arm64.tar.gz',
    nodeExtract: 'tar',
    nodeInnerDir: 'node-v20.20.2-darwin-arm64',
    sqliteFile: 'better-sqlite3-v11.10.0-node-v115-darwin-arm64.tar.gz',
  },
};

const PLATFORM = process.argv[2] || 'win';
const CFG = PLATFORMS[PLATFORM];
if (!CFG) {
  console.error('用法: node scripts/package.mjs [win|mac]');
  process.exit(1);
}

const ROOT = process.cwd();
const RELEASE = path.join(ROOT, 'release');
const NODE_ABI = '115'; // Node 20 ABI
const BETTER_SQLITE_VERSION = '11.10.0';

function sh(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cpDir(src, dst) {
  fs.cpSync(src, dst, { recursive: true });
}

function findEsbuild() {
  const candidates = [
    path.join(ROOT, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild'),
    path.join(ROOT, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const found = execSync('find node_modules/.pnpm -path "*esbuild/bin/esbuild" -type f | head -1', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (found) return found;
  throw new Error('未找到 esbuild 二进制');
}

// ---- 1. 清理 ----
rmrf(RELEASE);
fs.mkdirSync(path.join(RELEASE, 'server/node_modules'), { recursive: true });

// ---- 2. 构建前端（隐藏⑤⑥） ----
process.env.VITE_DISABLE_EXTRACTION = '1';
sh('pnpm --filter @meta/web build');

// ---- 3. 打包后端为单文件（CJS 格式；源码已兼容 __dirname） ----
const esbuild = findEsbuild();
const entry = path.join(ROOT, 'apps/server/src/index.ts');
const outfile = path.join(RELEASE, 'server/index.cjs');
sh(`${JSON.stringify(esbuild)} ${JSON.stringify(entry)} --bundle --platform=node --format=cjs --target=node20 --external:better-sqlite3 --outfile=${JSON.stringify(outfile)} --log-level=warning`);

// ---- 4. 复制前端产物 ----
cpDir(path.join(ROOT, 'apps/web/dist'), path.join(RELEASE, 'web'));

// ---- 5. 下载 Node 运行时 ----
const nodeArchive = path.join(ROOT, 'release/node-archive');
console.log('下载 Node 运行时…');
execSync(`curl -sSL --retry 3 -o ${JSON.stringify(nodeArchive)} ${JSON.stringify(CFG.nodeUrl)}`, { stdio: 'inherit', cwd: ROOT, timeout: 10 * 60 * 1000 });
if (CFG.nodeExtract === 'unzip') {
  execSync(`unzip -q ${JSON.stringify(nodeArchive)} -d ${JSON.stringify(RELEASE)}`, { stdio: 'inherit' });
} else {
  execSync(`tar xzf ${JSON.stringify(nodeArchive)} -C ${JSON.stringify(RELEASE)}`, { stdio: 'inherit' });
}
fs.renameSync(path.join(RELEASE, CFG.nodeInnerDir), path.join(RELEASE, 'node'));
rmrf(nodeArchive);

// ---- 6. better-sqlite3（JS 包装 + 平台二进制） ----
const bs3Src = path.join(ROOT, 'apps/server/node_modules/better-sqlite3');
const bs3Dst = path.join(RELEASE, 'server/node_modules/better-sqlite3');
fs.mkdirSync(bs3Dst, { recursive: true });
cpDir(path.join(bs3Src, 'lib'), path.join(bs3Dst, 'lib'));
for (const f of ['package.json', 'LICENSE']) fs.copyFileSync(path.join(bs3Src, f), path.join(bs3Dst, f));
const bs3Tar = path.join(ROOT, 'release/bs3.tar.gz');
const bs3Url = `https://registry.npmmirror.com/-/binary/better-sqlite3/v${BETTER_SQLITE_VERSION}/${CFG.sqliteFile}`;
console.log('下载 better-sqlite3 二进制…');
execSync(`curl -sSL --retry 3 -o ${JSON.stringify(bs3Tar)} ${JSON.stringify(bs3Url)}`, { stdio: 'inherit', cwd: ROOT, timeout: 5 * 60 * 1000 });
fs.mkdirSync(path.join(bs3Dst, 'build/Release'), { recursive: true });
execSync(`tar xzf ${JSON.stringify(bs3Tar)} -C ${JSON.stringify(bs3Dst)}`, { stdio: 'inherit' });
rmrf(bs3Tar);

// ---- 7. bindings + file-uri-to-path ----
cpDir(path.join(ROOT, 'node_modules/.pnpm/bindings@1.5.0/node_modules/bindings'), path.join(RELEASE, 'server/node_modules/bindings'));
cpDir(path.join(ROOT, 'node_modules/.pnpm/file-uri-to-path@1.0.0/node_modules/file-uri-to-path'), path.join(RELEASE, 'server/node_modules/file-uri-to-path'));

// ---- 8. 启动器 + 说明 ----
if (PLATFORM === 'win') {
  fs.writeFileSync(
    path.join(RELEASE, 'start.bat'),
    [
      '@echo off',
      'cd /d "%~dp0"',
      'set "META_DATA_DIR=%~dp0data"',
      'set "WEB_DIST=%~dp0web"',
      'set "HOST=127.0.0.1"',
      'set "PORT=8787"',
      'echo 正在启动 MetaDesk，浏览器将自动打开 http://127.0.0.1:8787',
      'echo 关闭此窗口即停止服务。',
      'start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8787"',
      '"%~dp0node\\node.exe" "%~dp0server\\index.cjs"',
      'pause >nul',
      '',
    ].join('\r\n'),
  );
} else {
  const cmd = [
    '#!/bin/bash',
    'cd "$(dirname "$0")"',
    'export META_DATA_DIR="$(pwd)/data"',
    'export WEB_DIST="$(pwd)/web"',
    'export HOST="127.0.0.1"',
    'export PORT="8787"',
    'echo "正在启动 MetaDesk，浏览器将自动打开 http://127.0.0.1:8787"',
    'echo "关闭此窗口（Ctrl+C）即停止服务。"',
    '( sleep 2; open "http://127.0.0.1:8787" ) &',
    '"$(pwd)/node/bin/node" "$(pwd)/server/index.cjs"',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(RELEASE, 'start.command'), cmd);
  fs.chmodSync(path.join(RELEASE, 'start.command'), 0o755);
}

const note = PLATFORM === 'win' ? '双击 start.bat 即可启动' : '双击 start.command 即可启动（首次若被 Gatekeeper 拦截，右键 → 打开）';
fs.writeFileSync(
  path.join(RELEASE, 'README.txt'),
  [
    `MetaDesk 便携版（${CFG.name}）`,
    '================================',
    '',
    `${note}，浏览器会自动打开 http://127.0.0.1:8787`,
    '',
    '本版本包含前 4 阶段：',
    '  ① 协议制定  ② 检索策略  ③ 初筛判断  ④ 全文判断',
    '（⑤ 全文数据提取、⑥ 结果 暂未包含）',
    '',
    '说明：',
    '  - 所有数据保存在本目录的 data/ 文件夹内，可直接查看、备份。',
    '  - 关闭启动窗口即停止服务。',
    '  - 首次使用请在「设置」里配置大模型 API（OpenAI 兼容接口）。',
    '',
  ].join('\r\n'),
);

// ---- 9. 打 zip ----
const zipName = `${CFG.packageName}.zip`;
const zipPath = path.join(ROOT, zipName);
rmrf(zipPath);
sh(`cd ${JSON.stringify(RELEASE)} && zip -qr ${JSON.stringify(zipPath)} .`);

console.log(`\n✅ 打包完成：${zipPath}`);
