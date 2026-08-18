/* =====================================================
   CHECKLIST DA QUALIDADE — ICC Brazil Animal Nutrition
   FRONTEND — SPA em JS puro (sem build), mesmo padrão do sistema de
   Gestão de Armazéns. Fala com o backend Apps Script via fetch().
   Sessão fica só em memória (sem localStorage).
   ===================================================== */

// >>> COLE AQUI A URL DO SEU APPS SCRIPT WEB APP <<<
const API_URL = https://script.google.com/a/macros/iccbrazil.com.br/s/AKfycbzapb-DouX5q5GN0mqH7jV8uxu3_itDtTeZANDKZqeSbg3uauw4McuXH-a_ffKiCtRa/exec

const OCORRENCIA_STATUS_LABEL = {
  ABERTA: { label: 'Aberta', cls: 'aberta' },
  EM_ANALISE: { label: 'Em análise', cls: 'tratamento' },
  PROCEDENTE: { label: 'Procedente', cls: 'validacao' },
  NAO_PROCEDENTE: { label: 'Não procedente', cls: 'finalizada' },
  TRATADA: { label: 'Tratada', cls: 'validacao' },
  ENCERRADA: { label: 'Encerrada', cls: 'finalizada' }
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
  document.getElementById('topbar').hidden = true;
  document.getElementById('tabbar').hidden = true;
}

// ------------------------- UI HELPERS -------------------------

const app = document.getElementById('app');

