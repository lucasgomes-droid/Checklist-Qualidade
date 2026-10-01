/**
 * CHECKLIST DA QUALIDADE — ICC Brazil Animal Nutrition
 * BACKEND (Google Apps Script)
 * ---------------------------------------------------
 * Mesma arquitetura do sistema "Gestão de Armazéns" já usado pela empresa:
 * o Google Sheets é o banco de dados, este script expõe uma API HTTP
 * (Web App) e o frontend estático (index.html/app.js/style.css) consome
 * via fetch().
 *
 * IMPORTANTE:
 * 1. Rode a função `configurarPlanilha` UMA VEZ (menu Executar) para criar
 *    todas as abas com cabeçalhos e dados de exemplo.
 * 2. Implante como Web App: Implantar > Nova implantação > Tipo: App da Web
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 * 3. Copie a URL gerada (termina em /exec) e cole em app.js na API_URL.
 *
 * Veja SETUP.md para o passo a passo completo e o mapeamento entre as
 * abas da planilha e as seções da especificação original.
 */

// ======================= CONFIGURAÇÃO =======================

const SHEETS = {
  USUARIOS: 'USUARIOS',
  LOCAIS: 'LOCAIS',
  AMBIENTES: 'AMBIENTES',
  TURNOS: 'TURNOS',
  ATIVIDADES: 'ATIVIDADES',
  CHECKLISTS: 'CHECKLISTS',
  OCORRENCIAS: 'OCORRENCIAS',
  NAO_CONFORMIDADES: 'NAO_CONFORMIDADES',
  UNIDADES: 'UNIDADES',
  SEQ: '_SEQ'
};

const HEADERS = {
  // TURNO adicionado no final (não no meio) de propósito: assim, ao rodar
  // configurarPlanilha numa planilha já existente, as colunas antigas
  // (que já tinham dados) não mudam de posição — só uma coluna nova em
  // branco é adicionada no final, sem bagunçar o que já estava preenchido.
  // PIN adicionado no final (mesmo motivo do TURNO): login numérico de 4
  // dígitos do Agente de Limpeza (a senha continua exclusiva do Admin).
  // Emails (coluna I, lida pelos relatórios automáticos — Relatorios.gs) e
  // UNIDADE adicionadas no final, mesmo motivo do TURNO/PIN.
  // UNIDADE = Macatuba / Jundiaí I / Jundiaí II (ver aba UNIDADES) ou TODAS
  // (supervisão: entra em qualquer unidade e pode ver todas juntas).
  USUARIOS: ['ID_USUARIO', 'NOME', 'USUARIO', 'SENHA', 'PERFIL', 'ATIVO', 'TURNO', 'PIN', 'Emails', 'UNIDADE'],
  LOCAIS: ['ID_LOCAL', 'LOCAL', 'ATIVO', 'UNIDADE'],
  AMBIENTES: ['ID_AMBIENTE', 'LOCAL', 'AMBIENTE', 'ATIVO', 'UNIDADE'],
  TURNOS: ['ID_TURNO', 'TURNO', 'ATIVO'],
  // VEZES e DIAS_FIXOS adicionadas no final (migração aditiva, mesmo motivo
  // do TURNO/PIN em USUARIOS): usadas só pela frequência personalizada
  // (PERIODICIDADE = VEZES_SEMANA ou VEZES_MES — ex.: 3x por semana).
  ATIVIDADES: ['ID_ATIVIDADE', 'LOCAL', 'AMBIENTE', 'ATIVIDADE', 'PERIODICIDADE', 'TURNO', 'DIA_SEMANA', 'DIA_MES', 'FOTO_ANTES', 'FOTO_DEPOIS', 'VALIDACAO', 'ATIVO', 'VEZES', 'DIAS_FIXOS', 'MODO_TURNO', 'UNIDADE'],
  CHECKLISTS: ['ID_CHECKLIST', 'DATA', 'HORA', 'TURNO', 'LOCAL', 'AMBIENTE', 'ATIVIDADE', 'ID_ATIVIDADE', 'PERIODICIDADE', 'ID_AGENTE', 'AGENTE', 'RESULTADO', 'OBSERVACAO', 'FOTO_ANTES', 'FOTO_DEPOIS', 'STATUS', 'ADMIN_VALIDADOR', 'DATA_VALIDACAO', 'MOTIVO_REPROVACAO', 'OBS_VALIDACAO', 'REFAZER', 'DATA_OPERACIONAL', 'UNIDADE'],
  OCORRENCIAS: ['ID_OCORRENCIA', 'DATA', 'HORA', 'TURNO', 'ID_AGENTE', 'AGENTE', 'LOCAL', 'AMBIENTE', 'DESCRICAO', 'FOTO', 'STATUS', 'ADMIN_ANALISE', 'DATA_ANALISE', 'RESULTADO_ANALISE', 'OBSERVACAO_ANALISE', 'TURNO_RESPONSAVEL', 'ID_AGENTE_RESPONSAVEL', 'AGENTE_RESPONSAVEL', 'DATA_ULTIMA_LIMPEZA', 'UNIDADE'],
  // "Não Conformidade" = inspeção feita pelo próprio Admin da Qualidade no
  // local, já direcionando o problema encontrado a um Agente de Limpeza
  // específico (como uma pendência direcionada, ao contrário de OCORRENCIAS,
  // que é aberta livremente pelo agente).
  NAO_CONFORMIDADES: ['ID_NC', 'DATA', 'HORA', 'LOCAL', 'AMBIENTE', 'DESCRICAO', 'FOTO', 'ID_AGENTE_RESPONSAVEL', 'AGENTE_RESPONSAVEL', 'ADMIN_ABRIU', 'STATUS', 'DATA_RESOLUCAO', 'DESCRICAO_RESOLUCAO', 'FOTO_RESOLUCAO', 'DATA_VALIDACAO', 'ADMIN_VALIDADOR', 'MOTIVO_REPROVACAO', 'UNIDADE'],
  // Unidades da empresa. Para criar uma nova, basta uma linha aqui.
  UNIDADES: ['ID_UNIDADE', 'UNIDADE', 'ATIVO'],
  _SEQ: ['PREFIXO', 'ULTIMO_NUMERO']
};

const FOLDER_NAME = 'ChecklistQualidade_Fotos';

// ======================= UNIDADES (Macatuba, Jundiaí I, Jundiaí II…) =======================
// Cada chamada do app traz a unidade escolhida na tela de login (parâmetro
// "unidade"). Ela vira o "contexto" da chamada e TODAS as leituras das abas
// por unidade (readSheet_) passam a enxergar só os registros dela — assim o
// painel, os dashboards, o wizard do agente, as validações etc. ficam
// separados por unidade sem cada função precisar se preocupar com isso.
// As gravações (appendRow_/appendRows_) carimbam a unidade no registro.
//   - unidade vazia (versão antiga do app) = UNIDADE_PADRAO_ (Macatuba);
//   - unidade "TODAS" = sem filtro (supervisão vendo todas juntas).
// Registros antigos com UNIDADE em branco contam como UNIDADE_PADRAO_.
const UNIDADE_PADRAO_ = 'Macatuba';
const UNIDADE_TODAS_ = 'TODAS';
const UNIDADES_INICIAIS_ = ['Macatuba', 'Jundiaí I', 'Jundiaí II'];
const ABAS_POR_UNIDADE_ = [SHEETS.USUARIOS, SHEETS.LOCAIS, SHEETS.AMBIENTES, SHEETS.ATIVIDADES, SHEETS.CHECKLISTS, SHEETS.OCORRENCIAS, SHEETS.NAO_CONFORMIDADES];
// Gravações que criam registro numa unidade: no modo "Todas" é preciso
// escolher uma unidade antes (o app avisa).
const ACOES_EXIGEM_UNIDADE_ = ['createAtividade', 'createAtividadesLote', 'createLocal', 'createAmbiente',
  'createChecklist', 'createOcorrencia', 'createNaoConformidade'];

let _UNIDADE_CTX_ = null; // null = sem filtro (todas)

function normUnid_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// Nomes das unidades ativas, na ordem da aba UNIDADES.
function unidadesCadastradas_() {
  const sh = sheet_(SHEETS.UNIDADES);
  if (!sh) return UNIDADES_INICIAIS_.slice();
  const lista = readSheetTodas_(SHEETS.UNIDADES)
    .filter(function (u) { return u.UNIDADE && String(u.ATIVO).toUpperCase() !== 'NAO'; })
    .map(function (u) { return String(u.UNIDADE).trim(); });
  return lista.length ? lista : UNIDADES_INICIAIS_.slice();
}

// Grafia oficial da unidade (ignora acento/maiúscula), 'TODAS', ou null se não existe.
function resolverUnidade_(valor) {
  const n = normUnid_(valor);
  if (!n) return null;
  if (n === UNIDADE_TODAS_) return UNIDADE_TODAS_;
  const achada = unidadesCadastradas_().find(function (u) { return normUnid_(u) === n; });
  return achada || null;
}

function definirUnidadeContexto_(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    _UNIDADE_CTX_ = UNIDADE_PADRAO_;
    return _UNIDADE_CTX_;
  }
  const u = resolverUnidade_(valor);
  if (!u) throw new Error('Unidade não encontrada: ' + valor);
  _UNIDADE_CTX_ = u === UNIDADE_TODAS_ ? null : u;
  return _UNIDADE_CTX_;
}

// Nome do local para exibir: no modo "Todas" leva a unidade junto
// ("Macatuba · Refeitório"), para locais de mesmo nome não se misturarem.
function localRotulo_(r) {
  return _UNIDADE_CTX_ === null ? unidadeDoRegistro_(r) + ' · ' + r.LOCAL : r.LOCAL;
}

function unidadeDoRegistro_(r) {
  return (r && String(r.UNIDADE || '').trim()) || UNIDADE_PADRAO_;
}

function registroNaUnidade_(sheetName, r, unidade) {
  const u = normUnid_(unidadeDoRegistro_(r));
  if (sheetName === SHEETS.USUARIOS && u === UNIDADE_TODAS_) return true; // supervisão aparece em todas
  return u === normUnid_(unidade);
}

// ---------- DIA OPERACIONAL ----------
// O dia de trabalho NÃO vira à meia-noite: vira neste horário. Assim o
// turno que atravessa a madrugada (ex.: 14:20 → 02:00) e o turno da
// madrugada (02:00 → 06:00) contam no mesmo dia em que o turno começou.
// Tudo que for registrado antes deste horário conta para o dia anterior.
// Para mudar, altere aqui e crie uma nova versão da implantação.
const HORA_VIRADA_DIA_ = '06:00';

// Data operacional (dd/MM/yyyy) de um instante.
function dataOperacional_(instante) {
  const tz = Session.getScriptTimeZone() || 'GMT-3';
  const d = instante ? new Date(instante) : new Date();
  const hm = Utilities.formatDate(d, tz, 'HH:mm');
  if (hm < HORA_VIRADA_DIA_) d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
}

// Data operacional de um checklist já gravado. Registros antigos (antes
// desta coluna existir) usam a data real.
function dataOpChecklist_(c) {
  return c.DATA_OPERACIONAL || c.DATA;
}

// ---------- TURNOS DA ATIVIDADE ----------
// Coluna TURNO de ATIVIDADES: vazio = todos os turnos; um turno; ou vários
// separados por ";" (ex.: "1º Turno;3º Turno").
// Coluna MODO_TURNO (quando vale para mais de um turno):
//   CADA (padrão) = cada turno precisa fazer, cada um conta separado;
//   UM            = basta um dos turnos fazer no dia.
function turnosDaAtividade_(a, turnosDisponiveis) {
  const lista = String(a.TURNO == null ? '' : a.TURNO).split(';')
    .map(function (t) { return t.trim(); }).filter(Boolean);
  return lista.length ? lista : (turnosDisponiveis || ['']);
}

function atividadeValeNoTurno_(a, turno) {
  if (!turno) return true;
  const lista = String(a.TURNO == null ? '' : a.TURNO).split(';').map(function (t) { return t.trim(); }).filter(Boolean);
  return !lista.length || lista.indexOf(turno) > -1;
}

function modoBastaUm_(a, turnosDisponiveis) {
  return String(a.MODO_TURNO || '').toUpperCase() === 'UM' && turnosDaAtividade_(a, turnosDisponiveis).length > 1;
}

// Logo da ICC Brazil em base64, usada no cabeçalho dos relatórios em PDF.
const LOGO_ICC_BASE64 = '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';

// ======================= SETUP (rodar uma vez) =======================

function autorizarPermissoesPDF() {
  const doc = DocumentApp.create('teste_permissao_' + new Date().getTime());
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  return 'Permissão de Google Docs autorizada com sucesso.';
}

function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    const headers = HEADERS[sheetName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  // ---------- Seed inicial (pode editar/apagar depois na planilha) ----------

  seedIfEmpty_(SHEETS.USUARIOS, [
    ['USR-001', 'Maria Silva', 'maria', '', 'AGENTE_LIMPEZA', 'SIM', '1º Turno', '1111'],
    ['USR-002', 'João Souza', 'joao', '', 'AGENTE_LIMPEZA', 'SIM', '2º Turno', '2222'],
    ['USR-003', 'Ana Qualidade', 'ana.admin', '1234', 'ADMIN_QUALIDADE', 'SIM', '', '']
  ]);

  seedIfEmpty_(SHEETS.TURNOS, [
    ['TUR-001', '1º Turno', 'SIM'],
    ['TUR-002', '2º Turno', 'SIM'],
    ['TUR-003', '3º Turno', 'SIM']
  ]);

  seedIfEmpty_(SHEETS.LOCAIS, [
    ['LOC-001', 'Refeitório', 'SIM'],
    ['LOC-002', 'Operação', 'SIM'],
    ['LOC-003', 'Laboratório', 'SIM'],
    ['LOC-004', 'Casarão', 'SIM'],
    ['LOC-005', 'Fábrica', 'SIM']
  ]);

  seedIfEmpty_(SHEETS.AMBIENTES, [
    ['AMB-001', 'Refeitório', 'Salão', 'SIM'],
    ['AMB-002', 'Refeitório', 'Cozinha', 'SIM'],
    ['AMB-003', 'Refeitório', 'Banheiros', 'SIM'],
    ['AMB-004', 'Refeitório', 'Área externa', 'SIM'],
    ['AMB-005', 'Operação', 'Banheiro Feminino', 'SIM'],
    ['AMB-006', 'Operação', 'Banheiro Masculino', 'SIM'],
    ['AMB-007', 'Operação', 'Sala Administrativa', 'SIM'],
    ['AMB-008', 'Laboratório', 'Bancadas', 'SIM'],
    ['AMB-009', 'Laboratório', 'Banheiros', 'SIM'],
    ['AMB-010', 'Casarão', 'Salas', 'SIM'],
    ['AMB-011', 'Casarão', 'Banheiros', 'SIM'],
    ['AMB-012', 'Fábrica', 'Produção', 'SIM'],
    ['AMB-013', 'Fábrica', 'Banheiros', 'SIM']
  ]);

  // TURNO/DIA_SEMANA/DIA_MES em branco = vale para qualquer turno/dia.
  // DIA_SEMANA: 0=domingo...6=sábado (só usado quando PERIODICIDADE=SEMANAL).
  // DIA_MES: 1-31 (só usado quando PERIODICIDADE=MENSAL).
  seedIfEmpty_(SHEETS.ATIVIDADES, [
    ['ATV-001', 'Refeitório', 'Banheiros', 'Limpeza geral do banheiro', 'DIARIO', '', '', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-002', 'Refeitório', 'Salão', 'Limpeza do salão', 'DIARIO', '', '', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-003', 'Operação', 'Banheiro Feminino', 'Limpeza banheiro feminino', 'DIARIO', '', '', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-004', 'Operação', 'Banheiro Masculino', 'Limpeza banheiro masculino', 'DIARIO', '', '', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-005', 'Operação', 'Sala Administrativa', 'Limpeza sala administrativa', 'DIARIO', '', '', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-006', 'Operação', 'Sala Administrativa', 'Retirada de lixo', 'DIARIO', '', '', '', 'NAO', 'SIM', 'SIM', 'SIM'],
    ['ATV-007', 'Fábrica', 'Produção', 'Limpeza profunda da linha de produção', 'SEMANAL', '', '1', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-008', 'Casarão', 'Salas', 'Limpeza de estruturas e equipamentos', 'SEMANAL', '', '5', '', 'SIM', 'SIM', 'SIM', 'SIM'],
    ['ATV-009', 'Laboratório', 'Bancadas', 'Limpeza geral mensal do laboratório', 'MENSAL', '', '', '1', 'SIM', 'SIM', 'SIM', 'SIM']
  ]);

  seedIfEmpty_(SHEETS.UNIDADES, UNIDADES_INICIAIS_.map(function (u, i) {
    return ['UNI-00' + (i + 1), u, 'SIM'];
  }));

  SpreadsheetApp.flush();
  const migrados = migrarUnidades_();
  instalarGatilhoAlteracao_();
  invalidarTodoCache_();
  return 'Planilha configurada com sucesso.' + (migrados ? ' ' + migrados + ' registro(s) antigos marcados como ' + UNIDADE_PADRAO_ + '.' : '');
}

// Registros que existiam antes das unidades (coluna UNIDADE em branco)
// passam a ser de UNIDADE_PADRAO_ (Macatuba). Rodar de novo não muda nada.
function migrarUnidades_() {
  let total = 0;
  ABAS_POR_UNIDADE_.forEach(function (nome) {
    const sh = sheet_(nome);
    if (!sh || sh.getLastRow() < 2) return;
    const dados = sh.getDataRange().getValues();
    const col = dados[0].indexOf('UNIDADE');
    if (col === -1) return;
    let mudou = 0;
    const valores = dados.slice(1).map(function (linha) {
      const vazia = linha.join('') === '';
      if (!vazia && String(linha[col]).trim() === '') { mudou++; return [UNIDADE_PADRAO_]; }
      return [linha[col]];
    });
    if (mudou) sh.getRange(2, col + 1, valores.length, 1).setValues(valores);
    total += mudou;
  });
  return total;
}

// Gatilho instalável "ao alterar" (cobre também exclusão/inserção de linhas
// feitas à mão, que o onEdit simples não pega). Criado uma única vez pelo
// configurarPlanilha — rodar de novo não duplica.
function instalarGatilhoAlteracao_() {
  try {
    const existe = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'aoAlterarPlanilha';
    });
    if (!existe) {
      ScriptApp.newTrigger('aoAlterarPlanilha').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onChange().create();
    }
  } catch (e) { /* sem permissão para gatilhos: o cache ainda expira sozinho pelo TTL */ }
}

