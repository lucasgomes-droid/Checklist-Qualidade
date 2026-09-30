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
//
// Camada de dados otimizada para o app responder como um app nativo, mesmo
// com o Apps Script levando 1–4 s por chamada:
//
// 1) CADASTROS LOCAIS (usuários ativos, locais, ambientes, turnos,
//    atividades): vêm todos juntos numa única chamada (getBootstrap), ficam
//    salvos no aparelho (localStorage) e são respondidos NA HORA — a tela de
//    login e todo o wizard de checklist abrem sem esperar a planilha. Em
//    segundo plano o app confere se algo mudou e atualiza sozinho.
// 2) DEMAIS LEITURAS (listas, painel, dashboards): ficam em memória. Se o
//    dado tem menos de 15 s, responde na hora; se é mais antigo, mostra o
//    que já tinha NA HORA e busca a versão nova em segundo plano — se mudou
//    e o usuário não mexeu na tela, ela se atualiza sozinha; se mexeu,
//    aparece o aviso "Dados novos · Atualizar".
// 3) Chamadas iguais ao mesmo tempo viram UMA só (sem duplicar requisição).
// 4) Guarda de corrida: se o usuário troca de tela antes da resposta chegar,
//    a resposta velha é descartada (antes ela era desenhada na tela nova).
// 5) ENVIOS EM SEGUNDO PLANO (checklist, ocorrência, resolução, validações):
//    o app volta para a tela seguinte na hora e envia numa fila que
//    sobrevive a queda de internet e a fechar o app (IndexedDB), com
//    reenvio automático. O resultado já aparece nas listas imediatamente.

let renderGen = 0;          // incrementa a cada render(): identifica "a tela atual"
let lastRenderAt = 0;
let lastInteractionAt = 0;

const _cache = new Map();   // chave -> { v: dados, s: json-texto, t: timestamp, stale: bool }
const _inflight = new Map(); // chave -> Promise (dedupe)
const FRESH_MS = 15000;               // até aqui responde do cache sem ir ao servidor
const STALE_MAX_MS = 30 * 60 * 1000;  // até aqui mostra o cache na hora e revalida por trás
const READ_TIMEOUT_MS = 45000;

const REF_ACTIONS = ['getUsuarios', 'getLocais', 'getAmbientes', 'getTurnos', 'getAtividades'];
const ACOES_NAO_MUTAM = ['loginAdmin', 'loginAgente', 'gerarRelatorioPDF', 'ping'];
const ACOES_ALTERAM_CADASTRO = [
  'createUsuario', 'updateUsuario', 'atualizarStatusUsuario', 'excluirUsuario',
  'createAtividade', 'createAtividadesLote', 'updateAtividade', 'atualizarStatusAtividade', 'excluirAtividade',
  'createLocal', 'renomearLocal', 'atualizarStatusLocal', 'createAmbiente', 'renomearAmbiente', 'atualizarStatusAmbiente'
];

let _lastNetAt = 0; // última vez que falamos com o servidor (p/ "aquecer" antes do login)

function cleanParams(obj) {
  const out = {};
  Object.keys(obj || {}).sort().forEach(function (k) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') out[k] = v;
  });
  return out;
}
// Mantido por compatibilidade com trechos antigos
function flattenParams(obj) { return cleanParams(obj); }

function cacheKey(action, payload) {
  return action + ':' + JSON.stringify(cleanParams(payload));
}

function checarApiUrl() {
  if (API_URL.includes('COLE_A_URL')) {
    toast('Configure a API_URL em app.js (veja SETUP.md)', true);
    throw new Error('API_URL não configurada');
  }
}

// --- barra de progresso fina no topo (feedback imediato de "carregando") ---
let _progressCount = 0;
function progressStart() {
  _progressCount++;
  const b = document.getElementById('netbar');
  if (b) b.classList.add('is-on');
}
function progressEnd() {
  _progressCount = Math.max(0, _progressCount - 1);
  if (_progressCount === 0) {
    const b = document.getElementById('netbar');
    if (b) b.classList.remove('is-on');
  }
}

class ServerError extends Error {} // servidor respondeu ok:false (não é falha de rede)

// Chamada HTTP crua. Retorna { data, text } (text = JSON bruto, usado para
// comparar se uma revalidação trouxe algo diferente).
async function httpCall(action, payload, isRead, opts) {
  checarApiUrl();
  opts = opts || {};
  if (!opts.background) progressStart();
  let timer = null;
  try {
    let res;
    if (isRead) {
      const qs = new URLSearchParams(Object.assign({ action: action }, cleanParams(payload))).toString();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, READ_TIMEOUT_MS);
      res = await fetch(API_URL + '?' + qs, ctrl ? { signal: ctrl.signal } : undefined);
    } else {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
        body: JSON.stringify({ action: action, payload: payload })
      });
    }
    const text = await res.text();
    _lastNetAt = Date.now();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('Resposta inválida do servidor'); }
    if (!json.ok) throw new ServerError(json.error || 'Erro desconhecido');
    // devolve só o trecho "data" como texto de comparação
    return { data: json.data, text: text };
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('A planilha demorou demais para responder. Tente de novo.');
    if (err instanceof ServerError) throw err;
    if (err && err.message === 'API_URL não configurada') throw err;
    throw new Error(err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Sem conexão com a planilha. Verifique a internet.');
  } finally {
    if (timer) clearTimeout(timer);
    if (!opts.background) progressEnd();
  }
}

// Leitura com dedupe + aplicação das alterações ainda pendentes na fila
// (assim uma revalidação não "desfaz" na tela algo que o usuário já fez).
function fetchRead(action, payload, opts) {
  const key = cacheKey(action, payload);
  if (_inflight.has(key)) return _inflight.get(key);
  const p = httpCall(action, payload, true, opts).then(function (r) {
    const data = aplicarPatchesPendentes(r.data, cleanParams(payload));
    const prev = _cache.get(key);
    const entry = { v: data, s: r.text, t: Date.now(), stale: false };
    _cache.set(key, entry);
    return { data: data, changed: !prev || prev.s !== r.text };
  }).finally(function () { _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
}

const NUNCA = new Promise(function () {}); // promessa que nunca resolve (descarta resposta de tela antiga)

async function api(action, payload, opts) {
  opts = opts || {};
  payload = payload || {};

  if (REF_ACTIONS.indexOf(action) > -1 && !_semBootstrap) {
    return refRead(action, payload, opts);
  }

  const isRead = action.indexOf('get') === 0 || action === 'ping';
  if (isRead) {
    const gen = renderGen;
    const key = cacheKey(action, payload);
    const hit = _cache.get(key);
    const age = hit ? Date.now() - hit.t : Infinity;
    if (hit && !hit.stale && age < FRESH_MS) return hit.v;
    if (hit && age < STALE_MAX_MS) {
      // Mostra o que já temos NA HORA e confere a versão nova por trás.
      fetchRead(action, payload, { background: true }).then(function (r) {
        if (r.changed) avisarDadosNovos(gen);
      }).catch(function () {});
      return hit.v;
    }
    try {
      const r = await fetchRead(action, payload, opts);
      if (!opts.noGate && gen !== renderGen) return NUNCA;
      return r.data;
    } catch (err) {
      if (!opts.silent && (opts.noGate || gen === renderGen)) toast(err.message || 'Erro de conexão com a planilha', true);
      if (!opts.noGate && gen !== renderGen) return NUNCA;
      throw err;
    }
  }

  // ---- gravação síncrona (cadastros, login, PDF) ----
  try {
    const r = await httpCall(action, payload, false, opts);
    if (ACOES_NAO_MUTAM.indexOf(action) === -1) {
      _cache.clear();
      if (ACOES_ALTERAM_CADASTRO.indexOf(action) > -1) invalidarRef();
    }
    return r.data;
  } catch (err) {
    if (!opts.silent) toast(err.message || 'Erro de conexão com a planilha', true);
    throw err;
  }
}

// Marca tudo que está em memória como "precisa conferir" (continua sendo
// mostrado na hora, mas é revalidado na próxima vez que for usado).
function marcarCacheComoAntigo() {
  _cache.forEach(function (e) { e.stale = true; });
}

// ------------------------- CADASTROS LOCAIS (bootstrap) -------------------------

const REF_STORAGE_KEY = 'icc_checklist_ref_v1';
const REF_REVALIDAR_MS = 60000;
let REF = carregarRefSalvo();
let _refPromise = null;
let _refSujo = false;
let _semBootstrap = false; // backend antigo sem getBootstrap: cai no modo antigo

function carregarRefSalvo() {
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.d || API_URL !== obj.u) return null;
    obj.t = 0; // sempre revalida ao abrir o app
    return obj;
  } catch (e) { return null; }
}

function salvarRef() {
  try { localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ d: REF.d, s: REF.s, u: API_URL })); } catch (e) { /* sem espaço/privado: só não persiste */ }
}

function invalidarRef() { _refSujo = true; refreshRef(renderGen).catch(function () {}); }

function refreshRef(gen) {
  if (_refPromise) return _refPromise;
  const tinhaAntes = !!REF;
  _refPromise = httpCall('getBootstrap', {}, true, { background: tinhaAntes && !_refSujo }).then(function (r) {
    const mudou = !REF || REF.s !== r.text;
    REF = { d: r.data, s: r.text, t: Date.now() };
    _refSujo = false;
    salvarRef();
    if (mudou && tinhaAntes) avisarDadosNovos(gen);
    return REF;
  }).catch(function (err) {
    if (err instanceof ServerError && /desconhecida/i.test(err.message)) {
      _semBootstrap = true; // Code.gs ainda não foi atualizado
    }
    throw err;
  }).finally(function () { _refPromise = null; });
  return _refPromise;
}

async function refRead(action, payload, opts) {
  const gen = renderGen;
  if (!REF || _refSujo) {
    try {
      await refreshRef(gen);
    } catch (err) {
      if (_semBootstrap) return api(action, payload, opts); // modo compatível
      if (!REF) {
        if (!opts.silent && (opts.noGate || gen === renderGen)) toast(err.message, true);
        throw err;
      }
      // sem internet mas com cadastro salvo: segue com o que tem
    }
    if (!opts.noGate && gen !== renderGen) return NUNCA;
  } else if (Date.now() - REF.t > REF_REVALIDAR_MS) {
    refreshRef(gen).catch(function () {});
  }
  return selecionarRef(action, payload);
}

function selecionarRef(action, p) {
  const d = REF.d;
  const eq = function (a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); };
  switch (action) {
    case 'getUsuarios': return d.usuarios.slice();
    case 'getLocais': return d.locais.slice();
    case 'getTurnos': return d.turnos.slice();
    case 'getAmbientes':
      return d.ambientes.filter(function (a) { return !p.local || eq(a.LOCAL, p.local); });
    case 'getAtividades':
      return d.atividades.filter(function (a) {
        return eq(a.LOCAL, p.local) && eq(a.AMBIENTE, p.ambiente) && eq(grupoPeriodicidade(a.PERIODICIDADE), grupoPeriodicidade(p.periodicidade)) &&
          atividadeValeNoTurno(a, p.turno);
      });
  }
  return [];
}

// ------------------------- ATUALIZAÇÃO AUTOMÁTICA DA TELA -------------------------

let _rerenderAgendado = false;
function avisarDadosNovos(gen) {
  if (gen !== renderGen || !S.usuario && S.screen !== 'loginUsuario') return;
  const ativo = document.activeElement;
  const digitando = ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName);
  if (lastInteractionAt > lastRenderAt || digitando) {
    mostrarPillAtualizar();
    return;
  }
  if (_rerenderAgendado) return;
  _rerenderAgendado = true;
  setTimeout(function () {
    _rerenderAgendado = false;
    if (gen !== renderGen) return;
    rerenderMantendoScroll();
  }, 60);
}

function rerenderMantendoScroll() {
  const y = window.scrollY;
  esconderPillAtualizar();
  render();
  requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo(0, y); }); });
}

function mostrarPillAtualizar() {
  const p = document.getElementById('pillAtualizar');
  if (!p) return;
  p.hidden = false;
  p.onclick = rerenderMantendoScroll;
}
function esconderPillAtualizar() {
  const p = document.getElementById('pillAtualizar');
  if (p) p.hidden = true;
}

// ------------------------- PRÉ-CARREGAMENTO -------------------------

// Acorda o Apps Script (a 1ª chamada depois de um tempo parado é a mais
// lenta) enquanto o usuário ainda está digitando PIN/senha.
function aquecerServidor() {
  if (Date.now() - _lastNetAt < 60000) return;
  _lastNetAt = Date.now();
  httpCall('ping', {}, true, { background: true }).catch(function () {});
}

// Logo depois do login, já busca em paralelo o que as abas principais vão
// precisar — quando o usuário tocar nelas, os dados já estão prontos.
function preCarregarPosLogin() {
  const u = S.usuario;
  if (!u) return;
  const o = { noGate: true, silent: true, background: true };
  const pre = function (action, payload) { api(action, payload, o).catch(function () {}); };
  if (u.PERFIL === 'ADMIN_QUALIDADE') {
    pre('getPainelHoje', {});
    pre('getChecklists', { status: 'PENDENTE_VALIDACAO' });
    pre('getOcorrencias', { status: 'ABERTA' });
    pre('getNaoConformidades', { status: 'ABERTA' });
    pre('getUsuariosAdmin', {});
  } else {
    pre('getPendenciasRefazer', { idAgente: u.ID_USUARIO });
    pre('getNaoConformidades', { idAgenteResponsavel: u.ID_USUARIO });
    pre('getHistoricoAgente', { idAgente: u.ID_USUARIO });
  }
}

// ------------------------- ALTERAÇÕES OTIMISTAS -------------------------
// Enquanto um envio está na fila, a alteração que ele faz (ex.: checklist
// aprovado) já é aplicada em todas as listas em memória, e continua sendo
// aplicada por cima de qualquer resposta que chegar do servidor até o envio
// ser confirmado.

let _patches = []; // { itemId, campo, ids:{}, updates }

function aplicarPatchNaLista(rows, patch, params, removerSeFiltroNaoBate) {
  if (!Array.isArray(rows)) return rows;
  let out = rows;
  let mudou = false;
  const novo = [];
  rows.forEach(function (r) {
    if (r && patch.ids[String(r[patch.campo])]) {
      Object.assign(r, patch.updates);
      mudou = true;
      if (removerSeFiltroNaoBate && params.status && r.STATUS !== params.status) return;
    }
    novo.push(r);
  });
  if (mudou) out = novo;
  return out;
}

function aplicarPatchesPendentes(data, params) {
  if (!_patches.length || data == null) return data;
  _patches.forEach(function (p) {
    if (Array.isArray(data)) {
      data = aplicarPatchNaLista(data, p, params || {}, true);
    } else if (typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        if (Array.isArray(data[k])) data[k] = aplicarPatchNaLista(data[k], p, {}, false);
      });
    }
  });
  return data;
}

function registrarPatch(itemId, campo, ids, updates) {
  const idMap = {};
  ids.forEach(function (id) { idMap[String(id)] = true; });
  const patch = { itemId: itemId, campo: campo, ids: idMap, updates: updates };
  _patches.push(patch);
  // aplica já no que está em memória
  _cache.forEach(function (entry, key) {
    const params = JSON.parse(key.slice(key.indexOf(':') + 1));
    if (Array.isArray(entry.v)) entry.v = aplicarPatchNaLista(entry.v, patch, params, true);
    else if (entry.v && typeof entry.v === 'object') {
      Object.keys(entry.v).forEach(function (k) {
        if (Array.isArray(entry.v[k])) entry.v[k] = aplicarPatchNaLista(entry.v[k], patch, {}, false);
      });
    }
  });
}

function removerPatches(itemId) {
  _patches = _patches.filter(function (p) { return p.itemId !== itemId; });
}

