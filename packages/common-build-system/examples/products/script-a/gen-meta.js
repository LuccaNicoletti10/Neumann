const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const meta = {
  product: process.env.CBS_PRODUCT_NAME ?? "script-a",
  version: process.env.CBS_PRODUCT_VERSION ?? "1.0.0",
  schema: 1,
};
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
