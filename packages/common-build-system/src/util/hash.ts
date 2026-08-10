import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface HashedFile {
  path: string;
  hash: string;
  size: number;
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function hashOutputs(rootDir: string, outputs: string[]): HashedFile[] {
  const files: HashedFile[] = [];
  for (const out of outputs) {
    const abs = path.join(rootDir, out);
    if (!fs.existsSync(abs)) {
      throw new Error(`Output declarado não encontrado após o build: ${out}`);
    }
    collect(abs, rootDir, files);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

function collect(abs: string, root: string, files: HashedFile[]): void {
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const entry of fs.readdirSync(abs).sort()) {
      collect(path.join(abs, entry), root, files);
    }
    return;
  }
  const rel = path.relative(root, abs).split(path.sep).join("/");
  files.push({ path: rel, hash: sha256Hex(fs.readFileSync(abs)), size: st.size });
}

export function computeArtifactHash(files: HashedFile[]): string {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f.path);
    h.update("\0");
    h.update(f.hash);
    h.update("\n");
  }
  return h.digest("hex");
}
