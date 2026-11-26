import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { openProjectInBrowser } from "../fixtures/open-project";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";
import { diaphragmBenchmark } from "../fixtures/diaphragm";

test("cria e edita o diafragma em planta, analisa, desfaz e reabre o arquivo", async ({
  page,
}) => {
  test.setTimeout(90000);
  const model = diaphragmBenchmark();
  delete model.diaphragms;
  model.loadPatterns[0].nodal[0].nodeId = "E";
  await page.addInitScript(() =>
    localStorage.setItem("kstruct.units", JSON.stringify({ length: "cm" })),
  );
  await page.goto("/");
  const open = (source: string) =>
    openProjectInBrowser(page, "piso.kstruct.json", source);
  await open(serializeProject(model));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const level = page.getByRole("combobox", { name: "Pavimento ativo" }),
    drawing = page.getByRole("img", { name: "Diafragma Piso rígido" });
  await level.selectOption("level1");
  await button("Diafragmas").click();
  await button("Aplicar diafragma").click();
  await expect(page.getByRole("alert")).toContainText("dois nós");
  await button("Selecionar disponíveis").click();
  await page.getByLabel("Nome do diafragma").fill("Piso rígido");
  await page.getByLabel("X de referência").fill("75");
  await page.getByLabel("Y de referência").fill("-37,5");
  await button("Aplicar diafragma").click();
  await expect(drawing).toBeVisible();
  await expect(drawing.locator("line")).toHaveCount(4);
  await level.selectOption("base");
  await expect(drawing).toHaveCount(0);
  await level.selectOption("level1");
  const download = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await download).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.diaphragms![0]).toMatchObject({
    name: "Piso rígido",
    nodeIds: ["S", "C", "E", "N"],
    reference: { x: 0.75, y: -0.375 },
  });
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await button("Reações").click();
    const result = page
      .locator(".results-body")
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "N", exact: true }) });
    await expect(
      result.getByRole("cell", { name: "-9", exact: true }),
    ).toBeVisible();
  }
  await button("Modelo").click();
  await button("Diafragmas").click();
  await page.getByRole("checkbox", { name: "E", exact: true }).uncheck();
  await button("Aplicar diafragma").click();
  await expect(drawing.locator("line")).toHaveCount(3);
  await expect(page.locator(".status-bar")).toContainText("Modelo em edição");
  await button("Desfazer").click();
  await expect(drawing.locator("line")).toHaveCount(4);
  await button("Refazer").click();
  await expect(drawing.locator("line")).toHaveCount(3);
  await button("Diafragmas").click();
  await button("Excluir diafragma").click();
  await expect(drawing).toHaveCount(0);
  await open(source);
  await level.selectOption("level1");
  await expect(drawing.locator("line")).toHaveCount(4);
  await button("Diafragmas").click();
  await expect(page.getByLabel("X de referência")).toHaveValue("75");
  await expect(page.getByLabel("Y de referência")).toHaveValue("-37.5");
});
