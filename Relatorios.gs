/**
 * CHECKLIST DA QUALIDADE — RELATÓRIOS AUTOMÁTICOS POR E-MAIL
 * ---------------------------------------------------------
 * Arquivo SEPARADO do Code.gs (no editor do Apps Script: "+" > Script >
 * nome "Relatorios"). Não altera nada do app: só lê a planilha e envia
 * e-mails.
 *
 * O QUE FAZ
 *  - Toda SEGUNDA-FEIRA (~07h): resumo geral da semana passada
 *    (segunda a domingo).
 *  - Todo PRIMEIRO DIA ÚTIL do mês (~07h): relatório geral do mês passado.
 *    Dia útil = segunda a sexta, fora feriados nacionais, Carnaval,
 *    Sexta-feira Santa, Corpus Christi e datas da aba opcional FERIADOS
 *    (coluna A, uma data por linha, dd/mm/aaaa).
 *
 * DESTINATÁRIOS
 *  - Aba USUARIOS, coluna com cabeçalho "EMAILS" (ou EMAIL / E-MAIL).
 *    Se não achar pelo nome, usa a coluna I.
 *  - Pode colocar mais de um e-mail na mesma célula, separados por ; ou ,
 *  - Usuário com ATIVO = NAO não recebe.
 *  - Cada pessoa recebe o relatório da UNIDADE dela (coluna UNIDADE).
 *    Quem tem UNIDADE = TODAS recebe o relatório UNIFICADO, comparando as
 *    unidades lado a lado.
 *
 * COMO LIGAR (uma vez só)
 *  1. Selecione a função `instalarRelatoriosAutomaticos` e clique Executar.
 *  2. Autorize o envio de e-mail quando o Google pedir.
 *  Para testar: `enviarTesteRelatorioSemanal` / `enviarTesteRelatorioMensal`
 *  (unificado) e `enviarTesteRelatorioMensalPorUnidade` (um por unidade) —
 *  todos mandam só para VOCÊ, dono do script.
 *  Para desligar: `desinstalarRelatoriosAutomaticos`.
 *
 * Cada envio fica registrado na aba LOG_RELATORIOS (criada sozinha).
 */

var REL_HANDLER = 'disparoRelatoriosAutomaticos';
var REL_HORA_ENVIO = 7; // 07h: depois do fim do 3º turno (06:00)
var REL_APP_URL = 'https://lucasgomes-droid.github.io/Checklist-Qualidade/';
var REL_ABA_LOG = 'LOG_RELATORIOS';
var REL_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ======================= FUNÇÕES PARA RODAR NO EDITOR =======================

function instalarRelatoriosAutomaticos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === REL_HANDLER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(REL_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(REL_HORA_ENVIO)
    .inTimezone(rel_tz_())
    .create();
  // Força o pedido de autorização de e-mail agora (não envia nada).
  MailApp.getRemainingDailyQuota();
  const msg = 'Relatórios automáticos LIGADOS. Envio diário verificado às ' + REL_HORA_ENVIO + 'h (' + rel_tz_() + '). ' + rel_textoDestinatarios_();
  Logger.log(msg);
  return msg;
}

function desinstalarRelatoriosAutomaticos() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === REL_HANDLER) { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Relatórios automáticos DESLIGADOS (' + n + ' agendamento(s) removido(s)).');
}

function enviarTesteRelatorioSemanal() {
  rel_enviarUnificado_('SEMANAL', rel_periodoSemanaPassada_(rel_hoje_()), [Session.getEffectiveUser().getEmail()], true);
}

function enviarTesteRelatorioMensal() {
  rel_enviarUnificado_('MENSAL', rel_periodoMesPassado_(rel_hoje_()), [Session.getEffectiveUser().getEmail()], true);
}

// Um e-mail por unidade, como cada unidade recebe (só para você).
function enviarTesteRelatorioMensalPorUnidade() {
  const p = rel_periodoMesPassado_(rel_hoje_());
  unidadesCadastradas_().forEach(function (u) {
    rel_enviar_('MENSAL', p, [Session.getEffectiveUser().getEmail()], true, u);
  });
}

// Mostra no "Registro de execução" quem vai receber (lido da coluna EMAILS).
function verDestinatariosRelatorios() {
  const msg = rel_textoDestinatarios_();
  Logger.log(msg);
  return msg;
}

function rel_textoDestinatarios_() {
  const g = rel_destinatariosPorUnidade_();
  const partes = Object.keys(g).map(function (k) {
    return (k === 'TODAS' ? 'Unificado (TODAS)' : k) + ': ' + g[k].join(', ');
  });
  return partes.length ? 'Destinatários → ' + partes.join(' | ')
    : 'NINGUÉM — a coluna EMAILS da aba USUARIOS está vazia (ou o usuário está com ATIVO = NAO).';
}

// Envia AGORA para todos da coluna EMAILS (não é teste).
// Marca como enviado, para o automático não mandar de novo o mesmo período.
function enviarAgoraRelatorioMensalParaTodos() {
  rel_enviarParaTodosAgora_('MENSAL', rel_periodoMesPassado_(rel_hoje_()));
}

function enviarAgoraRelatorioSemanalParaTodos() {
  rel_enviarParaTodosAgora_('SEMANAL', rel_periodoSemanaPassada_(rel_hoje_()));
}

function rel_enviarParaTodosAgora_(tipo, periodo) {
  if (!rel_destinatarios_().length) throw new Error('Nenhum e-mail na coluna EMAILS da aba USUARIOS.');
  rel_distribuir_(tipo, periodo, true);
  Logger.log(tipo + ' (' + periodo.rotulo + ') enviado. ' + rel_textoDestinatarios_());
}

// ======================= DISPARO DIÁRIO (gatilho) =======================

function disparoRelatoriosAutomaticos() {
  const hoje = rel_hoje_();
  if (hoje.getDay() === 1) {
    rel_distribuir_('SEMANAL', rel_periodoSemanaPassada_(hoje), false);
  }
  if (rel_mesmoDia_(hoje, rel_primeiroDiaUtil_(hoje.getFullYear(), hoje.getMonth()))) {
    rel_distribuir_('MENSAL', rel_periodoMesPassado_(hoje), false);
  }
}

