import zlib from "node:zlib";

export interface TarEntry {
  name: string;
  data: Buffer;
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function tarHeader(name: string, size: number): Buffer {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`Nome de entrada tar longo demais (sem suporte a prefixo ustar): ${name}`);
  }
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "ascii"); // mode
  header.write(octal(0, 8), 108, 8, "ascii"); // uid
  header.write(octal(0, 8), 116, 8, "ascii"); // gid
  header.write(octal(size, 12), 124, 12, "ascii"); // size
  header.write(octal(0, 12), 136, 12, "ascii"); // mtime = 0 (determinismo)
  header.write("        ", 148, 8, "ascii"); // checksum (espaços durante o cálculo)
  header.write("0", 156, 1, "ascii"); // typeflag: arquivo regular
  header.write("ustar\0", 257, 6, "ascii"); // magic
  header.write("00", 263, 2, "ascii"); // version
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

export function createTar(entries: TarEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const chunks: Buffer[] = [];
  for (const entry of sorted) {
    chunks.push(tarHeader(entry.name, entry.data.length));
    chunks.push(entry.data);
    const pad = (512 - (entry.data.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0)); // bloco final
  return Buffer.concat(chunks);
}

export function extractTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // bloco final
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, ""), 8);
    const typeflag = header.subarray(156, 157).toString("ascii");
    offset += 512;
    if (typeflag === "0" || typeflag === "\0") {
      entries.push({ name, data: Buffer.from(buf.subarray(offset, offset + size)) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function createTgz(entries: TarEntry[]): Buffer {
  return zlib.gzipSync(createTar(entries), { level: 9 });
}

export function extractTgz(buf: Buffer): TarEntry[] {
  return extractTar(zlib.gunzipSync(buf));
}
