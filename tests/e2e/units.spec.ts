import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { exportOofem } from "../../src/solver/oofem";
import { DEFAULT_UNITS, type UnitPreferences } from "../../src/units";
import { runDeck } from "../fixtures/solve-oofem";
import { spatialBenchmark } from "../fixtures/spatial-benchmark";

// Only the native IPC boundary is replaced in browser tests. With OOFEM_BIN,
// this output is produced by the pinned real solver; otherwise it is the
// existing captured benchmark. Production never substitutes a solver result.
const referenceBeam = beamExample();
const beamOutput = process.env.OOFEM_BIN
  ? runDeck(
      exportOofem(referenceBeam, referenceBeam.analysisCases[0].id).deck,
      process.env.OOFEM_BIN,
    )
  : readFileSync(
      new URL("../fixtures/beam-oofem.txt", import.meta.url),
      "utf8",
    );

async function nativeBeam(page: Page) {
  await page.addInitScript((output) => {
    const w = window as unknown as {
      isTauri: boolean;
      unitsAnalysisCalls: number;
      __TAURI_INTERNALS__: {
        transformCallback: () => number;
        invoke: (
          command: string,
          args: {
            runContext: {
              runId: string;
              projectName: string;
              caseName: string;
            };
            response: { onmessage: (value: unknown) => void };
          },
        ) => Promise<unknown>;
      };
    };
    w.isTauri = true;
    w.unitsAnalysisCalls = 0;
    let callback = 0;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++callback,
      invoke: async (command, args) => {
        if (command !== "start_oofem")
          throw new Error(`Unexpected IPC: ${command}`);
        w.unitsAnalysisCalls++;
        args.response.onmessage({
          output,
          historyError: null,
          log: {
            summary: {
              ...args.runContext,
              startedAt: Date.now(),
              durationMs: 1,
              status: "completed",
              message: "Execução concluída.",
              engine: {
                origin: "environment",
                path: "/test/oofem",
                version: "3.0",
                commit: "214b161",
                sha256: null,
              },
            },
            stdout: "",
            stderr: "",
            logTruncated: false,
          },
        });
      },
    };
  }, beamOutput);
}

