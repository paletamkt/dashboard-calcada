// Autenticação via Supabase Auth. A chave abaixo é a "publishable key" — feita
// pra ser pública no navegador (não dá acesso a dado nenhum sozinha; as tabelas
// ca_* só respondem pra Function do Cloudflare, que exige o token de login
// validado + a secret key guardada só no servidor).
const SUPABASE_URL = 'https://aoriwkdpfcxobscqrsol.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SbTu6EctUCLo_ry3AqFT-Q_6VfbOtku';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentSession = null;

function authHeaders() {
  if (window.DEV_MODE) return {};
  return currentSession ? { Authorization: `Bearer ${currentSession.access_token}` } : {};
}
window.authHeaders = authHeaders;

function onAuthExpired() {
  currentSession = null;
  showLogin('Sessão expirada — faça login de novo.');
}
window.onAuthExpired = onAuthExpired;

function el(id) { return document.getElementById(id); }

function showPanel(panel) {
  el('login-form').style.display = panel === 'login' ? 'flex' : 'none';
  el('forgot-form').style.display = panel === 'forgot' ? 'flex' : 'none';
  el('reset-form').style.display = panel === 'reset' ? 'flex' : 'none';
  el('forgot-password-link').style.display = panel === 'login' ? 'block' : 'none';
  el('dev-mode-link').style.display = panel === 'login' ? 'block' : 'none';
}

function showLogin(message) {
  window.DEV_MODE = false;
  el('login-screen').style.display = 'flex';
  el('dashboard-root').style.display = 'none';
  showPanel('login');
  el('login-error').textContent = message || '';
}

function showDashboard() {
  el('login-screen').style.display = 'none';
  el('dashboard-root').style.display = 'block';
}

function doLogout() {
  window.DEV_MODE = false;
  sb.auth.signOut().finally(() => showLogin());
}
window.doLogout = doLogout;

// ===== MODO DESENVOLVEDOR (dados fictícios, sem tocar no Supabase) =====

