# Arquitetura

## Fluxo

`Projeto editável → validação → malha de análise → entrada OOFEM → processo nativo → saída normalizada → tabelas e diagramas`

| Camada            | Responsabilidade                                                    | Local                        |
| ----------------- | ------------------------------------------------------------------- | ---------------------------- |
| Domínio           | Formato v11, migração v1 a v10, geometria, validação e histórico     | `src/domain`                 |
| Adaptador         | Discretização, IDs, unidades e sinais, leitura da saída             | `src/solver/oofem.ts`        |
| Combinações       | Superposição de deslocamentos, reações e esforços estáticos         | `src/solver/combinations.ts` |
| Envelopes         | Extremos de esforços por estação, combinação e esforços simultâneos | `src/solver/envelopes.ts`    |
| Ponte desktop     | Abrir/salvar, configuração do motor e IPC                           | `src/solver/desktop.ts`      |
| Processo          | Diretório temporário, execução sem shell, prazo e limpeza           | `crates/solver-runner`       |
| Aplicativo nativo | Registro do comando assíncrono e permissões                         | `src-tauri`                  |
| Interface         | Modelo compartilhado, vistas, propriedades e resultados             | `src/components`             |

React/TypeScript/Vite/Three.js no frontend. Tauri 2/Rust no desktop, seguindo os aplicativos OpenStruct. SVG é usado na elevação para seleção e desenho preciso. A perspectiva usa Three.js, renderizando apenas quando o modelo, câmera ou tamanho mudam.

## Modelo próprio

O esquema v11 contém o modo do projeto, referências de eixos X/Y e pavimentos Z, coordenadas XYZ, materiais, seções, nós, barras, lajes, padrões de carga, casos de análise, combinações e envelopes de esforços. O modo `planar` usa Y = 0 e UX/UZ/RY. As barras do modo `spatial` usam UX/UY/UZ/RX/RY/RZ. A leitura de v1 insere as referências iniciais, mantém o modo plano e preenche os novos componentes de apoio e carga com valores livres e nulos. A leitura de v1 e v2 inicia a lista de combinações vazia. Projetos v1 a v3 começam com a lista de envelopes vazia. A migração de v1 a v4 inicia a lista de lajes e as pressões de cada padrão vazias. A abertura dos dois formatos experimentais v5 preserva a formulação original. O formato com cota Z e pressões QDKT associa o painel ao pavimento correspondente ou cria uma referência na cota importada.

Cada vista de lançamento usa um plano ortogonal em uma posição de referência. O snap prioriza nós do plano, depois eixos e pavimentos próximos, e usa uma malha de 0,50 m como passo. Os nós têm coordenadas independentes das referências. Copiar geometria aplica uma translação aos selecionados e reutiliza nós coincidentes no destino.

IDs do projeto são persistentes. O esquema v8 guarda em `meshConnections` os pares de IDs da barra e do nó interno. A migração de v7 cria uma lista vazia e conserva todas as peças e seus IDs. Um cruzamento confirmado em XYZ cria ou reutiliza um nó editável ao qual se podem atribuir apoios, cargas ou outras incidências.

`beamStations` ordena os nós internos pela projeção sobre o eixo físico i → j e intercala as estações regulares de `segmentsPerMember` (2 a 32, padrão 8). A tolerância geométrica é de 10⁻⁶ m. Uma incidência próxima a uma estação regular substitui essa estação na sua posição real. Conexões internas distintas na mesma estação são rejeitadas. Na exportação cada nó editável recebe um único número OOFEM e os nós de refinamento são privados de cada barra. O pré-processador verifica os apoios por componente conectado. A intensidade uniforme em N/m acompanha os elementos do membro e o OOFEM a integra em cada comprimento.

Em cada conexão interna, o parser conserva o esforço de extremidade final do elemento que chega (lado i) e o inicial do seguinte (lado j). Os dois registros compartilham `memberId`, `t = x/L` e deslocamento. Combinações e envelopes verificam a mesma sequência de posições e lados em todos os casos. Os diagramas unem os dois limites na mesma abscissa e o CSV identifica o lado da seção.

O painel de laje tem ID persistente, origem XY, lados, referência ao pavimento, material, espessura, quatro condições de borda e subdivisões independentes em X/Y. `meshSlab` numera os nós em linhas de X crescente. Em QDKT cada célula forma um quadrilátero. Em DKT a diagonal do canto inferior esquerdo ao superior direito define dois triângulos anti-horários. As bordas referenciam os mesmos nós da conectividade. A malha e os resultados são derivados do painel na revisão atual. A análise de laje aceita um painel isolado por projeto.

O padrão de carga armazena ações. O caso de análise seleciona os padrões, os fatores e o procedimento. A combinação linear armazena IDs de casos estáticos e os respectivos fatores. O envelope guarda os IDs das combinações incluídas, na ordem escolhida. O editor aplica as mudanças de padrões, casos, combinações e envelopes em uma única edição. Antes de excluir um padrão, caso ou combinação, retire suas referências das definições que o utilizam.