// Edição manual direto na planilha: descarta o cache da aba editada, para o
// app enxergar a mudança na hora (gatilho simples, não precisa instalar).
function onEdit(e) {
  try {
    if (e && e.range) invalidarCache_(e.range.getSheet().getName());
    else invalidarTodoCache_();
  } catch (err) { /* nada */ }
}

function aoAlterarPlanilha(e) {
  invalidarTodoCache_();
}

function seedIfEmpty_(sheetName, rows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// ======================= ENTRY POINTS HTTP =======================

function doGet(e) {
  try {
    const action = e.parameter.action;
    const result = routeAction_(action, e.parameter);
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const result = routeAction_(action, body.payload || {});
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeAction_(action, params) {
  const lock = LockService.getScriptLock();
  const readOnlyActions = ['getUsuarios', 'getUsuariosAdmin', 'getLocais', 'getAmbientes', 'getTurnos',
    'getAtividades', 'getAtividadesAdmin', 'getChecklists', 'getOcorrencias', 'getHistoricoAgente',
    'getPainelHoje', 'getDashboardChecklist', 'getDashboardOcorrencias',
    'getDashboardFotos', 'getResumoLimpeza', 'gerarRelatorioPDF', 'getUltimaLimpeza', 'getNaoConformidades',
    'loginAgente', 'getPendenciasRefazer', 'getLocaisAdmin', 'getAmbientesAdmin', 'getBootstrap', 'ping',
    'getUnidades', 'getComparativoUnidades'];

  const ehLeitura = readOnlyActions.includes(action);
  if (!ehLeitura) {
    lock.waitLock(20000);
  }
  try {
    // Idempotência: o app reenvia automaticamente um envio se a internet
    // cair. Se a 1ª tentativa chegou a ser gravada (só a resposta se perdeu),
    // a repetição devolve o mesmo resultado sem gravar de novo.
    const reqId = !ehLeitura && params && params.clientReqId ? 'req_' + params.clientReqId : null;
    if (reqId) {
      const anterior = CacheService.getScriptCache().get(reqId);
      if (anterior) return JSON.parse(anterior);
    }
    const resultado = executarAcao_(action, params);
    if (reqId && resultado && resultado.ok) {
      try { CacheService.getScriptCache().put(reqId, JSON.stringify(resultado), 21600); } catch (e) { /* nada */ }
    }
    return resultado;
  } finally {
    if (!ehLeitura) lock.releaseLock();
  }
}

function executarAcao_(action, params) {
    if (action !== 'ping' && action !== 'getUnidades') {
      definirUnidadeContexto_(params ? params.unidade : '');
      if (_UNIDADE_CTX_ === null && ACOES_EXIGEM_UNIDADE_.indexOf(action) > -1) {
        return { ok: false, error: 'Você está vendo todas as unidades. Escolha uma unidade no topo da tela para cadastrar.' };
      }
    }
    switch (action) {
      case 'ping': return { ok: true, data: 'pong' };
      case 'getUnidades': return { ok: true, data: unidadesCadastradas_() };
      case 'getComparativoUnidades': return { ok: true, data: getComparativoUnidades_(params) };
      case 'getBootstrap': return { ok: true, data: getBootstrap_() };
      case 'getUsuarios': return { ok: true, data: getUsuarios_() };
      case 'loginAdmin': return loginAdmin_(params);
      case 'loginAgente': return loginAgente_(params);
      case 'getLocais': return { ok: true, data: getLocais_() };
      case 'getAmbientes': return { ok: true, data: getAmbientes_(params.local) };
      case 'getTurnos': return { ok: true, data: getTurnos_() };
      case 'getAtividades': return { ok: true, data: getAtividades_(params) };

      case 'getUsuariosAdmin': return { ok: true, data: getUsuariosAdmin_() };
      case 'createUsuario': return criarUsuario_(params);
      case 'updateUsuario': return atualizarUsuario_(params);
      case 'atualizarStatusUsuario': return atualizarStatusUsuario_(params);
      case 'excluirUsuario': return excluirUsuario_(params);

      case 'getAtividadesAdmin': return { ok: true, data: getAtividadesAdmin_(params) };
      case 'createAtividade': return criarAtividade_(params);
      case 'createAtividadesLote': return criarAtividadesLote_(params);
      case 'updateAtividade': return atualizarAtividade_(params);
      case 'atualizarStatusAtividade': return atualizarStatusAtividade_(params);
      case 'excluirAtividade': return excluirAtividade_(params);

      case 'getLocaisAdmin': return { ok: true, data: getLocaisAdmin_() };
      case 'createLocal': return criarLocal_(params);
      case 'renomearLocal': return renomearLocal_(params);
      case 'atualizarStatusLocal': return atualizarStatusLocal_(params);
      case 'getAmbientesAdmin': return { ok: true, data: getAmbientesAdmin_(params) };
      case 'createAmbiente': return criarAmbiente_(params);
      case 'renomearAmbiente': return renomearAmbiente_(params);
      case 'atualizarStatusAmbiente': return atualizarStatusAmbiente_(params);

      case 'createChecklist': return criarChecklist_(params);
      case 'getChecklists': return { ok: true, data: getChecklists_(params) };
      case 'validarChecklist': return validarChecklist_(params);
      case 'aprovarChecklistsLote': return aprovarChecklistsLote_(params);
      case 'getPendenciasRefazer': return { ok: true, data: getPendenciasRefazer_(params) };

      case 'getUltimaLimpeza': return { ok: true, data: buscarUltimaLimpeza_(params.local, params.ambiente) };

      case 'createOcorrencia': return criarOcorrencia_(params);
      case 'getOcorrencias': return { ok: true, data: getOcorrencias_(params) };
      case 'validarOcorrencia': return validarOcorrencia_(params);
      case 'atualizarStatusOcorrencia': return atualizarStatusOcorrencia_(params);

      case 'createNaoConformidade': return criarNaoConformidade_(params);
      case 'getNaoConformidades': return { ok: true, data: getNaoConformidades_(params) };
      case 'resolverNaoConformidade': return resolverNaoConformidade_(params);
      case 'validarNaoConformidade': return validarNaoConformidade_(params);

      case 'getHistoricoAgente': return { ok: true, data: getHistoricoAgente_(params.idAgente) };

      case 'getPainelHoje': return { ok: true, data: getPainelHoje_(params) };
      case 'getDashboardChecklist': return { ok: true, data: getDashboardChecklist_(params) };
      case 'getDashboardOcorrencias': return { ok: true, data: getDashboardOcorrencias_(params) };
      case 'getDashboardFotos': return { ok: true, data: getDashboardFotos_(params) };
      case 'getResumoLimpeza': return { ok: true, data: getResumoLimpeza_(params) };
      case 'gerarRelatorioPDF': return { ok: true, data: gerarRelatorioPDF_(params) };

      default: return { ok: false, error: 'Ação desconhecida: ' + action };
    }
}

// ======================= HELPERS DE PLANILHA =======================

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ---------- CACHE DE LEITURA ----------
// Ler a planilha inteira (getDataRange().getValues() + formatação de datas)
// é, de longe, a parte mais lenta de cada chamada. Agora TODAS as abas ficam
// guardadas no CacheService já processadas (divididas em blocos, porque cada
// item do cache aceita no máximo 100KB), e o cache é descartado na hora:
//   - a cada gravação feita pelo app (appendRow_, updateRowById_ etc.);
//   - a cada edição manual na planilha (onEdit / aoAlterarPlanilha).
// Cada aba tem um "número de versão" no cache; invalidar = trocar a versão.
// Assim, uma leitura que começou antes de uma gravação nunca consegue
// "ressuscitar" dado velho no cache (ela grava na versão antiga, que ninguém
// mais lê). O TTL é só uma rede de segurança caso algum gatilho falhe.
const CACHE_TTL_CADASTROS_ = 3600; // USUARIOS, LOCAIS, AMBIENTES, TURNOS, ATIVIDADES
const CACHE_TTL_MOVIMENTO_ = 600;  // CHECKLISTS, OCORRENCIAS, NAO_CONFORMIDADES
const CACHE_BLOCO_ = 25000;        // caracteres por bloco (folga p/ acentos em UTF-8)
const CACHE_MAX_BLOCOS_ = 400;     // ~10MB: acima disso lê direto da planilha
const ABAS_CADASTRO_ = [SHEETS.USUARIOS, SHEETS.LOCAIS, SHEETS.AMBIENTES, SHEETS.TURNOS, SHEETS.ATIVIDADES, SHEETS.UNIDADES];
const ABAS_CACHEAVEIS_ = ABAS_CADASTRO_.concat([SHEETS.CHECKLISTS, SHEETS.OCORRENCIAS, SHEETS.NAO_CONFORMIDADES]);

// Cópia em memória durante UMA execução (uma mesma chamada que lê a mesma
// aba duas vezes não repete o trabalho).
const _memoLeitura_ = {};

function ttlDaAba_(name) {
  return ABAS_CADASTRO_.indexOf(name) > -1 ? CACHE_TTL_CADASTROS_ : CACHE_TTL_MOVIMENTO_;
}

function versaoCache_(cache, name, criarSeFaltar) {
  let v = cache.get('v_' + name);
  if (!v && criarSeFaltar) {
    v = Utilities.getUuid().slice(0, 8);
    cache.put('v_' + name, v, 21600);
  }
  return v;
}

function invalidarCache_(sheetName) {
  delete _memoLeitura_[sheetName];
  if (ABAS_CACHEAVEIS_.indexOf(sheetName) === -1) return;
  try {
    CacheService.getScriptCache().put('v_' + sheetName, Utilities.getUuid().slice(0, 8), 21600);
  } catch (e) { /* cache indisponível, sem problema */ }
}

function invalidarTodoCache_() {
  ABAS_CACHEAVEIS_.forEach(invalidarCache_);
}

function lerDoCache_(cache, name, versao) {
  const base = 'd_' + name + '_' + versao;
  const meta = cache.get(base);
  if (!meta) return null;
  const n = Number(meta);
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(base + '_' + i);
  const partes = cache.getAll(chaves);
  let texto = '';
  for (let i = 0; i < n; i++) {
    const p = partes[chaves[i]];
    if (p === undefined || p === null) return null; // algum bloco expirou
    texto += p;
  }
  return JSON.parse(texto);
}

function gravarNoCache_(cache, name, versao, dados) {
  const texto = JSON.stringify(dados);
  const n = Math.ceil(texto.length / CACHE_BLOCO_) || 1;
  if (n > CACHE_MAX_BLOCOS_) return;
  const base = 'd_' + name + '_' + versao;
  const ttl = ttlDaAba_(name);
  const blocos = {};
  for (let i = 0; i < n; i++) blocos[base + '_' + i] = texto.substr(i * CACHE_BLOCO_, CACHE_BLOCO_);
  // grava em lotes (o putAll tem limite de itens por chamada)
  const chaves = Object.keys(blocos);
  for (let i = 0; i < chaves.length; i += 100) {
    const lote = {};
    chaves.slice(i, i + 100).forEach(function (k) { lote[k] = blocos[k]; });
    cache.putAll(lote, ttl);
  }
  cache.put(base, String(n), ttl); // "índice" por último: só vale se todos os blocos existem
}

// Leitura respeitando a unidade da chamada (ver UNIDADES no topo).
function readSheet_(name) {
  const rows = readSheetTodas_(name);
  if (_UNIDADE_CTX_ === null || ABAS_POR_UNIDADE_.indexOf(name) === -1) return rows;
  return rows.filter(function (r) { return registroNaUnidade_(name, r, _UNIDADE_CTX_); });
}

// Leitura da aba inteira, de todas as unidades.
function readSheetTodas_(name) {
  if (_memoLeitura_[name]) return JSON.parse(_memoLeitura_[name]);
  const cacheavel = ABAS_CACHEAVEIS_.indexOf(name) > -1;
  let cache = null, versao = null;
  if (cacheavel) {
    try {
      cache = CacheService.getScriptCache();
      versao = versaoCache_(cache, name, true);
      const cached = lerDoCache_(cache, name, versao);
      if (cached) {
        _memoLeitura_[name] = JSON.stringify(cached);
        return cached;
      }
    } catch (e) { cache = null; /* segue e lê da planilha normalmente */ }
  }

  const sh = sheet_(name);
  if (!sh) return [];
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const rows = range.slice(1);
  const tz = Session.getScriptTimeZone() || 'GMT-3';
  const result = rows
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) {
      const obj = {};
      headers.forEach(function (h, i) {
        let v = r[i];
        if (v instanceof Date) {
          if (h === 'HORA') {
            v = Utilities.formatDate(v, tz, 'HH:mm');
          } else {
            const temHora = v.getHours() !== 0 || v.getMinutes() !== 0 || v.getSeconds() !== 0;
            v = Utilities.formatDate(v, tz, temHora ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
          }
        }
        obj[h] = v;
      });
      return obj;
    });

  const texto = JSON.stringify(result);
  _memoLeitura_[name] = texto;
  if (cache && versao) {
    try { gravarNoCache_(cache, name, versao, result); } catch (e) { /* cache cheio/indisponível: só não cacheia */ }
  }
  return JSON.parse(texto);
}

// Registro novo numa aba por unidade nasce com a unidade da chamada.
function carimbarUnidade_(sheetName, rowObj) {
  if (ABAS_POR_UNIDADE_.indexOf(sheetName) === -1 || (rowObj.UNIDADE !== undefined && rowObj.UNIDADE !== '')) return rowObj;
  if (_UNIDADE_CTX_ === null) throw new Error('Escolha uma unidade no topo da tela para cadastrar.');
  rowObj.UNIDADE = _UNIDADE_CTX_;
  return rowObj;
}

function appendRow_(sheetName, rowObj) {
  carimbarUnidade_(sheetName, rowObj);
  const sh = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const row = headers.map(function (h) { return rowObj[h] !== undefined ? rowObj[h] : ''; });
  sh.appendRow(row);
  invalidarCache_(sheetName);
}

// Grava várias linhas de uma vez com um único setValues (bem mais rápido que
// chamar appendRow_ em loop — cada appendRow_ é uma ida e volta separada até
// a planilha). Usado onde várias linhas nascem juntas, como no cadastro de
// atividades em lote.
function appendRows_(sheetName, rowObjs) {
  if (!rowObjs || !rowObjs.length) return;
  rowObjs.forEach(function (r) { carimbarUnidade_(sheetName, r); });
  const sh = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const rows = rowObjs.map(function (rowObj) {
    return headers.map(function (h) { return rowObj[h] !== undefined ? rowObj[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidarCache_(sheetName);
}

function updateRowById_(sheetName, idColumn, idValue, updates) {
  const sh = sheet_(sheetName);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const idIdx = headers.indexOf(idColumn);
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][idIdx]) === String(idValue)) {
      // Monta a linha inteira em memória e grava com um único setValues, em
      // vez de um setValue() por coluna alterada (cada setValue() é uma
      // chamada separada ao serviço de planilhas — trocar N chamadas por 1
      // reduz bastante o tempo de resposta de qualquer validação/edição).
      const rowValues = range[i].slice();
      Object.keys(updates).forEach(function (key) {
        const colIdx = headers.indexOf(key);
        if (colIdx > -1) rowValues[colIdx] = updates[key];
      });
      sh.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
      invalidarCache_(sheetName);
      return true;
    }
  }
  return false;
}

// Aplica a mesma atualização a várias linhas de uma vez, lendo a planilha
// UMA única vez (diferente de chamar updateRowById_ em loop, que releria a
// planilha inteira para cada id — caro em abas grandes como CHECKLISTS/
// OCORRENCIAS quando a Qualidade aprova vários itens de uma vez).
function updateRowsByIds_(sheetName, idColumn, ids, updates) {
  if (!ids || !ids.length) return 0;
  const sh = sheet_(sheetName);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const idIdx = headers.indexOf(idColumn);
  const idSet = {};
  ids.forEach(function (id) { idSet[String(id)] = true; });
  let total = 0;
  let primeira = -1, ultima = -1;
  for (let i = 1; i < range.length; i++) {
    if (idSet[String(range[i][idIdx])]) {
      Object.keys(updates).forEach(function (key) {
        const colIdx = headers.indexOf(key);
        if (colIdx > -1) range[i][colIdx] = updates[key];
      });
      if (primeira === -1) primeira = i;
      ultima = i;
      total++;
    }
  }
  // Registros próximos (caso comum: a fila de validação) viram UMA única
  // gravação do 1º ao último alterado; se estiverem muito espalhados, grava
  // linha a linha para não reescrever um trecho grande da planilha à toa.
  if (total) {
    const span = ultima - primeira + 1;
    if (span <= Math.max(total * 3, 20)) {
      sh.getRange(primeira + 1, 1, span, headers.length).setValues(range.slice(primeira, ultima + 1));
    } else {
      for (let i = primeira; i <= ultima; i++) {
        if (idSet[String(range[i][idIdx])]) sh.getRange(i + 1, 1, 1, headers.length).setValues([range[i]]);
      }
    }
  }
  invalidarCache_(sheetName);
  return total;
}

function findRowById_(sheetName, idColumn, idValue) {
  const rows = readSheet_(sheetName);
  return rows.find(function (r) { return String(r[idColumn]) === String(idValue); }) || null;
}

// Apaga a linha de vez (diferente de ATIVO=NAO, que só desativa). Usado só
// onde apagar de verdade é seguro — ver comentário em excluirAtividade_.
function deleteRowById_(sheetName, idColumn, idValue) {
  const sh = sheet_(sheetName);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const idIdx = headers.indexOf(idColumn);
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][idIdx]) === String(idValue)) {
      sh.deleteRow(i + 1);
      invalidarCache_(sheetName);
      return true;
    }
  }
  return false;
}

