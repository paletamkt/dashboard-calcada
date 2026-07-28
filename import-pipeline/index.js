const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_KEY não estão definidas. Crie .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== FUNÇÕES DE NORMALIZAÇÃO =====

function excelSerialToDate(serial) {
  // Excel epoch: 1/1/1900 = serial 1
  if (!serial || isNaN(serial)) return null;
  const excelEpoch = new Date(1900, 0, 1);
  const date = new Date(excelEpoch.getTime() + (serial - 2) * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

function parsePortugueseDate(dateStr) {
  // "28/02/26" -> "2026-02-28"
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.trim().split('/');
  if (!day || !month || !year) return null;
  const fullYear = 2000 + parseInt(year);
  const d = new Date(fullYear, parseInt(month) - 1, parseInt(day));
  return d.toISOString().split('T')[0];
}

function normalizeDate(value) {
  if (typeof value === 'number' || (typeof value === 'string' && !value.includes('/'))) {
    return excelSerialToDate(parseFloat(value));
  }
  return parsePortugueseDate(value);
}

function normalizeInteger(value) {
  // "47.0" -> 47, "3126,00" -> 3126, "47" -> 47
  if (typeof value === 'string') {
    value = value.replace(/[.,]/g, '').trim();
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : Math.round(num);
}

function normalizeHour(decimal) {
  // 0.375 -> 9, 0.5 -> 12, 0.75 -> 18
  const num = parseFloat(decimal);
  if (isNaN(num)) return null;
  return Math.round(num * 24);
}

function normalizeCurrency(value) {
  // "1.234,56" -> 1234.56, "1234.56" -> 1234.56
  if (typeof value === 'string') {
    if (value.includes(',')) {
      value = value.replace(/\./g, '').replace(',', '.');
    }
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function normalizePercent(value) {
  // "32,50%" ou "32.50%" -> 32.50
  if (typeof value === 'string') {
    value = value.replace('%', '').replace(/\./g, '').replace(',', '.');
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

// ===== PROCESSAMENTO DE ABAS =====

function extractPeriodFromHeader(sheet) {
  const header = sheet['A1']?.v || sheet['A2']?.v || '';
  const match = header.match(/(\d{1,2}\/\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2})/);
  if (match) {
    const endDate = parsePortugueseDate(match[2]);
    return endDate.substring(0, 7); // YYYY-MM
  }
  return null;
}

function processTurno(workbook) {
  const sheet = workbook.Sheets['Turno'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);

  return data
    .filter(row => row['Data'] || row['data'])
    .map(row => ({
      data: normalizeDate(row['Data'] || row['data']),
      semana: row['Semana'] || row['semana'],
      turno: row['Turno'] || row['turno'],
      usuario: row['Usuario'] || row['usuario'] || row['Usuário'],
      faturado: normalizeCurrency(row['R$ Faturado']),
      custo: normalizeCurrency(row['R$ Custo']),
      servico: normalizeCurrency(row['R$ Serviço']),
      margem: normalizeCurrency(row['R$ Margem']),
      comandas: normalizeInteger(row['Comandas']),
      pessoas: normalizeInteger(row['Pessoas']),
      obs: row['OBS'] || row['obs']
    }))
    .filter(row => row.data && row.turno);
}

function processGrupos(workbook) {
  const sheet = workbook.Sheets['Grupo de Produtos'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome'] || row['nome'])
    .map(row => ({
      nome: row['Nome'] || row['nome'],
      qtd: normalizeInteger(row['Qtd.'] || row['qtd']),
      faturado: normalizeCurrency(row['Faturado']),
      custo: normalizeCurrency(row['Custo']),
      margem: normalizeCurrency(row['Margem']),
      periodo: period
    }))
    .filter(row => row.nome);
}

function processHorario(workbook) {
  const sheet = workbook.Sheets['Horário'];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json(sheet);
  const period = extractPeriodFromHeader(sheet);

  return rows
    .filter(row => {
      const hora = Object.keys(row)[0];
      return hora && hora !== 'Total';
    })
    .map(row => {
      const horaKey = Object.keys(row)[0];
      const faturadoKey = Object.keys(row)[1];
      return {
        hora: normalizeHour(horaKey),
        faturado: normalizeCurrency(row[faturadoKey]),
        periodo: period
      };
    })
    .filter(row => row.hora !== null);
}

function processAtendente(workbook) {
  const sheet = workbook.Sheets['Por Atendente'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  const period = extractPeriodFromHeader(sheet);

  return data
    .filter(row => row['Nome'] && row['Nome'] !== 'Totais')
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
  const sheet = workbook.Sheets['Resumo de Produtos'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
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
      margem_pct: normalizePercent(row['%']),
      periodo: period
    }))
    .filter(row => row.nome);
}

function processComandas(workbook) {
  const sheet = workbook.Sheets['Tipos de Comandas'];
  if (!sheet) return [];

  const data = XLSX.utils.sheet_to_json(sheet);
  const period = extractPeriodFromHeader(sheet);

  return data
    .map(row => ({
      nome: row['Nome'] || row['Canal'],
      qtd_pedidos: normalizeInteger(row['Qtd Pedidos']),
      total: normalizeCurrency(row['Total R$']),
      ticket_medio: normalizeCurrency(row['Ticket Médio']),
      participacao: normalizePercent(row['Participação']),
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

async function importFromExcel(filePath) {
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

  console.log(`\n📤 Fazendo upsert no Supabase...`);

  await upsertTable('ca_turno', turnoData, 'data,turno,usuario');
  await upsertTable('ca_grupos', gruposData, 'nome,periodo');
  await upsertTable('ca_horario', horarioData, 'hora,periodo');
  await upsertTable('ca_atendente', atendenteData, 'nome,periodo');
  await upsertTable('ca_produtos', produtosData, 'nome,periodo');
  if (comandasData.length > 0) {
    await upsertTable('ca_comandas', comandasData, 'nome,periodo');
  }

  console.log(`\n✅ Import completo!`);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ Uso: node index.js <caminho-do-arquivo.xlsx>');
  process.exit(1);
}

importFromExcel(filePath)
  .catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  });
