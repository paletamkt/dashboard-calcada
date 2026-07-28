# Calçada Alta — Dashboard Operacional

Dashboard estático (HTML + CSS + JS) que lê dados do Supabase através de uma Cloudflare Pages Function própria — o navegador nunca fala direto com o Supabase nem vê nenhuma chave.

## Hospedagem

Cloudflare Pages + GitHub. Push no branch `main` = deploy automático (frontend + Function).

## Estrutura

- `index.html`, `style.css`, `app.js` — dashboard (dividido em arquivos separados para facilitar edição)
- `functions/api/[table].js` — Cloudflare Pages Function que faz proxy das leituras pro Supabase usando a `service_role key` guardada como secret no Cloudflare (nunca vai pro Git nem pro navegador)
- `import-pipeline/` — scripts Node.js para importar exports do iComanda (.xlsx) para o Supabase

## Schema das tabelas Supabase

### `ca_turno`
| coluna | tipo |
|---|---|
| data | DATE |
| semana | TEXT |
| turno | TEXT |
| usuario | TEXT |
| faturado | DECIMAL |
| custo | DECIMAL |
| servico | DECIMAL |
| margem | DECIMAL |
| comandas | INTEGER |
| pessoas | INTEGER |
| obs | TEXT |

### `ca_grupos`
| coluna | tipo |
|---|---|
| nome | TEXT |
| qtd | INTEGER |
| faturado | DECIMAL |
| custo | DECIMAL |
| margem | DECIMAL |
| periodo | TEXT |

### `ca_horario`
| coluna | tipo |
|---|---|
| hora | INTEGER (0-23) |
| faturado | DECIMAL |
| periodo | TEXT |

### `ca_atendente`
| coluna | tipo |
|---|---|
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
| periodo | TEXT |

### `ca_produtos`
| coluna | tipo |
|---|---|
| nome | TEXT |
| qtd | INTEGER |
| faturado | DECIMAL |
| custo | DECIMAL |
| custo_pct | DECIMAL |
| margem | DECIMAL |
| margem_pct | DECIMAL |
| periodo | TEXT |

### `ca_comandas`
| coluna | tipo |
|---|---|
| nome | TEXT |
| qtd_pedidos | INTEGER |
| total | DECIMAL |
| ticket_medio | DECIMAL |
| participacao | DECIMAL |
| periodo | TEXT |

### `ca_notas`
| coluna | tipo |
|---|---|
| mes | TEXT |
| tipo | TEXT |
| titulo | TEXT |
| conteudo | TEXT |
| ativo | BOOLEAN |

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

Ver [import-pipeline/README](import-pipeline/) — ou diretamente:

```bash
cd import-pipeline
npm install
cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_KEY
node index.js caminho/para/export.xlsx
```
