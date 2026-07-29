const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Nome da aba esperado por index.js -> palavras-chave pra achar o arquivo baixado do iComanda.
// Os nomes de arquivo reais do iComanda ainda não foram confirmados — se o matching abaixo
// não achar um relatório, ajuste as palavras-chave depois de ver os nomes reais em ~/Downloads.
const REPORT_MAP = {
  'Turno': ['turno', 'abertura', 'caixa'],
  'Grupo de Produtos': ['grupo de produtos', 'grupo_de_produtos', 'grupoprodutos'],
  'Horário': ['horario', 'horário'],
  'Por Atendente': ['atendente'],
  'Resumo de Produtos': ['resumo de produtos', 'resumo_de_produtos', 'resumoprodutos'],
  'Tipos de Comandas': ['tipos de comandas', 'tipos_de_comandas', 'tipocomanda', 'comandas']
};

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findFileFor(files, keywords, used) {
  return files.find(f => {
    if (used.has(f)) return false;
    const n = normalize(f);
    return keywords.some(k => n.includes(normalize(k)));
  });
}

const [, , downloadsDir, label] = process.argv;
if (!downloadsDir) {
  console.error('❌ Uso: node consolidate-xlsx.js <pasta-com-downloads> [label]');
  process.exit(1);
}

const files = fs.readdirSync(downloadsDir).filter(f => f.toLowerCase().endsWith('.xlsx'));
console.log(`📂 Arquivos .xlsx encontrados em ${downloadsDir}:`);
files.forEach(f => console.log(`   - ${f}`));

const outWb = XLSX.utils.book_new();
const missing = [];
const used = new Set();

for (const [canonicalName, keywords] of Object.entries(REPORT_MAP)) {
  const file = findFileFor(files, keywords, used);
  if (!file) {
    missing.push(canonicalName);
    continue;
  }
  used.add(file);
  const wb = XLSX.readFile(path.join(downloadsDir, file));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  XLSX.utils.book_append_sheet(outWb, sheet, canonicalName);
  console.log(`✅ ${canonicalName}  <-  ${file}`);
}

if (missing.length > 0) {
  console.error(`\n❌ Não encontrei arquivo pra: ${missing.join(', ')}`);
  console.error('   Arquivos disponíveis na pasta:', files.length ? files.join(', ') : '(nenhum)');
  console.error('   Ajuste o REPORT_MAP no topo deste script com os nomes reais dos arquivos.');
  process.exit(1);
}

const dateStr = new Date().toISOString().slice(0, 10);
const outName = `consolidado_${label || 'semanal'}_${dateStr}.xlsx`;
const outPath = path.join(downloadsDir, outName);
XLSX.writeFile(outWb, outPath);

console.log(`\n✅ Arquivo consolidado criado: ${outPath}`);
console.log(outPath); // última linha: caminho puro, fácil de capturar por script/agente
