# Calçada Alta — Dashboard Operacional

Dashboard estático (HTML + CSS + JS) que lê dados do Supabase através de uma Cloudflare Pages Function própria — o navegador nunca fala direto com o Supabase nem vê nenhuma chave.

## Hospedagem

Cloudflare Pages + GitHub. Push no branch `main` = deploy automático (frontend + Function).

## Estrutura

- `index.html`, `style.css`, `app.js` — dashboard (dividido em arquivos separados para facilitar edição)
- `functions/api/[table].js` — Cloudflare Pages Function que faz proxy das leituras pro Supabase usando a `service_role key` guardada como secret no Cloudflare (nunca vai pro Git nem pro navegador)
- `import-pipeline/` — scripts Node.js para importar exports do iComanda (.xlsx) para o Supabase

## Schema das tabelas Supabase

Confirmado direto no banco (via `/api/<tabela>`), não é um schema teórico.

### `ca_turno`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| caixa | INTEGER |
| data | DATE |
| semana | TEXT |
| turno | TEXT |
| tipo | TEXT |
| usuario | TEXT |
| faturado | DECIMAL |
| custo | DECIMAL |
| servico | DECIMAL |
| comandas | INTEGER |
| pessoas | INTEGER |
| ticket_medio | DECIMAL |
| created_at | TIMESTAMP |

### `ca_grupos`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| periodo | TEXT |
| qtd | INTEGER |
| nome | TEXT |
| faturado | DECIMAL |
| custo | DECIMAL |
| margem_val | DECIMAL |
| margem_pct | DECIMAL |
| created_at | TIMESTAMP |

### `ca_horario`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| periodo | TEXT |
| hora | INTEGER (0-23) |
| faturado | DECIMAL |
| created_at | TIMESTAMP |

### `ca_atendente`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| periodo | TEXT |
| nome | TEXT |
| r_comanda | DECIMAL |
| r_produto | DECIMAL |
| r_taxa | DECIMAL |
| r_desconto | DECIMAL |
| r_total | DECIMAL |
| comandas | INTEGER |
| produtos | INTEGER |
| ticket_medio | DECIMAL |
| ticket_pessoa | DECIMAL |
| created_at | TIMESTAMP |

### `ca_produtos`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| periodo | TEXT |
| qtd | INTEGER |
| nome | TEXT |
| faturado | DECIMAL |
| custo | DECIMAL |
| custo_pct | DECIMAL |
| margem | DECIMAL |
| fat_pct | DECIMAL |
| created_at | TIMESTAMP |

### `ca_comandas`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| periodo | TEXT |
| nome | TEXT |
| qtd_pedidos | INTEGER |
| total | DECIMAL |
| ticket_medio | DECIMAL |
| participacao | DECIMAL |
| created_at | TIMESTAMP |

### `ca_notas`
| coluna | tipo |
|---|---|
| id | INTEGER (PK) |
| contexto | TEXT |
| periodo | TEXT |
| tag | TEXT |
| texto | TEXT |
| ativo | BOOLEAN |
| created_at | TIMESTAMP |

## Arquitetura de dados

```
navegador → GET /api/<tabela> (Cloudflare Pages Function)
                  ↓ (server-side, com service_role key)
              Supabase REST API
```

O `app.js` só chama `/api/<tabela>` no próprio domínio. Quem fala com o Supabase é a
Function em `functions/api/[table].js`, rodando no servidor do Cloudflare — a
`service_role key` fica só lá, como secret, e nunca aparece em nenhum arquivo do
repositório nem no código que chega ao navegador.

A Function:
- só aceita `GET`;
- só permite as 7 tabelas `ca_*` (whitelist fixa no código, qualquer outro nome retorna 404);
- para `ca_notas`, ignora filtros vindos do cliente e sempre aplica `ativo=eq.true&limit=100`.

## Segurança

- **RLS**: as tabelas `ca_*` devem estar com Row Level Security **habilitado e sem
  policy para o role `anon`** — isso bloqueia qualquer acesso direto via REST API com
  a chave pública antiga, mesmo que ela vaze por algum outro meio. A Function usa a
  `service_role key`, que ignora RLS por design, então continua funcionando normalmente.
  Script pra rodar isso no SQL Editor do Supabase:

  ```sql
  alter table ca_turno enable row level security;
  alter table ca_grupos enable row level security;
  alter table ca_horario enable row level security;
  alter table ca_atendente enable row level security;
  alter table ca_produtos enable row level security;
  alter table ca_comandas enable row level security;
  alter table ca_notas enable row level security;
  ```

  **Só rode isso depois de confirmar que a Function (com o secret configurado) já está
  no ar** — senão o dashboard fica sem dados até o deploy novo propagar.

- **Secret no Cloudflare**: a `service_role key` é configurada como secret do projeto
  Pages, nunca commitada:

  ```bash
  npx wrangler pages secret put SUPABASE_URL --project-name dashboard-calcada
  npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name dashboard-calcada
  ```

  Cada comando pede o valor de forma interativa (não fica no histórico do shell).
  A `service_role key` fica em Supabase → Project Settings → API → `service_role secret`.

## Deploy

Qualquer push no branch `main` é publicado automaticamente pelo Cloudflare Pages — não há passo manual de build.

## Import de dados

Testado contra um export real do iComanda (planilha semanal). O mapeamento das
colunas está confirmado e validado.

Existem **dois tipos de export** e o script trata cada um de um jeito, porque as
tabelas do banco têm granularidades diferentes:

- **`ca_turno`** tem uma linha por lançamento diário (`data` + `caixa` como
  identificador único) — pode ser importado toda semana sem problema, os dados
  só se somam ao longo do tempo.
- **`ca_grupos`, `ca_horario`, `ca_atendente`, `ca_produtos`, `ca_comandas`**
  guardam só um total por **mês** (ex: `Abr/26`), sem granularidade semanal —
  se importar um export semanal nelas, o total do mês vira só a última semana
  importada (sobrescreve, não soma). **Só importe essas tabelas com um
  relatório mensal fechado**, no fim do mês.

O script exige que você escolha o modo explicitamente, pra não ter erro por
distração:

```bash
cd import-pipeline
npm install

# 1. sempre confira antes com dry-run (não grava nada, não precisa de .env)
node index.js caminho/para/export.xlsx --dry-run

# 2. export SEMANAL — grava só ca_turno
cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
node index.js caminho/para/export_semanal.xlsx --turno-only

# 3. relatório MENSAL FECHADO (fim do mês) — grava tudo
node index.js caminho/para/relatorio_mensal.xlsx --monthly
```

`ca_turno` usa `caixa` como chave de upsert (parece ser o identificador único do
lançamento no iComanda, mas isso não foi confirmado contra a constraint real do
banco — se rodar o mesmo arquivo duas vezes e aparecerem linhas duplicadas, essa
é a causa mais provável).
