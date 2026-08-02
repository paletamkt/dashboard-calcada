const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// ===== ARGUMENTOS =====

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const turnoOnly = args.includes('--turno-only');
const monthly = args.includes('--monthly');
const filePath = args.find(a => !a.startsWith('--'));

const USAGE = `Uso:
  node index.js <arquivo.xlsx> --dry-run       # confere os dados, não grava nada
  node index.js <arquivo.xlsx> --turno-only    # export SEMANAL: grava só ca_turno (seguro toda semana)
  node index.js <arquivo.xlsx> --monthly       # relatório MENSAL FECHADO: grava tudo`;

if (!filePath) {
  console.error(`❌ ${USAGE}`);
  process.exit(1);
}

if (!isDryRun && !turnoOnly && !monthly) {
  console.error(`❌ Escolha explicitamente --turno-only (export semanal) ou --monthly (fechamento do mês).\n${USAGE}`);
  process.exit(1);
}

if (turnoOnly && monthly) {
  console.error('❌ Use --turno-only OU --monthly, não os dois.');
  process.exit(1);
}

// ===== SUPABASE =====

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Precisa da service_role key (não a anon) — as tabelas ca_* têm RLS habilitado
// sem policy para o role anon, então a anon key não consegue mais escrever nelas.
if (!isDryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não estão definidas. Crie .env');
  process.exit(1);
}

const supabase = isDryRun ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ===== FUNÇÕES DE NORMALIZAÇÃO =====
// Testadas contra um export real do iComanda (planilha semanal, abr/2026).

function parsePortugueseDate(dateStr) {
  // "19/04/26" -> "2026-04-19"
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.trim().split('/');
  if (!day || !month || !year) return null;
  const fullYear = 2000 + parseInt(year, 10);
  const d = new Date(fullYear, parseInt(month, 10) - 1, parseInt(day, 10));
  return d.toISOString().split('T')[0];
}

function normalizeInteger(value) {
  // "94,00" -> 94, "3.126,00" -> 3126, 79 -> 79 (vírgula é decimal, ponto é milhar — padrão BR)
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Math.round(value);
  let v = String(value).trim();
  if (v.includes(',')) {
    v = v.replace(/\./g, '').replace(',', '.');
  }
  const num = parseFloat(v);
  return isNaN(num) ? null : Math.round(num);
}

function normalizeHour(decimal) {
  // fração de dia do Excel: 0.375 -> 9, 0.5 -> 12, 0.75 -> 18
  const num = parseFloat(decimal);
  if (isNaN(num)) return null;
  return Math.round(num * 24);
}