// Manda para cada grupo de destinatários o relatório certo: o da unidade
// para quem é de uma unidade, o unificado para quem é TODAS. Cada envio
// (tipo + unidade + período) é marcado para nunca sair duas vezes.
// forcar = envia mesmo se já tinha saído (botão "enviar agora").
function rel_distribuir_(tipo, periodo, forcar) {
  const props = PropertiesService.getScriptProperties();
  const grupos = rel_destinatariosPorUnidade_();
  if (!Object.keys(grupos).length) {
    rel_log_(tipo, periodo, '', 'SEM DESTINATÁRIOS', 'Preencha a coluna EMAILS da aba USUARIOS.');
    return;
  }
  Object.keys(grupos).forEach(function (grupo) {
    const chave = 'REL_' + tipo + '_' + normUnid_(grupo) + '_' + periodo.chave;
    if (!forcar && props.getProperty(chave)) return; // já enviado
    try {
      if (grupo === 'TODAS') rel_enviarUnificado_(tipo, periodo, grupos[grupo], false);
      else rel_enviar_(tipo, periodo, grupos[grupo], false, grupo);
      props.setProperty(chave, new Date().toISOString());
    } catch (e) {
      Logger.log('Falha no envio ' + grupo + ': ' + e); // já registrado no log; segue com os outros grupos
    }
  });
}

function rel_mandar_(destinatarios, assunto, texto, html) {
  const opcoes = { name: 'Checklist da Qualidade', htmlBody: html };
  const logo = rel_logoBlob_();
  if (logo) opcoes.inlineImages = { logoicc: logo };
  MailApp.sendEmail(destinatarios.join(','), assunto, texto, opcoes);
}

// Relatório de UMA unidade.
function rel_enviar_(tipo, periodo, destinatarios, teste, unidade) {
  unidade = unidade || UNIDADE_PADRAO_;
  const rotuloLog = tipo + (teste ? ' (teste)' : '') + ' · ' + unidade;
  try {
    definirUnidadeContexto_(unidade);
    const dados = rel_coletar_(periodo);
    dados.unidade = unidade;
    const assunto = (teste ? '[TESTE] ' : '') + 'Checklist da Qualidade · ' + unidade + ' — ' +
      (tipo === 'SEMANAL' ? 'Resumo semanal · ' : 'Relatório mensal · ') + periodo.rotulo;
    rel_mandar_(destinatarios, assunto, rel_texto_(tipo, periodo, dados), rel_html_(tipo, periodo, dados));
    rel_log_(rotuloLog, periodo, destinatarios.join(', '), 'ENVIADO', '');
  } catch (err) {
    rel_log_(rotuloLog, periodo, destinatarios.join(', '), 'ERRO', String(err && err.message || err));
    throw err;
  }
}

// Relatório UNIFICADO (todas as unidades, comparadas lado a lado).
function rel_enviarUnificado_(tipo, periodo, destinatarios, teste) {
  const rotuloLog = tipo + (teste ? ' (teste)' : '') + ' · Unificado';
  try {
    const dados = rel_coletarUnificado_(periodo);
    const assunto = (teste ? '[TESTE] ' : '') + 'Checklist da Qualidade · Todas as unidades — ' +
      (tipo === 'SEMANAL' ? 'Resumo semanal · ' : 'Relatório mensal · ') + periodo.rotulo;
    rel_mandar_(destinatarios, assunto, rel_textoUnificado_(tipo, periodo, dados), rel_htmlUnificado_(tipo, periodo, dados));
    rel_log_(rotuloLog, periodo, destinatarios.join(', '), 'ENVIADO', '');
  } catch (err) {
    rel_log_(rotuloLog, periodo, destinatarios.join(', '), 'ERRO', String(err && err.message || err));
    throw err;
  }
}

// ======================= DATAS =======================

function rel_tz_() { return Session.getScriptTimeZone() || 'America/Sao_Paulo'; }

function rel_hoje_() {
  const s = Utilities.formatDate(new Date(), rel_tz_(), 'yyyy-MM-dd').split('-');
  return new Date(+s[0], +s[1] - 1, +s[2]);
}

function rel_br_(d) {
  const p = function (n) { return String(n).padStart(2, '0'); };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

function rel_parseBR_(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v || '').trim().split(' ')[0];
  const p = s.split('/');
  if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
  const iso = s.split('-');
  if (iso.length === 3) return new Date(+iso[0], +iso[1] - 1, +iso[2]);
  return null;
}

function rel_addDias_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function rel_mesmoDia_(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

function rel_periodoSemanaPassada_(hoje) {
  // Segunda a domingo da semana anterior à semana de "hoje".
  const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
  const ini = rel_addDias_(hoje, -dow - 7);
  const fim = rel_addDias_(ini, 6);
  const antIni = rel_addDias_(ini, -7), antFim = rel_addDias_(fim, -7);
  return {
    ini: ini, fim: fim, antIni: antIni, antFim: antFim,
    rotulo: rel_br_(ini).slice(0, 5) + ' a ' + rel_br_(fim),
    rotuloAnterior: 'semana anterior (' + rel_br_(antIni).slice(0, 5) + ' a ' + rel_br_(antFim).slice(0, 5) + ')',
    chave: rel_br_(ini)
  };
}

function rel_periodoMesPassado_(hoje) {
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  const antIni = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
  const antFim = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 0);
  return {
    ini: ini, fim: fim, antIni: antIni, antFim: antFim,
    rotulo: REL_MESES[ini.getMonth()] + '/' + ini.getFullYear(),
    rotuloAnterior: REL_MESES[antIni.getMonth()].toLowerCase() + '/' + antIni.getFullYear(),
    chave: (ini.getMonth() + 1) + '/' + ini.getFullYear()
  };
}