function agoraBR() {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return dateToBR(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Como cada tipo de envio se reflete nas listas enquanto não é confirmado.
function patchDoEnvio(action, p) {
  switch (action) {
    case 'validarChecklist':
      return { campo: 'ID_CHECKLIST', ids: [p.idChecklist], updates: {
        STATUS: p.aprovado ? 'APROVADO' : 'REPROVADO', ADMIN_VALIDADOR: p.adminValidador || '', DATA_VALIDACAO: agoraBR(),
        MOTIVO_REPROVACAO: p.aprovado ? '' : (p.motivo || ''), REFAZER: p.aprovado ? 'NAO' : (p.refazer ? 'SIM' : 'NAO')
      } };
    case 'aprovarChecklistsLote':
      return { campo: 'ID_CHECKLIST', ids: p.idsChecklist || [], updates: {
        STATUS: 'APROVADO', ADMIN_VALIDADOR: p.adminValidador || '', DATA_VALIDACAO: agoraBR(), MOTIVO_REPROVACAO: '', REFAZER: 'NAO'
      } };
    case 'validarOcorrencia':
      return { campo: 'ID_OCORRENCIA', ids: [p.idOcorrencia], updates: {
        STATUS: p.procedente ? 'PROCEDENTE' : 'NAO_PROCEDENTE', ADMIN_ANALISE: p.adminAnalise || '', DATA_ANALISE: agoraBR(),
        RESULTADO_ANALISE: p.procedente ? 'PROCEDENTE' : 'NAO_PROCEDENTE', OBSERVACAO_ANALISE: p.observacao || ''
      } };
    case 'atualizarStatusOcorrencia':
      return { campo: 'ID_OCORRENCIA', ids: [p.idOcorrencia], updates: { STATUS: p.status } };
    case 'validarNaoConformidade':
      return { campo: 'ID_NC', ids: [p.idNc], updates: {
        STATUS: p.aprovado ? 'FINALIZADA' : 'ABERTA', ADMIN_VALIDADOR: p.adminValidador || '', DATA_VALIDACAO: agoraBR(),
        MOTIVO_REPROVACAO: p.aprovado ? '' : (p.motivo || '')
      } };
    case 'resolverNaoConformidade':
      return { campo: 'ID_NC', ids: [p.idNc], updates: {
        STATUS: 'AGUARDANDO_VALIDACAO', DESCRICAO_RESOLUCAO: p.descricaoResolucao || '',
        FOTO_RESOLUCAO: p.fotoResolucao || '', DATA_RESOLUCAO: agoraBR()
      } };
  }
  return null;
}

// ------------------------- FILA DE ENVIO (outbox) -------------------------

const OUTBOX_DB = 'icc_checklist_outbox';
let outbox = [];
let _outboxProcessando = false;
let _outboxTimer = null;
let _idb = null;

function novoIdLocal() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function abrirIdb() {
  if (_idb) return _idb;
  _idb = new Promise(function (resolve) {
    try {
      const req = indexedDB.open(OUTBOX_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('itens', { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
  return _idb;
}

async function idbOp(mode, fn) {
  const db = await abrirIdb();
  if (!db) return null;
  return new Promise(function (resolve) {
    try {
      const tx = db.transaction('itens', mode);
      const r = fn(tx.objectStore('itens'));
      tx.oncomplete = function () { resolve(r && r.result); };
      tx.onerror = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
}

async function carregarOutboxSalvo() {
  const itens = await idbOp('readonly', function (st) { return st.getAll(); });
  if (!itens || !itens.length) return;
  itens.sort(function (a, b) { return a.criadoEm - b.criadoEm; });
  itens.forEach(function (it) {
    if (outbox.some(function (o) { return o.id === it.id; })) return;
    it.falhou = false; it.tentativas = 0;
    outbox.push(it);
    const patch = patchDoEnvio(it.action, it.payload);
    if (patch) registrarPatch(it.id, patch.campo, patch.ids, patch.updates);
  });
  atualizarPillEnvio();
  processarOutbox();
}

// Coloca um envio na fila e já devolve o controle para a tela.
function enviarEmSegundoPlano(action, payload, rotulo, avisarAoConcluir) {
  const id = novoIdLocal();
  const item = {
    id: id, action: action, payload: Object.assign({}, payload, { clientReqId: id }),
    rotulo: rotulo, avisar: !!avisarAoConcluir, criadoEm: Date.now(), tentativas: 0, falhou: false, erro: ''
  };
  outbox.push(item);
  idbOp('readwrite', function (st) { return st.put(item); });
  const patch = patchDoEnvio(action, payload);
  if (patch) registrarPatch(id, patch.campo, patch.ids, patch.updates);
  marcarCacheComoAntigo();
  atualizarPillEnvio();
  processarOutbox();
  return id;
}

async function processarOutbox() {
  if (_outboxProcessando) return;
  _outboxProcessando = true;
  clearTimeout(_outboxTimer);
  try {
    while (outbox.length) {
      const item = outbox.find(function (o) { return !o.falhou; });
      if (!item) break;
      try {
        await httpCall(item.action, item.payload, false, { background: true });
        outbox = outbox.filter(function (o) { return o.id !== item.id; });
        idbOp('readwrite', function (st) { return st.delete(item.id); });
        removerPatches(item.id);
        marcarCacheComoAntigo();
        if (item.avisar) toast(item.rotulo + ' enviado com sucesso ✓', false, true);
        atualizarPillEnvio();
        if (!outbox.some(function (o) { return !o.falhou; })) avisarDadosNovos(renderGen); // atualiza a tela aberta com o dado confirmado
      } catch (err) {
        item.tentativas++;
        item.erro = err.message || 'Erro';
        // Erro de validação do servidor não se resolve sozinho: depois de 3
        // tentativas para e pede ação do usuário (reenviar ou descartar).
        if (err instanceof ServerError && item.tentativas >= 3) {
          item.falhou = true;
          toast(item.rotulo + ' não foi aceito: ' + item.erro, true);
          atualizarPillEnvio();
          continue;
        }
        atualizarPillEnvio();
        const espera = Math.min(60000, 4000 * Math.pow(2, Math.min(item.tentativas - 1, 4)));
        _outboxTimer = setTimeout(processarOutbox, espera);
        break;
      }
    }
  } finally {
    _outboxProcessando = false;
  }
}

function atualizarPillEnvio() {
  const pill = document.getElementById('pillEnvio');
  if (!pill) return;
  const pendentes = outbox.filter(function (o) { return !o.falhou; });
  const falhos = outbox.filter(function (o) { return o.falhou; });
  if (!outbox.length) { pill.hidden = true; fecharPainelEnvio(); return; }
  pill.hidden = false;
  if (falhos.length) {
    pill.className = 'pill pill--erro';
    pill.textContent = '⚠ ' + falhos.length + ' envio' + (falhos.length > 1 ? 's' : '') + ' com problema · toque';
  } else {
    const comErro = pendentes.some(function (o) { return o.tentativas > 0; });
    pill.className = 'pill' + (comErro ? ' pill--aviso' : '');
    pill.textContent = comErro
      ? '📶 Sem conexão · ' + pendentes.length + ' aguardando envio'
      : '⏳ Enviando ' + pendentes.length + '…';
  }
  pill.onclick = abrirPainelEnvio;
}

function abrirPainelEnvio() {
  fecharPainelEnvio();
  const painel = el('<div class="card stack envio-painel" id="painelEnvio"><div class="row between"><strong>Envios pendentes</strong><button type="button" class="btn btn--outline btn--sm" data-a="fechar">Fechar</button></div></div>');
  outbox.forEach(function (o) {
    const linha = el(
      '<div class="stack" style="gap:6px;padding:8px 0;border-top:1px solid var(--line)">' +
        '<div class="row between"><span>' + escapeHtml(o.rotulo) + '</span><span class="tag tag--' + (o.falhou ? 'aberta' : 'tratamento') + '">' + (o.falhou ? 'Falhou' : 'Na fila') + '</span></div>' +
        (o.erro ? '<span class="subtle">' + escapeHtml(o.erro) + '</span>' : '') +
        '<div class="row" style="gap:8px"><button type="button" class="btn btn--primary btn--sm" data-a="reenviar">Reenviar agora</button>' +
        (o.falhou ? '<button type="button" class="btn btn--danger btn--sm" data-a="descartar">Descartar</button>' : '') + '</div>' +
      '</div>'
    );
    linha.querySelector('[data-a="reenviar"]').onclick = function () {
      o.falhou = false; o.tentativas = 0; o.erro = '';
      atualizarPillEnvio(); fecharPainelEnvio(); processarOutbox();
    };
    const bDesc = linha.querySelector('[data-a="descartar"]');
    if (bDesc) bDesc.onclick = function () {
      outbox = outbox.filter(function (x) { return x.id !== o.id; });
      idbOp('readwrite', function (st) { return st.delete(o.id); });
      removerPatches(o.id);
      _cache.clear();
      atualizarPillEnvio(); fecharPainelEnvio();
      toast('Envio descartado.');
    };
    painel.appendChild(linha);
  });
  painel.querySelector('[data-a="fechar"]').onclick = fecharPainelEnvio;
  document.body.appendChild(painel);
}
function fecharPainelEnvio() {
  const p = document.getElementById('painelEnvio');
  if (p) p.remove();
}

window.addEventListener('online', function () {
  outbox.forEach(function (o) { if (!o.falhou) o.tentativas = 0; });
  processarOutbox();
});
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') processarOutbox();
});
window.addEventListener('beforeunload', function (e) {
  if (outbox.some(function (o) { return !o.falhou; })) {
    e.preventDefault();
    e.returnValue = 'Ainda há envios pendentes.';
    return e.returnValue;
  }
});

['click', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
  document.addEventListener(ev, function () { lastInteractionAt = Date.now(); }, { passive: true, capture: true });
});

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
  _cache.clear(); // dados do usuário anterior não ficam na memória para o próximo
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

// Ao voltar de uma tela de detalhe para a lista de onde veio, a lista volta
// na mesma posição de rolagem (como num app nativo), em vez de pular pro topo.
const TELA_PAI_DO_DETALHE = {
  checklistDetalheAdmin: 'validacaoChecklists',
  ocorrenciaDetalheAdmin: 'validacaoOcorrencias',
  naoConformidadeDetalheAdmin: 'naoConformidade',
  pendenciaNCDetalheAgente: 'minhasPendenciasNC',
  usuarioForm: 'gestaoUsuarios',
  atividadeForm: 'gestaoAtividades',
  painelDia: 'adminHome'
};
const _scrollPorTela = {};

function go(screen, extra) {
  const saindoDe = S.screen;
  _scrollPorTela[saindoDe] = window.scrollY;
  S.screen = screen;
  if (extra) Object.assign(S, extra);
  render();
  reiniciarTimerSessao();
  const voltandoParaLista = TELA_PAI_DO_DETALHE[saindoDe] === screen && _scrollPorTela[screen];
  if (voltandoParaLista) {
    const y = _scrollPorTela[screen];
    window.scrollTo(0, 0);
    requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo(0, y); }); });
  } else {
    window.scrollTo(0, 0);
  }
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

// Lista longa desenhada em partes: as primeiras linhas aparecem na hora e o
// restante sob demanda ("Mostrar mais"). Históricos com centenas/milhares de
// registros deixavam a tela travada alguns segundos montando tudo de uma vez.
const LISTA_PAGINA = 40;
function renderListaProgressiva(wrap, rows, criarItem) {
  let mostrados = 0;
  const btnMais = el('<button type="button" class="btn btn--outline btn--block btn--sm" style="margin-top:4px"></button>');
  function pagina() {
    const frag = document.createDocumentFragment();
    rows.slice(mostrados, mostrados + LISTA_PAGINA).forEach(function (r) { frag.appendChild(criarItem(r)); });
    mostrados = Math.min(rows.length, mostrados + LISTA_PAGINA);
    wrap.insertBefore(frag, btnMais.parentNode === wrap ? btnMais : null);
    const restantes = rows.length - mostrados;
    if (restantes > 0) {
      btnMais.textContent = 'Mostrar mais (' + restantes + ' restante' + (restantes > 1 ? 's' : '') + ')';
      if (btnMais.parentNode !== wrap) wrap.appendChild(btnMais);
    } else if (btnMais.parentNode === wrap) {
      wrap.removeChild(btnMais);
    }
  }
  btnMais.onclick = pagina;
  pagina();
}

// Fotos tiradas direto da câmera do celular costumam vir com vários MB cada
// — como o checklist pode ter foto antes E depois por atividade, isso deixa
// o envio (e o próprio salvamento no Drive pelo backend) bem mais lento em
// conexões de fábrica/campo. Antes de virar base64 para envio, a imagem é
// redesenhada num canvas em um tamanho máximo razoável para conferência
// visual (1600px no lado maior) e recomprimida como JPEG — normalmente
// reduz o tamanho de MB para poucas centenas de KB sem perda perceptível de
// qualidade para o que a Qualidade precisa ver (comparar antes/depois).
const FOTO_MAX_DIMENSAO = 1280;
const FOTO_QUALIDADE_JPEG = 0.7;

function dimensoesReduzidas_(w, h) {
  if (w > FOTO_MAX_DIMENSAO || h > FOTO_MAX_DIMENSAO) {
    if (w > h) { h = Math.round(h * FOTO_MAX_DIMENSAO / w); w = FOTO_MAX_DIMENSAO; }
    else { w = Math.round(w * FOTO_MAX_DIMENSAO / h); h = FOTO_MAX_DIMENSAO; }
  }
  return { w: w, h: h };
}

function comprimirImagem_(dataUrlOriginal) {
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () {
      if (!img.naturalWidth || !img.naturalHeight) { resolve(dataUrlOriginal); return; }
      const d = dimensoesReduzidas_(img.naturalWidth, img.naturalHeight);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = d.w; canvas.height = d.h;
        canvas.getContext('2d').drawImage(img, 0, 0, d.w, d.h);
        const comprimida = canvas.toDataURL('image/jpeg', FOTO_QUALIDADE_JPEG);
        // Só usa a versão comprimida se ela realmente ficou menor.
        resolve(comprimida.length < dataUrlOriginal.length ? comprimida : dataUrlOriginal);
      } catch (e) {
        resolve(dataUrlOriginal); // canvas indisponível/falhou: usa a foto original, sem travar o fluxo
      }
    };
    img.onerror = function () { resolve(dataUrlOriginal); };
    img.src = dataUrlOriginal;
  });
}

// Caminho rápido: decodifica a foto direto do arquivo (createImageBitmap,
// fora da thread principal na maioria dos celulares) já respeitando a
// orientação da câmera, sem antes converter a foto original de vários MB em
// base64. Em navegadores sem suporte, cai no caminho antigo.
async function fileToDataUrl(file) {
  if (window.createImageBitmap && file.type !== 'image/gif') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const d = dimensoesReduzidas_(bmp.width, bmp.height);
      const canvas = document.createElement('canvas');
      canvas.width = d.w; canvas.height = d.h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, d.w, d.h);
      if (bmp.close) bmp.close();
      const url = canvas.toDataURL('image/jpeg', FOTO_QUALIDADE_JPEG);
      if (url && url.indexOf('data:image/jpeg') === 0) return url;
    } catch (e) { /* segue pelo caminho antigo */ }
  }
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(comprimirImagem_(reader.result)); };
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
        const btnFoto = wrap.querySelector('[data-role="btn"]');
        if (btnFoto) btnFoto.textContent = '⏳ Processando foto…';
        try { dataUrl = await fileToDataUrl(file); } catch (err) { toast('Não foi possível ler a foto. Tente de novo.', true); }
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

// Desenha a primeira tela na hora (com os usuários salvos no aparelho, se
// houver) e, em paralelo, já acorda o servidor e confere os cadastros.
render();
refreshRef(renderGen).catch(function () {});
carregarOutboxSalvo();

// ------------------------- ROUTER -------------------------

