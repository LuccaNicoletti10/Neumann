import fs from "node:fs";
import path from "node:path";
import { BuildManifest, buildManifestSchema } from "../types";

export const MANIFEST_FILENAME = "build.manifest.json";

export function loadManifest(productDir: string): BuildManifest {
  const manifestPath = path.join(productDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Produto sem ${MANIFEST_FILENAME}: ${productDir}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return buildManifestSchema.parse(raw);
}

export function loadAllManifests(productsDir: string): BuildManifest[] {
  if (!fs.existsSync(productsDir)) return [];
  const manifests: BuildManifest[] = [];
  for (const entry of fs.readdirSync(productsDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(productsDir, entry.name);
    if (fs.existsSync(path.join(dir, MANIFEST_FILENAME))) {
      manifests.push(loadManifest(dir));
    }
  }
  return manifests;
}