### Materiais e atribuições

Cada material do projeto tem um ID estável e quatro propriedades elásticas e térmicas. O esquema v9 acrescenta `alpha` em 1/K. Na migração de v8, cada material recebe zero, valor historicamente escrito em `tAlpha`. As seções referenciam `materialId` e as lajes guardam sua própria referência direta. A lista de usos da biblioteca inclui ambos. Duplicar cria um ID novo. Reatribuir modifica somente a referência do destino.

O cadastro aceita valores finitos com E > 0 em Pa, 0 ≤ ν < 0,5, ρ > 0 em kg/m³ e α com sinal. O adaptador exporta `IsoLE` com `d`, `E`, `n` e `tAlpha` para barras e para a placa isolada. Os padrões e fatores de carga continuam determinando as ações aplicadas.

## Unidades e sinais

O esquema v10 discrimina as seções por `shape` e persiste somente os dados de identificação, material e dimensões da forma em metros. Projetos e rascunhos v1 a v9 passam pela migração que identifica os retângulos como `rectangle` e preserva ID, largura, altura e material. As barras continuam vinculadas por `sectionId`. A prévia do catálogo, o inspetor e o adaptador OOFEM usam `sectionProperties` de `src/domain/sections.ts`. O adaptador escreve A e Iy em `Beam2d` e acrescenta Iz e J (`Ik`) em `Beam3d`. A mudança de forma ou de atribuição passa pelo histórico e invalida os resultados da revisão.

Persistência e entrada do solver em N, m, kg, s e rad. A interface converte cargas para kN/kN·m, seção para cm, E para GPa, deslocamentos para mm e rotações para mrad nas tabelas.

Z global é vertical positivo para cima. Momentos globais obedecem à regra da mão direita. A barra vai do nó inicial ao final. No plano XZ, a base local tem `u = (c, s)` e `w = (-s, c)`. A transformação de carga uniforme é explícita, `qu = c qX + s qZ`, `qw = -s qX + c qZ`, enviada com `csType 1`.

Os esforços locais de extremidade `[Fu1,Fw1,My1,Fu2,Fw2,My2]` são convertidos em esforços de seção: início `N=-Fu1, V=Fw1, M=My1`, fim `N=Fu2, V=-Fw2, M=-My2`. A interpretação positiva de momento sagente vale para uma viga horizontal orientada em +X. Inverter o sentido da barra exige interpretar sua base local.

No espaço, x local vai do início ao fim. A projeção de Z global no plano normal à barra define z local antes da rotação da seção. Para barras verticais ou quase verticais, usa-se X global como referência. A largura da seção acompanha y local, e a altura acompanha z local. A rotação é positiva pela regra da mão direita em torno de x local. As cargas distribuídas são projetadas nessa base ortonormal.

Os esforços espaciais `N, Vy, Vz, Mx, My, Mz` são resultantes na face de corte com normal +x local. Usa-se o oposto da ação na extremidade inicial e o valor da ação na final. N positivo representa tração. As reações e deslocamentos são globais. Os diagramas 2D mostram a ordenada do componente escolhido perpendicular à barra no plano em tela.

As tabelas apresentam estações da malha. Deformadas e diagramas são linhas interpoladas entre estas estações, sem pretensão de avaliar extremos exatos entre elas.

### Referencial dos apoios

O v11 inclui `supportFrame` opcional em cada nó. A migração do v10 preserva os vínculos globais e os IDs. Em XZ, o referencial guarda o ângulo θ da tangente a partir de +X para +Z. A base é x′ = (cos θ, 0, sen θ), y′ = (0, 1, 0) e z′ = (−sen θ, 0, cos θ). Em XYZ, o projeto guarda duas direções, normaliza x′ e recompõe z′ pelo produto vetorial e y′ por z′ × x′. As flags de `restraints` correspondem aos eixos do referencial do nó. A base da barra é independente.

O adaptador envia x′ e y′ como `lcs 6` no registro `Node`. Os vínculos usam os graus locais, e `NodalLoad` usa `cstype 0` em nós orientados para que o OOFEM projete as componentes globais. O parser recompõe as translações, rotações, forças e momentos globais antes de verificar equilíbrio e montar deformadas e combinações. A tabela e o CSV obtêm as componentes locais projetando as reações globais no mesmo referencial. O pré-processador examina movimento de corpo rígido por componente. Uma restrição de translação na direção unitária a, aplicada a um nó de posição relativa r, gera a linha (a, r × a), e uma restrição de rotação gera (0, a). No plano, usam-se apenas UX, UZ e RY.

Na laje, a pressão pZ é armazenada em N/m² em cada padrão de carga. A interface exibe pZ em kN/m², UZ em mm e os momentos Mx e My em kN·m/m. Os eixos locais do painel coincidem com X e Y globais. Mx positivo representa tração na face inferior na direção X, e My positivo representa tração na face inferior na direção Y. Os mapas usam a média por elemento. A consulta central usa os deslocamentos nodais e os momentos recuperados nos vértices.