function normalizeCurrency(value) {
  // "R$ 12.066,69" -> 12066.69, "15.737,44" -> 15737.44, "81,00" -> 81
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  let v = String(value).replace(/[^0-9,.\-]/g, '').trim();
  if (v.includes(',')) {
    v = v.replace(/\./g, '').replace(',', '.');
  }
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

function normalizePercent(value) {
  // "32,23%" ou "0,00 %" -> 32.23 / 0
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const v = String(value).replace('%', '').replace(/\./g, '').replace(',', '.').trim();
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

// Separa células que vêm com valor e percentual juntos, ex: "29.284,30 - 32,23%"
function splitValueAndPercent(value) {
  if (value == null) return { val: null, pct: null };
  const [valPart, pctPart] = String(value).split(' - ');
  return { val: normalizeCurrency(valPart), pct: normalizePercent(pctPart) };
}

// ===== PROCESSAMENTO DE ABAS =====
// Todas as abas têm uma linha de título (ex: "Grupo de Produtos - 13/04/26 - 09:56 - 19/04/26 - 16:31")
// antes do cabeçalho de verdade — por isso o `range: 1` (pula a linha 0).

// Comparação por nome normalizado: o Excel/iComanda pode salvar acentos (ex: "Horário")
// numa forma de composição Unicode diferente da string literal no código, o que quebra
// um lookup direto por chave (workbook.Sheets['Horário'] retornava undefined).
// O nome da ABA varia de forma inconsistente entre exports do iComanda (fica
// truncado em 31 caracteres pelo Excel, às vezes é renomeado pelo usuário,
// às vezes fica com um nome genérico tipo "Sheet1"). O título real, estável,
// está sempre na célula A1 da própria aba — é isso que usamos pra identificar
// qual aba é qual, não o nome da aba.
const SHEET_KEYWORDS = {
  'Turno': ['exportarcontrolshop', 'controlshop'],
  'Grupo de Produtos': ['grupodeprodutos'],
  'Horário': ['horario'],
  'Por Atendente': ['poratendente'],
  'Resumo de Produtos': ['resumodeprodutos'],
  'Tipos de Comandas': ['tiposdecomandas']
};

function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findSheet(workbook, canonicalName) {
  const keywords = SHEET_KEYWORDS[canonicalName] || [normalizeText(canonicalName)];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const title = normalizeText(sheet['A1']?.v || sheetName);
    if (keywords.some(k => title.includes(k))) return sheet;
  }
  return undefined;
}

function extractPeriodFromHeader(sheet) {
  const header = sheet['A1']?.v || '';
  const dates = String(header).match(/\d{1,2}\/\d{1,2}\/\d{2}/g);
  if (!dates || dates.length === 0) return null;
  const [, month, year] = dates[dates.length - 1].split('/'); // usa a data final do período
  const mi = parseInt(month, 10) - 1;
  if (mi < 0 || mi > 11) return null;
  return `${MESES_ABREV[mi]}/${year}`;
}

function processTurno(workbook) {
  const sheet = findSheet(workbook, 'Turno');
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });

  return data
    .filter(row => row['Data'])
    .map(row => {
      const faturado = normalizeCurrency(row['R$ Faturado']);
      const comandas = normalizeInteger(row['Comandas']);
      return {
        caixa: normalizeInteger(row['Caixa']),
        data: parsePortugueseDate(row['Data']),
        semana: row['Semana'],
        turno: row['Turno'],
        tipo: row['Tipo'] || null,
        usuario: row['Usuario'],
        faturado,
        custo: normalizeCurrency(row['R$ Custo']),
        servico: normalizeCurrency(row['R$ Serviço']),
        comandas,
        pessoas: normalizeInteger(row['Pessoas']),
        ticket_medio: comandas ? Math.round((faturado / comandas) * 100) / 100 : null
      };
    })
    .filter(row => row.data && row.turno);
}

function processGrupos(workbook) {
  const sheet = findSheet(workbook, 'Grupo de Produtos');
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome'])
    .map(row => {
      const { val: margem_val, pct: margem_pct } = splitValueAndPercent(row['Margem']);
      return {
        nome: row['Nome'],
        qtd: normalizeInteger(row['Qtd.']),
        faturado: normalizeCurrency(row['Faturado']),
        custo: normalizeCurrency(row['Custo']),
        margem_val,
        margem_pct,
        periodo: period
      };
    })
    .filter(row => row.nome);
}

function processHorario(workbook) {
  const sheet = findSheet(workbook, 'Horário');
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 1 });
  const period = extractPeriodFromHeader(sheet);

  return rows
    .filter(row => typeof row[0] === 'number')
    .map(row => ({
      hora: normalizeHour(row[0]),
      faturado: normalizeCurrency(row[2]),
      periodo: period
    }))
    .filter(row => row.hora !== null);
}

