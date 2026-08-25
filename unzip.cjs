const fs = require('fs'), zlib = require('zlib'), path = require('path');
const [,, vsixFile, destDir] = process.argv;
if (!vsixFile || !destDir) { console.error('usage: node unzip.js <zip> <dest>'); process.exit(1); }
const buf = fs.readFileSync(vsixFile);
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.error('not a zip'); process.exit(1); }
const count = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
let extracted = 0;
for (let n = 0; n < count; n++) {
  if (buf.readUInt32LE(off) !== 0x02014b50) break;
  const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
  const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
  const lho = buf.readUInt32LE(off + 42);
  const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
  if (!name.endsWith('/')) {
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnlen + lelen;
    const raw = buf.slice(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    const out = path.join(destDir, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    extracted++;
  }
  off += 46 + nlen + elen + clen;
}
console.log(`extracted ${extracted} files -> ${destDir}`);