function render() {
  renderGen++;
  lastRenderAt = Date.now();
  esconderPillAtualizar();
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
    dashGeral: renderDashGeral,
    relatorios: renderRelatorios,
    relatorioDetalhe: renderRelatorioDetalhe,
    resumoGerencial: renderResumoGerencial
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

    // Primeiro só os dois perfis (Agente de Limpeza / Administrador da
    // Qualidade); tocando num deles, abrem os nomes daquele grupo. Tocar de
    // novo (ou no outro perfil) fecha. Com um grupo só, ele já vem aberto.
    const grupos = [
      { chave: 'AGENTE_LIMPEZA', titulo: 'Agente de Limpeza', icone: '🧹', sub: 'Entrar com PIN' },
      { chave: 'ADMIN_QUALIDADE', titulo: 'Administrador da Qualidade', icone: '🛡️', sub: 'Entrar com senha' }
    ].map(function (g) { g.lista = usuarios.filter(function (u) { return u.PERFIL === g.chave; }); return g; })
     .filter(function (g) { return g.lista.length; });
    let aberto = grupos.length === 1 ? grupos[0].chave : (S.loginGrupoAberto || null);

    function desenhar() {
      wrap.innerHTML = '';
      grupos.forEach(function (g) {
        const estaAberto = aberto === g.chave;
        const card = el('<div class="card login-grupo' + (estaAberto ? ' is-open' : '') + '"></div>');
        const head = el(
          '<button type="button" class="login-grupo__head" aria-expanded="' + estaAberto + '">' +
            '<span class="login-grupo__icone">' + g.icone + '</span>' +
            '<span style="flex:1;min-width:0"><span class="login-grupo__titulo">' + escapeHtml(g.titulo) + '</span>' +
            '<span class="login-grupo__sub">' + g.lista.length + ' ' + (g.lista.length === 1 ? 'usuário' : 'usuários') + ' · ' + g.sub + '</span></span>' +
            '<span class="login-grupo__seta">' + (estaAberto ? '▾' : '›') + '</span>' +
          '</button>'
        );
        head.onclick = function () { aberto = estaAberto ? null : g.chave; S.loginGrupoAberto = aberto; desenhar(); };
        card.appendChild(head);
        if (estaAberto) {
          const lista = el('<div class="stack login-grupo__lista"></div>');
          g.lista.forEach(function (u) {
            const item = el(
              '<button type="button" class="list-item" style="width:100%">' +
                '<span class="list-item__title">' + escapeHtml(u.NOME) + '</span><span>›</span>' +
              '</button>'
            );
            item.onclick = function () {
              if (u.PERFIL === 'ADMIN_QUALIDADE') { go('loginSenha', { pendingUser: u }); }
              else { go('loginPin', { pendingUser: u }); }
            };
            lista.appendChild(item);
          });
          card.appendChild(lista);
        }
        wrap.appendChild(card);
      });
    }
    desenhar();
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
  aquecerServidor(); // acorda o Apps Script enquanto a senha é digitada
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  btn.onclick = async function () {
    if (btn.disabled) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Verificando…';
    try {
      const data = await api('loginAdmin', { idUsuario: u.ID_USUARIO, senha: input.value });
      S.usuario = data;
      preCarregarPosLogin();
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
  aquecerServidor(); // acorda o Apps Script enquanto o PIN é digitado
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  // PIN completo (4 dígitos) já entra sozinho, sem precisar tocar em "Entrar".
  input.addEventListener('input', function () { if (/^\d{4}$/.test(input.value)) btn.click(); });
  btn.onclick = async function () {
    if (btn.disabled) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Verificando…';
    try {
      const data = await api('loginAgente', { idUsuario: u.ID_USUARIO, pin: input.value });
      S.usuario = data;
      preCarregarPosLogin();
      go('agenteHome');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar'; input.value = ''; input.focus();
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
        if (ehFrequenciaVezes(a.PERIODICIDADE)) {
          box.appendChild(el('<span class="subtle" style="margin-top:-8px">' + escapeHtml(frequenciaLabel(a)) + '</span>'));
        }

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
              periodicidade: a.PERIODICIDADE,
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
        // Envio em segundo plano: o agente já volta para o início na hora;
        // a fila envia (e reenvia se a internet cair) sem travar a tela.
        btn.disabled = true;
        enviarEmSegundoPlano('createChecklist', {
          turno: w.turno, local: w.local, ambiente: w.ambiente, periodicidade: w.periodicidade,
          idAgente: S.usuario.ID_USUARIO, agente: S.usuario.NOME, itens: payloadItens
        }, 'Checklist ' + w.local + ' · ' + w.ambiente, true);
        toast('Checklist registrado — enviando…', false, true);
        S.wizard = null;
        go('agenteHome');
      };
    }).catch(function () {});
  }
}

function periodicidadeLabel(p) {
  return { DIARIO: 'Diário', SEMANAL: 'Semanal', MENSAL: 'Mensal', VEZES_SEMANA: 'Vezes por semana', VEZES_MES: 'Vezes por mês' }[p] || p;
}

// Frequência personalizada ("N vezes por semana/mês"): no wizard do agente
// ela aparece junto da opção padrão equivalente (3x por semana em Semanal,
// 2x por mês em Mensal).
function grupoPeriodicidade(p) {
  if (p === 'VEZES_SEMANA') return 'SEMANAL';
  if (p === 'VEZES_MES') return 'MENSAL';
  return p;
}
function ehFrequenciaVezes(p) { return p === 'VEZES_SEMANA' || p === 'VEZES_MES'; }

const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function listaDiasFixos(valor) {
  return String(valor == null ? '' : valor).split(/[\s,;]+/).filter(Boolean).map(Number).filter(function (n) { return !isNaN(n); });
}

// ---------- Turnos da atividade ----------
// TURNO vazio = todos os turnos; ou um/vários separados por ";".
// MODO_TURNO = CADA (cada turno faz) ou UM (basta um turno no dia).
function listaTurnosAtividade(a) {
  return String(a.TURNO == null ? '' : a.TURNO).split(';').map(function (t) { return t.trim(); }).filter(Boolean);
}
function atividadeValeNoTurno(a, turno) {
  const lista = listaTurnosAtividade(a);
  return !turno || !lista.length || lista.indexOf(turno) > -1;
}
function turnoCurto(t) { return String(t || '').replace(/\s*turno\s*/i, '').trim() || t; }
function turnosLabel(a, totalTurnos) {
  const lista = listaTurnosAtividade(a);
  const varios = !lista.length || lista.length > 1;
  const base = !lista.length ? 'Todos os turnos'
    : lista.length === 1 ? lista[0]
    : lista.map(turnoCurto).join(', ').replace(/, ([^,]*)$/, ' e $1') + ' turno';
  if (!varios) return base;
  return base + (String(a.MODO_TURNO || '').toUpperCase() === 'UM' ? ' · basta um' : ' · cada turno');
}

