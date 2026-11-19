# KStruct

**Análise estrutural open source, parte do ecossistema OpenStruct.**

KStruct faz referência à matriz de rigidez **[K]**. A direção do produto é um ambiente completo de lançamento, análise e interpretação de estruturas, com a fluidez de trabalho de ferramentas como SAP2000 e uma identidade própria.

![Dédalo e a coluna grega — KStruct](public/assets/dedalo.webp)

## Etapa atual — 0.1.0 alpha

Primeiro fluxo de trabalho de estática linear **no plano XZ**. A perspectiva 3D mostra o mesmo modelo e compartilha a seleção. A análise espacial será implementada em uma etapa própria.

- Lançar barras e nós por clique com snap de 0,50 m e reutilização de nós coincidentes.
- Editar coordenadas, apoios UX/UZ/RY, seção retangular, módulo E, Poisson e cargas globais.
- Aplicar forças e momentos nodais e cargas uniformes em barras. Peso próprio é manual nesta etapa.
- Salvar e reabrir `.kstruct.json`, com formato versionado e validação. Desfazer/refazer até 50 edições e recuperar o último rascunho local.
- Gerar entrada OOFEM, executar o motor nativo pelo Tauri e interpretar a saída.
- Consultar reações, deslocamentos, esforços N/V/M, deformada ampliada, diagramas amostrados, CSV e saída original.
- Invalidar resultados após alterações. Verificar conectividade, apoios de cada componente e equilíbrio global antes de apresentar resultados.

Não há resultados demonstrativos no botão **Analisar**. Sem um OOFEM instalado, a aplicação explica como configurar o motor. No navegador, o editor e a exportação de entrada funcionam, mas a execução nativa requer o desktop.

## Executar

Node.js 22.12 ou superior.

```sh
npm ci
npm run dev
```

Abra `http://127.0.0.1:1420`. Para o aplicativo desktop, instale Rust 1.89 ou superior e os [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/).

```sh
npm run desktop:dev
```

Para compilar a aplicação e os pacotes da plataforma atual:

```sh
npm run desktop:build
```

O instalador do KStruct ainda não inclui o OOFEM. Instale uma distribuição do [OOFEM 3.0](https://github.com/oofem/oofem/releases/tag/v3.0), preservando suas bibliotecas, e selecione o executável em **Configurar OOFEM**. Também é possível definir `OOFEM_BIN` com o caminho absoluto ou disponibilizar `oofem` no `PATH`. Consulte [Configuração do motor](docs/OOFEM.md).

## Primeiro uso

1. Abra **Viga de referência**. Ela contém 6 m de vão, seção 15 × 20 cm, E = 200 GPa e carga de −10 kN/m em Z.
2. Selecione a barra ou um nó em qualquer vista ou no explorador. As propriedades aparecem à direita.
3. No desktop, configure o OOFEM e clique **Analisar**. Reações esperadas de 30 kN por apoio, momento de meio de vão 45 kN·m e flecha −8,4375 mm.
4. Altere a carga e analise novamente. A edição remove os resultados anteriores.
5. Para começar do zero, use **Novo projeto**, ative **Barra** (`B`) e marque duas extremidades. Defina apoios e cargas antes de analisar.

Atalhos: `V` selecionar, `N` nó, `B` barra, `Esc` cancelar lançamento, `Delete` excluir seleção, `Ctrl+Z` desfazer, `Ctrl+Shift+Z` refazer e `Ctrl+S` salvar. Na elevação, scroll aproxima e afasta, botão central arrasta. A vista 3D orbita ao arrastar.

## Verificação

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Os benchmarks numéricos exigem `OOFEM_BIN`. Sem ele, aparecem explicitamente como **skipped**. A CI compila o OOFEM no commit da tag 3.0 e executa esses benchmarks, além de verificar Rust em Windows e Linux.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test
cargo test --manifest-path crates/solver-runner/Cargo.toml
```

Veja [validação e limites](docs/VALIDATION.md), [arquitetura](docs/ARCHITECTURE.md) e [sequência de desenvolvimento](docs/ROADMAP.md).

## Licenças

Código original KStruct sob MIT. O OOFEM é uma dependência externa com licença LGPL-2.1-or-later. Seus fontes e binários não integram este repositório. [Avisos de terceiros](THIRD_PARTY_NOTICES.md).

Desenvolvimento inicial. Cada ampliação da capacidade de análise deve ser acompanhada por casos de referência e verificações numéricas específicas.
