import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const pin = JSON.parse(
  readFileSync(
    new URL("../crates/solver-runner/oofem.json", import.meta.url),
    "utf8",
  ),
);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const check = (condition, failure) => {
  if (!condition) throw new Error(failure);
};
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = (file) => checksum(readFileSync(file));

const report = readJson(process.argv[2]);
const { engine } = report;
check(report.ok, report.message);
check(
  engine?.origin === "bundled",
  "A instalação precisa localizar seu próprio OOFEM.",
);
check(
  engine.version === pin.version && engine.commit === pin.commit,
  "Versão ou commit inesperado.",
);
const dir = dirname(engine.path);
const manifest = readJson(join(dir, "manifest.json"));
check(
  manifest.arch === "x64" && manifest.platform === process.platform,
  "Plataforma do motor divergente.",
);
check(
  engine.path === join(dir, manifest.payload) &&
    hash(engine.path) === manifest.payloadSha256,
  "O arquivo do motor não corresponde ao manifesto.",
);
const resource = readFileSync(engine.path);
const executable =
  process.platform === "linux"
    ? gunzipSync(resource, { maxOutputLength: 64 * 1024 * 1024 })
    : resource;
check(
  checksum(executable) === manifest.sha256 && engine.sha256 === manifest.sha256,
  "SHA-256 do executável divergente.",
);
const expectedSource = `oofem-${pin.version}-source.zip`;
check(
  manifest.sourceArchive === expectedSource &&
    hash(join(dir, expectedSource)) === manifest.sourceSha256,
  "Fontes correspondentes ausentes ou alteradas.",
);
for (const file of [
  "BUILD.txt",
  "COPYING.LGPLv2.1",
  "OOFEM-README.txt",
  "THIRD_PARTY_NOTICES.md",
]) {
  check(
    statSync(join(dir, file)).size > 0,
    `Arquivo obrigatório ausente: ${file}`,
  );
}
const { leftReactionN, rightReactionN, midspanUzM } = report.benchmark;
check(
  Math.abs(leftReactionN - 30000) < 0.1 &&
    Math.abs(rightReactionN - 30000) < 0.1,
  "Reações divergentes.",
);
check(Math.abs(midspanUzM + 0.0084375) < 1e-8, "Flecha divergente.");
console.log(
  `Validado no pacote: OOFEM ${engine.version}, ${engine.commit}, RA=${leftReactionN} N, RB=${rightReactionN} N, UZ=${midspanUzM} m`,
);
