/* =====================================================
   CHECKLIST DA QUALIDADE — ICC Brazil Animal Nutrition
   FRONTEND — SPA em JS puro (sem build), mesmo padrão do sistema de
   Gestão de Armazéns. Fala com o backend Apps Script via fetch().
   Sessão fica só em memória (sem localStorage).
   ===================================================== */

// >>> COLE AQUI A URL DO SEU APPS SCRIPT WEB APP <<<
const API_URL = 'https://script.google.com/macros/s/AKfycbzapb-DouX5q5GN0mqH7jV8uxu3_itDtTeZANDKZqeSbg3uauw4McuXH-a_ffKiCtRa/exec';

const OCORRENCIA_STATUS_LABEL = {
  ABERTA: { label: 'Aberta', cls: 'aberta' },
  EM_ANALISE: { label: 'Em análise', cls: 'tratamento' },
  PROCEDENTE: { label: 'Procedente', cls: 'validacao' },
  NAO_PROCEDENTE: { label: 'Não procedente', cls: 'finalizada' },
  TRATADA: { label: 'Tratada', cls: 'validacao' },
  ENCERRADA: { label: 'Encerrada', cls: 'finalizada' }
};

// Status da Não Conformidade (pendência direcionada aberta pelo Admin)
const NC_STATUS_LABEL = {
  ABERTA: { label: 'Pendente', cls: 'aberta' },
  AGUARDANDO_VALIDACAO: { label: 'Aguardando validação', cls: 'validacao' },
  FINALIZADA: { label: 'Finalizada', cls: 'finalizada' }
};

const CHECKLIST_STATUS_LABEL = {
  PENDENTE_VALIDACAO: { label: 'Pendente', cls: 'aberta' },
  APROVADO: { label: 'Aprovado', cls: 'finalizada' },
  REPROVADO: { label: 'Reprovado', cls: 'validacao' },
  SEM_VALIDACAO: { label: 'Concluído', cls: 'finalizada' }
};

// ------------------------- API -------------------------

async function api(action, payload) {
  if (API_URL.includes('COLE_A_URL')) {
    toast('Configure a API_URL em app.js (veja SETUP.md)', true);
    throw new Error('API_URL não configurada');
  }
  const isRead = action.startsWith('get');
  try {
    let res;
    if (isRead) {
      const qs = new URLSearchParams({ action, ...flattenParams(payload) }).toString();
      res = await fetch(API_URL + '?' + qs);
    } else {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
        body: JSON.stringify({ action, payload })
      });
    }
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
    return json.data;
  } catch (err) {
    toast(err.message || 'Erro de conexão com a planilha', true);
    throw err;
  }
}

function flattenParams(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function (k) {
    if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'object') out[k] = obj[k];
  });
  return out;
}

// ------------------------- STATE -------------------------

const S = {
  usuario: null,      // {ID_USUARIO, NOME, PERFIL}
  screen: 'loginUsuario',
  wizard: null
};

function resetSession() {
  S.usuario = null;
  S.screen = 'loginUsuario';
  S.wizard = null;
  clearTimeout(sessaoTimer);
  document.getElementById('topbar').hidden = true;
  document.getElementById('tabbar').hidden = true;
}

// ------------------------- SESSÃO: LOGOUT AUTOMÁTICO POR INATIVIDADE -------------------------
// Depois de um tempo sem nenhuma interação, encerra a sessão automaticamente
// (medida de segurança para celulares compartilhados/deixados abertos no
// setor). Só entra em ação quando há alguém logado.

let sessaoTimer = null;
const SESSAO_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos de inatividade

function reiniciarTimerSessao() {
  clearTimeout(sessaoTimer);
  if (!S.usuario) return;
  sessaoTimer = setTimeout(function () {
    if (!S.usuario) return;
    resetSession();
    render();
    toast('Sessão encerrada por inatividade. Faça login novamente.', true);
  }, SESSAO_TIMEOUT_MS);
}

['click', 'keydown', 'touchstart'].forEach(function (ev) {
  document.addEventListener(ev, reiniciarTimerSessao, { passive: true });
});

// ------------------------- UI HELPERS -------------------------

const app = document.getElementById('app');

function go(screen, extra) {
  S.screen = screen;
  if (extra) Object.assign(S, extra);
  render();
  reiniciarTimerSessao();
  window.scrollTo(0, 0);
}

function toast(msg, isError, isSuccess) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast is-show' + (isError ? ' is-error' : isSuccess ? ' is-success' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.className = 'toast'; }, 3200);
}

function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function appendHtml(container, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html.trim();
  while (tmp.firstChild) container.appendChild(tmp.firstChild);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Componente reutilizável de captura de foto. Retorna node + getter.
function photoField(container, opts) {
  opts = opts || {};
  const wrap = el('<div class="photo-input"></div>');
  let dataUrl = opts.initial || null;

  function refresh() {
    if (dataUrl) {
      wrap.innerHTML =
        '<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>' +
        '<img class="photo-preview" src="' + dataUrl + '">' +
        '<button type="button" class="btn btn--outline btn--sm" data-role="remove">Remover foto</button>';
      wrap.querySelector('[data-role="remove"]').onclick = function () { dataUrl = null; refresh(); };
    } else {
      wrap.innerHTML =
        '<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>' +
        '<div class="photo-btn' + (opts.required ? ' required' : '') + '" data-role="btn">📷 Toque para adicionar foto' + (opts.required ? ' (obrigatória)' : '') + '</div>' +
        '<input type="file" accept="image/*" capture="environment" style="display:none" data-role="input">';
      wrap.querySelector('[data-role="btn"]').onclick = function () { wrap.querySelector('[data-role="input"]').click(); };
      wrap.querySelector('[data-role="input"]').onchange = async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        dataUrl = await fileToDataUrl(file);
        refresh();
      };
    }
  }
  refresh();
  container.appendChild(wrap);
  return { getValue: function () { return dataUrl; } };
}

function choiceField(container, opts) {
  const cols = opts.columns || 3;
  const wrap = el(
    '<div class="field">' +
      '<label>' + escapeHtml(opts.label) + (opts.required ? ' *' : '') + '</label>' +
      '<div class="option-grid" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
        opts.options.map(function (o, i) { return '<button type="button" class="option-btn' + (o.danger ? ' danger' : '') + '" data-i="' + i + '">' + escapeHtml(o.label) + '</button>'; }).join('') +
      '</div>' +
    '</div>'
  );
  let value = null;
  const btns = wrap.querySelectorAll('.option-btn');
  btns.forEach(function (b, i) {
    b.onclick = function () {
      value = opts.options[i].value;
      btns.forEach(function (x) { x.classList.remove('is-selected'); });
      b.classList.add('is-selected');
      wrap.dispatchEvent(new CustomEvent('change'));
    };
  });
  container.appendChild(wrap);
  return { node: wrap, getValue: function () { return value; } };
}

function textField(container, opts) {
  opts = opts || {};
  const id = 'f_' + Math.random().toString(36).slice(2);
  const tag = opts.multiline ? 'textarea' : 'input';
  const wrap = el(
    '<div class="field">' +
      '<label for="' + id + '">' + escapeHtml(opts.label) + (opts.required ? ' *' : '') + '</label>' +
      '<' + tag + ' id="' + id + '" ' + (opts.type ? 'type="' + opts.type + '"' : '') + ' placeholder="' + escapeHtml(opts.placeholder || '') + '"></' + tag + '>' +
    '</div>'
  );
  container.appendChild(wrap);
  const input = wrap.querySelector(tag);
  if (opts.value) input.value = opts.value;
  return { getValue: function () { return input.value.trim(); }, node: wrap };
}

function screenHeader(eyebrow, title, subtitle) {
  return '<div class="stack" style="gap:4px;margin-bottom:4px">' +
    '<span class="eyebrow">' + escapeHtml(eyebrow) + '</span>' +
    '<h1 class="title-xl">' + escapeHtml(title) + '</h1>' +
    (subtitle ? '<p class="subtle">' + escapeHtml(subtitle) + '</p>' : '') +
    '</div>';
}

function menuCard(icon, title, sub, screen) {
  return '<button type="button" class="list-item" style="width:100%;padding:16px" data-go="' + screen + '">' +
    '<span class="row" style="gap:12px"><span style="font-size:22px">' + icon + '</span>' +
    '<span><span class="list-item__title">' + escapeHtml(title) + '</span>' +
    '<div class="list-item__sub">' + escapeHtml(sub) + '</div></span></span><span>›</span>' +
    '</button>';
}

function bindMenuCards() {
  app.querySelectorAll('[data-go]').forEach(function (b) {
    b.onclick = function () { go(b.dataset.go); };
  });
}

// ------------------------- DATAS -------------------------

function dateToBR(d) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

function parseBR(str) {
  if (!str) return null;
  const parts = String(str).split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}

function periodoRange(tipo) {
  const hoje = new Date();
  if (tipo === 'hoje') {
    return { dataInicial: dateToBR(hoje), dataFinal: dateToBR(hoje) };
  }
  if (tipo === 'semana') {
    const inicio = new Date(hoje);
    const diaSemana = (inicio.getDay() + 6) % 7; // segunda = 0
    inicio.setDate(inicio.getDate() - diaSemana);
    return { dataInicial: dateToBR(inicio), dataFinal: dateToBR(hoje) };
  }
  if (tipo === 'mes') {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { dataInicial: dateToBR(inicio), dataFinal: dateToBR(hoje) };
  }
  return { dataInicial: '', dataFinal: '' };
}

function periodoAnteriorRange(range) {
  const inicio = parseBR(range.dataInicial);
  const fim = parseBR(range.dataFinal);
  if (!inicio || !fim) return null;
  const duracaoMs = fim.getTime() - inicio.getTime();
  const novoFim = new Date(inicio.getTime() - 24 * 60 * 60 * 1000);
  const novoInicio = new Date(novoFim.getTime() - duracaoMs);
  return { dataInicial: dateToBR(novoInicio), dataFinal: dateToBR(novoFim) };
}

function comparativoBadge(atual, anterior, menorEhMelhor) {
  if (anterior === null || anterior === undefined) return '';
  const diff = atual - anterior;
  if (diff === 0) return '<span class="subtle" style="font-size:12.5px">Igual ao período anterior (' + anterior + ')</span>';
  const subiu = diff > 0;
  const bom = menorEhMelhor ? !subiu : subiu;
  const cor = bom ? 'var(--st-finalizada)' : 'var(--st-risco)';
  const seta = subiu ? '▲' : '▼';
  const pct = anterior > 0 ? Math.round(Math.abs(diff) / anterior * 100) + '%' : String(Math.abs(diff));
  return '<span style="font-weight:700;color:' + cor + '">' + seta + ' ' + pct + '</span> <span class="subtle" style="font-size:12.5px">vs período anterior (' + anterior + ')</span>';
}

// ------------------------- BOOT -------------------------

document.getElementById('btnLogout').onclick = function () { resetSession(); render(); };

render();

// ------------------------- ROUTER -------------------------

function render() {
  app.innerHTML = '';
  const screens = {
    loginUsuario: renderLoginUsuario,
    loginSenha: renderLoginSenha,
    loginPin: renderLoginPin,
    agenteHome: renderAgenteHome,
    novoChecklist: renderNovoChecklist,
    meusChecklists: renderMeusChecklists,
    abrirOcorrencia: renderAbrirOcorrencia,
    minhasOcorrencias: renderMinhasOcorrencias,
    historicoAgente: renderHistoricoAgente,
    minhasPendenciasNC: renderMinhasPendenciasNC,
    pendenciaNCDetalheAgente: renderPendenciaNCDetalheAgente,
    adminHome: renderAdminHome,
    painelDia: renderPainelDia,
    validacaoChecklists: renderValidacaoChecklists,
    checklistDetalheAdmin: renderChecklistDetalheAdmin,
    validacaoOcorrencias: renderValidacaoOcorrencias,
    ocorrenciaDetalheAdmin: renderOcorrenciaDetalheAdmin,
    naoConformidade: renderNaoConformidade,
    abrirNaoConformidade: renderAbrirNaoConformidade,
    naoConformidadeDetalheAdmin: renderNaoConformidadeDetalheAdmin,
    gestaoUsuarios: renderGestaoUsuarios,
    usuarioForm: renderUsuarioForm,
    gestaoAtividades: renderGestaoAtividades,
    atividadeForm: renderAtividadeForm,
    gestaoLocais: renderGestaoLocais,
    dashboardHub: renderDashboardHub,
    dashChecklist: renderDashChecklist,
    dashAgenteTurno: renderDashAgenteTurno,
    dashValidacao: renderDashValidacao,
    dashOcorrencias: renderDashOcorrencias,
    dashFotos: renderDashFotos,
    relatorios: renderRelatorios,
    relatorioDetalhe: renderRelatorioDetalhe
  };
  (screens[S.screen] || renderLoginUsuario)();
  updateChrome();
}

function updateChrome() {
  const topbar = document.getElementById('topbar');
  const tabbar = document.getElementById('tabbar');
  if (!S.usuario) {
    topbar.hidden = true;
    tabbar.hidden = true;
    return;
  }
  topbar.hidden = false;
  document.getElementById('topbarUnidade').textContent = 'Checklist da Qualidade';
  document.getElementById('topbarUsuario').textContent = S.usuario.NOME + ' · ' + (S.usuario.PERFIL === 'ADMIN_QUALIDADE' ? 'Administrador' : 'Agente de Limpeza');

  tabbar.hidden = false;
  const tabs = S.usuario.PERFIL === 'ADMIN_QUALIDADE'
    ? [
        { s: 'adminHome', ic: '🏠', label: 'Início' },
        { s: 'validacaoChecklists', ic: '✅', label: 'Checklist' },
        { s: 'validacaoOcorrencias', ic: '⚠️', label: 'Ocorrências' },
        { s: 'naoConformidade', ic: '🔍', label: 'Não Conf.' },
        { s: 'dashboardHub', ic: '📊', label: 'Dashboard' }
      ]
    : [
        { s: 'agenteHome', ic: '🏠', label: 'Início' },
        { s: 'novoChecklist', ic: '🧹', label: 'Checklist' },
        { s: 'abrirOcorrencia', ic: '⚠️', label: 'Ocorrência' },
        { s: 'minhasPendenciasNC', ic: '📌', label: 'Pendências' },
        { s: 'historicoAgente', ic: '🕘', label: 'Histórico' }
      ];
  tabbar.innerHTML = tabs.map(function (t) {
    const isDashGroup = t.s === 'dashboardHub' && S.screen.indexOf('dash') === 0;
    const active = (S.screen === t.s || isDashGroup) ? ' is-active' : '';
    return '<button class="' + active.trim() + '" data-s="' + t.s + '"><span class="ic">' + t.ic + '</span>' + t.label + '</button>';
  }).join('');
  tabbar.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { go(b.dataset.s); };
  });
}

// ------------------------- LOGIN -------------------------

async function renderLoginUsuario() {
  appendHtml(app,
    '<div class="screen" style="padding-top:8vh">' +
      '<div class="login-logo"><img src="logo.png" alt="ICC Brazil" class="mark"></div>' +
      '<h1 class="title-xl" style="text-align:center">Checklist da Qualidade</h1>' +
      '<p class="subtle" style="text-align:center;margin-bottom:8px">ICC Brazil Animal Nutrition · Selecione seu usuário</p>' +
      '<div id="usuariosBlocos"><p class="subtle">Carregando usuários…</p></div>' +
    '</div>'
  );
  try {
    const usuarios = await api('getUsuarios', {});
    const wrap = document.getElementById('usuariosBlocos');
    wrap.innerHTML = '';
    if (!usuarios.length) { wrap.innerHTML = '<p class="subtle">Nenhum usuário ativo cadastrado.</p>'; return; }

    // Dois blocos separados (Agente de Limpeza / Administrador da
    // Qualidade) em vez de uma lista única com todo mundo misturado.
    function bloco(titulo, lista) {
      if (!lista.length) return;
      wrap.appendChild(el('<span class="eyebrow" style="display:block;margin:14px 0 6px">' + escapeHtml(titulo) + '</span>'));
      const card = el('<div class="card stack"></div>');
      wrap.appendChild(card);
      lista.forEach(function (u) {
        const item = el(
          '<button type="button" class="list-item" style="width:100%">' +
            '<span class="list-item__title">' + escapeHtml(u.NOME) + '</span><span>›</span>' +
          '</button>'
        );
        item.onclick = function () {
          if (u.PERFIL === 'ADMIN_QUALIDADE') { go('loginSenha', { pendingUser: u }); }
          else { go('loginPin', { pendingUser: u }); }
        };
        card.appendChild(item);
      });
    }

    bloco('Agente de Limpeza', usuarios.filter(function (u) { return u.PERFIL === 'AGENTE_LIMPEZA'; }));
    bloco('Administrador da Qualidade', usuarios.filter(function (u) { return u.PERFIL === 'ADMIN_QUALIDADE'; }));
  } catch (e) { /* toast já mostrado */ }
}

