# Plano — Migração "não apego" para sistema de gestão + CRM (Next.js + Supabase)

> Este documento substitui as Fases 2 e 3 de `PLANO-GESTAO.md` (painel e CRM no Google Apps Script). Essas fases **não devem mais ser implementadas no GAS** — o motivo está na crítica abaixo. `PLANO-GESTAO.md` fica congelado como histórico das Fases 0-1 (já feitas).

Crítica produzida com 3 revisões adversariais independentes (arquitetura, segurança, banco de dados) sobre o código real em produção (`admin-script/Código.gs`, `admin-script/Admin.html`) e a spec de longo prazo (`/Users/oak/Downloads/CLAUDE.md`), em 10/09/2026.

---

## 1. Crítica do que foi feito até aqui

### O que funcionou
- O hub GAS (Fase 0 e 1 de `PLANO-GESTAO.md`) provou o modelo de negócio: cadastro com IA, registro de venda, tarefas, API HTTP pra automação via chat. Sem isso não teríamos dado real de ~1.352 peças pra dimensionar o resto.
- A separação ESTOQUE (privado) / CATALOGO (público) está corretamente implementada no código atual — nenhuma coluna financeira é copiada para o catálogo público, e a venda remove a linha do CATALOGO.

### Por que não dá pra continuar evoluindo em cima disso
Não são bugs pontuais — é o teto da ferramenta:
- `sheet.deleteRow()` e escrita em massa (`getRangeList().setValue()`) falham **silenciosamente** sem erro, sem padrão de proteção detectável. Boa parte do backend hoje (`_handleListProtectionsAction_`, `_handleTestWriteCellAction_`, `_handleCheckFormulasAction_`, `_lastDataRow_`) existe só pra desconfiar do próprio armazenamento.
- Repasse/Comissão por peça "herdam" do histórico do closet via busca textual em vez de uma tabela de configuração — funciona, mas é lógica de negócio real embutida numa gambiarra de busca.
- Múltiplos escritores concorrentes (Luiza no Admin, Henrique via curl, futuro bot de WhatsApp) sem controle de concorrência real entre eles.

**Achados de segurança no código atual (achados 1 e 4 merecem patch imediato, ver §4 — não esperar a migração):**
1. 🔴 **XSS armazenado com escalonamento total**: `Admin.html` insere `texto`/`tag` de tarefas e `desc`/`marca`/`closet` de peças em `innerHTML` sem escape. Como esses campos são graváveis via HTTP com a senha do admin (`addTask`, `updateFields`, `vendaDireta`), um payload como `<img src=x onerror=...>` executa dentro da mesma página que tem `google.script.run` disponível — ou seja, pode chamar qualquer função do backend como se fosse a Luiza logada.
2. 🔴 **Injeção de fórmula do Sheets**: `createPiece`, `registrarVenda`, `updateFields`, `renameCloset` gravam texto de usuário direto com `setValue()`, sem prefixar apóstrofo em strings que começam com `=`. Uma fórmula gravada em `Marca`/`Descritivo` pode referenciar células financeiras (`Valor Repasse`, `Compradora`) e, pior, esse valor computado pode acabar copiado para o CATALOGO público via `gerarCatalogo` sem que ninguém perceba — é o vetor real de vazamento de dado financeiro que a separação ESTOQUE/CATALOGO deveria impedir.
3. 🟠 Uma única senha (Script Properties, passada por querystring) autoriza leitura, escrita e exclusão, sem trilha de auditoria de quem chamou o quê.
4. 🟠 `deleteByCodigo` tem um comentário no código dizendo que confirma o `Status` antes de apagar — **isso não existe na implementação**. Qualquer `codigo` válido apaga a linha incondicionalmente, mesmo de peça já vendida e reconciliada.
5. 🟡 Bloqueio de força bruta no login é global (não por IP/sessão), satura em 10min e tem uma corrida (get→put não atômico) que permite passar do limite de tentativas.

