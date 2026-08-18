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
  SEQ: '_SEQ'
};

const HEADERS = {
  USUARIOS: ['ID_USUARIO', 'NOME', 'USUARIO', 'SENHA', 'PERFIL', 'ATIVO'],
  LOCAIS: ['ID_LOCAL', 'LOCAL', 'ATIVO'],
  AMBIENTES: ['ID_AMBIENTE', 'LOCAL', 'AMBIENTE', 'ATIVO'],
  TURNOS: ['ID_TURNO', 'TURNO', 'ATIVO'],
  ATIVIDADES: ['ID_ATIVIDADE', 'LOCAL', 'AMBIENTE', 'ATIVIDADE', 'PERIODICIDADE', 'TURNO', 'DIA_SEMANA', 'DIA_MES', 'FOTO_ANTES', 'FOTO_DEPOIS', 'VALIDACAO', 'ATIVO'],
  CHECKLISTS: ['ID_CHECKLIST', 'DATA', 'HORA', 'TURNO', 'LOCAL', 'AMBIENTE', 'ATIVIDADE', 'ID_ATIVIDADE', 'PERIODICIDADE', 'ID_AGENTE', 'AGENTE', 'RESULTADO', 'OBSERVACAO', 'FOTO_ANTES', 'FOTO_DEPOIS', 'STATUS', 'ADMIN_VALIDADOR', 'DATA_VALIDACAO', 'MOTIVO_REPROVACAO', 'OBS_VALIDACAO', 'REFAZER'],
  OCORRENCIAS: ['ID_OCORRENCIA', 'DATA', 'HORA', 'TURNO', 'ID_AGENTE', 'AGENTE', 'LOCAL', 'AMBIENTE', 'DESCRICAO', 'FOTO', 'STATUS', 'ADMIN_ANALISE', 'DATA_ANALISE', 'RESULTADO_ANALISE', 'OBSERVACAO_ANALISE'],
  _SEQ: ['PREFIXO', 'ULTIMO_NUMERO']
};

const FOLDER_NAME = 'ChecklistQualidade_Fotos';

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
    ['USR-001', 'Maria Silva', 'maria', '', 'AGENTE_LIMPEZA', 'SIM'],
    ['USR-002', 'João Souza', 'joao', '', 'AGENTE_LIMPEZA', 'SIM'],
    ['USR-003', 'Ana Qualidade', 'ana.admin', '1234', 'ADMIN_QUALIDADE', 'SIM']
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

  SpreadsheetApp.flush();
  return 'Planilha configurada com sucesso.';
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
  const readOnlyActions = ['getUsuarios', 'getLocais', 'getAmbientes', 'getTurnos',
    'getAtividades', 'getChecklists', 'getOcorrencias', 'getHistoricoAgente',
    'getPainelHoje', 'getDashboardChecklist', 'getDashboardOcorrencias',
    'getDashboardFotos', 'gerarRelatorioPDF'];

  if (!readOnlyActions.includes(action)) {
    lock.waitLock(10000);
  }
  try {
    switch (action) {
      case 'getUsuarios': return { ok: true, data: getUsuarios_() };
      case 'loginAdmin': return loginAdmin_(params);
      case 'getLocais': return { ok: true, data: getLocais_() };
      case 'getAmbientes': return { ok: true, data: getAmbientes_(params.local) };
      case 'getTurnos': return { ok: true, data: getTurnos_() };
      case 'getAtividades': return { ok: true, data: getAtividades_(params) };

      case 'createChecklist': return criarChecklist_(params);
      case 'getChecklists': return { ok: true, data: getChecklists_(params) };
      case 'validarChecklist': return validarChecklist_(params);

      case 'createOcorrencia': return criarOcorrencia_(params);
      case 'getOcorrencias': return { ok: true, data: getOcorrencias_(params) };
      case 'validarOcorrencia': return validarOcorrencia_(params);
      case 'atualizarStatusOcorrencia': return atualizarStatusOcorrencia_(params);

      case 'getHistoricoAgente': return { ok: true, data: getHistoricoAgente_(params.idAgente) };

      case 'getPainelHoje': return { ok: true, data: getPainelHoje_(params) };
      case 'getDashboardChecklist': return { ok: true, data: getDashboardChecklist_(params) };
      case 'getDashboardOcorrencias': return { ok: true, data: getDashboardOcorrencias_(params) };
      case 'getDashboardFotos': return { ok: true, data: getDashboardFotos_(params) };
      case 'gerarRelatorioPDF': return { ok: true, data: gerarRelatorioPDF_(params) };

      default: return { ok: false, error: 'Ação desconhecida: ' + action };
    }
  } finally {
    if (!readOnlyActions.includes(action)) lock.releaseLock();
  }
}

