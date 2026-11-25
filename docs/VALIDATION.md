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

Persistência sem perda, rejeição de versões desconhecidas e referências quebradas, remoção de cargas dependentes, desfazer/refazer, identidade de nós no snap, componentes sem restrições suficientes, Y não nulo, nós isolados no interior das barras, mapeamento determinístico e saída truncada.

A soma global de forças e momentos é conferida com tolerância relativa de 0,1% à soma dos módulos das contribuições (mais escala unitária). A saída textual do OOFEM usa precisão menor para esforços que para deslocamentos. Equilíbrio é uma verificação complementar e não substitui benchmarks de rigidez nem análise de convergência.

Uma saída real capturada também testa renderização e descarte de resultados obsoletos substituindo somente a fronteira IPC. O job numérico executa adicionalmente o runner Rust com o OOFEM real.

Os testes de interface cobrem desenho a partir de um projeto vazio, edição de carga, histórico, salvar/abrir, erro de solver no navegador e exportação da entrada. A CI verifica o layout mínimo de 1100 × 720 e produz uma captura em `test-results/kstruct-workspace.png`.

Na CI, Playwright usa o Chrome disponibilizado pelo runner Ubuntu e registra sua versão no log. Localmente, utiliza o Chromium instalado pelo próprio Playwright. A renderização 3D dos testes usa SwiftShader.

## Distribuição e regressão em pórtico

O pórtico XZ de dois pavimentos tem pilares com propriedades diferentes, dois carregamentos uniformes e forças e momento nodais. A [referência independente](../tests/fixtures/portal-reference.py) monta a matriz de rigidez por barras de Euler–Bernoulli com Python e NumPy. A integração compara as reações nas bases, translações e rotações de cobertura e momentos de extremidade da viga superior.

