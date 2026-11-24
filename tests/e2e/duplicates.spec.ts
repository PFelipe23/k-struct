import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  free,
  nodalLoad,
  parseProject,
  serializeProject,
  uniformLoad,
  type Project,
} from "../../src/domain/model";
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "duplicadas.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(p)),
    });
  await expect(page.locator(".model-count")).toHaveText(
    `${p.nodes.length} nós · ${p.members.length} barras`,
  );
}
async function save(page: Page) {
  const ev = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  return parseProject(await readFile((await (await ev).path())!, "utf8"));
}
test("destaca duplicatas no modelo, exige decisões e desfaz o lote completo", async ({
  page,
}) => {
  const p = beamExample();
  p.nodes.push({
    ...p.nodes[0],
    id: "C",
    name: "Cópia",
    x: 0.0004,
    restraints: free(),
  });
  p.members.push({
    ...p.members[0],
    id: "V2",
    name: "B2",
    start: "B",
    end: "C",
  });
  p.loadPatterns[0].uniform.push({ ...uniformLoad("V2"), qz: -2000 });
  p.loadPatterns[0].nodal.push({ ...nodalLoad("C"), fx: 71 });
  p.selectionGroups = [
    {
      id: "G1",
      name: "Cópias",
      objects: [
        { kind: "node", id: "C" },
        { kind: "member", id: "V2" },
      ],
    },
  ];
  await open(page, p);
  const dialog = page.getByRole("dialog", {
    name: "Diagnóstico de duplicidades",
  });
  async function choose() {
    await button(page, "Duplicidades").click();
    await dialog.getByRole("button", { name: /\[A\] ↔ .*\[C\]/ }).click();
    await expect(
      page.locator(".explorer button[aria-pressed=true]"),
    ).toHaveCount(2);
    await dialog.getByLabel("Nó a manter").selectOption("A");
    await dialog.getByRole("button", { name: /\[V1\] ↔ .*\[V2\]/ }).click();
    for (const id of ["V1", "V2"])
      await expect(
        page.locator(`line[data-member-id="${id}"]`).first(),
      ).toHaveAttribute("stroke", "var(--geometry-selected)");
    await dialog.getByLabel("Barra a manter").selectOption("V1");
    await expect(button(page, "Aplicar correções")).toBeDisabled();
    await dialog.getByLabel(/Vínculos diferentes/).selectOption("use:A");
    await dialog.getByLabel(/Cargas em .* para B1/).selectOption("use:V1");
    await expect(dialog.getByText(/V2\] → descartar/)).toBeVisible();
  }
  await choose();
  await button(page, "Cancelar").click();
  expect(await save(page)).toEqual(p);
  await choose();
  await button(page, "Aplicar correções").click();
  const q = await save(page);
  expect(q.nodes).toHaveLength(2);
  expect(q.members).toEqual([p.members[0]]);
  expect(q.loadPatterns[0].uniform).toEqual([p.loadPatterns[0].uniform[0]]);
  expect(q.loadPatterns[0].nodal.at(-1)).toEqual({ ...nodalLoad("A"), fx: 71 });
  expect(q.selectionGroups[0].objects).toEqual([
    { kind: "node", id: "A" },
    { kind: "member", id: "V1" },
  ]);
  await button(page, "Desfazer").click();
  expect(await save(page)).toEqual(p);
  await choose();
  await button(page, "Aplicar correções").click();
  expect(await save(page)).toEqual(q);
  await button(page, "Duplicidades").click();
  await expect(
    dialog.getByRole("heading", { name: "Nós próximos (0)" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", {
      name: "Barras duplicadas após as uniões marcadas (0)",
    }),
  ).toBeVisible();
  await expect(button(page, "Aplicar correções")).toBeDisabled();
});
