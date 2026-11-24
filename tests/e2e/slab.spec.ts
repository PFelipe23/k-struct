import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject } from "../../src/domain/model";
import { plateBenchmark } from "../fixtures/plate-benchmark";
import { runDeck } from "../fixtures/solve-oofem";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function exportDeck(page: Page) {
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const download = page.waitForEvent("download");
  await button(page, "Entrada OOFEM").click();
  return readFile((await (await download).path())!, "utf8");
}

async function analyzeDeck(page: Page, deck: string, executable: string) {
  const output = runDeck(deck, executable);
  await page.evaluate(
    ({ deck, output }) => {
      let callback = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback: () => ++callback,
          invoke: async (
            command: string,
            args: {
              deck: string;
              runContext: { caseName: string };
              response: { onmessage: (value: unknown) => void };
            },
          ) => {
            if (command !== "start_oofem" || args.deck !== deck)
              throw new Error(
                "Entrada enviada ao motor diferente do arquivo exportado.",
              );
            args.response.onmessage({
              output,
              log: { summary: { ...args.runContext, status: "completed" } },
              historyError: null,
            });
          },
        },
      });
    },
    { deck, output },
  );
  await button(page, "Analisar").click();
}

test("laje QDKT lançada em XY, salva, reaberta e analisada em duas malhas", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await button(page, "Novo pórtico espacial").click();
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  await button(page, "Laje").click();
  const xy = page.getByRole("application", { name: "Área de lançamento XY" });
  const bounds = (await xy.boundingBox())!;
  await xy.click({
    position: { x: bounds.width * 0.3, y: bounds.height * 0.65 },
  });
  await xy.click({
    position: { x: bounds.width * 0.7, y: bounds.height * 0.35 },
  });
  const explorer = page.locator(".explorer");
  await expect(
    explorer.getByRole("button", { name: "L1", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Cota Z", { exact: true })).toHaveValue("3");
  for (const [label, value] of [
    ["Dimensão X", String(plateBenchmark.lengthX)],
    ["Dimensão Y", String(plateBenchmark.lengthY)],
    ["Espessura", "10"],
    ["Módulo E", "30"],
    ["Coeficiente de Poisson", "0,20"],
    ["Densidade", "2500"],
    ["Pressão uniforme Z", "-5"],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.press("Tab");
  }
  await expect(xy.locator(".slab-outline")).toHaveCount(1);
  await expect(page.locator(".three-container canvas")).toBeVisible();

  const download = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  const savedPath = (await (await download).path())!;
  const project = parseProject(await readFile(savedPath, "utf8"));
  const [slab] = project.slabs;
  expect(slab).toMatchObject({
    name: "L1",
    z: 3,
    lengthX: 4,
    lengthY: 3,
    thickness: 0.1,
    nx: 8,
    ny: 6,
    supports: { xMin: true, xMax: true, yMin: true, yMax: true },
  });
  expect(project.loadPatterns[0].pressures).toEqual([
    { slabId: slab.id, qz: -5000 },
  ]);
  expect(
    project.materials.find(({ id }) => id === slab.materialId),
  ).toMatchObject({ E: 30e9, nu: 0.2, density: 2500 });
  expect(project.nodes).toEqual([]);
  expect(project.members).toEqual([]);

  await button(page, "Novo projeto").click();
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await explorer.getByRole("button", { name: "L1", exact: true }).click();
  await expect(
    page.getByLabel("Pressão uniforme Z", { exact: true }),
  ).toHaveValue("-5");
  const edge = page.getByLabel("X mínimo", { exact: true });
  await edge.uncheck();
  await button(page, "Analisar").click();
  await expect(page.getByRole("status")).toContainText(
    "apoio simples nas quatro bordas",
  );
  await edge.check();
  await button(page, "Análise").click();
  const firstDeck = await exportDeck(page);
  expect(firstDeck).toContain("nelem 48");
  expect(firstDeck).toContain("qdktplate 1 nodes 4 11 10 1 2");
  expect(firstDeck).toContain("components 3 -5000 0 0 csType 0");

  const executable = process.env.OOFEM_BIN;
  if (executable) {
    await analyzeDeck(page, firstDeck, executable);
    const result = page.getByRole("region", { name: "Resultados da laje" });
    const display = page.getByLabel("Visualização dos resultados");
    await expect(
      result.getByRole("img", { name: "Mapa de Flecha Uz" }),
    ).toBeVisible();
    await expect(result.locator("rect")).toHaveCount(48);
    await expect(result).toContainText("L1 · EL · Estática linear");
    await expect(result).toContainText("-1,02669 mm");

    await page.getByLabel("Subdivisões X").selectOption("32");
    await page.getByLabel("Subdivisões Y").selectOption("24");
    await expect(result).toHaveCount(0);
    const fineDeck = await exportDeck(page);
    expect(fineDeck).toContain("nelem 768");
    await analyzeDeck(page, fineDeck, executable);
    await expect(result.locator("rect")).toHaveCount(768);
    await expect(result).toContainText("-1,03067 mm");
    await expect(result).toContainText("1,9869 kN·m/m");
    await expect(result).toContainText("3,07777 kN·m/m");
    await expect(result).toContainText("60,00014 kN");
    await display.selectOption("mx");
    await expect(
      result.getByRole("img", { name: "Mapa de Momento Mx" }),
    ).toBeVisible();
    await display.selectOption("my");
    await expect(
      result.getByRole("img", { name: "Mapa de Momento My" }),
    ).toBeVisible();

    await button(page, "Desfazer").click();
    await expect(result).toHaveCount(0);
    await explorer.getByRole("button", { name: "L1", exact: true }).click();
    await expect(page.getByLabel("Subdivisões Y")).toHaveValue("6");
    await button(page, "Refazer").click();
    await explorer.getByRole("button", { name: "L1", exact: true }).click();
    await expect(page.getByLabel("Subdivisões Y")).toHaveValue("24");
    await expect(result).toHaveCount(0);
  }
});
