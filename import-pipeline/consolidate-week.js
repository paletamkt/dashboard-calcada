// Consolida um export SEMANAL isolado (ex.: "21 a 27.09") com o que já existe
// no mês, pra tabelas agregadas por período (ca_comandas/grupos/horario/
// atendente/produtos) que não têm granularidade diária. Necessário sempre que
// o export do iComanda não vier acumulado desde o dia 1 do mês — nesses casos
// rodar index.js --turno-only diretamente SOBRESCREVERIA o mês com só aquela
// semana. ca_turno é seguro de importar direto (upsert por caixa), esse script
// cuida só das tabelas mensais.
//
// uso: node consolidate-week.js <arquivo.xlsx> [--dry-run]
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const proc = require('./processors.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não estão definidas. Crie .env (ou exporte no shell).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const FILE = process.argv[2];
const DRY = process.argv.includes('--dry-run');
if (!FILE) {
  console.error('Uso: node consolidate-week.js <arquivo.xlsx> [--dry-run]');
  process.exit(1);
}
const r2 = n => Math.round(n * 100) / 100;

async function fetchCurrent(table, periodo) {
  const { data, error } = await supabase.from(table).select('*').eq('periodo', periodo);
  if (error) throw error;
  return data;
}

function sumBy(rows, keyFn, init, add) {
  const m = {};
  rows.forEach(r => { const k = keyFn(r); if (!m[k]) m[k] = init(r); add(m[k], r); });
  return Object.values(m);
}
const n = v => Number(v) || 0;

function mergeComandas(cur, novo, periodo) {
  const rows = sumBy([...cur, ...novo], r => r.nome, r => ({ nome: r.nome, qtd_pedidos: 0, total: 0, periodo }),
    (a, r) => { a.qtd_pedidos += n(r.qtd_pedidos); a.total += n(r.total); });
  const g = rows.reduce((s, r) => s + r.total, 0);
  return rows.map(r => ({ ...r, total: r2(r.total), ticket_medio: r.qtd_pedidos ? r2(r.total / r.qtd_pedidos) : 0, participacao: g ? Math.round(r.total / g * 10000) / 10000 : 0 }));
}
function mergeGrupos(cur, novo, periodo) {
  const rows = sumBy([...cur, ...novo], r => r.nome, r => ({ nome: r.nome, qtd: 0, faturado: 0, custo: 0, periodo }),
    (a, r) => { a.qtd += n(r.qtd); a.faturado += n(r.faturado); a.custo += n(r.custo); });
  const g = rows.reduce((s, r) => s + r.faturado, 0);
  return rows.map(r => ({ ...r, faturado: r2(r.faturado), custo: r2(r.custo), margem_val: r2(r.faturado - r.custo), margem_pct: g ? r2(r.faturado / g * 100) : 0 }));
}
function mergeHorario(cur, novo, periodo) {
  return sumBy([...cur, ...novo], r => r.hora, r => ({ hora: r.hora, faturado: 0, periodo }),
    (a, r) => { a.faturado += n(r.faturado); }).map(r => ({ ...r, faturado: r2(r.faturado) }));
}
function mergeAtendente(cur, novo, periodo) {
  return sumBy([...cur, ...novo], r => r.nome,
    r => ({ nome: r.nome, r_comanda: 0, r_produto: 0, r_taxa: 0, r_desconto: 0, r_total: 0, comandas: 0, produtos: 0, _tp: 0, periodo }),
    (a, r) => { ['r_comanda','r_produto','r_taxa','r_desconto','r_total','comandas','produtos'].forEach(k => a[k] += n(r[k])); a._tp += n(r.ticket_pessoa) * n(r.comandas); })
    .map(({ _tp, ...r }) => ({ ...r, r_comanda: r2(r.r_comanda), r_produto: r2(r.r_produto), r_taxa: r2(r.r_taxa), r_desconto: r2(r.r_desconto), r_total: r2(r.r_total),
      ticket_medio: r.comandas ? r2(r.r_total / r.comandas) : 0, ticket_pessoa: r.comandas ? r2(_tp / r.comandas) : 0 }));
}
function mergeProdutos(cur, novo, periodo) {
  const rows = sumBy([...cur, ...novo], r => r.nome, r => ({ nome: r.nome, qtd: 0, faturado: 0, custo: 0, periodo }),
    (a, r) => { a.qtd += n(r.qtd); a.faturado += n(r.faturado); a.custo += n(r.custo); });
  const g = rows.reduce((s, r) => s + r.faturado, 0);
  return rows.map(r => ({ ...r, faturado: r2(r.faturado), custo: r2(r.custo), custo_pct: r.faturado ? r2(r.custo / r.faturado * 100) : 0, margem: r2(r.faturado - r.custo), fat_pct: g ? r2(r.faturado / g * 100) : 0 }));
}

async function replaceForPeriod(table, rows, periodo) {
  const { error: e1 } = await supabase.from(table).delete().eq('periodo', periodo);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from(table).insert(rows);
  if (e2) throw e2;
  console.log(`✅ ${table}: ${rows.length} registros (${periodo})`);
}

async function main() {
  const wb = XLSX.readFile(FILE);
  const turno = proc.processTurno(wb);
  const novo = {
    comandas: proc.processComandas(wb), grupos: proc.processGrupos(wb), horario: proc.processHorario(wb),
    atendente: proc.processAtendente(wb), produtos: proc.processProdutos(wb)
  };
  const periodos = [...new Set(novo.grupos.map(d => d.periodo).filter(Boolean))];
  if (periodos.length !== 1) throw new Error('Arquivo cobre mais de um período: ' + periodos.join(','));
  const periodo = periodos[0];

  // trava anti dupla contagem: se algum caixa do arquivo já existe no banco, a semana já foi importada
  const caixas = turno.map(t => t.caixa);
  const { data: ja } = await supabase.from('ca_turno').select('caixa').in('caixa', caixas);
  if (ja.length) throw new Error(`Caixas já existem no banco (${ja.map(x => x.caixa).join(',')}) — semana já importada, abortando pra não duplicar`);

  const cur = {
    comandas: await fetchCurrent('ca_comandas', periodo), grupos: await fetchCurrent('ca_grupos', periodo),
    horario: await fetchCurrent('ca_horario', periodo), atendente: await fetchCurrent('ca_atendente', periodo),
    produtos: await fetchCurrent('ca_produtos', periodo)
  };
  const merged = {
    comandas: mergeComandas(cur.comandas, novo.comandas, periodo), grupos: mergeGrupos(cur.grupos, novo.grupos, periodo),
    horario: mergeHorario(cur.horario, novo.horario, periodo), atendente: mergeAtendente(cur.atendente, novo.atendente, periodo),
    produtos: mergeProdutos(cur.produtos, novo.produtos, periodo)
  };

  console.log(`Período: ${periodo} | turnos novos: ${turno.length}`);
  console.log('ca_comandas consolidado:');
  merged.comandas.forEach(c => console.log(` ${c.nome}: ${c.qtd_pedidos} / R$ ${c.total}`));
  console.log(`grupos ${merged.grupos.length} | horario ${merged.horario.length} | atendente ${merged.atendente.length} | produtos ${merged.produtos.length}`);
  if (DRY) { console.log('DRY RUN — nada gravado'); return; }

  const { error } = await supabase.from('ca_turno').upsert(turno, { onConflict: 'caixa' });
  if (error) throw error;
  console.log(`✅ ca_turno: ${turno.length} registros`);
  await replaceForPeriod('ca_comandas', merged.comandas, periodo);
  await replaceForPeriod('ca_grupos', merged.grupos, periodo);
  await replaceForPeriod('ca_horario', merged.horario, periodo);
  await replaceForPeriod('ca_atendente', merged.atendente, periodo);
  await replaceForPeriod('ca_produtos', merged.produtos, periodo);
  console.log('✅ Consolidação completa');
}
main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