### O schema de longo prazo (Next.js + Supabase, `/Downloads/CLAUDE.md`) já era a escolha certa
Postgres resolve por construção quase toda a lista de dor acima: transação atômica venda+status, `UNIQUE(codigo)` elimina duplicata, `closets.split_closet` elimina a herança por busca textual, RLS elimina senha em querystring, MVCC elimina o problema de múltiplos escritores. Mas o schema como estava escrito tinha 15 problemas reais (§3), o mais grave sendo que a RLS estava só descrita em prosa — nenhuma linha de SQL a implementava, o que deixaria a `anon key` do site lendo tabelas financeiras direto.

### O gatilho da migração é o bot de WhatsApp, não uma preferência técnica
Três riscos concretos de adicionar um bot de WhatsApp como 3º/4º escritor no Sheets antes de migrar:
1. `LockService.getScriptLock()` é escopado ao projeto GAS — um bot externo não compartilha esse lock. Estoque de peça única + oversell é falha de negócio direta.
2. `registrarVenda(row, ...)` recebe **índice de linha** do cliente. Qualquer inserção/remoção concorrente entre o carregamento da tela e o clique marca a peça errada como vendida.
3. Latência e quotas do GAS não sustentam webhook de produção da Cloud API, que reenvia em timeout — gera vendas duplicadas.

---

## 2. Decisão

- **Congelar o GAS para features novas.** Não implementar Fase 2 (painel) nem Fase 3 (CRM) de `PLANO-GESTAO.md` — é retrabalho puro, pois Postgres já resolve isso de forma correta.
- **Aplicar patches de segurança mínimos no GAS agora** (§4), independente do prazo de migração — ele continua em produção real por 4-6 semanas.
- **Migrar para Next.js + Supabase** seguindo o schema corrigido (§3) e o roadmap incremental (§5), com o bot de WhatsApp só depois da migração de vendas estar completa.

---

## 3. Schema corrigido (substitui o `schema.sql` de `/Downloads/CLAUDE.md`)

Ordem de criação corrigida (`clientes` antes de `pecas`), com todos os fixes dos 15 achados da revisão de banco incorporados.

