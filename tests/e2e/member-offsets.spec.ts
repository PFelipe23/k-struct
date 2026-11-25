import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  free,
  nodalLoad,
  parseProject,
} from "../../src/domain/model";
import { DEFAULT_UNITS } from "../../src/units";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";

test("edita em centímetros, desfaz, salva e consulta as faces da barra no OOFEM", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const initial = beamExample();
  initial.mode = "spatial";
  initial.nodes[0].restraints = {
    ux: true,
    uy: true,
    uz: true,
    rx: true,
    ry: true,
    rz: true,
  };
  initial.nodes[1].restraints = free();
  initial.loadPatterns[0].uniform = [];
  initial.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 60000 }];
  await page.addInitScript(
    ({ project, units }) => {
      localStorage.setItem(
        "kstruct.draft.v11",
        JSON.stringify({ ...project, schemaVersion: 11 }),
      );
      localStorage.setItem("kstruct.units", JSON.stringify(units));
    },
    { project: initial, units: { ...DEFAULT_UNITS, length: "cm" } },
  );
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const select = () =>
    page
      .locator(".explorer")
      .getByRole("button", { name: "B1", exact: true })
      .click();
  const panel = page.locator("details.member-offsets");
  const open = async () => {
    await select();
    if ((await panel.getAttribute("open")) === null)
      await panel.locator("summary").click();
  };
  const field = (name: string) =>
    panel.getByRole("textbox", { name, exact: true });
  await open();
  await field("Trecho rígido em i").fill("650");
  await expect(panel.getByRole("alert")).toContainText(
    "comprimento deformável",
  );
  const apply = button("Aplicar excentricidades e trechos rígidos");
  await expect(apply).toBeDisabled();
  await field("Trecho rígido em i").fill("50");
  await field("Trecho rígido em j").fill("50");
  await field("Excentricidade Y em i").fill("20");
  await field("Excentricidade Y em j").fill("20");
  await apply.click();
  const plan = page.getByRole("region", { name: "Planta XY", exact: true });
  await expect(plan.locator("[data-rigid-face]")).toHaveCount(2);
  const perspective = page.getByRole("region", { name: "Perspectiva 3D" });
  await perspective.getByRole("button", { name: "Nomes dos objetos" }).click();
  await expect(perspective.getByText("Face i", { exact: true })).toBeVisible();
  await button("Desfazer").click();
  await expect(plan.locator("[data-rigid-face]")).toHaveCount(0);
  await button("Refazer").click();
  await expect(plan.locator("[data-rigid-face]")).toHaveCount(2);
  const saving = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await saving).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.nodes).toEqual(initial.nodes);
  expect(saved.members[0].offsets).toEqual({
    i: { eccentricity: { x: 0, y: 0.2, z: 0 }, rigidLength: 0.5 },
    j: { eccentricity: { x: 0, y: 0.2, z: 0 }, rigidLength: 0.5 },
  });
  await page.locator("input[type=file]").setInputFiles(path);
  await open();
  await expect(field("Excentricidade Y em j")).toHaveValue("20");
  await expect(panel).toContainText(/Trecho deformável: 500 cm/);
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await button("Esforços").click();
    const table = page.locator(".results table");
    await expect(
      table.getByRole("columnheader", { name: "X da seção (cm)" }),
    ).toBeVisible();
    await expect(
      table.locator("tbody tr").first().locator("td").nth(-3),
    ).toHaveText("50");
    await expect(
      table.locator("tbody tr").last().locator("td").nth(-3),
    ).toHaveText("550");
    await expect(
      table.locator("tbody tr").first().locator("td").nth(-2),
    ).toHaveText("20");
    const download = page.waitForEvent("download");
    await button("CSV").click();
    expect(await readFile((await (await download).path())!, "utf8")).toContain(
      "X da seção (cm)",
    );
    await button("Deslocamentos").click();
    await expect(
      table.getByRole("cell", { name: "B1 · face j" }),
    ).toBeVisible();
    await field("Excentricidade Y em j").fill("25");
    await apply.click();
    await button("Mensagens").click();
    await expect(page.getByRole("status")).toContainText("Modelo em edição");
  }
});
