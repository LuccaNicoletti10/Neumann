const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "b.txt"), "script-b depends on script-a\n", "utf8");
