const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
// Conteúdo determinístico — sem Date.now() / random
fs.writeFileSync(
  path.join(outDir, "message.txt"),
  "hello from script-a\n",
  "utf8"
);
