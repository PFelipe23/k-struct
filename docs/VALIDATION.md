# Validação inicial

Os testes do domínio e do parser são executados por `npm run check`. Os testes de integração numérica só são executados quando `OOFEM_BIN` está definido. A ausência do binário produz testes explicitamente ignorados.

## Benchmarks analíticos

Unidades base N/m. E = 200 GPa, A = 0,03 m², IY = 0,0001 m⁴. O adaptador aproxima Euler–Bernoulli mediante rigidez elevada ao cisalhamento.

| Caso                                   | Referência                                                              |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Viga biapoiada L = 6 m, q = 10 kN/m    | R = 30 kN em cada apoio, M(L/2) = 45 kN·m, UZ(L/2) = −8,4375 mm         |
| Mesma viga, fator de carga 2           | R, M e deslocamentos duplicados                                         |
| Balanço horizontal L = 6 m, PZ = −1 kN | UZ = −PL³/(3EI), M(0) = −6 kN·m                                         |
| Pilar vertical L = 6 m, qX = 1 kN/m    | UX = qL⁴/(8EI), RX = −6 kN, MY = −18 kN·m                               |
| Balanço inclinado 3–4–5, PX = 1 kN     | Transformação global das flexibilidades axial L/EA e transversal L³/3EI |

Em 19/11/2026, estes cinco testes passaram localmente contra o binário Linux do build de desenvolvimento `v3.0-437-gd77741577`, commit `d77741577040616bb6173dd22f3306f7dd7b3308`. O workflow numérico compila e testa separadamente a tag exata 3.0. Consulte o estado do workflow para confirmar o resultado na revisão atual.

O caso vertical detectou a necessidade de transformação explícita das cargas distribuídas para a base local. O adaptador envia `csType 1` e não depende da rotação implícita do vetor de carga de Beam2d.

