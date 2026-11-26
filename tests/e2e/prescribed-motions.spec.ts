import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { serializeProject, parseProject } from "../../src/domain/model";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";
import { openProjectInBrowser } from "../fixtures/open-project";
import { settlementBeam } from "../fixtures/settlement";

test("prescreve recalque no padrão, desfaz, reabre e consulta o resultado", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const p = settlementBeam();
  delete p.loadPatterns[0].prescribed;
  p.loadPatterns.push({
    ...structuredClone(p.loadPatterns[0]),
    id: "R",
    name: "Recalque",
  });
  p.analysisCases[0].factors.push({ patternId: "R", factor: 1 });
  await page.goto("/");
  await openProjectInBrowser(page, "viga.kstruct.json", serializeProject(p));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const select = () =>
    page
      .locator(".explorer")
      .getByRole("button", { name: "N2 Apoio", exact: true })
      .click();
  const openMotions = async () => {
    await select();
    const details = page
      .locator("details")
      .filter({
        has: page
          .locator("summary")
          .filter({ hasText: "Movimentos prescritos" }),
      })
      .last();
    if ((await details.getAttribute("open")) === null)
      await details.locator("summary").first().click();
  };
  await openMotions();
  const pattern = page.getByLabel("Padrão do movimento");
  await pattern.selectOption("R");
  const uz = page.getByRole("textbox", { name: "UZ imposto global" });
  await expect(
    page.getByRole("textbox", { name: "RY imposto global" }),
  ).toBeDisabled();
  await expect(uz.locator("..").getByText("mm", { exact: true })).toBeVisible();
  await uz.fill("-4");
  await uz.press("Enter");
  await button("Desfazer").click();
  await openMotions();
  await expect(uz).toHaveValue("0");
  await button("Refazer").click();
  await openMotions();
  await expect(uz).toHaveValue("-4");
  await pattern.selectOption("G");
  await expect(uz).toHaveValue("0");
  await pattern.selectOption("R");
  const downloading = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await downloading).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.loadPatterns[1].prescribed).toEqual([
    { nodeId: "B", dof: "uz", value: -0.004 },
  ]);
  await openProjectInBrowser(page, "reaberta.kstruct.json", source);
  await openMotions();
  await pattern.selectOption("R");
  await expect(uz).toHaveValue("-4");
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await button("Deslocamentos").click();
    await expect(
      page.getByRole("columnheader", { name: "UZ imposto no apoio (mm)" }),
    ).toBeVisible();
    const row = page
      .locator(".results-body")
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "N2", exact: true }) });
    await expect(
      row.getByRole("cell", { name: "-4", exact: true }),
    ).toHaveCount(2);
    await button("Reações").click();
    await expect(row).toContainText("-11,25");
  }
});