function rel_pascoa_(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function rel_feriados_(ano) {
  const fixos = ['01/01', '21/04', '01/05', '07/09', '12/10', '02/11', '15/11', '20/11', '25/12'];
  const lista = fixos.map(function (dm) { return dm + '/' + ano; });
  const pascoa = rel_pascoa_(ano);
  [-48, -47, -2, 60].forEach(function (n) { lista.push(rel_br_(rel_addDias_(pascoa, n))); }); // Carnaval (seg/ter), Sexta Santa, Corpus Christi
  // Aba opcional FERIADOS (coluna A) para feriados municipais/emendas.
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('FERIADOS');
  if (sh && sh.getLastRow() >= 1) {
    sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach(function (r) {
      const d = rel_parseBR_(r[0]);
      if (d && !isNaN(d.getTime())) lista.push(rel_br_(d));
    });
  }
  return lista;
}

function rel_primeiroDiaUtil_(ano, mes) {
  const feriados = rel_feriados_(ano);
  let d = new Date(ano, mes, 1);
  while (d.getDay() === 0 || d.getDay() === 6 || feriados.indexOf(rel_br_(d)) >= 0) d = rel_addDias_(d, 1);
  return d;
}

// ======================= PLANILHA =======================

function rel_norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

// { 'Macatuba': [...], 'Jundiaí I': [...], 'TODAS': [...] } — só grupos com e-mail.
function rel_destinatariosPorUnidade_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USUARIOS');
  if (!sh || sh.getLastRow() < 2) return {};
  const vals = sh.getDataRange().getDisplayValues();
  const head = vals[0].map(rel_norm_);
  let colEmail = -1;
  ['EMAILS', 'EMAIL', 'E-MAIL', 'E-MAILS'].forEach(function (n) { if (colEmail < 0) colEmail = head.indexOf(n); });
  if (colEmail < 0) colEmail = 8; // coluna I
  const colAtivo = head.indexOf('ATIVO');
  const colUnid = head.indexOf('UNIDADE');
  const grupos = {};
  const vistos = {};
  vals.slice(1).forEach(function (r) {
    if (colAtivo >= 0 && ['NAO', 'N', 'INATIVO', 'FALSE', 'FALSO'].indexOf(rel_norm_(r[colAtivo])) >= 0) return;
    const bruto = colUnid >= 0 ? r[colUnid] : '';
    const unid = resolverUnidade_(bruto || UNIDADE_PADRAO_) || UNIDADE_PADRAO_;
    String(r[colEmail] || '').split(/[;,\s]+/).forEach(function (e) {
      e = e.trim().toLowerCase();
      const k = unid + '|' + e;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !vistos[k]) {
        vistos[k] = true;
        (grupos[unid] = grupos[unid] || []).push(e);
      }
    });
  });
  return grupos;
}

function rel_destinatarios_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USUARIOS');
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getDisplayValues();
  const head = vals[0].map(rel_norm_);
  let colEmail = -1;
  ['EMAILS', 'EMAIL', 'E-MAIL', 'E-MAILS'].forEach(function (n) { if (colEmail < 0) colEmail = head.indexOf(n); });
  if (colEmail < 0) colEmail = 8; // coluna I
  let colAtivo = head.indexOf('ATIVO');
  if (colAtivo < 0) colAtivo = head.indexOf('STATUS');
  const vistos = {};
  const lista = [];
  vals.slice(1).forEach(function (r) {
    if (colAtivo >= 0 && ['NAO', 'N', 'INATIVO', 'FALSE', 'FALSO'].indexOf(rel_norm_(r[colAtivo])) >= 0) return;
    String(r[colEmail] || '').split(/[;,\s]+/).forEach(function (e) {
      e = e.trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !vistos[e]) { vistos[e] = true; lista.push(e); }
    });
  });
  return lista;
}

function rel_log_(tipo, periodo, dest, status, detalhe) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(REL_ABA_LOG);
    if (!sh) {
      sh = ss.insertSheet(REL_ABA_LOG);
      sh.appendRow(['DATA_HORA', 'TIPO', 'PERIODO', 'DESTINATARIOS', 'STATUS', 'DETALHE']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([Utilities.formatDate(new Date(), rel_tz_(), 'dd/MM/yyyy HH:mm'), tipo, periodo.rotulo, dest, status, detalhe]);
  } catch (e) { Logger.log('Falha ao registrar log: ' + e); }
}

function rel_logoBlob_() {
  try {
    if (typeof LOGO_ICC_BASE64 === 'undefined' || !LOGO_ICC_BASE64) return null;
    return Utilities.newBlob(Utilities.base64Decode(LOGO_ICC_BASE64), 'image/png', 'logo.png');
  } catch (e) { return null; }
}

// ======================= COLETA DOS NÚMEROS =======================

// Usa as MESMAS funções dos dashboards do app (getDashboardChecklist_ e
// getDashboardOcorrencias_ do Code.gs), para os números do e-mail baterem
// com o que aparece na tela. Se algo falhar, calcula direto da planilha.
function rel_resumoChecklist_(ini, fim) {
  const ini_ = rel_br_(ini), fim_ = rel_br_(fim);
  let d = null;
  try {
    if (typeof getDashboardChecklist_ === 'function') d = getDashboardChecklist_({ dataInicial: ini_, dataFinal: fim_ });
  } catch (e) { Logger.log('getDashboardChecklist_ falhou: ' + e); d = null; }

  const noPeriodo = rel_lerAba_('CHECKLISTS').filter(function (c) {
    const dt = rel_parseBR_(c.DATA_OPERACIONAL || c.DATA);
    return dt && dt >= ini && dt <= fim;
  });
  const registros = (d && d.registros) || noPeriodo;

  if (!d) {
    const aprov = registros.filter(function (r) { return r.STATUS === 'APROVADO'; }).length;
    const repr = registros.filter(function (r) { return r.STATUS === 'REPROVADO'; }).length;
    d = {
      totalPrevisto: null, realizados: registros.length, atrasados: null,
      aprovados: aprov, reprovados: repr, percentualCumprimento: null,
      percentualAprovacao: (aprov + repr) ? Math.round(aprov / (aprov + repr) * 1000) / 10 : 0,
      naoConformidades: registros.filter(function (r) { return r.RESULTADO === 'NAO_CONFORME'; }).length
    };
  }
  d.registros = registros;
  d.aguardandoValidacao = registros.filter(function (r) { return r.STATUS === 'PENDENTE_VALIDACAO'; }).length;
  return d;
}

function rel_resumoOcorrencias_(ini, fim) {
  const ini_ = rel_br_(ini), fim_ = rel_br_(fim);
  try {
    if (typeof getDashboardOcorrencias_ === 'function') {
      const o = getDashboardOcorrencias_({ dataInicial: ini_, dataFinal: fim_ });
      if (o && o.registros) return o;
    }
  } catch (e) { Logger.log('getDashboardOcorrencias_ falhou: ' + e); }
  const rows = rel_lerAba_('OCORRENCIAS').filter(function (r) {
    const dt = rel_parseBR_(r.DATA);
    return dt && dt >= ini && dt <= fim;
  });
  return {
    total: rows.length,
    pendentes: rows.filter(function (r) { return r.STATUS === 'ABERTA' || r.STATUS === 'EM_ANALISE'; }).length,
    procedentes: rows.filter(function (r) { return ['PROCEDENTE', 'TRATADA', 'ENCERRADA'].indexOf(r.STATUS) >= 0; }).length,
    naoProcedentes: rows.filter(function (r) { return r.STATUS === 'NAO_PROCEDENTE'; }).length,
    registros: rows
  };
}

