import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";
import { coupledCsv, foundationBenchmark } from "../fixtures/foundation";

test("importa, confere a prévia, desfaz, reabre offline e analisa a fundação", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const target = foundationBenchmark();
  const original = structuredClone(target);
  delete original.nodes[0].foundation;
  original.nodes[0].springs = { ux: 150000 };
  await page.goto("/");
  const open = (source: string) =>
    page.locator('input[type="file"]').setInputFiles({
      name: "fundacao.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(source),
    });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await open(serializeProject(original));
  await button("N1 Apoio elástico").click();
  async function start() {
    await button("Importar fundação do MolaStruct").click();
  }
  const dialog = page.getByRole("dialog");
  const upload = (csv: string) =>
    dialog.getByLabel("Arquivo de matriz 6 × 6 (CSV)").setInputFiles({
      name: "ensaio.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await start();
  await upload(coupledCsv.split("\r\n").slice(0, 5).join("\r\n"));
  await expect(dialog.getByRole("alert")).toContainText("incompleta");
  await expect(button("Substituir apoio")).toBeDisabled();
  await button("Cancelar").click();
  await expect(button("N1 Apoio elástico")).toBeVisible();
  await start();
  await upload(coupledCsv);
  const cells = dialog.getByRole("table").getByRole("cell");
  await expect(cells).toHaveCount(36);
  await expect(cells.nth(4)).toHaveText("2000");
  await expect(button("Substituir apoio")).toBeDisabled();
  await dialog.getByLabel("Eixos da matriz").selectOption("local");
  await dialog
    .getByLabel("Ponto de referência da matriz")
    .selectOption("offset");
  await dialog.getByLabel("y local · Y").fill("0");
  await expect(dialog.getByRole("alert")).toContainText(/nulas|colineares/);
  await expect(button("Substituir apoio")).toBeDisabled();
  await dialog.getByLabel("y local · Y").fill("1");
  await dialog.getByLabel("ΔZ (m)").fill("0,5");
  await dialog.getByLabel("Visualizar matriz").selectOption("node");
  await expect(cells.nth(4)).toHaveText("7000");
  await dialog.getByLabel("Ponto de referência da matriz").selectOption("node");
  await dialog.getByLabel("Eixos da matriz").selectOption("global");
  await expect(cells.nth(4)).toHaveText("2000");
  await button("Substituir apoio").click();
  const selected = "N1 Fundação · Fundação de ensaio";
  await expect(button(selected)).toBeVisible();
  await button("Desfazer").click();
  await expect(button("N1 Apoio elástico")).toBeVisible();
  await button("Refazer").click();
  const download = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await download).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.nodes).toEqual(target.nodes);
  await open(source);
  await button(selected).click();
  await button("Fundação · Fundação de ensaio").click();
  await expect(cells).toHaveCount(36);
  await expect(dialog.getByLabel("Eixos da matriz")).toHaveValue("global");
  await expect(dialog.getByLabel("Ponto de referência da matriz")).toHaveValue(
    "node",
  );
  await button("Cancelar").click();
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, target, process.env.OOFEM_BIN);
    const row = page.locator(".results-body tbody tr").first();
    await button("Reações").click();
    await expect(row.getByRole("cell")).toHaveText([
      "N1",
      "-22",
      "0",
      "0",
      "0",
      "-8",
      "0",
    ]);
    await button("Deslocamentos").click();
    await expect(row.getByRole("cell")).toHaveText([
      "N1",
      "2",
      "0",
      "0",
      "0",
      "1",
      "0",
    ]);
  }
});