function generateMockData() {
  const nomes = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Alves'];
  const grupos = ['PRATOS EXECUTIVOS', 'ENTRADAS/PETISCOS', 'SALADAS', 'SOBREMESAS', 'BEBIDAS'];
  const produtos = ['Filé Mock à Parmegiana', 'Bolinho Fictício', 'Salada Teste', 'Suco Demo'];
  const periodo = (typeof currentMonthLabel === 'function') ? currentMonthLabel() : 'Jul/26';
  const hoje = new Date();

  // Cobre ~2.5 meses pra sempre existir pelo menos 1 mês completo (não "parcial"),
  // senão os KPIs que dividem por "meses completos" dão NaN.
  const turno = Array.from({ length: 75 }, (_, i) => {
    const d = new Date(hoje); d.setDate(d.getDate() - i);
    const comandas = 20 + Math.floor(Math.random() * 60);
    const faturado = Math.round((3000 + Math.random() * 12000) * 100) / 100;
    return {
      id: i, caixa: 9000 + i,
      data: d.toISOString().split('T')[0],
      semana: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()],
      turno: ['cafe','almoco','jantar'][i % 3],
      tipo: ['mesa','delivery','balcao'][i % 3],
      usuario: nomes[i % nomes.length],
      faturado, custo: Math.round(faturado * 0.05 * 100) / 100,
      servico: Math.round(faturado * 0.1 * 100) / 100,
      comandas, pessoas: comandas + Math.floor(Math.random() * 30),
      ticket_medio: Math.round((faturado / comandas) * 100) / 100
    };
  });

  const ca_grupos = grupos.map((nome, i) => {
    const faturado = Math.round((2000 + Math.random() * 20000) * 100) / 100;
    const custo = Math.round(faturado * 0.1 * 100) / 100;
    return { id: i, periodo, nome, qtd: 50 + i * 30, faturado, custo, margem_val: faturado - custo, margem_pct: 90 };
  });

  const ca_horario = Array.from({ length: 15 }, (_, i) => ({
    id: i, periodo, hora: 9 + i, faturado: Math.round(Math.random() * 15000 * 100) / 100
  }));

  const ca_atendente = nomes.map((nome, i) => {
    const r_total = Math.round((4000 + Math.random() * 12000) * 100) / 100;
    return {
      id: i, periodo, nome,
      r_comanda: r_total * 0.6, r_produto: r_total * 0.35, r_taxa: r_total * 0.05, r_desconto: 0,
      r_total, comandas: 40 + i * 10, produtos: 150 + i * 40,
      ticket_medio: Math.round((r_total / (40 + i * 10)) * 100) / 100,
      ticket_pessoa: Math.round((r_total / (80 + i * 20)) * 100) / 100
    };
  });

  const ca_produtos = produtos.map((nome, i) => {
    const faturado = Math.round((1000 + Math.random() * 5000) * 100) / 100;
    return { id: i, periodo, nome, qtd: 30 + i * 20, faturado, custo: 0, custo_pct: 0, margem: faturado, fat_pct: 5 + i };
  });

  const ca_comandas = [
    { id: 1, periodo, nome: 'Mesa', qtd_pedidos: 300, total: 60000, ticket_medio: 200, participacao: 70 },
    { id: 2, periodo, nome: 'Delivery', qtd_pedidos: 90, total: 15000, ticket_medio: 166.6, participacao: 20 },
    { id: 3, periodo, nome: 'Balcao', qtd_pedidos: 40, total: 6000, ticket_medio: 150, participacao: 10 }
  ];

  const ca_notas = [
    { id: 1, contexto: 'ceo', periodo: 'geral', tag: 'destaque', texto: '[Dados fictícios] Exemplo de nota de destaque.', ativo: true },
    { id: 2, contexto: 'diasemana', periodo: 'geral', tag: 'observacao', texto: '[Dados fictícios] Exemplo de observação por dia da semana.', ativo: true },
    { id: 3, contexto: 'atendente', periodo: 'geral', tag: 'aviso', texto: '[Dados fictícios] Exemplo de aviso por atendente.', ativo: true }
  ];

  const ca_import_log = [
    { id: 1, created_at: hoje.toISOString(), arquivo: 'export_semanal_fake.xlsx', modo: 'turno-only', periodos: [periodo], contagens: {ca_turno:24}, sucesso: true, erro: null },
    { id: 2, created_at: new Date(hoje-7*86400000).toISOString(), arquivo: 'export_mensal_fake.xlsx', modo: 'monthly', periodos: [periodo], contagens: {ca_turno:30,ca_grupos:24,ca_produtos:260}, sucesso: true, erro: null }
  ];

  return { ca_turno: turno, ca_grupos, ca_horario, ca_atendente, ca_produtos, ca_comandas, ca_notas, ca_import_log };
}

function enableDevMode() {
  window.DEV_MODE = true;
  window.MOCK_DATA = generateMockData();
  showDashboard();
  loadAll();
}

// ===== EVENTOS DE FORMULÁRIO =====

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) el('login-error').textContent = 'Login inválido: ' + error.message;
});

el('toggle-password').addEventListener('click', () => {
  const input = el('login-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

el('toggle-reset-password').addEventListener('click', () => {
  const input = el('reset-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

el('forgot-password-link').addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('forgot');
});

el('back-to-login-link').addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('login');
});

el('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('forgot-email').value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  el('forgot-message').textContent = error
    ? 'Erro: ' + error.message
    : 'Se esse e-mail estiver cadastrado, um link de recuperação foi enviado.';
});

el('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = el('reset-password').value;
  const { error } = await sb.auth.updateUser({ password });
  if (error) { el('reset-message').textContent = 'Erro: ' + error.message; return; }
  el('reset-message').textContent = 'Senha atualizada!';
  setTimeout(() => { showDashboard(); loadAll(); }, 800);
});

el('dev-mode-link').addEventListener('click', (e) => {
  e.preventDefault();
  enableDevMode();
});

// ===== SESSÃO =====

sb.auth.onAuthStateChange((event, session) => {
  currentSession = session;
  if (event === 'SIGNED_IN') { showDashboard(); loadAll(); }
  if (event === 'SIGNED_OUT') { showLogin(); }
  if (event === 'PASSWORD_RECOVERY') { showPanel('reset'); showLogin(); showPanel('reset'); }
});

(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;
  if (session) { showDashboard(); loadAll(); } else { showLogin(); }
})();