function nextId_(prefix) {
  const sh = sheet_(SHEETS.SEQ);
  const range = sh.getDataRange().getValues();
  for (let i = 1; i < range.length; i++) {
    if (range[i][0] === prefix) {
      const next = Number(range[i][1]) + 1;
      sh.getRange(i + 1, 2).setValue(next);
      return prefix + '-' + String(next).padStart(6, '0');
    }
  }
  sh.appendRow([prefix, 1]);
  return prefix + '-000001';
}

// Reserva vários IDs sequenciais de uma vez (1 leitura + 1 gravação em _SEQ
// no total, em vez de uma leitura+gravação PARA CADA item). Usado no
// cadastro de atividades em lote.
function nextIds_(prefix, count) {
  const sh = sheet_(SHEETS.SEQ);
  const range = sh.getDataRange().getValues();
  for (let i = 1; i < range.length; i++) {
    if (range[i][0] === prefix) {
      const start = Number(range[i][1]) + 1;
      sh.getRange(i + 1, 2).setValue(start + count - 1);
      const ids = [];
      for (let n = 0; n < count; n++) ids.push(prefix + '-' + String(start + n).padStart(6, '0'));
      return ids;
    }
  }
  sh.appendRow([prefix, count]);
  const ids = [];
  for (let n = 0; n < count; n++) ids.push(prefix + '-' + String(n + 1).padStart(6, '0'));
  return ids;
}

function nowDateStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT-3', 'dd/MM/yyyy');
}
function nowTimeStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT-3', 'HH:mm');
}

// Salva foto (data URL base64) no Drive e retorna a URL pública de visualização
function salvarFoto_(dataUrl, nomeArquivo) {
  if (!dataUrl) return '';
  const match = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!match) return '';
  const contentType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, contentType, nomeArquivo || ('foto_' + new Date().getTime()));

  const folder = pastaFotos_();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
}

// Procurar a pasta pelo nome no Drive a cada foto é lento; o ID dela fica
// guardado nas propriedades do script depois da primeira vez.
let _pastaFotosMemo_ = null;
function pastaFotos_() {
  if (_pastaFotosMemo_) return _pastaFotosMemo_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PASTA_FOTOS_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) { _pastaFotosMemo_ = f; return f; }
    } catch (e) { /* pasta apagada/sem acesso: procura de novo */ }
  }
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('PASTA_FOTOS_ID', folder.getId());
  _pastaFotosMemo_ = folder;
  return folder;
}

function toDate_(str) {
  if (!str) return new Date(0);
  const parts = String(str).split('/');
  if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
  return new Date(str);
}

function dataOnly_(str) {
  return String(str || '').split(' ')[0];
}

// ======================= LOGIN =======================

function getUsuarios_() {
  return readSheet_(SHEETS.USUARIOS).filter(function (u) {
    return String(u.ATIVO).toUpperCase() === 'SIM';
  }).map(function (u) {
    return { ID_USUARIO: u.ID_USUARIO, NOME: u.NOME, USUARIO: u.USUARIO, PERFIL: u.PERFIL, UNIDADE: unidadeDoRegistro_(u) };
    // SENHA nunca é enviada ao frontend
  });
}

// SHA-256 em hex minúsculo. Usado para nunca guardar a senha do Admin em
// texto puro na planilha a partir de agora.
function hashSenha_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// Um hash SHA-256 em hex sempre tem 64 caracteres [0-9a-f]. Uma senha
// digitada por uma pessoa praticamente nunca vai coincidir com esse
// formato, então isso é o suficiente para diferenciar "já está com hash" de
// "ainda está em texto puro" (senhas antigas, cadastradas antes desta
// atualização) sem precisar de uma coluna extra.
function pareceHash_(valor) {
  return /^[a-f0-9]{64}$/i.test(String(valor || ''));
}

function loginAdmin_(params) {
  const usuarios = readSheet_(SHEETS.USUARIOS);
  const usuario = usuarios.find(function (u) {
    return String(u.ID_USUARIO) === String(params.idUsuario) && String(u.ATIVO).toUpperCase() === 'SIM';
  });
  if (!usuario) return { ok: false, error: 'Usuário não encontrado.' };

  const senhaDigitada = String(params.senha || '');
  const senhaSalva = String(usuario.SENHA || '');
  let confere = false;

  if (pareceHash_(senhaSalva)) {
    confere = hashSenha_(senhaDigitada) === senhaSalva;
  } else {
    // Senha antiga, ainda em texto puro. Confere do jeito antigo e, se
    // bater, aproveita para migrar essa senha para hash na hora — o
    // usuário não percebe nada diferente, mas a partir desse login a
    // senha dele passa a ficar protegida na planilha.
    confere = senhaSalva === senhaDigitada;
    if (confere) {
      updateRowById_(SHEETS.USUARIOS, 'ID_USUARIO', usuario.ID_USUARIO, { SENHA: hashSenha_(senhaDigitada) });
    }
  }

  if (!confere) return { ok: false, error: 'Senha incorreta.' };
  return { ok: true, data: { ID_USUARIO: usuario.ID_USUARIO, NOME: usuario.NOME, PERFIL: usuario.PERFIL, UNIDADE: unidadeDoRegistro_(usuario) } };
}

function pinValido_(pin) {
  return /^\d{4}$/.test(String(pin || '').trim());
}

// Login do Agente de Limpeza por PIN numérico de 4 dígitos (substitui o
// antigo login "sem senha nenhuma", só com o nome). Se o agente ainda não
// tem PIN cadastrado (agentes já existentes antes desta atualização), o
// login é bloqueado com uma mensagem clara — a Administração da Qualidade
// precisa cadastrar um PIN para ele em Cadastros > Usuários antes que ele
// consiga entrar de novo.
function loginAgente_(params) {
  const usuarios = readSheet_(SHEETS.USUARIOS);
  const usuario = usuarios.find(function (u) {
    return String(u.ID_USUARIO) === String(params.idUsuario) && String(u.ATIVO).toUpperCase() === 'SIM' && u.PERFIL === 'AGENTE_LIMPEZA';
  });
  if (!usuario) return { ok: false, error: 'Agente não encontrado.' };

  const pinCadastrado = String(usuario.PIN || '').trim();
  if (!pinCadastrado) {
    return { ok: false, error: 'Você ainda não tem um PIN cadastrado. Peça para a Administração da Qualidade cadastrar seu PIN em Cadastros > Usuários.' };
  }
  if (String(params.pin || '').trim() !== pinCadastrado) {
    return { ok: false, error: 'PIN incorreto.' };
  }
  return { ok: true, data: { ID_USUARIO: usuario.ID_USUARIO, NOME: usuario.NOME, PERFIL: usuario.PERFIL, TURNO: usuario.TURNO, UNIDADE: unidadeDoRegistro_(usuario) } };
}

// ======================= ADMIN: GESTÃO DE USUÁRIOS =======================
// Cadastro, edição e desativação de usuários pelo próprio app. A edição
// direta na planilha (aba USUARIOS) continua funcionando normalmente —
// isso só dá ao Admin uma forma alternativa de fazer o mesmo pelo celular.

// Diferente de getUsuarios_() (usada na tela de login: só ativos, sem
// SENHA), esta traz todos os usuários com todos os campos, para a tela de
// gestão do Admin.
function getUsuariosAdmin_() {
  return readSheet_(SHEETS.USUARIOS).map(function (u) { u.UNIDADE = unidadeDoRegistro_(u); return u; }).sort(function (a, b) {
    return String(a.NOME).localeCompare(String(b.NOME));
  });
}

function perfilValido_(perfil) {
  return perfil === 'ADMIN_QUALIDADE' || perfil === 'AGENTE_LIMPEZA';
}

function loginJaExiste_(usuarios, login, ignorarId) {
  return usuarios.some(function (u) {
    return String(u.USUARIO).toLowerCase() === String(login).toLowerCase() &&
      String(u.ID_USUARIO) !== String(ignorarId || '');
  });
}

function criarUsuario_(p) {
  const nome = String(p.nome || '').trim();
  const usuario = String(p.usuario || '').trim();
  const perfil = p.perfil;
  const senha = String(p.senha || '').trim();
  const pin = String(p.pin || '').trim();

  const turno = String(p.turno || '').trim();
  const unidade = resolverUnidade_(p.unidadeUsuario || _UNIDADE_CTX_ || '');

  if (!nome) return { ok: false, error: 'Informe o nome do usuário.' };
  if (!usuario) return { ok: false, error: 'Informe o usuário (login).' };
  if (!perfilValido_(perfil)) return { ok: false, error: 'Selecione o perfil do usuário.' };
  if (!unidade) return { ok: false, error: 'Selecione a unidade do usuário.' };
  if (perfil === 'ADMIN_QUALIDADE' && !senha) {
    return { ok: false, error: 'Senha é obrigatória para o perfil Administrador da Qualidade.' };
  }
  if (perfil === 'AGENTE_LIMPEZA' && !turno) {
    return { ok: false, error: 'Selecione o turno do Agente de Limpeza.' };
  }
  if (perfil === 'AGENTE_LIMPEZA' && !pin) {
    return { ok: false, error: 'Cadastre um PIN de 4 dígitos para o Agente de Limpeza.' };
  }
  if (perfil === 'AGENTE_LIMPEZA' && !pinValido_(pin)) {
    return { ok: false, error: 'O PIN deve ter exatamente 4 dígitos numéricos.' };
  }

  const usuariosExistentes = readSheetTodas_(SHEETS.USUARIOS); // login é único na empresa toda
  if (loginJaExiste_(usuariosExistentes, usuario)) {
    return { ok: false, error: 'Já existe um usuário cadastrado com esse login.' };
  }

  const idUsuario = nextId_('USR');
  appendRow_(SHEETS.USUARIOS, {
    ID_USUARIO: idUsuario,
    NOME: nome,
    USUARIO: usuario,
    // Admin da Qualidade tem senha (guardada com hash SHA-256, nunca em
    // texto puro); Agente de Limpeza usa PIN numérico em vez de senha.
    SENHA: perfil === 'ADMIN_QUALIDADE' ? hashSenha_(senha) : '',
    PERFIL: perfil,
    ATIVO: 'SIM',
    // Turno em que o Agente de Limpeza normalmente trabalha (não se aplica
    // ao perfil Administrador da Qualidade).
    TURNO: perfil === 'AGENTE_LIMPEZA' ? turno : '',
    PIN: perfil === 'AGENTE_LIMPEZA' ? pin : '',
    UNIDADE: unidade
  });
  return { ok: true, data: { idUsuario: idUsuario } };
}