function renderLoginSenha() {
  const u = S.pendingUser;
  appendHtml(app,
    screenHeader('Login Administrador', u.NOME, 'Digite sua senha para acessar a área da Qualidade') +
    '<div class="card stack">' +
      '<div class="field"><label>Senha</label><input type="password" id="inpSenha" autofocus></div>' +
      '<button class="btn btn--primary btn--block" id="btnEntrar">Entrar</button>' +
      '<button class="btn btn--outline btn--block" id="btnVoltar">← Voltar</button>' +
    '</div>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('loginUsuario'); };
  const btn = document.getElementById('btnEntrar');
  const input = document.getElementById('inpSenha');
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  btn.onclick = async function () {
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const data = await api('loginAdmin', { idUsuario: u.ID_USUARIO, senha: input.value });
      S.usuario = data;
      go('adminHome');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
}

function renderLoginPin() {
  const u = S.pendingUser;
  appendHtml(app,
    screenHeader('Login Agente de Limpeza', u.NOME, 'Digite seu PIN de 4 dígitos') +
    '<div class="card stack">' +
      '<div class="field"><label>PIN</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" id="inpPin" autofocus></div>' +
      '<button class="btn btn--primary btn--block" id="btnEntrar">Entrar</button>' +
      '<button class="btn btn--outline btn--block" id="btnVoltar">← Voltar</button>' +
    '</div>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('loginUsuario'); };
  const btn = document.getElementById('btnEntrar');
  const input = document.getElementById('inpPin');
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  btn.onclick = async function () {
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const data = await api('loginAgente', { idUsuario: u.ID_USUARIO, pin: input.value });
      S.usuario = data;
      go('agenteHome');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
}

// ------------------------- AGENTE: HOME -------------------------

function renderAgenteHome() {
  appendHtml(app,
    screenHeader('Área do agente', 'Olá, ' + S.usuario.NOME) +
    '<div class="stack">' +
      menuCard('🧹', 'Novo checklist', 'Registrar a limpeza de um ambiente', 'novoChecklist') +
      menuCard('⚠️', 'Abrir ocorrência', 'Registrar uma não conformidade encontrada', 'abrirOcorrencia') +
      menuCard('📋', 'Minhas ocorrências', 'Acompanhar as ocorrências que você abriu', 'minhasOcorrencias') +
      menuCard('🕘', 'Histórico', 'Seus checklists e ocorrências anteriores', 'historicoAgente') +
    '</div>'
  );
  bindMenuCards();
}

// ------------------------- AGENTE: NOVO CHECKLIST (wizard) -------------------------

function newChecklistWizard() {
  return { type: 'checklist', step: 'periodicidade', periodicidade: null, turno: null, local: null, ambiente: null };
}

function renderNovoChecklist() {
  if (!S.wizard || S.wizard.type !== 'checklist') S.wizard = newChecklistWizard();
  const w = S.wizard;

  if (w.step === 'periodicidade') {
    appendHtml(app, screenHeader('Novo checklist', 'Qual periodicidade?'));
    const card = el('<div class="card stack"></div>');
    app.appendChild(card);
    [['DIARIO', 'Diário'], ['SEMANAL', 'Semanal'], ['MENSAL', 'Mensal']].forEach(function (p) {
      const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + p[1] + '</span><span>›</span></button>');
      b.onclick = function () { w.periodicidade = p[0]; w.step = 'turno'; render(); };
      card.appendChild(b);
    });
    return;
  }

  if (w.step === 'turno') {
    appendHtml(app, screenHeader('Checklist · ' + periodicidadeLabel(w.periodicidade), 'Qual o turno?'));
    appendHtml(app, '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>');
    document.getElementById('btnVoltar').onclick = function () { w.step = 'periodicidade'; render(); };
    const card = el('<div class="card stack" id="list"><p class="subtle">Carregando…</p></div>');
    app.appendChild(card);
    api('getTurnos', {}).then(function (turnos) {
      card.innerHTML = '';
      turnos.forEach(function (t) {
        const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(t.TURNO) + '</span><span>›</span></button>');
        b.onclick = function () { w.turno = t.TURNO; w.step = 'local'; render(); };
        card.appendChild(b);
      });
    }).catch(function () {});
    return;
  }

  if (w.step === 'local') {
    appendHtml(app, screenHeader('Checklist · ' + w.turno, 'Selecione o local'));
    appendHtml(app, '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>');
    document.getElementById('btnVoltar').onclick = function () { w.step = 'turno'; render(); };
    const card = el('<div class="card stack" id="list"><p class="subtle">Carregando…</p></div>');
    app.appendChild(card);
    api('getLocais', {}).then(function (locais) {
      card.innerHTML = '';
      locais.forEach(function (l) {
        const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(l.LOCAL) + '</span><span>›</span></button>');
        b.onclick = function () { w.local = l.LOCAL; w.step = 'ambiente'; render(); };
        card.appendChild(b);
      });
    }).catch(function () {});
    return;
  }

  if (w.step === 'ambiente') {
    appendHtml(app, screenHeader('Checklist · ' + w.local, 'Selecione o ambiente'));
    appendHtml(app, '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>');
    document.getElementById('btnVoltar').onclick = function () { w.step = 'local'; render(); };
    const card = el('<div class="card stack" id="list"><p class="subtle">Carregando…</p></div>');
    app.appendChild(card);
    api('getAmbientes', { local: w.local }).then(function (ambientes) {
      card.innerHTML = '';
      if (!ambientes.length) { card.innerHTML = '<p class="subtle">Nenhum ambiente cadastrado para este local.</p>'; return; }
      ambientes.forEach(function (a) {
        const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(a.AMBIENTE) + '</span><span>›</span></button>');
        b.onclick = function () { w.ambiente = a.AMBIENTE; w.step = 'itens'; render(); };
        card.appendChild(b);
      });
    }).catch(function () {});
    return;
  }

  if (w.step === 'itens') {
    appendHtml(app, screenHeader('Checklist · ' + periodicidadeLabel(w.periodicidade), w.local + ' · ' + w.ambiente + ' · ' + w.turno));
    appendHtml(app, '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>');
    document.getElementById('btnVoltar').onclick = function () { w.step = 'ambiente'; render(); };

    const card = el('<div class="card stack" id="itensCard"><p class="subtle">Carregando atividades…</p></div>');
    app.appendChild(card);

    api('getAtividades', { local: w.local, ambiente: w.ambiente, periodicidade: w.periodicidade, turno: w.turno }).then(function (atividades) {
      card.innerHTML = '';
      if (!atividades.length) {
        card.appendChild(el('<p class="subtle">Nenhuma atividade configurada para este local/ambiente/periodicidade/turno.</p>'));
        return;
      }

      const refs = atividades.map(function (a) {
        const box = el('<div class="stack" style="padding-bottom:14px;border-bottom:1px solid var(--line)"></div>');
        card.appendChild(box);
        box.appendChild(el('<strong>' + escapeHtml(a.ATIVIDADE) + '</strong>'));

        const resultado = choiceField(box, {
          label: 'Situação', columns: 3, required: true,
          options: [
            { value: 'CONFORME', label: 'Conforme' },
            { value: 'NAO_CONFORME', label: 'Não conforme', danger: true },
            { value: 'NAO_SE_APLICA', label: 'Não se aplica' }
          ]
        });

        const extraWrap = el('<div class="stack" style="display:none"></div>');
        box.appendChild(extraWrap);
        let obsField = null;
        resultado.node.addEventListener('change', function () {
          const naoConforme = resultado.getValue() === 'NAO_CONFORME';
          extraWrap.style.display = naoConforme ? 'flex' : 'none';
          extraWrap.innerHTML = '';
          obsField = null;
          if (naoConforme) {
            obsField = textField(extraWrap, { label: 'Descreva o problema encontrado *', multiline: true });
          }
        });

        let fotoAntes = null, fotoDepois = null;
        if (String(a.FOTO_ANTES).toUpperCase() === 'SIM') {
          fotoAntes = photoField(box, { label: 'Foto ANTES da limpeza *', required: true });
        }
        if (String(a.FOTO_DEPOIS).toUpperCase() === 'SIM') {
          fotoDepois = photoField(box, { label: 'Foto DEPOIS da limpeza *', required: true });
        }

        return {
          atividade: a.ATIVIDADE,
          validate: function () {
            const v = resultado.getValue();
            if (!v) return false;
            if (v === 'NAO_CONFORME' && !(obsField && obsField.getValue())) return false;
            if (fotoAntes && !fotoAntes.getValue()) return false;
            if (fotoDepois && !fotoDepois.getValue()) return false;
            return true;
          },
          build: function () {
            return {
              idAtividade: a.ID_ATIVIDADE,
              atividade: a.ATIVIDADE,
              resultado: resultado.getValue(),
              observacao: obsField ? obsField.getValue() : '',
              fotoAntes: fotoAntes ? fotoAntes.getValue() : null,
              fotoDepois: fotoDepois ? fotoDepois.getValue() : null,
              validacao: a.VALIDACAO
            };
          }
        };
      });

      const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Enviar checklist</button>');
      card.appendChild(btn);
      btn.onclick = async function () {
        const payloadItens = [];
        for (const r of refs) {
          if (!r.validate()) { toast('Preencha corretamente o item "' + r.atividade + '"', true); return; }
          payloadItens.push(r.build());
        }
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await api('createChecklist', {
            turno: w.turno, local: w.local, ambiente: w.ambiente, periodicidade: w.periodicidade,
            idAgente: S.usuario.ID_USUARIO, agente: S.usuario.NOME, itens: payloadItens
          });
          toast('Checklist enviado com sucesso!', false, true);
          S.wizard = null;
          go('agenteHome');
        } catch (e) { btn.disabled = false; btn.textContent = 'Enviar checklist'; }
      };
    }).catch(function () {});
  }
}

function periodicidadeLabel(p) {
  return { DIARIO: 'Diário', SEMANAL: 'Semanal', MENSAL: 'Mensal' }[p] || p;
}

// ------------------------- AGENTE: MEUS CHECKLISTS -------------------------

async function renderMeusChecklists() {
  appendHtml(app, screenHeader('Meus checklists', S.usuario.NOME));
  const wrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(wrap);
  const rows = await api('getChecklists', { idAgente: S.usuario.ID_USUARIO }).catch(function () { return []; });
  renderChecklistsList(wrap, rows);
}

function renderChecklistsList(wrap, rows) {
  wrap.innerHTML = '';
  if (!rows.length) { wrap.appendChild(el('<div class="empty"><span class="ic">🧹</span>Nenhum checklist encontrado.</div>')); return; }
  rows.forEach(function (c) {
    const st = CHECKLIST_STATUS_LABEL[c.STATUS] || { label: c.STATUS, cls: 'aberta' };
    const resultadoIcon = c.RESULTADO === 'NAO_CONFORME' ? '⚠ ' : '';
    wrap.appendChild(el(
      '<div class="list-item" style="width:100%;cursor:default">' +
        '<span><span class="shiplabel">' + escapeHtml(c.ID_CHECKLIST) + '</span>' +
        '<div class="list-item__title" style="margin-top:6px">' + resultadoIcon + escapeHtml(c.ATIVIDADE) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(c.LOCAL) + ' · ' + escapeHtml(c.AMBIENTE) + ' · ' + escapeHtml(c.TURNO) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(c.DATA) + ' ' + escapeHtml(c.HORA) + '</div></span>' +
        '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
      '</div>'
    ));
  });
}

// ------------------------- AGENTE: ABRIR OCORRÊNCIA -------------------------

async function renderAbrirOcorrencia() {
  appendHtml(app, screenHeader('Abrir ocorrência', 'Registrar não conformidade encontrada'));
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const localSel = await selectFieldAsync(card, 'getLocais', 'LOCAL', 'Local');
  const ambienteWrap = el('<div class="field"><label>Ambiente</label><select disabled><option>Selecione o local primeiro…</option></select></div>');
  card.appendChild(ambienteWrap);
  let ambienteSelect = ambienteWrap.querySelector('select');

  // Em vez do agente escolher manualmente um turno, o sistema busca no
  // histórico de checklists quem foi a última pessoa a limpar este
  // local+ambiente e mostra isso — é esse turno/agente que fica marcado
  // como responsável pelo problema encontrado, não quem está relatando.
  const responsavelWrap = el('<div class="card" style="background:var(--paper);display:none"></div>');
  card.appendChild(responsavelWrap);
  let ultimaLimpezaInfo = null;

  async function atualizarResponsavel() {
    if (!localSel.select.value || !ambienteSelect.value) { responsavelWrap.style.display = 'none'; return; }
    responsavelWrap.style.display = 'block';
    responsavelWrap.innerHTML = '<p class="subtle">Buscando última limpeza registrada…</p>';
    const info = await api('getUltimaLimpeza', { local: localSel.select.value, ambiente: ambienteSelect.value }).catch(function () { return null; });
    ultimaLimpezaInfo = info;
    if (info) {
      responsavelWrap.innerHTML =
        '<p class="subtle" style="margin-bottom:4px">Responsável identificado pela última limpeza registrada aqui:</p>' +
        '<div class="row between"><strong>' + escapeHtml(info.agente) + '</strong><span class="tag tag--tratamento">' + escapeHtml(info.turno || 'Turno não informado') + '</span></div>' +
        '<p class="subtle" style="margin-top:4px">Limpeza em ' + escapeHtml(info.data) + ' às ' + escapeHtml(info.hora) + '</p>';
    } else {
      responsavelWrap.innerHTML = '<p class="subtle">Nenhuma limpeza registrada ainda para este local/ambiente — a ocorrência será aberta sem responsável identificado.</p>';
    }
  }

  localSel.select.addEventListener('change', async function () {
    const ambientes = await api('getAmbientes', { local: localSel.select.value }).catch(function () { return []; });
    ambienteWrap.innerHTML = '<label>Ambiente</label><select id="selAmbiente"><option value="">Selecione…</option>' +
      ambientes.map(function (a) { return '<option value="' + escapeHtml(a.AMBIENTE) + '">' + escapeHtml(a.AMBIENTE) + '</option>'; }).join('') + '</select>';
    ambienteSelect = ambienteWrap.querySelector('select');
    ambienteSelect.addEventListener('change', atualizarResponsavel);
    atualizarResponsavel();
  });

  const descricao = textField(card, { label: 'Descrição da não conformidade *', multiline: true, placeholder: 'Descreva o que foi encontrado…' });
  const foto = photoField(card, { label: 'Foto (opcional)' });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Registrar ocorrência</button>');
  card.appendChild(btn);
  btn.onclick = async function () {
    if (!localSel.select.value || !ambienteSelect.value || !descricao.getValue()) {
      toast('Preencha local, ambiente e descrição.', true);
      return;
    }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await api('createOcorrencia', {
        turno: (S.usuario && S.usuario.TURNO) || '', local: localSel.select.value, ambiente: ambienteSelect.value,
        descricao: descricao.getValue(), foto: foto.getValue(),
        idAgente: S.usuario.ID_USUARIO, agente: S.usuario.NOME
      });
      toast('Ocorrência registrada!', false, true);
      go('agenteHome');
    } catch (e) { btn.disabled = false; btn.textContent = 'Registrar ocorrência'; }
  };
}

