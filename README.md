# KStruct

**Análise estrutural open source, parte do ecossistema OpenStruct.**

KStruct faz referência à matriz de rigidez **[K]**. A direção do produto é um ambiente completo de lançamento, análise e interpretação de estruturas, com a fluidez de trabalho de ferramentas como SAP2000 e uma identidade própria.

![Interface inicial do KStruct](docs/images/editor.webp)

## Etapa atual — 0.2.0 alpha

Primeiro fluxo de trabalho de estática linear **no plano XZ**. A perspectiva 3D mostra o mesmo modelo e compartilha a seleção. A análise espacial será implementada em uma etapa própria.

- Lançar barras e nós por clique com snap de 0,50 m e reutilização de nós coincidentes.
- Editar coordenadas, apoios UX/UZ/RY, seção retangular, módulo E, Poisson e cargas globais.
- Aplicar forças e momentos nodais e cargas uniformes em barras. Peso próprio é manual nesta etapa.
- Salvar e reabrir `.kstruct.json`, com formato versionado e validação. Desfazer/refazer até 50 edições e recuperar o último rascunho local.
- Executar o OOFEM 3.0 integrado nos pacotes Windows e Linux, com diagnóstico, cancelamento e histórico local.
- Consultar reações, deslocamentos, esforços N/V/M, deformada ampliada, diagramas amostrados, CSV e saída original.
- Invalidar resultados após alterações. Verificar conectividade, apoios de cada componente e equilíbrio global antes de apresentar resultados.

No navegador, use o editor e a exportação de entrada. O botão **Analisar** executa o solver nativo na aplicação desktop.

## Instalar e executar

Os pacotes de teste para Windows (NSIS) e Linux (.deb e AppImage) estão no workflow de empacotamento. Consulte [os downloads e o procedimento de instalação](docs/DISTRIBUTION.md).

Para desenvolvimento, use Node.js 22.12 ou superior.

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

A compilação dos pacotes prepara o OOFEM a partir do commit fixado da versão 3.0. No modo de desenvolvimento, configure um executável com `OOFEM_BIN` ou pelo caminho em **Configurar OOFEM**. Consulte [seleção e diagnóstico do motor](docs/OOFEM.md).

## Primeiro uso

1. Abra **Viga de referência**. Ela contém 6 m de vão, seção 15 × 20 cm, E = 200 GPa e carga de −10 kN/m em Z.
2. Selecione a barra ou um nó em qualquer vista ou no explorador. As propriedades aparecem à direita.
3. No desktop instalado, clique **Analisar**. Reações esperadas de 30 kN por apoio, momento de meio de vão 45 kN·m e flecha −8,4375 mm.
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

Os benchmarks numéricos exigem `OOFEM_BIN`. Sem ele, aparecem explicitamente como **skipped**. A CI executa os benchmarks com o commit da tag 3.0 e verifica os pacotes instalados em Windows e Linux.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test
cargo test --manifest-path crates/solver-runner/Cargo.toml
```

Veja [validação e limites](docs/VALIDATION.md), [arquitetura](docs/ARCHITECTURE.md) e [sequência de desenvolvimento](docs/ROADMAP.md).

## Licenças

Código original KStruct sob MIT. Os pacotes desktop incluem o OOFEM como executável independente, com sua licença LGPL-2.1-or-later, fontes correspondentes e instruções de compilação. [Avisos de terceiros](THIRD_PARTY_NOTICES.md).

Desenvolvimento inicial. Cada ampliação da capacidade de análise deve ser acompanhada por casos de referência e verificações numéricas específicas.