Os cinco benchmarks também passaram contra a tag exata 3.0 no [primeiro workflow numérico](https://github.com/ricardocorsini/k-struct/actions/runs/44565642421). A mesma execução confirmou o `cargo check` do aplicativo no Windows. A verificação atual é sempre a CI do commit em uso.

## Verificações adicionais

Persistência sem perda, rejeição de versões desconhecidas e referências quebradas, remoção de cargas dependentes, desfazer/refazer, identidade de nós no snap, componentes sem restrições suficientes, Y não nulo, nós dentro de barras não subdivididas, mapeamento determinístico e saída truncada.

A soma global de forças e momentos é conferida com tolerância relativa de 0,1% à soma dos módulos das contribuições (mais escala unitária). A saída textual do OOFEM usa precisão menor para esforços que para deslocamentos. Equilíbrio é uma verificação complementar e não substitui benchmarks de rigidez nem análise de convergência.

Uma saída real capturada também testa renderização e descarte de resultados obsoletos substituindo somente a fronteira IPC. O job numérico executa adicionalmente o runner Rust com o OOFEM real.

Os testes de interface cobrem desenho a partir de um projeto vazio, edição de carga, histórico, salvar/abrir, erro de solver no navegador e exportação da entrada. A CI verifica o layout mínimo de 1100 × 720 e produz uma captura em `test-results/kstruct-workspace.png`.

Na CI, Playwright usa o Chrome disponibilizado pelo runner Ubuntu e registra sua versão no log. Localmente, utiliza o Chromium instalado pelo próprio Playwright. A renderização 3D dos testes usa SwiftShader.

## Distribuição e regressão em pórtico

O pórtico XZ de dois pavimentos tem pilares com propriedades diferentes, dois carregamentos uniformes e forças e momento nodais. A [referência independente](../tests/fixtures/portal-reference.py) monta a matriz de rigidez por barras de Euler–Bernoulli com Python e NumPy. A integração compara as reações nas bases, translações e rotações de cobertura e momentos de extremidade da viga superior.

O [workflow de pacotes](https://github.com/ricardocorsini/k-struct/actions/workflows/desktop-packages.yml) repete os benchmarks com o executável produzido em cada plataforma. Ele instala o NSIS e o .deb e testa o AppImage extraído. Cada pacote é submetido ao autoteste nativo sem OOFEM no PATH e com acesso externo desabilitado para a execução de teste. O relatório registra as reações e a flecha da viga, e o workflow confere os hashes do executável e do arquivo-fonte instalado.

Os testes do runner exercitam cancelamento, tempo limite e persistência de registros. O Playwright verifica as ações de cancelar, recuperar o histórico e consultar o diagnóstico usando a fronteira IPC simulada, enquanto os testes dos pacotes executam o OOFEM real.

## Pórtico espacial de dois pavimentos

O [modelo de referência](../tests/fixtures/portal-spatial.json) tem nove nós, onze barras e três bases engastadas. Os pavimentos estão a 2,8 m e 6 m. Na cobertura, uma barra oblíqua tem seção girada em 27°, com carga uniforme em X, Y e Z. O nó N5 recebe forças em Y e Z e momentos em X e Z.

A [referência independente em NumPy](../tests/fixtures/portal-spatial-reference.py) usa rigidez direta, um elemento analítico por barra e cargas nodais consistentes. A integração compara todas as translações e rotações nodais, as seis componentes das reações nas bases e os esforços locais das duas extremidades de cada barra. Na referência, UY em N5 é 6,84634 mm e o My inicial da barra oblíqua é 4,31978 kN·m. O OOFEM escreve forças com menos algarismos que deslocamentos. A tolerância de comparação dos esforços e reações é 0,01 N ou N·m mais 0,006% do valor de referência.

O teste Playwright lança o modelo do vazio, altera eixos e cotas, replica vigas, lança pilares em duas elevações, aplica apoios e cargas, salva, reabre e exporta a entrada do OOFEM. Com `OOFEM_BIN`, resolve a entrada exportada, compara os valores com a solução independente e exercita as tabelas e diagramas espaciais entregando a saída real na fronteira IPC. O job numérico executa esse fluxo com a tag exata 3.0.

Um balanço espacial com rotação de seção de 90° verifica também a extensão axial, a flexão em ambos os planos e a torção pelas expressões fechadas de Euler–Bernoulli e Saint-Venant.

## Casos de carga no pórtico espacial

O Playwright reutiliza a geometria do pórtico para cadastrar um caso vertical com carga uniforme em B5 e um caso de vento Y com força nodal em N5. O teste salva e reabre o projeto e confere as entradas do OOFEM exportadas para cada caso.

Com `OOFEM_BIN`, o caso vertical tem resultante de reação de 25,654 kN em Z. O caso de vento aplica o fator de ensaio −0,75 sobre a força de 12 kN em Y e tem resultante de reação de 9 kN em Y. O teste confere as duas resultantes, alterna entre diagramas já calculados, verifica a identificação do caso no CSV e confirma a invalidação dos resultados após uma edição.

## Combinações lineares

A viga plana e o pórtico espacial são analisados no OOFEM 3.0 com ações distribuídas `G` e nodais `W`. Em cada modelo, `1,5 (1,2 G + 0,25 W) − 0,8 (−0,5 G + 0,75 W)` é comparado a uma análise direta com `2,2 G − 0,225 W`. A comparação cobre reações nos apoios, translações e rotações nos nós e todas as componentes de deslocamentos e esforços em cada estação das barras.

As tolerâncias refletem os algarismos impressos pelo OOFEM. Para forças e momentos, o erro absoluto admitido é de 0,1 N ou N·m mais 0,01% do valor de referência. O teste de interface verifica casos pendentes, diagrama, tabela, composição no CSV, reabertura e descarte dos resultados após uma edição.

## Envelopes de esforços

O benchmark usa um pórtico espacial em L com viga de 4 m, pilar engastado de 3 m e duas combinações de forças e momentos na extremidade livre. No meio da viga, a primeira combinação governa o maior momento `My = 11,99 kN·m` com `N = −4,8 kN`. A segunda governa a maior compressão `N = −15,1 kN` com `My = −4,98 kN·m`. O teste confere as seis componentes simultâneas em cada extremo por equilíbrio do trecho e análise direta de cada combinação no OOFEM 3.0.

O teste plano verifica a conservação do sinal e o desempate pela ordem de seleção. O Playwright verifica escolha das combinações, estação selecionada no diagrama, tabela, CSV, reabertura e invalidação. Os limites são avaliados nas estações da malha e ligados por segmentos no diagrama.

## Laje retangular isolada

O caso da [issue #9](https://github.com/ricardocorsini/k-struct/issues/9) usa uma placa de 4 × 3 m, espessura de 0,10 m, E = 30 GPa, ν = 0,20 e pZ = −5 kN/m². A resultante aplicada é −60 kN. A malha usa dois triângulos de Kirchhoff (DKT) por célula retangular. O apoio simples impõe UZ e a rotação correspondente à inclinação tangencial de cada borda. No interior das bordas, a rotação em torno da própria borda fica livre. Essa condição aproxima as bordas com flecha nula e momento normal nulo da referência. As propriedades do elemento e as cargas nodais equivalentes estão no [contrato do motor](OOFEM.md#laje-retangular-isolada).

A referência independente é a série de Navier para uma placa elástica isotrópica delgada. Com a e b como lados, usa-se D = Eh³/[12(1−ν²)], α = mπ/a e β = nπ/b. Para m e n ímpares, a amplitude de UZ é 16 pZ/[π²mn D(α² + β²)²]. As amplitudes de Mx e My na convenção sagente positiva são obtidas multiplicando a de UZ por −D(α² + νβ²) e −D(β² + να²), respectivamente. No centro, os senos alternam entre +1 e −1. A [implementação da série](../tests/fixtures/slab-benchmark.ts) soma os índices ímpares até 201. A referência e o DKT desprezam o cisalhamento transversal.

O parser lê UZ diretamente no nó central nas três malhas de referência. Nos mapas, Mx e My são a média dos três pontos de Gauss de cada triângulo. Para a consulta central, os momentos são extrapolados linearmente para os vértices e promediados entre os triângulos adjacentes. Com subdivisões ímpares, a consulta interpola no segmento que passa pelo centro.

Valores medidos com OOFEM 3.0 no commit `214b161ed3acb471f2d0104b004c37fd73bafaa2`. UZ é negativo para baixo. Momentos positivos tracionam a face inferior na direção indicada pelos eixos X e Y do painel.

| Subdivisões X × Y | Triângulos | ΣRZ (kN) | UZ (mm) | Mx (kN·m/m) | My (kN·m/m) | Erro UZ / Mx / My |
| ----------------- | ---------- | -------- | ------- | ----------- | ----------- | ----------------- |
| 8 × 6             | 96         | 59,99980 | −1,013955 | 2,06697    | 3,16185     | 1,65% / 4,07% / 2,83% |
| 16 × 12           | 384        | 60,00012 | −1,026874 | 2,00657    | 3,09703     | 0,39% / 1,03% / 0,73% |
| 32 × 24           | 1.536      | 59,99996 | −1,029932 | 1,99130    | 3,08040     | 0,10% / 0,26% / 0,18% |
| Navier            | —          | 60,00000 | −1,030920 | 1,98613    | 3,07472     | — |

O teste exige erro decrescente em todas as grandezas centrais, erro relativo inferior a 0,5% na malha final e diferença inferior a 1 N na soma das reações verticais em cada malha. A tolerância de 0,5% cobre o erro de discretização e recuperação de momentos na malha fina. A de 1 N acomoda a precisão textual do OOFEM para as reações. Uma segunda regressão verifica apoios opostos, pressão ascendente obtida por fatores de carga e a solução de faixa para ν = 0. Uma análise incompleta ou em desequilíbrio é rejeitada.

O Playwright lança a laje na cota do pavimento, edita as bordas e a pressão, salva, reabre e compara a entrada exportada com a do modelo persistido. Com o motor disponível, substitui apenas a fronteira IPC e resolve a entrada que a própria interface envia ao OOFEM. Confere os três mapas, a tabela central, o refinamento e a invalidação por edição, desfazer, refazer e conclusão de uma análise iniciada em revisão anterior.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm run check
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- slab.spec.ts
```

## Ainda não validado nesta etapa

Flambagem/P–Δ, massas/modal, cascas, ligação entre lajes e barras, liberações, offsets, molas acopladas, dimensionamento e desempenho em grandes modelos.