async function selectFieldAsync(container, action, valueField, label) {
  const wrap = el('<div class="field"><label>' + escapeHtml(label) + '</label><select><option>Carregando…</option></select></div>');
  container.appendChild(wrap);
  const select = wrap.querySelector('select');
  const rows = await api(action, {}).catch(function () { return []; });
  select.innerHTML = '<option value="">Selecione…</option>' + rows.map(function (r) {
    return '<option value="' + escapeHtml(r[valueField]) + '">' + escapeHtml(r[valueField]) + '</option>';
  }).join('');
  return { select: select, node: wrap };
}

// ------------------------- AGENTE: MINHAS OCORRÊNCIAS -------------------------

async function renderMinhasOcorrencias() {
  appendHtml(app, screenHeader('Minhas ocorrências', S.usuario.NOME));
  const wrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(wrap);
  const rows = await api('getOcorrencias', { idAgente: S.usuario.ID_USUARIO }).catch(function () { return []; });
  renderOcorrenciasList(wrap, rows);
}

function renderOcorrenciasList(wrap, rows, onOpen) {
  wrap.innerHTML = '';
  if (!rows.length) { wrap.appendChild(el('<div class="empty"><span class="ic">📭</span>Nenhuma ocorrência encontrada.</div>')); return; }
  rows.forEach(function (o) {
    const st = OCORRENCIA_STATUS_LABEL[o.STATUS] || { label: o.STATUS, cls: 'aberta' };
    const responsavelHtml = o.AGENTE_RESPONSAVEL
      ? '<div class="list-item__sub" style="color:var(--st-risco);font-weight:600;margin-top:2px">Responsável: ' + escapeHtml(o.AGENTE_RESPONSAVEL) + (o.TURNO_RESPONSAVEL ? ' · ' + escapeHtml(o.TURNO_RESPONSAVEL) : '') + '</div>'
      : '<div class="list-item__sub" style="margin-top:2px">Responsável não identificado</div>';
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span>' +
        '<div class="list-item__title">' + escapeHtml(o.LOCAL) + ' — ' + escapeHtml(o.AMBIENTE) + '</div>' +
        '<div class="list-item__sub" style="margin-top:3px">Aberta por <strong>' + escapeHtml(o.AGENTE) + '</strong> · ' + escapeHtml(o.DATA) + ' ' + escapeHtml(o.HORA) + '</div>' +
        responsavelHtml +
        '<div class="shiplabel" style="margin-top:6px">' + escapeHtml(o.ID_OCORRENCIA) + '</div>' +
        '</span>' +
        '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
      '</button>'
    );
    if (onOpen) item.onclick = function () { onOpen(o); };
    else item.style.cursor = 'default';
    wrap.appendChild(item);
  });
}

// ------------------------- AGENTE: HISTÓRICO -------------------------

async function renderHistoricoAgente() {
  appendHtml(app, screenHeader('Histórico', S.usuario.NOME));
  const tabsWrap = el(
    '<div class="filters">' +
      '<button class="btn btn--outline btn--sm is-active" data-tab="checklists">Checklists</button>' +
      '<button class="btn btn--outline btn--sm" data-tab="ocorrencias">Ocorrências</button>' +
      '<button class="btn btn--outline btn--sm" data-tab="naoConformidades">Pendências</button>' +
    '</div>'
  );
  app.appendChild(tabsWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const hist = await api('getHistoricoAgente', { idAgente: S.usuario.ID_USUARIO }).catch(function () { return { checklists: [], ocorrencias: [], naoConformidades: [] }; });

  function showTab(tab) {
    tabsWrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
    if (tab === 'checklists') renderChecklistsList(listWrap, hist.checklists);
    else if (tab === 'ocorrencias') renderOcorrenciasList(listWrap, hist.ocorrencias);
    else renderNCListAgente(listWrap, hist.naoConformidades);
  }
  tabsWrap.querySelectorAll('button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  showTab('checklists');
}

// ------------------------- ADMIN: HOME (painel do dia) -------------------------

async function renderAdminHome() {
  appendHtml(app, screenHeader('Painel da Qualidade', 'Olá, ' + S.usuario.NOME));
  const body = el('<div class="stack" id="body" style="margin-top:4px"><p class="subtle">Carregando resumo do dia…</p></div>');
  app.appendChild(body);

  const painel = await api('getPainelHoje', {}).catch(function () { return null; });
  body.innerHTML = '';
  if (painel) {
    const card = el('<button type="button" class="card stack" style="width:100%;text-align:left;cursor:pointer"></button>');
    card.appendChild(el('<div class="row between"><h3 class="title-lg">Hoje · ' + escapeHtml(painel.data) + '</h3><span>›</span></div>'));
    card.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(painel.total, 'Previstas') +
        kpi(painel.realizados, 'Realizadas') +
        kpi(painel.pendentes, 'Pendentes') +
      '</div>'
    ));
    card.appendChild(el('<span class="subtle">Toque para ver o detalhe do que ainda falta hoje</span>'));
    card.onclick = function () { go('painelDia'); };
    body.appendChild(card);
  }

  appendHtml(app, '<div class="stack" style="margin-top:14px">' +
    menuCard('✅', 'Validar checklists', 'Aprovar ou reprovar limpezas enviadas', 'validacaoChecklists') +
    menuCard('⚠️', 'Validar ocorrências', 'Analisar não conformidades relatadas pelos agentes', 'validacaoOcorrencias') +
    menuCard('🔍', 'Não Conformidade', 'Inspecionar um local e direcionar a um agente', 'naoConformidade') +
    menuCard('📊', 'Dashboards', 'Indicadores de limpeza, validação e ocorrências', 'dashboardHub') +
    menuCard('📄', 'Relatórios', 'Exportar dados em CSV ou PDF', 'relatorios') +
  '</div>');
  appendHtml(app, '<div class="stack" style="margin-top:14px">' +
    '<span class="eyebrow">Cadastros</span>' +
    menuCard('👥', 'Usuários', 'Cadastrar, editar e desativar Agentes e Administradores', 'gestaoUsuarios') +
    menuCard('🧾', 'Atividades de limpeza', 'Cadastrar e editar as atividades do checklist', 'gestaoAtividades') +
    menuCard('📍', 'Locais e Ambientes', 'Renomear e ativar/desativar locais e ambientes cadastrados', 'gestaoLocais') +
  '</div>');
  bindMenuCards();
}

// ------------------------- ADMIN: PAINEL DO DIA (detalhe) -------------------------

async function renderPainelDia() {
  appendHtml(app,
    screenHeader('Painel do dia', 'Checklist da Qualidade') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('adminHome'); };

  const body = el('<div class="stack" id="body" style="margin-top:4px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const painel = await api('getPainelHoje', {}).catch(function () { return null; });
  body.innerHTML = '';
  if (!painel) return;

  body.appendChild(el(
    '<div class="kpi-grid">' +
      kpi(painel.total, 'Previstas hoje') +
      kpi(painel.realizados, 'Realizadas') +
      kpi(painel.pendentes, 'Pendentes') +
      kpi(painel.data, 'Data') +
    '</div>'
  ));

  const filterWrap = el(
    '<div class="filters">' +
      '<button class="btn btn--outline btn--sm is-active" data-f="pendentes">Só pendentes</button>' +
      '<button class="btn btn--outline btn--sm" data-f="todas">Todas</button>' +
    '</div>'
  );
  body.appendChild(filterWrap);
  const listCard = el('<div class="card stack"></div>');
  body.appendChild(listCard);

  function showList(filtro) {
    filterWrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.f === filtro); });
    listCard.innerHTML = '';
    const itens = filtro === 'pendentes' ? painel.itens.filter(function (i) { return !i.realizado; }) : painel.itens;
    if (!itens.length) { listCard.appendChild(el('<div class="empty"><span class="ic">✅</span>Nada pendente por aqui.</div>')); return; }
    itens.forEach(function (i) {
      listCard.appendChild(el(
        '<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">' +
          '<span><strong>' + escapeHtml(i.atividade) + '</strong><div class="subtle">' + escapeHtml(i.local) + ' · ' + escapeHtml(i.ambiente) + (i.turno ? ' · ' + escapeHtml(i.turno) : '') + '</div></span>' +
          (i.realizado ? '<span class="tag tag--finalizada">Feito ' + escapeHtml(i.hora) + '</span>' : '<span class="tag tag--aberta">Pendente</span>') +
        '</div>'
      ));
    });
  }
  filterWrap.querySelectorAll('button').forEach(function (b) { b.onclick = function () { showList(b.dataset.f); }; });
  showList('pendentes');
}

// ------------------------- ADMIN: VALIDAÇÃO DE CHECKLISTS -------------------------

async function renderValidacaoChecklists() {
  appendHtml(app, screenHeader('Validação de checklists', 'Checklist da Qualidade'));
  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fStatus">' +
        '<option value="PENDENTE_VALIDACAO">Pendentes</option>' +
        '<option value="APROVADO">Aprovados</option>' +
        '<option value="REPROVADO">Reprovados</option>' +
        '<option value="">Todos os status</option>' +
      '</select>' +
      '<select id="fResultado">' +
        '<option value="">Todos os resultados</option>' +
        '<option value="NAO_CONFORME">Não conforme</option>' +
        '<option value="CONFORME">Conforme</option>' +
      '</select>' +
      '<select id="fLocal"><option value="">Todos os locais</option></select>' +
      '<select id="fTurno"><option value="">Todos os turnos</option></select>' +
      '<select id="fAgente"><option value="">Todos os agentes</option></select>' +
      '<select id="fOrdem">' +
        '<option value="recentes">Mais recentes primeiro</option>' +
        '<option value="antigos">Mais antigos primeiro (FIFO)</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);

  // Preenche os selects de Local/Turno/Agente com as opções cadastradas.
  api('getLocais', {}).then(function (locais) {
    const sel = document.getElementById('fLocal');
    locais.forEach(function (l) { sel.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
  }).catch(function () {});
  api('getTurnos', {}).then(function (turnos) {
    const sel = document.getElementById('fTurno');
    turnos.forEach(function (t) { sel.appendChild(el('<option value="' + escapeHtml(t.TURNO) + '">' + escapeHtml(t.TURNO) + '</option>')); });
  }).catch(function () {});
  api('getUsuariosAdmin', {}).then(function (usuarios) {
    const sel = document.getElementById('fAgente');
    usuarios.filter(function (u) { return u.PERFIL === 'AGENTE_LIMPEZA'; }).forEach(function (u) {
      sel.appendChild(el('<option value="' + escapeHtml(u.ID_USUARIO) + '">' + escapeHtml(u.NOME) + '</option>'));
    });
  }).catch(function () {});

  const selecaoRow = el(
    '<div class="row between" style="margin-top:10px">' +
      '<button type="button" class="btn btn--outline btn--sm" id="btnSelecionar">Selecionar vários</button>' +
      '<span></span>' +
    '</div>'
  );
  app.appendChild(selecaoRow);

  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const aprovarBar = el(
    '<div class="card row between" id="aprovarBar" style="display:none;position:sticky;bottom:70px;margin-top:12px">' +
      '<span id="aprovarBarLabel">0 selecionados</span>' +
      '<button type="button" class="btn btn--primary btn--sm" id="btnAprovarLote">Aprovar selecionados</button>' +
    '</div>'
  );
  app.appendChild(aprovarBar);

  let modoSelecao = false;
  let selecionados = {};

  function atualizarBarraAprovacao() {
    const total = Object.keys(selecionados).filter(function (k) { return selecionados[k]; }).length;
    aprovarBar.style.display = (modoSelecao && total > 0) ? 'flex' : 'none';
    document.getElementById('aprovarBarLabel').textContent = total + ' selecionado' + (total === 1 ? '' : 's');
  }

  document.getElementById('btnSelecionar').onclick = function () {
    modoSelecao = !modoSelecao;
    selecionados = {};
    document.getElementById('btnSelecionar').textContent = modoSelecao ? 'Cancelar seleção' : 'Selecionar vários';
    document.getElementById('btnSelecionar').classList.toggle('is-active', modoSelecao);
    atualizarBarraAprovacao();
    load();
  };

  document.getElementById('btnAprovarLote').onclick = async function () {
    const ids = Object.keys(selecionados).filter(function (k) { return selecionados[k]; });
    if (!ids.length) return;
    const btn = document.getElementById('btnAprovarLote');
    btn.disabled = true; btn.textContent = 'Aprovando…';
    try {
      await api('aprovarChecklistsLote', { idsChecklist: ids, adminValidador: S.usuario.NOME });
      toast(ids.length + ' checklist(s) aprovado(s)!', false, true);
      modoSelecao = false;
      selecionados = {};
      document.getElementById('btnSelecionar').textContent = 'Selecionar vários';
      document.getElementById('btnSelecionar').classList.remove('is-active');
      atualizarBarraAprovacao();
      load();
    } catch (e) { btn.disabled = false; btn.textContent = 'Aprovar selecionados'; }
  };

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    let rows = await api('getChecklists', {
      status: document.getElementById('fStatus').value,
      resultado: document.getElementById('fResultado').value,
      local: document.getElementById('fLocal').value,
      turno: document.getElementById('fTurno').value,
      idAgente: document.getElementById('fAgente').value
    }).catch(function () { return []; });
    if (document.getElementById('fOrdem').value === 'antigos') rows = rows.slice().reverse();
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧹</span>Nenhum checklist encontrado.</div>')); return; }
    rows.forEach(function (c) {
      const st = CHECKLIST_STATUS_LABEL[c.STATUS] || { label: c.STATUS, cls: 'aberta' };
      const resultadoTag = c.RESULTADO === 'NAO_CONFORME' ? '<span style="color:var(--st-risco);font-weight:600">⚠ Não conforme</span>' : '<span style="color:var(--st-finalizada)">✓ Conforme</span>';
      const podeSelecionar = modoSelecao && c.STATUS === 'PENDENTE_VALIDACAO';
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          (podeSelecionar ? '<input type="checkbox" class="chkSelecionar" style="margin-right:10px;width:20px;height:20px" ' + (selecionados[c.ID_CHECKLIST] ? 'checked' : '') + '>' : '') +
          '<span><span class="shiplabel">' + escapeHtml(c.ID_CHECKLIST) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(c.ATIVIDADE) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(c.LOCAL) + ' · ' + escapeHtml(c.AMBIENTE) + ' · ' + escapeHtml(c.AGENTE) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(c.DATA) + ' ' + escapeHtml(c.HORA) + ' · ' + resultadoTag + '</div></span>' +
          '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
        '</button>'
      );
      if (podeSelecionar) {
        const chk = item.querySelector('.chkSelecionar');
        // Clique exatamente na caixinha: deixa o navegador alternar
        // sozinho e só sincroniza o estado (evita alternar duas vezes).
        chk.onclick = function (e) {
          e.stopPropagation();
          selecionados[c.ID_CHECKLIST] = chk.checked;
          atualizarBarraAprovacao();
        };
        // Clique no resto do item: alterna manualmente.
        item.onclick = function () {
          chk.checked = !chk.checked;
          selecionados[c.ID_CHECKLIST] = chk.checked;
          atualizarBarraAprovacao();
        };
      } else {
        item.onclick = function () { go('checklistDetalheAdmin', { checklistAtual: c }); };
      }
      listWrap.appendChild(item);
    });
  }
  ['fStatus', 'fResultado', 'fLocal', 'fTurno', 'fAgente', 'fOrdem'].forEach(function (id) {
    document.getElementById(id).onchange = load;
  });
  load();
}

