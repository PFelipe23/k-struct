import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { setSpring } from "../../src/domain/supports";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";
import { springBenchmark } from "../fixtures/spring-beam";

test("edita, analisa, desfaz e reabre a mola nodal com unidades e referencial", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const model = springBenchmark();
  await page.addInitScript(() =>
    localStorage.setItem("kstruct.units", JSON.stringify({ length: "cm" })),
  );
  await page.goto("/");
  const open = (source: string) =>
    page.locator("input[type=file]").setInputFiles({
      name: "mola.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(source),
    });
  await open(serializeProject(model));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const selectB = (name: string) =>
    page
      .locator(".explorer")
      .getByRole("button", { name, exact: true })
      .click();
  const openSprings = () =>
    page.getByText("Molas nodais", { exact: true }).click();
  await selectB("N2 Apoio");
  await page
    .getByRole("combobox", { name: "Referencial do apoio", exact: true })
    .selectOption("local");
  await openSprings();
  const vertical = page.getByRole("textbox", { name: "Rigidez UZ local" });
  await expect(vertical).toBeDisabled();
  await expect(
    vertical.locator("..").getByText("kN/cm", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("textbox", { name: "Rigidez RY local" })
      .locator("..")
      .getByText("kN·m/rad", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Restringir uz local", exact: true })
    .uncheck();
  await vertical.fill("-1");
  await vertical.press("Enter");
  await expect(vertical).toHaveAttribute("aria-invalid", "true");
  await vertical.fill("100,0");
  await vertical.press("Enter");
  await expect(vertical).toHaveAttribute("aria-invalid", "false");
  await expect(button("N2 Apoio elástico")).toBeVisible();

  if (process.env.OOFEM_BIN) {
    const expected = structuredClone(model);
    expected.nodes[1].supportFrame = { kind: "planar", angle: 0 };
    setSpring(expected.nodes[1], "uz", 1e7);
    await analyzeInBrowser(page, expected, process.env.OOFEM_BIN);
    const row = () =>
      page
        .locator(".results-body")
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name: "N2", exact: true }) });
    await button("Reações").click();
    await expect(
      page.getByRole("columnheader", { name: "RZ local (kN)" }),
    ).toBeVisible();
    await expect(
      row().getByRole("cell", { name: "10", exact: true }),
    ).toHaveCount(2);
    await button("Deslocamentos").click();
    await expect(
      page.getByRole("columnheader", { name: "UZ local (mm)" }),
    ).toBeVisible();
    await expect(
      row().getByRole("cell", { name: "-1", exact: true }),
    ).toHaveCount(2);
  }

  await vertical.fill("0");
  await vertical.press("Enter");
  await expect(button("N2 Apoio elástico")).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("Modelo em edição");
  if (process.env.OOFEM_BIN)
    await expect(
      page.getByText("Execute uma análise para consultar", { exact: false }),
    ).toBeVisible();
  await button("Desfazer").click();
  await expect(button("N2 Apoio elástico")).toBeVisible();
  await button("Refazer").click();
  await expect(button("N2 Apoio elástico")).toHaveCount(0);
  await button("Desfazer").click();
  const downloading = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await downloading).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.nodes[1]).toEqual({
    ...model.nodes[1],
    restraints: { ...model.nodes[1].restraints, uz: false },
    springs: { uz: 1e7 },
    supportFrame: { kind: "planar", angle: 0 },
  });
  expect(saved.loadPatterns).toEqual(model.loadPatterns);
  await open(source);
  await selectB("N2 Apoio elástico");
  await openSprings();
  await expect(vertical).toHaveValue("100");
});
