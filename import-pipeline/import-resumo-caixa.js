// Lê o PDF "Detalhamento de Caixa" (exportado via impressão/Salvar como PDF do
// iComanda, já que o botão de export .xls desse relatório específico está com
// bug e sempre gera um arquivo vazio) e grava o resumo oficial do mês
// (Comandas, Pessoas, Ticket Médio etc. — todos os canais, não só Salão) em
// ca_resumo_caixa.
//
// Depende do poppler (comando `pdftotext`): `brew install poppler` no Mac.
//
// Uso: node import-resumo-caixa.js <arquivo.pdf>

const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ Uso: node import-resumo-caixa.js <arquivo.pdf>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não estão definidas. Crie .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function extractNumber(str) {
  if (!str) return null;
  // Tira qualquer coisa que não seja dígito/vírgula/ponto/sinal (o PDF tem
  // glifos de ícone invisíveis do site espalhados pelo texto extraído).
  const cleaned = str.replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Acha a primeira linha, dentro de até `lookahead` linhas depois do cabeçalho,
// que bate com `valueRegex` — ignora linhas em branco/lixo (ícones) no meio.
function valueAfterHeader(lines, headerRegex, valueRegex, lookahead = 6) {
  const hi = lines.findIndex(l => headerRegex.test(l));
  if (hi === -1) return null;
  for (let j = hi + 1; j < Math.min(hi + 1 + lookahead, lines.length); j++) {
    const m = lines[j].match(valueRegex);
    if (m) return m;
  }
  return null;
}

console.log(`📂 Lendo PDF: ${filePath}`);
// Só a 1ª página tem o resumo que precisamos — evita pegar data errada lá na
// listagem de movimentações (dezenas de páginas) por engano.
const page1 = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '1', filePath, '-'], { encoding: 'utf8' });
const lines = page1.split('\n');

const dates = page1.match(/\d{1,2}\/\d{1,2}\/\d{2}\b/g);
const periodo = (() => {
  if (!dates || dates.length === 0) return null;
  const [, mes, ano] = dates[dates.length - 1].split('/');
  const mi = parseInt(mes, 10) - 1;
  if (mi < 0 || mi > 11) return null;
  return `${MESES_ABREV[mi]}/${ano}`;
})();

if (!periodo) {
  console.error('❌ Não consegui achar o período (datas de abertura/fechamento) na 1ª página do PDF.');
  process.exit(1);
}

const comandasPessoas = valueAfterHeader(lines, /Comandas\s+Pessoas/, /(\d[\d.,]*)\s+(\d[\d.,]*)/);
const ticket = valueAfterHeader(lines, /Ticket Médio\s+Ticket por Pessoa/, /R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/);
const ocupacao = valueAfterHeader(lines, /Ocupação por Mesa\s+Faturamento por Mesa/, /([\d.,]+)\s*%\s+R\$\s*([\d.,]+)/);
const totalLine = lines.find(l => /Total Faturado/.test(l));
const totalMatch = totalLine && totalLine.match(/R\$\s*([\d.,]+)/);

const resumo = {
  periodo,
  comandas: comandasPessoas ? extractNumber(comandasPessoas[1]) : null,
  pessoas: comandasPessoas ? extractNumber(comandasPessoas[2]) : null,
  ticket_medio: ticket ? extractNumber(ticket[1]) : null,
  ticket_pessoa: ticket ? extractNumber(ticket[2]) : null,
  ocupacao_mesa: ocupacao ? extractNumber(ocupacao[1]) : null,
  faturamento_mesa: ocupacao ? extractNumber(ocupacao[2]) : null,
  total_faturado: totalMatch ? extractNumber(totalMatch[1]) : null
};

console.log('\n📊 Extraído do PDF:');
console.log(JSON.stringify(resumo, null, 2));

if (resumo.comandas == null || resumo.pessoas == null) {
  console.error('\n❌ Não consegui extrair Comandas/Pessoas do PDF — formato pode ter mudado. Nada foi gravado.');
  process.exit(1);
}

(async () => {
  const { error } = await supabase.from('ca_resumo_caixa').upsert(resumo, { onConflict: 'periodo' });
  if (error) {
    console.error('❌ Erro ao gravar ca_resumo_caixa:', error.message);
    process.exit(1);
  }
  console.log(`\n✅ ca_resumo_caixa: período ${periodo} gravado.`);
})();