async function renderChecklistDetalheAdmin() {
  const c = S.checklistAtual;
  appendHtml(app,
    screenHeader('Checklist ' + c.ID_CHECKLIST, c.ATIVIDADE) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('validacaoChecklists'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  card.appendChild(el('<div class="row between"><span class="subtle">Agente</span><strong>' + escapeHtml(c.AGENTE) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Local / Ambiente</span><strong>' + escapeHtml(c.LOCAL) + ' · ' + escapeHtml(c.AMBIENTE) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Turno / Data</span><strong>' + escapeHtml(c.TURNO) + ' · ' + escapeHtml(c.DATA) + ' ' + escapeHtml(c.HORA) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Resultado</span>' + (c.RESULTADO === 'NAO_CONFORME' ? '<strong style="color:var(--st-risco)">Não conforme</strong>' : '<strong>' + escapeHtml(c.RESULTADO) + '</strong>') + '</div>'));
  if (c.OBSERVACAO) card.appendChild(el('<p class="subtle">Obs. do agente: ' + escapeHtml(c.OBSERVACAO) + '</p>'));

  if (c.FOTO_ANTES || c.FOTO_DEPOIS) {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<strong>Evidência fotográfica</strong>'));
    const fotosRow = el('<div class="grid2"></div>');
    card.appendChild(fotosRow);
    fotosRow.appendChild(el('<div class="stack" style="gap:6px"><span class="subtle">ANTES</span>' + (c.FOTO_ANTES ? '<img class="photo-preview" src="' + escapeHtml(c.FOTO_ANTES) + '">' : '<p class="subtle">Sem foto</p>') + '</div>'));
    fotosRow.appendChild(el('<div class="stack" style="gap:6px"><span class="subtle">DEPOIS</span>' + (c.FOTO_DEPOIS ? '<img class="photo-preview" src="' + escapeHtml(c.FOTO_DEPOIS) + '">' : '<p class="subtle">Sem foto</p>') + '</div>'));
  }

  if (c.STATUS !== 'PENDENTE_VALIDACAO') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Já validado por</span><strong>' + escapeHtml(c.ADMIN_VALIDADOR || '-') + '</strong></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Em</span><strong>' + escapeHtml(c.DATA_VALIDACAO || '-') + '</strong></div>'));
    if (c.MOTIVO_REPROVACAO) card.appendChild(el('<p class="subtle">Motivo da reprovação: ' + escapeHtml(c.MOTIVO_REPROVACAO) + '</p>'));
    return;
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Validar</h3></div>');
  app.appendChild(actWrap);
  const row = el('<div class="row" style="gap:10px"></div>');
  actWrap.appendChild(row);
  const btnAprovar = el('<button class="btn btn--primary" style="flex:1">Aprovar</button>');
  const btnReprovar = el('<button class="btn btn--danger" style="flex:1">Reprovar</button>');
  row.appendChild(btnAprovar); row.appendChild(btnReprovar);

  const motivoWrap = el('<div class="stack" style="display:none;margin-top:10px"></div>');
  actWrap.appendChild(motivoWrap);

  btnAprovar.onclick = async function () {
    btnAprovar.disabled = true;
    await api('validarChecklist', { idChecklist: c.ID_CHECKLIST, aprovado: true, adminValidador: S.usuario.NOME });
    toast('Checklist aprovado.', false, true);
    go('validacaoChecklists');
  };

  btnReprovar.onclick = function () {
    motivoWrap.style.display = 'flex';
    motivoWrap.innerHTML = '';
    const motivo = textField(motivoWrap, { label: 'Motivo da reprovação *', multiline: true });
    const refazer = choiceField(motivoWrap, { label: 'Necessário refazer a limpeza?', columns: 2, options: [{ value: true, label: 'Sim' }, { value: false, label: 'Não' }] });
    const btnConfirmar = el('<button class="btn btn--danger btn--block">Confirmar reprovação</button>');
    motivoWrap.appendChild(btnConfirmar);
    btnConfirmar.onclick = async function () {
      if (!motivo.getValue()) { toast('Descreva o motivo da reprovação.', true); return; }
      btnConfirmar.disabled = true; btnConfirmar.textContent = 'Enviando…';
      await api('validarChecklist', {
        idChecklist: c.ID_CHECKLIST, aprovado: false, adminValidador: S.usuario.NOME,
        motivo: motivo.getValue(), refazer: !!refazer.getValue()
      });
      toast('Checklist reprovado.', false, true);
      go('validacaoChecklists');
    };
  };
}

// ------------------------- ADMIN: VALIDAÇÃO DE OCORRÊNCIAS -------------------------

async function renderValidacaoOcorrencias() {
  appendHtml(app, screenHeader('Validação de ocorrências', 'Checklist da Qualidade'));
  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fStatus">' +
        '<option value="ABERTA">Abertas</option>' +
        '<option value="PROCEDENTE">Procedentes</option>' +
        '<option value="NAO_PROCEDENTE">Não procedentes</option>' +
        '<option value="TRATADA">Tratadas</option>' +
        '<option value="ENCERRADA">Encerradas</option>' +
        '<option value="">Todos os status</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const rows = await api('getOcorrencias', { status: document.getElementById('fStatus').value }).catch(function () { return []; });
    renderOcorrenciasList(listWrap, rows, function (o) { go('ocorrenciaDetalheAdmin', { ocorrenciaAtual: o }); });
  }
  document.getElementById('fStatus').onchange = load;
  load();
}

async function renderOcorrenciaDetalheAdmin() {
  const o = S.ocorrenciaAtual;
  appendHtml(app,
    screenHeader('Ocorrência ' + o.ID_OCORRENCIA, o.LOCAL + ' · ' + o.AMBIENTE) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('validacaoOcorrencias'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  card.appendChild(el('<div class="row between"><span class="subtle">Aberta por</span><strong>' + escapeHtml(o.AGENTE) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Data / hora</span><strong>' + escapeHtml(o.DATA) + ' ' + escapeHtml(o.HORA) + '</strong></div>'));
  card.appendChild(el('<p class="subtle">' + escapeHtml(o.DESCRICAO) + '</p>'));
  if (o.FOTO) card.appendChild(el('<img class="photo-preview" src="' + escapeHtml(o.FOTO) + '">'));

  card.appendChild(el('<div class="divider"></div>'));
  if (o.AGENTE_RESPONSAVEL) {
    card.appendChild(el(
      '<div class="stack" style="background:var(--paper);border-radius:var(--radius);padding:10px">' +
        '<span class="subtle">Responsável identificado (última limpeza registrada no local)</span>' +
        '<div class="row between"><strong>' + escapeHtml(o.AGENTE_RESPONSAVEL) + '</strong><span class="tag tag--tratamento">' + escapeHtml(o.TURNO_RESPONSAVEL || '-') + '</span></div>' +
        (o.DATA_ULTIMA_LIMPEZA ? '<span class="subtle">Limpeza em ' + escapeHtml(o.DATA_ULTIMA_LIMPEZA) + '</span>' : '') +
      '</div>'
    ));
  } else {
    card.appendChild(el('<p class="subtle" style="color:var(--st-risco)">Nenhum responsável identificado — não há registro de limpeza para este local/ambiente.</p>'));
  }

  if (o.STATUS !== 'ABERTA' && o.STATUS !== 'EM_ANALISE') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Analisado por</span><strong>' + escapeHtml(o.ADMIN_ANALISE || '-') + '</strong></div>'));
    if (o.OBSERVACAO_ANALISE) card.appendChild(el('<p class="subtle">Obs: ' + escapeHtml(o.OBSERVACAO_ANALISE) + '</p>'));

    const actWrap = el('<div class="card stack"><h3 class="title-lg">Atualizar status</h3></div>');
    app.appendChild(actWrap);
    const row = el('<div class="row" style="gap:10px"></div>');
    actWrap.appendChild(row);
    ['TRATADA', 'ENCERRADA'].forEach(function (statusOpt) {
      const b = el('<button class="btn btn--outline" style="flex:1">' + OCORRENCIA_STATUS_LABEL[statusOpt].label + '</button>');
      b.onclick = async function () {
        await api('atualizarStatusOcorrencia', { idOcorrencia: o.ID_OCORRENCIA, status: statusOpt });
        toast('Status atualizado.', false, true);
        go('validacaoOcorrencias');
      };
      row.appendChild(b);
    });
    return;
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Analisar ocorrência</h3></div>');
  app.appendChild(actWrap);
  const obs = textField(actWrap, { label: 'Observação da análise', multiline: true });
  const row = el('<div class="row" style="gap:10px"></div>');
  actWrap.appendChild(row);
  const btnProcedente = el('<button class="btn btn--primary" style="flex:1">Procedente</button>');
  const btnNaoProcedente = el('<button class="btn btn--outline" style="flex:1">Não procedente</button>');
  row.appendChild(btnProcedente); row.appendChild(btnNaoProcedente);

  function submit(procedente) {
    return async function () {
      await api('validarOcorrencia', { idOcorrencia: o.ID_OCORRENCIA, procedente: procedente, adminAnalise: S.usuario.NOME, observacao: obs.getValue() });
      toast('Ocorrência analisada.', false, true);
      go('validacaoOcorrencias');
    };
  }
  btnProcedente.onclick = submit(true);
  btnNaoProcedente.onclick = submit(false);
}

// ------------------------- ADMIN: NÃO CONFORMIDADE -------------------------
// Diferente de "Ocorrências" (aberta livremente pelo agente), aqui é o
// Administrador que inspeciona o local e já direciona o problema encontrado
// a um Agente de Limpeza específico — funciona como uma pendência.

async function renderNaoConformidade() {
  appendHtml(app, screenHeader('Não Conformidade', 'Inspeção da Qualidade'));
  const btnNova = el('<button class="btn btn--primary btn--block">+ Abrir nova não conformidade</button>');
  app.appendChild(btnNova);
  btnNova.onclick = function () { go('abrirNaoConformidade'); };

  const filterWrap = el(
    '<div class="filters" style="margin-top:12px">' +
      '<select id="fStatus">' +
        '<option value="ABERTA">Pendentes (com agente)</option>' +
        '<option value="AGUARDANDO_VALIDACAO">Aguardando validação</option>' +
        '<option value="FINALIZADA">Finalizadas</option>' +
        '<option value="">Todos os status</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const rows = await api('getNaoConformidades', { status: document.getElementById('fStatus').value }).catch(function () { return []; });
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🔍</span>Nenhuma não conformidade encontrada.</div>')); return; }
    rows.forEach(function (n) {
      const st = NC_STATUS_LABEL[n.STATUS] || { label: n.STATUS, cls: 'aberta' };
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span>' +
          '<div class="list-item__title">' + escapeHtml(n.LOCAL) + ' — ' + escapeHtml(n.AMBIENTE) + '</div>' +
          '<div class="list-item__sub" style="margin-top:3px">Direcionada a <strong>' + escapeHtml(n.AGENTE_RESPONSAVEL) + '</strong></div>' +
          '<div class="list-item__sub">' + escapeHtml(n.DATA) + ' ' + escapeHtml(n.HORA) + ' · aberta por ' + escapeHtml(n.ADMIN_ABRIU) + '</div>' +
          '<div class="shiplabel" style="margin-top:6px">' + escapeHtml(n.ID_NC) + '</div>' +
          '</span>' +
          '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('naoConformidadeDetalheAdmin', { ncAtual: n }); };
      listWrap.appendChild(item);
    });
  }
  document.getElementById('fStatus').onchange = load;
  load();
}

async function renderAbrirNaoConformidade() {
  appendHtml(app,
    screenHeader('Não Conformidade', 'Nova inspeção') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('naoConformidade'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const localSel = await selectFieldAsync(card, 'getLocais', 'LOCAL', 'Local');
  const ambienteWrap = el('<div class="field"><label>Ambiente</label><select disabled><option>Selecione o local primeiro…</option></select></div>');
  card.appendChild(ambienteWrap);
  let ambienteSelect = ambienteWrap.querySelector('select');

  const responsavelWrap = el('<div class="field"><label>Agente responsável *</label><select disabled><option>Selecione local e ambiente primeiro…</option></select></div>');
  card.appendChild(responsavelWrap);
  let responsavelSelect = responsavelWrap.querySelector('select');
  const sugestaoInfo = el('<p class="subtle" style="display:none"></p>');
  card.appendChild(sugestaoInfo);

  const usuarios = await api('getUsuarios', {}).catch(function () { return []; });
  const agentes = usuarios.filter(function (u) { return u.PERFIL === 'AGENTE_LIMPEZA'; });

  async function atualizarResponsavel() {
    if (!localSel.select.value || !ambienteSelect.value) return;
    responsavelWrap.innerHTML = '<label>Agente responsável *</label><select id="selResponsavel"><option value="">Selecione…</option>' +
      agentes.map(function (a) { return '<option value="' + escapeHtml(a.ID_USUARIO) + '">' + escapeHtml(a.NOME) + '</option>'; }).join('') + '</select>';
    responsavelSelect = responsavelWrap.querySelector('select');

    const info = await api('getUltimaLimpeza', { local: localSel.select.value, ambiente: ambienteSelect.value }).catch(function () { return null; });
    if (info) {
      responsavelSelect.value = info.idAgente;
      sugestaoInfo.style.display = 'block';
      sugestaoInfo.textContent = 'Sugestão automática: ' + info.agente + ' foi quem limpou aqui por último (' + info.turno + ', ' + info.data + ' ' + info.hora + '). Pode trocar se necessário.';
    } else {
      sugestaoInfo.style.display = 'block';
      sugestaoInfo.textContent = 'Nenhuma limpeza anterior encontrada aqui — selecione manualmente o responsável.';
    }
  }

  localSel.select.addEventListener('change', async function () {
    const ambientes = await api('getAmbientes', { local: localSel.select.value }).catch(function () { return []; });
    ambienteWrap.innerHTML = '<label>Ambiente</label><select id="selAmbiente"><option value="">Selecione…</option>' +
      ambientes.map(function (a) { return '<option value="' + escapeHtml(a.AMBIENTE) + '">' + escapeHtml(a.AMBIENTE) + '</option>'; }).join('') + '</select>';
    ambienteSelect = ambienteWrap.querySelector('select');
    ambienteSelect.addEventListener('change', atualizarResponsavel);
  });

  const descricao = textField(card, { label: 'Descrição da não conformidade *', multiline: true, placeholder: 'Descreva o que foi encontrado na inspeção…' });
  const foto = photoField(card, { label: 'Foto (opcional)' });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Direcionar ao agente</button>');
  card.appendChild(btn);
  btn.onclick = async function () {
    if (!localSel.select.value || !ambienteSelect.value || !responsavelSelect.value || !descricao.getValue()) {
      toast('Preencha local, ambiente, responsável e descrição.', true);
      return;
    }
    const agenteObj = agentes.find(function (a) { return a.ID_USUARIO === responsavelSelect.value; });
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await api('createNaoConformidade', {
        local: localSel.select.value, ambiente: ambienteSelect.value, descricao: descricao.getValue(), foto: foto.getValue(),
        idAgenteResponsavel: responsavelSelect.value, agenteResponsavel: agenteObj ? agenteObj.NOME : '',
        adminAbriu: S.usuario.NOME
      });
      toast('Não conformidade direcionada!', false, true);
      go('naoConformidade');
    } catch (e) { btn.disabled = false; btn.textContent = 'Direcionar ao agente'; }
  };
}

async function renderNaoConformidadeDetalheAdmin() {
  const n = S.ncAtual;
  appendHtml(app,
    screenHeader('Não Conformidade ' + n.ID_NC, n.LOCAL + ' · ' + n.AMBIENTE) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('naoConformidade'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  card.appendChild(el('<div class="row between"><span class="subtle">Direcionada a</span><strong>' + escapeHtml(n.AGENTE_RESPONSAVEL) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Aberta por</span><strong>' + escapeHtml(n.ADMIN_ABRIU) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Data / hora</span><strong>' + escapeHtml(n.DATA) + ' ' + escapeHtml(n.HORA) + '</strong></div>'));
  card.appendChild(el('<p class="subtle">' + escapeHtml(n.DESCRICAO) + '</p>'));
  if (n.FOTO) card.appendChild(el('<img class="photo-preview" src="' + escapeHtml(n.FOTO) + '">'));

  if (n.STATUS === 'ABERTA') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p class="subtle">Aguardando o agente resolver e enviar foto de comprovação.</p>'));
    return;
  }

  card.appendChild(el('<div class="divider"></div>'));
  card.appendChild(el('<strong>Resolução do agente</strong>'));
  if (n.DESCRICAO_RESOLUCAO) card.appendChild(el('<p class="subtle">' + escapeHtml(n.DESCRICAO_RESOLUCAO) + '</p>'));
  if (n.FOTO_RESOLUCAO) card.appendChild(el('<img class="photo-preview" src="' + escapeHtml(n.FOTO_RESOLUCAO) + '">'));
  card.appendChild(el('<span class="subtle">Resolvido em ' + escapeHtml(n.DATA_RESOLUCAO) + '</span>'));

  if (n.STATUS === 'FINALIZADA') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Validado por</span><strong>' + escapeHtml(n.ADMIN_VALIDADOR || '-') + '</strong></div>'));
    return;
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Validar resolução</h3></div>');
  app.appendChild(actWrap);
  const row = el('<div class="row" style="gap:10px"></div>');
  actWrap.appendChild(row);
  const btnAprovar = el('<button class="btn btn--primary" style="flex:1">Aprovar</button>');
  const btnReprovar = el('<button class="btn btn--danger" style="flex:1">Reprovar</button>');
  row.appendChild(btnAprovar); row.appendChild(btnReprovar);
  const motivoWrap = el('<div class="stack" style="display:none;margin-top:10px"></div>');
  actWrap.appendChild(motivoWrap);

  btnAprovar.onclick = async function () {
    await api('validarNaoConformidade', { idNc: n.ID_NC, aprovado: true, adminValidador: S.usuario.NOME });
    toast('Não conformidade finalizada.', false, true);
    go('naoConformidade');
  };
  btnReprovar.onclick = function () {
    motivoWrap.style.display = 'flex';
    motivoWrap.innerHTML = '';
    const motivo = textField(motivoWrap, { label: 'O que ainda falta corrigir? *', multiline: true });
    const btnConfirmar = el('<button class="btn btn--danger btn--block">Confirmar e devolver ao agente</button>');
    motivoWrap.appendChild(btnConfirmar);
    btnConfirmar.onclick = async function () {
      if (!motivo.getValue()) { toast('Descreva o que falta corrigir.', true); return; }
      await api('validarNaoConformidade', { idNc: n.ID_NC, aprovado: false, adminValidador: S.usuario.NOME, motivo: motivo.getValue() });
      toast('Devolvido ao agente.', false, true);
      go('naoConformidade');
    };
  };
}

// ------------------------- AGENTE: MINHAS PENDÊNCIAS (Não Conformidade) -------------------------

async function renderMinhasPendenciasNC() {
  appendHtml(app, screenHeader('Minhas pendências', 'Não conformidades e checklists reprovados direcionados a você'));

  const refazerWrap = el('<div class="stack" id="refazerWrap"></div>');
  app.appendChild(refazerWrap);

  appendHtml(app, '<span class="eyebrow" style="display:block;margin:14px 0 6px">Não conformidades</span>');
  const listWrap = el('<div class="stack" id="list"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const [refazer, rows] = await Promise.all([
    api('getPendenciasRefazer', { idAgente: S.usuario.ID_USUARIO }).catch(function () { return []; }),
    api('getNaoConformidades', { idAgenteResponsavel: S.usuario.ID_USUARIO }).catch(function () { return []; })
  ]);
  renderRefazerListAgente(refazerWrap, refazer);
  renderNCListAgente(listWrap, rows);
}

// Checklists reprovados com pedido de refazer que ainda não foram
// corrigidos. Ao tocar, o agente vai direto para a etapa de itens do
// checklist daquele local/ambiente/turno/periodicidade, sem precisar
// navegar o assistente do início.
function renderRefazerListAgente(wrap, rows) {
  wrap.innerHTML = '';
  if (!rows.length) return;
  appendHtml(wrap, '<span class="eyebrow" style="display:block;margin-bottom:6px">Checklists para refazer</span>');
  const card = el('<div class="stack"></div>');
  wrap.appendChild(card);
  rows.forEach(function (c) {
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span>' +
        '<div class="list-item__title">' + escapeHtml(c.ATIVIDADE) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(c.LOCAL) + ' · ' + escapeHtml(c.AMBIENTE) + ' · ' + escapeHtml(c.TURNO) + '</div>' +
        (c.MOTIVO_REPROVACAO ? '<div class="list-item__sub" style="color:var(--st-risco)">Motivo: ' + escapeHtml(c.MOTIVO_REPROVACAO) + '</div>' : '') +
        '</span>' +
        '<span class="tag tag--validacao">Refazer</span>' +
      '</button>'
    );
    item.onclick = function () {
      S.wizard = {
        type: 'checklist', step: 'itens',
        periodicidade: c.PERIODICIDADE, turno: c.TURNO, local: c.LOCAL, ambiente: c.AMBIENTE
      };
      go('novoChecklist');
    };
    card.appendChild(item);
  });
}

function renderNCListAgente(wrap, rows) {
  wrap.innerHTML = '';
  if (!rows.length) { wrap.appendChild(el('<div class="empty"><span class="ic">✅</span>Nenhuma pendência direcionada a você.</div>')); return; }
  rows.forEach(function (n) {
    const st = NC_STATUS_LABEL[n.STATUS] || { label: n.STATUS, cls: 'aberta' };
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span>' +
        '<div class="list-item__title">' + escapeHtml(n.LOCAL) + ' — ' + escapeHtml(n.AMBIENTE) + '</div>' +
        '<div class="list-item__sub" style="margin-top:3px">' + escapeHtml(n.DESCRICAO).slice(0, 60) + (n.DESCRICAO.length > 60 ? '…' : '') + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(n.DATA) + ' ' + escapeHtml(n.HORA) + '</div>' +
        '</span>' +
        '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
      '</button>'
    );
    item.onclick = function () { go('pendenciaNCDetalheAgente', { ncAtual: n }); };
    wrap.appendChild(item);
  });
}

async function renderPendenciaNCDetalheAgente() {
  const n = S.ncAtual;
  appendHtml(app,
    screenHeader('Pendência ' + n.ID_NC, n.LOCAL + ' · ' + n.AMBIENTE) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('minhasPendenciasNC'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  card.appendChild(el('<div class="row between"><span class="subtle">Identificada em</span><strong>' + escapeHtml(n.DATA) + ' ' + escapeHtml(n.HORA) + '</strong></div>'));
  card.appendChild(el('<p class="subtle">' + escapeHtml(n.DESCRICAO) + '</p>'));
  if (n.FOTO) card.appendChild(el('<img class="photo-preview" src="' + escapeHtml(n.FOTO) + '">'));
  if (n.MOTIVO_REPROVACAO) card.appendChild(el('<p class="subtle" style="color:var(--st-risco)">Retornou da Qualidade: ' + escapeHtml(n.MOTIVO_REPROVACAO) + '</p>'));

  if (n.STATUS === 'AGUARDANDO_VALIDACAO') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p class="subtle">Você já enviou a resolução — aguardando validação da Qualidade.</p>'));
    return;
  }
  if (n.STATUS === 'FINALIZADA') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p class="subtle" style="color:var(--st-finalizada)">✓ Finalizada.</p>'));
    return;
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Resolver</h3></div>');
  app.appendChild(actWrap);
  const descricao = textField(actWrap, { label: 'O que foi feito para corrigir *', multiline: true });
  const foto = photoField(actWrap, { label: 'Foto de comprovação *', required: true });
  const btn = el('<button class="btn btn--primary btn--block">Enviar resolução</button>');
  actWrap.appendChild(btn);
  btn.onclick = async function () {
    if (!descricao.getValue() || !foto.getValue()) { toast('Descreva o que foi feito e envie uma foto.', true); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await api('resolverNaoConformidade', { idNc: n.ID_NC, descricaoResolucao: descricao.getValue(), fotoResolucao: foto.getValue() });
      toast('Resolução enviada!', false, true);
      go('minhasPendenciasNC');
    } catch (e) { btn.disabled = false; btn.textContent = 'Enviar resolução'; }
  };
}

// ------------------------- ADMIN: GESTÃO DE USUÁRIOS -------------------------
// Cadastro, edição e desativação de usuários (Agentes de Limpeza e
// Administradores da Qualidade) pelo próprio app. A planilha (aba
// USUARIOS) continua podendo ser editada diretamente, como antes — isso só
// dá ao Admin uma forma alternativa de fazer o mesmo pelo celular.

async function renderGestaoUsuarios() {
  appendHtml(app,
    screenHeader('Cadastros', 'Gestão de usuários') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('adminHome'); };

  const btnNovo = el('<button class="btn btn--primary btn--block">+ Novo usuário</button>');
  app.appendChild(btnNovo);
  btnNovo.onclick = function () { go('usuarioForm', { usuarioEditando: null }); };

  const filterWrap = el(
    '<div class="filters" style="margin-top:12px">' +
      '<button type="button" class="btn btn--outline btn--sm is-active" data-f="ativos">Ativos</button>' +
      '<button type="button" class="btn btn--outline btn--sm" data-f="todos">Todos</button>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const usuarios = await api('getUsuariosAdmin', {}).catch(function () { return []; });

  function showList(filtro) {
    filterWrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.f === filtro); });
    const rows = filtro === 'ativos' ? usuarios.filter(function (u) { return String(u.ATIVO).toUpperCase() === 'SIM'; }) : usuarios;
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">👥</span>Nenhum usuário encontrado.</div>')); return; }
    rows.forEach(function (u) {
      const ativo = String(u.ATIVO).toUpperCase() === 'SIM';
      const semPin = ativo && u.PERFIL === 'AGENTE_LIMPEZA' && !String(u.PIN || '').trim();
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="list-item__title">' + escapeHtml(u.NOME) + '</span>' +
          '<div class="list-item__sub">' + (u.PERFIL === 'ADMIN_QUALIDADE' ? 'Administrador da Qualidade' : 'Agente de Limpeza' + (u.TURNO ? ' · ' + escapeHtml(u.TURNO) : '')) + ' · @' + escapeHtml(u.USUARIO) + '</div>' +
          (semPin ? '<div class="list-item__sub" style="color:var(--st-risco)">⚠ Sem PIN cadastrado — não consegue entrar</div>' : '') +
          '</span>' +
          '<span class="tag tag--' + (ativo ? 'finalizada' : 'aberta') + '">' + (ativo ? 'Ativo' : 'Inativo') + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('usuarioForm', { usuarioEditando: u }); };
      listWrap.appendChild(item);
    });
  }
  filterWrap.querySelectorAll('button').forEach(function (b) { b.onclick = function () { showList(b.dataset.f); }; });
  showList('ativos');
}

async function renderUsuarioForm() {
  const editando = S.usuarioEditando;
  appendHtml(app,
    screenHeader('Gestão de usuários', editando ? 'Editar usuário' : 'Novo usuário') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('gestaoUsuarios'); };

  const card = el('<div class="card stack"><p class="subtle">Carregando…</p></div>');
  app.appendChild(card);
  const turnos = await api('getTurnos', {}).catch(function () { return []; });
  card.innerHTML = '';

  const nome = textField(card, { label: 'Nome completo *', value: editando ? editando.NOME : '' });
  const usuario = textField(card, { label: 'Usuário (login) *', value: editando ? editando.USUARIO : '' });

  const perfil = choiceField(card, {
    label: 'Perfil *', columns: 2,
    options: [
      { value: 'AGENTE_LIMPEZA', label: 'Agente de Limpeza' },
      { value: 'ADMIN_QUALIDADE', label: 'Administrador da Qualidade' }
    ]
  });

  // Turno (só para Agente de Limpeza) e Senha (só para Administrador da
  // Qualidade) — mostrados/escondidos conforme o perfil escolhido.
  const turnoWrap = el('<div class="stack" style="display:none"></div>');
  card.appendChild(turnoWrap);
  let turnoField = null;
  let pinField = null;

  const senhaWrap = el('<div class="stack" style="display:none"></div>');
  card.appendChild(senhaWrap);
  let senhaField = null;

  function atualizarCamposPorPerfil() {
    const p = perfil.getValue();
    const isAgente = p === 'AGENTE_LIMPEZA';
    const isAdmin = p === 'ADMIN_QUALIDADE';

    turnoWrap.style.display = isAgente ? 'flex' : 'none';
    turnoWrap.innerHTML = '';
    turnoField = null;
    if (isAgente) {
      const wrap = el('<div class="field"><label>Turno *</label><select id="selTurnoUsuario"><option value="">Selecione…</option>' +
        turnos.map(function (t) { return '<option value="' + escapeHtml(t.TURNO) + '">' + escapeHtml(t.TURNO) + '</option>'; }).join('') + '</select></div>');
      turnoWrap.appendChild(wrap);
      const select = wrap.querySelector('select');
      if (editando && editando.TURNO) select.value = editando.TURNO;
      turnoField = { getValue: function () { return select.value; } };

      pinField = textField(turnoWrap, {
        label: editando ? 'PIN de acesso — 4 dígitos (deixe em branco para manter o atual)' : 'PIN de acesso — 4 dígitos *',
        type: 'password'
      });
      if (editando && !editando.PIN) {
        appendHtml(turnoWrap, '<p class="subtle" style="color:var(--st-risco)">⚠ Este agente ainda não tem PIN cadastrado e não consegue fazer login. Cadastre um PIN para liberar o acesso.</p>');
      }
    } else {
      pinField = null;
    }

    senhaWrap.style.display = isAdmin ? 'flex' : 'none';
    senhaWrap.innerHTML = '';
    senhaField = null;
    if (isAdmin) {
      senhaField = textField(senhaWrap, {
        label: editando ? 'Nova senha (deixe em branco para manter a atual)' : 'Senha *',
        type: 'password'
      });
    }
  }
  perfil.node.addEventListener('change', atualizarCamposPorPerfil);

  let ativoField = null;
  if (editando) {
    ativoField = choiceField(card, {
      label: 'Status', columns: 2,
      options: [{ value: 'SIM', label: 'Ativo' }, { value: 'NAO', label: 'Inativo' }]
    });
  }

  // Pré-seleciona os valores atuais na edição (o clique no perfil dispara o
  // "change" que mostra/esconde os campos de turno/senha).
  if (editando) {
    perfil.node.querySelectorAll('.option-btn')[editando.PERFIL === 'ADMIN_QUALIDADE' ? 1 : 0].click();
    ativoField.node.querySelectorAll('.option-btn')[String(editando.ATIVO).toUpperCase() === 'NAO' ? 1 : 0].click();
  }

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">' + (editando ? 'Salvar alterações' : 'Cadastrar usuário') + '</button>');
  card.appendChild(btn);
  btn.onclick = async function () {
    const payload = {
      nome: nome.getValue(), usuario: usuario.getValue(), perfil: perfil.getValue(),
      senha: senhaField ? senhaField.getValue() : '',
      turno: turnoField ? turnoField.getValue() : '',
      pin: pinField ? pinField.getValue() : ''
    };
    if (!payload.nome || !payload.usuario) { toast('Preencha nome e usuário.', true); return; }
    if (!payload.perfil) { toast('Selecione o perfil.', true); return; }
    if (payload.perfil === 'ADMIN_QUALIDADE' && !editando && !payload.senha) {
      toast('Senha é obrigatória para o perfil Administrador da Qualidade.', true);
      return;
    }
    if (payload.perfil === 'AGENTE_LIMPEZA' && !payload.turno) {
      toast('Selecione o turno do Agente de Limpeza.', true);
      return;
    }
    if (payload.perfil === 'AGENTE_LIMPEZA' && !editando && !payload.pin) {
      toast('Cadastre um PIN de 4 dígitos para o Agente de Limpeza.', true);
      return;
    }
    if (payload.perfil === 'AGENTE_LIMPEZA' && payload.pin && !/^\d{4}$/.test(payload.pin)) {
      toast('O PIN deve ter exatamente 4 dígitos numéricos.', true);
      return;
    }
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      if (editando) {
        payload.idUsuario = editando.ID_USUARIO;
        payload.ativo = ativoField ? ativoField.getValue() : editando.ATIVO;
        await api('updateUsuario', payload);
      } else {
        await api('createUsuario', payload);
      }
      toast('Usuário salvo!', false, true);
      go('gestaoUsuarios');
    } catch (e) { btn.disabled = false; btn.textContent = editando ? 'Salvar alterações' : 'Cadastrar usuário'; }
  };

  // Excluir apaga o usuário de vez (diferente do Status Inativo, que só
  // esconde da tela de login). Os checklists/ocorrências/não conformidades
  // já registrados por ele não são afetados — cada um guarda sua própria
  // cópia do nome do agente/admin no momento em que foi feito, não depende
  // da linha em USUARIOS continuar existindo. Não deixa o Admin excluir a
  // própria conta logada, pra evitar ficar sem acesso sem querer.
  if (editando && editando.ID_USUARIO !== S.usuario.ID_USUARIO) {
    const btnExcluir = el('<button class="btn btn--danger btn--block" style="margin-top:10px">Excluir usuário</button>');
    card.appendChild(btnExcluir);
    const confirmWrap = el('<div class="stack" style="display:none;margin-top:10px"></div>');
    card.appendChild(confirmWrap);

    btnExcluir.onclick = function () {
      btnExcluir.style.display = 'none';
      confirmWrap.style.display = 'flex';
      confirmWrap.innerHTML =
        '<p class="subtle" style="color:var(--st-risco)">Isso apaga o usuário definitivamente da planilha (diferente de deixar Inativo). Os checklists/ocorrências já registrados por ele continuam no histórico normalmente, com o nome dele. Confirma a exclusão?</p>';
      const row = el('<div class="row" style="gap:10px"></div>');
      confirmWrap.appendChild(row);
      const btnCancelar = el('<button class="btn btn--outline" style="flex:1">Cancelar</button>');
      const btnConfirmar = el('<button class="btn btn--danger" style="flex:1">Sim, excluir</button>');
      row.appendChild(btnCancelar); row.appendChild(btnConfirmar);

      btnCancelar.onclick = function () {
        confirmWrap.style.display = 'none';
        confirmWrap.innerHTML = '';
        btnExcluir.style.display = 'block';
      };
      btnConfirmar.onclick = async function () {
        btnConfirmar.disabled = true; btnCancelar.disabled = true; btnConfirmar.textContent = 'Excluindo…';
        try {
          await api('excluirUsuario', { idUsuario: editando.ID_USUARIO });
          toast('Usuário excluído.', false, true);
          go('gestaoUsuarios');
        } catch (e) {
          btnConfirmar.disabled = false; btnCancelar.disabled = false; btnConfirmar.textContent = 'Sim, excluir';
        }
      };
    };
  }
}

// ------------------------- ADMIN: CADASTRO DE ATIVIDADES -------------------------
// Cadastro, edição e desativação das atividades de limpeza (o planejamento
// que alimenta o wizard de checklist do agente) pelo próprio app. A
// planilha (aba ATIVIDADES) continua podendo ser editada diretamente.

async function renderGestaoAtividades() {
  appendHtml(app,
    screenHeader('Cadastros', 'Atividades de limpeza') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('adminHome'); };

  const btnNovo = el('<button class="btn btn--primary btn--block">+ Nova atividade</button>');
  app.appendChild(btnNovo);
  btnNovo.onclick = function () { go('atividadeForm', { atividadeEditando: null }); };

  const filterWrap = el(
    '<div class="filters" style="margin-top:12px">' +
      '<select id="fLocal"><option value="">Todos os locais</option></select>' +
      '<button type="button" class="btn btn--outline btn--sm is-active" data-f="ativas">Ativas</button>' +
      '<button type="button" class="btn btn--outline btn--sm" data-f="todas">Todas</button>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const selLocal = filterWrap.querySelector('#fLocal');
  api('getLocais', {}).then(function (locais) {
    locais.forEach(function (l) { selLocal.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
  }).catch(function () {});

  let filtroStatus = 'ativas';
  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const rows = await api('getAtividadesAdmin', { local: selLocal.value }).catch(function () { return []; });
    const filtradas = filtroStatus === 'ativas' ? rows.filter(function (a) { return String(a.ATIVO).toUpperCase() === 'SIM'; }) : rows;
    listWrap.innerHTML = '';
    if (!filtradas.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧾</span>Nenhuma atividade encontrada.</div>')); return; }
    filtradas.forEach(function (a) {
      const ativo = String(a.ATIVO).toUpperCase() === 'SIM';
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="list-item__title">' + escapeHtml(a.ATIVIDADE) + '</span>' +
          '<div class="list-item__sub">' + escapeHtml(a.LOCAL) + ' · ' + escapeHtml(a.AMBIENTE) + '</div>' +
          '<div class="list-item__sub">' + periodicidadeLabel(a.PERIODICIDADE) + (a.TURNO ? ' · ' + escapeHtml(a.TURNO) : ' · Todos os turnos') + '</div></span>' +
          '<span class="tag tag--' + (ativo ? 'finalizada' : 'aberta') + '">' + (ativo ? 'Ativa' : 'Inativa') + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('atividadeForm', { atividadeEditando: a }); };
      listWrap.appendChild(item);
    });
  }
  selLocal.onchange = load;
  filterWrap.querySelectorAll('button[data-f]').forEach(function (b) {
    b.onclick = function () {
      filtroStatus = b.dataset.f;
      filterWrap.querySelectorAll('button[data-f]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      load();
    };
  });
  load();
}

async function renderAtividadeForm() {
  const editando = S.atividadeEditando;
  appendHtml(app,
    screenHeader('Atividades de limpeza', editando ? 'Editar atividade' : 'Nova atividade') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('gestaoAtividades'); };

  const card = el('<div class="card stack"><p class="subtle">Carregando…</p></div>');
  app.appendChild(card);

  const locais = await api('getLocais', {}).catch(function () { return []; });
  const turnos = await api('getTurnos', {}).catch(function () { return []; });
  card.innerHTML = '';

  // Local e Ambiente são texto livre — o admin pode digitar um local ou
  // ambiente novo na hora, sem precisar cadastrá-lo antes em outro lugar.
  // O <datalist> só sugere os que já existem (pra ajudar e evitar
  // duplicar por erro de digitação); o backend também normaliza a grafia
  // se o texto bater com um já cadastrado, ignorando maiúsc./minúsc.
  const localWrap = el(
    '<div class="field"><label>Local *</label>' +
    '<input type="text" id="inpLocal" list="dlLocais" autocomplete="off" placeholder="Ex: Armazém 2">' +
    '<datalist id="dlLocais">' + locais.map(function (l) { return '<option value="' + escapeHtml(l.LOCAL) + '">'; }).join('') + '</datalist>' +
    '</div>'
  );
  card.appendChild(localWrap);
  const inpLocal = localWrap.querySelector('input');

  const ambienteWrap = el(
    '<div class="field"><label>Ambiente *</label>' +
    '<input type="text" id="inpAmbiente" list="dlAmbientes" autocomplete="off" placeholder="Ex: Banheiro">' +
    '<datalist id="dlAmbientes"></datalist>' +
    '</div>'
  );
  card.appendChild(ambienteWrap);
  const inpAmbiente = ambienteWrap.querySelector('input');
  const dlAmbientes = ambienteWrap.querySelector('datalist');

  async function atualizarSugestoesAmbiente() {
    const ambientes = await api('getAmbientes', { local: inpLocal.value.trim() }).catch(function () { return []; });
    dlAmbientes.innerHTML = ambientes.map(function (a) { return '<option value="' + escapeHtml(a.AMBIENTE) + '">'; }).join('');
  }
  inpLocal.addEventListener('change', atualizarSugestoesAmbiente);

  // Editando um item existente: um campo de descrição só, como antes.
  // Cadastrando novo: uma lista de itens — o admin pode adicionar quantas
  // atividades/perguntas quiser para o mesmo local+ambiente de uma vez só
  // (ex: "Retirada de lixo", "Limpeza das mesas", "Limpeza do chão"),
  // sem repetir o formulário inteiro pra cada uma.
  let descricao = null;
  let listaAtividades = null;
  if (editando) {
    descricao = textField(card, {
      label: 'Descrição da atividade *', multiline: true, value: editando.ATIVIDADE,
      placeholder: 'Ex: Realizar limpeza completa do banheiro, incluindo piso, vasos, pias e reposição dos materiais.'
    });
  } else {
    listaAtividades = listaAtividadesField(card, {
      label: 'Atividades desta lista * (uma por linha — adicione quantas quiser)',
      placeholder: 'Ex: Retirada de lixo e troca do saco'
    });
  }

  const periodicidade = choiceField(card, {
    label: 'Frequência *', columns: 3,
    options: [{ value: 'DIARIO', label: 'Diário' }, { value: 'SEMANAL', label: 'Semanal' }, { value: 'MENSAL', label: 'Mensal' }]
  });

  const detalheWrap = el('<div class="stack" style="display:none"></div>');
  card.appendChild(detalheWrap);
  function atualizarDetalhePeriodicidade(valorInicial) {
    const p = periodicidade.getValue();
    detalheWrap.innerHTML = '';
    detalheWrap.style.display = (p === 'SEMANAL' || p === 'MENSAL') ? 'flex' : 'none';
    if (p === 'SEMANAL') {
      const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const wrap = el('<div class="field"><label>Dia da semana (opcional — deixe vazio para qualquer dia)</label><select id="selDiaSemana"><option value="">Qualquer dia</option>' +
        dias.map(function (d, i) { return '<option value="' + i + '">' + d + '</option>'; }).join('') + '</select></div>');
      detalheWrap.appendChild(wrap);
      if (valorInicial !== undefined && valorInicial !== '' && valorInicial !== null) wrap.querySelector('select').value = String(valorInicial);
    } else if (p === 'MENSAL') {
      const wrap = el('<div class="field"><label>Dia do mês (opcional — deixe vazio para qualquer dia, 1-31)</label><input type="number" id="selDiaMes" min="1" max="31"></div>');
      detalheWrap.appendChild(wrap);
      if (valorInicial !== undefined && valorInicial !== '' && valorInicial !== null) wrap.querySelector('input').value = valorInicial;
    }
  }
  periodicidade.node.addEventListener('change', function () { atualizarDetalhePeriodicidade(); });

  const turnoWrap = el('<div class="field"><label>Turno (opcional — deixe vazio para valer em todos os turnos)</label><select id="selTurno"><option value="">Todos os turnos</option>' +
    turnos.map(function (t) { return '<option value="' + escapeHtml(t.TURNO) + '">' + escapeHtml(t.TURNO) + '</option>'; }).join('') + '</select></div>');
  card.appendChild(turnoWrap);
  const selTurno = turnoWrap.querySelector('select');

  card.appendChild(el('<div class="divider"></div>'));
  card.appendChild(el('<strong>Exigências ao executar</strong>'));
  const fotoAntes = choiceField(card, { label: 'Foto antes obrigatória?', columns: 2, options: [{ value: true, label: 'Sim' }, { value: false, label: 'Não' }] });
  const fotoDepois = choiceField(card, { label: 'Foto depois obrigatória?', columns: 2, options: [{ value: true, label: 'Sim' }, { value: false, label: 'Não' }] });
  const validacao = choiceField(card, { label: 'Exige validação da Qualidade?', columns: 2, options: [{ value: true, label: 'Sim' }, { value: false, label: 'Não' }] });

  let ativoField = null;
  if (editando) {
    ativoField = choiceField(card, { label: 'Status', columns: 2, options: [{ value: 'SIM', label: 'Ativa' }, { value: 'NAO', label: 'Inativa' }] });
  }

  // Pré-preenche com os dados atuais na edição; numa atividade nova, os
  // campos de exigência de foto/validação começam em "Não" (o admin ativa
  // o que for necessário).
  if (editando) {
    inpLocal.value = editando.LOCAL;
    inpAmbiente.value = editando.AMBIENTE;
    await atualizarSugestoesAmbiente();
    const idxPeriodicidade = ['DIARIO', 'SEMANAL', 'MENSAL'].indexOf(editando.PERIODICIDADE);
    periodicidade.node.querySelectorAll('.option-btn')[idxPeriodicidade > -1 ? idxPeriodicidade : 0].click();
    atualizarDetalhePeriodicidade(editando.PERIODICIDADE === 'SEMANAL' ? editando.DIA_SEMANA : editando.DIA_MES);
    if (editando.TURNO) selTurno.value = editando.TURNO;
    fotoAntes.node.querySelectorAll('.option-btn')[String(editando.FOTO_ANTES).toUpperCase() === 'SIM' ? 0 : 1].click();
    fotoDepois.node.querySelectorAll('.option-btn')[String(editando.FOTO_DEPOIS).toUpperCase() === 'SIM' ? 0 : 1].click();
    validacao.node.querySelectorAll('.option-btn')[String(editando.VALIDACAO).toUpperCase() === 'SIM' ? 0 : 1].click();
    ativoField.node.querySelectorAll('.option-btn')[String(editando.ATIVO).toUpperCase() === 'NAO' ? 1 : 0].click();
  } else {
    fotoAntes.node.querySelectorAll('.option-btn')[1].click();
    fotoDepois.node.querySelectorAll('.option-btn')[1].click();
    validacao.node.querySelectorAll('.option-btn')[1].click();
  }

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">' + (editando ? 'Salvar alterações' : 'Cadastrar atividades') + '</button>');
  card.appendChild(btn);
  btn.onclick = async function () {
    const diaSemanaInput = detalheWrap.querySelector('#selDiaSemana');
    const diaMesInput = detalheWrap.querySelector('#selDiaMes');
    const payload = {
      local: inpLocal.value.trim(), ambiente: inpAmbiente.value.trim(),
      periodicidade: periodicidade.getValue(), turno: selTurno.value,
      diaSemana: diaSemanaInput ? diaSemanaInput.value : '', diaMes: diaMesInput ? diaMesInput.value : '',
      fotoAntes: !!fotoAntes.getValue(), fotoDepois: !!fotoDepois.getValue(), validacao: !!validacao.getValue()
    };
    if (!payload.local || !payload.ambiente || !payload.periodicidade) {
      toast('Preencha local, ambiente e frequência.', true);
      return;
    }
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      if (editando) {
        payload.atividade = descricao.getValue();
        if (!payload.atividade) { toast('Descreva a atividade.', true); btn.disabled = false; btn.textContent = 'Salvar alterações'; return; }
        payload.idAtividade = editando.ID_ATIVIDADE;
        payload.ativo = ativoField ? ativoField.getValue() : editando.ATIVO;
        await api('updateAtividade', payload);
        toast('Atividade salva!', false, true);
      } else {
        payload.atividades = listaAtividades.getValues();
        if (!payload.atividades.length) { toast('Adicione ao menos uma atividade.', true); btn.disabled = false; btn.textContent = 'Cadastrar atividades'; return; }
        const resultado = await api('createAtividadesLote', payload);
        const total = resultado && resultado.total ? resultado.total : payload.atividades.length;
        toast(total === 1 ? 'Atividade cadastrada!' : total + ' atividades cadastradas!', false, true);
      }
      go('gestaoAtividades');
    } catch (e) { btn.disabled = false; btn.textContent = editando ? 'Salvar alterações' : 'Cadastrar atividades'; }
  };

  // Excluir apaga a atividade de vez (diferente do Status Inativa, que só
  // esconde). Os checklists já registrados com ela não são afetados — só
  // deixa de aparecer em novos checklists. Pede confirmação antes.
  if (editando) {
    const btnExcluir = el('<button class="btn btn--danger btn--block" style="margin-top:10px">Excluir atividade</button>');
    card.appendChild(btnExcluir);
    const confirmWrap = el('<div class="stack" style="display:none;margin-top:10px"></div>');
    card.appendChild(confirmWrap);

    btnExcluir.onclick = function () {
      btnExcluir.style.display = 'none';
      confirmWrap.style.display = 'flex';
      confirmWrap.innerHTML =
        '<p class="subtle" style="color:var(--st-risco)">Isso apaga a atividade definitivamente da planilha (diferente de deixar Inativa). Os checklists já registrados com ela continuam no histórico normalmente. Confirma a exclusão?</p>';
      const row = el('<div class="row" style="gap:10px"></div>');
      confirmWrap.appendChild(row);
      const btnCancelar = el('<button class="btn btn--outline" style="flex:1">Cancelar</button>');
      const btnConfirmar = el('<button class="btn btn--danger" style="flex:1">Sim, excluir</button>');
      row.appendChild(btnCancelar); row.appendChild(btnConfirmar);

      btnCancelar.onclick = function () {
        confirmWrap.style.display = 'none';
        confirmWrap.innerHTML = '';
        btnExcluir.style.display = 'block';
      };
      btnConfirmar.onclick = async function () {
        btnConfirmar.disabled = true; btnCancelar.disabled = true; btnConfirmar.textContent = 'Excluindo…';
        try {
          await api('excluirAtividade', { idAtividade: editando.ID_ATIVIDADE });
          toast('Atividade excluída.', false, true);
          go('gestaoAtividades');
        } catch (e) {
          btnConfirmar.disabled = false; btnCancelar.disabled = false; btnConfirmar.textContent = 'Sim, excluir';
        }
      };
    };
  }
}

// Lista dinâmica de itens de texto (uma atividade/pergunta por linha), com
// botão para adicionar mais linhas e um "×" para remover cada uma. Usada
// no cadastro de novas atividades, para criar várias de uma vez para o
// mesmo local+ambiente.
function listaAtividadesField(container, opts) {
  opts = opts || {};
  const wrap = el(
    '<div class="stack" style="gap:8px">' +
      '<label style="font-size:13px;font-weight:600;color:var(--ink-soft)">' + escapeHtml(opts.label || 'Itens') + '</label>' +
      '<div class="stack" id="itensLista" style="gap:8px"></div>' +
      '<button type="button" class="btn btn--outline btn--sm" style="align-self:flex-start">+ Adicionar atividade</button>' +
    '</div>'
  );
  container.appendChild(wrap);
  const itensWrap = wrap.querySelector('#itensLista');
  const btnAdd = wrap.querySelector('button');

  function addRow(valorInicial) {
    const row = el(
      '<div class="row" style="gap:6px">' +
        '<input type="text" placeholder="' + escapeHtml(opts.placeholder || '') + '" style="flex:1;padding:12px 13px;border:1px solid var(--line);border-radius:var(--radius);background:#fff;color:var(--ink)">' +
        '<button type="button" class="btn btn--outline btn--sm" title="Remover">✕</button>' +
      '</div>'
    );
    const input = row.querySelector('input');
    if (valorInicial) input.value = valorInicial;
    row.querySelector('button').onclick = function () {
      if (itensWrap.children.length > 1) row.remove();
      else input.value = '';
    };
    itensWrap.appendChild(row);
    return input;
  }
  btnAdd.onclick = function () { addRow().focus(); };
  addRow(); // começa com 1 linha vazia

  return {
    node: wrap,
    getValues: function () {
      return Array.from(itensWrap.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
    }
  };
}

// ------------------------- ADMIN: GESTÃO DE LOCAIS E AMBIENTES -------------------------
// Complementa o cadastro livre de local/ambiente feito no formulário de
// atividades: aqui dá para ver tudo que já foi cadastrado, corrigir a
// grafia de um nome (renomear propaga para ambientes/atividades que usam
// aquele local, mas nunca reescreve o histórico já registrado) e ativar/
// desativar. Não existe aqui uma função de "mesclar" dois nomes parecidos —
// só renomear um registro específico, para não arriscar misturar históricos
// de lugares diferentes por engano.

async function renderGestaoLocais() {
  appendHtml(app,
    screenHeader('Cadastros', 'Locais e ambientes') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('adminHome'); };

  const novoLocalWrap = el('<div class="stack"></div>');
  app.appendChild(novoLocalWrap);
  const btnNovoLocal = el('<button class="btn btn--primary btn--block">+ Novo local</button>');
  novoLocalWrap.appendChild(btnNovoLocal);
  btnNovoLocal.onclick = function () {
    novoLocalWrap.innerHTML = '';
    const nomeField = textField(novoLocalWrap, { label: 'Nome do novo local *' });
    const row = el('<div class="row" style="gap:10px"></div>');
    novoLocalWrap.appendChild(row);
    const btnSalvar = el('<button class="btn btn--primary" style="flex:1">Salvar</button>');
    const btnCancelar = el('<button class="btn btn--outline" style="flex:1">Cancelar</button>');
    row.appendChild(btnSalvar); row.appendChild(btnCancelar);
    btnCancelar.onclick = function () { go('gestaoLocais'); };
    btnSalvar.onclick = async function () {
      if (!nomeField.getValue()) { toast('Informe o nome do local.', true); return; }
      btnSalvar.disabled = true;
      try {
        await api('createLocal', { nome: nomeField.getValue() });
        toast('Local cadastrado!', false, true);
        go('gestaoLocais');
      } catch (e) { btnSalvar.disabled = false; }
    };
  };

  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const locais = await api('getLocaisAdmin', {}).catch(function () { return []; });
  listWrap.innerHTML = '';
  if (!locais.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">📍</span>Nenhum local cadastrado.</div>')); return; }

  locais.forEach(function (l) {
    const ativo = String(l.ATIVO).toUpperCase() === 'SIM';
    const localCard = el('<div class="card stack"></div>');
    listWrap.appendChild(localCard);

    const header = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span class="list-item__title">' + escapeHtml(l.LOCAL) + '</span>' +
        '<span class="tag tag--' + (ativo ? 'finalizada' : 'aberta') + '">' + (ativo ? 'Ativo' : 'Inativo') + '</span>' +
      '</button>'
    );
    localCard.appendChild(header);

    const acoesWrap = el('<div class="row" style="gap:10px;display:none"></div>');
    localCard.appendChild(acoesWrap);
    const ambientesWrap = el('<div class="stack" style="display:none;padding-left:8px"></div>');
    localCard.appendChild(ambientesWrap);

    let aberto = false;
    header.onclick = function () {
      aberto = !aberto;
      acoesWrap.style.display = aberto ? 'flex' : 'none';
      ambientesWrap.style.display = aberto ? 'flex' : 'none';
      if (aberto && !ambientesWrap.dataset.loaded) {
        ambientesWrap.dataset.loaded = '1';
        carregarAmbientes();
      }
    };

    acoesWrap.innerHTML =
      '<button type="button" class="btn btn--outline btn--sm" data-a="renomear">Renomear</button>' +
      '<button type="button" class="btn btn--outline btn--sm" data-a="status">' + (ativo ? 'Desativar' : 'Ativar') + '</button>';
    acoesWrap.querySelector('[data-a="renomear"]').onclick = function () {
      ambientesWrap.style.display = 'none';
      acoesWrap.innerHTML = '';
      const nomeField = textField(acoesWrap, { label: 'Novo nome *', value: l.LOCAL });
      const row = el('<div class="row" style="gap:10px"></div>');
      acoesWrap.appendChild(row);
      const btnSalvar = el('<button class="btn btn--primary btn--sm" style="flex:1">Salvar</button>');
      const btnCancelar = el('<button class="btn btn--outline btn--sm" style="flex:1">Cancelar</button>');
      row.appendChild(btnSalvar); row.appendChild(btnCancelar);
      btnCancelar.onclick = function () { go('gestaoLocais'); };
      btnSalvar.onclick = async function () {
        if (!nomeField.getValue()) { toast('Informe o nome.', true); return; }
        btnSalvar.disabled = true;
        try {
          await api('renomearLocal', { idLocal: l.ID_LOCAL, novoNome: nomeField.getValue() });
          toast('Local renomeado!', false, true);
          go('gestaoLocais');
        } catch (e) { btnSalvar.disabled = false; }
      };
    };
    acoesWrap.querySelector('[data-a="status"]').onclick = async function () {
      await api('atualizarStatusLocal', { idLocal: l.ID_LOCAL, ativo: ativo ? 'NAO' : 'SIM' }).catch(function () {});
      toast(ativo ? 'Local desativado.' : 'Local ativado.', false, true);
      go('gestaoLocais');
    };

    function carregarAmbientes() {
      ambientesWrap.innerHTML = '<p class="subtle">Carregando ambientes…</p>';
      api('getAmbientesAdmin', { local: l.LOCAL }).then(function (ambientes) {
        ambientesWrap.innerHTML = '';
        const btnNovoAmbiente = el('<button class="btn btn--outline btn--sm" style="align-self:flex-start">+ Novo ambiente</button>');
        ambientesWrap.appendChild(btnNovoAmbiente);
        btnNovoAmbiente.onclick = function () {
          ambientesWrap.innerHTML = '';
          const nomeField = textField(ambientesWrap, { label: 'Nome do novo ambiente *' });
          const row = el('<div class="row" style="gap:10px"></div>');
          ambientesWrap.appendChild(row);
          const btnSalvar = el('<button class="btn btn--primary btn--sm" style="flex:1">Salvar</button>');
          const btnCancelar = el('<button class="btn btn--outline btn--sm" style="flex:1">Cancelar</button>');
          row.appendChild(btnSalvar); row.appendChild(btnCancelar);
          btnCancelar.onclick = function () { go('gestaoLocais'); };
          btnSalvar.onclick = async function () {
            if (!nomeField.getValue()) { toast('Informe o nome do ambiente.', true); return; }
            btnSalvar.disabled = true;
            try {
              await api('createAmbiente', { local: l.LOCAL, nome: nomeField.getValue() });
              toast('Ambiente cadastrado!', false, true);
              go('gestaoLocais');
            } catch (e) { btnSalvar.disabled = false; }
          };
        };

        if (!ambientes.length) {
          ambientesWrap.appendChild(el('<p class="subtle">Nenhum ambiente cadastrado para este local.</p>'));
          return;
        }
        ambientes.forEach(function (a) {
          const ativoA = String(a.ATIVO).toUpperCase() === 'SIM';
          const row = el(
            '<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">' +
              '<span>' + escapeHtml(a.AMBIENTE) + '</span>' +
              '<span class="tag tag--' + (ativoA ? 'finalizada' : 'aberta') + '">' + (ativoA ? 'Ativo' : 'Inativo') + '</span>' +
            '</div>'
          );
          const acoesA = el('<div class="row" style="gap:8px;margin-bottom:8px"></div>');
          const btnRenomearA = el('<button type="button" class="btn btn--outline btn--sm" style="flex:1">Renomear</button>');
          const btnStatusA = el('<button type="button" class="btn btn--outline btn--sm" style="flex:1">' + (ativoA ? 'Desativar' : 'Ativar') + '</button>');
          acoesA.appendChild(btnRenomearA); acoesA.appendChild(btnStatusA);
          ambientesWrap.appendChild(row);
          ambientesWrap.appendChild(acoesA);

          btnRenomearA.onclick = function () {
            acoesA.innerHTML = '';
            const nomeField = textField(acoesA, { label: 'Novo nome *', value: a.AMBIENTE });
            const btnSalvar = el('<button class="btn btn--primary btn--sm">Salvar</button>');
            acoesA.appendChild(btnSalvar);
            btnSalvar.onclick = async function () {
              if (!nomeField.getValue()) { toast('Informe o nome.', true); return; }
              btnSalvar.disabled = true;
              try {
                await api('renomearAmbiente', { idAmbiente: a.ID_AMBIENTE, novoNome: nomeField.getValue() });
                toast('Ambiente renomeado!', false, true);
                go('gestaoLocais');
              } catch (e) { btnSalvar.disabled = false; }
            };
          };
          btnStatusA.onclick = async function () {
            await api('atualizarStatusAmbiente', { idAmbiente: a.ID_AMBIENTE, ativo: ativoA ? 'NAO' : 'SIM' }).catch(function () {});
            toast(ativoA ? 'Ambiente desativado.' : 'Ambiente ativado.', false, true);
            go('gestaoLocais');
          };
        });
      }).catch(function () { ambientesWrap.innerHTML = ''; });
    }
  });
}

// ------------------------- DASHBOARD HELPERS -------------------------

function kpi(value, label) {
  return '<div class="kpi"><span class="badge-count">' + escapeHtml(value) + '</span><span class="subtle">' + escapeHtml(label) + '</span></div>';
}

function barCard(title, dataObj) {
  const entries = Object.entries(dataObj || {}).sort(function (a, b) { return b[1] - a[1]; });
  const max = entries.length ? entries[0][1] : 1;
  const card = el('<div class="card stack"><h3 class="title-lg">' + escapeHtml(title) + '</h3></div>');
  if (!entries.length) { card.appendChild(el('<p class="subtle">Sem dados no período.</p>')); return card; }
  entries.forEach(function (e) {
    card.appendChild(el(
      '<div class="bar-row"><span class="label">' + escapeHtml(e[0]) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(4, (e[1] / max) * 100) + '%"></div></div>' +
      '<span class="bar-val">' + escapeHtml(e[1]) + '</span></div>'
    ));
  });
  return card;
}

function filtroDashboard() {
  return el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="hoje">Hoje</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes" selected>Este mês</option>' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fLocal"><option value="">Todos os locais</option></select>' +
      '<select id="fAmbiente"><option value="">Todos os ambientes</option></select>' +
      '<select id="fTurno"><option value="">Todos os turnos</option></select>' +
    '</div>'
  );
}

async function preencherFiltrosLocalAmbienteTurno(selLocal, selAmbiente, selTurno) {
  const locais = await api('getLocais', {}).catch(function () { return []; });
  locais.forEach(function (l) { selLocal.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
  const turnos = await api('getTurnos', {}).catch(function () { return []; });
  turnos.forEach(function (t) { selTurno.appendChild(el('<option value="' + escapeHtml(t.TURNO) + '">' + escapeHtml(t.TURNO) + '</option>')); });
  selLocal.onchange = async function () {
    selAmbiente.innerHTML = '<option value="">Todos os ambientes</option>';
    if (!selLocal.value) return;
    const ambientes = await api('getAmbientes', { local: selLocal.value }).catch(function () { return []; });
    ambientes.forEach(function (a) { selAmbiente.appendChild(el('<option value="' + escapeHtml(a.AMBIENTE) + '">' + escapeHtml(a.AMBIENTE) + '</option>')); });
  };
}

function lerRangeFiltro() {
  const selPeriodo = document.getElementById('fPeriodo');
  if (selPeriodo.value === 'custom') {
    const ini = document.getElementById('fDataInicial').value;
    const fim = document.getElementById('fDataFinal').value;
    return {
      dataInicial: ini ? dateToBR(new Date(ini + 'T00:00:00')) : '',
      dataFinal: fim ? dateToBR(new Date(fim + 'T00:00:00')) : ''
    };
  }
  return periodoRange(selPeriodo.value);
}

// ------------------------- DASHBOARD — CHECKLIST DA QUALIDADE -------------------------

// ------------------------- DASHBOARD — HUB (menu central) -------------------------

function renderDashboardHub() {
  appendHtml(app, screenHeader('Dashboards', 'Checklist da Qualidade') + '<div class="stack"></div>');
  const wrap = app.querySelector('.stack:last-child');
  wrap.appendChild(el(menuCard('🧹', 'Checklist de Limpeza', 'Previsto, realizado, pendente e atrasado — por local', 'dashChecklist')));
  wrap.appendChild(el(menuCard('👥', 'Por Agente e Turno', 'Realizados agrupados por agente e por turno', 'dashAgenteTurno')));
  wrap.appendChild(el(menuCard('✅', 'Validação da Qualidade', 'Aprovados, reprovados e não conformidades', 'dashValidacao')));
  wrap.appendChild(el(menuCard('🔄', 'Ocorrências entre Turnos', 'Ocorrências abertas de um turno para outro', 'dashOcorrencias')));
  wrap.appendChild(el(menuCard('📷', 'Evidências Fotográficas', 'Fotos antes/depois e status de aprovação', 'dashFotos')));
  bindMenuCards();
}

function dashBackButton(voltarPara) {
  const btn = el('<button class="btn btn--outline btn--sm" id="btnVoltarDash" style="align-self:flex-start;margin-top:-8px">← Dashboards</button>');
  app.appendChild(btn);
  btn.onclick = function () { go(voltarPara || 'dashboardHub'); };
}

// ------------------------- DASHBOARD 1 — CHECKLIST DE LIMPEZA -------------------------

async function renderDashChecklist() {
  appendHtml(app, screenHeader('Checklist de Limpeza', 'Previsto · Realizado · Pendente'));
  dashBackButton();
  const filterWrap = filtroDashboard();
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selLocal = document.getElementById('fLocal'), selAmbiente = document.getElementById('fAmbiente'), selTurno = document.getElementById('fTurno');
  await preencherFiltrosLocalAmbienteTurno(selLocal, selAmbiente, selTurno);

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selLocal.onchange = load; selAmbiente.onchange = load; selTurno.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const d = await api('getDashboardChecklist', {
      local: selLocal.value, ambiente: selAmbiente.value, turno: selTurno.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.totalPrevisto, 'Previstos') +
        kpi(d.realizados, 'Realizados') +
        kpi(d.pendentes, 'Pendentes') +
        kpi(d.atrasados, 'Atrasados') +
        kpi(d.percentualCumprimento + '%', '% Cumprimento') +
      '</div>'
    ));

    body.appendChild(barCard('Realizados por Local', d.porLocal));
    body.appendChild(barCard('Realizados por Ambiente', d.porAmbiente));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Registros recentes</h3></div>');
      body.appendChild(listCard);
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      listCard.appendChild(tableWrap);
      const recentes = d.registros.slice().sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); }).slice(0, 15);
      tableWrap.appendChild(buildPreviewTable(
        [['DATA', 'Data'], ['LOCAL', 'Local'], ['AMBIENTE', 'Ambiente'], ['ATIVIDADE', 'Atividade'], ['STATUS', 'Status']],
        recentes
      ));
    }
  }
  load();
}

// ------------------------- DASHBOARD 2 — POR AGENTE E TURNO -------------------------

async function renderDashAgenteTurno() {
  appendHtml(app, screenHeader('Por Agente e Turno', 'Checklist de Limpeza'));
  dashBackButton();
  const filterWrap = filtroDashboard();
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selLocal = document.getElementById('fLocal'), selAmbiente = document.getElementById('fAmbiente'), selTurno = document.getElementById('fTurno');
  await preencherFiltrosLocalAmbienteTurno(selLocal, selAmbiente, selTurno);

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selLocal.onchange = load; selAmbiente.onchange = load; selTurno.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const d = await api('getDashboardChecklist', {
      local: selLocal.value, ambiente: selAmbiente.value, turno: selTurno.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el('<div class="kpi-grid">' + kpi(d.realizados, 'Total realizados') + '</div>'));
    body.appendChild(barCard('Realizados por Agente de Limpeza', d.porAgente));
    body.appendChild(barCard('Realizados por Turno', d.porTurno));
  }
  load();
}

// ------------------------- DASHBOARD 3 — VALIDAÇÃO DA QUALIDADE -------------------------

async function renderDashValidacao() {
  appendHtml(app, screenHeader('Validação da Qualidade', 'Aprovados · Reprovados · Não Conformidades'));
  dashBackButton();
  const filterWrap = filtroDashboard();
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selLocal = document.getElementById('fLocal'), selAmbiente = document.getElementById('fAmbiente'), selTurno = document.getElementById('fTurno');
  await preencherFiltrosLocalAmbienteTurno(selLocal, selAmbiente, selTurno);

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selLocal.onchange = load; selAmbiente.onchange = load; selTurno.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const d = await api('getDashboardChecklist', {
      local: selLocal.value, ambiente: selAmbiente.value, turno: selTurno.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.aprovados, 'Aprovados') +
        kpi(d.reprovados, 'Reprovados') +
        kpi(d.naoConformidades, 'Não conformidades') +
        kpi(d.totalNaoConformidadesQualidade, 'Não conf. da Qualidade') +
        kpi(d.percentualAprovacao + '%', '% Aprovação') +
      '</div>'
    ));

    body.appendChild(barCard('Aprovados por Agente', d.aprovadosPorAgente));
    body.appendChild(barCard('Reprovados por Agente', d.reprovadosPorAgente));
    body.appendChild(barCard('Aprovados por Turno', d.aprovadosPorTurno));
    body.appendChild(barCard('Reprovados por Turno', d.reprovadosPorTurno));
  }
  load();
}