// Lê a aba já filtrada pela unidade do contexto (readSheet_ do Code.gs).
function rel_lerAba_(nome) {
  return readSheet_(nome);
}

function rel_coletar_(p) {
  const chk = rel_resumoChecklist_(p.ini, p.fim);
  const chkAnt = rel_resumoChecklist_(p.antIni, p.antFim);
  const oco = rel_resumoOcorrencias_(p.ini, p.fim);
  const ocoAnt = rel_resumoOcorrencias_(p.antIni, p.antFim);

  const ncs = rel_lerAba_('NAO_CONFORMIDADES');
  const ncPeriodo = ncs.filter(function (n) { const dt = rel_parseBR_(n.DATA); return dt && dt >= p.ini && dt <= p.fim; });

  // Quebras por local / agente / turno (a partir dos checklists do período)
  const porLocal = {}, porAgente = {}, porTurno = {};
  function soma(map, k, r) {
    k = k || 'Não informado';
    if (!map[k]) map[k] = { realizados: 0, aprovados: 0, reprovados: 0, nc: 0, ocorrencias: 0 };
    if (r) {
      map[k].realizados++;
      if (r.STATUS === 'APROVADO') map[k].aprovados++;
      if (r.STATUS === 'REPROVADO') map[k].reprovados++;
      if (r.RESULTADO === 'NAO_CONFORME') map[k].nc++;
    }
    return map[k];
  }
  chk.registros.forEach(function (r) {
    soma(porLocal, r.LOCAL, r); soma(porAgente, r.AGENTE, r); soma(porTurno, r.TURNO, r);
  });
  oco.registros.forEach(function (o) {
    soma(porLocal, o.LOCAL).ocorrencias++;
    soma(porAgente, o.AGENTE).ocorrencias++;
  });

  const reprovacoes = chk.registros.filter(function (r) { return r.STATUS === 'REPROVADO'; }).slice(0, 10);

  // Pendências em aberto AGORA (independente do período)
  const todosChk = rel_lerAba_('CHECKLISTS');
  const fila = todosChk.filter(function (r) { return r.STATUS === 'PENDENTE_VALIDACAO'; });
  let maisAntiga = null;
  fila.forEach(function (r) { const dt = rel_parseBR_(r.DATA); if (dt && (!maisAntiga || dt < maisAntiga)) maisAntiga = dt; });
  const ocoAbertas = rel_lerAba_('OCORRENCIAS').filter(function (o) { return o.STATUS === 'ABERTA' || o.STATUS === 'EM_ANALISE'; }).length;
  const ncAbertas = ncs.filter(function (n) { return n.STATUS === 'ABERTA' || n.STATUS === 'AGUARDANDO_VALIDACAO'; }).length;

  return {
    chk: chk, chkAnt: chkAnt, oco: oco, ocoAnt: ocoAnt, ncPeriodo: ncPeriodo.length,
    porLocal: porLocal, porAgente: porAgente, porTurno: porTurno, reprovacoes: reprovacoes,
    agora: { filaValidacao: fila.length, filaMaisAntiga: maisAntiga, ocorrenciasAbertas: ocoAbertas, ncAbertas: ncAbertas },
    topAmbientes: rel_top_(oco.registros, function (o) { return (o.LOCAL || '') + ' · ' + (o.AMBIENTE || ''); }, 5)
  };
}

function rel_top_(rows, chaveFn, n) {
  const acc = {};
  rows.forEach(function (r) { const k = chaveFn(r); acc[k] = (acc[k] || 0) + 1; });
  return Object.keys(acc).map(function (k) { return { nome: k, qtd: acc[k] }; })
    .sort(function (a, b) { return b.qtd - a.qtd; }).slice(0, n);
}

// ======================= E-MAIL (HTML) =======================

var REL_COR = { ink: '#171b1e', soft: '#495057', paper: '#f4f5f3', line: '#dfe3e1', brand: '#3f4448', accent: '#5e9030', risco: '#d64545', alerta: '#df8630' };

function rel_esc_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function rel_num_(n) { return n === null || n === undefined ? '—' : String(n).replace('.', ','); }
function rel_pct_(n) { return n === null || n === undefined ? '—' : rel_num_(n) + '%'; }

// melhorSobe: true quando subir é bom (cumprimento, aprovação)
function rel_delta_(atual, anterior, melhorSobe, sufixo) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return '';
  const diff = Math.round((atual - anterior) * 10) / 10;
  if (diff === 0) return '<div style="font-size:11px;color:' + REL_COR.soft + '">= igual ao anterior</div>';
  const bom = melhorSobe ? diff > 0 : diff < 0;
  return '<div style="font-size:11px;color:' + (bom ? REL_COR.accent : REL_COR.risco) + '">' +
    (diff > 0 ? '▲ +' : '▼ ') + rel_num_(diff) + (sufixo || '') + ' vs anterior</div>';
}

function rel_kpi_(rotulo, valor, delta, cor) {
  return '<td width="33%" style="padding:6px;vertical-align:top">' +
    '<div style="background:#fff;border:1px solid ' + REL_COR.line + ';border-radius:10px;padding:12px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:' + REL_COR.soft + '">' + rotulo + '</div>' +
    '<div style="font-size:24px;font-weight:700;color:' + (cor || REL_COR.ink) + ';margin-top:2px">' + valor + '</div>' +
    (delta || '') + '</div></td>';
}

function rel_secao_(titulo) {
  return '<tr><td style="padding:22px 6px 8px;font-size:15px;font-weight:700;color:' + REL_COR.brand + ';border-bottom:2px solid ' + REL_COR.accent + '">' + titulo + '</td></tr>';
}

function rel_tabela_(cabecalho, linhas, vazio) {
  if (!linhas.length) return '<tr><td style="padding:10px 6px;color:' + REL_COR.soft + ';font-size:13px">' + (vazio || 'Nada no período.') + '</td></tr>';
  let h = '<tr><td style="padding:8px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">';
  h += '<tr>' + cabecalho.map(function (c, i) {
    return '<th style="text-align:' + (i ? 'right' : 'left') + ';padding:6px 8px;background:' + REL_COR.paper + ';color:' + REL_COR.soft + ';font-weight:600;font-size:12px">' + c + '</th>';
  }).join('') + '</tr>';
  linhas.forEach(function (l) {
    h += '<tr>' + l.map(function (c, i) {
      return '<td style="text-align:' + (i ? 'right' : 'left') + ';padding:6px 8px;border-bottom:1px solid ' + REL_COR.line + '">' + c + '</td>';
    }).join('') + '</tr>';
  });
  return h + '</table></td></tr>';
}