function atualizarUsuario_(p) {
  const atual = findRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario);
  if (!atual) return { ok: false, error: 'Usuário não encontrado.' };

  const nome = String(p.nome || '').trim();
  const usuario = String(p.usuario || '').trim();
  const perfil = p.perfil;
  const senhaInformada = String(p.senha || '').trim();
  const pinInformado = String(p.pin || '').trim();
  const turno = String(p.turno || '').trim();
  const ativo = p.ativo === 'NAO' ? 'NAO' : 'SIM';
  const unidade = p.unidadeUsuario ? resolverUnidade_(p.unidadeUsuario) : unidadeDoRegistro_(atual);

  if (!unidade) return { ok: false, error: 'Selecione a unidade do usuário.' };
  if (!nome) return { ok: false, error: 'Informe o nome do usuário.' };
  if (!usuario) return { ok: false, error: 'Informe o usuário (login).' };
  if (!perfilValido_(perfil)) return { ok: false, error: 'Selecione o perfil do usuário.' };
  if (perfil === 'AGENTE_LIMPEZA' && !turno) {
    return { ok: false, error: 'Selecione o turno do Agente de Limpeza.' };
  }

  const usuariosExistentes = readSheetTodas_(SHEETS.USUARIOS); // login é único na empresa toda
  if (loginJaExiste_(usuariosExistentes, usuario, p.idUsuario)) {
    return { ok: false, error: 'Já existe um usuário cadastrado com esse login.' };
  }

  // Se o campo senha/PIN for deixado em branco na edição, mantém o valor
  // atual (evita ter que redigitar toda vez que só o nome muda, por ex).
  let senhaFinal = '';
  if (perfil === 'ADMIN_QUALIDADE') {
    senhaFinal = senhaInformada ? hashSenha_(senhaInformada) : (atual.SENHA || '');
    if (!senhaFinal) return { ok: false, error: 'Senha é obrigatória para o perfil Administrador da Qualidade.' };
  }

  let pinFinal = '';
  if (perfil === 'AGENTE_LIMPEZA') {
    pinFinal = pinInformado || atual.PIN || '';
    if (pinFinal && !pinValido_(pinFinal)) {
      return { ok: false, error: 'O PIN deve ter exatamente 4 dígitos numéricos.' };
    }
  }

  updateRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario, {
    NOME: nome, USUARIO: usuario, SENHA: senhaFinal, PERFIL: perfil, ATIVO: ativo,
    TURNO: perfil === 'AGENTE_LIMPEZA' ? turno : '',
    PIN: perfil === 'AGENTE_LIMPEZA' ? pinFinal : '',
    UNIDADE: unidade
  });
  return { ok: true };
}

// Ativa/desativa um usuário (equivalente a "remover" sem apagar histórico —
// mesmo padrão de ATIVO usado em LOCAIS/AMBIENTES/TURNOS/ATIVIDADES). Um
// usuário inativo some da tela de login mas seu nome permanece nos
// checklists/ocorrências já registrados.
function atualizarStatusUsuario_(p) {
  const atual = findRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario);
  if (!atual) return { ok: false, error: 'Usuário não encontrado.' };
  updateRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario, { ATIVO: p.ativo === 'SIM' ? 'SIM' : 'NAO' });
  return { ok: true };
}

// Apaga o usuário de vez da aba USUARIOS (diferente de desativar). É
// seguro: CHECKLISTS/OCORRENCIAS/NAO_CONFORMIDADES já guardam sua própria
// cópia do nome (AGENTE/ADMIN_VALIDADOR/etc.) no momento do registro, não
// dependem da linha em USUARIOS continuar existindo — apagar aqui só
// impede que esse usuário volte a aparecer na tela de login ou seja
// escolhido de novo, sem afetar o histórico já registrado.
function excluirUsuario_(p) {
  const atual = findRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario);
  if (!atual) return { ok: false, error: 'Usuário não encontrado.' };
  deleteRowById_(SHEETS.USUARIOS, 'ID_USUARIO', p.idUsuario);
  return { ok: true };
}

// ======================= ADMIN: CADASTRO DE ATIVIDADES =======================
// Cadastro, edição e desativação das atividades de limpeza (o "planejamento
// de limpeza" da aba ATIVIDADES) pelo próprio app, além da edição direta
// na planilha, que continua funcionando normalmente.

const PERIODICIDADES_VALIDAS_ = ['DIARIO', 'SEMANAL', 'MENSAL', 'VEZES_SEMANA', 'VEZES_MES'];

// ---------- FREQUÊNCIA PERSONALIZADA ("N vezes por semana/mês") ----------
// PERIODICIDADE = VEZES_SEMANA ou VEZES_MES, com:
//   VEZES      = quantas vezes no período (ex.: 3)
//   DIAS_FIXOS = em branco  -> dias LIVRES: qualquer dia do período vale, a
//                               atividade só fica atrasada se o período
//                               (semana seg-dom / mês) terminar sem atingir
//                               a quantidade;
//                preenchido -> dias FIXOS separados por ";" — dias da semana
//                               (0=dom...6=sáb, ex.: "1;3;5" = seg/qua/sex)
//                               ou dias do mês (ex.: "5;20"); cada dia vale
//                               como uma data prevista, igual ao Diário.
// ";" (e não ",") de propósito: na planilha em português "1,3" pode virar o
// número 1,3.

// Para o wizard do agente, a frequência personalizada entra junto com a
// "irmã" padrão: N vezes por semana aparece em Semanal, N vezes por mês em
// Mensal (assim o agente continua escolhendo só entre 3 opções).
function grupoPeriodicidade_(per) {
  if (per === 'VEZES_SEMANA') return 'SEMANAL';
  if (per === 'VEZES_MES') return 'MENSAL';
  return per;
}

function ehVezes_(a) {
  return a.PERIODICIDADE === 'VEZES_SEMANA' || a.PERIODICIDADE === 'VEZES_MES';
}

function ehVezesLivre_(a) {
  return ehVezes_(a) && !(parseDiasFixos_(a.DIAS_FIXOS, a.PERIODICIDADE) || []).length;
}

function parseDiasFixos_(valor, per) {
  const txt = String(valor == null ? '' : valor).trim();
  if (!txt) return [];
  const min = per === 'VEZES_SEMANA' ? 0 : 1;
  const max = per === 'VEZES_SEMANA' ? 6 : 31;
  const partes = txt.split(/[\s,;]+/).filter(Boolean);
  const nums = [];
  for (let i = 0; i < partes.length; i++) {
    const n = Number(partes[i]);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    if (nums.indexOf(n) === -1) nums.push(n);
  }
  return nums.sort(function (a, b) { return a - b; });
}

// Valida e monta as colunas de frequência de uma atividade a partir do que
// veio do formulário. Retorna { erro } ou { campos }.
function camposFrequencia_(p) {
  const per = p.periodicidade;
  if (PERIODICIDADES_VALIDAS_.indexOf(per) === -1) {
    return { erro: 'Selecione a frequência (Diário, Semanal, Mensal ou Personalizada).' };
  }
  const f = { PERIODICIDADE: per, DIA_SEMANA: '', DIA_MES: '', VEZES: '', DIAS_FIXOS: '' };
  if (per === 'SEMANAL') f.DIA_SEMANA = String(p.diaSemana == null ? '' : p.diaSemana);
  if (per === 'MENSAL') f.DIA_MES = String(p.diaMes == null ? '' : p.diaMes);
  if (per === 'VEZES_SEMANA' || per === 'VEZES_MES') {
    const semana = per === 'VEZES_SEMANA';
    const n = Number(p.vezes);
    if (!Number.isInteger(n) || n < 1 || n > (semana ? 7 : 31)) {
      return { erro: semana ? 'Informe quantas vezes por semana (1 a 7).' : 'Informe quantas vezes por mês (1 a 31).' };
    }
    const dias = parseDiasFixos_(p.diasFixos, per);
    if (dias === null) return { erro: semana ? 'Dias da semana inválidos.' : 'Dias do mês inválidos (use números de 1 a 31).' };
    if (dias.length && dias.length !== n) {
      return { erro: 'Com dias fixos, marque exatamente ' + n + ' dia(s) — ou escolha "Dias livres".' };
    }
    f.VEZES = n;
    f.DIAS_FIXOS = dias.join(';');
  }
  return { campos: f };
}

// Diferente de getAtividades_() (usada no wizard do agente: filtra por
// local+ambiente+periodicidade+turno exatos, só ativas), esta traz todas as
// atividades (opcionalmente filtradas só por local), para a tela de gestão.
function getAtividadesAdmin_(params) {
  let rows = readSheet_(SHEETS.ATIVIDADES);
  if (params && params.local) rows = rows.filter(function (a) { return a.LOCAL === params.local; });
  return rows.sort(function (a, b) {
    return String(a.LOCAL + '|' + a.AMBIENTE + '|' + a.ATIVIDADE).localeCompare(String(b.LOCAL + '|' + b.AMBIENTE + '|' + b.ATIVIDADE));
  });
}

function validarDadosAtividade_(p) {
  if (!String(p.local || '').trim()) return 'Informe o local.';
  if (!String(p.ambiente || '').trim()) return 'Informe o ambiente.';
  if (!String(p.atividade || '').trim()) return 'Descreva a atividade.';
  const freq = camposFrequencia_(p);
  if (freq.erro) return freq.erro;
  return null;
}

// Local e Ambiente são texto livre no cadastro de atividades (o admin pode
// digitar um local/ambiente novo direto ali, sem precisar cadastrá-lo
// antes). Esta função garante que ele exista nas abas LOCAIS/AMBIENTES
// (cria se ainda não existir) e devolve a grafia JÁ CADASTRADA quando o
// texto digitado bate com uma existente, ignorando maiúsculas/minúsculas —
// isso evita que "Refeitório" e "refeitório" virem dois locais diferentes
// e o agente deixe de ver a atividade no wizard (que compara local/ambiente
// de forma exata).
function garantirLocalAmbiente_(localDigitado, ambienteDigitado) {
  const local = String(localDigitado || '').trim();
  const ambiente = String(ambienteDigitado || '').trim();

  const locais = readSheet_(SHEETS.LOCAIS);
  const localExistente = locais.find(function (l) { return String(l.LOCAL).trim().toLowerCase() === local.toLowerCase(); });
  const localCanonico = localExistente ? localExistente.LOCAL : local;
  if (!localExistente) {
    appendRow_(SHEETS.LOCAIS, { ID_LOCAL: nextId_('LOC'), LOCAL: local, ATIVO: 'SIM' });
  }

  const ambientes = readSheet_(SHEETS.AMBIENTES);
  const ambienteExistente = ambientes.find(function (a) {
    return String(a.LOCAL).trim().toLowerCase() === localCanonico.toLowerCase() &&
      String(a.AMBIENTE).trim().toLowerCase() === ambiente.toLowerCase();
  });
  const ambienteCanonico = ambienteExistente ? ambienteExistente.AMBIENTE : ambiente;
  if (!ambienteExistente) {
    appendRow_(SHEETS.AMBIENTES, { ID_AMBIENTE: nextId_('AMB'), LOCAL: localCanonico, AMBIENTE: ambiente, ATIVO: 'SIM' });
  }

  return { local: localCanonico, ambiente: ambienteCanonico };
}

// Recebe "" (todos), um turno ou vários separados por ";" e grava limpo.
function normalizarTurnosAtividade_(valor) {
  const lista = String(valor == null ? '' : valor).split(';').map(function (t) { return t.trim(); }).filter(Boolean);
  return lista.filter(function (t, i) { return lista.indexOf(t) === i; }).join(';');
}

function criarAtividade_(p) {
  const erro = validarDadosAtividade_(p);
  if (erro) return { ok: false, error: erro };
  const canon = garantirLocalAmbiente_(p.local, p.ambiente);

  const idAtividade = nextId_('ATV');
  appendRow_(SHEETS.ATIVIDADES, Object.assign({
    ID_ATIVIDADE: idAtividade,
    LOCAL: canon.local,
    AMBIENTE: canon.ambiente,
    ATIVIDADE: String(p.atividade).trim(),
    TURNO: normalizarTurnosAtividade_(p.turno),
    MODO_TURNO: p.modoTurno === 'UM' ? 'UM' : 'CADA',
    FOTO_ANTES: p.fotoAntes ? 'SIM' : 'NAO',
    FOTO_DEPOIS: p.fotoDepois ? 'SIM' : 'NAO',
    VALIDACAO: p.validacao ? 'SIM' : 'NAO',
    ATIVO: 'SIM'
  }, camposFrequencia_(p).campos));
  return { ok: true, data: { idAtividade: idAtividade } };
}

// Cadastra várias atividades de uma vez para o mesmo local+ambiente (ex:
// "Retirada de lixo", "Limpeza das mesas", "Limpeza do chão" — todas do
// Refeitório, todas Diárias). Cada descrição em p.atividades vira uma
// linha própria em ATIVIDADES, com o mesmo local/ambiente/frequência/
// turno/exigências — evita o admin repetir o formulário inteiro pra
// cadastrar várias perguntas do checklist de um mesmo lugar.
function criarAtividadesLote_(p) {
  const descricoes = (Array.isArray(p.atividades) ? p.atividades : [])
    .map(function (d) { return String(d || '').trim(); })
    .filter(Boolean);

  if (!String(p.local || '').trim()) return { ok: false, error: 'Informe o local.' };
  if (!String(p.ambiente || '').trim()) return { ok: false, error: 'Informe o ambiente.' };
  if (!descricoes.length) return { ok: false, error: 'Adicione ao menos uma atividade.' };
  const freq = camposFrequencia_(p);
  if (freq.erro) return { ok: false, error: freq.erro };

  const canon = garantirLocalAmbiente_(p.local, p.ambiente);

  // Reserva todos os IDs de uma vez e grava todas as linhas com um único
  // setValues (nextIds_ + appendRows_), em vez de uma leitura+gravação em
  // _SEQ e um appendRow_ separado PARA CADA atividade — com 10 atividades,
  // por exemplo, isso troca ~20 idas e voltas à planilha por só 2.
  const idsGerados = nextIds_('ATV', descricoes.length);
  appendRows_(SHEETS.ATIVIDADES, descricoes.map(function (descricao, i) {
    return Object.assign({
      ID_ATIVIDADE: idsGerados[i],
      LOCAL: canon.local,
      AMBIENTE: canon.ambiente,
      ATIVIDADE: descricao,
      TURNO: normalizarTurnosAtividade_(p.turno),
      MODO_TURNO: p.modoTurno === 'UM' ? 'UM' : 'CADA',
      FOTO_ANTES: p.fotoAntes ? 'SIM' : 'NAO',
      FOTO_DEPOIS: p.fotoDepois ? 'SIM' : 'NAO',
      VALIDACAO: p.validacao ? 'SIM' : 'NAO',
      ATIVO: 'SIM'
    }, freq.campos);
  }));
  return { ok: true, data: { ids: idsGerados, total: idsGerados.length } };
}

function atualizarAtividade_(p) {
  const atual = findRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade);
  if (!atual) return { ok: false, error: 'Atividade não encontrada.' };
  _UNIDADE_CTX_ = unidadeDoRegistro_(atual); // modo "Todas": edita dentro da unidade da própria atividade
  const erro = validarDadosAtividade_(p);
  if (erro) return { ok: false, error: erro };
  const canon = garantirLocalAmbiente_(p.local, p.ambiente);

  updateRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade, Object.assign({
    LOCAL: canon.local,
    AMBIENTE: canon.ambiente,
    ATIVIDADE: String(p.atividade).trim(),
    TURNO: normalizarTurnosAtividade_(p.turno),
    MODO_TURNO: p.modoTurno === 'UM' ? 'UM' : 'CADA',
    FOTO_ANTES: p.fotoAntes ? 'SIM' : 'NAO',
    FOTO_DEPOIS: p.fotoDepois ? 'SIM' : 'NAO',
    VALIDACAO: p.validacao ? 'SIM' : 'NAO',
    ATIVO: p.ativo === 'NAO' ? 'NAO' : 'SIM'
  }, camposFrequencia_(p).campos));
  return { ok: true };
}

// Ativa/desativa uma atividade (equivalente a "remover" sem apagar
// histórico — uma atividade inativa some do wizard de checklist do agente e
// do planejamento previsto dos dashboards, mas os checklists já registrados
// com ela continuam no histórico normalmente).
function atualizarStatusAtividade_(p) {
  const atual = findRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade);
  if (!atual) return { ok: false, error: 'Atividade não encontrada.' };
  updateRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade, { ATIVO: p.ativo === 'SIM' ? 'SIM' : 'NAO' });
  return { ok: true };
}