// ======================= HELPERS DE PLANILHA =======================

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function readSheet_(name) {
  const sh = sheet_(name);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const rows = range.slice(1);
  const tz = Session.getScriptTimeZone() || 'GMT-3';
  return rows
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
}

function appendRow_(sheetName, rowObj) {
  const sh = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const row = headers.map(function (h) { return rowObj[h] !== undefined ? rowObj[h] : ''; });
  sh.appendRow(row);
}

function updateRowById_(sheetName, idColumn, idValue, updates) {
  const sh = sheet_(sheetName);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const idIdx = headers.indexOf(idColumn);
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][idIdx]) === String(idValue)) {
      Object.keys(updates).forEach(function (key) {
        const colIdx = headers.indexOf(key);
        if (colIdx > -1) {
          sh.getRange(i + 1, colIdx + 1).setValue(updates[key]);
        }
      });
      return true;
    }
  }
  return false;
}

function findRowById_(sheetName, idColumn, idValue) {
  const rows = readSheet_(sheetName);
  return rows.find(function (r) { return String(r[idColumn]) === String(idValue); }) || null;
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

  let folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
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
    return { ID_USUARIO: u.ID_USUARIO, NOME: u.NOME, USUARIO: u.USUARIO, PERFIL: u.PERFIL };
    // SENHA nunca é enviada ao frontend
  });
}

