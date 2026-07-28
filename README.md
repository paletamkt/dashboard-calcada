# Calçada Alta — Dashboard Operacional

Dashboard estático (HTML único) que lê dados direto do Supabase via REST API (anon key) no navegador, sem backend.

## Hospedagem

Cloudflare Pages + GitHub. Push no branch `main` = deploy automático.

## Estrutura

- `index.html` — arquivo único do dashboard (não deve ser alterado sem necessidade)
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

## Segurança

As tabelas `ca_*` têm RLS desabilitado; o acesso é feito via anon key diretamente do navegador. Não armazene dados sensíveis nessas tabelas.

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
