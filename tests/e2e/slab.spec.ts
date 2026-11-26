import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { formatResult } from "../../src/components/resultFormatting";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { addPolygonSlab, newSlabRing } from "../../src/domain/editing";
import { openProjectInBrowser } from "../fixtures/open-project";
import { slabBenchmarkProject } from "../fixtures/slab-benchmark";
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
    const properties = page.getByLabel("Propriedades do material");
    await expect(properties).toContainText("30 GPa");
    await expect(properties).toContainText("0,2");
    await page
      .getByRole("button", { name: "Abrir material na biblioteca" })
      .click();
    const library = page.getByRole("dialog", {
      name: "Biblioteca de materiais",
    });
    await expect(
      library.getByLabel("Material do projeto").locator("option:checked"),
    ).toHaveText("Concreto");
    await library
      .getByRole("button", { name: "Editar material", exact: true })
      .click();
    await expect(
      library.getByRole("region", { name: "Uso do material" }),
    ).toContainText("1 laje · L1");
    await library.getByRole("button", { name: "Cancelar edição" }).click();
    await library.getByRole("button", { name: "Fechar", exact: true }).click();
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
    await page
      .getByRole("dialog", { name: "Novo projeto" })
      .getByRole("button", { name: "Criar projeto", exact: true })
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

