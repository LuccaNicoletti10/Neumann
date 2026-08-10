const fs = require("node:fs");
const path = require("node:path");

const messagePath = path.join(__dirname, "out", "message.txt");
const metaPath = path.join(__dirname, "out", "meta.json");

if (!fs.existsSync(messagePath)) {
  console.error("FAIL: out/message.txt ausente");
  process.exit(1);
}
if (!fs.existsSync(metaPath)) {
  console.error("FAIL: out/meta.json ausente");
  process.exit(1);
}

const message = fs.readFileSync(messagePath, "utf8");
if (message !== "hello from script-a\n") {
  console.error("FAIL: conteúdo inesperado em message.txt");
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
if (meta.product !== "script-a" || meta.version !== "1.0.0") {
  console.error("FAIL: meta.json inválido", meta);
  process.exit(1);
}

console.log("OK: testes de script-a passaram");