// ------------------------- DASHBOARD 4 — OCORRÊNCIAS ENTRE TURNOS -------------------------

async function renderDashOcorrencias() {
  appendHtml(app, screenHeader('Ocorrências entre Turnos', 'Abertas de um turno para outro'));
  dashBackButton();
  const filterWrap = filtroDashboard();
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selLocal = document.getElementById('fLocal'), selAmbiente = document.getElementById('fAmbiente'), selTurno = document.getElementById('fTurno');
  await preencherFiltrosLocalAmbienteTurno(selLocal, selAmbiente, selTurno);

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selLocal.onchange = load; selAmbiente.onchange = load; selTurno.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const d = await api('getDashboardOcorrencias', { local: selLocal.value, ambiente: selAmbiente.value, turno: selTurno.value, dataInicial: range.dataInicial, dataFinal: range.dataFinal }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.total, 'Total') +
        kpi(d.totalEntreTurnos, 'Entre turnos') +
        kpi(d.pendentes, 'Pendentes') +
        kpi(d.procedentes, 'Procedentes') +
        kpi(d.naoProcedentes, 'Não procedentes') +
      '</div>'
    ));

    body.appendChild(barCard('Abertas por Turno (quem relatou)', d.porTurnoAbertura));
    body.appendChild(barCard('Direcionadas ao Turno (responsável identificado)', d.porTurnoResponsavel));
    body.appendChild(barCard('Por Agente Responsável', d.porAgenteResponsavel));

    if (d.registrosEntreTurnos.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Ocorrências entre turnos</h3></div>');
      body.appendChild(listCard);
      const inner = el('<div class="stack"></div>');
      listCard.appendChild(inner);
      renderOcorrenciasList(inner, d.registrosEntreTurnos.slice(0, 12), function (o) { go('ocorrenciaDetalheAdmin', { ocorrenciaAtual: o }); });
    }
  }
  load();
}