test("KS-41 · desenha, edita e reabre uma laje em L com abertura na planta", async ({
  page,
}) => {
  test.setTimeout(60000);
  if (executable) await plateBridge(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Novo pórtico espacial" }).click();
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  const drawing = page.getByRole("application", {
    name: "Área de lançamento XY",
  });
  const clickAt = async (x: number, y: number) => {
    const position = await drawing.evaluate(
      (svg, [x, y]) => {
        const coord = (axis: "x" | "y", v: number) =>
          Number(
            svg
              .querySelector(`line[data-axis="${axis}"][data-position="${v}"]`)!
              .getAttribute(`${axis}1`),
          );
        return {
          x: coord("x", 0) + ((coord("x", 4) - coord("x", 0)) * x) / 4,
          y: coord("y", 0) + ((coord("y", 4) - coord("y", 0)) * y) / 4,
        };
      },
      [x, y],
    );
    await drawing.click({ position });
  };
  const trace = async (points: number[][]) => {
    for (const [x, y] of points) await clickAt(x, y);
  };
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Laje poligonal").click();
  await trace([
    [0, 0],
    [1, 0],
  ]);
  await expect(drawing.locator(".slab-trace circle")).toHaveCount(2);
  await button("Desfazer vértice").click();
  await expect(drawing.locator(".slab-trace circle")).toHaveCount(1);
  await button("Cancelar traçado").click();
  await expect(drawing.locator(".slab-plan")).toHaveCount(0);
  await button("Laje poligonal").click();
  await trace([
    [0, 0],
    [6, 0],
    [6, 2],
    [3, 2],
    [3, 4],
    [0, 4],
    [0, 0],
  ]);
  await expect(drawing.locator(".slab-supported-edge")).toHaveCount(6);
  await button("Abertura na laje").click();
  await trace([
    [4, 2.5],
    [5, 2.5],
    [5, 3.5],
  ]);
  await button("Fechar contorno").click();
  await expect(page.getByRole("alert")).toContainText(/fora do contorno/);
  await button("Cancelar traçado").click();
  await button("Abertura na laje").click();
  await trace([
    [1, 0.5],
    [2, 0.5],
    [2, 1.5],
    [1, 1.5],
  ]);
  await button("Fechar contorno").click();
  await expect(drawing.locator(".slab-free-edge")).toHaveCount(4);
  await expect(page.locator(".slab-contour-fields")).toContainText("17 m²");
  const pressure = page.getByLabel("Pressão pZ", { exact: true });
  await pressure.fill("-5");
  await pressure.press("Enter");
  const save = async () => {
    const download = page.waitForEvent("download");
    await button("Salvar projeto").click();
    return await readFile((await (await download).path())!, "utf8");
  };
  const before = await save();
  const original = parseProject(before);
  const selectSlab = () =>
    page
      .locator(".explorer")
      .getByRole("button", { name: "L1", exact: true })
      .click();
  await page.getByLabel("Contorno da laje").selectOption("1");
  await page.getByLabel("Vínculo da borda").selectOption("simple");
  await page.getByLabel("X do vértice").fill("1,25");
  await button("Aplicar vértice").click();
  const edited = await save();
  const updated = parseProject(edited);
  const savedRing = updated.slabs[0].polygon!.rings[1],
    originalRing = original.slabs[0].polygon!.rings[1];
  expect(savedRing.map((v) => v.edgeId)).toEqual(
    originalRing.map((v) => v.edgeId),
  );
  expect(savedRing[0]).toMatchObject({ x: 1.25, supported: true });
  await button("Desfazer").click();
  await selectSlab();
  await page.getByLabel("Contorno da laje").selectOption("1");
  await expect(page.getByLabel("X do vértice")).toHaveValue("1");
  await expect(page.getByLabel("Vínculo da borda")).toHaveValue("simple");
  await button("Refazer").click();
  const open = page.waitForEvent("filechooser");
  await button("Abrir projeto").click();
  await (
    await open
  ).setFiles({
    name: "poligonal.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(edited),
  });
  await expect(page.getByLabel("Pressão pZ")).toHaveValue("-5");
  await expect(drawing.locator(".slab-supported-edge")).toHaveCount(7);
  const reopen = page.waitForEvent("filechooser");
  await button("Abrir projeto").click();
  await (
    await reopen
  ).setFiles({
    name: "ensaio.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(before),
  });
  await expect(drawing.locator(".slab-supported-edge")).toHaveCount(6);
  // Compare the actual SVG hit region in a void, the reentrant cut and the material.
  const hits = await drawing.evaluate((svg) => {
    const outline = svg.querySelector(
      ".slab-plan path[fill-rule=evenodd]",
    ) as SVGPathElement;
    const coord = (axis: "x" | "y", v: number) =>
      Number(
        svg
          .querySelector(`line[data-axis="${axis}"][data-position="${v}"]`)!
          .getAttribute(`${axis}1`),
      );
    return [
      [1.5, 1],
      [5, 3],
      [3, 1],
    ].map(([x, y]) =>
      outline.isPointInFill(
        new DOMPoint(
          coord("x", 0) + ((coord("x", 4) - coord("x", 0)) * x) / 4,
          coord("y", 0) + ((coord("y", 4) - coord("y", 0)) * y) / 4,
        ),
      ),
    );
  });
  expect(hits).toEqual([false, false, true]);
  if (!executable) return;
  await page.evaluate(() => sessionStorage.setItem("slab-ipc", "enabled"));
  await page.reload();
  await button("Analisar").click();
  await page.waitForFunction(
    () =>
      (window as unknown as SlabTestWindow).finishSlabAnalysis !== undefined,
  );
  await page.evaluate(() =>
    (window as unknown as SlabTestWindow).finishSlabAnalysis!(),
  );
  await expect(
    page.getByRole("table", { name: "Flecha e momentos no ponto de consulta" }),
  ).toContainText("Centroide da área líquida");
  await expect(drawing.locator(".slab-map polygon")).toHaveCount(160);
  await expect(page.locator(".slab-equilibrium")).toContainText("-85");
});

test("KS-42 · configura, desfaz, reabre e compara duas malhas QDKT no mesmo ponto", async ({
  page,
}) => {
  test.setTimeout(60000);
  if (executable) await plateBridge(page);
  const project = slabBenchmarkProject();
  project.slabs[0].formulation = "qdkt";
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "placa.kstruct.json",
    serializeProject(project),
  );
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const editor = page.getByRole("dialog", { name: "Malha da laje" });
  const openMesh = async () => {
    await page
      .locator(".explorer")
      .getByRole("button", { name: "L1", exact: true })
      .click();
    await button("Configurar malha da laje").click();
  };
  await openMesh();
  const count = editor.getByLabel("Contagem da malha");
  await expect(count).toContainText("48 elementos");
  await editor.getByLabel("Geração da malha").selectOption("target");
  const target = editor.getByLabel("Tamanho-alvo global");
  await target.fill("0.000000001");
  await expect(editor.getByRole("alert")).toContainText("limite");
  await expect(button("Aplicar malha")).toBeDisabled();
  await button("Cancelar").click();
  await openMesh();
  await expect(editor.getByLabel("Geração da malha")).toHaveValue("legacy");
  await editor.getByLabel("Geração da malha").selectOption("target");
  await target.fill("0.5");
  await expect(count).toContainText("48 elementos · 63 nós · 0 inválidos");
  await button("Aplicar malha").click();
  await button("Desfazer").click();
  await openMesh();
  await expect(editor.getByLabel("Geração da malha")).toHaveValue("legacy");
  await button("Cancelar").click();
  await button("Refazer").click();
  const download = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const saved = await readFile((await (await download).path())!, "utf8");
  expect(parseProject(saved).slabs[0].sizing).toEqual({
    target: 0.5,
    edges: [],
  });
  await openProjectInBrowser(page, "placa-refinada.kstruct.json", saved);
  await openMesh();
  await expect(target).toHaveValue(/0[,.]5/);
  await button("Cancelar").click();
  if (!executable) return;
  await page.evaluate(() => sessionStorage.setItem("slab-ipc", "enabled"));
  await page.reload();
  const solve = async () => {
    await button("Analisar").click();
    await page.waitForFunction(
      () => !!(window as unknown as SlabTestWindow).finishSlabAnalysis,
    );
    await page.evaluate(() =>
      (window as unknown as SlabTestWindow).finishSlabAnalysis!(),
    );
    await expect(button("Comparar malhas")).toBeEnabled();
  };
  await solve();
  await button("Comparar malhas").click();
  const compare = page.getByRole("dialog", { name: "Comparação de malhas" });
  const table = compare.getByRole("table", {
    name: "Resultados no mesmo ponto",
  });
  await compare.getByLabel("X da consulta").fill("2");
  await compare.getByLabel("Y da consulta").fill("1.5");
  await expect(table).toContainText("Atual · 48 elementos");
  await button("Guardar referência desta malha").click();
  await button("Fechar comparação").click();
  await openMesh();
  await target.fill("0.25");
  await expect(count).toContainText("192 elementos");
  await button("Aplicar malha").click();
  await expect(button("Comparar malhas")).toBeDisabled();
  await solve();
  await button("Comparar malhas").click();
  await expect(table).toContainText("Atual · 192 elementos");
  await expect(table).toContainText("Referência · 48 elementos");
  const uz = table.getByRole("row").filter({ hasText: "UZ" });
  await expect(uz.getByRole("cell").nth(1)).toHaveText(
    formatResult(-1.02991662),
  );
  await expect(uz.getByRole("cell").nth(2)).toHaveText(
    formatResult(-1.0266872),
  );
  await expect(table.getByRole("row")).toHaveCount(5);
  await compare.getByLabel("X da consulta").fill("40");
  await expect(compare.getByRole("alert")).toContainText("área de material");
  await expect(button("Guardar referência desta malha")).toBeDisabled();
  await button("Fechar comparação").click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "L1", exact: true })
    .click();
  const pressure = page.getByLabel("Pressão pZ");
  await pressure.fill("-4");
  await pressure.press("Enter");
  await solve();
  await button("Comparar malhas").click();
  await expect(table).toContainText("Atual · 192 elementos");
  await expect(
    table.getByRole("columnheader", { name: /Referência/ }),
  ).toHaveCount(0);
});