function rel_linhasQuebra_(map, comOcorrencias) {
  return Object.keys(map).sort(function (a, b) { return map[b].realizados - map[a].realizados || a.localeCompare(b); })
    .map(function (k) {
      const v = map[k];
      const linha = [rel_esc_(k), v.realizados, v.aprovados,
        v.reprovados ? '<span style="color:' + REL_COR.risco + ';font-weight:600">' + v.reprovados + '</span>' : '0',
        v.nc ? '<span style="color:' + REL_COR.alerta + ';font-weight:600">' + v.nc + '</span>' : '0'];
      if (comOcorrencias) linha.push(v.ocorrencias);
      return linha;
    });
}

function rel_html_(tipo, p, d) {
  const c = d.chk, ca = d.chkAnt;
  // Período anterior sem nenhum checklist (ex.: app ainda não estava em uso) → não compara.
  if (!ca.realizados) { ca.percentualCumprimento = null; ca.percentualAprovacao = null; }
  const titulo = tipo === 'SEMANAL' ? 'Resumo semanal' : 'Relatório mensal';
  const logo = rel_logoBlob_() ? '<img src="cid:logoicc" width="44" height="44" style="display:block;border-radius:8px;background:#fff" alt="ICC">' : '';

  let h = '<div style="background:' + REL_COR.paper + ';padding:20px 8px;font-family:\'IBM Plex Sans\',Arial,Helvetica,sans-serif;color:' + REL_COR.ink + '">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto">';

  // Cabeçalho
  h += '<tr><td style="background:' + REL_COR.brand + ';border-radius:14px;padding:18px 20px">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    (logo ? '<td width="56" style="vertical-align:middle">' + logo + '</td>' : '') +
    '<td style="vertical-align:middle;color:#fff">' +
    '<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.75">Checklist da Qualidade · ICC Brazil</div>' +
    '<div style="font-size:20px;font-weight:700;margin-top:2px">' + titulo + '</div>' +
    '<div style="font-size:14px;margin-top:2px;color:#cfe3bb">' + rel_esc_((d.unidade ? d.unidade + ' · ' : '') + p.rotulo) + '</div>' +
    '</td></tr></table></td></tr>';

  // Indicadores principais
  h += rel_secao_('Indicadores do período');
  h += '<tr><td style="padding-top:6px"><table width="100%" cellpadding="0" cellspacing="0">';
  h += '<tr>' +
    rel_kpi_('Cumprimento', rel_pct_(c.percentualCumprimento), rel_delta_(c.percentualCumprimento, ca.percentualCumprimento, true, ' p.p.'),
      c.percentualCumprimento === null ? null : (c.percentualCumprimento >= 90 ? REL_COR.accent : c.percentualCumprimento >= 70 ? REL_COR.alerta : REL_COR.risco)) +
    rel_kpi_('Aprovação', rel_pct_(c.percentualAprovacao), rel_delta_(c.percentualAprovacao, ca.percentualAprovacao, true, ' p.p.')) +
    rel_kpi_('Ocorrências', rel_num_(d.oco.total), rel_delta_(d.oco.total, d.ocoAnt.total, false, '')) +
    '</tr><tr>' +
    rel_kpi_('Previstas', rel_num_(c.totalPrevisto), '') +
    rel_kpi_('Realizadas', rel_num_(c.realizados), '') +
    rel_kpi_('Não realizadas', rel_num_(c.atrasados), '', c.atrasados ? REL_COR.risco : null) +
    '</tr><tr>' +
    rel_kpi_('Aprovadas', rel_num_(c.aprovados), '', REL_COR.accent) +
    rel_kpi_('Reprovadas', rel_num_(c.reprovados), '', c.reprovados ? REL_COR.risco : null) +
    rel_kpi_('Não conformes', rel_num_(c.naoConformidades), '<div style="font-size:11px;color:' + REL_COR.soft + '">+ ' + d.ncPeriodo + ' NC aberta(s) pela Qualidade</div>', c.naoConformidades ? REL_COR.alerta : null) +
    '</tr></table></td></tr>';

  // Pendências agora
  const ag = d.agora;
  h += rel_secao_('Pendências em aberto agora');
  h += rel_tabela_(['Item', 'Qtd.'], [
    ['Checklists aguardando validação' + (ag.filaMaisAntiga ? ' <span style="color:' + REL_COR.soft + ';font-size:12px">(mais antigo: ' + rel_br_(ag.filaMaisAntiga) + ')</span>' : ''), ag.filaValidacao],
    ['Ocorrências abertas / em análise', ag.ocorrenciasAbertas],
    ['Não conformidades da Qualidade em aberto', ag.ncAbertas]
  ]);

  // Por local
  h += rel_secao_('Por local');
  h += rel_tabela_(['Local', 'Realiz.', 'Aprov.', 'Reprov.', 'N. conf.', 'Ocorr.'], rel_linhasQuebra_(d.porLocal, true));

  // Por agente
  h += rel_secao_('Por Agente de Limpeza');
  h += rel_tabela_(['Agente', 'Realiz.', 'Aprov.', 'Reprov.', 'N. conf.', 'Ocorr.'], rel_linhasQuebra_(d.porAgente, true));

  // Por turno
  h += rel_secao_('Por turno');
  h += rel_tabela_(['Turno', 'Realiz.', 'Aprov.', 'Reprov.', 'N. conf.'], rel_linhasQuebra_(d.porTurno, false));

  // Ocorrências
  h += rel_secao_('Ocorrências');
  h += rel_tabela_(['Situação', 'Qtd.'], [
    ['Registradas no período', d.oco.total],
    ['Procedentes', d.oco.procedentes || 0],
    ['Não procedentes', d.oco.naoProcedentes || 0],
    ['Ainda sem análise', d.oco.pendentes || 0]
  ]);
  if (d.topAmbientes.length) {
    h += '<tr><td style="padding:10px 6px 2px;font-size:13px;font-weight:600;color:' + REL_COR.soft + '">Ambientes com mais ocorrências</td></tr>';
    h += rel_tabela_(['Local · Ambiente', 'Qtd.'], d.topAmbientes.map(function (t) { return [rel_esc_(t.nome), t.qtd]; }));
  }

  // Reprovações
  h += rel_secao_('Reprovações do período' + (c.reprovados > 10 ? ' (10 primeiras de ' + c.reprovados + ')' : ''));
  h += rel_tabela_(['Data · Local · Atividade · Agente', 'Motivo'], d.reprovacoes.map(function (r) {
    return [rel_esc_((r.DATA || '') + ' · ' + (r.LOCAL || '') + ' / ' + (r.AMBIENTE || '')) + '<br><span style="color:' + REL_COR.soft + '">' + rel_esc_((r.ATIVIDADE || '') + ' — ' + (r.AGENTE || '')) + '</span>',
      rel_esc_(r.MOTIVO_REPROVACAO || '—')];
  }), 'Nenhuma reprovação no período. 👏');

  // Rodapé
  h += '<tr><td style="padding:24px 6px 6px;text-align:center">' +
    '<a href="' + REL_APP_URL + '" style="display:inline-block;background:' + REL_COR.accent + ';color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:10px">Abrir o Checklist da Qualidade</a>' +
    '</td></tr>';
  h += '<tr><td style="padding:10px 6px;font-size:11px;color:' + REL_COR.soft + ';text-align:center">' +
    'Comparação com ' + rel_esc_(p.rotuloAnterior) + '. Envio automático — para entrar ou sair da lista, altere a coluna EMAILS da aba USUARIOS.' +
    '</td></tr>';

  return h + '</table></div>';
}