// ------------------------- DASHBOARD — EVIDÊNCIAS FOTOGRÁFICAS -------------------------

async function renderDashFotos() {
  appendHtml(app, screenHeader('Evidências Fotográficas', 'Checklist da Qualidade'));
  dashBackButton();
  const filterWrap = filtroDashboard();
  const turnoField = filterWrap.querySelector('#fTurno');
  if (turnoField) turnoField.remove(); // fotos não filtram por turno
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selLocal = document.getElementById('fLocal'), selAmbiente = document.getElementById('fAmbiente');
  const locais = await api('getLocais', {}).catch(function () { return []; });
  locais.forEach(function (l) { selLocal.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
  selLocal.onchange = async function () {
    selAmbiente.innerHTML = '<option value="">Todos os ambientes</option>';
    if (!selLocal.value) return;
    const ambientes = await api('getAmbientes', { local: selLocal.value }).catch(function () { return []; });
    ambientes.forEach(function (a) { selAmbiente.appendChild(el('<option value="' + escapeHtml(a.AMBIENTE) + '">' + escapeHtml(a.AMBIENTE) + '</option>')); });
    load();
  };

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selAmbiente.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const d = await api('getDashboardFotos', { local: selLocal.value, ambiente: selAmbiente.value, dataInicial: range.dataInicial, dataFinal: range.dataFinal }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.total, 'Checklists no período') +
        kpi(d.comFotoAntes, 'Com foto ANTES') +
        kpi(d.comFotoDepois, 'Com foto DEPOIS') +
        kpi(d.semEvidencia, 'Sem evidência') +
        kpi(d.fotosPendentes, 'Pendentes de validação') +
        kpi(d.fotosAprovadas, 'Aprovadas') +
        kpi(d.fotosReprovadas, 'Reprovadas') +
        kpi(d.percentualAprovacao + '%', '% Aprovação') +
      '</div>'
    ));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Ver fotos antes/depois</h3></div>');
      body.appendChild(listCard);
      d.registros.slice(0, 10).forEach(function (r) {
        const box = el('<div class="stack" style="padding:10px 0;border-bottom:1px solid var(--line)"></div>');
        box.appendChild(el('<strong>' + escapeHtml(r.ATIVIDADE) + '</strong><div class="subtle">' + escapeHtml(r.LOCAL) + ' · ' + escapeHtml(r.AMBIENTE) + ' · ' + escapeHtml(r.DATA) + '</div>'));
        const fotosRow = el('<div class="grid2" style="margin-top:6px"></div>');
        fotosRow.appendChild(el('<div class="stack" style="gap:4px"><span class="subtle">Antes</span>' + (r.FOTO_ANTES ? '<img class="photo-preview" src="' + escapeHtml(r.FOTO_ANTES) + '">' : '<p class="subtle">—</p>') + '</div>'));
        fotosRow.appendChild(el('<div class="stack" style="gap:4px"><span class="subtle">Depois</span>' + (r.FOTO_DEPOIS ? '<img class="photo-preview" src="' + escapeHtml(r.FOTO_DEPOIS) + '">' : '<p class="subtle">—</p>') + '</div>'));
        box.appendChild(fotosRow);
        listCard.appendChild(box);
      });
    }
  }
  load();
}

