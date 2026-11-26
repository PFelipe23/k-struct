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

## Preferências de unidades (KS-05)

Os testes de `units.test.ts` verificam ida e volta de cada grandeza, leitura com ponto ou vírgula, preferências inválidas e preservação exata de entradas sem mudança. A viga de referência conserva 6 m ao apresentar 600 cm ou 6000 mm e 200 GPa ao apresentar 200000 MPa. A reação de 30000 N corresponde a 30 kN; a flecha de −0,0084375 m corresponde a −8,4375 mm.

`result-units.test.ts` verifica valores e cabeçalhos nas unidades selecionadas e hashes de regressão do CSV padrão de reações, deslocamentos, esforços e envelopes. IDs, estações e composição dos resultados permanecem rastreáveis. A cobertura inclui as reações globais e no referencial do apoio e os lados i/j nas conexões internas. Os testes usam a saída de referência do OOFEM, sem substituir o solver da aplicação.

Os cenários de navegador em `units.spec.ts` cobrem resultado válido durante trocas sucessivas, mesma geometria de deformada, modelo e entrada OOFEM idênticos, retorno ao CSV padrão, edição em centímetros, preferência após recarregar, cancelamento e histórico da tabela. Conferem também área e inércia em metros sem arredondá-las para zero. O cenário em `units-views-integration.spec.ts` confere os valores i/j em N e N·m e a geometria do diagrama ao trocar unidades. `template-units.spec.ts` compara entradas e prévias em cm/mm com a geometria SI gerada, inclusive vírgula decimal, tolerância e cancelamento. Quando `OOFEM_BIN` está definido, o cenário de resultados produz a saída da viga com o executável real antes de exercitar a fronteira IPC no navegador.

O benchmark numérico continua sendo executado separadamente com o OOFEM 3.0 fixado em `crates/solver-runner/oofem.json`. Esta contribuição não altera equações, convenções de sinais nem o esquema do projeto. A reabertura do aplicativo conserva o modelo e a preferência; os resultados continuam pertencendo à sessão de análise, conforme o contrato existente.

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

A varredura compara a distância euclidiana em XYZ com a tolerância convertida para metros. A união só é válida quando cada par do conjunto está dentro da tolerância e todos os IDs removidos apontam diretamente ao sobrevivente. A suíte confere cotas distintas, cadeias de vizinhos, barras invertidas, barras nulas criadas pela união, sobreposições parciais e transferências por padrão e grupo.

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

| Subdivisões X × Y | Triângulos | ΣRZ (kN) | UZ (mm)   | Mx (kN·m/m) | My (kN·m/m) | Erro UZ / Mx / My     |
| ----------------- | ---------- | -------- | --------- | ----------- | ----------- | --------------------- |
| 8 × 6             | 96         | 59,99980 | −1,013955 | 2,02504     | 3,10462     | 1,65% / 1,96% / 0,97% |
| 16 × 12           | 384        | 60,00012 | −1,026874 | 1,99603     | 3,08276     | 0,39% / 0,50% / 0,26% |
| 32 × 24           | 1.536      | 59,99996 | −1,029932 | 1,98866     | 3,07682     | 0,10% / 0,13% / 0,07% |
| Navier            | —          | 60,00000 | −1,030920 | 1,98613     | 3,07472     | —                     |

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

## KS-19 · inversão de i/j e rotação da seção