// Apaga a atividade de vez da aba ATIVIDADES (diferente de desativar). É
// seguro: cada linha de CHECKLISTS já guarda sua própria cópia de
// LOCAL/AMBIENTE/ATIVIDADE/PERIODICIDADE no momento da execução (não
// depende da linha em ATIVIDADES continuar existindo), então apagar aqui
// não afeta checklists já registrados nem o histórico do agente — só
// impede que essa atividade apareça de novo em novos checklists.
function excluirAtividade_(p) {
  const atual = findRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade);
  if (!atual) return { ok: false, error: 'Atividade não encontrada.' };
  deleteRowById_(SHEETS.ATIVIDADES, 'ID_ATIVIDADE', p.idAtividade);
  return { ok: true };
}

// ======================= CONFIG (locais, ambientes, turnos, atividades) =======================

function getLocais_() {
  return readSheet_(SHEETS.LOCAIS).filter(function (l) { return String(l.ATIVO).toUpperCase() === 'SIM'; });
}

function getAmbientes_(local) {
  return readSheet_(SHEETS.AMBIENTES).filter(function (a) {
    return (!local || a.LOCAL === local) && String(a.ATIVO).toUpperCase() === 'SIM';
  });
}

function getTurnos_() {
  return readSheet_(SHEETS.TURNOS).filter(function (t) { return String(t.ATIVO).toUpperCase() === 'SIM'; });
}

// Tudo que o app precisa de cadastro numa chamada só (login, wizard de
// checklist, formulários). O app guarda isso no aparelho e responde as
// telas na hora, conferindo por trás se algo mudou.
function getBootstrap_() {
  return {
    unidade: _UNIDADE_CTX_ === null ? UNIDADE_TODAS_ : _UNIDADE_CTX_,
    unidades: unidadesCadastradas_(),
    usuarios: getUsuarios_(),
    locais: getLocais_(),
    ambientes: getAmbientes_(''),
    turnos: getTurnos_(),
    atividades: readSheet_(SHEETS.ATIVIDADES).filter(function (a) { return String(a.ATIVO).toUpperCase() === 'SIM'; })
  };
}

// ======================= ADMIN: GESTÃO DE LOCAIS E AMBIENTES =======================
// Complementa o cadastro livre de local/ambiente feito direto no formulário
// de atividades (garantirLocalAmbiente_): aqui o Admin consegue ver todos os
// locais/ambientes já usados, renomear (corrigindo grafias divergentes, ex.
// "Refeitorio" vs "Refeitório") e ativar/desativar. Renomear propaga para
// AMBIENTES/ATIVIDADES (que dependem do nome atual para o wizard do agente
// funcionar), mas NUNCA para CHECKLISTS/OCORRENCIAS/NAO_CONFORMIDADES já
// registrados — o histórico preserva o nome exatamente como estava no
// momento em que cada registro foi feito. Por esse mesmo motivo, não existe
// aqui uma função de "mesclar" dois locais/ambientes parecidos em um só —
// só renomear um registro específico.

// Troca o valor de UMA coluna em todas as linhas que batem com o filtro,
// gravando a coluna inteira de uma vez (antes era um setValue por célula).
function substituirNaColuna_(sheetName, coluna, filtro, novoValor) {
  const sh = sheet_(sheetName);
  const dados = sh.getDataRange().getValues();
  const h = dados[0];
  const col = h.indexOf(coluna);
  if (col === -1 || dados.length < 2) return 0;
  const colUnid = h.indexOf('UNIDADE');
  const daUnidade = function (linha) {
    if (_UNIDADE_CTX_ === null || ABAS_POR_UNIDADE_.indexOf(sheetName) === -1) return true;
    return registroNaUnidade_(sheetName, { UNIDADE: colUnid > -1 ? linha[colUnid] : '' }, _UNIDADE_CTX_);
  };
  let total = 0;
  const valores = dados.slice(1).map(function (linha) {
    if (daUnidade(linha) && filtro(linha, h)) { total++; return [novoValor]; }
    return [linha[col]];
  });
  if (total) sh.getRange(2, col + 1, valores.length, 1).setValues(valores);
  invalidarCache_(sheetName);
  return total;
}

function getLocaisAdmin_() {
  return readSheet_(SHEETS.LOCAIS).sort(function (a, b) { return String(a.LOCAL).localeCompare(String(b.LOCAL)); });
}

function getAmbientesAdmin_(params) {
  let rows = readSheet_(SHEETS.AMBIENTES);
  if (params && params.local) rows = rows.filter(function (a) { return a.LOCAL === params.local; });
  return rows.sort(function (a, b) { return String(a.LOCAL + '|' + a.AMBIENTE).localeCompare(String(b.LOCAL + '|' + b.AMBIENTE)); });
}

function criarLocal_(p) {
  const nome = String(p.nome || '').trim();
  if (!nome) return { ok: false, error: 'Informe o nome do local.' };
  const existentes = readSheet_(SHEETS.LOCAIS);
  if (existentes.some(function (l) { return String(l.LOCAL).trim().toLowerCase() === nome.toLowerCase(); })) {
    return { ok: false, error: 'Já existe um local com esse nome.' };
  }
  const idLocal = nextId_('LOC');
  appendRow_(SHEETS.LOCAIS, { ID_LOCAL: idLocal, LOCAL: nome, ATIVO: 'SIM' });
  return { ok: true, data: { idLocal: idLocal } };
}

function renomearLocal_(p) {
  const atual = findRowById_(SHEETS.LOCAIS, 'ID_LOCAL', p.idLocal);
  if (!atual) return { ok: false, error: 'Local não encontrado.' };
  _UNIDADE_CTX_ = unidadeDoRegistro_(atual); // renomeia só dentro da unidade do local
  const novoNome = String(p.novoNome || '').trim();
  if (!novoNome) return { ok: false, error: 'Informe o novo nome do local.' };
  const nomeAntigo = atual.LOCAL;
  if (novoNome.toLowerCase() === String(nomeAntigo).toLowerCase()) return { ok: true };

  const outrosLocais = readSheet_(SHEETS.LOCAIS).filter(function (l) { return String(l.ID_LOCAL) !== String(p.idLocal); });
  if (outrosLocais.some(function (l) { return String(l.LOCAL).trim().toLowerCase() === novoNome.toLowerCase(); })) {
    return { ok: false, error: 'Já existe outro local com esse nome.' };
  }

  updateRowById_(SHEETS.LOCAIS, 'ID_LOCAL', p.idLocal, { LOCAL: novoNome });

  // Propaga o novo nome para AMBIENTES e ATIVIDADES que ainda apontavam
  // para o nome antigo (o histórico em CHECKLISTS/OCORRENCIAS/NAO_
  // CONFORMIDADES fica como estava, de propósito).
  substituirNaColuna_(SHEETS.AMBIENTES, 'LOCAL', function (linha, h) {
    return String(linha[h.indexOf('LOCAL')]) === String(nomeAntigo);
  }, novoNome);
  substituirNaColuna_(SHEETS.ATIVIDADES, 'LOCAL', function (linha, h) {
    return String(linha[h.indexOf('LOCAL')]) === String(nomeAntigo);
  }, novoNome);

  return { ok: true };
}

function atualizarStatusLocal_(p) {
  const atual = findRowById_(SHEETS.LOCAIS, 'ID_LOCAL', p.idLocal);
  if (!atual) return { ok: false, error: 'Local não encontrado.' };
  updateRowById_(SHEETS.LOCAIS, 'ID_LOCAL', p.idLocal, { ATIVO: p.ativo === 'SIM' ? 'SIM' : 'NAO' });
  return { ok: true };
}

function criarAmbiente_(p) {
  const local = String(p.local || '').trim();
  const nome = String(p.nome || '').trim();
  if (!local) return { ok: false, error: 'Selecione o local.' };
  if (!nome) return { ok: false, error: 'Informe o nome do ambiente.' };
  const existentes = readSheet_(SHEETS.AMBIENTES);
  if (existentes.some(function (a) { return a.LOCAL === local && String(a.AMBIENTE).trim().toLowerCase() === nome.toLowerCase(); })) {
    return { ok: false, error: 'Já existe um ambiente com esse nome nesse local.' };
  }
  const idAmbiente = nextId_('AMB');
  appendRow_(SHEETS.AMBIENTES, { ID_AMBIENTE: idAmbiente, LOCAL: local, AMBIENTE: nome, ATIVO: 'SIM' });
  return { ok: true, data: { idAmbiente: idAmbiente } };
}

function renomearAmbiente_(p) {
  const atual = findRowById_(SHEETS.AMBIENTES, 'ID_AMBIENTE', p.idAmbiente);
  if (!atual) return { ok: false, error: 'Ambiente não encontrado.' };
  _UNIDADE_CTX_ = unidadeDoRegistro_(atual); // renomeia só dentro da unidade do ambiente
  const novoNome = String(p.novoNome || '').trim();
  if (!novoNome) return { ok: false, error: 'Informe o novo nome do ambiente.' };
  const nomeAntigo = atual.AMBIENTE;
  const local = atual.LOCAL;
  if (novoNome.toLowerCase() === String(nomeAntigo).toLowerCase()) return { ok: true };

  const outrosAmbientes = readSheet_(SHEETS.AMBIENTES).filter(function (a) { return String(a.ID_AMBIENTE) !== String(p.idAmbiente); });
  if (outrosAmbientes.some(function (a) { return a.LOCAL === local && String(a.AMBIENTE).trim().toLowerCase() === novoNome.toLowerCase(); })) {
    return { ok: false, error: 'Já existe outro ambiente com esse nome nesse local.' };
  }

  updateRowById_(SHEETS.AMBIENTES, 'ID_AMBIENTE', p.idAmbiente, { AMBIENTE: novoNome });

  substituirNaColuna_(SHEETS.ATIVIDADES, 'AMBIENTE', function (linha, h) {
    return String(linha[h.indexOf('LOCAL')]) === String(local) && String(linha[h.indexOf('AMBIENTE')]) === String(nomeAntigo);
  }, novoNome);

  return { ok: true };
}

function atualizarStatusAmbiente_(p) {
  const atual = findRowById_(SHEETS.AMBIENTES, 'ID_AMBIENTE', p.idAmbiente);
  if (!atual) return { ok: false, error: 'Ambiente não encontrado.' };
  updateRowById_(SHEETS.AMBIENTES, 'ID_AMBIENTE', p.idAmbiente, { ATIVO: p.ativo === 'SIM' ? 'SIM' : 'NAO' });
  return { ok: true };
}

// Retorna as atividades cadastradas para local+ambiente+periodicidade,
// aplicáveis ao turno informado (TURNO em branco na config = vale p/ todos).
function getAtividades_(params) {
  return readSheet_(SHEETS.ATIVIDADES).filter(function (a) {
    const ativo = String(a.ATIVO).toUpperCase() === 'SIM';
    const okLocal = a.LOCAL === params.local;
    const okAmbiente = a.AMBIENTE === params.ambiente;
    const okPeriodicidade = grupoPeriodicidade_(a.PERIODICIDADE) === grupoPeriodicidade_(params.periodicidade);
    const okTurno = atividadeValeNoTurno_(a, params.turno);
    return ativo && okLocal && okAmbiente && okPeriodicidade && okTurno;
  });
}

// Uma atividade está "prevista" numa data específica de acordo com sua
// periodicidade: DIARIO = todo dia; SEMANAL = respeita DIA_SEMANA (0-6,
// domingo=0) se preenchido, senão qualquer dia; MENSAL = respeita DIA_MES
// (1-31) se preenchido, senão qualquer dia.
function atividadePrevistaNaData_(atividade, date) {
  if (atividade.PERIODICIDADE === 'DIARIO') return true;
  if (atividade.PERIODICIDADE === 'SEMANAL') {
    if (atividade.DIA_SEMANA === '' || atividade.DIA_SEMANA === undefined || atividade.DIA_SEMANA === null) return true;
    return Number(atividade.DIA_SEMANA) === date.getDay();
  }
  if (atividade.PERIODICIDADE === 'MENSAL') {
    if (atividade.DIA_MES === '' || atividade.DIA_MES === undefined || atividade.DIA_MES === null) return true;
    return Number(atividade.DIA_MES) === date.getDate();
  }
  // Frequência personalizada com DIAS FIXOS: cada dia marcado é uma data
  // prevista. Com dias LIVRES não há uma data certa — essas são contadas à
  // parte, por período (ver calcularCotasLivres_).
  if (ehVezes_(atividade)) {
    const dias = parseDiasFixos_(atividade.DIAS_FIXOS, atividade.PERIODICIDADE) || [];
    if (!dias.length) return false;
    return dias.indexOf(atividade.PERIODICIDADE === 'VEZES_SEMANA' ? date.getDay() : date.getDate()) > -1;
  }
  return false;
}

// ---------- COTAS DE DIAS LIVRES ("N vezes por semana/mês", sem dia fixo) ----------
// Semana = segunda a domingo (mesmo critério do filtro "Esta semana" do app).
function inicioPeriodoVezes_(per, date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (per === 'VEZES_SEMANA') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else d.setDate(1);
  return d;
}

function fimPeriodoVezes_(per, inicio) {
  const d = new Date(inicio);
  if (per === 'VEZES_SEMANA') d.setDate(d.getDate() + 6);
  else { d.setMonth(d.getMonth() + 1); d.setDate(0); }
  return d;
}

// Para cada atividade de dias livres, cada período (semana/mês) que toca o
// intervalo e cada turno aplicável, devolve quantas vezes era para fazer e
// as execuções que contam (no máximo 1 por dia — "3x por semana" são 3 dias
// diferentes; se fez 2x no mesmo dia, vale a execução mais recente do dia).
// `checklists` deve vir SEM filtro de data (o período pode começar antes do
// intervalo pedido).
function calcularCotasLivres_(dataInicial, dataFinal, filtros, checklists) {
  filtros = filtros || {};
  const atividades = readSheet_(SHEETS.ATIVIDADES).filter(function (a) {
    return String(a.ATIVO).toUpperCase() === 'SIM' && ehVezesLivre_(a) &&
      (!filtros.local || a.LOCAL === filtros.local) &&
      (!filtros.ambiente || a.AMBIENTE === filtros.ambiente);
  });
  if (!atividades.length) return [];

  const porAtividade = {};
  (checklists || []).forEach(function (c) {
    if (!c.ID_ATIVIDADE) return;
    (porAtividade[c.ID_ATIVIDADE] = porAtividade[c.ID_ATIVIDADE] || []).push(c);
  });

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fimIntervalo = new Date(dataFinal); fimIntervalo.setHours(0, 0, 0, 0);
  const cotas = [];

  atividades.forEach(function (a) {
    const vezes = Math.max(1, Number(a.VEZES) || 1);
    const bastaUm = modoBastaUm_(a, filtros.turnosDisponiveis);
    const turnos = bastaUm ? [''] : turnosDaAtividade_(a, filtros.turnosDisponiveis);
    let ini = inicioPeriodoVezes_(a.PERIODICIDADE, dataInicial);
    while (ini.getTime() <= fimIntervalo.getTime()) {
      const fim = fimPeriodoVezes_(a.PERIODICIDADE, ini);
      const tIni = ini.getTime(), tFim = fim.getTime();
      turnos.forEach(function (turno) {
        if (filtros.turno && (bastaUm ? !atividadeValeNoTurno_(a, filtros.turno) : turno !== filtros.turno)) return;
        const porDia = {};
        (porAtividade[a.ID_ATIVIDADE] || []).forEach(function (c) {
          if (turno && c.TURNO !== turno) return;
          const dOp = dataOpChecklist_(c);
          const t = toDate_(dOp).getTime();
          if (t < tIni || t > tFim) return;
          const atual = porDia[dOp];
          if (!atual || String(c.ID_CHECKLIST).localeCompare(String(atual.ID_CHECKLIST)) > 0) porDia[dOp] = c;
        });
        const execucoes = Object.keys(porDia).map(function (k) { return porDia[k]; })
          .sort(function (x, y) { return String(x.ID_CHECKLIST).localeCompare(String(y.ID_CHECKLIST)); })
          .slice(0, vezes);
        cotas.push({
          atividade: a, turno: turno, vezes: vezes, bastaUm: bastaUm,
          inicio: ini, fim: fim, execucoes: execucoes,
          faltam: vezes - execucoes.length,
          encerrado: tFim < hoje.getTime()
        });
      });
      ini = new Date(fim);
      ini.setDate(ini.getDate() + 1);
    }
  });
  return cotas;
}