// ------------------------- RELATÓRIOS (CSV / PDF) -------------------------

const REPORTS = {
  checklists: {
    titulo: 'Checklists realizados', icone: '🧹', descricao: 'Todos os checklists de limpeza executados',
    action: 'getChecklists', getRows: function (rows) { return rows; },
    colunas: [['ID_CHECKLIST', 'ID'], ['DATA', 'Data'], ['HORA', 'Hora'], ['TURNO', 'Turno'], ['LOCAL', 'Local'], ['AMBIENTE', 'Ambiente'], ['ATIVIDADE', 'Atividade'], ['AGENTE', 'Agente'], ['RESULTADO', 'Resultado'], ['STATUS', 'Status'], ['ADMIN_VALIDADOR', 'Validado por']]
  },
  ocorrencias: {
    titulo: 'Ocorrências', icone: '⚠️', descricao: 'Todas as ocorrências registradas',
    action: 'getOcorrencias', getRows: function (rows) { return rows; },
    colunas: [['ID_OCORRENCIA', 'ID'], ['DATA', 'Data'], ['HORA', 'Hora'], ['TURNO', 'Turno'], ['LOCAL', 'Local'], ['AMBIENTE', 'Ambiente'], ['AGENTE', 'Agente'], ['DESCRICAO', 'Descrição'], ['STATUS', 'Status']]
  },
  naoConformidades: {
    titulo: 'Não conformidades', icone: '🔍', descricao: 'Inspeções da Qualidade direcionadas a agentes',
    action: 'getNaoConformidades', getRows: function (rows) { return rows; },
    colunas: [['ID_NC', 'ID'], ['DATA', 'Data'], ['HORA', 'Hora'], ['LOCAL', 'Local'], ['AMBIENTE', 'Ambiente'], ['DESCRICAO', 'Descrição'], ['AGENTE_RESPONSAVEL', 'Agente responsável'], ['ADMIN_ABRIU', 'Aberta por'], ['STATUS', 'Status'], ['MOTIVO_REPROVACAO', 'Motivo reprovação']]
  }
};