test("KS-42 · refina a abertura e o apoio e localiza o elemento com alerta na prévia", async ({
  page,
}) => {
  const p = createProject("spatial"),
    ring = (xy: number[][], supported: boolean) =>
      newSlabRing(
        xy.map(([x, y]) => ({ x, y })),
        supported,
      );
  const slab = addPolygonSlab(p, "level1", [
    ring(
      [
        [0, 0],
        [6, 0],
        [6, 2],
        [3, 2],
        [3, 4],
        [0, 4],
      ],
      true,
    ),
    ring(
      [
        [1, 0.5],
        [2, 0.5],
        [2, 1.5],
        [1, 1.5],
      ],
      false,
    ),
  ]);
  await page.goto("/");
  await openProjectInBrowser(page, "painel.kstruct.json", serializeProject(p));
  await page.getByRole("button", { name: "Configurar malha da laje" }).click();
  const d = page.getByRole("dialog", { name: "Malha da laje" });
  await d.getByLabel("Geração da malha").selectOption("target");
  await d.getByLabel("Tamanho-alvo global").fill("1");
  const count = d.getByLabel("Contagem da malha");
  await expect(count).toContainText("160 elementos · 94 nós");
  for (const scope of ["ring:1", "edge:" + slab.polygon.rings[0][1].edgeId]) {
    await d.getByLabel("Refinar junto a").selectOption(scope);
    await d.getByLabel("Tamanho local").fill("0.25");
    await d
      .getByRole("button", { name: "Adicionar controle à prévia" })
      .click();
  }
  await expect(count).toContainText("484 elementos · 271 nós · 0 inválidos");
  const select = d.getByLabel("Ocorrências de qualidade");
  await select.selectOption({ index: 1 });
  const id = await select.inputValue();
  await expect(d.locator('polygon[data-picked="true"]')).toHaveAttribute(
    "data-element",
    id,
  );
  await expect(
    d.getByText(new RegExp("Elemento " + id + " · X ")),
  ).toBeVisible();
  await d.getByRole("button", { name: "Aplicar malha" }).click();
  const save = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const saved = parseProject(
    await readFile((await (await save).path())!, "utf8"),
  );
  expect(saved.slabs[0].sizing?.edges.map((e) => e.edgeId).sort()).toEqual(
    [slab.polygon.rings[0][1], ...slab.polygon.rings[1]]
      .map((v) => v.edgeId)
      .sort(),
  );
  slab.polygon.rings = [
    ring(
      [
        [0, 0],
        [1e10, 0],
        [0, 0.1],
      ],
      true,
    ),
  ];
  await openProjectInBrowser(
    page,
    "degenerada.kstruct.json",
    serializeProject(p),
  );
  await page.getByRole("button", { name: "Configurar malha da laje" }).click();
  await expect(count).toContainText(/\b[1-9]\d* inválidos/);
  await expect(d.getByRole("button", { name: "Aplicar malha" })).toBeDisabled();
  await d.getByLabel("Ocorrências de qualidade").selectOption({ index: 1 });
  await expect(d.locator('polygon[data-picked="true"]')).toHaveAttribute(
    "data-quality",
    "invalid",
  );
  await d.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page
    .getByRole("button", { name: "Entrada OOFEM", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Malha inválida.*elemento/,
  );
});
