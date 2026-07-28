const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const isDryRun = process.argv.includes('--dry-run');
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
function findSheet(workbook, name) {
  const target = name.normalize('NFC');
  const found = workbook.SheetNames.find(n => n.normalize('NFC') === target);
  return found ? workbook.Sheets[found] : undefined;
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
    .filter(row => row['Nome'])
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

// ===== MAIN =====

function preview(label, rows, n = 3) {
  console.log(`\n--- ${label} (${rows.length} linhas, mostrando até ${n}) ---`);
  console.log(JSON.stringify(rows.slice(0, n), null, 2));
}

async function importFromExcel(filePath, { dryRun }) {
  console.log(`📂 Lendo arquivo: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  console.log(`📋 Abas encontradas: ${workbook.SheetNames.join(', ')}`);

  const turnoData = processTurno(workbook);
  const gruposData = processGrupos(workbook);
  const horarioData = processHorario(workbook);
  const atendenteData = processAtendente(workbook);
  const produtosData = processProdutos(workbook);
  const comandasData = processComandas(workbook);

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

  console.log(`\n📤 Fazendo upsert no Supabase...`);

  // IMPORTANTE: onConflict só evita duplicata se existir uma UNIQUE/PRIMARY KEY
  // constraint no banco cobrindo exatamente essas colunas — não confirmei isso
  // contra o projeto Supabase real (sem acesso de SQL a ele). 'caixa' parece ser
  // o identificador único de cada lançamento do iComanda em ca_turno; validar
  // antes de rodar em produção, ou o import pode gerar linhas duplicadas.
  //
  // ATENÇÃO — tabelas por período (ca_grupos, ca_horario, ca_atendente, ca_produtos,
  // ca_comandas) são agregadas por (nome/hora, periodo) onde periodo é o MÊS
  // ("Abr/26"), não a semana. Rodar este import com um export SEMANAL faz o
  // upsert SOBRESCREVER o registro do mês inteiro com os totais só daquela
  // semana — não soma. Não rode em produção com arquivos semanais até resolver
  // essa questão (ver conversa com o usuário / README).
  await upsertTable('ca_turno', turnoData, 'caixa');
  await upsertTable('ca_grupos', gruposData, 'nome,periodo');
  await upsertTable('ca_horario', horarioData, 'hora,periodo');
  await upsertTable('ca_atendente', atendenteData, 'nome,periodo');
  await upsertTable('ca_produtos', produtosData, 'nome,periodo');
  if (comandasData.length > 0) {
    await upsertTable('ca_comandas', comandasData, 'nome,periodo');
  }

  console.log(`\n✅ Import completo!`);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePath = args.find(a => !a.startsWith('--'));

if (!filePath) {
  console.error('❌ Uso: node index.js <caminho-do-arquivo.xlsx> [--dry-run]');
  process.exit(1);
}

importFromExcel(filePath, { dryRun })
  .catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  });
