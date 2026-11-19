# Distribuição desktop

O workflow [KStruct desktop packages](https://github.com/ricardocorsini/k-struct/actions/workflows/desktop-packages.yml) produz pacotes de teste a partir da `master`. Abra a execução da revisão que deseja testar e baixe o artefato da sua plataforma.

| Plataforma x86-64     | Pacote                | Instalação                                                                                                                                              |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows               | `KStruct_…-setup.exe` | Execute o instalador NSIS para o usuário atual. Ele inclui o instalador offline do WebView2.                                                            |
| Linux (Debian/Ubuntu) | `.deb`                | Instale com `sudo apt install ./KStruct_…_amd64.deb`. Em instalação offline, as bibliotecas de sistema exigidas pelo pacote precisam estar disponíveis. |
| Linux                 | `.AppImage`           | Dê permissão de execução com `chmod +x KStruct_….AppImage` e abra o arquivo. Em sistemas sem FUSE, use a opção `--appimage-extract-and-run`.            |

O artefato inclui `SHA256SUMS.txt`, o manifesto do OOFEM e o relatório do autoteste de cada formato. Estes pacotes alpha ficam disponíveis no Actions pelo período de retenção indicado no workflow. O instalador de teste Windows é gerado sem assinatura de código.

## Conferir a instalação

1. Abra o KStruct e clique em **Configurar OOFEM → Testar motor**. O diagnóstico informa a origem e a versão do executável, e resolve a viga de referência de 6 m.
2. Em **Modelo**, abra **Viga de referência** e clique em **Analisar**. Espere duas reações de 30 kN, momento positivo de 45 kN·m e flecha central de −8,4375 mm.
3. Em **Análise → Histórico**, consulte e exporte as mensagens da execução. O histórico guarda as últimas 30 execuções locais. O estado **Motor concluído** registra o término do processo. O KStruct ainda verifica o resultado antes de mostrá-lo no modelo.

O autoteste também pode ser executado sem abrir a janela, com `k-struct --check-oofem relatorio.json` no Linux. No PowerShell, na pasta de instalação, use `Start-Process .\k-struct.exe -ArgumentList '--check-oofem relatorio.json' -Wait -PassThru`. O código de saída é zero quando o motor reproduz a referência.

## Compilar

Use Node.js, Git, Rust, CMake e os [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/). No Linux, instale Ninja. No Windows, instale Visual Studio 2022 Build Tools com C++ e Windows SDK. A CI de empacotamento usa Ubuntu 22.04, Windows Server 2025 e Rust 1.100.0.

```sh
npm ci
npm run desktop:build
```

O comando baixa a tag do OOFEM, verifica o commit fixado e compila o executável antes de empacotar o KStruct. A pasta gerada `src-tauri/resources/oofem/` é incorporada ao pacote. Ela contém o manifesto de versão, o executável, as fontes exatas, a licença, o README do projeto OOFEM e a receita de compilação a partir do arquivo de fontes. O empacotamento verifica os hashes dos arquivos instalados. A instalação e execução podem usar esses recursos locais depois que os arquivos forem baixados.

O pacote .deb usa o WebKitGTK do sistema. No Windows, o NSIS inclui o instalador offline do WebView2. O OOFEM é um processo separado e pode ser trocado pelo caminho escolhido em **Configurar OOFEM**.