// Descrição completa da frequência de uma atividade (ex.: "3x por semana
// (Seg, Qua, Sex)", "2x por mês · dias livres", "Semanal (Sex)").
function frequenciaLabel(a) {
  const per = a.PERIODICIDADE;
  if (ehFrequenciaVezes(per)) {
    const semana = per === 'VEZES_SEMANA';
    let txt = (Number(a.VEZES) || 1) + 'x por ' + (semana ? 'semana' : 'mês');
    const dias = listaDiasFixos(a.DIAS_FIXOS);
    if (dias.length) {
      txt += ' (' + (semana ? dias.map(function (d) { return DIAS_SEMANA_CURTO[d] || d; }).join(', ') : 'dias ' + dias.join(', ')) + ')';
    } else {
      txt += ' · dias livres';
    }
    return txt;
  }
  const temDia = function (v) { return v !== '' && v !== null && v !== undefined; };
  if (per === 'SEMANAL' && temDia(a.DIA_SEMANA)) return 'Semanal (' + (DIAS_SEMANA_CURTO[Number(a.DIA_SEMANA)] || a.DIA_SEMANA) + ')';
  if (per === 'MENSAL' && temDia(a.DIA_MES)) return 'Mensal (dia ' + a.DIA_MES + ')';
  return periodicidadeLabel(per);
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
  renderListaProgressiva(wrap, rows, function (c) {
    const st = CHECKLIST_STATUS_LABEL[c.STATUS] || { label: c.STATUS, cls: 'aberta' };
    const resultadoIcon = c.RESULTADO === 'NAO_CONFORME' ? '⚠ ' : '';
    return (el(
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
    btn.disabled = true;
    enviarEmSegundoPlano('createOcorrencia', {
      turno: (S.usuario && S.usuario.TURNO) || '', local: localSel.select.value, ambiente: ambienteSelect.value,
      descricao: descricao.getValue(), foto: foto.getValue(),
      idAgente: S.usuario.ID_USUARIO, agente: S.usuario.NOME
    }, 'Ocorrência ' + localSel.select.value + ' · ' + ambienteSelect.value, true);
    toast('Ocorrência registrada — enviando…', false, true);
    go('agenteHome');
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
  renderListaProgressiva(wrap, rows, function (o) {
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
    return item;
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
  // O menu aparece NA HORA; só o card do resumo do dia espera a planilha
  // (antes a tela inteira ficava em "Carregando" até o painel responder).
  S.gestaoAtivLocal = null; // a lista de atividades volta a abrir pelos locais
  appendHtml(app, screenHeader('Painel da Qualidade', 'Olá, ' + S.usuario.NOME));
  const body = el(
    '<div class="stack" id="body" style="margin-top:4px">' +
      '<div class="card stack skeleton-card"><div class="skeleton" style="width:45%;height:18px"></div>' +
      '<div class="kpi-grid"><div class="skeleton" style="height:58px"></div><div class="skeleton" style="height:58px"></div><div class="skeleton" style="height:58px"></div></div></div>' +
    '</div>'
  );
  app.appendChild(body);

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

  const painel = await api('getPainelHoje', {}).catch(function () { return null; });
  body.innerHTML = '';
  if (painel) {
    const card = el('<button type="button" class="card stack" style="width:100%;text-align:left;cursor:pointer"></button>');
    card.appendChild(el('<div class="row between"><h3 class="title-lg">Hoje · ' + escapeHtml(painel.data) + '</h3><span>›</span></div>'));
    card.appendChild(el(resumoPorTurnoHtml(painel)));
    card.appendChild(el('<span class="subtle">Toque para ver o detalhe do que ainda falta hoje</span>'));
    card.onclick = function () { go('painelDia'); };
    body.appendChild(card);
  }
}

// Resumo do dia por turno: uma linha por turno com previstas/realizadas/
// pendentes e barra de progresso, mais a linha "Qualquer turno" (atividades
// em que basta um turno fazer) e o total. Backend antigo (sem porTurno):
// cai no resumo simples.
function resumoPorTurnoHtml(painel) {
  const linhas = painel.porTurno || [];
  if (!linhas.length) {
    return '<div class="kpi-grid">' + kpi(painel.total, 'Previstas') + kpi(painel.realizados, 'Realizadas') + kpi(painel.pendentes, 'Pendentes') + '</div>';
  }
  const linha = function (nome, r, total) {
    const pct = r.total ? Math.round(r.realizados / r.total * 100) : 0;
    return '<div class="turno-linha' + (total ? ' turno-linha--total' : '') + '">' +
      '<span class="turno-linha__nome">' + escapeHtml(nome) + '</span>' +
      '<span style="min-width:0"><span class="turno-linha__nums"><b>' + r.realizados + '</b> de <b>' + r.total + '</b> realizadas' +
      (r.pendentes ? ' · <span class="turno-linha__pend">' + r.pendentes + ' pendente' + (r.pendentes > 1 ? 's' : '') + '</span>' : ' · ✓') + '</span>' +
      (total ? '' : '<div class="bar-track" style="height:6px;margin-top:5px"><div class="bar-fill" style="width:' + pct + '%"></div></div>') +
      '</span></div>';
  };
  return '<div class="turno-resumo">' +
    linhas.map(function (r) { return linha(r.turno || 'Qualquer turno', r, false); }).join('') +
    linha('Total', { total: painel.total, realizados: painel.realizados, pendentes: painel.pendentes }, true) +
    '</div>';
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
    '<div class="card stack" style="gap:6px">' +
      '<div class="row between"><h3 class="title-lg">Dia ' + escapeHtml(painel.data) + '</h3>' +
      (painel.viradaDia ? '<span class="subtle">Dia vira às ' + escapeHtml(painel.viradaDia) + '</span>' : '') + '</div>' +
      resumoPorTurnoHtml(painel) +
    '</div>'
  ));

  // Filtro por turno (Todos + um botão por turno que aparece no resumo).
  const turnosDoDia = (painel.porTurno || []).map(function (r) { return r.turno; }).filter(Boolean);
  let turnoFiltro = '';
  const filterWrap = el(
    '<div class="filters">' +
      '<button class="btn btn--outline btn--sm is-active" data-f="pendentes">Só pendentes</button>' +
      '<button class="btn btn--outline btn--sm" data-f="todas">Todas</button>' +
    '</div>'
  );
  body.appendChild(filterWrap);
  if (turnosDoDia.length > 1) {
    const turnoWrap = el('<div class="filters"></div>');
    ['' ].concat(turnosDoDia).forEach(function (t) {
      const b = el('<button type="button" class="btn btn--outline btn--sm' + (t === '' ? ' is-active' : '') + '">' + escapeHtml(t || 'Todos os turnos') + '</button>');
      b.onclick = function () {
        turnoFiltro = t;
        turnoWrap.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        showList(filtroAtual);
      };
      turnoWrap.appendChild(b);
    });
    body.appendChild(turnoWrap);
  }
  let filtroAtual = 'pendentes';
  const listWrap = el('<div class="stack"></div>');
  body.appendChild(listWrap);

  // Agrupado: Local (card que abre/fecha) → Ambiente → Atividade, com uma
  // etiqueta por turno em vez de repetir a mesma atividade 3 vezes.
  // Locais com pendência começam abertos; os já concluídos, fechados.
  const abertos = {};
  function showList(filtro) {
    filtroAtual = filtro;
    filterWrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.f === filtro); });
    listWrap.innerHTML = '';

    // Com um turno escolhido: só o que é daquele turno (as "basta um
    // turno" entram se o turno escolhido é um dos permitidos).
    const itensFiltrados = !turnoFiltro ? painel.itens : painel.itens.filter(function (i) {
      return i.turno ? i.turno === turnoFiltro : (i.turnosPermitidos || []).indexOf(turnoFiltro) > -1;
    });
    const porLocal = {};
    itensFiltrados.forEach(function (i) {
      const L = porLocal[i.local] = porLocal[i.local] || { total: 0, feitos: 0, atividades: {} };
      L.total++;
      if (i.realizado) L.feitos++;
      const k = i.ambiente + '|' + i.atividade;
      const A = L.atividades[k] = L.atividades[k] || { ambiente: i.ambiente, atividade: i.atividade, turnos: [], nota: '' };
      A.turnos.push(i);
      if (i.nota) A.nota = i.nota;
    });

    const locais = Object.keys(porLocal).sort(function (x, y) {
      const px = porLocal[x].total - porLocal[x].feitos, py = porLocal[y].total - porLocal[y].feitos;
      return (py > 0) - (px > 0) || x.localeCompare(y); // com pendência primeiro
    }).filter(function (l) { return filtro === 'todas' || porLocal[l].feitos < porLocal[l].total; });

    if (!locais.length) { listWrap.appendChild(el('<div class="card"><div class="empty"><span class="ic">✅</span>Nada pendente por aqui.</div></div>')); return; }

    locais.forEach(function (local) {
      const L = porLocal[local];
      const pend = L.total - L.feitos;
      if (abertos[local] === undefined) abertos[local] = pend > 0;
      const pct = L.total ? Math.round(L.feitos / L.total * 100) : 0;

      const card = el('<div class="card stack" style="padding:0;gap:0;overflow:hidden"></div>');
      const head = el(
        '<button type="button" class="painel-local">' +
          '<span style="flex:1;min-width:0">' +
            '<span class="list-item__title">' + escapeHtml(local) + '</span>' +
            '<div class="list-item__sub">' + L.feitos + ' de ' + L.total + ' feitas' + (pend ? ' · <strong style="color:var(--st-aberta)">' + pend + ' pendente' + (pend > 1 ? 's' : '') + '</strong>' : ' · ✓ tudo feito') + '</div>' +
            '<div class="bar-track" style="margin-top:8px;height:6px"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '</span>' +
          '<span class="painel-local__seta">' + (abertos[local] ? '▾' : '▸') + '</span>' +
        '</button>'
      );
      card.appendChild(head);
      const corpo = el('<div class="stack" style="gap:0;padding:0 16px 8px"></div>');
      if (!abertos[local]) corpo.style.display = 'none';
      card.appendChild(corpo);
      head.onclick = function () { abertos[local] = !abertos[local]; showList(filtro); };

      let ambienteAtual = null;
      Object.keys(L.atividades).sort().forEach(function (k) {
        const A = L.atividades[k];
        const temPendente = A.turnos.some(function (t) { return !t.realizado; });
        if (filtro === 'pendentes' && !temPendente) return;
        if (A.ambiente !== ambienteAtual) {
          ambienteAtual = A.ambiente;
          corpo.appendChild(el('<span class="eyebrow" style="display:block;margin:12px 0 2px">' + escapeHtml(A.ambiente) + '</span>'));
        }
        const chips = A.turnos.map(function (t) {
          // "Basta um turno": uma etiqueta só — pendente ("Qualquer") ou com o
          // turno que fez.
          if (!t.turno) {
            const permitidos = (t.turnosPermitidos || []).map(turnoCurto).join('/');
            return t.realizado
              ? '<span class="tag tag--finalizada" title="Basta um turno (' + escapeHtml(permitidos) + ')">' + escapeHtml(turnoCurto(t.turnoFeito) || 'Feito') + ' ✓ ' + escapeHtml(t.hora) + '</span>'
              : '<span class="tag tag--aberta" title="Basta um turno fazer">' + escapeHtml(permitidos ? 'Qualquer (' + permitidos + ')' : 'Qualquer turno') + ' ⏳</span>';
          }
          const nomeTurno = turnoCurto(t.turno);
          return t.realizado
            ? '<span class="tag tag--finalizada" title="Feito às ' + escapeHtml(t.hora) + '">' + escapeHtml(nomeTurno) + ' ✓ ' + escapeHtml(t.hora) + '</span>'
            : '<span class="tag tag--aberta" title="Pendente">' + escapeHtml(nomeTurno) + ' ⏳</span>';
        }).join('');
        corpo.appendChild(el(
          '<div class="painel-ativ">' +
            '<span style="min-width:0"><strong>' + escapeHtml(A.atividade) + '</strong>' +
            (A.nota ? '<div class="subtle" style="color:var(--st-tratamento)">' + escapeHtml(A.nota) + '</div>' : '') + '</span>' +
            '<span class="painel-ativ__turnos">' + chips + '</span>' +
          '</div>'
        ));
      });
      listWrap.appendChild(card);
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
    enviarEmSegundoPlano('aprovarChecklistsLote', { idsChecklist: ids, adminValidador: S.usuario.NOME },
      'Aprovação de ' + ids.length + ' checklist(s)');
    toast(ids.length + ' checklist(s) aprovado(s)!', false, true);
    modoSelecao = false;
    selecionados = {};
    btn.disabled = false;
    document.getElementById('btnSelecionar').textContent = 'Selecionar vários';
    document.getElementById('btnSelecionar').classList.remove('is-active');
    atualizarBarraAprovacao();
    load();
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
    renderListaProgressiva(listWrap, rows, function (c) {
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
      return item;
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

  btnAprovar.onclick = function () {
    btnAprovar.disabled = true;
    enviarEmSegundoPlano('validarChecklist', { idChecklist: c.ID_CHECKLIST, aprovado: true, adminValidador: S.usuario.NOME },
      'Aprovação ' + c.ID_CHECKLIST);
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
      btnConfirmar.disabled = true;
      enviarEmSegundoPlano('validarChecklist', {
        idChecklist: c.ID_CHECKLIST, aprovado: false, adminValidador: S.usuario.NOME,
        motivo: motivo.getValue(), refazer: !!refazer.getValue()
      }, 'Reprovação ' + c.ID_CHECKLIST);
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
      b.onclick = function () {
        enviarEmSegundoPlano('atualizarStatusOcorrencia', { idOcorrencia: o.ID_OCORRENCIA, status: statusOpt }, 'Status ' + o.ID_OCORRENCIA);
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
    return function () {
      enviarEmSegundoPlano('validarOcorrencia', { idOcorrencia: o.ID_OCORRENCIA, procedente: procedente, adminAnalise: S.usuario.NOME, observacao: obs.getValue() },
        'Análise ' + o.ID_OCORRENCIA);
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
    renderListaProgressiva(listWrap, rows, function (n) {
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
      return item;
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
    btn.disabled = true;
    enviarEmSegundoPlano('createNaoConformidade', {
      local: localSel.select.value, ambiente: ambienteSelect.value, descricao: descricao.getValue(), foto: foto.getValue(),
      idAgenteResponsavel: responsavelSelect.value, agenteResponsavel: agenteObj ? agenteObj.NOME : '',
      adminAbriu: S.usuario.NOME
    }, 'Não conformidade ' + localSel.select.value + ' · ' + ambienteSelect.value, true);
    toast('Não conformidade direcionada — enviando…', false, true);
    go('naoConformidade');
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

  btnAprovar.onclick = function () {
    enviarEmSegundoPlano('validarNaoConformidade', { idNc: n.ID_NC, aprovado: true, adminValidador: S.usuario.NOME }, 'Validação ' + n.ID_NC);
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
      enviarEmSegundoPlano('validarNaoConformidade', { idNc: n.ID_NC, aprovado: false, adminValidador: S.usuario.NOME, motivo: motivo.getValue() }, 'Devolução ' + n.ID_NC);
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
        periodicidade: grupoPeriodicidade(c.PERIODICIDADE), turno: c.TURNO, local: c.LOCAL, ambiente: c.AMBIENTE
      };
      go('novoChecklist');
    };
    card.appendChild(item);
  });
}

function renderNCListAgente(wrap, rows) {
  wrap.innerHTML = '';
  if (!rows.length) { wrap.appendChild(el('<div class="empty"><span class="ic">✅</span>Nenhuma pendência direcionada a você.</div>')); return; }
  renderListaProgressiva(wrap, rows, function (n) {
    const st = NC_STATUS_LABEL[n.STATUS] || { label: n.STATUS, cls: 'aberta' };
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span>' +
        '<div class="list-item__title">' + escapeHtml(n.LOCAL) + ' — ' + escapeHtml(n.AMBIENTE) + '</div>' +
        '<div class="list-item__sub" style="margin-top:3px">' + escapeHtml(String(n.DESCRICAO || '').slice(0, 60)) + (String(n.DESCRICAO || '').length > 60 ? '…' : '') + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(n.DATA) + ' ' + escapeHtml(n.HORA) + '</div>' +
        '</span>' +
        '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
      '</button>'
    );
    item.onclick = function () { go('pendenciaNCDetalheAgente', { ncAtual: n }); };
    return item;
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
    btn.disabled = true;
    enviarEmSegundoPlano('resolverNaoConformidade', { idNc: n.ID_NC, descricaoResolucao: descricao.getValue(), fotoResolucao: foto.getValue() },
      'Resolução ' + n.ID_NC, true);
    toast('Resolução registrada — enviando…', false, true);
    go('minhasPendenciasNC');
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
  // Duas camadas: primeiro só os locais (Fábrica, Casarão…) com o total de
  // atividades de cada um; tocando num local, abre a lista dele separada por
  // ambiente. O local aberto fica em S.gestaoAtivLocal, assim ao salvar/
  // voltar de uma atividade a tela volta para o mesmo local.
  const localAberto = S.gestaoAtivLocal || null;
  appendHtml(app,
    screenHeader('Cadastros', localAberto || 'Atividades de limpeza',
      localAberto ? 'Atividades de limpeza deste local, por ambiente' : 'Toque em um local para ver as atividades dele') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">' + (localAberto ? '← Locais' : '← Voltar') + '</button>'
  );
  document.getElementById('btnVoltar').onclick = function () {
    if (localAberto) go('gestaoAtividades', { gestaoAtivLocal: null });
    else go('adminHome');
  };

  const btnNovo = el('<button class="btn btn--primary btn--block">+ Nova atividade' + (localAberto ? ' em ' + escapeHtml(localAberto) : '') + '</button>');
  app.appendChild(btnNovo);
  btnNovo.onclick = function () { go('atividadeForm', { atividadeEditando: null }); };

  const filterWrap = el(
    '<div class="filters" style="margin-top:12px">' +
      '<button type="button" class="btn btn--outline btn--sm" data-f="ativas">Ativas</button>' +
      '<button type="button" class="btn btn--outline btn--sm" data-f="todas">Todas</button>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const todas = await api('getAtividadesAdmin', {}).catch(function () { return []; });
  const ehAtiva = function (a) { return String(a.ATIVO).toUpperCase() === 'SIM'; };

  function mostrar() {
    const filtro = S.gestaoAtivFiltro || 'ativas';
    filterWrap.querySelectorAll('button[data-f]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.f === filtro); });
    const rows = filtro === 'ativas' ? todas.filter(ehAtiva) : todas;
    listWrap.innerHTML = '';

    if (!localAberto) {
      // ---- camada 1: locais ----
      const porLocal = {};
      rows.forEach(function (a) {
        const g = porLocal[a.LOCAL] = porLocal[a.LOCAL] || { total: 0, inativas: 0, ambientes: {} };
        g.total++;
        if (!ehAtiva(a)) g.inativas++;
        g.ambientes[a.AMBIENTE] = true;
      });
      const locais = Object.keys(porLocal).sort(function (x, y) { return x.localeCompare(y); });
      if (!locais.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧾</span>Nenhuma atividade encontrada.</div>')); return; }
      locais.forEach(function (local) {
        const g = porLocal[local];
        const nAmb = Object.keys(g.ambientes).length;
        const item = el(
          '<button type="button" class="list-item" style="width:100%;padding:16px">' +
            '<span class="row" style="gap:12px"><span style="font-size:22px">📍</span>' +
            '<span><span class="list-item__title">' + escapeHtml(local) + '</span>' +
            '<div class="list-item__sub">' + g.total + ' atividade' + (g.total > 1 ? 's' : '') + ' · ' + nAmb + ' ambiente' + (nAmb > 1 ? 's' : '') +
            (g.inativas ? ' · ' + g.inativas + ' inativa' + (g.inativas > 1 ? 's' : '') : '') + '</div></span></span>' +
            '<span>›</span>' +
          '</button>'
        );
        item.onclick = function () { go('gestaoAtividades', { gestaoAtivLocal: local }); };
        listWrap.appendChild(item);
      });
      return;
    }

    // ---- camada 2: atividades do local, agrupadas por ambiente ----
    const doLocal = rows.filter(function (a) { return a.LOCAL === localAberto; });
    if (!doLocal.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧾</span>Nenhuma atividade neste local.</div>')); return; }
    const porAmbiente = {};
    doLocal.forEach(function (a) { (porAmbiente[a.AMBIENTE] = porAmbiente[a.AMBIENTE] || []).push(a); });
    Object.keys(porAmbiente).sort(function (x, y) { return x.localeCompare(y); }).forEach(function (amb) {
      const lista = porAmbiente[amb];
      listWrap.appendChild(el('<span class="eyebrow" style="display:block;margin-top:8px">' + escapeHtml(amb) + ' · ' + lista.length + '</span>'));
      lista.forEach(function (a) {
        const ativo = ehAtiva(a);
        const item = el(
          '<button type="button" class="list-item" style="width:100%;text-align:left">' +
            '<span><span class="list-item__title">' + escapeHtml(a.ATIVIDADE) + '</span>' +
            '<div class="list-item__sub">' + escapeHtml(frequenciaLabel(a)) + ' · ' + escapeHtml(turnosLabel(a)) + '</div></span>' +
            '<span class="tag tag--' + (ativo ? 'finalizada' : 'aberta') + '">' + (ativo ? 'Ativa' : 'Inativa') + '</span>' +
          '</button>'
        );
        item.onclick = function () { go('atividadeForm', { atividadeEditando: a }); };
        listWrap.appendChild(item);
      });
    });
  }

  filterWrap.querySelectorAll('button[data-f]').forEach(function (b) {
    b.onclick = function () { S.gestaoAtivFiltro = b.dataset.f; mostrar(); };
  });
  mostrar();
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

  const [locais, turnos] = await Promise.all([
    api('getLocais', {}).catch(function () { return []; }),
    api('getTurnos', {}).catch(function () { return []; })
  ]);
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
  // Nova atividade aberta de dentro de um local: já vem com o local preenchido.
  if (!editando && S.gestaoAtivLocal) {
    inpLocal.value = S.gestaoAtivLocal;
    atualizarSugestoesAmbiente();
  }

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
    label: 'Frequência *', columns: 2,
    options: [
      { value: 'DIARIO', label: 'Diário' }, { value: 'SEMANAL', label: 'Semanal' },
      { value: 'MENSAL', label: 'Mensal' }, { value: 'PERSONALIZADA', label: 'Personalizada' }
    ]
  });

  // Frequência personalizada: "N vezes por semana/mês", com dias livres
  // (qualquer dia do período) ou dias fixos (ex.: seg/qua/sex). Estado fica
  // aqui para não se perder quando a área é redesenhada.
  const pers = { vezes: '', por: 'SEMANA', modo: 'LIVRE', diasSemana: [], diasMes: '' };
  if (editando && ehFrequenciaVezes(editando.PERIODICIDADE)) {
    pers.vezes = String(editando.VEZES || '');
    pers.por = editando.PERIODICIDADE === 'VEZES_MES' ? 'MES' : 'SEMANA';
    const dias = listaDiasFixos(editando.DIAS_FIXOS);
    if (dias.length) {
      pers.modo = 'FIXO';
      if (pers.por === 'SEMANA') pers.diasSemana = dias; else pers.diasMes = dias.join(', ');
    }
  }

  function renderPersonalizada() {
    detalheWrap.innerHTML = '';
    const semana = pers.por === 'SEMANA';

    const linha = el(
      '<div class="grid2">' +
        '<div class="field"><label>Quantas vezes? *</label><input type="number" id="inpVezes" min="1" max="' + (semana ? 7 : 31) + '" inputmode="numeric" placeholder="Ex: 3"></div>' +
        '<div class="field"><label>Por *</label><select id="selPor"><option value="SEMANA">Semana</option><option value="MES">Mês</option></select></div>' +
      '</div>'
    );
    detalheWrap.appendChild(linha);
    const inpVezes = linha.querySelector('#inpVezes');
    const selPor = linha.querySelector('#selPor');
    inpVezes.value = pers.vezes;
    selPor.value = pers.por;
    inpVezes.addEventListener('input', function () { pers.vezes = inpVezes.value; atualizarDica(); });
    selPor.addEventListener('change', function () { pers.por = selPor.value; renderPersonalizada(); });

    const modoWrap = el(
      '<div class="field"><label>Em quais dias?</label><div class="option-grid" style="grid-template-columns:1fr 1fr">' +
        '<button type="button" class="option-btn" data-m="LIVRE">Dias livres</button>' +
        '<button type="button" class="option-btn" data-m="FIXO">Dias fixos</button>' +
      '</div></div>'
    );
    detalheWrap.appendChild(modoWrap);
    modoWrap.querySelectorAll('[data-m]').forEach(function (b) {
      b.classList.toggle('is-selected', b.dataset.m === pers.modo);
      b.onclick = function () { pers.modo = b.dataset.m; renderPersonalizada(); };
    });

    if (pers.modo === 'FIXO') {
      if (semana) {
        const diasWrap = el('<div class="field"><label>Marque os dias da semana</label><div class="option-grid" style="grid-template-columns:repeat(7,1fr);gap:6px"></div></div>');
        const grid = diasWrap.querySelector('.option-grid');
        DIAS_SEMANA_CURTO.forEach(function (nome, i) {
          const b = el('<button type="button" class="option-btn" style="padding:12px 2px;font-size:13px">' + nome + '</button>');
          b.classList.toggle('is-selected', pers.diasSemana.indexOf(i) > -1);
          b.onclick = function () {
            const pos = pers.diasSemana.indexOf(i);
            if (pos > -1) pers.diasSemana.splice(pos, 1); else pers.diasSemana.push(i);
            pers.diasSemana.sort(function (x, y) { return x - y; });
            b.classList.toggle('is-selected', pos === -1);
            atualizarDica();
          };
          grid.appendChild(b);
        });
        detalheWrap.appendChild(diasWrap);
      } else {
        const diasWrap = el('<div class="field"><label>Dias do mês (separe por vírgula)</label><input type="text" inputmode="numeric" id="inpDiasMes" placeholder="Ex: 5, 20"></div>');
        const inp = diasWrap.querySelector('input');
        inp.value = pers.diasMes;
        inp.addEventListener('input', function () { pers.diasMes = inp.value; atualizarDica(); });
        detalheWrap.appendChild(diasWrap);
      }
    }

    const dica = el('<p class="subtle"></p>');
    detalheWrap.appendChild(dica);
    function atualizarDica() {
      const n = parseInt(pers.vezes, 10);
      const qtd = n > 0 ? n + 'x' : 'N vezes';
      const periodo = semana ? 'semana' : 'mês';
      if (pers.modo === 'LIVRE') {
        dica.textContent = 'O agente pode fazer ' + qtd + ' em quaisquer dias da ' + periodo + (semana ? ' (segunda a domingo)' : '') +
          '. Só fica atrasada se a ' + periodo + ' terminar sem completar.';
      } else {
        const marcados = semana ? pers.diasSemana.length : listaDiasFixos(pers.diasMes).length;
        dica.textContent = 'Cada dia marcado vira um dia previsto, e fica atrasada se não for feita no dia. ' +
          'Marcados: ' + marcados + (n > 0 ? ' de ' + n : '') + '.';
      }
    }
    atualizarDica();
  }

  // Lê e valida a frequência personalizada. Retorna os campos do payload ou
  // null (já mostrando o erro).
  function lerPersonalizada() {
    const semana = pers.por === 'SEMANA';
    const n = Number(pers.vezes);
    if (!Number.isInteger(n) || n < 1 || n > (semana ? 7 : 31)) {
      toast(semana ? 'Informe quantas vezes por semana (1 a 7).' : 'Informe quantas vezes por mês (1 a 31).', true);
      return null;
    }
    let dias = [];
    if (pers.modo === 'FIXO') {
      dias = semana ? pers.diasSemana.slice() : listaDiasFixos(pers.diasMes);
      if (!semana && dias.some(function (d) { return !Number.isInteger(d) || d < 1 || d > 31; })) {
        toast('Dias do mês inválidos (use números de 1 a 31).', true); return null;
      }
      dias = dias.filter(function (d, i) { return dias.indexOf(d) === i; });
      if (dias.length !== n) { toast('Marque exatamente ' + n + ' dia(s) fixo(s), ou escolha "Dias livres".', true); return null; }
    }
    return { periodicidade: semana ? 'VEZES_SEMANA' : 'VEZES_MES', vezes: n, diasFixos: dias.join(';') };
  }

  const detalheWrap = el('<div class="stack" style="display:none"></div>');
  card.appendChild(detalheWrap);
  function atualizarDetalhePeriodicidade(valorInicial) {
    const p = periodicidade.getValue();
    detalheWrap.innerHTML = '';
    detalheWrap.style.display = (p === 'SEMANAL' || p === 'MENSAL' || p === 'PERSONALIZADA') ? 'flex' : 'none';
    if (p === 'PERSONALIZADA') {
      renderPersonalizada();
    } else if (p === 'SEMANAL') {
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

  // Turnos que fazem a atividade: botões marcáveis (todos marcados = vale
  // para todos os turnos, inclusive turnos que forem criados depois). Com
  // mais de um marcado, pergunta como contar.
  const nomesTurnos = turnos.map(function (t) { return t.TURNO; });
  const turnosMarcados = {};
  const turnosAtuais = editando ? listaTurnosAtividade(editando) : [];
  nomesTurnos.forEach(function (t) { turnosMarcados[t] = !turnosAtuais.length || turnosAtuais.indexOf(t) > -1; });
  let modoTurno = editando && String(editando.MODO_TURNO || '').toUpperCase() === 'UM' ? 'UM' : 'CADA';

  const turnoWrap = el(
    '<div class="field"><label>Quais turnos fazem esta atividade? *</label>' +
      '<div class="option-grid" style="grid-template-columns:repeat(' + Math.min(Math.max(nomesTurnos.length, 1), 4) + ',1fr)"></div>' +
    '</div>'
  );
  card.appendChild(turnoWrap);
  const turnoGrid = turnoWrap.querySelector('.option-grid');
  const modoWrap = el(
    '<div class="field"><label>Com mais de um turno marcado, como contar?</label>' +
      '<div class="stack" style="gap:8px">' +
        '<button type="button" class="option-btn modo-turno" data-m="CADA"><span>Cada turno faz</span><small>Cada turno marcado precisa fazer; cada um conta separado</small></button>' +
        '<button type="button" class="option-btn modo-turno" data-m="UM"><span>Basta um turno no dia</span><small>Quem fizer primeiro conclui a atividade do dia</small></button>' +
      '</div>' +
    '</div>'
  );
  card.appendChild(modoWrap);
  function desenharTurnos() {
    turnoGrid.innerHTML = '';
    nomesTurnos.forEach(function (t) {
      const b = el('<button type="button" class="option-btn' + (turnosMarcados[t] ? ' is-selected' : '') + '">' + (turnosMarcados[t] ? '✓ ' : '') + escapeHtml(t) + '</button>');
      b.onclick = function () { turnosMarcados[t] = !turnosMarcados[t]; desenharTurnos(); };
      turnoGrid.appendChild(b);
    });
    const qtd = nomesTurnos.filter(function (t) { return turnosMarcados[t]; }).length;
    modoWrap.style.display = qtd > 1 ? 'flex' : 'none';
    modoWrap.querySelectorAll('[data-m]').forEach(function (b) {
      b.classList.toggle('is-selected', b.dataset.m === modoTurno);
      b.onclick = function () { modoTurno = b.dataset.m; desenharTurnos(); };
    });
  }
  desenharTurnos();
  // Valor gravado em TURNO: "" se todos estão marcados, senão os marcados
  // separados por ";". null = nenhum marcado (erro).
  function lerTurnos() {
    const marcados = nomesTurnos.filter(function (t) { return turnosMarcados[t]; });
    if (!marcados.length) return null;
    return marcados.length === nomesTurnos.length ? '' : marcados.join(';');
  }

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
    const idxPeriodicidade = ehFrequenciaVezes(editando.PERIODICIDADE) ? 3 : ['DIARIO', 'SEMANAL', 'MENSAL'].indexOf(editando.PERIODICIDADE);
    periodicidade.node.querySelectorAll('.option-btn')[idxPeriodicidade > -1 ? idxPeriodicidade : 0].click();
    atualizarDetalhePeriodicidade(editando.PERIODICIDADE === 'SEMANAL' ? editando.DIA_SEMANA : editando.DIA_MES);
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
      periodicidade: periodicidade.getValue(), turno: lerTurnos(), modoTurno: modoTurno,
      diaSemana: diaSemanaInput ? diaSemanaInput.value : '', diaMes: diaMesInput ? diaMesInput.value : '',
      fotoAntes: !!fotoAntes.getValue(), fotoDepois: !!fotoDepois.getValue(), validacao: !!validacao.getValue()
    };
    if (!payload.local || !payload.ambiente || !payload.periodicidade) {
      toast('Preencha local, ambiente e frequência.', true);
      return;
    }
    if (payload.turno === null) { toast('Marque ao menos um turno.', true); return; }
    if (payload.periodicidade === 'PERSONALIZADA') {
      const freq = lerPersonalizada();
      if (!freq) return;
      Object.assign(payload, freq);
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
  // Locais e turnos são independentes entre si — busca os dois ao mesmo
  // tempo em vez de um depois do outro, o que corta praticamente pela
  // metade o tempo de espera pra preencher os filtros (essa função é usada
  // por vários dashboards).
  const [locais, turnos] = await Promise.all([
    api('getLocais', {}).catch(function () { return []; }),
    api('getTurnos', {}).catch(function () { return []; })
  ]);
  locais.forEach(function (l) { selLocal.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
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
  wrap.appendChild(el(menuCard('🗂️', 'Dashboard geral', 'Todos os indicadores e gráficos numa página só', 'dashGeral')));
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
  wrap.appendChild(el(menuCard('📊', 'Resumo gerencial de limpeza', 'PDF com gráficos e análise — por semana, mês ou datas', 'resumoGerencial')));
  bindMenuCards();
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
  // <th>/<td> precisam ser criados direto (dentro de um <div> temporário o
  // navegador descarta essas tags e a tabela quebrava com erro).
  colunas.forEach(function (c) {
    const th = document.createElement('th');
    th.textContent = c[1] == null ? '' : String(c[1]);
    thead.appendChild(th);
  });
  table.appendChild(thead);
  linhas.forEach(function (linha) {
    const tr = document.createElement('tr');
    colunas.forEach(function (c) {
      const td = document.createElement('td');
      const v = linha[c[0]];
      td.textContent = v == null ? '' : String(v);
      tr.appendChild(td);
    });
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
// ------------------------- RESUMO GERENCIAL DE LIMPEZA (PDF em slides) -------------------------
// Mesmo modelo do "Resumo Geral" do app de Gestão de Armazéns: páginas em
// formato de slide (16:9) com o fundo institucional (fundo-relatorio.jpg,
// que já traz o logo e a faixa verde/laranja), capa, sumário executivo,
// leitura gerencial, gráficos, ambientes críticos, prioridades, plano de ação
// e conclusão. O relatório abre numa aba nova com o botão "Imprimir / Salvar
// em PDF" (no celular: Compartilhar → Imprimir → Salvar como PDF).

const RESUMO_CORES = {
  realizado: '#5e9030', previsto: '#c9cfc2', neutro: '#3b82c4',
  aprovado: '#2f7d4a', reprovado: '#c63d3d', pendente: '#b8741a', roxo: '#7c5ad6'
};

function periodoResumoPreset(tipo) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d = function (x) { return new Date(x.getTime()); };
  const nomesMes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const pad = function (n) { return String(n).padStart(2, '0'); };
  let ini, fim, rotulo;
  if (tipo === 'hoje') {
    ini = d(hoje);
    if (new Date().getHours() < 6) ini.setDate(ini.getDate() - 1);
    return { dataInicial: dateToBR(ini), dataFinal: dateToBR(ini), rotulo: 'Dia ' + dateToBR(ini) };
  }
  if (tipo === 'semana' || tipo === 'semanaPassada') {
    ini = d(hoje); ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7));
    if (tipo === 'semanaPassada') { ini.setDate(ini.getDate() - 7); fim = d(ini); fim.setDate(fim.getDate() + 6); }
    else fim = d(hoje);
    rotulo = 'Semana de ' + pad(ini.getDate()) + '/' + pad(ini.getMonth() + 1) + ' a ' + pad(fim.getDate()) + '/' + pad(fim.getMonth() + 1);
  } else if (tipo === 'mes' || tipo === 'mesPassado') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - (tipo === 'mesPassado' ? 1 : 0), 1);
    fim = tipo === 'mesPassado' ? new Date(hoje.getFullYear(), hoje.getMonth(), 0) : d(hoje);
    rotulo = 'Mês de ' + nomesMes[ini.getMonth()] + ' (dia ' + pad(ini.getDate()) + ' a dia ' + pad(fim.getDate()) + ')';
  }
  return { dataInicial: dateToBR(ini), dataFinal: dateToBR(fim), rotulo: rotulo };
}

function renderResumoGerencial() {
  appendHtml(app,
    screenHeader('Relatórios', 'Resumo gerencial de limpeza', 'PDF em slides com gráficos, no padrão do Resumo Geral') +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('relatorios'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  const opcoes = [
    ['semana', 'Esta semana'], ['semanaPassada', 'Semana passada'],
    ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['custom', 'Datas personalizadas']
  ];
  let escolha = 'mes';
  const grade = el('<div class="field"><label>Período do resumo</label><div class="option-grid" style="grid-template-columns:repeat(2,1fr)"></div></div>');
  card.appendChild(grade);
  const datas = el(
    '<div class="grid2" style="display:none">' +
      '<div class="field"><label>De</label><input type="date" id="resIni"></div>' +
      '<div class="field"><label>Até</label><input type="date" id="resFim"></div>' +
    '</div>'
  );
  card.appendChild(datas);
  const info = el('<p class="subtle"></p>');
  card.appendChild(info);

  function atualizar() {
    grade.querySelectorAll('.option-btn').forEach(function (b) { b.classList.toggle('is-selected', b.dataset.v === escolha); });
    datas.style.display = escolha === 'custom' ? 'grid' : 'none';
    if (escolha !== 'custom') {
      const p = periodoResumoPreset(escolha);
      info.textContent = p.rotulo + ' · ' + p.dataInicial + ' a ' + p.dataFinal;
    } else {
      info.textContent = 'Escolha a data inicial e a final.';
    }
  }
  opcoes.forEach(function (o) {
    const b = el('<button type="button" class="option-btn" data-v="' + o[0] + '"' + (o[0] === 'custom' ? ' style="grid-column:1/-1"' : '') + '>' + o[1] + '</button>');
    b.onclick = function () { escolha = o[0]; atualizar(); };
    grade.querySelector('.option-grid').appendChild(b);
  });
  atualizar();

  const btn = el('<button class="btn btn--primary btn--block">📊 Gerar resumo</button>');
  card.appendChild(btn);
  card.appendChild(el('<p class="subtle">Abre numa aba nova. Lá, toque em "Imprimir / Salvar em PDF". O período anterior (mesma quantidade de dias, logo antes) é usado para calcular as variações.</p>'));

  btn.onclick = async function () {
    let periodo;
    if (escolha === 'custom') {
      const a = document.getElementById('resIni').value, b = document.getElementById('resFim').value;
      if (!a || !b) { toast('Escolha as duas datas.', true); return; }
      if (a > b) { toast('A data inicial deve ser antes da final.', true); return; }
      const dA = new Date(a + 'T00:00:00'), dB = new Date(b + 'T00:00:00');
      periodo = { dataInicial: dateToBR(dA), dataFinal: dateToBR(dB), rotulo: 'Período de ' + dateToBR(dA) + ' a ' + dateToBR(dB) };
    } else {
      periodo = periodoResumoPreset(escolha);
    }
    // A aba precisa ser aberta já no toque (senão o navegador bloqueia).
    const janela = window.open('', '_blank');
    if (!janela) { toast('O navegador bloqueou a nova aba. Libere pop-ups para este site e tente de novo.', true); return; }
    janela.document.write('<title>Gerando resumo…</title><p style="font:16px sans-serif;padding:24px;color:#444">Gerando o resumo de limpeza… isso pode levar alguns segundos.</p>');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gerando…';
    try {
      const dados = await api('getResumoLimpeza', { dataInicial: periodo.dataInicial, dataFinal: periodo.dataFinal }, { noGate: true });
      janela.document.open();
      janela.document.write(montarResumoHtml(dados, periodo.rotulo));
      janela.document.close();
    } catch (e) {
      try { janela.close(); } catch (x) { /* nada */ }
    }
    btn.disabled = false; btn.textContent = '📊 Gerar resumo';
  };
}

// ---------- gráficos em SVG (impressão nítida, sem bibliotecas) ----------

function resumoEsc(s) { return escapeHtml(s); }

function quebrarRotulo(txt, max) {
  const palavras = String(txt).split(' ');
  const linhas = [''];
  palavras.forEach(function (p) {
    const atual = linhas[linhas.length - 1];
    if ((atual + ' ' + p).trim().length > max && atual) linhas.push(p);
    else linhas[linhas.length - 1] = (atual + ' ' + p).trim();
  });
  return linhas.slice(0, 3);
}

// Barras verticais de uma ou duas séries, com valor escrito acima de cada
// barra (identidade nunca só pela cor). dados: [{rotulo, a, b?}].
function svgColunas(dados, opt) {
  opt = opt || {};
  const cTxt = opt.escuro ? '#f1f4ef' : '#222', cRot = opt.escuro ? '#c3cbc4' : '#333', cBase = opt.escuro ? '#56605a' : '#9aa19a';
  const W = opt.largura || 820, H = opt.altura || 330;
  const topo = 34, base = 70, esq = 16, dir = 16;
  const duas = !!opt.serieB;
  const max = Math.max(1, Math.max.apply(null, dados.map(function (d) { return Math.max(d.a || 0, duas ? (d.b || 0) : 0); })));
  const areaH = H - topo - base, areaW = W - esq - dir;
  const slot = areaW / Math.max(dados.length, 1);
  const barW = Math.max(6, Math.min(duas ? 34 : 56, slot * (duas ? 0.34 : 0.55)));
  const fonteRot = dados.length > 14 ? 9.5 : 11.5;
  const maxChars = Math.max(6, Math.floor(slot / (fonteRot * 0.55)));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">';
  if (duas) {
    s += '<rect x="' + (W - 250) + '" y="4" width="11" height="11" rx="2" fill="' + opt.corB + '"/><text x="' + (W - 234) + '" y="14" font-size="12" fill="' + cRot + '">' + resumoEsc(opt.serieB) + '</text>';
    s += '<rect x="' + (W - 130) + '" y="4" width="11" height="11" rx="2" fill="' + opt.corA + '"/><text x="' + (W - 114) + '" y="14" font-size="12" fill="' + cRot + '">' + resumoEsc(opt.serieA) + '</text>';
  }
  const y0 = topo + areaH;
  s += '<line x1="' + esq + '" x2="' + (W - dir) + '" y1="' + y0 + '" y2="' + y0 + '" stroke="' + cBase + '" stroke-width="1"/>';
  const barra = function (x, v, cor) {
    const h = Math.round((v / max) * areaH);
    let r = '';
    if (h > 0) {
      const rr = Math.min(4, h / 2, barW / 2);
      r += '<path d="M' + x + ',' + y0 + ' v' + (-(h - rr)) + ' q0,' + (-rr) + ' ' + rr + ',' + (-rr) + ' h' + (barW - 2 * rr) + ' q' + rr + ',0 ' + rr + ',' + rr + ' v' + (h - rr) + ' z" fill="' + cor + '"/>';
    }
    r += '<text x="' + (x + barW / 2) + '" y="' + (y0 - h - 6) + '" text-anchor="middle" font-size="' + (dados.length > 14 ? 10 : 12) + '" font-weight="bold" fill="' + cTxt + '">' + v + (opt.sufixo || '') + '</text>';
    return r;
  };
  dados.forEach(function (d, i) {
    const cx = esq + slot * i + slot / 2;
    if (duas) {
      s += barra(cx - barW - 1, d.b || 0, opt.corB);
      s += barra(cx + 1, d.a || 0, opt.corA);
    } else {
      s += barra(cx - barW / 2, d.a || 0, d.cor || opt.corA);
    }
    quebrarRotulo(d.rotulo, maxChars).forEach(function (linha, li) {
      s += '<text x="' + cx + '" y="' + (y0 + 17 + li * (fonteRot + 3)) + '" text-anchor="middle" font-size="' + fonteRot + '" fill="' + cRot + '">' + resumoEsc(linha) + '</text>';
    });
  });
  return s + '</svg>';
}

// Barras horizontais (rótulos longos, ex.: "Fábrica · Assepsia").
function svgBarrasH(dados, opt) {
  opt = opt || {};
  const cTxt = opt.escuro ? '#f1f4ef' : '#222', cRot = opt.escuro ? '#c3cbc4' : '#333';
  const W = opt.largura || 820, linhaH = 30, esqRot = Math.round(Math.min(300, W * 0.36));
  const H = Math.max(60, dados.length * linhaH + 10);
  const max = Math.max(1, Math.max.apply(null, dados.map(function (d) { return d.a || 0; })));
  const areaW = W - esqRot - 60;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">';
  dados.forEach(function (d, i) {
    const y = 6 + i * linhaH;
    const w = Math.max(2, Math.round(((d.a || 0) / max) * areaW));
    const maxRot = Math.floor(esqRot / 6.4);
    const rot = String(d.rotulo).length > maxRot ? String(d.rotulo).slice(0, maxRot - 1) + '…' : d.rotulo;
    s += '<text x="' + (esqRot - 10) + '" y="' + (y + 16) + '" text-anchor="end" font-size="12" fill="' + cRot + '">' + resumoEsc(rot) + '</text>';
    s += '<rect x="' + esqRot + '" y="' + (y + 4) + '" width="' + w + '" height="16" rx="4" fill="' + (d.cor || opt.cor || RESUMO_CORES.neutro) + '"/>';
    s += '<text x="' + (esqRot + w + 8) + '" y="' + (y + 16) + '" font-size="12" font-weight="bold" fill="' + cTxt + '">' + (d.a || 0) + (opt.sufixo || '') + '</text>';
  });
  return s + '</svg>';
}

// ---------- montagem das páginas ----------

function montarResumoHtml(d, rotuloPeriodo) {
  const bg = new URL('fundo-relatorio.jpg', location.href).href;
  const A = d.atual, P = d.anterior;
  const pct = function (a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; };
  const plural = function (n, s, p) { return n + ' ' + (n === 1 ? s : (p || s + 's')); };
  const ordenar = function (obj) { return Object.keys(obj || {}).map(function (k) { return { rotulo: k, a: obj[k] }; }).sort(function (x, y) { return y.a - x.a; }); };
  const cumprLista = function (obj) {
    return Object.keys(obj || {}).map(function (k) {
      return { rotulo: k, a: obj[k].realizado, b: obj[k].previsto, pct: pct(obj[k].realizado, obj[k].previsto) };
    });
  };
  const semDados = '<p class="vazio">Sem dados no período.</p>';

  // ---- variação vs período anterior ----
  function variacao(atual, anterior, menorMelhor) {
    if (atual === anterior) return { txt: '= 0', cls: 'neutro', piorou: false };
    const sobe = atual > anterior;
    const txt = (sobe ? '▲ ' : '▼ ') + (anterior ? Math.round(Math.abs(atual - anterior) / anterior * 100) + '%' : Math.abs(atual - anterior));
    const piorou = menorMelhor ? sobe : !sobe;
    return { txt: txt, cls: piorou ? 'ruim' : 'bom', piorou: piorou };
  }
  function status(v, atual, anterior, menorMelhor, limiteCritico) {
    if (!menorMelhor) return atual < 70 ? ['Crítico', 'ruim'] : atual < 90 ? ['Atenção', 'aviso'] : ['OK', 'bom'];
    if (atual === 0) return ['OK', 'bom'];
    if (v.piorou && (atual >= (limiteCritico || 5) || (anterior && atual >= anterior * 1.5))) return ['Crítico', 'ruim'];
    return v.piorou ? ['Atenção', 'aviso'] : ['OK', 'bom'];
  }
  const indicadores = [
    ['% de cumprimento', A.percentualCumprimento, P.percentualCumprimento, false, '%'],
    ['Atividades realizadas', A.realizados, P.realizados, false, ''],
    ['Atividades atrasadas', A.atrasados, P.atrasados, true, ''],
    ['Checklists reprovados', A.reprovados, P.reprovados, true, ''],
    ['Não conformidades (checklist)', A.naoConformidades, P.naoConformidades, true, ''],
    ['Ocorrências abertas', A.totalOcorrencias, P.totalOcorrencias, true, ''],
    ['Não conformidades da Qualidade', A.totalNaoConformidadesQualidade, P.totalNaoConformidadesQualidade, true, '']
  ].map(function (r) {
    const v = variacao(r[1], r[2], r[3]);
    let st;
    if (r[0] === 'Atividades realizadas') st = v.piorou ? ['Atenção', 'aviso'] : ['OK', 'bom'];
    else st = status(v, r[1], r[2], r[3]);
    return { nome: r[0], atual: r[1] + r[4], anterior: r[2] + r[4], variacao: v, status: st };
  });

  // ---- recortes ----
  const porTurno = cumprLista(A.cumprimentoPorTurno);
  const porLocal = cumprLista(A.cumprimentoPorLocal).sort(function (x, y) { return y.b - x.b; });
  porTurno.forEach(function (t) { if (t.rotulo === 'Qualquer turno') t.rotulo = 'Qualquer turno (basta um)'; });
  const turnosReais = porTurno.filter(function (t) { return t.rotulo.indexOf('Qualquer turno') !== 0; });
  const turnoPior = turnosReais.filter(function (t) { return t.b > 0; }).sort(function (x, y) { return x.pct - y.pct; })[0];
  const localPior = porLocal.filter(function (t) { return t.b > 0; }).sort(function (x, y) { return x.pct - y.pct; })[0];
  const criticos = d.ambientesCriticos || [];
  const topAmb = criticos[0];
  const motivos = ordenar(d.motivosReprovacao);
  const validados = A.aprovados + A.reprovados;

  // evolução diária (agrupa por semana se o período for longo)
  const diasOrd = Object.keys(A.cumprimentoPorDia || {}).sort(function (x, y) { return parseBR(x) - parseBR(y); });
  let evolucao = diasOrd.map(function (k) { const v = A.cumprimentoPorDia[k]; return { rotulo: k.slice(0, 5), a: v.realizado, b: v.previsto }; });
  let evolucaoTitulo = 'Realizadas × previstas por dia';
  if (evolucao.length > 31) {
    const semanas = [];
    diasOrd.forEach(function (k, i) {
      const s = Math.floor(i / 7);
      semanas[s] = semanas[s] || { rotulo: 'a partir de ' + k.slice(0, 5), a: 0, b: 0 };
      semanas[s].a += A.cumprimentoPorDia[k].realizado; semanas[s].b += A.cumprimentoPorDia[k].previsto;
    });
    evolucao = semanas; evolucaoTitulo = 'Realizadas × previstas por semana';
  }

  // ---- textos automáticos ----
  let sumario = 'No período analisado — ' + rotuloPeriodo + ' —, foram previstas ' + plural(A.totalPrevisto, 'atividade') +
    ' de limpeza e realizadas ' + A.realizados + ' (' + A.percentualCumprimento + '% de cumprimento). ';
  sumario += validados
    ? 'A Qualidade validou ' + validados + ' checklist(s): ' + A.aprovados + ' aprovado(s) e ' + A.reprovados + ' reprovado(s) (' + A.percentualAprovacao + '% de aprovação). '
    : 'Nenhum checklist foi validado pela Qualidade no período. ';
  sumario += 'Foram apontadas ' + plural(A.naoConformidades, 'não conformidade', 'não conformidades') + ' no checklist e ' + plural(d.ocorrencias.total, 'ocorrência') + ' pelos agentes.';
  if (topAmb) sumario += ' O principal ponto de atenção é ' + topAmb.ambiente + ', com ' + plural(topAmb.total, 'registro') + ' de problema no período.';
  if (turnoPior && turnosReais.length > 1) sumario += ' O turno com menor cumprimento foi o ' + turnoPior.rotulo + ' (' + turnoPior.pct + '%).';

  const prioridades = [];
  if (topAmb) prioridades.push(topAmb.ambiente + ': concentra ' + plural(topAmb.total, 'registro') + ' de problema (' +
    [topAmb.naoConformes && topAmb.naoConformes + ' não conforme(s)', topAmb.reprovados && topAmb.reprovados + ' reprovação(ões)', topAmb.ocorrencias && topAmb.ocorrencias + ' ocorrência(s)', topAmb.ncQualidade && topAmb.ncQualidade + ' NC da Qualidade'].filter(Boolean).join(', ') +
    '). É o principal ponto de intervenção.');
  if (turnoPior && turnoPior.pct < 90 && turnosReais.length > 1) prioridades.push(turnoPior.rotulo + ': cumpriu ' + turnoPior.pct + '% do previsto (' + turnoPior.a + ' de ' + turnoPior.b + '). Verificar escala, carga de atividades e registro no app.');
  if (localPior && localPior.pct < 90) prioridades.push(localPior.rotulo + ': cumpriu ' + localPior.pct + '% do previsto (' + localPior.a + ' de ' + localPior.b + ').');
  if (A.atrasados > 0) prioridades.push('Atividades atrasadas: ' + A.atrasados + ' previstas não foram registradas no dia/período. Confirmar se não foram feitas ou se só não foram lançadas.');
  if (motivos[0]) prioridades.push('Motivo de reprovação mais frequente: "' + motivos[0].rotulo + '" (' + motivos[0].a + 'x). Reorientar os agentes nesse ponto.');
  if (!prioridades.length) prioridades.push('Nenhum ponto crítico identificado no período. Manter a rotina de checklist e validação.');

  const plano = [];
  if (topAmb) plano.push(['Ação corretiva de limpeza em ' + topAmb.ambiente, 'Alta', 'Eliminar a reincidência de problemas no ambiente.']);
  if (A.atrasados > 0) plano.push(['Reforçar a execução das atividades atrasadas', A.percentualCumprimento < 70 ? 'Alta' : 'Média', 'Elevar o cumprimento do planejamento.']);
  if (turnoPior && turnoPior.pct < 90 && turnosReais.length > 1) plano.push(['Acompanhar o ' + turnoPior.rotulo, turnoPior.pct < 70 ? 'Alta' : 'Média', 'Igualar o cumprimento entre os turnos.']);
  if (A.reprovados > 0) plano.push(['Reorientar agentes nos itens reprovados', 'Média', 'Reduzir reprovações na validação.']);
  const ocoPend = (d.ocorrencias.porStatus.ABERTA || 0) + (d.ocorrencias.porStatus.EM_ANALISE || 0);
  if (ocoPend) plano.push(['Analisar ' + plural(ocoPend, 'ocorrência pendente', 'ocorrências pendentes'), 'Média', 'Dar retorno aos agentes e tratar as causas.']);
  if (d.fotos.semEvidencia > 0) plano.push(['Cobrar evidência fotográfica nas atividades críticas', 'Baixa', 'Garantir rastreabilidade da limpeza.']);
  plano.push(['Manter rotina de checklist e validação', 'Média', 'Garantir detecção precoce.']);

  let conclusao;
  if (A.totalPrevisto === 0) conclusao = 'Não havia atividades de limpeza previstas no período selecionado.';
  else if (A.percentualCumprimento >= 90) conclusao = 'O período apresentou bom cumprimento do planejamento de limpeza (' + A.percentualCumprimento + '%).' + (topAmb ? ' Ainda assim, ' + topAmb.ambiente + ' concentra a maior parte dos problemas e deve seguir acompanhado.' : '');
  else if (A.percentualCumprimento >= 70) conclusao = 'O cumprimento do planejamento ficou em ' + A.percentualCumprimento + '%, abaixo do ideal. Há desvios que exigem acompanhamento' + (topAmb ? ', com prioridade para ' + topAmb.ambiente : '') + '.';
  else conclusao = 'O cumprimento do planejamento ficou em ' + A.percentualCumprimento + '%, nível crítico. É necessário rever a execução e o registro das atividades' + (turnoPior && turnosReais.length > 1 ? ', começando pelo ' + turnoPior.rotulo : '') + (topAmb ? ', e tratar ' + topAmb.ambiente + ' como prioridade operacional' : '') + '.';

  // ---- componentes de página ----
  const slide = function (titulo, corpo, nota) {
    return '<section class="slide"><h2>' + resumoEsc(titulo) + '</h2><div class="corpo">' + corpo + '</div>' +
      (nota ? '<p class="nota">' + nota + '</p>' : '') + '</section>';
  };
  const grafico = function (svg) { return '<div class="grafico">' + svg + '</div>'; };
  const tile = function (v, r) { return '<div class="tile"><b>' + resumoEsc(v) + '</b><span>' + resumoEsc(r) + '</span></div>'; };
  const tabela = function (cab, linhas) {
    return '<table><thead><tr>' + cab.map(function (c) { return '<th>' + resumoEsc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      linhas.map(function (l) { return '<tr>' + l.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  };
  const varNota = function (nome, a, b, menorMelhor) {
    const v = variacao(a, b, menorMelhor);
    if (a === b) return '<span class="neutro">' + nome + ': igual ao período anterior (' + a + ').</span>';
    return '<span class="' + v.cls + '">' + (a > b ? '▲ ' : '▼ ') + nome + ': ' + (a > b ? 'aumento' : 'redução') + ' de ' +
      (b ? Math.round(Math.abs(a - b) / b * 100) + '%' : Math.abs(a - b)) + ' em relação ao período anterior (' + a + ' vs. ' + b + ').</span>';
  };
  const corPrio = function (p) { return p === 'Alta' ? 'ruim' : p === 'Média' ? 'aviso' : 'neutro'; };

  const paginas = [];

  // 1. Capa
  paginas.push('<section class="slide capa"><div><p class="marca">ICC BRAZIL</p><h1>Resumo de Limpeza</h1><p class="sub">Checklist da Qualidade</p>' +
    '<p class="meta">' + resumoEsc(rotuloPeriodo) + ' &nbsp;·&nbsp; ' + resumoEsc(d.periodo.dataInicial) + ' a ' + resumoEsc(d.periodo.dataFinal) + ' &nbsp;·&nbsp; gerado em ' + resumoEsc(d.geradoEm) + '</p></div></section>');

  // 2. Sumário executivo
  paginas.push(slide('Sumário executivo',
    '<p class="texto">' + resumoEsc(sumario) + '</p>' +
    '<div class="tiles">' +
      tile(A.totalPrevisto, 'Atividades previstas') + tile(A.realizados, 'Realizadas') + tile(A.percentualCumprimento + '%', '% de cumprimento') +
      tile(A.atrasados, 'Atrasadas') + tile(validados ? A.percentualAprovacao + '%' : '—', '% de aprovação') + tile(A.naoConformidades, 'Não conformidades') +
    '</div>',
    '<i class="neutro">Período anterior usado na comparação: ' + resumoEsc(d.periodoAnterior.dataInicial) + ' a ' + resumoEsc(d.periodoAnterior.dataFinal) + '.</i>'));

  // 3. Leitura gerencial
  paginas.push(slide('Leitura gerencial dos indicadores', tabela(['Indicador', 'Período', 'Anterior', 'Variação', 'Status'],
    indicadores.map(function (r) {
      return [resumoEsc(r.nome), resumoEsc(r.atual), resumoEsc(r.anterior), '<b class="' + r.variacao.cls + '">' + resumoEsc(r.variacao.txt) + '</b>', '<b class="' + r.status[1] + '">' + r.status[0] + '</b>'];
    }))));

  // 4. Cumprimento por turno
  paginas.push(slide('Cumprimento por turno',
    porTurno.length ? grafico(svgColunas(porTurno, { serieA: 'Realizadas', serieB: 'Previstas', corA: RESUMO_CORES.realizado, corB: RESUMO_CORES.previsto })) : semDados,
    porTurno.map(function (t) { return '<b>' + resumoEsc(t.rotulo) + '</b>: ' + t.pct + '%'; }).join(' &nbsp;·&nbsp; ')));

  // 5. Cumprimento por local
  paginas.push(slide('Cumprimento por local',
    porLocal.length ? grafico(svgColunas(porLocal, { serieA: 'Realizadas', serieB: 'Previstas', corA: RESUMO_CORES.realizado, corB: RESUMO_CORES.previsto })) : semDados,
    porLocal.map(function (t) { return '<b>' + resumoEsc(t.rotulo) + '</b>: ' + t.pct + '%'; }).join(' &nbsp;·&nbsp; ')));

  // 6. Evolução no período
  paginas.push(slide('Evolução no período',
    evolucao.length ? '<p class="legenda-graf">' + evolucaoTitulo + '</p>' + grafico(svgColunas(evolucao, { serieA: 'Realizadas', serieB: 'Previstas', corA: RESUMO_CORES.realizado, corB: RESUMO_CORES.previsto, altura: 310 })) : semDados,
    varNota('Atividades realizadas', A.realizados, P.realizados, false)));

  // 7. Por agente
  const porAgente = ordenar(A.porAgente).slice(0, 12);
  paginas.push(slide('Atividades realizadas por agente',
    porAgente.length ? grafico(svgColunas(porAgente, { corA: RESUMO_CORES.neutro })) : semDados,
    varNota('Realizadas no total', A.realizados, P.realizados, false)));

  // 8. Validação da Qualidade
  const sv = d.statusValidacao || {};
  const validacao = [
    { rotulo: 'Aprovados', a: sv.APROVADO || 0, cor: RESUMO_CORES.aprovado },
    { rotulo: 'Reprovados', a: sv.REPROVADO || 0, cor: RESUMO_CORES.reprovado },
    { rotulo: 'Aguardando validação', a: sv.PENDENTE_VALIDACAO || 0, cor: RESUMO_CORES.pendente },
    { rotulo: 'Sem validação exigida', a: sv.SEM_VALIDACAO || 0, cor: RESUMO_CORES.previsto }
  ];
  paginas.push(slide('Validação da Qualidade',
    validacao.some(function (v) { return v.a; }) ? grafico(svgColunas(validacao, { altura: 300 })) : semDados,
    varNota('Reprovações', A.reprovados, P.reprovados, true)));

  // 9. Reprovações por agente + motivos
  const reprovAg = ordenar(A.reprovadosPorAgente).slice(0, 10);
  paginas.push(slide('Reprovações: por agente e motivos',
    reprovAg.length
      ? '<div class="duas"><div>' + grafico(svgBarrasH(reprovAg, { cor: RESUMO_CORES.reprovado, largura: 520 })) + '</div><div>' +
        (motivos.length ? tabela(['Motivo mais comum', 'Vezes'], motivos.slice(0, 6).map(function (m) { return [resumoEsc(m.rotulo), m.a]; })) : '<p class="vazio">Sem motivos registrados.</p>') + '</div></div>'
      : '<p class="vazio">Nenhum checklist reprovado no período.</p>'));

  // 10. Não conformidades por ambiente
  const ncAmb = ordenar(d.naoConformesPorAmbiente).slice(0, 12);
  paginas.push(slide('Não conformidades por ambiente',
    ncAmb.length ? grafico(svgBarrasH(ncAmb, { cor: RESUMO_CORES.pendente })) : '<p class="vazio">Nenhuma não conformidade apontada no checklist no período.</p>',
    varNota('Não conformidades', A.naoConformidades, P.naoConformidades, true)));

  // 11. Ocorrências
  const nomesStatusOco = { ABERTA: 'Aberta', EM_ANALISE: 'Em análise', PROCEDENTE: 'Procedente', NAO_PROCEDENTE: 'Não procedente', TRATADA: 'Tratada', ENCERRADA: 'Encerrada' };
  const ocoStatus = Object.keys(d.ocorrencias.porStatus).map(function (k) { return { rotulo: nomesStatusOco[k] || k, a: d.ocorrencias.porStatus[k] }; });
  const ocoTurno = ordenar(d.ocorrencias.porTurnoResponsavel);
  paginas.push(slide('Ocorrências abertas pelos agentes',
    d.ocorrencias.total
      ? '<div class="duas"><div><p class="legenda-graf">Por status</p>' + grafico(svgColunas(ocoStatus, { corA: RESUMO_CORES.roxo, largura: 440, altura: 300 })) + '</div>' +
        '<div><p class="legenda-graf">Por turno responsável (última limpeza)</p>' + (ocoTurno.length ? grafico(svgColunas(ocoTurno, { corA: RESUMO_CORES.roxo, largura: 440, altura: 300 })) : '<p class="vazio">Sem responsável identificado.</p>') + '</div></div>'
      : '<p class="vazio">Nenhuma ocorrência aberta no período.</p>',
    d.ocorrencias.total ? plural(d.ocorrencias.total, 'ocorrência') + ' no período, ' + d.ocorrencias.entreTurnos + ' entre turnos (problema deixado por um turno e encontrado por outro).' : ''));

  // 12. Não conformidades da Qualidade + evidências
  const nc = d.ncQualidade;
  const f = d.fotos;
  paginas.push(slide('Inspeções da Qualidade e evidências',
    '<div class="tiles">' +
      tile(nc.total, 'NCs abertas pela Qualidade') + tile(nc.porStatus.FINALIZADA || 0, 'NCs finalizadas') + tile((nc.porStatus.ABERTA || 0) + (nc.porStatus.AGUARDANDO_VALIDACAO || 0), 'NCs em aberto') +
      tile(f.comFotoAntes, 'Com foto ANTES') + tile(f.comFotoDepois, 'Com foto DEPOIS') + tile(f.semEvidencia, 'Sem evidência') +
    '</div>',
    f.total ? pct(f.total - f.semEvidencia, f.total) + '% dos checklists do período têm pelo menos uma evidência fotográfica.' : ''));

  // 13. Últimos 6 meses
  const meses = d.meses || [];
  paginas.push(slide('Evolução mensal (últimos 6 meses)',
    '<div class="duas"><div><p class="legenda-graf">Atividades realizadas por mês</p>' + grafico(svgColunas(meses.map(function (m) { return { rotulo: m.rotulo, a: m.realizados }; }), { corA: RESUMO_CORES.realizado, largura: 440, altura: 300 })) + '</div>' +
    '<div><p class="legenda-graf">Não conformidades por mês</p>' + grafico(svgColunas(meses.map(function (m) { return { rotulo: m.rotulo, a: m.naoConformes }; }), { corA: RESUMO_CORES.pendente, largura: 440, altura: 300 })) + '</div></div>'));

  // 14. Ambientes críticos
  paginas.push(slide('Ambientes com mais problemas',
    criticos.length
      ? tabela(['Local · Ambiente', 'Não conformes', 'Reprovações', 'Ocorrências', 'NC Qualidade', 'Total'],
          criticos.slice(0, 8).map(function (c) { return [resumoEsc(c.ambiente), c.naoConformes, c.reprovados, c.ocorrencias, c.ncQualidade, '<b>' + c.total + '</b>']; }))
      : '<p class="vazio">Nenhum problema registrado nos ambientes no período.</p>'));

  // 15. Pontos críticos
  paginas.push(slide('Pontos críticos e prioridades',
    prioridades.map(function (p, i) { return '<p class="prioridade">Prioridade ' + (i + 1) + ' — ' + resumoEsc(p) + '</p>'; }).join('')));

  // 16. Plano de ação
  paginas.push(slide('Plano de ação gerencial', tabela(['Ação', 'Prioridade', 'Objetivo'],
    plano.map(function (p) { return [resumoEsc(p[0]), '<b class="' + corPrio(p[1]) + '">' + p[1] + '</b>', resumoEsc(p[2])]; }))));

  // 17. Conclusão
  paginas.push(slide('Conclusão gerencial',
    '<p class="texto">' + resumoEsc(conclusao) + '</p>' +
    '<h3>Observações e premissas</h3><p class="premissa">Relatório gerado automaticamente a partir dos registros do app Checklist da Qualidade. ' +
    '"Previstas" vem do planejamento cadastrado em Atividades de limpeza (frequência e turnos de cada atividade); o dia operacional vira às 06:00, então o que o turno da madrugada faz conta no dia em que o turno começou. ' +
    'Atividades cadastradas no meio do período contam como previstas desde o início do período. As prioridades e o plano de ação são sugestões automáticas e devem ser revisados por um gestor antes de qualquer apresentação formal.</p>'));

  // 18. Encerramento
  paginas.push('<section class="slide capa"><div><p class="meta">Documento gerado automaticamente pelo app Checklist da Qualidade — ICC Brazil.</p></div></section>');

  const css =
    '@page{size:1000px 563px;margin:0}' +
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{margin:0;background:#8a8f88;font-family:Arial,Helvetica,sans-serif;color:#222}' +
    '.barra{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px;background:#2a2e31;color:#fff;font-size:14px}' +
    '.barra button{background:#5e9030;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;font-weight:bold;cursor:pointer}' +
    '.paginas{display:flex;flex-direction:column;align-items:center;gap:18px;padding:18px 0}' +
    '.slide{position:relative;width:1000px;height:563px;overflow:hidden;background:#fff url("' + bg + '") center/cover no-repeat;padding:48px 64px 40px;box-shadow:0 4px 18px rgba(0,0,0,.25);display:flex;flex-direction:column}' +
    '.slide h2{margin:6px 0 14px;color:#436722;font-size:29px;max-width:760px}' +
    '.corpo{flex:1;min-height:0}' +
    '.capa{justify-content:center}' +
    '.capa .marca{margin:0 0 26px;color:#436722;font-weight:bold;font-size:19px}' +
    '.capa h1{margin:0;font-size:50px;color:#1d1f21}' +
    '.capa .sub{margin:6px 0 30px;color:#5e9030;font-size:31px;font-weight:bold}' +
    '.capa .meta{color:#555;font-size:15px}' +
    '.texto{font-size:16px;line-height:1.45;margin:0 0 18px;max-width:840px}' +
    '.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:26px}' +
    '.tile{background:rgba(238,238,236,.92);padding:14px 12px;min-height:94px}' +
    '.tile b{display:block;font-size:28px;margin-bottom:6px}.tile span{font-size:12px;color:#555}' +
    '.nota{margin:8px 0 0;font-size:13px;font-weight:bold;color:#333}' +
    '.grafico{background:rgba(255,255,255,.93);border:1px solid #e3e5e1;padding:12px 16px}' +
    '.legenda-graf{margin:0 0 6px;font-size:13px;font-weight:bold;color:#444}' +
    '.duas{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}' +
    'table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}' +
    'th{background:#436722;color:#fff;text-align:left;padding:10px 12px;font-weight:bold}' +
    'td{padding:9px 12px;border:1px solid #cfd3cc}tr:nth-child(even) td{background:#f6f6f4}' +
    '.ruim{color:#c63d3d}.aviso{color:#c8741a}.bom{color:#2f7d4a}.neutro{color:#666}' +
    '.prioridade{font-size:15px;line-height:1.45;margin:0 0 20px;max-width:860px}' +
    '.slide h3{color:#436722;font-size:19px;margin:34px 0 8px}' +
    '.premissa{font-size:12px;color:#666;font-style:italic;line-height:1.45;max-width:860px}' +
    '.vazio{font-size:15px;color:#666;background:rgba(238,238,236,.9);padding:22px}' +
    '@media print{body{background:none}.barra{display:none}.paginas{display:block;padding:0}.slide{box-shadow:none;page-break-after:always;break-after:page}}' +
    '@media screen and (max-width:1040px){.paginas{zoom:.9}}' +
    '@media screen and (max-width:700px){.paginas{zoom:.36}}';

  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Resumo de Limpeza - ' + resumoEsc(d.periodo.dataInicial) + ' a ' + resumoEsc(d.periodo.dataFinal) + '</title><style>' + css + '</style></head><body>' +
    '<div class="barra"><span>Resumo de Limpeza · ' + paginas.length + ' páginas</span><button onclick="window.print()">🖨 Imprimir / Salvar em PDF</button></div>' +
    '<div class="paginas">' + paginas.join('') + '</div></body></html>';
}

// ------------------------- DASHBOARD GERAL (tudo numa página) -------------------------
// Visão completa do checklist de limpeza numa rolagem só, no estilo dos
// dashboards do app de armazéns (cards escuros com gráficos). Usa os mesmos
// dados do Resumo gerencial (getResumoLimpeza), então o botão "PDF deste
// período" gera o resumo impresso sem buscar nada de novo.

async function renderDashGeral() {
  appendHtml(app, screenHeader('Dashboards', 'Dashboard geral', 'Checklist de limpeza — visão completa'));
  dashBackButton();

  const st = S.dashGeralFiltro = S.dashGeralFiltro || { periodo: 'mes', local: '', turno: '', ini: '', fim: '' };
  const filtros = el(
    '<div class="stack" style="gap:8px">' +
      '<div class="filters" id="dgPeriodos"></div>' +
      '<div class="filters" id="dgDatas" style="display:none"><input type="date" id="dgIni"><input type="date" id="dgFim"><button type="button" class="btn btn--outline btn--sm" id="dgAplicar">Aplicar</button></div>' +
      '<div class="filters"><select id="dgLocal"><option value="">Todos os locais</option></select><select id="dgTurno"><option value="">Todos os turnos</option></select></div>' +
    '</div>'
  );
  app.appendChild(filtros);
  const corpo = el('<div class="stack" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(corpo);

  const periodos = [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['custom', 'Personalizado']];
  const wrapP = filtros.querySelector('#dgPeriodos');
  periodos.forEach(function (p) {
    const b = el('<button type="button" class="btn btn--outline btn--sm" data-p="' + p[0] + '">' + p[1] + '</button>');
    b.onclick = function () { st.periodo = p[0]; marcarPeriodo(); if (p[0] !== 'custom') carregar(); };
    wrapP.appendChild(b);
  });
  function marcarPeriodo() {
    wrapP.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.p === st.periodo); });
    filtros.querySelector('#dgDatas').style.display = st.periodo === 'custom' ? 'flex' : 'none';
  }
  marcarPeriodo();
  const inIni = filtros.querySelector('#dgIni'), inFim = filtros.querySelector('#dgFim');
  inIni.value = st.ini; inFim.value = st.fim;
  filtros.querySelector('#dgAplicar').onclick = function () {
    if (!inIni.value || !inFim.value || inIni.value > inFim.value) { toast('Escolha a data inicial e a final.', true); return; }
    st.ini = inIni.value; st.fim = inFim.value; carregar();
  };

  const selLocal = filtros.querySelector('#dgLocal'), selTurno = filtros.querySelector('#dgTurno');
  const [locais, turnos] = await Promise.all([
    api('getLocais', {}).catch(function () { return []; }),
    api('getTurnos', {}).catch(function () { return []; })
  ]);
  locais.forEach(function (l) { selLocal.appendChild(el('<option value="' + escapeHtml(l.LOCAL) + '">' + escapeHtml(l.LOCAL) + '</option>')); });
  turnos.forEach(function (t) { selTurno.appendChild(el('<option value="' + escapeHtml(t.TURNO) + '">' + escapeHtml(t.TURNO) + '</option>')); });
  selLocal.value = st.local; selTurno.value = st.turno;
  selLocal.onchange = function () { st.local = selLocal.value; carregar(); };
  selTurno.onchange = function () { st.turno = selTurno.value; carregar(); };

  function periodoAtual() {
    if (st.periodo === 'custom') {
      if (!st.ini || !st.fim) return null;
      const a = new Date(st.ini + 'T00:00:00'), b = new Date(st.fim + 'T00:00:00');
      return { dataInicial: dateToBR(a), dataFinal: dateToBR(b), rotulo: 'Período de ' + dateToBR(a) + ' a ' + dateToBR(b) };
    }
    return periodoResumoPreset(st.periodo);
  }

  async function carregar() {
    const per = periodoAtual();
    if (!per) { corpo.innerHTML = '<p class="subtle">Escolha as datas e toque em Aplicar.</p>'; return; }
    corpo.innerHTML = '<div class="kpi-grid"><div class="skeleton" style="height:70px"></div><div class="skeleton" style="height:70px"></div><div class="skeleton" style="height:70px"></div><div class="skeleton" style="height:70px"></div></div><div class="skeleton" style="height:240px;margin-top:12px"></div>';
    const d = await api('getResumoLimpeza', { dataInicial: per.dataInicial, dataFinal: per.dataFinal, local: st.local, turno: st.turno }).catch(function () { return null; });
    if (!d) { corpo.innerHTML = '<p class="subtle">Não foi possível carregar os dados.</p>'; return; }
    desenhar(d, per);
  }

  function desenhar(d, per) {
    corpo.innerHTML = '';
    const A = d.atual, P = d.anterior;
    const pct = function (a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; };
    const ordenar = function (obj) { return Object.keys(obj || {}).map(function (k) { return { rotulo: k, a: obj[k] }; }).sort(function (x, y) { return y.a - x.a; }); };
    const cumpr = function (obj) {
      return Object.keys(obj || {}).map(function (k) { return { rotulo: k === 'Qualquer turno' ? 'Qualquer turno (basta um)' : k, a: obj[k].realizado, b: obj[k].previsto, pct: pct(obj[k].realizado, obj[k].previsto) }; });
    };
    const W = 400; // largura interna dos gráficos: próxima da tela do celular, para o texto não encolher
    const base = { escuro: true, largura: W };
    const dupla = { escuro: true, largura: W, serieA: 'Realizadas', serieB: 'Previstas', corA: '#6fae3a', corB: '#5d6760' };
    const comp = function (atual, anterior, menorMelhor) {
      if (anterior === undefined || anterior === null) return '';
      return comparativoBadge(atual, anterior, menorMelhor);
    };

    // Cabeçalho do período + PDF
    const topo = el('<div class="row between" style="flex-wrap:wrap;gap:8px"><span class="subtle">' + escapeHtml(per.rotulo) + ' · comparado com ' + escapeHtml(d.periodoAnterior.dataInicial) + ' a ' + escapeHtml(d.periodoAnterior.dataFinal) + '</span></div>');
    const btnPdf = el('<button type="button" class="btn btn--outline btn--sm">📄 PDF deste período</button>');
    btnPdf.onclick = function () {
      const j = window.open('', '_blank');
      if (!j) { toast('O navegador bloqueou a nova aba. Libere pop-ups para este site.', true); return; }
      j.document.open(); j.document.write(montarResumoHtml(d, per.rotulo + (st.local ? ' · ' + st.local : '') + (st.turno ? ' · ' + st.turno : ''))); j.document.close();
    };
    topo.appendChild(btnPdf);
    corpo.appendChild(topo);

    // Indicadores
    const validados = A.aprovados + A.reprovados;
    corpo.appendChild(el(
      '<div class="kpi-grid">' +
        kpiComp(A.totalPrevisto, 'Previstas', '') +
        kpiComp(A.realizados, 'Realizadas', comp(A.realizados, P.realizados, false)) +
        kpiComp(A.percentualCumprimento + '%', '% de cumprimento', comp(A.percentualCumprimento, P.percentualCumprimento, false)) +
        kpiComp(A.atrasados, 'Atrasadas', comp(A.atrasados, P.atrasados, true)) +
        kpiComp(validados ? A.percentualAprovacao + '%' : '—', '% de aprovação', '') +
        kpiComp(A.reprovados, 'Reprovados', comp(A.reprovados, P.reprovados, true)) +
        kpiComp(A.naoConformidades, 'Não conformidades', comp(A.naoConformidades, P.naoConformidades, true)) +
        kpiComp(d.ocorrencias.total, 'Ocorrências', comp(A.totalOcorrencias, P.totalOcorrencias, true)) +
      '</div>'
    ));

    const card = function (titulo, sub, conteudo, nota) {
      corpo.appendChild(el('<div class="dash-card"><h3>' + escapeHtml(titulo) + '</h3>' + (sub ? '<p class="dash-card__sub">' + escapeHtml(sub) + '</p>' : '') +
        conteudo + (nota ? '<p class="dash-card__nota">' + nota + '</p>' : '') + '</div>'));
    };
    const vazio = '<p class="dash-card__sub" style="padding:18px 0">Sem dados no período.</p>';
    const secao = function (t) { corpo.appendChild(el('<span class="eyebrow" style="display:block;margin-top:10px">' + escapeHtml(t) + '</span>')); };

    secao('Cumprimento do planejamento');
    const turnosC = cumpr(A.cumprimentoPorTurno);
    card('Cumprimento por turno', 'Realizadas × previstas', turnosC.length ? svgColunas(turnosC, dupla) : vazio,
      turnosC.map(function (t) { return escapeHtml(t.rotulo) + ': <b>' + t.pct + '%</b>'; }).join(' · '));
    const locaisC = cumpr(A.cumprimentoPorLocal).sort(function (x, y) { return y.b - x.b; });
    card('Cumprimento por local', 'Realizadas × previstas', locaisC.length ? svgColunas(locaisC, dupla) : vazio,
      locaisC.map(function (t) { return escapeHtml(t.rotulo) + ': <b>' + t.pct + '%</b>'; }).join(' · '));
    const diasOrd = Object.keys(A.cumprimentoPorDia || {}).sort(function (x, y) { return parseBR(x) - parseBR(y); });
    const serieDia = diasOrd.map(function (k) { return { rotulo: k.slice(0, 5), a: A.cumprimentoPorDia[k].realizado, b: A.cumprimentoPorDia[k].previsto }; });
    // Muitos dias: o gráfico fica mais largo que a tela e rola para o lado.
    if (serieDia.length > 1) card('Evolução no período', 'Realizadas × previstas por dia', svgColunas(serieDia.slice(-31), Object.assign({}, dupla, { largura: Math.max(W, serieDia.length * 26) }))
      .replace('<svg ', '<svg style="min-width:' + Math.max(360, serieDia.length * 26) + 'px" '));

    secao('Equipe e validação');
    const ag = ordenar(A.porAgente);
    card('Realizadas por agente', '', ag.length ? svgBarrasH(ag, { escuro: true, largura: W, cor: '#4f94d4' }) : vazio);
    const sv = d.statusValidacao || {};
    card('Validação da Qualidade', 'Situação dos checklists do período', svgColunas([
      { rotulo: 'Aprovados', a: sv.APROVADO || 0, cor: '#3fa66a' }, { rotulo: 'Reprovados', a: sv.REPROVADO || 0, cor: '#e05858' },
      { rotulo: 'Aguardando', a: sv.PENDENTE_VALIDACAO || 0, cor: '#e0a23a' }, { rotulo: 'Sem validação', a: sv.SEM_VALIDACAO || 0, cor: '#7c857d' }
    ], base));
    const rep = ordenar(A.reprovadosPorAgente);
    const motivos = ordenar(d.motivosReprovacao).slice(0, 5);
    card('Reprovações por agente', motivos.length ? 'Motivo mais comum: ' + motivos[0].rotulo + ' (' + motivos[0].a + 'x)' : '',
      rep.length ? svgBarrasH(rep, { escuro: true, largura: W, cor: '#e05858' }) : '<p class="dash-card__sub" style="padding:18px 0">Nenhuma reprovação no período.</p>');

    secao('Problemas encontrados');
    const nc = ordenar(d.naoConformesPorAmbiente).slice(0, 10);
    card('Não conformidades por ambiente', 'Apontadas no checklist', nc.length ? svgBarrasH(nc, { escuro: true, largura: W, cor: '#e0a23a' }) : '<p class="dash-card__sub" style="padding:18px 0">Nenhuma não conformidade no período.</p>');
    const nomesStatusOco = { ABERTA: 'Aberta', EM_ANALISE: 'Em análise', PROCEDENTE: 'Procedente', NAO_PROCEDENTE: 'Não proced.', TRATADA: 'Tratada', ENCERRADA: 'Encerrada' };
    const ocoSt = Object.keys(d.ocorrencias.porStatus).map(function (k) { return { rotulo: nomesStatusOco[k] || k, a: d.ocorrencias.porStatus[k] }; });
    card('Ocorrências por status', d.ocorrencias.total ? d.ocorrencias.total + ' no período · ' + d.ocorrencias.entreTurnos + ' entre turnos' : '', ocoSt.length ? svgColunas(ocoSt, Object.assign({}, base, { corA: '#9b7bea' })) : '<p class="dash-card__sub" style="padding:18px 0">Nenhuma ocorrência no período.</p>');
    const ocoTurno = ordenar(d.ocorrencias.porTurnoResponsavel);
    if (ocoTurno.length) card('Ocorrências por turno responsável', 'Turno da última limpeza antes do problema', svgColunas(ocoTurno, Object.assign({}, base, { corA: '#9b7bea' })));
    const ncq = d.ncQualidade;
    card('Inspeções da Qualidade', '', svgColunas([
      { rotulo: 'Abertas pela Qualidade', a: ncq.total, cor: '#4f94d4' },
      { rotulo: 'Finalizadas', a: ncq.porStatus.FINALIZADA || 0, cor: '#3fa66a' },
      { rotulo: 'Em aberto', a: (ncq.porStatus.ABERTA || 0) + (ncq.porStatus.AGUARDANDO_VALIDACAO || 0), cor: '#e0a23a' }
    ], base));
    const f = d.fotos;
    card('Evidências fotográficas', f.total ? pct(f.total - f.semEvidencia, f.total) + '% dos checklists têm ao menos uma foto' : '', svgColunas([
      { rotulo: 'Com foto antes', a: f.comFotoAntes, cor: '#4f94d4' }, { rotulo: 'Com foto depois', a: f.comFotoDepois, cor: '#3fa66a' }, { rotulo: 'Sem evidência', a: f.semEvidencia, cor: '#7c857d' }
    ], base));

    secao('Evolução mensal (últimos 6 meses)');
    const meses = d.meses || [];
    [['realizados', 'Atividades realizadas por mês', '#6fae3a'], ['naoConformes', 'Não conformidades por mês', '#e0a23a'],
     ['reprovados', 'Reprovações por mês', '#e05858'], ['ocorrencias', 'Ocorrências por mês', '#9b7bea']].forEach(function (m) {
      card(m[1], '', svgColunas(meses.map(function (x) { return { rotulo: x.rotulo, a: x[m[0]] }; }), Object.assign({}, base, { corA: m[2], altura: 260 })));
    });

    secao('Ambientes com mais problemas');
    const crit = d.ambientesCriticos || [];
    corpo.appendChild(el('<div class="card" style="padding:0;overflow-x:auto">' + (crit.length
      ? '<table class="report-table" style="min-width:520px"><tr><th>Local · Ambiente</th><th>Não conf.</th><th>Reprov.</th><th>Ocorr.</th><th>NC Qual.</th><th>Total</th></tr>' +
        crit.map(function (c) { return '<tr><td>' + escapeHtml(c.ambiente) + '</td><td>' + c.naoConformes + '</td><td>' + c.reprovados + '</td><td>' + c.ocorrencias + '</td><td>' + c.ncQualidade + '</td><td><b>' + c.total + '</b></td></tr>'; }).join('') + '</table>'
      : '<p class="subtle" style="padding:16px">Nenhum problema registrado no período.</p>') + '</div>'));
  }

  carregar();
}

// KPI com comparação ao período anterior (reaproveita comparativoBadge).
function kpiComp(valor, rotulo, comparacao) {
  return '<div class="kpi"><span class="badge-count">' + escapeHtml(valor) + '</span><span class="subtle">' + escapeHtml(rotulo) + '</span>' +
    (comparacao ? '<div style="font-size:11.5px;margin-top:4px;line-height:1.3">' + comparacao + '</div>' : '') + '</div>';
}
