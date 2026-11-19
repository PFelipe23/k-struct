import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const pin = JSON.parse(
  readFileSync(
    new URL("../crates/solver-runner/oofem.json", import.meta.url),
    "utf8",
  ),
);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const require = (value, failure) => {
  if (!value) throw new Error(failure);
};
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const report = readJson(process.argv[2]);
const { engine } = report;
require(report.ok, report.message);
require(engine?.origin ===
  "bundled", "A instalação precisa localizar seu próprio OOFEM.");
require(engine.version === pin.version &&
  engine.commit === pin.commit, "Versão ou commit inesperado.");
const dir = dirname(engine.path);
const manifest = readJson(join(dir, "manifest.json"));
require(manifest.arch === "x64" &&
  manifest.platform === process.platform, "Plataforma do motor divergente.");
require(hash(engine.path) === manifest.sha256 &&
  engine.sha256 === manifest.sha256, "SHA-256 do executável divergente.");
const expectedSource = `oofem-${pin.version}-source.zip`;
require(manifest.sourceArchive === expectedSource &&
  hash(join(dir, expectedSource)) ===
    manifest.sourceSha256, "Fontes correspondentes ausentes ou alteradas.");
for (const file of [
  "BUILD.txt",
  "COPYING.LGPLv2.1",
  "OOFEM-README.txt",
  "THIRD_PARTY_NOTICES.md",
]) {
  require(statSync(join(dir, file)).size >
    0, `Arquivo obrigatório ausente: ${file}`);
}
const { leftReactionN, rightReactionN, midspanUzM } = report.benchmark;
require(Math.abs(leftReactionN - 30000) < 0.1 &&
  Math.abs(rightReactionN - 30000) < 0.1, "Reações divergentes.");
require(Math.abs(midspanUzM + 0.0084375) < 1e-8, "Flecha divergente.");
console.log(
  `Validado no pacote: OOFEM ${engine.version}, ${engine.commit}, RA=${leftReactionN} N, RB=${rightReactionN} N, UZ=${midspanUzM} m`,
);
