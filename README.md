# KStruct

**Análise estrutural open source, parte do ecossistema OpenStruct.**

KStruct faz referência à matriz de rigidez **[K]**. A direção do produto é um ambiente completo de lançamento, análise e interpretação de estruturas, com a fluidez de trabalho de ferramentas como SAP2000 e uma identidade própria.

![Interface inicial do KStruct](docs/images/editor.webp)

## Recursos no código atual

O editor trabalha com projetos **planos XZ** ou **espaciais XYZ** e usa a mesma seleção na vista de lançamento, na perspectiva 3D e no explorador.

- Lançar barras e nós em planta XY ou elevações XZ/YZ, com eixos, pavimentos, modo ortogonal e snap em referências ou passos de 0,50 m.
- Selecionar, replicar por deslocamento e conectar interseções em 3D. As cópias levam geometria, seção e orientação, com nós novos sem apoios nem cargas.
- Editar coordenadas, apoios nos graus de liberdade do projeto, seção retangular, orientação da seção e cargas globais.
- Aplicar forças e momentos nodais e cargas uniformes em barras. Peso próprio é manual nesta etapa.
- Lançar uma laje retangular isolada em planta XY, editar apoios, pressão e malha e consultar mapas de flecha e momentos locais.
- Salvar e reabrir `.kstruct.json` no esquema v6, com migração dos projetos v1 a v5 na abertura. Desfazer e refazer até 50 edições e recuperar o último rascunho local.
- Executar o OOFEM 3.0 integrado nos pacotes Windows e Linux, com diagnóstico, cancelamento e histórico local.
- Resolver a estática linear com `Beam2d` ou `Beam3d`. Consultar os seis componentes de reações, deslocamentos e esforços no modelo espacial, além de deformada, diagramas, CSV e saída do OOFEM.
- Invalidar resultados após alterações. Verificar conectividade, apoios de cada componente e equilíbrio global antes de apresentar resultados.

No navegador, use o editor e a exportação de entrada. O botão **Analisar** executa o solver nativo na aplicação desktop.

## Instalar e executar