// Monta a lista de "ocorrências previstas" (atividade x data x turno) dentro
// de um intervalo [dataInicial, dataFinal], já filtrada por local/ambiente/
// turno se informados. Usada pelos dashboards e pelo painel do dia para
// calcular pendências/atrasos comparando com o que foi de fato executado.
function calcularPrevistos_(dataInicial, dataFinal, filtros) {
  filtros = filtros || {};
  const atividades = readSheet_(SHEETS.ATIVIDADES).filter(function (a) {
    const ativo = String(a.ATIVO).toUpperCase() === 'SIM';
    const okLocal = !filtros.local || a.LOCAL === filtros.local;
    const okAmbiente = !filtros.ambiente || a.AMBIENTE === filtros.ambiente;
    return ativo && okLocal && okAmbiente;
  });

  const previstos = [];
  const cursor = new Date(dataInicial);
  const fim = new Date(dataFinal);
  cursor.setHours(0, 0, 0, 0);
  fim.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= fim.getTime()) {
    atividades.forEach(function (a) {
      if (!atividadePrevistaNaData_(a, cursor)) return;
      // "Basta um turno": uma única previsão no dia (turno em branco = qualquer
      // um dos turnos marcados). "Cada turno": uma previsão por turno.
      const bastaUm = modoBastaUm_(a, filtros.turnosDisponiveis);
      const turnosDaAtividade = bastaUm ? [''] : turnosDaAtividade_(a, filtros.turnosDisponiveis);
      turnosDaAtividade.forEach(function (turno) {
        if (filtros.turno && (bastaUm ? !atividadeValeNoTurno_(a, filtros.turno) : turno !== filtros.turno)) return;
        previstos.push({
          turnosPermitidos: bastaUm ? turnosDaAtividade_(a, filtros.turnosDisponiveis) : [turno],
          data: dateToBR_(cursor),
          idAtividade: a.ID_ATIVIDADE,
          local: localRotulo_(a),
          ambiente: a.AMBIENTE,
          atividade: a.ATIVIDADE,
          turno: turno,
          periodicidade: a.PERIODICIDADE,
          chave: dateToBR_(cursor) + '|' + a.ID_ATIVIDADE + '|' + turno
        });
      });
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return previstos;
}

function dateToBR_(d) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

// ======================= CHECKLIST (execução) =======================

// Cria um registro de checklist por atividade enviada (p.itens: array).
function criarChecklist_(p) {
  const itens = p.itens || [];
  // Reserva todos os IDs de uma vez (1 leitura+gravação em _SEQ no total) e
  // grava todas as linhas do checklist com um único setValues no final, em
  // vez de nextId_ + appendRow_ separados PARA CADA item — um checklist de
  // ambiente costuma ter várias atividades, então isso economiza bastante
  // ida e volta à planilha por envio. As fotos continuam sendo salvas uma a
  // uma (é I/O do Drive, não da planilha).
  const idsGerados = nextIds_('CHK', itens.length);
  const dataStr = nowDateStr_();
  const horaStr = nowTimeStr_();
  const dataOp = dataOperacional_(new Date());
  const rows = itens.map(function (item, i) {
    const idChecklist = idsGerados[i];
    const fotoAntes = salvarFoto_(item.fotoAntes, idChecklist + '_antes');
    const fotoDepois = salvarFoto_(item.fotoDepois, idChecklist + '_depois');
    const precisaValidacao = String(item.validacao).toUpperCase() === 'SIM';
    return {
      ID_CHECKLIST: idChecklist,
      DATA: dataStr,
      HORA: horaStr,
      TURNO: p.turno,
      LOCAL: p.local,
      AMBIENTE: p.ambiente,
      ATIVIDADE: item.atividade,
      ID_ATIVIDADE: item.idAtividade || '',
      // Periodicidade real da atividade (ex.: VEZES_SEMANA), não só a
      // opção escolhida no wizard (que agrupa "3x por semana" em Semanal).
      PERIODICIDADE: item.periodicidade || p.periodicidade,
      ID_AGENTE: p.idAgente,
      AGENTE: p.agente,
      RESULTADO: item.resultado,
      OBSERVACAO: item.observacao || '',
      FOTO_ANTES: fotoAntes,
      FOTO_DEPOIS: fotoDepois,
      STATUS: precisaValidacao ? 'PENDENTE_VALIDACAO' : 'SEM_VALIDACAO',
      ADMIN_VALIDADOR: '',
      DATA_VALIDACAO: '',
      MOTIVO_REPROVACAO: '',
      OBS_VALIDACAO: '',
      REFAZER: '',
      DATA_OPERACIONAL: dataOp
    };
  });
  appendRows_(SHEETS.CHECKLISTS, rows);
  return { ok: true, data: { ids: idsGerados } };
}

function getChecklists_(params) {
  let rows = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) rows = rows.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) rows = rows.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  if (params.status) rows = rows.filter(function (r) { return r.STATUS === params.status; });
  if (params.resultado) rows = rows.filter(function (r) { return r.RESULTADO === params.resultado; });
  if (params.dataInicial) { const tI = toDate_(params.dataInicial).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() >= tI; }); }
  if (params.dataFinal) { const tF = toDate_(params.dataFinal).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() <= tF; }); }
  return rows.sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); });
}

function validarChecklist_(p) {
  updateRowById_(SHEETS.CHECKLISTS, 'ID_CHECKLIST', p.idChecklist, {
    STATUS: p.aprovado ? 'APROVADO' : 'REPROVADO',
    ADMIN_VALIDADOR: p.adminValidador || '',
    DATA_VALIDACAO: nowDateStr_() + ' ' + nowTimeStr_(),
    MOTIVO_REPROVACAO: p.aprovado ? '' : (p.motivo || ''),
    OBS_VALIDACAO: p.observacao || '',
    REFAZER: p.aprovado ? 'NAO' : (p.refazer ? 'SIM' : 'NAO')
  });
  return { ok: true };
}

// Aprova vários checklists pendentes de uma vez (fila de validação), sem
// precisar abrir um por um — só se aplica a aprovação; reprovar continua
// exigindo motivo individual, então segue sendo feito item a item.
function aprovarChecklistsLote_(p) {
  const ids = Array.isArray(p.idsChecklist) ? p.idsChecklist : [];
  const dataHora = nowDateStr_() + ' ' + nowTimeStr_();
  const total = updateRowsByIds_(SHEETS.CHECKLISTS, 'ID_CHECKLIST', ids, {
    STATUS: 'APROVADO',
    ADMIN_VALIDADOR: p.adminValidador || '',
    DATA_VALIDACAO: dataHora,
    MOTIVO_REPROVACAO: '',
    REFAZER: 'NAO'
  });
  return { ok: true, data: { total: total } };
}

// Checklists reprovados com REFAZER=SIM que o agente responsável ainda não
// refez. Heurística: para cada reprovação pendente, procura por um checklist
// MAIS RECENTE (ID_CHECKLIST maior) da mesma atividade — se existir, o
// agente já registrou uma nova execução depois da reprovação, então essa
// pendência não é mais mostrada (mesmo que a nova execução também tenha
// sido reprovada — nesse caso ela mesma vira a pendência mais recente).
// Checklists antigos sem ID_ATIVIDADE preenchido não têm como ser checados
// dessa forma e continuam aparecendo até serem validados de novo.
function getPendenciasRefazer_(params) {
  const idAgente = params.idAgente;
  const rows = readSheet_(SHEETS.CHECKLISTS).filter(function (r) { return String(r.ID_AGENTE) === String(idAgente); });
  const reprovadosParaRefazer = rows.filter(function (r) {
    return r.STATUS === 'REPROVADO' && String(r.REFAZER).toUpperCase() === 'SIM';
  });
  // Maior ID_CHECKLIST por atividade (1 passada, em vez de comparar cada
  // reprovado com todos os checklists do agente).
  const maiorIdPorAtividade = {};
  rows.forEach(function (o) {
    if (!o.ID_ATIVIDADE) return;
    const atual = maiorIdPorAtividade[o.ID_ATIVIDADE];
    if (atual === undefined || String(o.ID_CHECKLIST).localeCompare(String(atual)) > 0) maiorIdPorAtividade[o.ID_ATIVIDADE] = o.ID_CHECKLIST;
  });
  const pendentes = reprovadosParaRefazer.filter(function (c) {
    if (!c.ID_ATIVIDADE) return true;
    return String(maiorIdPorAtividade[c.ID_ATIVIDADE]).localeCompare(String(c.ID_CHECKLIST)) <= 0;
  });
  return pendentes.sort(function (a, b) { return String(b.ID_CHECKLIST).localeCompare(String(a.ID_CHECKLIST)); });
}

// ======================= OCORRÊNCIAS =======================

// Busca no histórico de CHECKLISTS quem foi o último Agente de Limpeza (e em
// qual turno) a executar uma limpeza naquele Local+Ambiente. Usada tanto para
// preencher automaticamente o "turno responsável" ao abrir uma ocorrência,
// quanto para sugerir o responsável ao abrir uma Não Conformidade.
function buscarUltimaLimpeza_(local, ambiente) {
  const rows = readSheet_(SHEETS.CHECKLISTS).filter(function (r) {
    return r.LOCAL === local && r.AMBIENTE === ambiente;
  });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); });
  const ultima = rows[0];
  return {
    turno: ultima.TURNO,
    idAgente: ultima.ID_AGENTE,
    agente: ultima.AGENTE,
    data: ultima.DATA,
    hora: ultima.HORA
  };
}

// A ocorrência é sobre um problema encontrado num Local+Ambiente — o turno
// e o agente "responsáveis" pelo problema são automaticamente os da última
// limpeza registrada ali (não o turno/agente de quem está abrindo a
// ocorrência, que pode ser de outro turno relatando algo que já estava
// errado quando chegou).
function criarOcorrencia_(p) {
  const idOcorrencia = nextId_('OCO');
  const foto = salvarFoto_(p.foto, idOcorrencia);
  const ultimaLimpeza = buscarUltimaLimpeza_(p.local, p.ambiente);
  appendRow_(SHEETS.OCORRENCIAS, {
    ID_OCORRENCIA: idOcorrencia,
    DATA: nowDateStr_(),
    HORA: nowTimeStr_(),
    TURNO: p.turno || '',
    ID_AGENTE: p.idAgente,
    AGENTE: p.agente,
    LOCAL: p.local,
    AMBIENTE: p.ambiente,
    DESCRICAO: p.descricao || '',
    FOTO: foto,
    STATUS: 'ABERTA',
    ADMIN_ANALISE: '',
    DATA_ANALISE: '',
    RESULTADO_ANALISE: '',
    OBSERVACAO_ANALISE: '',
    TURNO_RESPONSAVEL: ultimaLimpeza ? ultimaLimpeza.turno : '',
    ID_AGENTE_RESPONSAVEL: ultimaLimpeza ? ultimaLimpeza.idAgente : '',
    AGENTE_RESPONSAVEL: ultimaLimpeza ? ultimaLimpeza.agente : '',
    DATA_ULTIMA_LIMPEZA: ultimaLimpeza ? (ultimaLimpeza.data + ' ' + ultimaLimpeza.hora) : ''
  });
  return { ok: true, data: { idOcorrencia: idOcorrencia, ultimaLimpeza: ultimaLimpeza } };
}

function getOcorrencias_(params) {
  let rows = readSheet_(SHEETS.OCORRENCIAS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) rows = rows.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) rows = rows.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  if (params.status) rows = rows.filter(function (r) { return r.STATUS === params.status; });
  if (params.dataInicial) { const tI = toDate_(params.dataInicial).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() >= tI; }); }
  if (params.dataFinal) { const tF = toDate_(params.dataFinal).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() <= tF; }); }
  return rows.sort(function (a, b) { return b.ID_OCORRENCIA.localeCompare(a.ID_OCORRENCIA); });
}

function validarOcorrencia_(p) {
  updateRowById_(SHEETS.OCORRENCIAS, 'ID_OCORRENCIA', p.idOcorrencia, {
    STATUS: p.procedente ? 'PROCEDENTE' : 'NAO_PROCEDENTE',
    ADMIN_ANALISE: p.adminAnalise || '',
    DATA_ANALISE: nowDateStr_() + ' ' + nowTimeStr_(),
    RESULTADO_ANALISE: p.procedente ? 'PROCEDENTE' : 'NAO_PROCEDENTE',
    OBSERVACAO_ANALISE: p.observacao || ''
  });
  return { ok: true };
}

// Permite ao admin mover a ocorrência para TRATADA/ENCERRADA depois de
// procedente, sem precisar refazer toda a análise.
function atualizarStatusOcorrencia_(p) {
  updateRowById_(SHEETS.OCORRENCIAS, 'ID_OCORRENCIA', p.idOcorrencia, { STATUS: p.status });
  return { ok: true };
}

// ======================= NÃO CONFORMIDADE (inspeção direcionada) =======================
// Diferente de OCORRENCIAS (aberta livremente por qualquer Agente), aqui é o
// próprio Administrador da Qualidade que inspeciona o local, encontra um
// problema, e já direciona a resolução a um Agente de Limpeza específico —
// funciona como uma pendência: Aberta (pro agente resolver) → Aguardando
// validação (agente resolveu, mandou foto) → Finalizada/Reprovada (admin
// valida a resolução).

function criarNaoConformidade_(p) {
  const idNc = nextId_('NC');
  const foto = salvarFoto_(p.foto, idNc);
  appendRow_(SHEETS.NAO_CONFORMIDADES, {
    ID_NC: idNc,
    DATA: nowDateStr_(),
    HORA: nowTimeStr_(),
    LOCAL: p.local,
    AMBIENTE: p.ambiente,
    DESCRICAO: p.descricao || '',
    FOTO: foto,
    ID_AGENTE_RESPONSAVEL: p.idAgenteResponsavel,
    AGENTE_RESPONSAVEL: p.agenteResponsavel,
    ADMIN_ABRIU: p.adminAbriu || '',
    STATUS: 'ABERTA',
    DATA_RESOLUCAO: '',
    DESCRICAO_RESOLUCAO: '',
    FOTO_RESOLUCAO: '',
    DATA_VALIDACAO: '',
    ADMIN_VALIDADOR: '',
    MOTIVO_REPROVACAO: ''
  });
  return { ok: true, data: { idNc: idNc } };
}

function getNaoConformidades_(params) {
  let rows = readSheet_(SHEETS.NAO_CONFORMIDADES);
  if (params.idAgenteResponsavel) rows = rows.filter(function (r) { return String(r.ID_AGENTE_RESPONSAVEL) === String(params.idAgenteResponsavel); });
  if (params.status) rows = rows.filter(function (r) { return r.STATUS === params.status; });
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.dataInicial) { const tI = toDate_(params.dataInicial).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() >= tI; }); }
  if (params.dataFinal) { const tF = toDate_(params.dataFinal).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() <= tF; }); }
  return rows.sort(function (a, b) { return b.ID_NC.localeCompare(a.ID_NC); });
}

