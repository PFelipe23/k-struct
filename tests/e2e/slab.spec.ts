import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { formatResult } from "../../src/components/resultFormatting";
import { parseProject } from "../../src/domain/model";
import { exportOofem, parseOofemOutput } from "../../src/solver/oofem";
import { runDeck } from "../fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;

type RunArgs = {
  deck: string;
  runContext: { runId: string; caseName: string; projectName: string };
  response: { onmessage: (value: unknown) => void };
};
type SlabTestWindow = Window & {
  isTauri: boolean;
  __TAURI_INTERNALS__: {
    transformCallback: () => number;
    invoke: (command: string, args: RunArgs) => Promise<void>;
  };
  finishSlabAnalysis?: () => Promise<void>;
  solveSlabDeck: (deck: string) => Promise<string>;
};

async function plateBridge(page: Page) {
  await page.exposeFunction("solveSlabDeck", (deck: string) =>
    runDeck(deck, executable!),
  );
  await page.addInitScript(() => {
    if (sessionStorage.getItem("slab-ipc") !== "enabled") return;
    const w = window as unknown as SlabTestWindow;
    let callbackId = 0;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++callbackId,
      invoke: async (command, args) => {
        if (command !== "start_oofem")
          throw new Error(`IPC inesperado no teste: ${command}`);
        w.finishSlabAnalysis = async () => {
          delete w.finishSlabAnalysis;
          const output = await w.solveSlabDeck(args.deck);
          args.response.onmessage({
            output,
            log: {
              summary: {
                ...args.runContext,
                status: "completed",
                message: "Execução concluída.",
              },
              stdout: "",
              stderr: "",
              logTruncated: false,
            },
            historyError: null,
          });
        };
      },
    };
  });
}

