import { test, expect, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function pasteInto(locator: Locator, text: string) {
  const page = locator.page();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await locator.focus();
  await locator.press("ControlOrMeta+a");
  await locator.press("ControlOrMeta+v");
}

test("colar tabela TSV em cm cria nós/barras, atualiza por ID e desfaz em um passo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tabela de nós" });
  await dialog.getByRole("tab", { name: "Colar planilha (TSV)" }).click();

  await dialog.getByLabel("Unidade das coordenadas").selectOption("cm");
  await pasteInto(
    dialog.getByLabel("Colar nós (TSV)"),
    "ID\tNome\tX\tZ\r\nN1\tN1\t0\t0\r\nN2\tN2\t350\t0",
  );
  await pasteInto(
    dialog.getByLabel("Colar barras (TSV)"),
    "ID\tNome\tID inicial\tID final\tSeção\r\nB1\tB1\tN1\tN2\trect",
  );

  const preview = dialog.getByLabel("Prévia da importação");
  await expect(preview).toContainText("Nós: 2 criar");
  await expect(preview).toContainText("Barras: 1 criar");
  await expect(preview).toContainText("3,50 m");

  await dialog
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");

  // Desfazer remove todo o lote e refazer restaura
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".model-count")).toHaveText("0 nós · 0 barras");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");

  // Atribuir carga a B1, atualizar N2 pelo mesmo ID e repetir sem alterações
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  const qz = page.getByLabel("qZ global");
  await qz.fill("-10");
  await qz.press("Tab");

  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "Colar planilha (TSV)" }).click();
  await pasteInto(dialog.getByLabel("Colar nós (TSV)"), "N2\tN2\t4,5\t0");
  await expect(preview).toContainText("Nós: 0 criar · 1 atualizar");
  await dialog
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();

  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(qz).toHaveValue("-10");

  // Repetir colagem idêntica mostra prévia sem alteração
  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "Colar planilha (TSV)" }).click();
  await pasteInto(dialog.getByLabel("Colar nós (TSV)"), "N2\tN2\t4,5\t0");
  await expect(preview).toContainText("Prévia sem alteração");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(errors).toEqual([]);
});

test("rejeita lote com erro de célula e referência ausente e aceita XYZ após corrigir", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Novo pórtico espacial" }).click();
  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tabela de nós" });
  await dialog.getByRole("tab", { name: "Colar planilha (TSV)" }).click();

  await pasteInto(
    dialog.getByLabel("Colar nós (TSV)"),
    "ID\tNome\tX\tY\tZ\nN1\tN1\t0\t0\t0\nN2\tN2\txyz\t1,5\t3",
  );
  await pasteInto(
    dialog.getByLabel("Colar barras (TSV)"),
    "ID\tNome\tID inicial\tID final\tSeção\nB1\tB1\tN1\tN99\trect",
  );

  const errorTable = dialog.getByRole("table", {
    name: "Erros na importação tabular",
  });
  await expect(errorTable).toContainText("xyz");
  await expect(errorTable).toContainText("N99");
  await expect(
    dialog.getByRole("button", { name: "Aplicar lote", exact: true }),
  ).toBeDisabled();

  // Corrigir erros com vírgula decimal em XYZ, aplicar, salvar e reabrir
  await pasteInto(
    dialog.getByLabel("Colar nós (TSV)"),
    "ID\tNome\tX\tY\tZ\nN1\tN1\t0\t0\t0\nN2\tN2\t2,5\t1,5\t3",
  );
  await pasteInto(
    dialog.getByLabel("Colar barras (TSV)"),
    "ID\tNome\tID inicial\tID final\tSeção\nB1\tB1\tN1\tN2\trect",
  );
  await dialog
    .getByRole("button", { name: "Aplicar lote", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");

  const saveWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const savedPath = await (await saveWait).path();
  const saved = JSON.parse(await readFile(savedPath!, "utf8"));
  expect(saved.nodes[1]).toMatchObject({ id: "N2", x: 2.5, y: 1.5, z: 3 });

  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Novo projeto" })
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");
  expect(errors).toEqual([]);
});