function go(screen, extra) {
  S.screen = screen;
  if (extra) Object.assign(S, extra);
  render();
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
    agenteHome: renderAgenteHome,
    novoChecklist: renderNovoChecklist,
    meusChecklists: renderMeusChecklists,
    abrirOcorrencia: renderAbrirOcorrencia,
    minhasOcorrencias: renderMinhasOcorrencias,
    historicoAgente: renderHistoricoAgente,
    adminHome: renderAdminHome,
    validacaoChecklists: renderValidacaoChecklists,
    checklistDetalheAdmin: renderChecklistDetalheAdmin,
    validacaoOcorrencias: renderValidacaoOcorrencias,
    ocorrenciaDetalheAdmin: renderOcorrenciaDetalheAdmin,
    dashChecklist: renderDashChecklist,
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
        { s: 'dashChecklist', ic: '📊', label: 'Dashboard' }
      ]
    : [
        { s: 'agenteHome', ic: '🏠', label: 'Início' },
        { s: 'novoChecklist', ic: '🧹', label: 'Checklist' },
        { s: 'abrirOcorrencia', ic: '⚠️', label: 'Ocorrência' },
        { s: 'historicoAgente', ic: '🕘', label: 'Histórico' }
      ];
  tabbar.innerHTML = tabs.map(function (t) {
    const active = S.screen === t.s ? ' is-active' : '';
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
      '<div class="card stack" id="usuariosList"><p class="subtle">Carregando usuários…</p></div>' +
    '</div>'
  );
  try {
    const usuarios = await api('getUsuarios', {});
    const wrap = document.getElementById('usuariosList');
    wrap.innerHTML = '';
    if (!usuarios.length) { wrap.innerHTML = '<p class="subtle">Nenhum usuário ativo cadastrado.</p>'; return; }
    usuarios.forEach(function (u) {
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="list-item__title">' + escapeHtml(u.NOME) + '</span>' +
          '<div class="list-item__sub">' + (u.PERFIL === 'ADMIN_QUALIDADE' ? 'Administrador da Qualidade' : 'Agente de Limpeza') + '</div></span><span>›</span>' +
        '</button>'
      );
      item.onclick = function () {
        if (u.PERFIL === 'ADMIN_QUALIDADE') { go('loginSenha', { pendingUser: u }); }
        else { S.usuario = u; go('agenteHome'); }
      };
      wrap.appendChild(item);
    });
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
  appendHtml(app, screenHeader('Abrir ocorrência', 'Registrar não conformidade'));
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const turnoSel = await selectFieldAsync(card, 'getTurnos', 'TURNO', 'Turno');
  const localSel = await selectFieldAsync(card, 'getLocais', 'LOCAL', 'Local');
  const ambienteWrap = el('<div class="field"><label>Ambiente</label><select disabled><option>Selecione o local primeiro…</option></select></div>');
  card.appendChild(ambienteWrap);
  let ambienteSelect = ambienteWrap.querySelector('select');

  localSel.select.addEventListener('change', async function () {
    const ambientes = await api('getAmbientes', { local: localSel.select.value }).catch(function () { return []; });
    ambienteWrap.innerHTML = '<label>Ambiente</label><select id="selAmbiente"><option value="">Selecione…</option>' +
      ambientes.map(function (a) { return '<option value="' + escapeHtml(a.AMBIENTE) + '">' + escapeHtml(a.AMBIENTE) + '</option>'; }).join('') + '</select>';
    ambienteSelect = ambienteWrap.querySelector('select');
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
        turno: turnoSel.select.value, local: localSel.select.value, ambiente: ambienteSelect.value,
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
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span><span class="shiplabel">' + escapeHtml(o.ID_OCORRENCIA) + '</span>' +
        '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(o.LOCAL) + ' — ' + escapeHtml(o.AMBIENTE) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(o.DATA) + ' ' + escapeHtml(o.HORA) + ' · ' + escapeHtml(o.AGENTE) + '</div></span>' +
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
    '</div>'
  );
  app.appendChild(tabsWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const hist = await api('getHistoricoAgente', { idAgente: S.usuario.ID_USUARIO }).catch(function () { return { checklists: [], ocorrencias: [] }; });

  function showTab(tab) {
    tabsWrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
    if (tab === 'checklists') renderChecklistsList(listWrap, hist.checklists);
    else renderOcorrenciasList(listWrap, hist.ocorrencias);
  }
  tabsWrap.querySelectorAll('button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  showTab('checklists');
}

// ------------------------- ADMIN: HOME (painel do dia) -------------------------

async function renderAdminHome() {
  appendHtml(app, screenHeader('Painel da Qualidade', 'Olá, ' + S.usuario.NOME));
  const body = el('<div class="stack" id="body" style="margin-top:4px"><p class="subtle">Carregando painel do dia…</p></div>');
  app.appendChild(body);

  const painel = await api('getPainelHoje', {}).catch(function () { return null; });
  body.innerHTML = '';
  if (painel) {
    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(painel.total, 'Previstas hoje') +
        kpi(painel.realizados, 'Realizadas') +
        kpi(painel.pendentes, 'Pendentes') +
        kpi(painel.data, 'Data') +
      '</div>'
    ));
    if (painel.pendentes > 0) {
      const pendCard = el('<div class="card stack"><h3 class="title-lg">Ainda pendentes hoje</h3></div>');
      body.appendChild(pendCard);
      painel.itens.filter(function (i) { return !i.realizado; }).slice(0, 15).forEach(function (i) {
        pendCard.appendChild(el(
          '<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)">' +
            '<span><strong>' + escapeHtml(i.atividade) + '</strong><div class="subtle">' + escapeHtml(i.local) + ' · ' + escapeHtml(i.ambiente) + (i.turno ? ' · ' + escapeHtml(i.turno) : '') + '</div></span>' +
            '<span class="tag tag--aberta">Pendente</span>' +
          '</div>'
        ));
      });
    }
  }

  appendHtml(app, '<div class="stack" style="margin-top:14px">' +
    menuCard('✅', 'Validar checklists', 'Aprovar ou reprovar limpezas enviadas', 'validacaoChecklists') +
    menuCard('⚠️', 'Validar ocorrências', 'Analisar não conformidades registradas', 'validacaoOcorrencias') +
    menuCard('📊', 'Dashboard da qualidade', 'Indicadores gerais de cumprimento', 'dashChecklist') +
    menuCard('⚠️', 'Dashboard de ocorrências', 'Indicadores das ocorrências', 'dashOcorrencias') +
    menuCard('📷', 'Evidências fotográficas', 'Indicadores de fotos antes/depois', 'dashFotos') +
    menuCard('📄', 'Relatórios', 'Exportar dados em CSV ou PDF', 'relatorios') +
  '</div>');
  bindMenuCards();
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
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const rows = await api('getChecklists', {
      status: document.getElementById('fStatus').value,
      resultado: document.getElementById('fResultado').value
    }).catch(function () { return []; });
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧹</span>Nenhum checklist encontrado.</div>')); return; }
    rows.forEach(function (c) {
      const st = CHECKLIST_STATUS_LABEL[c.STATUS] || { label: c.STATUS, cls: 'aberta' };
      const resultadoTag = c.RESULTADO === 'NAO_CONFORME' ? '<span style="color:var(--st-risco);font-weight:600">⚠ Não conforme</span>' : '<span style="color:var(--st-finalizada)">✓ Conforme</span>';
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="shiplabel">' + escapeHtml(c.ID_CHECKLIST) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(c.ATIVIDADE) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(c.LOCAL) + ' · ' + escapeHtml(c.AMBIENTE) + ' · ' + escapeHtml(c.AGENTE) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(c.DATA) + ' ' + escapeHtml(c.HORA) + ' · ' + resultadoTag + '</div></span>' +
          '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('checklistDetalheAdmin', { checklistAtual: c }); };
      listWrap.appendChild(item);
    });
  }
  document.getElementById('fStatus').onchange = load;
  document.getElementById('fResultado').onchange = load;
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
  card.appendChild(el('<div class="row between"><span class="subtle">Agente</span><strong>' + escapeHtml(o.AGENTE) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Turno / Data</span><strong>' + escapeHtml(o.TURNO || '-') + ' · ' + escapeHtml(o.DATA) + ' ' + escapeHtml(o.HORA) + '</strong></div>'));
  card.appendChild(el('<p class="subtle">' + escapeHtml(o.DESCRICAO) + '</p>'));
  if (o.FOTO) card.appendChild(el('<img class="photo-preview" src="' + escapeHtml(o.FOTO) + '">'));

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

async function renderDashChecklist() {
  appendHtml(app, screenHeader('Dashboard da Qualidade', 'Checklist da Qualidade'));
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

    let comparativo = '';
    if (selPeriodo.value !== 'tudo') {
      const rAnt = periodoAnteriorRange(range);
      if (rAnt) {
        const dAnt = await api('getDashboardChecklist', { local: selLocal.value, ambiente: selAmbiente.value, turno: selTurno.value, dataInicial: rAnt.dataInicial, dataFinal: rAnt.dataFinal }).catch(function () { return null; });
        if (dAnt) comparativo = comparativoBadge(d.naoConformidades, dAnt.naoConformidades, true);
      }
    }

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.totalPrevisto, 'Previstos') +
        kpi(d.realizados, 'Realizados') +
        kpi(d.pendentes, 'Pendentes') +
        kpi(d.atrasados, 'Atrasados') +
        kpi(d.aprovados, 'Aprovados') +
        kpi(d.reprovados, 'Reprovados') +
        kpi(d.percentualCumprimento + '%', '% Cumprimento') +
        kpi(d.percentualAprovacao + '%', '% Aprovação') +
      '</div>'
    ));
    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.naoConformidades, 'Não conformidades') +
        kpi(d.totalOcorrencias, 'Ocorrências no período') +
      '</div>'
    ));
    if (comparativo) body.appendChild(el('<div style="margin-top:-4px">' + comparativo + '</div>'));

    body.appendChild(barCard('Realizados por Agente de Limpeza', d.porAgente));
    body.appendChild(barCard('Realizados por Local', d.porLocal));
    body.appendChild(barCard('Realizados por Ambiente', d.porAmbiente));
    body.appendChild(barCard('Realizados por Turno', d.porTurno));
    body.appendChild(barCard('Ocorrências por Local (locais com mais problemas)', d.ocorrenciasPorLocal));
    body.appendChild(barCard('Ocorrências por Ambiente', d.ocorrenciasPorAmbiente));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Registros recentes</h3></div>');
      body.appendChild(listCard);
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      listCard.appendChild(tableWrap);
      const recentes = d.registros.slice().sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); }).slice(0, 15);
      tableWrap.appendChild(buildPreviewTable(
        [['DATA', 'Data'], ['LOCAL', 'Local'], ['AMBIENTE', 'Ambiente'], ['ATIVIDADE', 'Atividade'], ['AGENTE', 'Agente'], ['RESULTADO', 'Resultado'], ['STATUS', 'Status']],
        recentes
      ));
    }
  }
  load();
}