```sql
-- ============ EXTENSÕES ============
create extension if not exists pg_trgm;

-- ============ CLIENTES (antes de pecas, por causa do FK reservada_para) ============
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  whatsapp text unique,
  whatsapp_normalizado text generated always as (regexp_replace(whatsapp, '\D', '', 'g')) stored,
  instagram text,
  endereco jsonb,
  tamanhos_preferidos text[],
  observacoes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index idx_clientes_whatsapp_norm on clientes(whatsapp_normalizado) where whatsapp_normalizado is not null;
create index idx_clientes_nome_trgm on clientes using gin (nome gin_trgm_ops);

-- ============ CLOSETS ============
create table closets (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'open' check (tipo in ('open', 'closed')),
  split_closet numeric(5,2) not null default 60 check (split_closet between 0 and 100),
  whatsapp text,
  instagram text,
  observacoes text,
  ativa boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ PEÇAS ============
create table pecas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,             -- preserva o padrão legado: INICIAIS+AAMM+seq (ex: BR2502020)
  slug text unique not null,
  closet_id uuid not null references closets(id) on delete restrict,
  titulo text not null,
  descricao text,
  categoria text,
  tamanho text,
  marca text,
  cor text,
  estado_conservacao text,
  composicao text,
  medidas jsonb,
  preco_original numeric(10,2) not null,
  preco numeric(10,2) not null,
  drop_atual text not null default 'drop_01' check (drop_atual in ('drop_01', 'drop_02', 'desapego_final')),
  fotos text[] not null,
  -- status ampliado: cobre devolução ao consignante e peça danificada, além do fluxo normal
  status text not null default 'disponivel'
    check (status in ('disponivel','reservada','vendida','arquivada','devolvida','danificada')),
  reservada_para uuid references clientes(id) on delete set null,
  reservada_ate timestamptz,
  -- split vigente NO MOMENTO do cadastro desta peça específica (herda do closet, ver trigger abaixo);
  -- resolve o caso real de closets com histórico de splits diferentes ao longo do tempo
  split_closet numeric(5,2) check (split_closet between 0 and 100),
  origem_cadastro text default 'manual' check (origem_cadastro in ('manual','automatico')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_pecas_closet_id on pecas(closet_id);
create index idx_pecas_reservada_para on pecas(reservada_para) where reservada_para is not null;
create index idx_pecas_status_disp on pecas(status) where status = 'disponivel';
create index idx_pecas_reservada_expira on pecas(reservada_ate) where status = 'reservada';
create index idx_pecas_categoria_tam on pecas(categoria, tamanho) where status = 'disponivel';

-- peça nova herda o split da peça mais recente do mesmo closet; se não houver histórico, usa o default do closet
create or replace function pecas_default_split() returns trigger language plpgsql as $$
begin
  if new.split_closet is null then
    select split_closet into new.split_closet from pecas
      where closet_id = new.closet_id order by created_at desc limit 1;
    if new.split_closet is null then
      select split_closet into new.split_closet from closets where id = new.closet_id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_pecas_default_split before insert on pecas
  for each row execute function pecas_default_split();

-- ============ VENDAS ============
create table vendas (
  id uuid primary key default gen_random_uuid(),
  peca_id uuid not null references pecas(id) on delete restrict,
  cliente_id uuid not null references clientes(id) on delete restrict,
  preco_final numeric(10,2) not null,
  -- copiado de pecas.split_closet (o split vigente daquela peça), NUNCA de closets.split_closet
  -- (que é só um default e pode já ter mudado desde o cadastro da peça)
  split_closet_aplicado numeric(5,2) not null,
  valor_repasse numeric(10,2) generated always as (round(preco_final * split_closet_aplicado / 100, 2)) stored,
  valor_comissao numeric(10,2) generated always as (preco_final - round(preco_final * split_closet_aplicado / 100, 2)) stored,
  forma_pagamento text,
  canal text default 'whatsapp',
  status_entrega text default 'pendente' check (status_entrega in ('pendente','enviada','entregue','retirada')),
  repasse_status text not null default 'pendente' check (repasse_status in ('pendente', 'pago')),
  repasse_pago_em timestamptz,
  data_venda timestamptz default now(),
  observacoes text
);
create index idx_vendas_peca_id on vendas(peca_id);
create index idx_vendas_cliente_id on vendas(cliente_id);
create index idx_vendas_data_venda on vendas(data_venda);
create index idx_vendas_repasse_pend on vendas(repasse_status) where repasse_status = 'pendente';

-- ============ PAGAMENTO DE REPASSE EM LOTE (você paga vários closets de uma vez, cobrindo várias vendas) ============
create table repasses_pagamentos (
  id uuid primary key default gen_random_uuid(),
  closet_id uuid not null references closets(id),
  valor_total numeric(10,2) not null,
  pago_em timestamptz not null default now(),
  observacoes text
);
create table repasses_pagamentos_vendas (
  repasse_pagamento_id uuid not null references repasses_pagamentos(id) on delete cascade,
  venda_id uuid not null references vendas(id),
  primary key (repasse_pagamento_id, venda_id)
);

-- ============ AUDITORIA (histórico de status e de split) ============
create table pecas_status_historico (
  id bigint generated always as identity primary key,
  peca_id uuid not null references pecas(id) on delete cascade,
  status_anterior text, status_novo text not null,
  alterado_por uuid references auth.users(id),
  alterado_em timestamptz not null default now()
);
create table pecas_split_historico (
  id bigint generated always as identity primary key,
  peca_id uuid not null references pecas(id) on delete cascade,
  split_anterior numeric(5,2), split_novo numeric(5,2) not null,
  alterado_por uuid references auth.users(id),
  alterado_em timestamptz not null default now()
);
-- TODO ao implementar: trigger "after update of status on pecas" e "after update of split_closet on pecas"
-- preenchendo essas duas tabelas automaticamente.

-- ============ updated_at automático ============
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_clientes_updated before update on clientes for each row execute function set_updated_at();
create trigger trg_closets_updated  before update on closets  for each row execute function set_updated_at();
create trigger trg_pecas_updated    before update on pecas    for each row execute function set_updated_at();

-- ============ VIEWS ============
-- security_invoker: a view respeita as permissões de quem consulta, não do owner (evita vazamento
-- de colunas sensíveis de closets caso alguém exponha a tabela sem querer no futuro)
create view v_catalogo with (security_invoker = true) as
  select
    p.*,
    case when c.tipo = 'open' then c.nome else 'Anônimo' end as closet_nome,
    c.tipo as closet_tipo
  from pecas p
  join closets c on c.id = p.closet_id
  where p.status = 'disponivel'
  order by p.created_at desc;

create view v_financeiro_closets as
  select c.id, c.nome, c.split_closet,
    count(v.id) as total_vendas,
    coalesce(sum(v.preco_final), 0) as faturamento_total,
    coalesce(sum(v.valor_repasse), 0) as total_repasse,
    coalesce(sum(v.valor_comissao), 0) as total_comissao,
    coalesce(sum(case when v.repasse_status = 'pendente' then v.valor_repasse else 0 end), 0) as repasse_pendente
  from closets c
  left join pecas p on p.closet_id = c.id
  left join vendas v on v.peca_id = p.id
  group by c.id, c.nome, c.split_closet;

-- NOVA: série mensal, faltava no schema original — é o relatório que o negócio de fato consulta
create view v_financeiro_mensal as
  select date_trunc('month', v.data_venda) as mes,
    c.id as closet_id, c.nome,
    count(v.id) as total_vendas,
    sum(v.preco_final) as gmv,
    sum(v.valor_repasse) as total_repasse,
    sum(case when v.repasse_status='pendente' then v.valor_repasse else 0 end) as repasse_pendente
  from vendas v
  join pecas p on p.id = v.peca_id
  join closets c on c.id = p.closet_id
  group by 1,2,3 order by 1 desc;

create view v_clientes_resumo as
  select c.*, count(v.id) as total_compras,
    coalesce(sum(v.preco_final), 0) as total_gasto,
    max(v.data_venda) as ultima_compra
  from clientes c
  left join vendas v on v.cliente_id = c.id
  group by c.id;

-- ============ RLS — implementada de fato (não apenas descrita) ============
alter table closets  enable row level security;
alter table pecas    enable row level security;
alter table clientes enable row level security;
alter table vendas   enable row level security;
alter table repasses_pagamentos enable row level security;
alter table repasses_pagamentos_vendas enable row level security;
alter table pecas_status_historico enable row level security;
alter table pecas_split_historico enable row level security;

revoke all on closets, pecas, clientes, vendas from anon;

-- site público: só pode ler peças disponíveis
create policy pecas_select_publica on pecas for select to anon using (status = 'disponivel');
-- site público: colunas específicas de closets (NUNCA whatsapp/observacoes/split_closet), via v_catalogo
grant select (id, nome, tipo) on closets to anon;
create policy closets_select_publica on closets for select to anon using (true);
grant select on v_catalogo to anon;

-- admin autenticado: acesso total
create policy pecas_admin_all    on pecas    for all to authenticated using (true) with check (true);
create policy closets_admin_all  on closets  for all to authenticated using (true) with check (true);
create policy clientes_admin_all on clientes for all to authenticated using (true) with check (true);
create policy vendas_admin_all   on vendas   for all to authenticated using (true) with check (true);
```