// Versão em texto simples (para clientes de e-mail sem HTML)
function rel_texto_(tipo, p, d) {
  const c = d.chk;
  return [
    'CHECKLIST DA QUALIDADE — ' + (tipo === 'SEMANAL' ? 'Resumo semanal' : 'Relatório mensal') + ' · ' + (d.unidade ? d.unidade + ' · ' : '') + p.rotulo,
    '',
    'Cumprimento: ' + rel_pct_(c.percentualCumprimento) + ' (' + rel_num_(c.realizados) + ' de ' + rel_num_(c.totalPrevisto) + ' previstas)',
    'Não realizadas: ' + rel_num_(c.atrasados),
    'Aprovação: ' + rel_pct_(c.percentualAprovacao) + ' (' + c.aprovados + ' aprovadas, ' + c.reprovados + ' reprovadas)',
    'Não conformes: ' + c.naoConformidades + ' · NCs da Qualidade: ' + d.ncPeriodo,
    'Ocorrências: ' + d.oco.total,
    '',
    'Em aberto agora: ' + d.agora.filaValidacao + ' aguardando validação, ' + d.agora.ocorrenciasAbertas + ' ocorrências, ' + d.agora.ncAbertas + ' NCs.',
    '',
    REL_APP_URL
  ].join('\n');
}


// ======================= RELATÓRIO UNIFICADO (todas as unidades) =======================

var REL_CORES_UNID = ['#5e9030', '#3b82c4', '#8b5cf6', '#df8630', '#d64545'];

function rel_coletarUnificado_(p) {
  const atual = getComparativoUnidades_({ dataInicial: rel_br_(p.ini), dataFinal: rel_br_(p.fim) }).unidades;
  const anterior = getComparativoUnidades_({ dataInicial: rel_br_(p.antIni), dataFinal: rel_br_(p.antFim) }).unidades;
  const antPorUnid = {};
  anterior.forEach(function (u) { antPorUnid[u.unidade] = u; });
  return { unidades: atual, anterior: antPorUnid, total: rel_somarUnidades_(atual), totalAnt: rel_somarUnidades_(anterior) };
}

function rel_somarUnidades_(lista) {
  const t = { totalPrevisto: 0, realizados: 0, atrasados: 0, aprovados: 0, reprovados: 0, naoConformidades: 0,
    ocorrencias: 0, ncQualidade: 0, filaValidacao: 0, ncAbertas: 0, ocorrenciasPendentes: 0, agentesAtivos: 0 };
  lista.forEach(function (u) { Object.keys(t).forEach(function (k) { t[k] += Number(u[k]) || 0; }); });
  t.percentualCumprimento = t.totalPrevisto ? Math.round(t.realizados / t.totalPrevisto * 1000) / 10 : 0;
  t.percentualAprovacao = (t.aprovados + t.reprovados) ? Math.round(t.aprovados / (t.aprovados + t.reprovados) * 1000) / 10 : 0;
  return t;
}

// Destaques automáticos para a análise (melhor/pior em cada ponto).
function rel_destaques_(d) {
  const us = d.unidades.filter(function (u) { return u.totalPrevisto || u.realizados || u.ocorrencias; });
  if (us.length < 2) return [];
  const maior = function (campo) { return us.slice().sort(function (a, b) { return (b[campo] || 0) - (a[campo] || 0); })[0]; };
  const menor = function (campo) { return us.slice().sort(function (a, b) { return (a[campo] || 0) - (b[campo] || 0); })[0]; };
  const out = [];
  const mc = maior('percentualCumprimento'), pc = menor('percentualCumprimento');
  if (mc !== pc) out.push({ bom: true, txt: '<b>' + rel_esc_(mc.unidade) + '</b> teve o melhor cumprimento (' + rel_pct_(mc.percentualCumprimento) + '); <b>' + rel_esc_(pc.unidade) + '</b> o menor (' + rel_pct_(pc.percentualCumprimento) + ').' });
  const ma = maior('percentualAprovacao'), pa = menor('percentualAprovacao');
  if (ma !== pa) out.push({ bom: true, txt: 'Maior aprovação nas validações: <b>' + rel_esc_(ma.unidade) + '</b> (' + rel_pct_(ma.percentualAprovacao) + '); menor: <b>' + rel_esc_(pa.unidade) + '</b> (' + rel_pct_(pa.percentualAprovacao) + ').' });
  const mr = maior('reprovados');
  if (mr.reprovados) out.push({ bom: false, txt: 'Mais reprovações: <b>' + rel_esc_(mr.unidade) + '</b> (' + mr.reprovados + ').' });
  const mo = maior('ocorrencias');
  if (mo.ocorrencias) out.push({ bom: false, txt: 'Mais ocorrências registradas: <b>' + rel_esc_(mo.unidade) + '</b> (' + mo.ocorrencias + ').' });
  const mf = maior('filaValidacao');
  if (mf.filaValidacao) out.push({ bom: false, txt: 'Maior fila aguardando validação agora: <b>' + rel_esc_(mf.unidade) + '</b> (' + mf.filaValidacao + ' checklist(s)).' });
  // quem mais melhorou/piorou no cumprimento
  let melhor = null, pior = null;
  us.forEach(function (u) {
    const a = d.anterior[u.unidade];
    if (!a || !a.realizados) return;
    const diff = Math.round((u.percentualCumprimento - a.percentualCumprimento) * 10) / 10;
    if (!melhor || diff > melhor.diff) melhor = { u: u.unidade, diff: diff };
    if (!pior || diff < pior.diff) pior = { u: u.unidade, diff: diff };
  });
  if (melhor && melhor.diff > 0) out.push({ bom: true, txt: 'Quem mais evoluiu no cumprimento: <b>' + rel_esc_(melhor.u) + '</b> (+' + rel_num_(melhor.diff) + ' p.p.).' });
  if (pior && pior.diff < 0 && (!melhor || pior.u !== melhor.u)) out.push({ bom: false, txt: 'Maior queda no cumprimento: <b>' + rel_esc_(pior.u) + '</b> (' + rel_num_(pior.diff) + ' p.p.).' });
  return out;
}