async function units(
  page: Page,
  changes: Partial<UnitPreferences>,
  cancel = false,
) {
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByRole("button", { name: "Unidades", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unidades", exact: true });
  const labels = {
    length: "Comprimentos",
    section: "Dimensões de seção",
    displacement: "Deslocamentos",
    force: "Forças",
    moment: "Momentos",
    distributedLoad: "Cargas distribuídas",
    modulus: "Módulo de elasticidade",
  };
  for (const [key, value] of Object.entries(changes))
    await dialog
      .getByRole("combobox", {
        name: labels[key as keyof typeof labels],
        exact: true,
      })
      .selectOption(value);
  await dialog
    .getByRole("button", {
      name: cancel ? "Cancelar" : "Aplicar unidades",
      exact: true,
    })
    .click();
}

async function download(page: Page, name: string) {
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  if (name === "Entrada OOFEM")
    await page.getByRole("button", { name: "Análise", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}

const draft = (page: Page) =>
  page.evaluate(() => localStorage.getItem("kstruct.draft.v7"));

test("unidades preservam análise, geometria, entrada OOFEM e CSV padrão", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await nativeBeam(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("Análise concluída");
  await page.getByLabel("Visualização dos resultados").selectOption("deformed");
  const geometry = await page
    .locator(".elevation polyline")
    .getAttribute("points");
  const before = (await draft(page))!;
  await page.getByRole("button", { name: "Reações", exact: true }).click();
  const csvDefault = await download(page, "CSV");
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  const deckBefore = await download(page, "Entrada OOFEM");
  await units(page, {
    length: "cm",
    section: "mm",
    displacement: "m",
    force: "N",
    moment: "N·m",
    distributedLoad: "N/m",
    modulus: "MPa",
  });
  await expect(page.locator(".status-bar")).toContainText("Análise concluída");
  expect(await draft(page)).toBe(before);
  expect(await page.locator(".elevation polyline").getAttribute("points")).toBe(
    geometry,
  );
  await expect(
    page.getByRole("columnheader", { name: "RZ (N)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "30.000", exact: true }),
  ).toHaveCount(2);
  const csvN = await download(page, "CSV");
  expect(csvN).toContain('"RZ (N)"');
  expect(csvN).toContain("30000");
  await page
    .getByRole("button", { name: "Deslocamentos", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "-0,0084375", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("columnheader", { name: "RY (mrad)", exact: true }),
  ).toBeVisible();
  const deckAfter = await download(page, "Entrada OOFEM");
  expect(deckAfter).toBe(deckBefore);
  await units(page, DEFAULT_UNITS);
  await page.getByRole("button", { name: "Reações", exact: true }).click();
  expect(await download(page, "CSV")).toBe(csvDefault);
  expect(await draft(page)).toBe(before);
  await units(page, { section: "m" });
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(page.locator(".section-preview")).toContainText("A = 0,03 m²");
  await expect(page.locator(".section-preview")).toContainText(
    "IY = 0,0001 m⁴",
  );
  await expect(page.locator(".status-bar")).toContainText("Análise concluída");
  expect(await draft(page)).toBe(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { unitsAnalysisCalls: number })
          .unitsAnalysisCalls,
    ),
  ).toBe(1);
});

test("edição usa centímetros e MPa, salva SI e recarrega a preferência", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await units(page, { length: "cm", modulus: "MPa" });
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(page.getByLabel("Módulo E", { exact: true })).toHaveValue(
    "200000",
  );
  await page.getByLabel("Largura b", { exact: true }).fill("15,5");
  await page.getByLabel("Largura b", { exact: true }).press("Tab");
  const project = parseProject((await draft(page))!);
  expect(project.sections[0].width).toBe(0.155);
  const content = await download(page, "Salvar projeto");
  expect(parseProject(content).sections[0].width).toBe(0.155);
  await page.reload();
  expect(parseProject((await draft(page))!).sections[0].width).toBe(0.155);
  const prefs = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kstruct.units")!),
  );
  expect(prefs.length).toBe("cm");
  expect(prefs.modulus).toBe("MPa");
  await page
    .locator(".explorer")
    .getByRole("button", { name: /^N2\b/ })
    .click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("600");
  const before = (await draft(page))!;
  await page.getByLabel("X", { exact: true }).focus();
  await page.getByLabel("X", { exact: true }).press("Tab");
  expect(await draft(page)).toBe(before);
  await units(page, { length: "mm" });
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("6000");
  await units(page, { length: "m" });
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("6");
  expect(serializeProject(parseProject((await draft(page))!))).toBe(
    serializeProject(parseProject(before)),
  );
});

test("cancelar unidades e aplicar tabela em cm preserva um único histórico", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  const before = (await draft(page))!;
  await units(page, { length: "mm", force: "N" }, true);
  expect(await draft(page)).toBe(before);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("kstruct.units")!).length,
    ),
  ).toBe("m");
  await units(page, { length: "cm" });
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Tabela de nós",
    exact: true,
  });
  await expect(
    dialog.getByRole("columnheader", { name: "X (cm)", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("X de N2", { exact: true }).fill("650,5");
  await dialog.getByRole("button", { name: "Aplicar", exact: true }).click();
  expect(
    parseProject((await draft(page))!).nodes.find(({ name }) => name === "N2")!
      .x,
  ).toBe(6.505);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  expect(serializeProject(parseProject((await draft(page))!))).toBe(
    serializeProject(parseProject(before)),
  );
});

test("unidades atualizam cargas 3D e preservam a câmera após orbitar", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "portico.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(spatialBenchmark())),
  });
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByLabel("Arranjo de vistas").selectOption("triple");
  const perspective = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  await perspective
    .getByRole("button", { name: "Nomes dos objetos", exact: true })
    .click();
  await perspective
    .getByRole("button", { name: "Cargas", exact: true })
    .click();
  const forceLabel = perspective
    .locator(".scene-label")
    .filter({ hasText: "FY 12 kN" });
  await expect(forceLabel).toHaveCount(1);
  const anchor = () =>
    forceLabel.evaluate((element) => (element as HTMLElement).style.transform);
  const initialAnchor = await anchor();
  expect(initialAnchor).not.toBe("");
  const bounds = (await perspective.locator("canvas").boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.4,
    bounds.y + bounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.52,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(anchor).not.toBe(initialAnchor);
  await expect
    .poll(() =>
      forceLabel.evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const before = (element as HTMLElement).style.transform;
            requestAnimationFrame(() =>
              resolve((element as HTMLElement).style.transform === before),
            );
          }),
      ),
    )
    .toBe(true);
  const orbitedAnchor = await anchor();
  const before = (await draft(page))!;
  await units(page, { force: "N", moment: "N·m", length: "cm" });
  const convertedLabel = perspective
    .locator(".scene-label")
    .filter({ hasText: "FY 12000 N" });
  await expect(convertedLabel).toHaveCount(1);
  await expect(convertedLabel).toContainText("MX 400 N·m");
  expect(
    await convertedLabel.evaluate(
      (element) => (element as HTMLElement).style.transform,
    ),
  ).toBe(orbitedAnchor);
  expect(await draft(page)).toBe(before);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
});