// ------------------------- DASHBOARD — OCORRÊNCIAS -------------------------

async function renderDashOcorrencias() {
  appendHtml(app, screenHeader('Dashboard de Ocorrências', 'Checklist da Qualidade'));
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
        kpi(d.pendentes, 'Pendentes') +
        kpi(d.procedentes, 'Procedentes') +
        kpi(d.naoProcedentes, 'Não procedentes') +
      '</div>'
    ));
    body.appendChild(barCard('Por Agente de Limpeza', d.porAgente));
    body.appendChild(barCard('Por Local', d.porLocal));
    body.appendChild(barCard('Por Ambiente', d.porAmbiente));
    body.appendChild(barCard('Por Turno', d.porTurno));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Ocorrências recentes</h3></div>');
      body.appendChild(listCard);
      const inner = el('<div class="stack"></div>');
      listCard.appendChild(inner);
      renderOcorrenciasList(inner, d.registros.slice(0, 12), function (o) { go('ocorrenciaDetalheAdmin', { ocorrenciaAtual: o }); });
    }
  }
  load();
}

// ------------------------- DASHBOARD — EVIDÊNCIAS FOTOGRÁFICAS -------------------------

async function renderDashFotos() {
  appendHtml(app, screenHeader('Evidências Fotográficas', 'Checklist da Qualidade'));
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
