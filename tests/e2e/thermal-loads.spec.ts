import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";
import { openProjectInBrowser } from "../fixtures/open-project";
import { thermalBeam } from "../fixtures/thermal-beam";

test("aplica temperatura nas faces no inspetor, desfaz, salva e consulta o deslocamento", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const p = thermalBeam();
  p.loadPatterns.push({
    ...structuredClone(p.loadPatterns[0]),
    id: "T",
    name: "Temperatura",
  });
  p.analysisCases[0].factors.push({ patternId: "T", factor: 1 });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const selectTemperature = async () => {
    await page
      .locator(".explorer")
      .getByRole("button", { name: "B1", exact: true })
      .click();
    const details = page
      .locator("details")
      .filter({
        has: page.locator("summary").filter({ hasText: "Ação térmica" }),
      });
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
      await details.locator("summary").click();
    await page.getByLabel("Padrão da ação térmica").selectOption("T");
  };
  await page.goto("/");
  await openProjectInBrowser(page, "viga.kstruct.json", serializeProject(p));
  await selectTemperature();
  const mean = page.getByRole("textbox", { name: "ΔT uniforme", exact: true });
  const grad = page.getByRole("textbox", {
    name: "ΔT entre faces z",
    exact: true,
  });
  await expect(
    page.getByRole("textbox", { name: "ΔT entre faces y", exact: true }),
  ).toHaveCount(0);
  await mean.fill("20");
  await mean.press("Enter");
  await grad.fill("10");
  await grad.press("Enter");
  const glyph = page.getByRole("img", { name: /Ação térmica em B1/ });
  await expect(glyph).toHaveAccessibleName(/ΔT 20 K.*\+z quente \(10 K\)/);
  await button("Desfazer").click();
  await selectTemperature();
  await expect(grad).toHaveValue("0");
  await button("Refazer").click();
  await selectTemperature();
  await expect(grad).toHaveValue("10");
  await page.getByLabel("Padrão da ação térmica").selectOption("G");
  await expect(glyph).toHaveCount(0);
  await expect(mean).toHaveValue("0");
  const downloading = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await downloading).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.loadPatterns[1].thermal).toEqual([
    { memberId: "V1", uniform: 20, deltaZ: 10, deltaY: 0 },
  ]);
  await openProjectInBrowser(page, "reaberta.kstruct.json", source);
  await selectTemperature();
  await expect(mean).toHaveValue("20");
  await expect(grad).toHaveValue("10");
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await button("Deslocamentos").click();
    const row = page
      .locator(".results-body")
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "N2", exact: true }) });
    await expect(
      row.getByRole("cell", { name: "1,2", exact: true }),
    ).toBeVisible();
  }
});

test("mostra o sentido do gradiente local na elevação e na perspectiva", async ({
  page,
}) => {
  const p = thermalBeam("spatial", 0, 0, -0.25);
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "espacial.kstruct.json",
    serializeProject(p),
  );
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByLabel("Arranjo de vistas").selectOption("triple");
  await expect(
    page
      .getByRole("region", { name: "Elevação XZ", exact: true })
      .getByRole("img", { name: /−y quente/ }),
  ).toBeVisible();
  const view = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  const loads = view.getByRole("button", { name: "Cargas", exact: true });
  if ((await loads.getAttribute("aria-pressed")) !== "true")
    await loads.click();
  const label = view.locator('[data-thermal-member="V1"]');
  await expect(label).toContainText("−y quente (0,25 K)");
  await loads.click();
  await expect(label).toHaveCount(0);
});
