import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  free,
  nodalLoad,
  parseProject,
} from "../../src/domain/model";
import { exportOofem, parseOofemOutput } from "../../src/solver/oofem";
import { projectV9 } from "../fixtures/project-v8";
import { runDeck } from "../fixtures/solve-oofem";

test("cadastra, valida, atribui e reabre um perfil I no balanço espacial", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const p = beamExample();
  p.mode = "spatial";
  p.nodes[0].restraints = {
    ux: true,
    uy: true,
    uz: true,
    rx: true,
    ry: true,
    rz: true,
  };
  p.nodes[1].x = 2;
  p.nodes[1].restraints = free();
  p.materials.push({ ...p.materials[0], id: "aco", name: "Aço 210", E: 210e9 });
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fy: 300, fz: -900, mx: 15 }];
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v9", source),
    JSON.stringify(projectV9(p)),
  );
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const bar = page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true });
  await bar.click();
  const assignment = page.getByLabel("Seção da barra", { exact: true });
  await expect(assignment).toHaveValue("rect");
  await button("Catálogo de seções").click();
  const dialog = page.getByRole("dialog", { name: "Catálogo de seções" });
  const action = (name: string) =>
    dialog.getByRole("button", { name, exact: true });
  await action("Nova seção").click();
  const form = dialog.getByLabel("Forma da seção");
  await form.selectOption("tube");
  await dialog.getByLabel("Espessura da parede t (cm)").fill("5");
  await expect(dialog.getByLabel("Espessura da parede t (cm)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    dialog.getByText(/menor que metade do diâmetro externo/),
  ).toBeVisible();
  await expect(action("Salvar seção")).toBeDisabled();
  await form.selectOption("i");
  const flange = dialog.getByLabel("Espessura da mesa tf (cm)");
  await flange.fill("10");
  await expect(flange).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText(/altura livre da alma.*positiva/),
  ).toBeVisible();
  await expect(action("Salvar seção")).toBeDisabled();
  await flange.fill("1,0");
  await dialog.getByLabel("Nome da seção").fill("I 200 de ensaio");
  await dialog.getByLabel("Material da seção").selectOption("aco");
  await action("Salvar seção").click();
  const id = await dialog.getByLabel("Seção do projeto").inputValue();
  await action("Fechar").click();
  await assignment.selectOption(id);
  const props = page.getByLabel("Propriedades geométricas da seção");
  await expect(props).toContainText("30,8 cm²");
  await expect(
    page.getByRole("img", { name: /Contorno da seção I duplamente simétrico/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Eixo forte y · eixo fraco z.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Propriedades do material")).toContainText(
    "210 GPa",
  );
  await button("Desfazer").click();
  await bar.click();
  await expect(assignment).toHaveValue("rect");
  await button("Refazer").click();
  await bar.click();
  await expect(assignment).toHaveValue(id);
  const saving = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await saving).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.sections.find((s) => s.id === id)).toMatchObject({
    shape: "i",
    height: 0.2,
    width: 0.1,
    flangeThickness: 0.01,
    webThickness: 0.006,
    materialId: "aco",
  });
  expect(saved.members[0].sectionId).toBe(id);
  await page.locator("input[type=file]").setInputFiles(path);
  await bar.click();
  await expect(assignment).toHaveValue(id);
  await expect(props).toContainText("30,8 cm²");
  await button("Análise").click();
  const downloading = page.waitForEvent("download");
  await button("Entrada OOFEM").click();
  const deck = await readFile((await (await downloading).path())!, "utf8");
  const input = exportOofem(saved, "EL");
  expect(deck).toBe(input.deck);
  expect(deck).toMatch(/^SimpleCS 2 .* Ik .* material 2 set /m);
  if (process.env.OOFEM_BIN) {
    const raw = runDeck(deck, process.env.OOFEM_BIN);
    const u = parseOofemOutput(raw, input).displacements.B;
    expect(u.uy).toBeCloseTo(0.00228127948, 8);
    expect(u.uz).toBeCloseTo(-0.000544667254, 9);
    expect(u.rx).toBeCloseTo(0.0046228249, 8);
    await page.evaluate(
      ({ deck, raw }) => {
        let callback = 0;
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            transformCallback: () => ++callback,
            invoke: async (
              cmd: string,
              args: {
                deck: string;
                runContext: Record<string, string>;
                response: { onmessage: (payload: unknown) => void };
              },
            ) => {
              if (cmd !== "start_oofem" || args.deck !== deck)
                throw new Error("Entrada de análise divergente.");
              args.response.onmessage({
                output: raw,
                log: {
                  summary: {
                    ...args.runContext,
                    status: "completed",
                    message: "OOFEM concluído.",
                  },
                },
                historyError: null,
              });
            },
          },
        });
      },
      { deck, raw },
    );
    await button("Analisar").click();
    await expect(page.getByRole("status")).toContainText("Análise concluída");
    await assignment.selectOption("rect");
    await expect(page.getByRole("status")).toContainText(
      "Analise a revisão atual",
    );
    await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
      "model",
    );
  }
});
