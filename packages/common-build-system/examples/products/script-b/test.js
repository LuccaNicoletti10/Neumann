const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "out", "b.txt");
if (!fs.existsSync(out)) {
  console.error("FAIL: out/b.txt ausente");
  process.exit(1);
}
const content = fs.readFileSync(out, "utf8");
if (!content.includes("script-b")) {
  console.error("FAIL: conteúdo inesperado");
  process.exit(1);
}
console.log("OK: testes de script-b passaram");