**Nota sobre o futuro (não implementar agora, só deixar espaço):** se a ideia de múltiplos negócios/tenants no mesmo sistema saiu do papel algum dia, valeria adicionar uma coluna `tenant_id` com default fixo desde o início — é uma migração destrutiva se adicionada depois. Da mesma forma, `gen_random_uuid()` (UUIDv4) fragmenta índice conforme a base cresce; trocar por UUIDv7 é mais barato de decidir agora do que depois. Nenhum dos dois é urgente no volume atual (~1.352 peças).

---

## 4. Patches de segurança imediatos no GAS (fazer AGORA, antes/independente da migração)

O GAS continua em produção real por 4-6 semanas — os achados críticos merecem correção mínima já, não esperar a migração:

1. **XSS**: criar uma função `escapeHtml()` no `Admin.html` e aplicá-la em todo template literal que insere `desc`, `marca`, `closet`, `texto`, `tag` etc. vindos do backend em `innerHTML`. Ou trocar `innerHTML` por `textContent` onde não precisa de HTML de fato.
2. **Injeção de fórmula**: antes de qualquer `setValue`/`setValues` com string vinda de input externo (`createPiece`, `registrarVenda`, `registrarVendaDireta`, `updateFields`, `renameCloset`), prefixar com apóstrofo se a string começar com `=`, `+`, `-` ou `@`.
3. **`deleteByCodigo`**: exigir parâmetro `statusEsperado` e comparar contra o `Status` real da linha antes de `clearContent()` — nunca apagar incondicionalmente, e nunca apagar peça com `Status = Pago`.
4. **Senha única**: no mínimo, logar (numa aba `LOG` simples) quem/quando cada action destrutiva/de escrita foi chamada, já que separar tokens dá mais trabalho do que vale a pena a essa altura da migração.

