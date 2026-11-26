import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  serializeProject,
  parseProject,
  nodalLoad,
} from "../../src/domain/model";
import { windColumn } from "../fixtures/wind-column";
import { openProjectInBrowser } from "../fixtures/open-project";

test("prévia, substituição, histórico e reabertura da faixa de vento", async ({
  page,
}) => {
  const project = windColumn();
  project.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -235 }];
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "fachada.kstruct.json",
    serializeProject(project),
  );
  const click = (name: string) =>
    page.getByRole("button", { name, exact: true }).click();
  const editor = page.getByRole("dialog");
  await click("Cargas e casos");
  await click("Adicionar faixa de vento");
  await editor.getByLabel("Coeficiente de pressão").fill("1.25");
  await expect(editor).toContainText(
    "Área tributária 12 m². Resultante (FX, FY) = (12, 0) kN",
  );
  await expect(editor).toContainText("N2 [B] · (FX, FY) = (6, 0) kN");
  await click("Cancelar");
  await click("Cargas e casos");
  await expect(editor.getByLabel("Coeficiente de pressão")).toHaveCount(0);
  await click("Adicionar faixa de vento");
  await editor.getByLabel("Coeficiente de pressão").fill("1.25");
  await click("Aplicar definições");
  const outline = page
    .locator("polygon")
    .filter({ hasText: "Faixa de vento" })
    .first();
  await expect(outline).toBeAttached();
  await click("Desfazer");
  await expect(outline).toHaveCount(0);
  await click("Refazer");
  await click("Cargas e casos");
  await editor.getByLabel("Sentido global").selectOption("180");
  await expect(editor).toContainText("(-12, 0) kN");
  await click("Aplicar definições");
  const download = page.waitForEvent("download");
  await click("Salvar projeto");
  const saved = await readFile((await (await download).path())!, "utf8");
  const pattern = parseProject(saved).loadPatterns[0];
  expect(pattern.wind).toHaveLength(1);
  expect(pattern.nodal).toEqual(project.loadPatterns[0].nodal);
  await openProjectInBrowser(page, "vento.kstruct.json", saved);
  await click("Cargas e casos");
  await expect(editor.getByLabel("Sentido global")).toHaveValue("180");
  await expect(editor).toContainText("(-12, 0) kN");
});
