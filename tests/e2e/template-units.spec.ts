import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Project } from "../../src/domain/model";

async function chooseLengthUnit(page: Page, unit: "m" | "cm" | "mm") {
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByRole("button", { name: "Unidades", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unidades", exact: true });
  await dialog
    .getByRole("combobox", { name: "Comprimentos", exact: true })
    .selectOption(unit);
  await dialog
    .getByRole("button", { name: "Aplicar unidades", exact: true })
    .click();
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
}

async function saveProject(page: Page): Promise<Project> {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = await (await download).path();
  return JSON.parse(await readFile(path!, "utf8")) as Project;
}

test("viga em centímetros mantém a prévia, gera em SI e conserva preferências", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const original = await saveProject(page);
  await chooseLengthUnit(page, "cm");
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Novo projeto",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  const span1 = dialog.getByLabel("Vão 1 (cm)", { exact: true });
  await expect(span1).toHaveValue("400");
  await expect(dialog.getByLabel("Vão 2 (cm)", { exact: true })).toHaveValue(
    "600",
  );
  const preview = dialog.getByLabel("Prévia do modelo");
  await expect(preview).toContainText("Eixos X (cm)");
  await expect(preview).toContainText("0, 400, 1000");
  await expect(dialog.getByRole("img")).toContainText("400 cm");
  const centimetersGeometry = await dialog
    .locator(".preview-node")
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute("cx"), node.getAttribute("cy")]),
    );
  await dialog
    .getByRole("button", { name: "Adicionar vão", exact: true })
    .click();
  await expect(dialog.getByLabel("Vão 3 (cm)", { exact: true })).toHaveValue(
    "400",
  );
  await dialog
    .getByRole("button", { name: "Remover vão 3", exact: true })
    .click();
  await span1.fill("400,5");
  await expect(preview).toContainText("0, 400,5, 1000,5");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await saveProject(page)).toEqual(original);

  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await span1.fill("400,0");
  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  const generated = await saveProject(page);
  expect(generated.nodes.map((node) => node.x)).toEqual([0, 4, 10]);
  expect(generated.members).toHaveLength(2);
  expect(generated.members[0].end).toBe(generated.members[1].start);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("kstruct.units")!).length,
    ),
  ).toBe("cm");

  await chooseLengthUnit(page, "mm");
  expect(await saveProject(page)).toEqual(generated);
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await expect(dialog.getByLabel("Vão 1 (mm)", { exact: true })).toHaveValue(
    "4000",
  );
  expect(
    await dialog
      .locator(".preview-node")
      .evaluateAll((nodes) =>
        nodes.map((node) => [node.getAttribute("cx"), node.getAttribute("cy")]),
      ),
  ).toEqual(centimetersGeometry);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await chooseLengthUnit(page, "cm");
  expect(await saveProject(page)).toEqual(generated);
  await page.reload();
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await expect(span1).toHaveValue("400");
});

test("pórtico em milímetros converte vãos e alturas e valida a tolerância em SI", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await chooseLengthUnit(page, "mm");
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Novo projeto",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Pórtico regular", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Espacial XYZ", exact: true })
    .click();
  const spanX = dialog.getByLabel("Vão X 1 (mm)", { exact: true });
  await expect(spanX).toHaveValue("4000");
  await expect(dialog.getByLabel("Vão Y 1 (mm)", { exact: true })).toHaveValue(
    "4000",
  );
  await expect(
    dialog.getByLabel("Pavimento 1 (mm)", { exact: true }),
  ).toHaveValue("3000");
  for (const [add, label, value, remove] of [
    ["Adicionar vão X", "Vão X 3 (mm)", "4000", "Remover vão X 3"],
    ["Adicionar vão Y", "Vão Y 3 (mm)", "4000", "Remover vão Y 3"],
    ["Adicionar pavimento", "Pavimento 3 (mm)", "3000", "Remover pavimento 3"],
  ]) {
    await dialog.getByRole("button", { name: add, exact: true }).click();
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
    await dialog.getByRole("button", { name: remove, exact: true }).click();
  }
  await spanX.fill("0,0005");
  await expect(spanX).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByRole("button", { name: "Gerar projeto", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("maior que zero");
  await spanX.fill("4000");
  await dialog.getByLabel("Pavimento 1 (mm)", { exact: true }).fill("3200,5");
  const preview = dialog.getByLabel("Prévia do modelo");
  await expect(preview).toContainText("Eixos X (mm)");
  await expect(preview).toContainText("Eixos Y (mm)");
  await expect(preview).toContainText("Níveis Z (mm)");
  await expect(preview).toContainText("0, 3200,5, 6200,5");
  await expect(
    dialog.getByRole("img", {
      name: "Prévia esquemática da planta XY do pórtico espacial",
    }),
  ).toContainText("8000 × 8000 mm");
  await expect(
    dialog.getByRole("img", {
      name: "Prévia esquemática da elevação XZ do pórtico",
    }),
  ).toContainText("8000 × 6200,5 mm");
  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("27 nós · 42 barras");
  const generated = await saveProject(page);
  expect([...new Set(generated.nodes.map((node) => node.x))]).toEqual([
    0, 4, 8,
  ]);
  expect([...new Set(generated.nodes.map((node) => node.y))]).toEqual([
    0, 4, 8,
  ]);
  expect([...new Set(generated.nodes.map((node) => node.z))]).toEqual([
    0, 3.2005, 6.2005,
  ]);
  expect(generated.members).toHaveLength(42);
});