function rel_htmlUnificado_(tipo, p, d) {
  const titulo = (tipo === 'SEMANAL' ? 'Resumo semanal' : 'Relatório mensal') + ' unificado';
  const logo = rel_logoBlob_() ? '<img src="cid:logoicc" width="44" height="44" style="display:block;border-radius:8px;background:#fff" alt="ICC">' : '';
  const us = d.unidades, t = d.total, ta = d.totalAnt;

  let h = '<div style="background:' + REL_COR.paper + ';padding:20px 8px;font-family:\'IBM Plex Sans\',Arial,Helvetica,sans-serif;color:' + REL_COR.ink + '">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto">';

  h += '<tr><td style="background:' + REL_COR.brand + ';border-radius:14px;padding:18px 20px">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    (logo ? '<td width="56" style="vertical-align:middle">' + logo + '</td>' : '') +
    '<td style="vertical-align:middle;color:#fff">' +
    '<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.75">Checklist da Qualidade · ICC Brazil</div>' +
    '<div style="font-size:20px;font-weight:700;margin-top:2px">' + titulo + '</div>' +
    '<div style="font-size:14px;margin-top:2px;color:#cfe3bb">Todas as unidades · ' + rel_esc_(p.rotulo) + '</div>' +
    '</td></tr></table></td></tr>';

  // Totais da empresa
  if (!ta.realizados) { ta.percentualCumprimento = null; ta.percentualAprovacao = null; }
  h += rel_secao_('Empresa · todas as unidades somadas');
  h += '<tr><td style="padding-top:6px"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    rel_kpi_('Cumprimento', rel_pct_(t.percentualCumprimento), rel_delta_(t.percentualCumprimento, ta.percentualCumprimento, true, ' p.p.'),
      t.percentualCumprimento >= 90 ? REL_COR.accent : t.percentualCumprimento >= 70 ? REL_COR.alerta : REL_COR.risco) +
    rel_kpi_('Aprovação', rel_pct_(t.percentualAprovacao), rel_delta_(t.percentualAprovacao, ta.percentualAprovacao, true, ' p.p.')) +
    rel_kpi_('Ocorrências', rel_num_(t.ocorrencias), rel_delta_(t.ocorrencias, ta.ocorrencias, false, '')) +
    '</tr><tr>' +
    rel_kpi_('Realizadas', rel_num_(t.realizados) + '<span style="font-size:13px;color:' + REL_COR.soft + '"> / ' + rel_num_(t.totalPrevisto) + '</span>', '') +
    rel_kpi_('Reprovadas', rel_num_(t.reprovados), '', t.reprovados ? REL_COR.risco : null) +
    rel_kpi_('Aguardando validação', rel_num_(t.filaValidacao), '<div style="font-size:11px;color:' + REL_COR.soft + '">agora</div>', t.filaValidacao ? REL_COR.alerta : null) +
    '</tr></table></td></tr>';

  // Comparativo lado a lado
  h += rel_secao_('Comparativo entre unidades');
  const linhas = [
    { r: 'Cumprimento', k: 'percentualCumprimento', pct: true, melhorSobe: true, delta: true },
    { r: 'Previstas', k: 'totalPrevisto' },
    { r: 'Realizadas', k: 'realizados' },
    { r: 'Não realizadas', k: 'atrasados', melhorSobe: false },
    { r: 'Aprovação', k: 'percentualAprovacao', pct: true, melhorSobe: true, delta: true },
    { r: 'Aprovadas', k: 'aprovados' },
    { r: 'Reprovadas', k: 'reprovados', melhorSobe: false },
    { r: 'Não conformes', k: 'naoConformidades', melhorSobe: false },
    { r: 'Ocorrências', k: 'ocorrencias', melhorSobe: false, delta: true },
    { r: 'NCs da Qualidade', k: 'ncQualidade', melhorSobe: false },
    { r: 'Aguardando validação (agora)', k: 'filaValidacao', melhorSobe: false },
    { r: 'NCs em aberto (agora)', k: 'ncAbertas', melhorSobe: false },
    { r: 'Agentes ativos', k: 'agentesAtivos' }
  ];
  let tab = '<tr><td style="padding:8px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">';
  tab += '<tr><th style="text-align:left;padding:7px 8px;background:' + REL_COR.paper + ';color:' + REL_COR.soft + ';font-size:12px">Indicador</th>' +
    us.map(function (u, i) {
      return '<th style="text-align:right;padding:7px 8px;background:' + REL_COR.paper + ';font-size:12px;color:' + REL_CORES_UNID[i % REL_CORES_UNID.length] + '">' + rel_esc_(u.unidade) + '</th>';
    }).join('') + '</tr>';
  linhas.forEach(function (l) {
    const vals = us.map(function (u) { return Number(u[l.k]) || 0; });
    const temDado = us.filter(function (u) { return u.totalPrevisto || u.realizados || u.ocorrencias; }).length;
    let melhor = null, pior = null;
    if (l.melhorSobe !== undefined && temDado > 1 && Math.max.apply(null, vals) !== Math.min.apply(null, vals)) {
      melhor = l.melhorSobe ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      pior = l.melhorSobe ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    }
    tab += '<tr><td style="padding:7px 8px;border-bottom:1px solid ' + REL_COR.line + '">' + l.r + '</td>' +
      us.map(function (u, i) {
        const v = vals[i];
        const cor = v === melhor ? REL_COR.accent : v === pior ? REL_COR.risco : REL_COR.ink;
        const peso = (v === melhor || v === pior) ? '700' : '400';
        let delta = '';
        if (l.delta) {
          const a = d.anterior[u.unidade];
          if (a && (l.k === 'ocorrencias' || a.realizados)) delta = rel_delta_(v, Number(a[l.k]) || 0, l.melhorSobe, l.pct ? ' p.p.' : '').replace(' vs anterior', '');
        }
        return '<td style="text-align:right;padding:7px 8px;border-bottom:1px solid ' + REL_COR.line + ';color:' + cor + ';font-weight:' + peso + '">' +
          (l.pct ? rel_pct_(v) : rel_num_(v)) + delta + '</td>';
      }).join('') + '</tr>';
  });
  tab += '</table></td></tr>';
  h += tab;
  h += '<tr><td style="padding:2px 6px 0;font-size:11px;color:' + REL_COR.soft + '">Verde = melhor resultado da linha · vermelho = pior · variação comparada com ' + rel_esc_(p.rotuloAnterior) + '.</td></tr>';

  // Ranking de cumprimento (barras)
  h += rel_secao_('Ranking de cumprimento');
  us.slice().sort(function (a, b) { return b.percentualCumprimento - a.percentualCumprimento; }).forEach(function (u, i) {
    const cor = REL_CORES_UNID[us.indexOf(u) % REL_CORES_UNID.length];
    const w = Math.max(2, Math.min(100, Math.round(u.percentualCumprimento || 0)));
    h += '<tr><td style="padding:6px 6px 2px">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="110" style="font-size:13px;font-weight:600">' + (i + 1) + 'º ' + rel_esc_(u.unidade) + '</td>' +
      '<td style="padding:0 8px"><table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ef;border-radius:6px"><tr>' +
      '<td width="' + w + '%" style="background:' + cor + ';height:12px;border-radius:6px;font-size:1px;line-height:1px">&nbsp;</td><td style="font-size:1px">&nbsp;</td></tr></table></td>' +
      '<td width="60" style="text-align:right;font-size:13px;font-weight:700">' + rel_pct_(u.percentualCumprimento) + '</td>' +
      '</tr></table></td></tr>';
  });

  // Destaques
  const dest = rel_destaques_(d);
  if (dest.length) {
    h += rel_secao_('Destaques para análise');
    h += '<tr><td style="padding:6px 6px 0"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">' +
      dest.map(function (x) {
        return '<tr><td width="18" style="vertical-align:top;padding:5px 0;color:' + (x.bom ? REL_COR.accent : REL_COR.risco) + '">' + (x.bom ? '▲' : '●') + '</td>' +
          '<td style="padding:5px 0;line-height:1.45">' + x.txt + '</td></tr>';
      }).join('') + '</table></td></tr>';
  }

  // Detalhe por unidade
  h += rel_secao_('Detalhe por unidade');
  us.forEach(function (u, i) {
    const cor = REL_CORES_UNID[i % REL_CORES_UNID.length];
    h += '<tr><td style="padding:8px 0"><div style="background:#fff;border:1px solid ' + REL_COR.line + ';border-left:4px solid ' + cor + ';border-radius:10px;padding:12px 14px">' +
      '<div style="font-size:15px;font-weight:700;color:' + cor + '">' + rel_esc_(u.unidade) + '</div>' +
      '<div style="font-size:13px;color:' + REL_COR.soft + ';margin-top:4px;line-height:1.5">' +
      'Cumprimento <b style="color:' + REL_COR.ink + '">' + rel_pct_(u.percentualCumprimento) + '</b> (' + u.realizados + ' de ' + u.totalPrevisto + ') · ' +
      'Aprovação <b style="color:' + REL_COR.ink + '">' + rel_pct_(u.percentualAprovacao) + '</b> · ' +
      u.reprovados + ' reprovada(s) · ' + u.ocorrencias + ' ocorrência(s) · ' + u.ncQualidade + ' NC(s)<br>' +
      'Em aberto agora: ' + u.filaValidacao + ' aguardando validação, ' + u.ocorrenciasPendentes + ' ocorrência(s) sem análise, ' + u.ncAbertas + ' NC(s).' +
      '</div>' +
      (u.ambientesCriticos && u.ambientesCriticos.length
        ? '<div style="font-size:12px;margin-top:8px"><span style="color:' + REL_COR.soft + '">Ambientes que mais pedem atenção:</span> ' +
          u.ambientesCriticos.map(function (a) { return rel_esc_(a.ambiente) + ' (' + a.total + ')'; }).join(' · ') + '</div>'
        : '<div style="font-size:12px;margin-top:8px;color:' + REL_COR.soft + '">Nenhum ambiente com problema no período.</div>') +
      '</div></td></tr>';
  });

  h += '<tr><td style="padding:24px 6px 6px;text-align:center">' +
    '<a href="' + REL_APP_URL + '" style="display:inline-block;background:' + REL_COR.accent + ';color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:10px">Abrir o Checklist da Qualidade</a>' +
    '</td></tr>';
  h += '<tr><td style="padding:10px 6px;font-size:11px;color:' + REL_COR.soft + ';text-align:center">' +
    'Você recebe o relatório unificado porque está com UNIDADE = TODAS na aba USUARIOS. Para sair da lista, apague seu e-mail na coluna EMAILS.' +
    '</td></tr>';
  return h + '</table></div>';
}

function rel_textoUnificado_(tipo, p, d) {
  const linhas = ['CHECKLIST DA QUALIDADE — ' + (tipo === 'SEMANAL' ? 'Resumo semanal' : 'Relatório mensal') + ' unificado · ' + p.rotulo, ''];
  linhas.push('Empresa: cumprimento ' + rel_pct_(d.total.percentualCumprimento) + ', aprovação ' + rel_pct_(d.total.percentualAprovacao) + ', ' + d.total.ocorrencias + ' ocorrências.');
  linhas.push('');
  d.unidades.forEach(function (u) {
    linhas.push(u.unidade + ': cumprimento ' + rel_pct_(u.percentualCumprimento) + ' (' + u.realizados + '/' + u.totalPrevisto + '), aprovação ' +
      rel_pct_(u.percentualAprovacao) + ', ' + u.reprovados + ' reprovadas, ' + u.ocorrencias + ' ocorrências, ' + u.filaValidacao + ' aguardando validação.');
  });
  linhas.push('', REL_APP_URL);
  return linhas.join('\n');
}
