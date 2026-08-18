// Lógica pura de leitura/normalização dos exports do iComanda — sem I/O, sem
// Supabase. Espelha exatamente o import-pipeline/index.js (CLI local) pra que
// o upload pelo dashboard e o import manual produzam o mesmo resultado.
import * as XLSX from 'xlsx';

export const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function parsePortugueseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.trim().split('/');
  if (!day || !month || !year) return null;
  const fullYear = 2000 + parseInt(year, 10);
  const d = new Date(fullYear, parseInt(month, 10) - 1, parseInt(day, 10));
  return d.toISOString().split('T')[0];
}

export function excelSerialToDate(serial) {
  if (serial == null || isNaN(serial)) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(excelEpoch.getTime() + Number(serial) * 86400000);
  return d.toISOString().split('T')[0];
}

export function normalizeDate(value) {
  if (typeof value === 'number') return excelSerialToDate(value);
  if (typeof value === 'string' && !value.includes('/')) return excelSerialToDate(parseFloat(value));
  return parsePortugueseDate(value);
}

export function normalizeInteger(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Math.round(value);
  let v = String(value).trim();
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(v);
  return isNaN(num) ? null : Math.round(num);
}

export function normalizeHour(decimal) {
  const num = parseFloat(decimal);
  if (isNaN(num)) return null;
  return Math.round(num * 24);
}

export function normalizeCurrency(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  let v = String(value).replace(/[^0-9,.\-]/g, '').trim();
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

export function normalizePercent(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const v = String(value).replace('%', '').replace(/\./g, '').replace(',', '.').trim();
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

export function splitValueAndPercent(value) {
  if (value == null) return { val: null, pct: null };
  const [valPart, pctPart] = String(value).split(' - ');
  return { val: normalizeCurrency(valPart), pct: normalizePercent(pctPart) };
}

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

export function findSheet(workbook, canonicalName) {
  const keywords = SHEET_KEYWORDS[canonicalName] || [normalizeText(canonicalName)];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const title = normalizeText(sheet['A1']?.v || sheetName);
    if (keywords.some(k => title.includes(k))) return sheet;
  }
  return undefined;
}

export function extractPeriodFromHeader(sheet) {
  const header = sheet['A1']?.v || '';
  const dates = String(header).match(/\d{1,2}\/\d{1,2}\/\d{2}/g);
  if (!dates || dates.length === 0) return null;
  const [, month, year] = dates[dates.length - 1].split('/');
  const mi = parseInt(month, 10) - 1;
  if (mi < 0 || mi > 11) return null;
  return `${MESES_ABREV[mi]}/${year}`;
}

export function processTurno(workbook) {
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
        data: normalizeDate(row['Data']),
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

export function processGrupos(workbook) {
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

export function processHorario(workbook) {
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

export function processAtendente(workbook) {
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

export function processProdutos(workbook) {
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

export function processComandas(workbook) {
  const sheet = findSheet(workbook, 'Tipos de Comandas');
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json(sheet, { range: 1 });
  const period = extractPeriodFromHeader(sheet);
  return data
    .filter(row => row['Nome'])
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

// Lê o workbook (ArrayBuffer do upload) e processa todas as abas de uma vez.
export function processWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const turno = processTurno(workbook);
  const grupos = processGrupos(workbook);
  const horario = processHorario(workbook);
  const atendente = processAtendente(workbook);
  const produtos = processProdutos(workbook);
  const comandas = processComandas(workbook);
  const periodos = [...new Set([...grupos, ...comandas].map(d => d.periodo).filter(Boolean))];
  return {
    sheetNames: workbook.SheetNames,
    turno, grupos, horario, atendente, produtos, comandas,
    periodos,
    contagens: {
      ca_turno: turno.length, ca_grupos: grupos.length, ca_horario: horario.length,
      ca_atendente: atendente.length, ca_produtos: produtos.length, ca_comandas: comandas.length
    }
  };
}