## Consistência

- O formato v7 guarda os grupos nomeados como conjuntos explícitos de pares tipo/ID. Ao migrar um arquivo anterior, mantém as associações válidas de grupos existentes ou cria uma lista vazia. A seleção transitória pertence à interface. Excluir uma peça limpa suas associações no mesmo passo do histórico.
- Um objeto de projeto validado é a única fonte de verdade das vistas e propriedades.
- Os resultados de casos estáticos ficam em memória por ID do caso durante a revisão atual. A combinação usa esses resultados, alinhando apoios e nós por ID e esforços por barra e posição na malha. Parcelas com fator zero dispensam uma análise do caso correspondente.
- O envelope compara as combinações escolhidas em cada estação e preserva o vetor inteiro de esforços da combinação que gera cada mínimo ou máximo. Empates usam a ordem de seleção das combinações. A interface cancela o cálculo do envelope quando muda a revisão ou a definição consultada.
- O CSV registra os IDs e nomes de origem. Para combinações e envelopes, registra também os casos e fatores da composição governante. Os arquivos de projeto armazenam as definições de carga, combinação e envelope.
- Edição, desfazer, refazer e substituir o projeto avançam a revisão e invalidam todos os resultados. A resposta de uma análise em andamento é aceita apenas na revisão em que foi solicitada.
- Arquivos não podem configurar executáveis nem introduzir comandos. A seleção do OOFEM fica nas preferências locais.
- O runner usa argumentos separados, sem shell, um diretório temporário por execução, prazo de 60 s e limite de 32 MB por saída. Encerra e aguarda o processo em cancelamentos e ao atingir o prazo.
- O Tauri reserva a execução antes de habilitar o cancelamento e publica o resultado em um canal IPC. Os registros locais têm escrita atômica e retenção de 30 execuções.
- Pacotes desktop usam o OOFEM integrado com manifesto e conferência de SHA-256. O caminho explícito nas preferências permite outro executável. A distribuição e seu autoteste estão descritos em [DISTRIBUTION.md](DISTRIBUTION.md).
- O parser exige término, passo único, deslocamentos e esforços completos, reações dos vínculos e equilíbrio global. Erros não geram resultados parciais.
- **Conexões da malha** liga um nó existente ao interior de uma barra ou um par de barras que se cruzam em XYZ. Um cruzamento apenas em projeção permanece independente. A camada **Malha de análise** identifica as estações de refinamento e destaca as incidências confirmadas.
- Desconectar remove só a incidência escolhida e conserva o nó e suas atribuições. Um nó isolado aparece no diagnóstico antes da análise. Excluir um nó ou uma barra limpa suas incidências na mesma edição. Mover um nó ao longo da barra ou alterar uma extremidade recalcula x/L. Para afastar o nó do eixo ou encurtar a barra além dele, desconecte-o primeiro. Transformar a barra leva os seus nós internos junto, e uma cópia registra as incidências da nova barra. Dividir fisicamente redistribui incidências pelos trechos. No próprio ponto do corte, o nó vira extremidade compartilhada. O refinamento mantém os IDs, conexões e seleção. Edições, desfazer e refazer invalidam os resultados.

### Edição das barras físicas

Dividir mantém o ID da barra no trecho que parte de i e copia para cada trecho as cargas uniformes de cada padrão. Grupos que continham a peça passam a conter os trechos. Unir exige nós compartilhados por ID em uma cadeia colinear, seção, orientação física e intensidades globais compatíveis em cada padrão. A primeira barra da cadeia na ordem do projeto conserva ID e sentido independentemente da ordem de seleção. Os grupos passam a referenciar essa barra uma única vez. Os nós intermediários removidos saem dos grupos.

Aparar e prolongar verificam a ponta antes de alterar sua posição. Um apoio, carga nodal ou barra externa incidente bloqueia a remoção ou o deslocamento desse nó. Se já existe um nó no destino, a ligação e os grupos usam seu ID. Barras que passam pelo interior do ponto de corte são subdivididas no mesmo nó. Uma referência por barra usa a interseção em XYZ com o segmento escolhido. As quatro operações editam o modelo físico. A malha do OOFEM continua derivada na exportação.

## Referências técnicas do adaptador

- [OOFEM Beam2d 3.0](https://github.com/oofem/oofem/blob/v3.0/src/sm/Elements/Beams/beam2d.C)
- [Caso oficial beam2d_1](https://github.com/oofem/oofem/blob/v3.0/tests/sm/beam2d_1.in)
- [OOFEM Beam3d 3.0](https://github.com/oofem/oofem/blob/v3.0/src/sm/Elements/Beams/beam3d.C)
- [Caso oficial beam3d_1](https://github.com/oofem/oofem/blob/v3.0/tests/sm/beam3d_1.in)
- [Comandos Rust no Tauri](https://v2.tauri.app/develop/calling-rust/)

Trabalho bloqueante fica em `spawn_blocking`, preservando a responsividade da janela.