Encontre o KStruct no [Struct Launcher](https://openstruct.com.br/launcher). Consulte a [distribuição desktop](docs/DISTRIBUTION.md) para baixar os pacotes avulsos e conferir a instalação.

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

Para explorar os envelopes de esforços, baixe o [projeto de exemplo do pórtico em L](examples/portico-em-l-envelopes.kstruct.json) e siga o [roteiro de análise e conferência](examples/README.md).

1. Abra **Viga de referência**. Ela contém 6 m de vão, seção 15 × 20 cm, E = 200 GPa e carga de −10 kN/m em Z.
2. Selecione a barra ou um nó em qualquer vista ou no explorador. As propriedades aparecem à direita.
3. No desktop instalado, clique **Analisar**. Reações esperadas de 30 kN por apoio, momento de meio de vão 45 kN·m e flecha −8,4375 mm.
4. Altere a carga e analise novamente. A edição remove os resultados anteriores.
5. Para começar do zero, use **Novo projeto** para XZ ou **Novo pórtico espacial** para XYZ. Ative **Barra** (`B`) e marque duas extremidades. Defina apoios e cargas antes de analisar.

No modelo espacial, defina os eixos e as cotas em **Eixos e pavimentos**. Escolha o pavimento para lançar vigas em planta e alterne para uma elevação para lançar pilares. **Orto** alinha a segunda extremidade no plano. Segure `Shift` para inverter o modo durante o clique. Use `Ctrl` ou `Shift` para montar uma seleção e **Replicar** para copiar a geometria até outro pavimento. Use **Conectar interseções** onde as barras precisam compartilhar nós.

Em **Barra** (`B`), escolha o **Traçado**. **Dois pontos** lança uma barra por par de cliques. **Em cadeia** aproveita a última extremidade para o próximo trecho. **Vão entre eixos** destaca o intervalo entre duas guias consecutivas e o lança com um clique. Aponte para o interior do vão para indicar a direção. Escolha a seção ativa e, em XYZ, a rotação em graus. `Esc` encerra o lançamento e **Desfazer** remove um trecho por vez.

Em **Modelo** → **Tabela de nós**, edite as coordenadas em metros de vários nós em um único passo. A tabela mostra X e Z no modelo plano e X, Y e Z no espacial. Use vírgula ou ponto para decimais e corrija as células destacadas antes de clicar em **Aplicar**. **Cancelar** descarta o rascunho. **Desfazer** e **Refazer** atuam sobre o lote inteiro. Após aplicar uma alteração, analise novamente para atualizar os resultados.

Em **Exibição → Arranjo de vistas**, escolha **Planta + elevação + perspectiva** para acompanhar um pórtico espacial nos três painéis. Clique ou dê foco ao painel em que quer trabalhar. A faixa acima do desenho identifica a vista ativa e sua cota. Os controles de plano e eixo atuam nessa vista. Zoom, enquadramento, nomes, grelha e cargas podem ser ajustados em cada painel. Trocar de vista cancela o trecho em andamento e preserva as peças já lançadas. No projeto plano, use a elevação XZ sozinha ou ao lado da perspectiva.

Em **Exibição → Tema**, escolha **Claro** ou **Escuro**. A primeira abertura usa o tema escuro. A escolha é guardada nas preferências locais e vale para a interface e as duas vistas, inclusive durante a consulta de resultados.

Em **Novo projeto**, escolha **Viga contínua** para informar os vãos em X ou **Pórtico regular** para definir vãos e alturas dos pavimentos. No modelo espacial, informe também os vãos em Y. Confira as quantidades de nós e barras na prévia e clique em **Gerar projeto**. Os nós começam livres e as cargas podem ser lançadas no editor.

### Laje retangular isolada

1. Abra **Novo pórtico espacial**, deixe a **Planta XY** ativa e selecione o pavimento. Ative **Laje** (`L`) e clique em dois cantos opostos do painel.
2. Nas propriedades, informe os lados em metros, a espessura em centímetros, o material, as bordas com apoio simples, as subdivisões em X/Y e a **Pressão pZ** em kN/m² para o padrão escolhido. O sinal negativo indica pressão para baixo. Em **Elemento de placa**, o quadrilateral **QDKT** usa apoio simples nas quatro bordas. O triangular **DKT** permite liberar bordas e requer pelo menos duas apoiadas.
3. Salve o projeto. No desktop, selecione o caso estático e clique em **Analisar**. O seletor de visualização oferece os mapas de **Flecha UZ**, **Momento local Mx** e **Momento local My**. O painel de resultados mostra os valores no centro e a soma de reações em Z.
4. Para reproduzir a [placa de referência QDKT](docs/VALIDATION.md#placa-retangular-simplesmente-apoiada), use 4 × 3 m, espessura de 10 cm, E = 30 GPa, ν = 0,20, as quatro bordas apoiadas e pZ = −5 kN/m². Repita com 8 × 6, 16 × 12 e 32 × 24 subdivisões.

O fluxo de laje usa um painel isolado por projeto e resultados por caso estático. As propriedades do painel e da malha são guardadas no arquivo. Edições, desfazer e refazer descartam os resultados da revisão anterior.

### Padrões, casos, combinações e envelopes

Abra **Cargas e casos** para criar padrões como permanentes, sobrecarga ou vento Y e definir casos estáticos com os fatores de cada padrão. Em **Modelo**, selecione o padrão no qual deseja trabalhar e atribua as ações pelos campos de propriedades de cada nó ou barra.

No desktop, escolha um caso estático em **Caso, combinação ou envelope** e clique em **Analisar**. Repita para os demais casos. O seletor alterna entre os resultados da revisão atual.

Para combinar os resultados, abra **Cargas e casos** → **Combinações lineares** e cadastre os casos e seus fatores. Informe ao menos um fator diferente de zero. Depois de aplicar as definições e analisar os casos com fatores diferentes de zero, selecione a combinação em **Caso, combinação ou envelope**. O KStruct exibe a composição, a deformada, os diagramas e as tabelas. Os CSVs identificam a origem das linhas e registram os IDs e fatores dos casos que compõem cada combinação.

Na aba **Esforços** de um caso ou combinação, use **Barra** para filtrar as estações da tabela e do CSV. A opção inicial é **Todas as barras**. O filtro acompanha a troca de resultados do projeto e volta a **Todas as barras** se a barra selecionada for removida.

Em **Cargas e casos** → **Envelopes**, dê um nome ao envelope e marque as combinações que participam. Depois de analisar seus casos, selecione o envelope e o componente de esforço. As curvas indicam o mínimo e o máximo com sinal nas estações da malha. Clique no diagrama ou escolha **Barra** e **Estação x/L** para consultar a combinação governante de cada extremo e todos os esforços que atuam simultaneamente naquela seção. O CSV inclui as estações de todas as barras para o componente em exibição, com IDs e fatores para rastrear cada extremo. Uma edição do projeto ou das definições descarta os resultados em memória.

Use `V` para selecionar, `N` para criar nó, `B` para criar barra, `L` para lançar laje, `Esc` para cancelar lançamento, `Delete` para excluir seleção, `Ctrl+Z` para desfazer, `Ctrl+Shift+Z` para refazer e `Ctrl+S` para salvar. Na elevação, scroll aproxima e afasta, botão central arrasta. A vista 3D orbita ao arrastar.

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
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- spatial.spec.ts load-cases.spec.ts slab.spec.ts
cargo test --manifest-path crates/solver-runner/Cargo.toml
```

Veja [validação e limites](docs/VALIDATION.md), [arquitetura](docs/ARCHITECTURE.md) e [sequência de desenvolvimento](docs/ROADMAP.md).

## Licenças

Código original KStruct sob MIT. Os pacotes desktop incluem o OOFEM como executável independente, com sua licença LGPL-2.1-or-later, fontes correspondentes e instruções de compilação. [Avisos de terceiros](THIRD_PARTY_NOTICES.md).

Desenvolvimento inicial. Cada ampliação da capacidade de análise deve ser acompanhada por casos de referência e verificações numéricas específicas.