No pórtico espacial de referência, a diagonal B5 tem seção de 15 × 20 cm, ângulo de 27° e carga uniforme nas três direções globais. Resolva o mesmo caso antes e depois de inverter i/j. As seis reações e os seis deslocamentos generalizados globais devem coincidir. Para cada estação original, use `1 − x/L` e transforme a base e a face conforme a [convenção de sinais](ARCHITECTURE.md#unidades-e-sinais). A comparação usa 5 × 10⁻¹⁰ m ou rad para deslocamentos e 0,01 N ou N·m mais 6 × 10⁻⁵ do valor de referência para forças e momentos impressos.

Um balanço espacial horizontal de 6 m, com E = 200 GPa e a mesma seção, recebe Fy = +1,2 kN e Fz = −2,4 kN na ponta. Use $I_y = bh^3/12$, $I_z = hb^3/12$ e a referência de Euler–Bernoulli $u = P L^3/(3 E I)$. A rotação a 90° troca as inércias usadas em cada direção. Os deslocamentos conferem com tolerância de 5 × 10⁻⁹ m.

| Orientação da seção | UY na ponta | UZ na ponta |
| --- | ---: | ---: |
| 0° | +7,68 mm | −8,64 mm |
| 90° | +4,32 mm | −15,36 mm |

Depois de inverter i/j com a seção já a 90°, os deslocamentos continuam iguais aos da última linha. Ensaios adicionais conferem N = +1,8 kN nas duas orientações em XZ e XYZ e a troca dos lados de uma seção interna carregada.

Execute `OOFEM_BIN=/caminho/absoluto/oofem npm run check` para repetir os ensaios e `OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- member-axes.spec.ts` para conferir a exibição, a revisão dos resultados, o histórico e a reabertura.

## KS-20 · apoios inclinados

Na viga de 6 m em XZ, A restringe UX e UZ, B restringe apenas a translação ao longo de n = (0,6, 0, 0,8) e qZ = −10 kN/m. Use a tangente t = (0,8, 0, −0,6), com ângulo de −36,86989765° em relação a +X. Os momentos em A e as forças em Z dão RBz = RAz = 30 kN. Como RB = RN·n, resulta RN = 37,5 kN e RBx = +22,5 kN. Pelo equilíbrio em X, RAx = −22,5 kN. O rolete ideal tem RT = 0. A força axial de tração fornece UX em B de RBx·L/(EA) = +0,0225 mm e a compatibilidade n·uB = 0 fornece UZ = −0,016875 mm.

O ensaio com o OOFEM 3.0 aceita 0,005 N ou N·m nos valores da viga e 5 × 10⁻¹³ m na compatibilidade e nos deslocamentos da ponta. Confere o registro local de reação normal do solver e a transformação para a estação final da deformada. Com Fx = +3 kN, Fz = −4 kN e My = +1,2 kN·m adicionais em B, o equilíbrio fornece RAx = −28,65 kN, RAz = +29,8 kN, RBx = +25,65 kN e RBz = +34,2 kN. Esse ensaio confirma que a carga nodal permanece global.

Em XYZ, um balanço com UZ e RX restritos na ponta é resolvido antes e depois de girar a geometria, a seção, os apoios e as cargas. A rotação independente tem colunas (1,2,2)/3, (2,1,−2)/3 e (−2,2,−1)/3. O ensaio compara cada reação, cada estação de deslocamento e os esforços no referencial da barra. A tolerância é de 2 N ou N·m, compatível com a saída impressa, e 5 × 10⁻¹⁰ m ou rad nas translações e rotações. O ângulo zero no plano reproduz o caso legado. Direções paralelas insuficientes são rejeitadas antes de executar o solver.

A inversão i/j da barra também preserva as reações e o deslocamento global do rolete. Em dois balanços de 6 m (um horizontal e um vertical), a carga de −12.345 N em Z exige reação vertical de +12.345 N num engaste orientado a 31°. O OOFEM imprime cinco algarismos significativos por componente local. A verificação de equilíbrio propaga metade da última casa impressa de cada componente pelos eixos do apoio e pelo braço da força. Os ensaios verificam o equilíbrio em relação à ponta livre e a rejeição da saída quando uma reação local é alterada em 10 N.

Execute `OOFEM_BIN=/caminho/absoluto/oofem npm run check` para repetir os ensaios e `OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- inclined-supports.spec.ts` para verificar edição, desfazer/refazer, persistência, reanálise, tabela e CSV.

## KS-22 · treliça articulada e flexão local do banzo

As entradas abaixo são referências independentes do exportador do KStruct. Usam barras de pórtico do OOFEM 3.0. Em cada articulação, nós coincidentes compartilham as translações e permitem que cada barra gire independentemente. As cargas permanecem nos pontos ou trechos em que foram aplicadas. O módulo `errorcheck` compara as grandezas calculadas com os valores analíticos a cada passo.

### Dois carregamentos na mesma treliça plana

Em [pinned-truss.in](../tests/fixtures/pinned-truss.in), os nós A=(0, 0), B=(6, 0) e C=(3, 4) estão no plano XZ. A restringe UX e UZ, e B restringe UZ. Os três membros têm E = 200 GPa, A = 1.000 mm² e Iy = 2,5 × 10⁻⁵ m⁴. O banzo AB tem dois elementos contínuos no meio do vão. A articulação fica nas pontas físicas.

| Carregamento | Reações verticais em A e B | Esforços e deslocamentos de referência |
| --- | --- | --- |
| Força de 10 kN para baixo em C | 5 kN em cada apoio | Tração de 3,75 kN em AB e compressão de 6,25 kN em AC e BC. Cortantes e momentos nulos. UZ de C = −0,2375 mm. |
| Carga uniforme de 10 kN/m para baixo ao longo de AB | 30 kN em cada apoio | Momento nulo nas pontas e sagente de 45 kN·m no meio do vão. Cortante de +30 kN junto a A e −30 kN junto a B na convenção de seção do KStruct. Flecha central de −33,75 mm. |

No primeiro caso, as diagonais medem 5 m e a componente vertical da força em cada uma vale 4/5 do seu módulo. O deslocamento segue do trabalho virtual, somando as contribuições axiais das três barras. No segundo, para o módulo da carga uniforme q, o momento central vale qL²/8 e a flecha central em módulo vale 5qL⁴/(384EIy). As tolerâncias absolutas são 10⁻⁷ N ou N·m nos esforços, 10⁻¹⁰ m no deslocamento de C e 10⁻⁹ m na flecha de AB.

### Barra articulada ligada a um pórtico espacial

Em [pinned-brace-3d.in](../tests/fixtures/pinned-brace-3d.in), AB é um balanço de 3 m na direção X. BC mede 2 m na direção Y, tem extremidades articuladas à flexão e sua torção é liberada em B. O nó B recebe Fy = 10 kN, Fz = −6 kN, Mx = 0,9 kN·m e Mz = 6 kN·m. A rotação de B pertence ao balanço e a barra BC acompanha a translação desse nó.

Para obter UY de B, use k = EA/L de BC, f = L³/(3EIz) e g = L²/(2EIz) de AB. A compatibilidade dá UY = (f·Fy + g·Mz)/(1 + k·f) = 0,1277293 mm. BC recebe 12,772926 kN de compressão e seus momentos de extremidade são nulos. Em B, o balanço apresenta UZ = −2,7 mm, RX = 0,351 mrad, RY = 1,35 mrad e RZ = 0,3451146 mrad. As tolerâncias são 10⁻⁵ N ou N·m e 10⁻¹⁰ m ou rad.

Execute o teste abaixo com o solver fixado pelo projeto para repetir os três casos.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test -- tests/pinned-truss.integration.test.ts
```


## KS-23 · excentricidades de inserção e trechos rígidos

Os ensaios usam o OOFEM 3.0 fixado pelo projeto. As coordenadas dos nós e as excentricidades estão em metros. Nos ensaios axiais, o balanço tem 6 m, E = 200 GPa e A = 0,03 m².

| Ensaio | Valor de referência |
| --- | --- |
| Balanço XYZ ao longo de X, nó de aplicação 0,20 m em +Y em relação à seção da ponta, Fz = −10 kN | Mx da seção = −2 kN·m. No engaste, Rz = +10 kN, Mx = +2 kN·m e My = −60 kN·m. Trocar o lado do braço inverte Mx. |
| Barra XZ e XYZ com P = 60 kN | Alongamento de 0,060 mm na barra centrada e 0,050 mm com 0,50 m rígido em cada ponta. Neste último caso, PL/(EA) usa 5 m. |
| Carga qz = −10 kN/m com eixo 0,20 m em +Y e trechos rígidos de 0,50 e 1,00 m | No engaste, Rz = +60 kN, Mx = +12 kN·m e My = −180 kN·m. Os momentos fletores em módulo nas faces i e j são 151,25 e 5 kN·m. |
| Dois apoios verticais a 0,50 m um do outro, na mesma zona rígida inicial de 1 m, com Fz = −1 kN no nó a 6 m | Reações verticais de −11 e +12 kN. A flecha na ponta é −2,083333 mm para Iy = 0,0001 m⁴. |

O ensaio de torção compara o nó excêntrico com uma força e um binário aplicados diretamente no eixo. A excentricidade de inserção no nó da ponta vale −0,20 m em Y quando o braço da seção até a carga vale +0,20 m. A comparação é repetida com i/j invertidos e com 2 e 9 elementos. A verificação axial compara 2 e 11 elementos. Os limites absolutos são 0,01 N·m na torção e 10⁻¹² m no alongamento. Os testes adicionais cobrem apoio inclinado, equilíbrio das cargas distribuídas, divisão da barra, conexões dentro do trecho rígido, na face e no trecho deformável.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test -- tests/member-offsets.test.ts tests/member-offsets.integration.test.ts
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- member-offsets.spec.ts
```

## KS-24 · modificadores de rigidez

O modelo espacial tem dois balanços de 3 m ao longo de X, cada um com a mesma seção retangular de 0,15 × 0,20 m. O aço tem E = 200 GPa, ν = 0,30 e massa específica de 7.850 kg/m³. Em cada ponta livre atuam Fx = 1.200 N, Fy = 300 N, Fz = −900 N e Mx = 15 N·m. Os valores abaixo usam A = 0,03 m², Iy = 0,0001 m⁴, Iz = 0,00005625 m⁴ e J = 0,000121808661794 m⁴.

| Fator aplicado ao primeiro balanço | Referência | Fator 1 | Fator 0,5 |
| --- | --- | --- | --- |
| EA | UX = Fx·L/(EA) | +0,0006 mm | +0,0012 mm |
| EIy | UZ = Fz·L³/(3EIy) | −0,405 mm | −0,810 mm |
| EIz | UY = Fy·L³/(3EIz) | +0,240 mm | +0,480 mm |
| GJ | RX = Mx·L/(GJ) | +0,00480261413 mrad | +0,00960522826 mrad |

Aplique um fator por vez. A tolerância absoluta é de 5 × 10⁻¹² m ou rad para as quatro respostas. As três outras componentes do primeiro balanço, as respostas do segundo e as reações dos engastes conservam os valores de referência. Cada barra tem massa geométrica de 706,5 kg, calculada por ρAL com a área e a massa específica exportadas. Um ensaio XZ com balanço de 6 m e Fz = −600 N compara −2,16 mm para EIy bruto e −4,32 mm para fator 0,5, com tolerância de 5 × 10⁻¹¹ m. A exportação com todos os fatores iguais a 1 coincide com a de um projeto migrado da versão 12.

Um ensaio adicional gira as duas seções em 90° e aplica à primeira barra os fatores 2 em EA, 0,5 em EIy, 1,5 em EIz e 0,25 em GJ. Uma execução usa a carga distribuída de peso próprio de −2.310,255 N/m. A outra mantém as cargas nodais e substitui a carga distribuída por gravidade nativa do OOFEM (`DeadWeight`, −9,81 m/s²), que usa a área e a densidade exportadas. O peso próprio de cada barra é 6.930,765 N. Com a força de ponta, cada engaste recebe Rz = +7.830,765 N e My = −13.096,1475 N·m. As tolerâncias de leitura são 0,05 N e 0,5 N·m. No balanço modificado, UY = +0,270 mm e UZ = −1,866153 mm. Na barra de controle, UY = +0,135 mm e UZ = −2,7992295 mm. As translações e a torção são conferidas com as expressões analíticas nas duas execuções.

Na viga contínua A–B–C, ambos os vãos medem 4 m e apenas AB recebe 12 kN/m para baixo. Pela equação dos três momentos, para `f = EI_AB / EI_BC`, o momento em B é −qL²/[8(1 + f)]. Reduzir EIy de AB de 1 para 0,5 muda o momento em B de −12 para −16 kN·m. As reações verticais em A/B/C passam de +21/+30/−3 kN para +20/+32/−4 kN. Os dois lados do apoio e as três reações são conferidos com tolerância de 0,001 N·m ou N.

Os ensaios usam o OOFEM 3.0 fixado pelo KStruct. A entrada espacial usa elementos `Beam3d` com registros `SimpleCS` e `IsoLE`. Os testes de interface verificam os controles ativos em XZ e XYZ, a rejeição do zero, a invalidação dos resultados, o histórico e o salvamento e reabertura do projeto.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test -- tests/member-stiffness.test.ts tests/member-stiffness.integration.test.ts
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- member-stiffness.spec.ts
```

## KS-25 · molas nodais

Os ensaios usam a distribuição fixada do OOFEM 3.0. A viga de referência mede 6 m e tem seção retangular de 15 × 20 cm e E = 200 GPa. A ligação A restringe UX e UZ. O nó no meio se conecta à mesma barra física para receber uma força de 20 kN para baixo. B tem rotação livre e uma mola vertical. Pelo equilíbrio, cada apoio recebe +10 kN. A reação da mola na estrutura é R = −k·u. A variação na flecha do meio devido ao recalque de B é metade do deslocamento do apoio.

| Rigidez de B | UZ de B | Flecha adicional no meio em relação à viga com B rígido |
| --- | --- | --- |
| 10.000 kN/m | −1 mm | −0,5 mm |
| 100.000 kN/m | −0,1 mm | −0,05 mm |
| 1.000.000 kN/m | −0,01 mm | −0,005 mm |

As tolerâncias absolutas no ensaio plano são 5 × 10⁻⁵ N nas reações, 5 × 10⁻¹² m em B e 5 × 10⁻¹¹ m para a flecha adicional. Zerar a única mola vertical de B produz o diagnóstico de apoio insuficiente para impedir movimento de corpo rígido.

| Ensaio adicional | Valores de referência |
| --- | --- |
| Momento de −15 kN·m na ponta B, com A fixo em UX e UZ e mola de 5.000 kN·m/rad em RY | RY de A = −3 mrad e momento de reação +15 kN·m. |
| Viga espacial com a base dos apoios inclinada em 30° em torno de X e carga girada com a normal | B conserva UZ local = −1 mm e energia elástica de 5 J. Reação local de +10 kN, com componentes globais Ry = −5 kN e Rz = +8,660254 kN. |
| Momento de +15 kN·m em torno de um eixo local x a 30° de X no plano XY, com mola de 5.000 kN·m/rad | Rotação local de +3 mrad e momento de reação local de −15 kN·m. |
| Mola vertical de 10.000 kN/m a 0,5 m de A, dentro do primeiro metro rígido, com −1 kN em B | Reações verticais de −11 kN em A e +12 kN na mola, com deslocamento de −1,2 mm no nó elástico. |

Nos casos acima, a tolerância é 5 × 10⁻¹² m ou rad nos deslocamentos e rotações, 5 × 10⁻⁴ N ou N·m nas reações e 5 × 10⁻⁷ J na energia. Para reproduzir a conferência mínima da sintaxe `Spring`, use um nó de solo fixo e um segundo nó com referencial a 30° em XZ, UX local e RY restringidos, mola de 1.000 kN/m em z local e força de −1 kN nessa direção. O GL 3 do segundo nó vale −0,001 m.

O cenário de interface edita a mola em kN/cm, consulta os resultados globais e locais, zera a rigidez, desfaz e refaz e confere o salvamento e a reabertura. O teste de combinação confirma que a reação da mola é multiplicada com a mesma parcela do caso.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test -- tests/nodal-springs.test.ts tests/nodal-springs.integration.test.ts
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- nodal-springs.spec.ts
```

## KS-27 — Diafragmas de pavimento

O ensaio `diaphragmBenchmark` usa um piso na cota 3 m, com nós S, C, E e N sobre X = 0 e coordenadas Y de −2, 0, +1 e +2 m. As molas em X nos nós S e N têm 6.000 kN/m cada. A translação Y é restringida no centro. A distância entre os apoios é 4 m. O movimento comum no plano não deforma as barras entre os participantes.

| Força aplicada | Reação X em N | Reação X em S | UX no centro | Rotação θz | UX em N / S |
| --- | ---: | ---: | ---: | ---: | ---: |
| +12 kN em X no centro | −6 kN | −6 kN | +1 mm | 0 | +1 / +1 mm |
| +12 kN em X a Y = +1 m | −9 kN | −3 kN | +1 mm | −0,25 mrad | +1,5 / +0,5 mm |

Os valores seguem de `ΣFx = 0`, `ΣMz = 0` e da relação força–deslocamento das duas molas. Com a origem no centro, a carga excêntrica produz −12 kN·m e a rigidez à torção do piso sobre as molas vale 48.000 kN·m/rad. O teste compara as reações com tolerância absoluta de 0,001 N e os deslocamentos e rotações com 10⁻¹⁰ m ou rad. A rotação do modelo em 90° verifica a mesma resposta em Y. A troca da referência para (+0,75 m, −0,375 m), inclusive sob força e binário simultâneos, conserva os resultados físicos.

No ensaio fora do plano, a linha S–N trabalha como viga biapoiada com vão de 4 m, E = 200 GPa, seção de 0,15 × 0,20 m e uma força de −1 kN no centro. A flecha é −0,066667 mm. Um momento em torno de Y testa também a torção da barra. UZ, RX e RY dos quatro nós são comparados com a mesma viga resolvida com o diafragma removido. Outros ensaios usam apoios inclinados, componentes ligados só pelo piso, dois pavimentos independentes e uma ligação com trecho rígido. O caso mínimo usa diretamente as duas molas e estabiliza os graus fora do plano de cada nó.

A suíte de interface abre o projeto espacial, cria e edita o vínculo em centímetros, resolve o caso excêntrico, lê a reação de −9 kN, desfaz e refaz a edição e reabre o arquivo salvo. Para reproduzir com o executável fixado, execute os comandos na raiz do repositório.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm test -- tests/diaphragm.test.ts tests/diaphragm.integration.test.ts
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- diaphragm.spec.ts
```

## KS-26 · Fundação acoplada de seis graus de liberdade

Selecione um nó espacial e abra **Propriedades → Apoios e restrições → Importar fundação do MolaStruct**. A prévia mostra a matriz na origem do CSV em kN, kN·m, m e rad. Informe os eixos e o ponto de referência. Para uma origem deslocada, informe o vetor do nó à origem nos eixos da fundação. A opção **No nó, nos eixos globais** exibe a matriz transformada. Confirme a associação depois de conferir os 36 valores.

Com `OOFEM_BIN` apontando para o executável fixado em `docs/OOFEM.md`, reproduza os casos com:

```sh
npm test -- tests/foundation.test.ts
npm run test:e2e -- foundation.spec.ts
```

No caso-base, o bloco (UX, RY) é [[10.000, 2.000], [2.000, 4.000]] nas unidades do CSV. As diagonais restantes são 5.000, 6.000, 3.000 e 7.000 em UY, UZ, RX e RZ. Com FX = 22 kN e MY = 8 kN·m, a solução é UX = 2 mm e RY = 1 mrad. Os outros quatro movimentos são zero. As ações do apoio sobre a estrutura, na mesma origem, são −22 kN e −8 kN·m.

No segundo ensaio os eixos giram +90° em Z e a origem da matriz fica 0,5 m acima do nó. Multiplica-se a matriz do CSV pelo movimento de referência na origem e transfere-se o torsor até o nó usando `M_nó = M_origem + r × F`. As ações globais são (5, 22, 18) kN e (−19, 8,5, −7) kN·m. O OOFEM deve fornecer (0, 1,5, 3) mm e (−1, 2, −1) mrad no nó e reações opostas às seis ações. O ensaio compara movimentos com tolerância absoluta de 10⁻¹² m ou rad e reações com tolerância de 10⁻⁹ vezes o maior entre 1 e o módulo de cada referência em SI.

A fatoração aplica Cholesky após equilibrar a diagonal. Verifica a simetria com tolerância absoluta 10⁻⁸ na matriz adimensional e exige pivôs ativos acima de 10⁻¹². Uma liberdade declarada precisa ter linha e coluna nulas na origem. Cada coluna fatorada produz uma mola sobre uma combinação linear dos seis movimentos, por `GeneralSlaveNode`, `SlaveNode` e `NodalSpring`. A orientação e a mudança de origem preservam o trabalho virtual. A reação da fundação no nó é `−K_nó q_nó`.

Em um terceiro ensaio, a suíte monta diretamente `Tᵀ K T` para uma matriz densa, eixos oblíquos e um deslocamento de origem nas três direções. Os 36 termos transformados são comparados com tolerância relativa de 10⁻¹¹ (piso unitário em SI). O teste resolve o projeto reaberto e compara os seis movimentos e as seis reações à referência independente.

A suíte também resolve a exportação F01 com o termo FX–RY negativo, a rotação RX livre do B16 com um vínculo complementar e a matriz diagonal em uma barra espacial frente às molas da KS-25. O teste de interface cobre arquivo inválido com apoio anterior intacto, confirmação de eixos/origem, substituição, desfazer/refazer, salvar, reabrir e executar.

## Força e momento concentrados no vão (KS-29)

Use a viga biapoiada de 6 m do exemplo, retire a carga uniforme e mantenha o apoio articulado em i e o apoio móvel em j. Em **Modelo → Carga concentrada**, clique na barra e ajuste a posição para 2 m a partir de i. Repita a análise com a posição relativa `1/3`. Consulte **Esforços** na mesma estação pelos lados i e j.

| Ação aplicada | Reação vertical em i | Reação vertical em j | Cortante nos lados i e j | Momento nos lados i e j |
| --- | ---: | ---: | --- | --- |
| FZ global = −12 kN | +8 kN | +4 kN | +8 e −4 kN | +16 e +16 kN·m |
| MY global = +6 kN·m | −1 kN | +1 kN | −1 e −1 kN | −2 e +4 kN·m |

A primeira linha decorre de `Rj = 12 × 2 / 6` e `M(2 m) = 8 × 2` na seção carregada. Na segunda linha o binário produz salto de +6 kN·m no momento. Os testes repetem a força com 2, 3 e 8 subdivisões regulares e invertem i/j. Também verificam a divisão e a união físicas, a superposição de casos, a soma com uma carga nodal coincidente e a aplicação dentro de um braço rígido.

No ensaio espacial, engaste a extremidade (0, 0, 0) e deixe livre a extremidade (3, 0, 4) m. Gire a seção em +90° e aplique Fz local = −10 kN em x/L = 0,4 com fator 1,5 no caso. A força resultante é +15 kN em Y global. A reação é −15 kN em Y, com momentos +24 kN·m em X e −18 kN·m em Z. A inversão de i/j conserva as reações globais. Os ensaios de esforços usam tolerâncias absolutas de até 0,005 N ou N·m na comparação com a saída numérica.

```sh
OOFEM_BIN=/caminho/absoluto/oofem npm run check
OOFEM_BIN=/caminho/absoluto/oofem npm run test:e2e -- member-point-loads.spec.ts
```