O [workflow de pacotes](https://github.com/ricardocorsini/k-struct/actions/workflows/desktop-packages.yml) repete os benchmarks com o executável produzido em cada plataforma. Ele instala o NSIS e o .deb e testa o AppImage extraído. Cada pacote é submetido ao autoteste nativo sem OOFEM no PATH e com acesso externo desabilitado para a execução de teste. O relatório registra as reações e a flecha da viga, e o workflow confere os hashes do executável e do arquivo-fonte instalado.

Os testes do runner exercitam cancelamento, tempo limite e persistência de registros. O Playwright verifica as ações de cancelar, recuperar o histórico e consultar o diagnóstico usando a fronteira IPC simulada, enquanto os testes dos pacotes executam o OOFEM real.

## Diagnóstico de duplicidades

A varredura compara a distância euclidiana em XYZ com a tolerância informada em metros. A união só é válida quando cada par do conjunto está dentro da tolerância e todos os IDs removidos apontam diretamente ao sobrevivente. A suíte confere cotas distintas, cadeias de vizinhos, barras invertidas, barras nulas criadas pela união, sobreposições parciais e transferências por padrão e grupo.

No teste com OOFEM 3.0, o modelo de entrada contém duas barras de sentidos opostos entre os mesmos apoios e uma carga de −10 kN/m em cada barra. O diagnóstico conserva a barra invertida. Ao escolher a carga de uma origem, a reação é de 30 kN por apoio. Ao escolher a soma, passa a 60 kN. O Playwright verifica o destaque no modelo, conflitos de cargas e apoios, cancelamento, desfazer e nova varredura.

## Divisão e união de uma viga carregada

O benchmark resolve a viga biapoiada de 6 m, divide a barra a 2 m do nó inicial e volta a uni-la com a seleção invertida. Os trechos de 2 e 4 m mantêm −10 kN/m em Z, correspondentes a −20 e −40 kN. O OOFEM 3.0 é executado nas três geometrias. O teste compara as reações de 30 kN em cada apoio e, na mesma abscissa global de 3 m, o momento de 45 kN·m e a flecha de −8,4375 mm.

Um caso de edição separado usa a ponta j livre, para poder aparar até X = 4 m e prolongar até X = 6 m. O teste de interface verifica as resultantes de −40 kN e −60 kN e reabre o modelo salvo entre as operações.

## Reflexão de uma viga espacial

O teste de integração monta dois balanços independentes de 2 m no mesmo projeto. O inicial parte de (2, 1, 0) na direção +X e tem seção de 14 × 32 cm girada em 27°. A cópia é produzida pelo comando de espelho no plano YZ, incluindo engaste, carga distribuída, força e momento de ponta. O teste verifica por equilíbrio as reações na raiz do balanço inicial. No referencial global elas são (−1360, −540, 3500) N e (−150, −6170, −1250) N·m.

Se $Q$ representa a reflexão, forças, translações e cargas lineares acompanham $Q$. Momentos e rotações acompanham $-Q$. A barra conserva a ordem início–fim e a direção física do eixo local $z$ da seção. O eixo local $y$ resulta do produto $z \times x$. O teste com o OOFEM 3.0 confere os seis deslocamentos de ponta, as seis reações e os seis esforços em cada estação. Nas bases locais do original e da cópia, os fatores de sinal de $(N,V_y,V_z,M_x,M_y,M_z)$ são $(+1,-1,+1,-1,+1,-1)$.

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

## Placa retangular simplesmente apoiada

O caso usa uma placa isolada no plano XY, de 4,00 m em X por 3,00 m em Y, com 0,10 m de espessura. O material elástico isotrópico `IsoLE` tem E = 30 GPa e ν = 0,20. A seção `SimpleCS` fornece a espessura. A pressão de −5.000 N/m² em Z resulta em −60.000 N. O caso tem um passo de `StaticStructural`, com a pressão constante durante o passo. A densidade de 2.500 kg/m³ consta no material e o caso só aplica a pressão.

### Elemento, malha e apoios

O elemento `qdktplate` é o quadrilátero de quatro nós da teoria discreta de Kirchhoff (QDKT). A relação entre o vão menor e a espessura é 30, adequada ao caso de placa delgada. A formulação elimina a deformação por cisalhamento transversal, como a solução de Kirchhoff–Love usada na referência. O domínio `2dMindlinPlate` declara os três graus de liberdade por nó. A formulação de flexão vem do registro `qdktplate` e usa quatro pontos de Gauss. [Manual da tag v3.0](https://github.com/oofem/oofem/blob/v3.0/doc/elementlibmanual/elementlibmanual.tex#L842) · [Registro e implementação do QDKT](https://github.com/oofem/oofem/blob/v3.0/src/sm/Elements/Plates/qdkt.C#L56)

Cada célula retangular da grade é um elemento. O gerador numera nós e elementos em linhas, primeiro em X e depois em Y. Em cada célula, os vértices são nordeste, noroeste, sudoeste e sudeste, em sentido anti-horário visto de +Z. Suas coordenadas naturais são `(+1,+1)`, `(-1,+1)`, `(-1,-1)` e `(+1,-1)`. `ConstantSurfaceLoad` usa eixos globais (`csType 0`) e `dofs 3 3 4 5 components 3 -5000 0 0`. O conjunto `elementboundaries` contém o par `(ID do elemento, face 1)` para cada célula, de modo que a carga seja integrada sobre toda a área. [Gerador da entrada](../tests/fixtures/plate-benchmark.ts)

| Borda           | Graus de liberdade prescritos | Rotação livre |
| --------------- | ----------------------------- | ------------- |
| X = 0 e X = 4 m | Uz = 0 (GL 3), Rx = 0 (GL 4)  | Ry (GL 5)     |
| Y = 0 e Y = 3 m | Uz = 0 (GL 3), Ry = 0 (GL 5)  | Rx (GL 4)     |

Nos quatro cantos, os três graus de liberdade são prescritos. A referência impõe `w = 0` e momento normal à borda `Mnn = 0`. Na cinemática de Kirchhoff, `Rx = ∂w/∂y` e `Ry = −∂w/∂x`. A rotação prescrita em cada borda corresponde à derivada tangencial, que se anula onde `w = 0`. A rotação livre deixa a inclinação normal variar, permitindo a condição natural de momento normal nulo. Os apoios são bilaterais e as reações são somadas com sinal.

### Referência independente e recuperação

O cálculo de Navier resolve `D ∇⁴w = pz`, com `D = Eh³/[12(1 − ν²)]`. Para `a = 4 m`, `b = 3 m`, `α = mπ/a` e `β = nπ/b`, expande a pressão uniforme em senos com coeficientes `16 pz/(π²mn)` para índices ímpares. Cada coeficiente de pressão é dividido por `D(α² + β²)²` para obter a amplitude de deslocamento. As derivadas `wxx = ∂²w/∂x²` e `wyy = ∂²w/∂y²` dão `Mx = D(wxx + νwyy)` e `My = D(wyy + νwxx)`. A soma usa 256 termos ímpares em cada direção. Ao dobrar de 128 para 256, a flecha muda em menos de 4 × 10⁻¹² mm e cada momento em menos de 3,0 × 10⁻⁷ kN·m/m. [Cálculo de referência](../tests/fixtures/plate-navier.ts) · [Referência sobre a solução de Navier](https://doi.org/10.1155/2017/6516471)

O ponto de consulta é sempre o nó em (2,00 m, 1,50 m, 0), comum aos quatro elementos adjacentes. A flecha vem da linha `dof 3 d` do nó, em metros, com Z positivo para cima. O equilíbrio usa as linhas `Node … iDof 3 reaction` dos nós das bordas, em newtons.

Para a issue #10, associe cada bloco `element <rótulo> (<número interno>)` ao ID da célula usando o rótulo. Em cada linha `stresses` dos pontos `GP 1.1` a `GP 1.4`, leia as colunas 4 e 5, contando a partir do primeiro número. Elas contêm os momentos de flexão por unidade de largura, em N·m/m, nas seções de normais X e Y. Inverta os sinais de ambas as colunas para obter Mx e My positivos em flexão sagente. Os pontos naturais, na ordem da saída, são `(-g,-g)`, `(-g,+g)`, `(+g,-g)` e `(+g,+g)`, com `g = 1/√3`. Para recuperar os momentos no nó central, extrapole bilinearmente os quatro valores de cada célula até seu vértice central `(ξ, η)` e faça a média das quatro estimativas. Para cada ponto de sinais `(sx, sy)`, o peso da extrapolação é `(1 + sx ξ/g)(1 + sy η/g)/4`. [Ordem dos pontos e quadratura](https://github.com/oofem/oofem/blob/v3.0/src/core/gaussintegrationrule.C#L102)

### Resultados e reprodução

Resultados do OOFEM 3.0 no commit `214b161ed3acb471f2d0104b004c37fd73bafaa2`. Os erros são relativos absolutos à referência de Navier.

| Malha X × Y | Elementos | Σ Rz (kN) |     Uz (mm) | Mx (kN·m/m) | My (kN·m/m) | Erro Uz (%) | Erro Mx (%) | Erro My (%) |
| ----------- | --------: | --------: | ----------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 8 × 6       |        48 |  60,00020 | −1,02668720 |    1,997732 |    3,127024 |      0,4106 |      0,5840 |      1,7010 |
| 16 × 12     |       192 |  60,00000 | −1,02991662 |    1,989041 |    3,087367 |      0,0974 |      0,1464 |      0,4112 |
| 32 × 24     |       768 |  60,00014 | −1,03067275 |    1,986897 |    3,077772 |      0,0240 |      0,0385 |      0,0991 |
| Navier      |         — |         — | −1,03092043 |    1,986133 |    3,074724 |           — |           — |           — |

A regressão admite um resíduo de equilíbrio menor que 3 N (0,005% da carga total). A soma de meia unidade na última casa de cada reação impressa chega a 2,44 N entre as três malhas. Para as grandezas centrais, o erro deve cair pelo menos pela metade a cada refinamento. Os erros medidos caem por fatores próximos a quatro. Na malha final, os limites são 0,05% para Uz, 0,10% para Mx e 0,20% para My. Esses limites têm margem sobre o erro de discretização medido e são superiores aos erros de truncamento da série e de arredondamento da saída. [Teste de regressão](../tests/plate.integration.test.ts)

Use o executável fixado pelo KStruct. No Linux, depois de `npm ci` e `npm run oofem:stage`, o teste focado resolve as três malhas e imprime os resultados e os erros. [Configuração do OOFEM](OOFEM.md)

```sh
OOFEM_BIN="$PWD/.oofem-dist/build/bin/oofem" npm test -- tests/plate.integration.test.ts
```

No Windows, use o caminho absoluto do `oofem.exe` em `OOFEM_BIN`. A regressão integra `npm run check` e é explicitamente ignorada se `OOFEM_BIN` estiver ausente.

A regressão também lança o painel QDKT pelo modelo do editor, em posição deslocada da origem, e compara a entrada e o parser de produção com os resultados do gerador independente nas três malhas. A comparação cobre a soma de reações e os valores centrais de UZ, Mx e My.

## Laje retangular isolada

Selecione **Triangular DKT** para repetir os resultados desta seção. **Quadrilateral QDKT** é a formulação inicial do editor e reproduz a tabela da seção anterior.

O caso da [issue #9](https://github.com/ricardocorsini/k-struct/issues/9) usa uma placa de 4 × 3 m, espessura de 0,10 m, E = 30 GPa, ν = 0,20 e pZ = −5 kN/m². A resultante aplicada é −60 kN. A malha DKT usa dois triângulos de Kirchhoff (DKT) por célula retangular. O apoio simples impõe UZ e a rotação correspondente à inclinação tangencial de cada borda. No interior das bordas, a rotação em torno da própria borda fica livre. Essa condição aproxima as bordas com flecha nula e momento normal nulo da referência. As propriedades do elemento e as cargas nodais equivalentes estão no [contrato do motor](OOFEM.md#laje-retangular-isolada).

A referência independente é a série de Navier para uma placa elástica isotrópica delgada. Com a e b como lados, usa-se D = Eh³/[12(1−ν²)], α = mπ/a e β = nπ/b. Para m e n ímpares, a amplitude de UZ é 16 pZ/[π²mn D(α² + β²)²]. As amplitudes de Mx e My na convenção sagente positiva são obtidas multiplicando a de UZ por −D(α² + νβ²) e −D(β² + να²), respectivamente. No centro, os senos alternam entre +1 e −1. A [implementação da série](../tests/fixtures/slab-benchmark.ts) soma os índices ímpares até 201. A referência e o DKT desprezam o cisalhamento transversal.

O parser lê UZ diretamente no nó central nas três malhas de referência. Nos mapas, Mx e My são a média dos três pontos de Gauss de cada triângulo. Para a consulta central, os momentos são extrapolados linearmente para os vértices e promediados entre os triângulos adjacentes. No ponto de Gauss mais próximo de um vértice, os pesos baricêntricos são 2/3, 1/6 e 1/6. A inversão é `M_vértice = 2 M_GP − M_médio`. Um teste com campos afins de Mx e My confere cada vértice, inclusive os de borda. Com subdivisões ímpares, a consulta interpola no segmento que passa pelo centro.

Valores medidos com OOFEM 3.0 no commit `214b161ed3acb471f2d0104b004c37fd73bafaa2`. UZ é negativo para baixo. Momentos positivos tracionam a face inferior na direção indicada pelos eixos X e Y do painel.

| Subdivisões X × Y | Triângulos | ΣRZ (kN) | UZ (mm) | Mx (kN·m/m) | My (kN·m/m) | Erro UZ / Mx / My |
| ----------------- | ---------- | -------- | ------- | ----------- | ----------- | ----------------- |
| 8 × 6             | 96         | 59,99980 | −1,013955 | 2,02504    | 3,10462     | 1,65% / 1,96% / 0,97% |
| 16 × 12           | 384        | 60,00012 | −1,026874 | 1,99603    | 3,08276     | 0,39% / 0,50% / 0,26% |
| 32 × 24           | 1.536      | 59,99996 | −1,029932 | 1,98866    | 3,07682     | 0,10% / 0,13% / 0,07% |
| Navier            | —          | 60,00000 | −1,030920 | 1,98613    | 3,07472     | — |

O teste exige erro decrescente em todas as grandezas centrais, erro relativo inferior a 0,5% na malha final e diferença inferior a 1 N na soma das reações verticais em cada malha. A tolerância de 0,5% cobre o erro de discretização e recuperação de momentos na malha fina. A de 1 N acomoda a precisão textual do OOFEM para as reações. Uma segunda regressão verifica apoios opostos, pressão ascendente obtida por fatores de carga e a solução de faixa para ν = 0. Uma análise incompleta ou em desequilíbrio é rejeitada.

O Playwright lança a laje na cota do pavimento, edita as bordas e a pressão, salva, reabre e compara a entrada exportada com a do modelo persistido. Com o motor disponível, substitui apenas a fronteira IPC e resolve a entrada que a própria interface envia ao OOFEM. Confere os três mapas, a tabela central, o refinamento e a invalidação por edição, desfazer, refazer e conclusão de uma análise iniciada em revisão anterior.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm run check
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- slab.spec.ts
```

## Conexões internas em barras físicas (KS-15)

Execute `OOFEM_BIN=/caminho/para/oofem npm run check` com o OOFEM 3.0 fixado no projeto. Os ensaios estão em `tests/oofem.integration.test.ts`. O arquivo `tests/fixtures/internal-joint-oofem.txt` contém a saída do solver distribuído para a viga com oito subdivisões regulares. O teste do parser usa essa saída também nos ambientes sem binário.

| Modelo                                                                                            | Referência independente                                                                                                                                                                                                   | Comparação                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uma barra XZ de 6 m, nós A e B nas extremidades, C a 2 m de A, carga de −9 kN em C                | Equilíbrio fornece RAz = 6 kN e RBz = 3 kN. O momento sagente em C vale 12 kN·m. Para a dimensão a = 2 m, b = 4 m, a flecha em C vale −P a² b²/(3 EI L).                                                                  | Refinamentos 8, 6 e 13. No padrão, a conexão acrescenta a nona célula. Cortante de +6 kN no lado i e −3 kN no lado j. Tolerâncias absolutas de 0,05 N, 0,05 N·m e 5 × 10⁻¹⁰ m.                                                                     |
| Mesma barra com ambas as pontas livres, engaste em C e qZ = −1 kN/m nos 6 m                       | Os balanços medem 2 e 4 m. RZ = 6 kN, MY = −6 kN·m, momentos na barra de −2 e −8 kN·m nos lados i e j.                                                                                                                    | O engaste interno estabiliza o componente. Os esforços preservam o salto devido à reação concentrada.                                                                                                                                              |
| Banzo espacial de 6 m, engastado na origem, seção girada 23°, montante vertical de 2 m em x = 2 m | Referência construída com duas barras físicas de 2 e 4 m e o mesmo montante. A carga de ponta (1,1; 1,7; −9) kN e qZ = −0,65 kN/m no banzo exigem reação global (−1,1; −1,7; 12,9) kN e momentos (3,4; −31,9; −3,4) kN·m. | Refinamentos 5, 8 e 12 contra a referência com 8 por peça. Conferem-se os seis deslocamentos generalizados dos nós, as seis reações e os seis esforços nas extremidades e em cada lado do encontro. Tolerâncias de 5 × 10⁻⁹ m ou rad e 1 N ou N·m. |

O teste de interface `tests/e2e/mesh-connections.spec.ts` conecta C, inspeciona a camada de malha, desfaz e refaz, refina, salva e reabre o projeto. Na envoltória dos fatores +1 e −1, o máximo de V em x/L = 1/3 é governado pela combinação direta do lado i e pela invertida do lado j. O teste confere a tabela e o CSV pelo ID do membro, pela posição, pelo lado e pela combinação.

## Materiais compartilhados e independentes (KS-17)

Dois balanços XZ independentes de 3 m têm seções de 20 × 30 cm e carga de ponta de −10,5 kN. As duas seções começam vinculadas ao mesmo aço, com E = 210 GPa, ν = 0,30, ρ = 7.850 kg/m³ e α = 0,000012/K. A referência de Euler–Bernoulli fornece $I_y=bh^3/12=0{,}00045\,\mathrm{m}^4$ e $u_z=-PL^3/(3EI_y)$, com $P$ em módulo.

| Configuração | Flecha na ponta A | Flecha na ponta B |
| --- | ---: | ---: |
| Duas seções com E = 210 GPa | −1,000 mm | −1,000 mm |
| Cópia com E = 420 GPa atribuída apenas à seção B | −1,000 mm | −0,500 mm |

Em ambas as configurações cada engaste deve fornecer +10,5 kN em Z e −31,5 kN·m em Y. O teste verifica os IDs de material nos registros `SimpleCS`, as propriedades em `IsoLE`, as flechas com tolerância absoluta de 5 × 10⁻¹¹ m e as reações com 0,05 N ou N·m. Outro ensaio abre a viga biapoiada no formato v8 e confere α = 0, a flecha de −8,4375 mm e o momento de +45 kN·m no meio do vão.

Execute `OOFEM_BIN=/caminho/absoluto/oofem npm run check`. O fluxo de interface em `tests/e2e/materials.spec.ts` verifica edição compartilhada, cópia, reatribuição, desfazer/refazer e reabertura do arquivo. Com `OOFEM_BIN` configurado, resolve também a entrada exportada pela interface.

## Ainda não validado nesta etapa

Flambagem/P–Δ, massas/modal, cascas, ligação entre lajes e barras, liberações, offsets, molas acopladas, dimensionamento e desempenho em grandes modelos.

## KS-18 · seções de barras e balanço espacial

O catálogo recebe dimensões em cm e o domínio trabalha em metros. A largura acompanha y local, a altura acompanha z local e x vai de i para j. A rotação positiva segue a regra da mão direita em torno de x. A tabela usa mm para permitir a conferência direta com as dimensões de referência.

| Forma e dimensões (mm) | A (mm²) | Iy (mm⁴) | Iz (mm⁴) | J (mm⁴) |
| --- | ---: | ---: | ---: | ---: |
| Círculo, d = 100 | 7 853,982 | 4 908 738,521 | 4 908 738,521 | 9 817 477,042 |
| Tubo, D = 100, t = 10, di = 80 | 2 827,433 | 2 898 119,223 | 2 898 119,223 | 5 796 238,446 |
| I, h = 200, b = 100, tf = 10, tw = 6 | 3 080,000 | 20 982 666,667 | 1 669 906,667 | 80 346,667 |

No círculo maciço, A = πd²/4, Iy = Iz = πd⁴/64 e J = πd⁴/32. No anel, a referência subtrai o círculo interno do externo. A parede deve satisfazer 0 < t < D/2. O retângulo conserva os 60 termos ímpares da série de Saint-Venant usada nas versões anteriores.

O I tem duas mesas iguais, alma centrada e cantos vivos. Com a altura livre hw = h − 2tf, a conferência independente usa o retângulo externo e os dois vazios para Iy, e três retângulos para Iz.

- A = 2b·tf + hw·tw.
- Iy = [b·h³ − (b − tw)·hw³]/12.
- Iz = [2tf·b³ + hw·tw³]/12.
- Para torção uniforme de Saint-Venant em chapas finas, J ≈ [2b·tf³ + (h − tf)·tw³]/3. A altura h − tf vai do centro de uma mesa ao centro da outra. Raios de concordância, cordões de solda e rigidez de empenamento restringido ficam fora do modelo. Iy + Iz é o momento polar geométrico. O exemplo publicado W610×125 (612 × 229 × 19,6 × 11,9 mm) resulta em 1,4823 × 10⁶ mm⁴, compatível com os 1,48 × 10⁶ mm⁴ da fonte. [CISC, *Torsional Section Properties of Steel Shapes*, p. 6, equações 6 e 8](https://www.labciv.eng.uerj.br/pgeciv/files/Torsion%20Properties.pdf)

O KStruct limita a aproximação de J a b/tf ≥ 10 e hw/tw ≥ 10 e exige tw < b. Esses limites são um critério de aplicação adotado pelo projeto. O formulário identifica a dimensão a corrigir e impede salvar. O esquema do arquivo também verifica esses limites.

**Balanço espacial.** Uma barra de 2 m em +X tem os seis graus de liberdade impedidos em i. Em j atuam Fy = +300 N, Fz = −900 N e Mx = +15 N·m. O material tem E = 210 GPa, ν = 0,30 e G = E/[2(1 + ν)]. Com rotação da seção igual a zero, a referência de Euler–Bernoulli fornece uy = Fy·L³/(3E·Iz), uz = Fz·L³/(3E·Iy) e rx = Mx·L/(GJ).

| Seção | uy (mm) | uz (mm) | rx (mrad) |
| --- | ---: | ---: | ---: |
| Circular | +0,776070 | −2,328209 | +0,0378334 |
| Tubular | +1,314481 | −3,943444 | +0,0640810 |
| I | +2,281279 | −0,544667 | +4,622825 |

O teste roda o OOFEM 3.0 com oito elementos Beam3d para cada seção, primeiro a 0° e depois a 90°. Um quarto de volta troca Iy e Iz nas duas referências de flexão. A tolerância relativa para cada deslocamento e rotação é 2 × 10⁻⁶. O balanço retangular da v9 passa pela migração antes de verificar a flexão biaxial, a força normal, a torção e as reações. Os testes estão em `tests/sections.test.ts` e `tests/oofem.integration.test.ts`.
