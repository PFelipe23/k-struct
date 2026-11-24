import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("proteção de projeto editado e validação no diálogo de novo projeto", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  const load = page.getByLabel("qZ global");
  await load.fill("-15");
  await load.press("Tab");
  await expect(load).toHaveValue("-15");

  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo projeto" });
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();

  const span1 = dialog.getByLabel("Vão 1 (m)");
  await span1.fill("0");
  await expect(span1).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("maior que zero");
  await expect(
    dialog.getByRole("button", { name: "Gerar projeto", exact: true }),
  ).toBeDisabled();

  await span1.fill("abc");
  await expect(span1).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("número finito");

  await span1.fill("4");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Nome do projeto")).toHaveValue(
    "Viga biapoiada · 6 m",
  );
  await expect(load).toHaveValue("-15");

  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Substituir o projeto atual",
  });
  await confirm.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await confirm.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  expect(errors).toEqual([]);
});

test("viga contínua com vãos de 4 m e 6 m gera 3 nós e 2 barras ligadas ao nó intermediário", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo projeto" });
  await dialog
    .getByRole("button", { name: "Viga contínua", exact: true })
    .click();
  await dialog.getByLabel("Vão 1 (m)").fill("4");
  await dialog.getByLabel("Vão 2 (m)").fill("6");

  const preview = dialog.getByLabel("Prévia do modelo");
  await expect(preview).toContainText("0, 4, 10");
  await expect(preview).toContainText("3 nós");
  await expect(preview).toContainText("2 barras");
  await expect(preview).toContainText("Nenhum apoio");

  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = await (await downloadPromise).path();
  const saved = JSON.parse(await readFile(path!, "utf8"));
  expect(saved.nodes.map((n: { x: number }) => n.x)).toEqual([0, 4, 10]);
  expect(saved.members).toHaveLength(2);
  expect(saved.members[0].end).toBe(saved.members[1].start);
});

test("pórtico regular XZ: prévia, geração, edição manual, salvamento e reabertura", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo projeto" });
  await dialog
    .getByRole("button", { name: "Pórtico regular", exact: true })
    .click();
  await dialog.getByLabel("Vão X 1 (m)").fill("4,5");
  await dialog.getByLabel("Vão X 2 (m)").fill("5,5");
  await dialog.getByLabel("Pavimento 1 (m)").fill("3");
  await dialog.getByLabel("Pavimento 2 (m)").fill("3,2");

  const preview = dialog.getByLabel("Prévia do modelo");
  await expect(preview).toContainText("9 nós");
  await expect(preview).toContainText("10 barras (6 pilares · 4 vigas)");
  await expect(preview).toContainText("0, 4,5, 10");
  await expect(preview).toContainText("0, 3, 6,2");

  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("9 nós · 10 barras");

  // Mover um nó e alterar uma seção pelo fluxo habitual
  const explorer = page.locator(".explorer");
  await explorer.getByRole("button", { name: "N2", exact: true }).click();
  const coordX = page.getByLabel("X", { exact: true });
  await coordX.fill("5");
  await coordX.press("Enter");
  await expect(coordX).toHaveValue("5");

  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  const width = page.getByLabel("Largura b", { exact: true });
  await width.fill("25");
  await width.press("Enter");
  await expect(width).toHaveValue("25");

  const saveWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const savedPath = await (await saveWait).path();

  // Limpar criando projeto vazio e reabrir o salvo
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("0 nós · 0 barras");

  await page.locator("input[type=file]").setInputFiles(savedPath!);
  await expect(page.locator(".model-count")).toHaveText("9 nós · 10 barras");
  await explorer.getByRole("button", { name: "N2", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("5");
  await explorer.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByLabel("Largura b", { exact: true })).toHaveValue("25");

  // Conferir também prévia do pórtico espacial XYZ com as duas direções explícitas
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Pórtico regular", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Espacial XYZ", exact: true })
    .click();
  await expect(
    dialog.getByRole("img", {
      name: "Prévia esquemática da planta XY do pórtico espacial",
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("img", {
      name: "Prévia esquemática da elevação XZ do pórtico",
    }),
  ).toBeVisible();
  await expect(preview).toContainText("27 nós");
  await expect(preview).toContainText(
    "42 barras (18 pilares · 12 vigas X · 12 vigas Y)",
  );
  await dialog
    .getByRole("button", { name: "Gerar projeto", exact: true })
    .click();
  await expect(page.locator(".model-count")).toHaveText("27 nós · 42 barras");
  expect(errors).toEqual([]);
});