// O Agente de Limpeza resolve a não conformidade direcionada a ele,
// obrigatoriamente com foto de comprovação — igual ao fluxo de pendências
// do sistema de armazéns.
function resolverNaoConformidade_(p) {
  if (!p.fotoResolucao) return { ok: false, error: 'Foto de comprovação é obrigatória para resolver.' };
  const foto = salvarFoto_(p.fotoResolucao, p.idNc + '_resolucao');
  updateRowById_(SHEETS.NAO_CONFORMIDADES, 'ID_NC', p.idNc, {
    STATUS: 'AGUARDANDO_VALIDACAO',
    DESCRICAO_RESOLUCAO: p.descricaoResolucao || '',
    FOTO_RESOLUCAO: foto,
    DATA_RESOLUCAO: nowDateStr_() + ' ' + nowTimeStr_()
  });
  return { ok: true };
}

function validarNaoConformidade_(p) {
  updateRowById_(SHEETS.NAO_CONFORMIDADES, 'ID_NC', p.idNc, {
    STATUS: p.aprovado ? 'FINALIZADA' : 'ABERTA',
    ADMIN_VALIDADOR: p.adminValidador || '',
    DATA_VALIDACAO: nowDateStr_() + ' ' + nowTimeStr_(),
    MOTIVO_REPROVACAO: p.aprovado ? '' : (p.motivo || '')
  });
  return { ok: true };
}

// ======================= HISTÓRICO =======================

function getHistoricoAgente_(idAgente) {
  const checklists = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return String(c.ID_AGENTE) === String(idAgente); });
  const ocorrencias = readSheet_(SHEETS.OCORRENCIAS).filter(function (o) { return String(o.ID_AGENTE) === String(idAgente); });
  const naoConformidades = readSheet_(SHEETS.NAO_CONFORMIDADES).filter(function (n) { return String(n.ID_AGENTE_RESPONSAVEL) === String(idAgente); });
  return {
    checklists: checklists.sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); }),
    ocorrencias: ocorrencias.sort(function (a, b) { return b.ID_OCORRENCIA.localeCompare(a.ID_OCORRENCIA); }),
    naoConformidades: naoConformidades.sort(function (a, b) { return b.ID_NC.localeCompare(a.ID_NC); })
  };
}

// ======================= PAINEL DO DIA =======================

// Para cada Local+Ambiente com atividade DIÁRIA prevista hoje, mostra se já
// foi realizada — visão rápida do admin sobre o que está em atraso agora.
function getPainelHoje_(params) {
  // "Hoje" = dia operacional: de madrugada (antes da virada) ainda é o dia
  // anterior, com os turnos da noite em andamento.
  const hojeStr = dataOperacional_(new Date());
  const hoje = toDate_(hojeStr);
  const turnos = getTurnos_().map(function (t) { return t.TURNO; });

  const previstos = calcularPrevistos_(hoje, hoje, { turnosDisponiveis: turnos, local: params.local, ambiente: params.ambiente });
  const checklistsHoje = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return dataOpChecklist_(c) === hojeStr; });

  // Índice por atividade (e atividade+turno) para não varrer todos os
  // checklists do dia para cada atividade prevista.
  const idxAtv = {}, idxAtvTurno = {};
  checklistsHoje.forEach(function (c) {
    if (!(c.ID_ATIVIDADE in idxAtv)) idxAtv[c.ID_ATIVIDADE] = c;
    const k = c.ID_ATIVIDADE + '|' + c.TURNO;
    if (!(k in idxAtvTurno)) idxAtvTurno[k] = c;
  });
  const itens = previstos.map(function (prev) {
    const feito = prev.turno ? idxAtvTurno[prev.idAtividade + '|' + prev.turno] : idxAtv[prev.idAtividade];
    return {
      local: prev.local,
      ambiente: prev.ambiente,
      atividade: prev.atividade,
      turno: prev.turno,
      turnosPermitidos: prev.turnosPermitidos,
      turnoFeito: feito ? feito.TURNO : '',
      realizado: !!feito,
      status: feito ? feito.STATUS : 'PENDENTE',
      hora: feito ? feito.HORA : ''
    };
  });

  // Frequência personalizada com dias livres (ex.: 3x por semana): entra no
  // painel de hoje se foi feita hoje, ou se a cota do período ainda não foi
  // atingida (aí aparece como pendente, com quantas faltam). Se a cota já
  // foi cumprida em outros dias, não precisa aparecer hoje.
  let checklistsCota = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) checklistsCota = checklistsCota.filter(function (c) { return c.LOCAL === params.local; });
  calcularCotasLivres_(hoje, hoje, { turnosDisponiveis: turnos, local: params.local, ambiente: params.ambiente }, checklistsCota)
    .forEach(function (cota) {
      const a = cota.atividade;
      const feitoHoje = cota.execucoes.filter(function (c) { return dataOpChecklist_(c) === hojeStr; })[0];
      if (!feitoHoje && cota.faltam <= 0) return;
      const periodo = a.PERIODICIDADE === 'VEZES_SEMANA' ? 'nesta semana' : 'neste mês';
      itens.push({
        local: localRotulo_(a),
        ambiente: a.AMBIENTE,
        atividade: a.ATIVIDADE,
        turno: cota.turno,
        turnosPermitidos: cota.bastaUm ? turnosDaAtividade_(a, turnos) : [cota.turno],
        turnoFeito: feitoHoje ? feitoHoje.TURNO : '',
        realizado: !!feitoHoje,
        status: feitoHoje ? feitoHoje.STATUS : 'PENDENTE',
        hora: feitoHoje ? feitoHoje.HORA : '',
        nota: (cota.vezes - cota.faltam) + ' de ' + cota.vezes + ' ' + periodo
      });
    });

  // Resumo por turno (na ordem da aba TURNOS). Atividades "basta um turno"
  // ficam numa linha própria ("Qualquer turno"), para não contar em dobro.
  const porTurno = turnos.concat(['']).map(function (t) {
    const doTurno = itens.filter(function (i) { return (i.turno || '') === t; });
    return {
      turno: t,
      total: doTurno.length,
      realizados: doTurno.filter(function (i) { return i.realizado; }).length,
      pendentes: doTurno.filter(function (i) { return !i.realizado; }).length
    };
  }).filter(function (r) { return r.total > 0; });

  return {
    data: hojeStr,
    viradaDia: HORA_VIRADA_DIA_,
    porTurno: porTurno,
    total: itens.length,
    realizados: itens.filter(function (i) { return i.realizado; }).length,
    pendentes: itens.filter(function (i) { return !i.realizado; }).length,
    itens: itens
  };
}

// ======================= DASHBOARD — CHECKLIST DA QUALIDADE =======================

function getDashboardChecklist_(params) {
  const dataInicial = params.dataInicial || dateToBR_(new Date());
  const dataFinal = params.dataFinal || dateToBR_(new Date());
  const turnos = getTurnos_().map(function (t) { return t.TURNO; });

  const previstos = calcularPrevistos_(toDate_(dataInicial), toDate_(dataFinal), {
    local: params.local, ambiente: params.ambiente, turno: params.turno, turnosDisponiveis: turnos
  });

  let realizados = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) realizados = realizados.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) realizados = realizados.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) realizados = realizados.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) realizados = realizados.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  const tIni = toDate_(dataInicial).getTime(), tFim = toDate_(dataFinal).getTime();
  realizados = realizados.filter(function (r) { const t = toDate_(dataOpChecklist_(r)).getTime(); return t >= tIni && t <= tFim; });

  // Índices da última execução por atividade+data(+turno): troca a busca
  // "para cada previsto, varre todos os realizados" (lenta em períodos
  // longos) por uma consulta direta.
  const ultimaPorAtvData = {}, ultimaPorAtvDataTurno = {};
  realizados.forEach(function (r) {
    const dOp = dataOpChecklist_(r);
    ultimaPorAtvData[r.ID_ATIVIDADE + '|' + dOp] = r;
    ultimaPorAtvDataTurno[r.ID_ATIVIDADE + '|' + dOp + '|' + r.TURNO] = r;
  });

  // Para cada "previsto" (data+atividade+turno), pega a execução mais
  // recente daquele dia (pode haver mais de uma se foi reprovado e refeito).
  const hojeStr = dataOperacional_(new Date());
  let realizadosCount = 0, pendentesCount = 0, atrasadosCount = 0, aprovadosCount = 0, reprovadosCount = 0;

  const tHoje = toDate_(hojeStr).getTime();
  // Recortes previsto × realizado por turno, local e dia (usados pelo
  // Resumo gerencial em PDF).
  const cumprPorTurno = {}, cumprPorLocal = {}, cumprPorDia = {};
  const somar = function (mapa, chave, previsto, realizado) {
    const k = chave || 'Qualquer turno';
    const m = mapa[k] = mapa[k] || { previsto: 0, realizado: 0 };
    m.previsto += previsto; m.realizado += realizado;
  };
  previstos.forEach(function (prev) {
    const ultima = prev.turno
      ? ultimaPorAtvDataTurno[prev.idAtividade + '|' + prev.data + '|' + prev.turno]
      : ultimaPorAtvData[prev.idAtividade + '|' + prev.data];
    somar(cumprPorTurno, prev.turno, 1, ultima ? 1 : 0);
    somar(cumprPorLocal, prev.local, 1, ultima ? 1 : 0);
    somar(cumprPorDia, prev.data, 1, ultima ? 1 : 0);
    if (ultima) {
      realizadosCount++;
      if (ultima.STATUS === 'APROVADO') aprovadosCount++;
      if (ultima.STATUS === 'REPROVADO') reprovadosCount++;
    } else if (prev.data === hojeStr) {
      pendentesCount++;
    } else if (toDate_(prev.data).getTime() < tHoje) {
      atrasadosCount++;
    }
  });

  // Frequência personalizada com dias livres: cada período (semana/mês) que
  // toca o intervalo prevê N execuções; o que faltar vira "pendente" se o
  // período ainda está em andamento, ou "atrasado" se já terminou.
  let checklistsCota = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) checklistsCota = checklistsCota.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) checklistsCota = checklistsCota.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.idAgente) checklistsCota = checklistsCota.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  let previstoCotas = 0;
  calcularCotasLivres_(toDate_(dataInicial), toDate_(dataFinal), {
    local: params.local, ambiente: params.ambiente, turno: params.turno, turnosDisponiveis: turnos
  }, checklistsCota).forEach(function (cota) {
    previstoCotas += cota.vezes;
    realizadosCount += cota.execucoes.length;
    somar(cumprPorTurno, cota.turno, cota.vezes, cota.execucoes.length);
    somar(cumprPorLocal, localRotulo_(cota.atividade), cota.vezes, cota.execucoes.length);
    cota.execucoes.forEach(function (c) { somar(cumprPorDia, dataOpChecklist_(c), 0, 1); });
    cota.execucoes.forEach(function (c) {
      if (c.STATUS === 'APROVADO') aprovadosCount++;
      if (c.STATUS === 'REPROVADO') reprovadosCount++;
    });
    if (cota.faltam > 0) {
      if (cota.encerrado) atrasadosCount += cota.faltam;
      else pendentesCount += cota.faltam;
    }
  });

  const naoConformidades = realizados.filter(function (r) { return r.RESULTADO === 'NAO_CONFORME'; }).length;
  const ocorrenciasNoPeriodo = readSheet_(SHEETS.OCORRENCIAS).filter(function (o) {
    const okLocal = !params.local || o.LOCAL === params.local;
    const okAmbiente = !params.ambiente || o.AMBIENTE === params.ambiente;
    const okTurno = !params.turno || o.TURNO === params.turno;
    const t = toDate_(o.DATA).getTime();
    return okLocal && okAmbiente && okTurno && t >= tIni && t <= tFim;
  });
  // Não conformidades abertas pela própria Qualidade (inspeção do admin,
  // direcionada a um agente) — diferente das ocorrências acima, que são
  // abertas livremente pelos agentes.
  const naoConformidadesQualidadeNoPeriodo = readSheet_(SHEETS.NAO_CONFORMIDADES).filter(function (n) {
    const okLocal = !params.local || n.LOCAL === params.local;
    const okAmbiente = !params.ambiente || n.AMBIENTE === params.ambiente;
    const t = toDate_(n.DATA).getTime();
    return okLocal && okAmbiente && t >= tIni && t <= tFim;
  });

  const totalPrevisto = previstos.length + previstoCotas;
  const validados = aprovadosCount + reprovadosCount;

  return {
    totalPrevisto: totalPrevisto,
    realizados: realizadosCount,
    pendentes: pendentesCount,
    atrasados: atrasadosCount,
    aprovados: aprovadosCount,
    reprovados: reprovadosCount,
    percentualCumprimento: totalPrevisto ? Math.round((realizadosCount / totalPrevisto) * 1000) / 10 : 0,
    percentualAprovacao: validados ? Math.round((aprovadosCount / validados) * 1000) / 10 : 0,
    naoConformidades: naoConformidades,
    totalOcorrencias: ocorrenciasNoPeriodo.length,
    totalNaoConformidadesQualidade: naoConformidadesQualidadeNoPeriodo.length,
    porAgente: agruparContagem_(realizados, 'AGENTE'),
    porLocal: agruparContagem_(realizados, 'LOCAL'),
    porAmbiente: agruparContagem_(realizados, 'AMBIENTE'),
    porTurno: agruparContagem_(realizados, 'TURNO'),
    aprovadosPorAgente: agruparContagem_(realizados.filter(function (r) { return r.STATUS === 'APROVADO'; }), 'AGENTE'),
    reprovadosPorAgente: agruparContagem_(realizados.filter(function (r) { return r.STATUS === 'REPROVADO'; }), 'AGENTE'),
    aprovadosPorTurno: agruparContagem_(realizados.filter(function (r) { return r.STATUS === 'APROVADO'; }), 'TURNO'),
    reprovadosPorTurno: agruparContagem_(realizados.filter(function (r) { return r.STATUS === 'REPROVADO'; }), 'TURNO'),
    ocorrenciasPorAgente: agruparContagem_(ocorrenciasNoPeriodo, 'AGENTE'),
    ocorrenciasPorLocal: agruparContagem_(ocorrenciasNoPeriodo, 'LOCAL'),
    ocorrenciasPorAmbiente: agruparContagem_(ocorrenciasNoPeriodo, 'AMBIENTE'),
    ocorrenciasPorTurno: agruparContagem_(ocorrenciasNoPeriodo, 'TURNO'),
    cumprimentoPorTurno: cumprPorTurno,
    cumprimentoPorLocal: cumprPorLocal,
    cumprimentoPorDia: cumprPorDia,
    registros: realizados
  };
}

// ======================= COMPARATIVO ENTRE UNIDADES =======================
// Indicadores do período lado a lado para cada unidade (tela "Comparativo
// entre unidades" do app e e-mail unificado da supervisão).
function getComparativoUnidades_(params) {
  const dataInicial = params.dataInicial || dateToBR_(new Date());
  const dataFinal = params.dataFinal || dateToBR_(new Date());
  const ctxOriginal = _UNIDADE_CTX_;
  const lista = unidadesCadastradas_().map(function (u) {
    _UNIDADE_CTX_ = u;
    return Object.assign({ unidade: u }, resumoUnidade_(dataInicial, dataFinal));
  });
  _UNIDADE_CTX_ = ctxOriginal;
  return { dataInicial: dataInicial, dataFinal: dataFinal, unidades: lista };
}