---

## 5. Roadmap de migração (incremental — o negócio não pode parar de vender)

0. **Patches de segurança** (§4) — 1-2 dias, sem dependência do resto.
1. **Setup Supabase** com o schema corrigido (§3) + script de seed que importa ESTOQUE → `closets`/`pecas`/`clientes`, normalizando `Compradora` (agrupar por valor exato primeiro, sem dedupe automático agressivo — mesma cautela que já estava em `PLANO-GESTAO.md` Fase 3) e preservando o código legado (`BR2502020` etc.) como `codigo`. Sheets continua sendo a fonte de verdade.
2. **Espelho read-only**: painel financeiro (`v_financeiro_mensal`, `v_financeiro_closets`) roda em cima do Supabase importado — ganho rápido e de baixo risco, é a Fase 2 que devia ter saído do papel, só que no lugar certo.
3. **Cadastro de peça nova nasce no Supabase**; um job sincroniza de volta pro Sheets pra não quebrar site/relatórios antigos durante a transição. Menor risco: sem histórico financeiro em jogo.
4. **Site público** passa a ler `v_catalogo` do Supabase em vez do CSV com cache de 5min.
5. **Venda + repasse migram** na data D. Sheets vira export/backup, não mais fonte de verdade.
6. **CRM completo de compradoras** liberado (`/admin/clientes`): busca, perfil, histórico, segmentação por tamanho/categoria preferida — construído sobre `v_clientes_resumo`.
7. **Só então** avaliar o bot de WhatsApp — recomendação: API oficial (Meta Cloud API), não a não-oficial, dado que aqui ele seria canal real de vendas em produção, não um experimento.

---

## 6. O que NÃO fazer

- Não implementar Fase 2/3 de `PLANO-GESTAO.md` no GAS — retrabalho.
- Não recodificar os 1.352 códigos existentes — preservar como histórico/rastreabilidade com o closet.
- Não decidir/implementar multi-tenant agora — só deixar a porta aberta (nota da §3).
- Não conectar o bot de WhatsApp antes da etapa 5 do roadmap estar completa.

## 7. Decisões pendentes do Henrique

- Aprovar o congelamento de features no GAS (aplicar só os patches de segurança do §4).
- Quem/quando executa a migração (presumivelmente você mesmo com Claude Code) e em que ritmo (o roadmap é sequencial, não precisa ser rápido).
- Confirmar API oficial vs não-oficial de WhatsApp — a recomendação técnica aqui é oficial, mas essa decisão já estava em aberto por outro motivo (custo/setup) e continua sua.
- Migrar o projeto pra conta Claude da Luiza — decidir se isso acontece antes ou depois da migração de stack (mais simples depois, já que muda a base toda).