function renderRelatorios() {
  appendHtml(app, screenHeader('Relatórios', 'Baixe em CSV (Excel/Sheets) ou PDF') + '<div class="stack"></div>');
  const wrap = app.querySelector('.stack:last-child');
  Object.keys(REPORTS).forEach(function (key) {
    const r = REPORTS[key];
    const card = el(menuCard(r.icone, r.titulo, r.descricao, 'x'));
    card.onclick = function () { go('relatorioDetalhe', { tipoRelatorio: key }); };
    wrap.appendChild(card);
  });
}

async function renderRelatorioDetalhe() {
  const cfg = REPORTS[S.tipoRelatorio];
  appendHtml(app, screenHeader('Relatório · ' + cfg.titulo, 'Checklist da Qualidade'));

  const filterWrap = el('<div class="filters"><select id="fPeriodo"><option value="tudo">Todo o período</option><option value="semana">Esta semana</option><option value="mes">Este mês</option><option value="custom">Período personalizado</option></select></div>');
  app.appendChild(filterWrap);
  const customWrap = el('<div class="filters" id="customDates" style="display:none"><input type="date" id="fDataInicial"><input type="date" id="fDataFinal"><button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button></div>');
  app.appendChild(customWrap);
  const body = el('<div class="card stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const selPeriodo = document.getElementById('fPeriodo');
  selPeriodo.onchange = function () {
    customWrap.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;

  let ultimasLinhas = [];
  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const range = lerRangeFiltro();
    const rows = await api(cfg.action, { dataInicial: range.dataInicial, dataFinal: range.dataFinal }).catch(function () { return []; });
    body.innerHTML = '';
    ultimasLinhas = cfg.getRows(rows) || [];

    body.appendChild(el('<div class="row between"><span class="subtle">Registros encontrados</span><span class="badge-count">' + ultimasLinhas.length + '</span></div>'));

    const btnRow = el('<div class="row" style="gap:8px;margin-top:10px"></div>');
    body.appendChild(btnRow);
    const btnBaixar = el('<button class="btn btn--primary" style="flex:1">⬇ CSV</button>');
    const btnPDF = el('<button class="btn btn--accent" style="flex:1">📄 PDF</button>');
    btnRow.appendChild(btnBaixar);
    btnRow.appendChild(btnPDF);

    const descricaoPeriodo = selPeriodo.value === 'tudo' ? 'Todo o período'
      : selPeriodo.value === 'semana' ? 'Esta semana'
      : selPeriodo.value === 'mes' ? 'Este mês'
      : (range.dataInicial || '…') + ' até ' + (range.dataFinal || '…');

    btnBaixar.onclick = function () {
      if (!ultimasLinhas.length) { toast('Nenhum registro para baixar com esses filtros', true); return; }
      const nomeArquivo = 'relatorio_' + S.tipoRelatorio + '_' + dateToBR(new Date()).replace(/\//g, '-') + '.csv';
      downloadCSV(nomeArquivo, cfg.colunas, ultimasLinhas);
    };
    btnPDF.onclick = async function () {
      if (!ultimasLinhas.length) { toast('Nenhum registro para baixar com esses filtros', true); return; }
      btnPDF.disabled = true; btnPDF.textContent = 'Gerando…';
      try {
        const resultado = await api('gerarRelatorioPDF', {
          titulo: cfg.titulo, periodo: descricaoPeriodo,
          colunas: cfg.colunas.map(function (c) { return c[1]; }),
          chaves: cfg.colunas.map(function (c) { return c[0]; }),
          linhas: ultimasLinhas
        });
        downloadBase64File(resultado.filename, resultado.base64, 'application/pdf');
        toast('PDF gerado!', false, true);
      } catch (e) { /* toast já mostrado */ }
      btnPDF.disabled = false; btnPDF.textContent = '📄 PDF';
    };

    if (ultimasLinhas.length) {
      body.appendChild(el('<div class="divider" style="margin-top:6px"></div>'));
      body.appendChild(el('<p class="subtle">Pré-visualização (10 primeiros registros):</p>'));
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      body.appendChild(tableWrap);
      tableWrap.appendChild(buildPreviewTable(cfg.colunas, ultimasLinhas.slice(0, 10)));
    }
  }
  load();
}

function buildPreviewTable(colunas, linhas) {
  const table = document.createElement('table');
  table.className = 'report-table';
  const thead = document.createElement('tr');
  colunas.forEach(function (c) { thead.appendChild(el('<th>' + escapeHtml(c[1]) + '</th>')); });
  table.appendChild(thead);
  linhas.forEach(function (linha) {
    const tr = document.createElement('tr');
    colunas.forEach(function (c) { tr.appendChild(el('<td>' + escapeHtml(linha[c[0]]) + '</td>')); });
    table.appendChild(tr);
  });
  return table;
}

function downloadCSV(filename, colunas, linhas) {
  const esc = function (v) {
    v = v === undefined || v === null ? '' : String(v);
    if (v.indexOf(',') > -1 || v.indexOf('"') > -1 || v.indexOf('\n') > -1) {
      v = '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };
  const lines = [colunas.map(function (c) { return esc(c[1]); }).join(',')];
  linhas.forEach(function (linha) {
    lines.push(colunas.map(function (c) { return esc(linha[c[0]]); }).join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Relatório baixado!', false, true);
}

function downloadBase64File(filename, base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}