function loginAdmin_(params) {
  const usuarios = readSheet_(SHEETS.USUARIOS);
  const usuario = usuarios.find(function (u) {
    return String(u.ID_USUARIO) === String(params.idUsuario) && String(u.ATIVO).toUpperCase() === 'SIM';
  });
  if (!usuario) return { ok: false, error: 'Usuário não encontrado.' };
  if (String(usuario.SENHA) !== String(params.senha)) return { ok: false, error: 'Senha incorreta.' };
  return { ok: true, data: { ID_USUARIO: usuario.ID_USUARIO, NOME: usuario.NOME, PERFIL: usuario.PERFIL } };
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

// Retorna as atividades cadastradas para local+ambiente+periodicidade,
// aplicáveis ao turno informado (TURNO em branco na config = vale p/ todos).
function getAtividades_(params) {
  return readSheet_(SHEETS.ATIVIDADES).filter(function (a) {
    const ativo = String(a.ATIVO).toUpperCase() === 'SIM';
    const okLocal = a.LOCAL === params.local;
    const okAmbiente = a.AMBIENTE === params.ambiente;
    const okPeriodicidade = a.PERIODICIDADE === params.periodicidade;
    const okTurno = !a.TURNO || a.TURNO === params.turno;
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
  return false;
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
      const turnosDaAtividade = a.TURNO ? [a.TURNO] : (filtros.turnosDisponiveis || ['']);
      turnosDaAtividade.forEach(function (turno) {
        if (filtros.turno && turno !== filtros.turno) return;
        previstos.push({
          data: dateToBR_(cursor),
          idAtividade: a.ID_ATIVIDADE,
          local: a.LOCAL,
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
  const idsGerados = [];
  (p.itens || []).forEach(function (item) {
    const idChecklist = nextId_('CHK');
    const fotoAntes = salvarFoto_(item.fotoAntes, idChecklist + '_antes');
    const fotoDepois = salvarFoto_(item.fotoDepois, idChecklist + '_depois');
    const precisaValidacao = String(item.validacao).toUpperCase() === 'SIM';
    appendRow_(SHEETS.CHECKLISTS, {
      ID_CHECKLIST: idChecklist,
      DATA: nowDateStr_(),
      HORA: nowTimeStr_(),
      TURNO: p.turno,
      LOCAL: p.local,
      AMBIENTE: p.ambiente,
      ATIVIDADE: item.atividade,
      ID_ATIVIDADE: item.idAtividade || '',
      PERIODICIDADE: p.periodicidade,
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
      REFAZER: ''
    });
    idsGerados.push(idChecklist);
  });
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
  if (params.dataInicial) rows = rows.filter(function (r) { return toDate_(r.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) rows = rows.filter(function (r) { return toDate_(r.DATA) <= toDate_(params.dataFinal); });
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

// ======================= OCORRÊNCIAS =======================

function criarOcorrencia_(p) {
  const idOcorrencia = nextId_('OCO');
  const foto = salvarFoto_(p.foto, idOcorrencia);
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
    OBSERVACAO_ANALISE: ''
  });
  return { ok: true, data: { idOcorrencia: idOcorrencia } };
}

function getOcorrencias_(params) {
  let rows = readSheet_(SHEETS.OCORRENCIAS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) rows = rows.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) rows = rows.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  if (params.status) rows = rows.filter(function (r) { return r.STATUS === params.status; });
  if (params.dataInicial) rows = rows.filter(function (r) { return toDate_(r.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) rows = rows.filter(function (r) { return toDate_(r.DATA) <= toDate_(params.dataFinal); });
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

// ======================= HISTÓRICO =======================

function getHistoricoAgente_(idAgente) {
  const checklists = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return String(c.ID_AGENTE) === String(idAgente); });
  const ocorrencias = readSheet_(SHEETS.OCORRENCIAS).filter(function (o) { return String(o.ID_AGENTE) === String(idAgente); });
  return {
    checklists: checklists.sort(function (a, b) { return b.ID_CHECKLIST.localeCompare(a.ID_CHECKLIST); }),
    ocorrencias: ocorrencias.sort(function (a, b) { return b.ID_OCORRENCIA.localeCompare(a.ID_OCORRENCIA); })
  };
}

// ======================= PAINEL DO DIA =======================

// Para cada Local+Ambiente com atividade DIÁRIA prevista hoje, mostra se já
// foi realizada — visão rápida do admin sobre o que está em atraso agora.
function getPainelHoje_(params) {
  const hoje = new Date();
  const hojeStr = dateToBR_(hoje);
  const turnos = getTurnos_().map(function (t) { return t.TURNO; });

  const previstos = calcularPrevistos_(hoje, hoje, { turnosDisponiveis: turnos, local: params.local, ambiente: params.ambiente });
  const checklistsHoje = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return c.DATA === hojeStr; });

  const itens = previstos.map(function (prev) {
    const feito = checklistsHoje.find(function (c) {
      return c.ID_ATIVIDADE === prev.idAtividade && (!prev.turno || c.TURNO === prev.turno);
    });
    return {
      local: prev.local,
      ambiente: prev.ambiente,
      atividade: prev.atividade,
      turno: prev.turno,
      realizado: !!feito,
      status: feito ? feito.STATUS : 'PENDENTE',
      hora: feito ? feito.HORA : ''
    };
  });

  return {
    data: hojeStr,
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
  realizados = realizados.filter(function (r) { return toDate_(r.DATA) >= toDate_(dataInicial) && toDate_(r.DATA) <= toDate_(dataFinal); });

  // Para cada "previsto" (data+atividade+turno), pega a execução mais
  // recente daquele dia (pode haver mais de uma se foi reprovado e refeito).
  const hojeStr = dateToBR_(new Date());
  let realizadosCount = 0, pendentesCount = 0, atrasadosCount = 0, aprovadosCount = 0, reprovadosCount = 0;

  previstos.forEach(function (prev) {
    const execs = realizados.filter(function (r) {
      return r.ID_ATIVIDADE === prev.idAtividade && r.DATA === prev.data && (!prev.turno || r.TURNO === prev.turno);
    });
    if (execs.length) {
      realizadosCount++;
      const ultima = execs[execs.length - 1];
      if (ultima.STATUS === 'APROVADO') aprovadosCount++;
      if (ultima.STATUS === 'REPROVADO') reprovadosCount++;
    } else if (prev.data === hojeStr) {
      pendentesCount++;
    } else if (toDate_(prev.data) < toDate_(hojeStr)) {
      atrasadosCount++;
    }
  });

  const naoConformidades = realizados.filter(function (r) { return r.RESULTADO === 'NAO_CONFORME'; }).length;
  const ocorrenciasNoPeriodo = readSheet_(SHEETS.OCORRENCIAS).filter(function (o) {
    const okLocal = !params.local || o.LOCAL === params.local;
    const okAmbiente = !params.ambiente || o.AMBIENTE === params.ambiente;
    const okTurno = !params.turno || o.TURNO === params.turno;
    return okLocal && okAmbiente && okTurno && toDate_(o.DATA) >= toDate_(dataInicial) && toDate_(o.DATA) <= toDate_(dataFinal);
  });

  const totalPrevisto = previstos.length;
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
    porAgente: agruparContagem_(realizados, 'AGENTE'),
    porLocal: agruparContagem_(realizados, 'LOCAL'),
    porAmbiente: agruparContagem_(realizados, 'AMBIENTE'),
    porTurno: agruparContagem_(realizados, 'TURNO'),
    ocorrenciasPorAgente: agruparContagem_(ocorrenciasNoPeriodo, 'AGENTE'),
    ocorrenciasPorLocal: agruparContagem_(ocorrenciasNoPeriodo, 'LOCAL'),
    ocorrenciasPorAmbiente: agruparContagem_(ocorrenciasNoPeriodo, 'AMBIENTE'),
    ocorrenciasPorTurno: agruparContagem_(ocorrenciasNoPeriodo, 'TURNO'),
    registros: realizados
  };
}

// ======================= DASHBOARD — OCORRÊNCIAS =======================

function getDashboardOcorrencias_(params) {
  let rows = readSheet_(SHEETS.OCORRENCIAS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.turno) rows = rows.filter(function (r) { return r.TURNO === params.turno; });
  if (params.idAgente) rows = rows.filter(function (r) { return String(r.ID_AGENTE) === String(params.idAgente); });
  if (params.dataInicial) rows = rows.filter(function (r) { return toDate_(r.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) rows = rows.filter(function (r) { return toDate_(r.DATA) <= toDate_(params.dataFinal); });

  return {
    total: rows.length,
    pendentes: rows.filter(function (r) { return r.STATUS === 'ABERTA' || r.STATUS === 'EM_ANALISE'; }).length,
    validadas: rows.filter(function (r) { return r.STATUS === 'PROCEDENTE' || r.STATUS === 'NAO_PROCEDENTE' || r.STATUS === 'TRATADA' || r.STATUS === 'ENCERRADA'; }).length,
    procedentes: rows.filter(function (r) { return r.STATUS === 'PROCEDENTE' || r.STATUS === 'TRATADA' || r.STATUS === 'ENCERRADA'; }).length,
    naoProcedentes: rows.filter(function (r) { return r.STATUS === 'NAO_PROCEDENTE'; }).length,
    porAgente: agruparContagem_(rows, 'AGENTE'),
    porLocal: agruparContagem_(rows, 'LOCAL'),
    porAmbiente: agruparContagem_(rows, 'AMBIENTE'),
    porTurno: agruparContagem_(rows, 'TURNO'),
    registros: rows
  };
}

// ======================= DASHBOARD — EVIDÊNCIAS FOTOGRÁFICAS =======================

function getDashboardFotos_(params) {
  let rows = readSheet_(SHEETS.CHECKLISTS);
  if (params.local) rows = rows.filter(function (r) { return r.LOCAL === params.local; });
  if (params.ambiente) rows = rows.filter(function (r) { return r.AMBIENTE === params.ambiente; });
  if (params.dataInicial) rows = rows.filter(function (r) { return toDate_(r.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) rows = rows.filter(function (r) { return toDate_(r.DATA) <= toDate_(params.dataFinal); });

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