for (const formulation of ["qdkt", "dkt"] as const) {
  test(`lança, salva, reabre e consulta a laje ${formulation.toUpperCase()} do benchmark`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    if (executable) await plateBridge(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Novo pórtico espacial" }).click();
    await page.getByLabel("Pavimento ativo").selectOption("level1");
    const slabTool = page.getByRole("button", { name: /^Laje L$/ });
    await slabTool.click();
    const drawing = page.getByRole("application", {
      name: "Área de lançamento XY",
    });
    const corners = await drawing.evaluate((svg) => {
      const pos = (axis: "x" | "y", v: number) =>
        Number(
          svg
            .querySelector(`line[data-axis="${axis}"][data-position="${v}"]`)!
            .getAttribute(`${axis}1`),
        );
      return [
        { x: pos("x", 0), y: pos("y", 0) },
        { x: pos("x", 4), y: 0.25 * pos("y", 0) + 0.75 * pos("y", 4) },
      ];
    });
    for (const position of corners) await drawing.click({ position });
    await expect(page.locator(".model-count")).toHaveText(
      "0 nós · 0 barras · 1 laje",
    );
    await expect(page.getByLabel("Lado X")).toHaveValue("4");
    await expect(page.getByLabel("Lado Y")).toHaveValue("3");
    await expect(page.getByLabel("Pavimento da laje")).toHaveValue("level1");
    await expect(page.getByLabel("Módulo E")).toHaveValue("30");
    await expect(page.getByLabel("Poisson ν")).toHaveValue("0.2");
    await expect(page.getByLabel("Espessura")).toHaveValue("10");
    await expect(drawing.locator(".slab-supported-edge")).toHaveCount(4);
    const element = page.getByLabel("Elemento de placa");
    await expect(element).toHaveValue("qdkt");
    await element.selectOption(formulation);
    const endSupport = page.getByLabel("Apoio simples na borda X máx.");
    await endSupport.uncheck();
    await expect(drawing.locator(".slab-supported-edge")).toHaveCount(3);
    await endSupport.check();

    const setField = async (label: string, value: string) => {
      const field = page.getByLabel(label, { exact: true });
      await field.fill(value);
      await field.press("Enter");
    };
    await setField("Pressão pZ", "-5");
    const save = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Salvar projeto", exact: true })
      .click();
    const path = (await (await save).path())!;
    const project = parseProject(await readFile(path, "utf8"));
    expect(project.slabs[0]).toMatchObject({
      formulation,
      thickness: 0.1,
      divisionsX: 8,
      divisionsY: 6,
      levelId: "level1",
    });
    expect(project.loadPatterns[0].pressure).toEqual([
      { slabId: project.slabs[0].id, pz: -5000 },
    ]);
    await page
      .getByRole("button", { name: "Novo projeto", exact: true })
      .click();
    const open = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Abrir projeto", exact: true })
      .click();
    await (
      await open
    ).setFiles({
      name: "laje.kstruct.json",
      mimeType: "application/json",
      buffer: await readFile(path),
    });
    await expect(page.getByLabel("Pressão pZ")).toHaveValue("-5");
    await expect(page.getByLabel("Pavimento ativo")).toHaveValue("level1");

    await page.getByRole("button", { name: "Análise", exact: true }).click();
    const exported = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Entrada OOFEM", exact: true })
      .click();
    const deck = await readFile((await (await exported).path())!, "utf8");
    const input = exportOofem(project, "EL");
    expect(deck).toEqual(input.deck);
    if (formulation === "qdkt") {
      expect(deck).toContain("qdktplate 1 nodes 4 11 10 1 2");
      expect(deck).toContain("components 3 -5000 0 0 csType 0");
    }

    if (!executable) return; // The frontend job still verifies creation, persistence and export.
    const expected = parseOofemOutput(runDeck(deck, executable), input).slab!;
    await page.evaluate(() => sessionStorage.setItem("slab-ipc", "enabled"));
    await page.reload();
    const analyze = page.getByRole("button", { name: "Analisar", exact: true });
    const finish = async () => {
      await page.waitForFunction(
        () =>
          (window as unknown as SlabTestWindow).finishSlabAnalysis !==
          undefined,
      );
      await page.evaluate(() =>
        (window as unknown as SlabTestWindow).finishSlabAnalysis!(),
      );
    };
    await analyze.click();
    await finish();
    const display = page.getByLabel("Visualização dos resultados");
    const table = page.getByRole("table", {
      name: "Flecha e momentos no centro da laje",
    });
    await expect(display).toHaveValue("slab-uz");
    await expect(drawing.locator(".slab-map polygon")).toHaveCount(
      formulation === "qdkt" ? 48 : 96,
    );
    await expect(
      table.getByRole("cell", {
        name: formatResult(expected.center.uz * 1000),
        exact: true,
      }),
    ).toBeVisible();
    for (const [component, label] of [
      ["mx", "Mx"],
      ["my", "My"],
    ] as const) {
      await display.selectOption(`slab-${component}`);
      await expect(page.getByLabel("Legenda do mapa da laje")).toContainText(
        `L1 · Momento local ${label}`,
      );
      await expect(page.getByLabel("Legenda do mapa da laje")).toContainText(
        "kN·m/m",
      );
      await expect(
        table.getByRole("cell", {
          name: formatResult(expected.center[component] / 1000),
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `test-results/kstruct-slab-${formulation}.png`,
      fullPage: true,
    });

    await page
      .locator(".explorer")
      .getByRole("button", { name: "L1", exact: true })
      .click();
    await setField("Subdivisões em X", "16");
    await expect(display).toHaveValue("model");
    await expect(table).toHaveCount(0);
    await analyze.click();
    await setField("Subdivisões em Y", "12");
    await finish();
    await expect(page.getByRole("status")).toContainText(
      "O modelo mudou durante a análise",
    );
    await expect(drawing.locator(".slab-map")).toHaveCount(0);
    await analyze.click();
    await finish();
    await expect(drawing.locator(".slab-map polygon")).toHaveCount(
      formulation === "qdkt" ? 192 : 384,
    );
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await expect(table).toHaveCount(0);
    await page.getByRole("button", { name: "Refazer", exact: true }).click();
    await expect(table).toHaveCount(0);
  });
}