// Números de uma unidade (a do contexto atual) num período.
function resumoUnidade_(dataInicial, dataFinal) {
  const d = getDashboardChecklist_({ dataInicial: dataInicial, dataFinal: dataFinal });
  const o = getDashboardOcorrencias_({ dataInicial: dataInicial, dataFinal: dataFinal });
  const tIni = toDate_(dataInicial).getTime(), tFim = toDate_(dataFinal).getTime();
  const ncs = readSheet_(SHEETS.NAO_CONFORMIDADES);
  const ncPeriodo = ncs.filter(function (n) { const t = toDate_(n.DATA).getTime(); return t >= tIni && t <= tFim; });
  const fila = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return c.STATUS === 'PENDENTE_VALIDACAO'; });
  const usuarios = readSheet_(SHEETS.USUARIOS).filter(function (u) {
    return String(u.ATIVO).toUpperCase() === 'SIM' && u.PERFIL === 'AGENTE_LIMPEZA' && normUnid_(unidadeDoRegistro_(u)) !== UNIDADE_TODAS_;
  });
  // Ambiente com mais problemas (não conforme + reprovado + ocorrência procedente/aberta)
  const pontos = {};
  const somar = function (r) { const k = (r.LOCAL || '') + ' · ' + (r.AMBIENTE || ''); pontos[k] = (pontos[k] || 0) + 1; };
  d.registros.forEach(function (r) { if (r.RESULTADO === 'NAO_CONFORME' || r.STATUS === 'REPROVADO') somar(r); });
  o.registros.forEach(function (r) { if (r.STATUS !== 'NAO_PROCEDENTE') somar(r); });
  const criticos = Object.keys(pontos).map(function (k) { return { ambiente: k, total: pontos[k] }; })
    .sort(function (a, b) { return b.total - a.total; }).slice(0, 3);
  return {
    totalPrevisto: d.totalPrevisto,
    realizados: d.realizados,
    pendentes: d.pendentes,
    atrasados: d.atrasados,
    aprovados: d.aprovados,
    reprovados: d.reprovados,
    percentualCumprimento: d.percentualCumprimento,
    percentualAprovacao: d.percentualAprovacao,
    naoConformidades: d.naoConformidades,
    ocorrencias: o.total,
    ocorrenciasProcedentes: o.procedentes,
    ocorrenciasPendentes: o.pendentes,
    ncQualidade: ncPeriodo.length,
    ncAbertas: ncs.filter(function (n) { return n.STATUS === 'ABERTA' || n.STATUS === 'AGUARDANDO_VALIDACAO'; }).length,
    filaValidacao: fila.length,
    agentesAtivos: usuarios.length,
    ambientesCriticos: criticos
  };
}

// ======================= RESUMO GERENCIAL (PDF) =======================
// Tudo o que o "Resumo de Limpeza" precisa numa chamada só: indicadores do
// período, do período anterior de mesma duração (para a variação), recortes
// por turno/local/dia/agente, validação, não conformidades, ocorrências,
// evidências fotográficas, evolução dos últimos 6 meses e o ranking de
// ambientes críticos. O app monta os slides e o PDF a partir daqui.
function getResumoLimpeza_(params) {
  const dataInicial = params.dataInicial || dateToBR_(new Date());
  const dataFinal = params.dataFinal || dateToBR_(new Date());
  const dIni = toDate_(dataInicial), dFim = toDate_(dataFinal);
  const dias = Math.round((dFim.getTime() - dIni.getTime()) / 86400000) + 1;
  const antFim = new Date(dIni); antFim.setDate(antFim.getDate() - 1);
  const antIni = new Date(antFim); antIni.setDate(antIni.getDate() - (dias - 1));

  // Filtros opcionais (usados pelo Dashboard geral): local e turno.
  const fLocal = params.local || '', fTurno = params.turno || '';
  const okLocal = function (r) { return !fLocal || r.LOCAL === fLocal; };
  const atual = getDashboardChecklist_({ dataInicial: dataInicial, dataFinal: dataFinal, local: fLocal, turno: fTurno });
  const anterior = getDashboardChecklist_({ dataInicial: dateToBR_(antIni), dataFinal: dateToBR_(antFim), local: fLocal, turno: fTurno });
  const regs = atual.registros;
  const tIni = dIni.getTime(), tFim = dFim.getTime();
  const noPeriodo = function (data) { const t = toDate_(data).getTime(); return t >= tIni && t <= tFim; };

  // Não conformidades do checklist, por local · ambiente
  const naoConformes = regs.filter(function (r) { return r.RESULTADO === 'NAO_CONFORME'; });
  const chaveAmb = function (r) { return r.LOCAL + ' · ' + r.AMBIENTE; };

  // Ocorrências e não conformidades da Qualidade no período
  const ocorrencias = readSheet_(SHEETS.OCORRENCIAS).filter(function (o) { return noPeriodo(o.DATA) && okLocal(o) && (!fTurno || o.TURNO === fTurno || o.TURNO_RESPONSAVEL === fTurno); });
  const ncsQualidade = readSheet_(SHEETS.NAO_CONFORMIDADES).filter(function (n) { return noPeriodo(n.DATA) && okLocal(n); });

  // Ranking de ambientes críticos (não conformes + reprovados + ocorrências
  // procedentes + NCs da Qualidade)
  const ranking = {};
  const pontuar = function (chave, campo) {
    const r = ranking[chave] = ranking[chave] || { ambiente: chave, naoConformes: 0, reprovados: 0, ocorrencias: 0, ncQualidade: 0, total: 0 };
    r[campo]++; r.total++;
  };
  naoConformes.forEach(function (r) { pontuar(chaveAmb(r), 'naoConformes'); });
  regs.filter(function (r) { return r.STATUS === 'REPROVADO'; }).forEach(function (r) { pontuar(chaveAmb(r), 'reprovados'); });
  ocorrencias.filter(function (o) { return o.STATUS !== 'NAO_PROCEDENTE'; }).forEach(function (o) { pontuar(chaveAmb(o), 'ocorrencias'); });
  ncsQualidade.forEach(function (n) { pontuar(chaveAmb(n), 'ncQualidade'); });
  const ambientesCriticos = Object.keys(ranking).map(function (k) { return ranking[k]; })
    .sort(function (a, b) { return b.total - a.total; }).slice(0, 10);

  // Motivos de reprovação mais comuns
  const motivos = agruparContagem_(regs.filter(function (r) { return r.STATUS === 'REPROVADO' && r.MOTIVO_REPROVACAO; })
    .map(function (r) { return { M: String(r.MOTIVO_REPROVACAO).trim().slice(0, 60) }; }), 'M');

  // Evolução dos últimos 6 meses (pela data operacional)
  const todosChecklists = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return okLocal(c) && (!fTurno || c.TURNO === fTurno); });
  const todasOcorrencias = readSheet_(SHEETS.OCORRENCIAS).filter(okLocal);
  const nomesMes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(dFim.getFullYear(), dFim.getMonth() - i, 1);
    meses.push({ chave: m.getFullYear() + '-' + m.getMonth(), rotulo: nomesMes[m.getMonth()] + '/' + String(m.getFullYear()).slice(2), realizados: 0, naoConformes: 0, reprovados: 0, ocorrencias: 0 });
  }
  const mesDe = function (data) { const d = toDate_(data); return d.getFullYear() + '-' + d.getMonth(); };
  const idxMes = {}; meses.forEach(function (m, i) { idxMes[m.chave] = i; });
  todosChecklists.forEach(function (c) {
    const i = idxMes[mesDe(dataOpChecklist_(c))]; if (i === undefined) return;
    meses[i].realizados++;
    if (c.RESULTADO === 'NAO_CONFORME') meses[i].naoConformes++;
    if (c.STATUS === 'REPROVADO') meses[i].reprovados++;
  });
  todasOcorrencias.forEach(function (o) { const i = idxMes[mesDe(o.DATA)]; if (i !== undefined) meses[i].ocorrencias++; });

  const enxuto = function (d) {
    const c = {}; Object.keys(d).forEach(function (k) { if (k !== 'registros') c[k] = d[k]; }); return c;
  };
  const statusValidacao = agruparContagem_(regs, 'STATUS');

  return {
    periodo: { dataInicial: dataInicial, dataFinal: dataFinal, dias: dias },
    periodoAnterior: { dataInicial: dateToBR_(antIni), dataFinal: dateToBR_(antFim) },
    geradoEm: nowDateStr_() + ' às ' + nowTimeStr_(),
    atual: enxuto(atual),
    anterior: enxuto(anterior),
    statusValidacao: statusValidacao,
    naoConformesPorAmbiente: agruparContagem_(naoConformes.map(function (r) { return { K: chaveAmb(r) }; }), 'K'),
    reprovadosPorAmbiente: agruparContagem_(regs.filter(function (r) { return r.STATUS === 'REPROVADO'; }).map(function (r) { return { K: chaveAmb(r) }; }), 'K'),
    motivosReprovacao: motivos,
    fotos: {
      total: regs.length,
      comFotoAntes: regs.filter(function (r) { return !!r.FOTO_ANTES; }).length,
      comFotoDepois: regs.filter(function (r) { return !!r.FOTO_DEPOIS; }).length,
      semEvidencia: regs.filter(function (r) { return !r.FOTO_ANTES && !r.FOTO_DEPOIS; }).length
    },
    ocorrencias: {
      total: ocorrencias.length,
      porStatus: agruparContagem_(ocorrencias, 'STATUS'),
      porLocal: agruparContagem_(ocorrencias, 'LOCAL'),
      porTurnoResponsavel: agruparContagem_(ocorrencias.filter(function (o) { return o.TURNO_RESPONSAVEL; }), 'TURNO_RESPONSAVEL'),
      entreTurnos: ocorrencias.filter(function (o) { return o.TURNO_RESPONSAVEL && o.TURNO && o.TURNO_RESPONSAVEL !== o.TURNO; }).length
    },
    ncQualidade: {
      total: ncsQualidade.length,
      porStatus: agruparContagem_(ncsQualidade, 'STATUS'),
      porAgente: agruparContagem_(ncsQualidade, 'AGENTE_RESPONSAVEL')
    },
    meses: meses,
    ambientesCriticos: ambientesCriticos
  };
}

// ======================= DASHBOARD — OCORRÊNCIAS =======================

function getDashboardOcorrencias_(params) {
  let rows = readSheet_(SHEETS.OCORRENCIAS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) rows = rows.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) rows = rows.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  if (params.dataInicial) { const tI = toDate_(params.dataInicial).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() >= tI; }); }
  if (params.dataFinal) { const tF = toDate_(params.dataFinal).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() <= tF; }); }

  // Uma ocorrência é "entre turnos" quando o turno de quem relatou é
  // diferente do turno responsável identificado (última limpeza no local).
  const entreTurnos = rows.filter(function (r) { return r.TURNO_RESPONSAVEL && r.TURNO && r.TURNO_RESPONSAVEL !== r.TURNO; });

  return {
    total: rows.length,
    pendentes: rows.filter(function (r) { return r.STATUS === 'ABERTA' || r.STATUS === 'EM_ANALISE'; }).length,
    validadas: rows.filter(function (r) { return r.STATUS === 'PROCEDENTE' || r.STATUS === 'NAO_PROCEDENTE' || r.STATUS === 'TRATADA' || r.STATUS === 'ENCERRADA'; }).length,
    procedentes: rows.filter(function (r) { return r.STATUS === 'PROCEDENTE' || r.STATUS === 'TRATADA' || r.STATUS === 'ENCERRADA'; }).length,
    naoProcedentes: rows.filter(function (r) { return r.STATUS === 'NAO_PROCEDENTE'; }).length,
    totalEntreTurnos: entreTurnos.length,
    porAgente: agruparContagem_(rows, 'AGENTE'),
    porLocal: agruparContagem_(rows, 'LOCAL'),
    porAmbiente: agruparContagem_(rows, 'AMBIENTE'),
    porTurno: agruparContagem_(rows, 'TURNO'),
    porTurnoAbertura: agruparContagem_(rows, 'TURNO'),
    porTurnoResponsavel: agruparContagem_(rows, 'TURNO_RESPONSAVEL'),
    porAgenteResponsavel: agruparContagem_(rows, 'AGENTE_RESPONSAVEL'),
    registrosEntreTurnos: entreTurnos,
    registros: rows
  };
}

// ======================= DASHBOARD — EVIDÊNCIAS FOTOGRÁFICAS =======================

function getDashboardFotos_(params) {
  let rows = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.dataInicial) { const tI = toDate_(params.dataInicial).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() >= tI; }); }
  if (params.dataFinal) { const tF = toDate_(params.dataFinal).getTime(); rows = rows.filter(function (r) { return toDate_(r.DATA).getTime() <= tF; }); }

  const comFotoAntes = rows.filter(function (r) { return !!r.FOTO_ANTES; }).length;
  const comFotoDepois = rows.filter(function (r) { return !!r.FOTO_DEPOIS; }).length;
  const semEvidencia = rows.filter(function (r) { return !r.FOTO_ANTES && !r.FOTO_DEPOIS; }).length;
  const validados = rows.filter(function (r) { return r.STATUS === 'APROVADO' || r.STATUS === 'REPROVADO'; });
  const aprovados = rows.filter(function (r) { return r.STATUS === 'APROVADO'; }).length;
  const reprovados = rows.filter(function (r) { return r.STATUS === 'REPROVADO'; }).length;

  return {
    total: rows.length,
    comFotoAntes: comFotoAntes,
    comFotoDepois: comFotoDepois,
    fotosPendentes: rows.filter(function (r) { return r.STATUS === 'PENDENTE_VALIDACAO'; }).length,
    fotosAprovadas: aprovados,
    fotosReprovadas: reprovados,
    semEvidencia: semEvidencia,
    percentualAprovacao: validados.length ? Math.round((aprovados / validados.length) * 1000) / 10 : 0,
    registros: rows.filter(function (r) { return r.FOTO_ANTES || r.FOTO_DEPOIS; })
  };
}

// ======================= UTIL =======================

function agruparContagem_(rows, campoChave) {
  const acc = {};
  rows.forEach(function (r) {
    const k = r[campoChave] || 'N/A';
    acc[k] = (acc[k] || 0) + 1;
  });
  return acc;
}

// Gera um PDF com cabeçalho e tabela a partir dos dados já filtrados pelo
// app. Usa um Google Doc como "motor" de formatação e depois converte para
// PDF, apagando o Doc temporário.
function gerarRelatorioPDF_(p) {
  const doc = DocumentApp.create('tmp_relatorio_' + new Date().getTime());
  const body = doc.getBody();
  body.clear();

  try {
    const logoBytes = Utilities.base64Decode(LOGO_ICC_BASE64);
    const logoBlob = Utilities.newBlob(logoBytes, 'image/png', 'logo.png');
    const logoImg = body.appendImage(logoBlob);
    logoImg.setWidth(70);
    logoImg.setHeight(70);
    logoImg.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  } catch (e) { /* se a logo falhar por algum motivo, segue sem ela */ }

  body.appendParagraph('ICC BRAZIL · CHECKLIST DA QUALIDADE').setHeading(DocumentApp.ParagraphHeading.TITLE).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(p.titulo || 'Relatório').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const infoTable = body.appendTable([
    ['Período', p.periodo || 'Todo o período'],
    ['Gerado em', nowDateStr_() + ' às ' + nowTimeStr_()],
    ['Total de registros', String((p.linhas || []).length)]
  ]);
  for (let i = 0; i < infoTable.getNumRows(); i++) {
    infoTable.getRow(i).getCell(0).editAsText().setBold(true);
  }
  body.appendParagraph('');

  const colunas = p.colunas || [];
  const chaves = p.chaves || [];
  const linhas = p.linhas || [];

  if (!linhas.length) {
    body.appendParagraph('Nenhum registro encontrado para os filtros selecionados.');
  } else {
    const tableData = [colunas].concat(linhas.map(function (linha) {
      return chaves.map(function (k) { return linha[k] === undefined || linha[k] === null ? '' : String(linha[k]); });
    }));
    const table = body.appendTable(tableData);
    const headerRow = table.getRow(0);
    for (let c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBackgroundColor('#436722');
      headerRow.getCell(c).editAsText().setForegroundColor('#ffffff').setBold(true).setFontSize(9);
    }
    for (let r = 1; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getRow(r).getNumCells(); c++) {
        table.getRow(r).getCell(c).editAsText().setFontSize(9);
      }
    }
  }

  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const pdfBlob = file.getAs('application/pdf');
  const base64 = Utilities.base64Encode(pdfBlob.getBytes());
  file.setTrashed(true);

  const nomeArquivo = 'relatorio_' + (p.titulo || 'dados').replace(/\s+/g, '_') + '.pdf';
  return { base64: base64, filename: nomeArquivo };
}