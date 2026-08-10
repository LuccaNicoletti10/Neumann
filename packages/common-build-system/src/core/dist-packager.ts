import fs from "node:fs";
import path from "node:path";
import { SignedBuildManifest } from "../types";
import { HashedFile } from "../util/hash";
import { createTgz, TarEntry } from "../util/tar";

export interface PackagedDist {
  fileName: string;
  path: string;
  data: Buffer;
}

export class DistPackager {
  pack(
    manifest: SignedBuildManifest,
    sourceDir: string,
    files: HashedFile[]
  ): Omit<PackagedDist, "path"> {
    const entries: TarEntry[] = [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    ];
    for (const f of files) {
      entries.push({ name: `files/${f.path}`, data: fs.readFileSync(path.join(sourceDir, f.path)) });
    }
    const data = createTgz(entries);
    const fileName = `${manifest.product}-${manifest.version}.tgz`;
    return { fileName, data };
  }

  package(
    manifest: SignedBuildManifest,
    sourceDir: string,
    files: HashedFile[],
    outDir: string
  ): PackagedDist {
    const { fileName, data } = this.pack(manifest, sourceDir, files);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, data);
    return { fileName, path: outPath, data };
  }
}
