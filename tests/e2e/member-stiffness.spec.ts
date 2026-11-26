import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { stiffnessCantilevers } from "../fixtures/member-stiffness";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";

test("modifica somente a barra selecionada e conserva os fatores no histórico e no arquivo", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const model = stiffnessCantilevers();
  const [target, control] = model.members;
  await page.goto("/");
  const input = page.locator("input[type=file]");
  const open = (source: string) =>
    input.setInputFiles({
      name: "balancos.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(source),
    });
  await open(serializeProject(model));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const pick = async (name: string) => {
    await page
      .locator(".explorer")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByText("Modificadores de rigidez", { exact: true }).click();
  };
  await pick(target.name);
  const factor = page.getByRole("textbox", { name: "Fator EIy" });
  const table = page.getByRole("table", {
    name: "Rigidez bruta e efetiva da barra",
  });
  const row = table.getByRole("row", { name: /EIy/ });
  await expect(factor).toHaveValue("1");
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(row.getByRole("cell")).toHaveText(["20.000", "20.000"]);
  await factor.fill("0");
  await factor.press("Enter");
  await expect(factor).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Rigidez nula pode gerar um mecanismo.", { exact: false }),
  ).toBeVisible();
  await expect(row.getByRole("cell")).toHaveText(["20.000", "20.000"]);
  await factor.fill("0,5");
  await factor.press("Enter");
  await expect(factor).toHaveAttribute("aria-invalid", "false");
  await expect(row.getByRole("cell")).toHaveText(["20.000", "10.000"]);

  if (process.env.OOFEM_BIN) {
    const expected = structuredClone(model);
    expected.members[0].stiffness = { eiy: 0.5 };
    await analyzeInBrowser(page, expected, process.env.OOFEM_BIN);
    await button("Deslocamentos").click();
    const results = page.locator(".results-body");
    for (const [node, displacement] of [
      [model.nodes[1].name, "-0,81"],
      [model.nodes[3].name, "-0,405"],
    ]) {
      const tip = results
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name: node, exact: true }) });
      await expect(
        tip.getByRole("cell", { name: displacement, exact: true }),
      ).toBeVisible();
    }
  }

  await factor.fill("0,75");
  await factor.press("Enter");
  await expect(page.locator(".status-bar")).toContainText("Modelo em edição");
  if (process.env.OOFEM_BIN)
    await expect(
      page.getByText("Execute uma análise para consultar", { exact: false }),
    ).toBeVisible();
  await button("Desfazer").click();
  await pick(target.name);
  await expect(factor).toHaveValue("0.5");
  await expect(row.getByRole("cell")).toHaveText(["20.000", "10.000"]);
  await pick(control.name);
  await expect(factor).toHaveValue("1");

  const downloading = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await downloading).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.sections).toEqual(model.sections);
  expect(saved.materials).toEqual(model.materials);
  expect(saved.loadPatterns).toEqual(model.loadPatterns);
  expect(saved.members[0]).toEqual({ ...target, stiffness: { eiy: 0.5 } });
  expect(saved.members[1]).toEqual(control);
  await open(source);
  await pick(target.name);
  await expect(factor).toHaveValue("0.5");
});

test("exibe apenas os fatores ativos numa barra XZ", async ({ page }) => {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "viga.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(beamExample())),
    });
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByText("Modificadores de rigidez", { exact: true }).click();
  for (const name of ["Fator EA", "Fator EIy"])
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(
      "1",
    );
  await expect(
    page.getByRole("textbox", { name: /Fator (EIz|GJ)/ }),
  ).toHaveCount(0);
});
