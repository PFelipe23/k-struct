import { test, expect } from "@playwright/test";

test("atribuição em lote: somar, substituir, remover cargas, seleção mista e undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  // Gerar viga contínua com 2 barras via Novo projeto
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const newDialog = page.getByRole("dialog", { name: "Novo projeto" });
  await newDialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await newDialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");

  const explorer = page.locator(".explorer");
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await page.getByLabel("qX global").fill("1,5");
  await page.getByLabel("qX global").press("Tab");
  await page.getByLabel("qZ global").fill("-2");
  await page.getByLabel("qZ global").press("Tab");

  await explorer.getByRole("button", { name: "B2", exact: true }).click();
  await page.getByLabel("qZ global").fill("-3");
  await page.getByLabel("qZ global").press("Tab");

  // Selecionar B1 e B2 -> Somar -1 kN/m em qZ
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await explorer
    .getByRole("button", { name: "B2", exact: true })
    .click({ modifiers: ["Control"] });

  const batch = page.getByRole("region", { name: "Atribuição em lote" });
  await expect(batch).toBeVisible();

  // Campo inválido bloqueia aplicação e Cancelar limpa rascunho
  const lotQz = batch.getByLabel("Lote qZ");
  await lotQz.fill("abc");
  await expect(lotQz).toHaveAttribute("aria-invalid", "true");
  await expect(
    batch.getByRole("button", { name: "Aplicar lote", exact: true }),
  ).toBeDisabled();
  await batch.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(lotQz).toHaveValue("");

  // Somar -1 kN/m
  await lotQz.fill("-1");
  await expect(batch.getByLabel("Prévia da atribuição em lote")).toContainText(
    "somar qZ = -1 kN/m",
  );
  await batch
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();

  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-3");
  await explorer.getByRole("button", { name: "B2", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-4");

  // Um único Desfazer reverte todo o lote e Refazer restaura
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-2");
  await explorer.getByRole("button", { name: "B2", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-3");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-3");

  // Substituir por -5 e depois remover qZ preservando qX de B1
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await explorer
    .getByRole("button", { name: "B2", exact: true })
    .click({ modifiers: ["Control"] });
  await batch
    .getByLabel("Operação de carga distribuída")
    .selectOption("replace");
  await batch.getByLabel("Lote qZ").fill("-5");
  await batch
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();

  await explorer.getByRole("button", { name: "B2", exact: true }).click();
  await expect(page.getByLabel("qZ global")).toHaveValue("-5");

  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await explorer
    .getByRole("button", { name: "B2", exact: true })
    .click({ modifiers: ["Control"] });
  await batch
    .getByLabel("Operação de carga distribuída")
    .selectOption("remove");
  await batch.getByLabel("Remover qZ").check();
  await batch
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();

  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByLabel("qX global")).toHaveValue("1.5");
  await expect(page.getByLabel("qZ global")).toHaveValue("0");

  // Seleção mista: restringir UZ em N1 e N2 mantendo N3 livre
  await explorer.getByRole("button", { name: "N1", exact: true }).click();
  await explorer
    .getByRole("button", { name: "N2", exact: true })
    .click({ modifiers: ["Control"] });
  await explorer
    .getByRole("button", { name: "B1", exact: true })
    .click({ modifiers: ["Control"] });
  await batch.getByLabel("Apoio em lote uz").selectOption("restrict");
  await batch
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();

  await explorer.getByRole("button", { name: "N1 Apoio", exact: true }).click();
  await expect(page.getByLabel("Restringir uz")).toBeChecked();
  await expect(page.getByLabel("Restringir ux")).not.toBeChecked();
  await explorer.getByRole("button", { name: "N3", exact: true }).click();
  await expect(page.getByLabel("Restringir uz")).not.toBeChecked();
  expect(errors).toEqual([]);
});
