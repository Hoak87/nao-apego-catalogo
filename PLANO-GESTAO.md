# Plano — Hub de Gestão "não apego"

> **Para o agente que vai executar este plano:** este documento é autocontido. Leia tudo antes de começar. Trabalhe fase por fase, na ordem. Ao final de cada fase há critérios de aceitação — não avance sem cumpri-los. O usuário (Henrique) faz os passos manuais marcados com 🧑.

---

## 1. Contexto do negócio

- **não apego** é um brechó por consignação de moda feminina operado no Instagram (@naoapegobazar) pela Luiza ("Lu"), que é quem usa o admin no celular.
- Peças pertencem a "closets" (consignantes). Split padrão 60% closet / 40% bazar. ~25 closets, ~299 compradoras, ~462 peças disponíveis.
- **Drops** = desconto progressivo por tempo: Drop 01 (0–30 dias, preço cheio), Drop 02 (31–60 dias, −20%), Desapego Final (60+ dias, −40%).
- Site público: `https://naoapego.com.br` (GitHub Pages, `index.html` deste repo). Lê a aba CATALOGO publicada como CSV.

## 2. Stack e arquivos

```
Planilha Google (ESTOQUE privado + CATALOGO público como CSV)
    ↕ Google Apps Script (projeto container-bound da planilha)
Admin web app (doGet → Admin.html)  ← ESTE PLANO MEXE AQUI
Site público (index.html, GitHub Pages) ← NÃO mexer neste plano
```

| Arquivo local | O que é |
|---|---|
| `admin-script/Code.gs` | Backend do admin (doGet, login, getPieces, savePhoto, analyzeNewPiece, createPiece) |
| `admin-script/Admin.html` | Frontend do admin (SPA única, `google.script.run` para chamar o backend) |
| `admin-script/SetupPlanilha.gs` | Menu da planilha: gera/atualiza a aba CATALOGO a partir do ESTOQUE |
| `index.html` | Site público — fora do escopo deste plano |

- **Planilha:** `https://docs.google.com/spreadsheets/d/1-Z441d2GzymrPXv7fZUgK8xYKlzpBJMWghIqTZ21ESI`
- **Admin publicado:** `https://script.google.com/macros/s/AKfycbyvL0erU-4cueWvuaFnY30J-PS6Lxu0GZn7nYvX1YtGp49CnNWkn5ejVeMTqCE3dZeq2Q/exec?pwd=naoapego2026`
- **Senha:** constante `ADMIN_PASSWORD` no `Code.gs` (`naoapego2026`)

### Colunas da aba ESTOQUE (privada — tem dados financeiros)
`Código, Marca, Descritivo Peça, Tamanho, Cor, Status, Preço Total, Data Entrada, Closet, Foto, Compradora, Valor Repasse, Valor Comissão` (pode haver outras — sempre localizar coluna pelo nome do header, nunca por índice fixo).

- `Status`: `Disponível`, `Pago`, `Cancelado`, `Devolvido` (e possivelmente outros)
- `Foto`: URLs separadas por `|`
- `Código`: `INICIAIS_DO_CLOSET + AAMM + seq 3 dígitos` (ex: `BR2502020` = Bea Romano, fev/2025, peça 020)

### Colunas da aba CATALOGO (pública — NUNCA colocar dados financeiros de repasse/comissão/compradora)
`Código, Marca, Descritivo Peça, Tamanho, Cor, Status, Data Entrada, Closet, Tipo Closet, Foto, Preço Original, Sugestão Drop 02, Sugestão Desapego Final, Preço Atual, Drop Atual, Status Drop`

## 3. Regras técnicas obrigatórias (Apps Script)

