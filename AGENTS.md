# KStruct — orientação para contribuições

- Leia README, docs/ARCHITECTURE.md e docs/ROADMAP.md antes de alterar o domínio ou solver.
- Preserve React/TypeScript/Vite/Three.js + Tauri 2/Rust. Interface em português brasileiro.
- Domínio em SI, conversões explícitas na UI. Nunca use resultados inventados como fallback de análise.
- Objetos editáveis e elementos de malha têm identidades distintas. Versões incompatíveis de projeto exigem migração explícita.
- Alterações invalidam resultados. Chamadas nativas não podem bloquear a janela.
- Mudanças de física, unidades ou sinais exigem benchmarks analíticos e OOFEM real. Informe testes ignorados por ausência do solver.
- Execute npm run check e npm run build. Para interface, execute npm run test:e2e. Para Rust, cargo test --manifest-path crates/solver-runner/Cargo.toml e cargo check --manifest-path src-tauri/Cargo.toml.
- Sem escopo de filesystem irrestrito ou execução por shell. Caminhos do solver pertencem às preferências locais, nunca ao arquivo do modelo.
- Não copie código de outros produtos sem verificar sua licença. Identidade e interface originais do OpenStruct.
