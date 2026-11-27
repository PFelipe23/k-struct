import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildAnalysisReport,
  modelFingerprint,
  renderAnalysisReport,
  type ReportSnapshot,
} from "../src/solver/analysisReport";
import { beamExample } from "../src/domain/model";
import { buildResultCsv } from "../src/components/Results";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { DEFAULT_UNITS } from "../src/units";
import { reportCaseStatus } from "../src/solver/reportRuns";
import { runDeck } from "./fixtures/solve-oofem";

function example(): ReportSnapshot {
  const project = beamExample();
  return {
    project,
    revision: 9,
    results: new Map(),
    runs: new Map(),
    units: DEFAULT_UNITS,
    issuedAt: "2026-01-01T10:00:00.000Z",
    options: {
      sources: ["case:EL"],
      tables: ["forces", "displacements", "reactions"],
      geometry: true,
      diagramMemberId: "V1",
    },
  };
}

it("identifica o conteúdo em SHA-256 e registra casos cancelados e obsoletos", async () => {
  const snapshot = example(),
    p = snapshot.project;
  const fingerprint = await modelFingerprint(p);
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(await modelFingerprint(structuredClone(p))).toBe(fingerprint);
  p.analysisCases.push({ ...p.analysisCases[0], id: "V", name: "Variável" });
  snapshot.options.sources.push("case:V");
  snapshot.runs = new Map([
    [
      "EL",
      {
        projectId: p.id,
        revision: 9,
        status: "cancelled",
        detail: "Análise cancelada.",
        warnings: [],
      },
    ],
    [
      "V",
      {
        projectId: p.id,
        revision: 8,
        status: "completed",
        detail: "Concluído",
        warnings: ["Histórico de revisão anterior."],
      },
    ],
  ]);
  const definition = await buildAnalysisReport(snapshot);
  const body = JSON.stringify(definition.content);
  expect(body).toContain("Cancelado");
  expect(body).toContain("Revisão anterior · reanálise pendente");
  expect(body).toContain("Aviso");
  expect(reportCaseStatus("outro", 9, snapshot.runs.get("EL"), false)).toBe(
    "Pendente de análise",
  );
  expect(await modelFingerprint(p)).not.toBe(fingerprint);
});

const executable = process.env.OOFEM_BIN;
const poppler =
  spawnSync("pdftotext", ["-v"], { stdio: "ignore" }).status === 0;

describe.skipIf(!executable || !poppler)(
  "PDF da viga com OOFEM 3.0 e extração pelo Poppler",
  () => {
    it("extrai reações e momento iguais ao CSV e repete o cabeçalho nas páginas", async () => {
      const snapshot = example(),
        p = snapshot.project;
      // Preserve the same loading while forcing multi-page tables.
      p.mesh.segmentsPerMember = 32;
      p.analysisCases.push({
        ...p.analysisCases[0],
        id: "V",
        name: "Ação vinculada",
      });
      p.resultCombinations.push({
        id: "C",
        name: "Combinação de conferência",
        type: "linear",
        factors: [
          { caseId: "EL", factor: 1 },
          { caseId: "V", factor: 0 },
        ],
      });
      snapshot.options.sources.push("case:V", "combination:C");
      const input = exportOofem(p, "EL"),
        result = parseOofemOutput(runDeck(input.deck, executable!), input);
      snapshot.results = new Map([["EL", result]]);
      snapshot.runs = new Map([
        [
          "EL",
          {
            projectId: p.id,
            revision: 9,
            status: "completed",
            detail: "Concluído",
            warnings: ["Aviso de conferência com acentuação"],
          },
        ],
      ]);
      const data = await renderAnalysisReport(snapshot);
      const extract = (bytes: Uint8Array) =>
        execFileSync("pdftotext", ["-layout", "-", "-"], {
          input: bytes,
          encoding: "utf8",
        });
      const printed = extract(data);
      const hash = await modelFingerprint(p);
      expect(printed).toContain("Relatório de análise");
      expect(printed).toContain("Aviso de conferência com acentuação");
      expect(printed).toContain(hash);
      expect(printed).toContain("RZ global (kN)");
      expect(printed).toMatch(/\[A\]\s+N1\s+0\s+30\s+0/);
      expect(printed).toMatch(/\[B\]\s+N2\s+0\s+30\s+0/);
      expect(printed).toContain("M (kN·m)");
      expect(printed).toMatch(/\[V1\]\s+B1\s+0,5\s+0\s+0\s+45/);
      expect(printed).toContain("Figura · Geometria de referência");
      expect(printed).toContain("Figura · M (kN·m)");
      expect(printed).toContain("Equilíbrio global verificado");
      expect(printed).toContain("Pendente de análise");
      expect(printed).toContain("Combinação de conferência");
      expect(
        printed.match(/Nó \/ estação|x\/L\s+N \(kN\)/g)?.length,
      ).toBeGreaterThan(4);
      expect(printed.match(/Página \d+ de \d+/g)?.length).toBeGreaterThan(2);
      const csvView = {
        kind: "case" as const,
        definition: p.analysisCases[0],
        result,
      };
      expect(buildResultCsv(p, csvView, "reactions")).toMatch(/"N1";0;30;0/);
      expect(buildResultCsv(p, csvView, "forces")).toMatch(
        /"B1";0\.5;0;[^;]+;45;/,
      );

      const another = await renderAnalysisReport({
        ...snapshot,
        issuedAt: "2026-01-02T10:00:00.000Z",
      });
      const technical = (text: string) =>
        text.replace(/Emissão \S+ \(UTC\)/, "Emissão");
      expect(technical(extract(another))).toBe(technical(printed));
    });
  },
);