test("mover um nó em centímetros persiste SI e desfaz a operação inteira", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await units(page, { length: "cm" });
  const before = (await draft(page))!;
  const original = parseProject(before);
  await page
    .locator(".explorer")
    .getByRole("button", { name: /^N2\b/ })
    .click();
  await page.getByRole("button", { name: "Transformar", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Replicar seleção",
    exact: true,
  });
  await expect(dialog.getByLabel("ΔX (cm)", { exact: true })).toHaveValue(
    "100",
  );
  await dialog
    .getByRole("combobox", { name: "Operação", exact: true })
    .selectOption("move");
  const moveDialog = page.getByRole("dialog", {
    name: "Mover seleção",
    exact: true,
  });
  await moveDialog.getByLabel("ΔX (cm)", { exact: true }).fill("200");
  await moveDialog.getByLabel("ΔZ (cm)", { exact: true }).fill("600");
  await expect(
    moveDialog.getByText("1 nó movido · 1 barra incidente"),
  ).toBeVisible();
  await moveDialog.getByText("Barras incidentes (1)", { exact: true }).click();
  await expect(
    moveDialog.getByText("B1 · 600 → 1.000 cm", { exact: true }),
  ).toBeVisible();
  await moveDialog
    .getByRole("button", { name: "Confirmar movimento", exact: true })
    .click();
  const stored = parseProject(await download(page, "Salvar projeto"));
  expect(stored.nodes.find(({ name }) => name === "N2")).toMatchObject({
    id: original.nodes.find(({ name }) => name === "N2")!.id,
    x: 8,
    y: 0,
    z: 6,
  });
  expect(stored.members).toEqual(original.members);
  expect(stored.loadPatterns).toEqual(original.loadPatterns);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  expect(await draft(page)).toBe(before);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
});

test("dividir uma barra em centímetros conserva cargas em SI e desfaz os trechos", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await units(page, { length: "cm", force: "N", distributedLoad: "N/m" });
  const before = (await draft(page))!;
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar barras", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Editar barras físicas",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", { name: "Operação", exact: true }),
  ).toHaveValue("split");
  const distance = dialog.getByLabel("Distância desde i (cm)", { exact: true });
  await distance.fill("600");
  await expect(dialog.getByRole("alert")).toContainText("interior da barra");
  await expect(
    dialog.getByRole("button", { name: "Aplicar edição", exact: true }),
  ).toBeDisabled();
  await distance.fill("200");
  const geometry = dialog.getByRole("table", {
    name: "Geometria final",
    exact: true,
  });
  await expect(
    geometry.getByRole("columnheader", { name: "Extensão (cm)", exact: true }),
  ).toBeVisible();
  for (const value of ["200", "400"])
    await expect(
      geometry.getByRole("cell", { name: value, exact: true }),
    ).toHaveCount(1);
  const loads = dialog.getByRole("table", {
    name: "Cargas uniformes após a edição",
    exact: true,
  });
  await expect(
    loads.getByRole("columnheader", {
      name: "qX / qY / qZ (N/m)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    loads.getByRole("cell", { name: "0 / 0 / -10.000", exact: true }),
  ).toHaveCount(2);
  await expect(
    dialog.getByText(/0 \/ 0 \/ -60\.000 → 0 \/ 0 \/ -60\.000/),
  ).toBeVisible();
  await expect(dialog).toContainText("Resultante global em X / Y / Z (N)");
  await dialog
    .getByRole("button", { name: "Aplicar edição", exact: true })
    .click();
  const stored = parseProject(await download(page, "Salvar projeto"));
  expect(stored.nodes.map(({ x }) => x).sort((a, b) => a - b)).toEqual([
    0, 2, 6,
  ]);
  expect(stored.members).toHaveLength(2);
  expect(stored.loadPatterns[0].uniform.map(({ qz }) => qz)).toEqual([
    -10000, -10000,
  ]);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  expect(await draft(page)).toBe(before);
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
});