function processAtendente(workbook) {
  const sheet = findSheet(workbook, 'Por Atendente');
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome'] && !/^totai?s$/i.test(String(row['Nome']).trim()))
    .map(row => ({
      nome: row['Nome'],
      r_comanda: normalizeCurrency(row['R$ Comanda']),
      r_produto: normalizeCurrency(row['R$ Produto']),
      r_taxa: normalizeCurrency(row['R$ Taxa']),
      r_desconto: normalizeCurrency(row['R$ Desconto']),
      r_total: normalizeCurrency(row['R$ Total']),
      comandas: normalizeInteger(row['Comandas']),
      produtos: normalizeInteger(row['Produtos']),
      ticket_medio: normalizeCurrency(row['Ticket Médio']),
      ticket_pessoa: normalizeCurrency(row['Ticket Pessoa']),
      periodo: period
    }))
    .filter(row => row.nome);
}

function processProdutos(workbook) {
  const sheet = findSheet(workbook, 'Resumo de Produtos');
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome'])
    .map(row => ({
      nome: row['Nome'],
      qtd: normalizeInteger(row['QTD']),
      faturado: normalizeCurrency(row['R$ Faturado']),
      custo: normalizeCurrency(row['R$ Custo']),
      custo_pct: normalizePercent(row['% Custo']),
      margem: normalizeCurrency(row['R$ Margem']),
      fat_pct: normalizePercent(row['%']),
      periodo: period
    }))
    .filter(row => row.nome);
}

function processComandas(workbook) {
  const sheet = findSheet(workbook, 'Tipos de Comandas');
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome']) // descarta a linha de total (Nome vazio)
    .map(row => ({
      nome: row['Nome'],
      qtd_pedidos: normalizeInteger(row['Qtd. Pedidos']),
      total: normalizeCurrency(row['Total R$']),
      ticket_medio: normalizeCurrency(row['Ticket Médio R$']),
      participacao: normalizePercent(row['%']),
      periodo: period
    }))
    .filter(row => row.nome);
}

// ===== UPSERT =====

async function upsertTable(tableName, data, conflictColumn) {
  if (!data || data.length === 0) return;

  const { error } = await supabase
    .from(tableName)
    .upsert(data, { onConflict: conflictColumn })
    .select();

  if (error) {
    console.error(`❌ Erro ao fazer upsert em ${tableName}:`, error);
    throw error;
  }

  console.log(`✅ ${tableName}: ${data.length} registros`);
}

// ca_grupos/horario/atendente/produtos/comandas não têm constraint UNIQUE
// (nome/hora, periodo) — já existem duplicatas históricas de cargas antigas
// (anteriores a este pipeline) que impedem criar essa constraint, e por
// decisão do usuário esse histórico não vai ser mexido agora. Em vez de
// upsert, cada import SUBSTITUI as linhas do(s) período(s) presentes no
// arquivo por completo (apaga e reinsere) — seguro rodar toda semana ou todo
// mês, sem duplicar e sem depender da constraint. Só mexe nos períodos do
// próprio arquivo — não toca no histórico de outros meses.
async function replaceForPeriods(tableName, data) {
  if (!data || data.length === 0) return;

  const periodos = [...new Set(data.map(d => d.periodo).filter(Boolean))];
  if (periodos.length > 0) {
    const { error: delError } = await supabase.from(tableName).delete().in('periodo', periodos);
    if (delError) {
      console.error(`❌ Erro ao limpar ${tableName} antes de reinserir:`, delError);
      throw delError;
    }
  }

  const { error } = await supabase.from(tableName).insert(data).select();
  if (error) {
    console.error(`❌ Erro ao inserir em ${tableName}:`, error);
    throw error;
  }

  console.log(`✅ ${tableName}: ${data.length} registros (período ${periodos.join(', ')} substituído)`);
}

// ===== NOTAS AUTOMÁTICAS =====
// Só roda em --monthly (mês fechado, dado confiável) — em --turno-only os
// números ainda são parciais e gerariam insight enganoso ("queda de 80%"
// só porque só metade do mês foi importada).