1. **Escrita em planilha sempre via mapa de headers** (`headers.indexOf('Nome')`), nunca índice fixo.
2. **`LockService.getScriptLock()`** em toda função que gera código sequencial ou escreve linhas novas.
3. **Frontend chama backend via `google.script.run.withSuccessHandler(...).withFailureHandler(...).funcao(args)`** — sempre tratar falha com toast/mensagem, nunca deixar a UI travada.
4. **Republicação:** toda mudança no código só vai ao ar após: editor Apps Script → Implantar → Gerenciar implantações → ✏️ → Nova versão → Implantar. 🧑 Henrique faz isso.
5. **API do Claude:** chave em Script Properties (`ANTHROPIC_API_KEY`), nunca no código (o repo é público no GitHub). Modelo na constante `ANTHROPIC_MODEL` (`claude-haiku-4-5`). Chamada via `UrlFetchApp` com `muteHttpExceptions: true`.
6. **Fotos:** comprimir no cliente (max 1200px, JPEG 0.75–0.82) antes de enviar base64; salvar no Drive na pasta `nao-apego-fotos`; URL no formato `https://drive.google.com/thumbnail?id=FILE_ID&sz=w800`; múltiplas fotos unidas por `|`.
7. **Design existente (manter consistência):** fundo `#fafaf8`, superfícies `#fff`, borda `#e8e4df`, texto `#1a1a1a`, muted `#8a8580`, accent `#2d2d2d`, verde `#25d366`. Fonte system (-apple-system). Chips arredondados (border-radius 100px), cards com radius 10px. Mobile-first — a Lu usa no celular.
8. **Sem frameworks** — HTML/CSS/JS vanilla dentro de arquivos `.html` do Apps Script. Sem CDNs externos se possível.
9. Após alterar arquivos locais, **commitar no git** (o repo local `/Users/oak/nao-apego-catalogo` é a fonte da verdade a partir de agora).

---

## FASE 0 — Destravar o que existe (fazer primeiro)

**Problema atual:** a página do admin abre em branco no Chrome do Henrique (só o banner "Este aplicativo foi criado por um usuário do Google Apps Script").

**Diagnóstico provável** (nesta ordem — o conteúdo é servido corretamente via curl, então o problema é no browser):
1. **Múltiplas contas Google logadas** — causa nº 1 de iframe branco no GAS. Testar em janela anônima logado só na conta dona do script.
2. **Cookies de terceiros bloqueados** — o GAS renderiza via iframe de `googleusercontent.com`. Chrome → Configurações → Privacidade → permitir cookies de terceiros para `script.google.com` e `googleusercontent.com` (ou adicionar exceção).
3. Conferir a implantação: Executar como **"Eu"**, acesso **"Qualquer pessoa"**.

**Deploy pendente:** o `Code.gs` e o `Admin.html` do repo local têm a funcionalidade nova de cadastro com IA (commit `2aceb80`) que ainda NÃO está no editor online.

🧑 Passos do Henrique:
1. Abrir o editor Apps Script da planilha (Extensões → Apps Script)
2. **Antes de colar:** comparar o `Code.gs`/`Admin.html` online com os do repo — se o online tiver algo que o repo não tem (ex: upload múltiplo, sync CATALOGO no savePhoto), trazer para o repo primeiro
3. Colar os arquivos do repo, salvar
4. Configurações do projeto → Propriedades do script → adicionar `ANTHROPIC_API_KEY` (criar em console.anthropic.com, limite US$ 5/mês)
5. Implantar → Nova versão

**Aceitação:** admin abre no celular da Lu e no Chrome do Henrique; as 3 abas aparecem (sem foto / trocar foto / ➕ nova); cadastrar 1 peça de teste com IA funciona de ponta a ponta (código gerado, foto no Drive, linha no ESTOQUE e CATALOGO). Apagar a peça de teste depois.

---

## FASE 1 — Hub de gestão (menu + navegação)

**Objetivo:** transformar o admin de "ferramenta de fotos" em "hub de gestão" com tela inicial de menu.

**UI:**
- **Tela HOME** (nova, primeira tela após login): logo "não apego · gestão" + grade de cards de navegação:
  - 📷 **Fotos do catálogo** → view atual (sem foto / trocar foto)
  - ➕ **Cadastrar peça** → view de cadastro com IA (Fase 0)
  - 📊 **Painel** → placeholder "em breve" (Fase 2)
  - 👥 **Compradoras** → placeholder "em breve" (Fase 3)
- Cada card: ícone, título, subtítulo de 1 linha (ex: "459 peças sem foto" — dado real vindo do backend via uma função `getHomeStats()`).
- **Navegação:** header fixo com botão "← menu" quando dentro de uma view. Implementar como SPA na mesma página (mostrar/esconder `<div>`s de view) — NÃO usar múltiplos doGet/URLs, porque `google.script.run` e o estado já carregado se perdem.
- Estrutura JS sugerida: `showView('home' | 'fotos' | 'nova' | 'painel' | 'crm')` que alterna visibilidade e carrega dados sob demanda (lazy: só chamar `getPieces()` quando entrar em "fotos"/"nova" pela 1ª vez).

