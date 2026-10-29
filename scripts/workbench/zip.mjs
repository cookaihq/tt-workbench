import { deflateRawSync } from 'node:zlib';
import packages from '../../lib/workbench/package.cjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

// A standard ZIP with UTF-8 names, one plugin directory and no extra files.
// Package limits (2,000 files / 64 MiB) keep sizes and offsets below ZIP64 limits.
export function encodePluginZip(bundle) {
  const release = packages.parseRelease(JSON.stringify(bundle.release));
  packages.validateFiles(release, bundle.files);
  const files = new Map(bundle.files);
  files.set('release.json', Buffer.from(JSON.stringify(release, null, 2) + '\n'));
  const entries = [], directory = [];
  let offset = 0;
  for (const name of [...files.keys()].sort()) {
    const filename = Buffer.from(`${packages.ID}/${name}`, 'utf8');
    if (filename.length > 0xffff) throw Error('ZIP 文件名过长：' + name);
    const bytes = files.get(name), compressed = deflateRawSync(bytes), checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // ZIP 2.0, raw DEFLATE.
    local.writeUInt16LE(0x0800, 6); // UTF-8, including Chinese template names.
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01; fixed metadata for repeatable builds.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // MS-DOS creator; no host-specific permissions.
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    entries.push(local, filename, compressed);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, centralDirectory, end]);
}