function fmtBRL(v) {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function previousLabelOf(label) {
  const [mes, ano] = label.split('/');
  let mi = MESES_ABREV.indexOf(mes) - 1;
  let anoNum = 2000 + parseInt(ano, 10);
  if (mi < 0) { mi = 11; anoNum -= 1; }
  return `${MESES_ABREV[mi]}/${String(anoNum).slice(2)}`;
}

async function generateNotas(periodoAtual) {
  const prevPeriodo = previousLabelOf(periodoAtual);
  const notas = [];

  // 1. Crescimento/queda de faturamento vs. mês anterior (ca_comandas = fonte oficial)
  const { data: comandasAtual } = await supabase.from('ca_comandas').select('total').eq('periodo', periodoAtual);
  const { data: comandasPrev } = await supabase.from('ca_comandas').select('total').eq('periodo', prevPeriodo);
  const totalAtual = (comandasAtual || []).reduce((s, d) => s + (Number(d.total) || 0), 0);
  const totalPrev = (comandasPrev || []).reduce((s, d) => s + (Number(d.total) || 0), 0);
  if (totalAtual > 0 && totalPrev > 0) {
    const delta = (totalAtual - totalPrev) / totalPrev * 100;
    notas.push({
      contexto: 'ceo', periodo: periodoAtual,
      tag: delta >= 0 ? 'destaque' : 'alerta',
      texto: `${delta >= 0 ? 'Crescimento' : 'Queda'} de ${Math.abs(delta).toFixed(1)}% em relação a ${prevPeriodo}. Faturamento ${fmtBRL(totalAtual)}.`,
      origem: 'auto', ativo: true
    });
  }

  // 2. Atendente destaque do mês
  const { data: atendentesMes } = await supabase.from('ca_atendente').select('nome,r_total,comandas').eq('periodo', periodoAtual);
  if (atendentesMes && atendentesMes.length > 0) {
    const top = [...atendentesMes].sort((a, b) => (Number(b.r_total) || 0) - (Number(a.r_total) || 0))[0];
    notas.push({
      contexto: 'atendente', periodo: periodoAtual, tag: 'destaque',
      texto: `${top.nome} lidera em faturamento no mês — ${fmtBRL(top.r_total)} em ${top.comandas} comandas.`,
      origem: 'auto', ativo: true
    });
  }

  // 3. Produto destaque do mês
  const { data: produtosMes } = await supabase.from('ca_produtos').select('nome,faturado,qtd').eq('periodo', periodoAtual);
  if (produtosMes && produtosMes.length > 0) {
    const top = [...produtosMes].sort((a, b) => (Number(b.faturado) || 0) - (Number(a.faturado) || 0))[0];
    notas.push({
      contexto: 'produtos', periodo: periodoAtual, tag: 'destaque',
      texto: `${top.nome} foi o produto mais vendido do mês — ${fmtBRL(top.faturado)} faturados em ${top.qtd} unidades.`,
      origem: 'auto', ativo: true
    });
  }

  if (notas.length === 0) {
    console.log('ℹ️  Notas automáticas: nada gerado (sem mês anterior ou dados insuficientes pra comparar).');
    return;
  }

  // Remove só as notas AUTOMÁTICAS desse período antes de regravar — nunca
  // toca em notas 'manual' escritas por vocês.
  const { error: delError } = await supabase.from('ca_notas').delete().match({ periodo: periodoAtual, origem: 'auto' });
  if (delError) {
    console.error('⚠️  Não consegui limpar notas automáticas antigas (import em si já terminou):', delError.message);
    return;
  }
  const { error } = await supabase.from('ca_notas').insert(notas);
  if (error) {
    console.error('⚠️  Não consegui gravar notas automáticas (import em si já terminou):', error.message);
    return;
  }
  console.log(`✅ ca_notas: ${notas.length} notas automáticas geradas pra ${periodoAtual}`);
}

// ===== MAIN =====

function preview(label, rows, n = 3) {
  console.log(`\n--- ${label} (${rows.length} linhas, mostrando até ${n}) ---`);
  console.log(JSON.stringify(rows.slice(0, n), null, 2));
}

async function logImport({ filePath, mode, periodos, contagens, sucesso, erro }) {
  const { error } = await supabase.from('ca_import_log').insert({
    arquivo: filePath.split('/').pop(),
    modo: mode,
    periodos,
    contagens,
    sucesso,
    erro: erro || null
  });
  if (error) console.error('⚠️  Não consegui gravar o log de importação (o import em si funcionou):', error.message);
}

async function importFromExcel(filePath, { dryRun, mode }) {
  console.log(`📂 Lendo arquivo: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  console.log(`📋 Abas encontradas: ${workbook.SheetNames.join(', ')}`);

  const turnoData = processTurno(workbook);
  const gruposData = processGrupos(workbook);
  const horarioData = processHorario(workbook);
  const atendenteData = processAtendente(workbook);
  const produtosData = processProdutos(workbook);
  const comandasData = processComandas(workbook);

  const contagens = {
    ca_turno: turnoData.length,
    ca_grupos: gruposData.length,
    ca_horario: horarioData.length,
    ca_atendente: atendenteData.length,
    ca_produtos: produtosData.length,
    ca_comandas: comandasData.length
  };
  const periodos = [...new Set([...gruposData, ...comandasData].map(d => d.periodo).filter(Boolean))];

  console.log(`\n📊 Dados processados:
  - Turno: ${turnoData.length}
  - Grupos: ${gruposData.length}
  - Horário: ${horarioData.length}
  - Atendentes: ${atendenteData.length}
  - Produtos: ${produtosData.length}
  - Comandas: ${comandasData.length}`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN — nada será enviado ao Supabase.');
    preview('ca_turno', turnoData);
    preview('ca_grupos', gruposData);
    preview('ca_horario', horarioData);
    preview('ca_atendente', atendenteData);
    preview('ca_produtos', produtosData);
    preview('ca_comandas', comandasData);
    return;
  }

  try {
    console.log(`\n📤 Fazendo upsert no Supabase (modo: ${mode})...`);

    // ca_turno tem granularidade diária de verdade (coluna 'data' + 'caixa' como
    // identificador único do lançamento) — seguro pra importar toda semana.
    await upsertTable('ca_turno', turnoData, 'caixa');

    // ca_comandas é pequena (poucas linhas por mês) e usada pro card de canais
    // (Salão/Delivery) do topo do dashboard — atualiza toda vez, mesmo em
    // --turno-only, pra esse card não ficar desatualizado ao longo do mês.
    await replaceForPeriods('ca_comandas', comandasData);

    if (mode === 'turno-only') {
      console.log(`\n✅ Import completo (ca_turno + ca_comandas — as outras tabelas por período não foram tocadas)!`);
      await logImport({ filePath, mode, periodos, contagens, sucesso: true });
      return;
    }

    // As tabelas abaixo são agregadas por (nome/hora, periodo) onde periodo é o
    // MÊS ("Abr/26"), não a semana — só rodar com um relatório MENSAL FECHADO do
    // iComanda (--monthly), nunca com um export semanal, ou o import sobrescreve
    // o mês inteiro com os totais parciais daquela semana.
    await replaceForPeriods('ca_grupos', gruposData);
    await replaceForPeriods('ca_horario', horarioData);
    await replaceForPeriods('ca_atendente', atendenteData);
    await replaceForPeriods('ca_produtos', produtosData);

    if (periodos.length === 1) {
      await generateNotas(periodos[0]);
    } else if (periodos.length > 1) {
      console.log(`ℹ️  Notas automáticas: pulei porque o arquivo cobre mais de um período (${periodos.join(', ')}).`);
    }

    console.log(`\n✅ Import completo!`);
    await logImport({ filePath, mode, periodos, contagens, sucesso: true });
  } catch (err) {
    await logImport({ filePath, mode, periodos, contagens, sucesso: false, erro: err.message });
    throw err;
  }
}

importFromExcel(filePath, { dryRun: isDryRun, mode: turnoOnly ? 'turno-only' : 'monthly' })
  .catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  });