**Backend:** nova função `getHomeStats()` retornando `{disponiveis, semFoto, vendidasMes, closets}` (ler ESTOQUE uma vez, contar por Status/Foto).

**Aceitação:** login cai na HOME; todos os cards navegam; voltar ao menu funciona; ferramentas existentes continuam funcionando; stats reais na home.

---

## FASE 2 — Painel de gestão (faturamento e dados)

**Objetivo:** view 📊 com indicadores que a Lu e o Henrique consultam no celular. Fonte: aba ESTOQUE (é a única com dados financeiros).

**Backend:** função `getDashboard(mesReferencia)` que retorna JSON agregado (nunca mandar a planilha inteira pro cliente):
- **GMV do mês** (soma de `Preço Total` das peças com `Status = Pago` no mês — ver observação abaixo sobre data de venda)
- **Comissão do bazar no mês** (soma `Valor Comissão`) e **repasses devidos por closet** (soma `Valor Repasse` agrupado por `Closet`)
- **Vendas por closet** (contagem + valor)
- **Série dos últimos 6 meses** (GMV mensal) para gráfico de barras
- **Saúde do estoque:** peças disponíveis por drop (Drop 01 / 02 / Final), peças paradas há 60+ dias
- ⚠️ **Observação importante:** o ESTOQUE pode não ter coluna "Data Venda" — verificar. Se não tiver: (a) propor ao Henrique adicionar a coluna e passar a preenchê-la; (b) enquanto isso, agregar "tudo até hoje" sem recorte mensal. Não inventar datas.

**UI:** cards de KPI no topo (GMV, comissão, peças vendidas, ticket médio), gráfico de barras simples dos últimos 6 meses (CSS/SVG puro, sem lib), tabela "repasses por closet" e lista "peças paradas". Seletor de mês simples (‹ julho/2026 ›).

**Aceitação:** números batem com uma conferência manual na planilha para 1 mês; painel carrega em <5s; nada de dado financeiro vaza para a aba CATALOGO ou site público.

---

## FASE 3 — CRM de compradoras

**Objetivo:** base de compradoras acessível no hub.

**Dados:** criar aba nova **`COMPRADORAS`** na planilha com colunas:
`Nome, WhatsApp, Instagram, Tamanho(s), Closet favorito, Observações, Data 1ª compra, Última compra, Total gasto, Nº compras`

**Backend:**
- `seedCompradoras()` — função de migração (rodar 1x pelo editor): varre o ESTOQUE, extrai valores únicos da coluna `Compradora`, cria uma linha por compradora com agregados calculados (nº compras, total gasto, primeira/última compra). Campos de contato ficam vazios para a Lu preencher aos poucos.
- `getCompradoras(query)` — busca/lista (nome, Instagram); retornar no máx. ~50 por vez.
- `getCompradora(nome)` — detalhe + histórico de compras (peças do ESTOQUE onde `Compradora = nome`).
- `saveCompradora(dados)` — cria/edita (localizar por nome; usar LockService).
- ⚠️ A coluna `Compradora` do ESTOQUE é texto livre — pode haver variações de grafia ("Ana P." vs "Ana Paula"). O seed deve agrupar por valor exato e a UI deve permitir corrigir/mesclar manualmente depois. Não tentar dedupe automático agressivo.

**UI:** busca no topo → lista (nome, nº compras, total gasto) → tela de detalhe com dados de contato editáveis + histórico de peças compradas + botão WhatsApp (`https://wa.me/55...`).

**Aceitação:** seed roda sem duplicar em re-execução (idempotente); busca funciona; editar contato persiste; histórico bate com o ESTOQUE.

---

## FASE 4 — Polimento e futuro (não implementar agora, só registrar)

- Migração da stack para **Next.js 14 + Supabase** (plano de longo prazo já existente — este hub GAS é a ponte)
- Exportação do projeto para a conta Claude da própria Luiza
- Auth melhor que senha na URL (limite do GAS; resolver na migração)
- Notificações de drop (peças que mudaram de faixa) via WhatsApp

---

## Ordem de execução e divisão de commits

1 commit por fase, mensagens em pt-BR minúsculas no padrão do repo (ex: `admin: hub de gestao com menu home`). Nunca commitar chave de API. Após cada fase, lembrar o Henrique de republicar o Apps Script (🧑) e testar no celular antes de seguir.
