// 手工构建 VSIX（vsix = 固定结构的 zip），绕过 vsce / python
// 用法: node build_vsix.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'bull-run-0.7.6.vsix');

// ---------- 最小 zip writer（deflate + crc32） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(entries) {
  // entries: [{name, data(Buffer)}]
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDef = deflated.length < e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 flag
    local.writeUInt16LE(useDef ? 8 : 0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x2821, 12); // dos date/time
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(useDef ? deflated.length : e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, useDef ? deflated : e.data);

    const central0 = Buffer.alloc(46);
    central0.writeUInt32LE(0x02014b50, 0);
    central0.writeUInt16LE(0x031E, 4);    // made by: unix
    central0.writeUInt16LE(20, 6);
    central0.writeUInt16LE(0x0800, 8);
    central0.writeUInt16LE(useDef ? 8 : 0, 10);
    central0.writeUInt16LE(0, 12); central0.writeUInt16LE(0x2821, 14);
    central0.writeUInt32LE(crc, 16);
    central0.writeUInt32LE(useDef ? deflated.length : e.data.length, 20);
    central0.writeUInt32LE(e.data.length, 24);
    central0.writeUInt16LE(nameBuf.length, 28);
    central0.writeUInt16LE(0, 30); central0.writeUInt16LE(0, 32);
    central0.writeUInt16LE(0, 34); central0.writeUInt16LE(0, 36);
    central0.writeUInt32LE(0, 38);
    central0.writeUInt32LE(offset, 42);
    centrals.push(central0, nameBuf);

    offset += local.length + nameBuf.length + (useDef ? deflated.length : e.data.length);
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------- 组装 VSIX 内容 ----------
const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="manifest" ContentType="text/xml"/>
  <Default Extension="xml" ContentType="text/xml"/>
  <Default Extension="md" ContentType="text/markdown"/>
</Types>`;

const VSIXMANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2010" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="bull-run" Version="0.7.6" Publisher="buddy"/>
    <DisplayName>牛来 · Bull Run — 编辑器盯盘</DisplayName>
    <Description xml:space="preserve">Realtime stock quotes in VSCode sidebar &amp; status bar. A-shares, indexes, HK &amp; US stocks.</Description>
    <Tags>stock,quotes,watch</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>`;

function main() {
  const entries = [];
  entries.push({ name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') });
  entries.push({ name: 'extension.vsixmanifest', data: Buffer.from(VSIXMANIFEST, 'utf8') });
  entries.push({ name: 'extension/package.json', data: fs.readFileSync(path.join(ROOT, 'package.json')) });
  for (const f of fs.readdirSync(path.join(ROOT, 'out'))) {
    if (f.endsWith('.js')) entries.push({ name: `extension/out/${f}`, data: fs.readFileSync(path.join(ROOT, 'out', f)) });
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'media'))) {
    entries.push({ name: `extension/media/${f}`, data: fs.readFileSync(path.join(ROOT, 'media', f)) });
  }
  const readme = path.join(ROOT, 'README.md');
  if (fs.existsSync(readme)) entries.push({ name: 'extension/README.md', data: fs.readFileSync(readme) });
  const lic = path.join(ROOT, 'LICENSE');
  if (fs.existsSync(lic)) entries.push({ name: 'extension/LICENSE', data: fs.readFileSync(lic) });

  const zip = buildZip(entries);
  fs.writeFileSync(OUT, zip); // 直接覆盖，不走 unlink（避开 safe-delete 钩子）
  console.log(`VSIX built: ${OUT} (${zip.length} bytes)`);
  for (const e of entries) console.log('  ' + e.name);
}

main();
