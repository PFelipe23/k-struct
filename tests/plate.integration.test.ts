import { expect, it } from "vitest";
import {
  makePlateDeck,
  plateProject,
  readPlateResults,
} from "./fixtures/plate-benchmark";
import { exportAnalysis, parseAnalysisOutput } from "../src/solver/analysis";
import { navierPlateCenter } from "./fixtures/plate-navier";
import { runDeck } from "./fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;

it.skipIf(!executable)(
  "placa QDKT equilibra a pressão e converge para a série de Navier",
  () => {
    const reference = navierPlateCenter();
    const verticalLoad = -60_000;
    const meshes = [
      [8, 6],
      [16, 12],
      [32, 24],
    ] as const;
    const results = meshes.map(([nx, ny]) => {
      const input = makePlateDeck(nx, ny);
      const result = readPlateResults(runDeck(input.deck, executable!), input);
      return {
        mesh: `${nx} × ${ny}`,
        elements: input.mesh.cells.length,
        ...result,
        errors: {
          uz: Math.abs((result.uz - reference.uz) / reference.uz),
          mx: Math.abs((result.mx - reference.mx) / reference.mx),
          my: Math.abs((result.my - reference.my) / reference.my),
        },
      };
    });

    console.table(
      results.map(({ mesh, elements, rz, uz, mx, my, errors }) => ({
        Malha: mesh,
        Elementos: elements,
        "Σ Rz (kN)": (rz / 1000).toFixed(5),
        "Uz (mm)": (uz * 1000).toFixed(8),
        "Mx (kN·m/m)": (mx / 1000).toFixed(6),
        "My (kN·m/m)": (my / 1000).toFixed(6),
        "Erro Uz (%)": (100 * errors.uz).toFixed(4),
        "Erro Mx (%)": (100 * errors.mx).toFixed(4),
        "Erro My (%)": (100 * errors.my).toFixed(4),
      })),
    );

    for (const result of results)
      expect(Math.abs(result.rz + verticalLoad), result.mesh).toBeLessThan(3);

    const tolerances = { uz: 0.0005, mx: 0.001, my: 0.002 };
    for (const key of ["uz", "mx", "my"] as const) {
      const [coarse, medium, fine] = results.map(({ errors }) => errors[key]);
      expect(medium, `${key} na malha 16 × 12`).toBeLessThan(coarse / 2);
      expect(fine, `${key} na malha 32 × 24`).toBeLessThan(medium / 2);
      expect(fine, `${key} em relação à série de Navier`).toBeLessThan(
        tolerances[key],
      );
    }
  },
);

it.skipIf(!executable)(
  "laje sem pressão tem resposta nula e exige saída completa",
  () => {
    const project = plateProject(8, 6);
    project.loadPatterns[0].pressures = [];
    const input = exportAnalysis(project, "EL");
    const output = runDeck(input.deck, executable!);
    const slab = parseAnalysisOutput(output, input).slab!;
    expect(slab.rz).toBe(0);
    expect(slab.center).toEqual({ uz: 0, mx: 0, my: 0 });
    expect(slab.cells).toHaveLength(48);
    const missingStress = output.replace(
      /(GP\s+1\.4[^\n]*\n)[ \t]+stresses[^\n]*/,
      "$1",
    );
    expect(() => parseAnalysisOutput(missingStress, input)).toThrow(
      /Gauss incompletos/,
    );
  },
);
