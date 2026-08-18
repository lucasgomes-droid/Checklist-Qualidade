# Checklist da Qualidade — ICC Brazil Animal Nutrition — Guia de Configuração

> **Atualização:** esta versão adiciona o módulo de **Não Conformidade**
> (inspeção feita pelo próprio Admin, direcionada a um agente específico),
> identificação automática de responsável nas ocorrências, reorganização
> do painel do dia e nova paleta de cores (cinza grafite + verde). Se você
> já tinha a versão anterior rodando, veja a seção **"Atualizando de uma
> versão anterior"** mais abaixo antes de seguir os passos normais.

Mesma arquitetura do sistema de Gestão de Armazéns que a empresa já usa:
**frontend estático** (HTML/CSS/JS, pode ser hospedado no GitHub Pages) +
**backend em Google Apps Script**, que lê e escreve direto na planilha do
Google Sheets. Não há servidor próprio — a planilha *é* o banco de dados.

---

## FASE 1 — Criar a planilha e o backend

1. Crie uma planilha nova no Google Sheets (ex: "Checklist da Qualidade - Dados").
2. Nela, vá em **Extensões → Apps Script**.
3. Apague o conteúdo padrão do `Code.gs` e cole o conteúdo do arquivo `Code.gs` deste projeto.
4. No topo da barra de ferramentas do editor, selecione a função `configurarPlanilha` no dropdown e clique em **Executar** (▶). Na primeira vez, o Google vai pedir autorização — aceite.
5. Volte na planilha: as abas `USUARIOS`, `LOCAIS`, `AMBIENTES`, `TURNOS`, `ATIVIDADES`, `CHECKLISTS`, `OCORRENCIAS` e `_SEQ` foram criadas com cabeçalhos e dados de exemplo (2 agentes, 1 admin, os 5 locais da spec com alguns ambientes, e algumas atividades de exemplo).
6. **Apague/edite os dados de exemplo** e cadastre seus usuários, locais, ambientes e atividades reais.
7. Se o PDF de relatório der erro de permissão na primeira vez, rode manualmente a função `autorizarPermissoesPDF` uma vez.

### Publicar a API (Web App)

1. No editor do Apps Script: **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. Configurações:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Clique em **Implantar**, autorize novamente se pedido, e copie a **URL do app da Web** (termina em `/exec`).

> Sempre que você editar o `Code.gs`, é preciso criar uma **nova versão** da implantação (Implantar → Gerenciar implantações → ✏️ → Nova versão) para as mudanças valerem na URL publicada.

---

## FASE 2 — Conectar o frontend

1. Abra `app.js`.
2. Na primeira linha de código, troque:
   ```js
   const API_URL = 'COLE_A_URL_DO_SEU_APPS_SCRIPT_AQUI';
   ```
   pela URL que você copiou (terminando em `/exec`).
3. Suba os arquivos `index.html`, `style.css`, `app.js` e `logo.png` para um repositório no GitHub Pages (ou qualquer hospedagem estática).

---

## Atualizando de uma versão anterior

1. No editor do Apps Script, substitua todo o conteúdo do `Code.gs` pelo
   novo, e rode `configurarPlanilha` de novo (Executar). Isso é seguro:
   ele só **adiciona** a nova aba `NAO_CONFORMIDADES` e as novas colunas em
   `OCORRENCIAS` (`TURNO_RESPONSAVEL`, `ID_AGENTE_RESPONSAVEL`,
   `AGENTE_RESPONSAVEL`, `DATA_ULTIMA_LIMPEZA`) — não apaga nada que já
   existia nas outras abas.
2. Crie uma **nova versão** da implantação (Implantar → Gerenciar
   implantações → ✏️ → Nova versão) para o backend atualizado valer na
   URL já publicada. Você **não** precisa mudar a `API_URL` no `app.js`.
3. Substitua `app.js`, `index.html` e `style.css` pelos novos no seu
   repositório do GitHub Pages. `logo.png` não muda.

## O que essa atualização mudou

- **Painel do dia** saiu da tela inicial do admin (que agora mostra só um
  resumo) e passou a ser uma tela própria, acessada tocando no card do
  resumo — pra não poluir a home com uma lista grande todo santo dia.
- **Ocorrências**: a lista agora mostra com clareza quem abriu, quando, e
  o responsável identificado. O campo "Turno" que o agente preenchia
  manualmente foi removido — agora o sistema busca automaticamente, no
  histórico de `CHECKLISTS`, quem foi a última pessoa (e em qual turno) a
  limpar aquele local+ambiente, e marca essa pessoa como responsável pela
  não conformidade encontrada. Isso resolve o caso de um agente do turno 2
  relatando algo que já estava errado quando ele chegou — o sistema aponta
  o turno 1 como responsável, não quem relatou.
- **Nova aba "Não Conformidade"** (só para o Admin): o Admin inspeciona um
  local, encontra um problema, e já direciona a resolução a um Agente de
  Limpeza específico (o sistema sugere automaticamente quem limpou aquele
  local por último, mas o Admin pode trocar). Funciona como uma pendência:
  o agente recebe na aba "Pendências" (novo item na barra de navegação
  dele), resolve com foto de comprovação, e o Admin valida (aprova ou
  devolve com o que falta corrigir).
- **Cores**: paleta trocada para cinza grafite (cor institucional,
  usada no topo e em botões secundários) + verde do logo ICC como cor de
  destaque/ação (botões principais, abas ativas, barras dos dashboards).

## Mapeamento com a especificação original

A especificação original sugeria 11 abas (USUARIOS, LOCAIS, AMBIENTES,
ITENS_CHECKLIST, PLANEJAMENTO_LIMPEZA, CHECKLISTS, ITENS_RESPONDIDOS, FOTOS,
VALIDACOES, OCORRENCIAS, CONFIGURACOES). Para manter o sistema simples de
manter — no mesmo espírito do sistema de armazéns, que já consolida dados
relacionados numa única aba — algumas foram unificadas:

| Aba da especificação | Onde ficou no sistema |
|---|---|
| `USUARIOS` | `USUARIOS` |
| `LOCAIS` | `LOCAIS` |
| `AMBIENTES` | `AMBIENTES` |
| `ITENS_CHECKLIST` + `PLANEJAMENTO_LIMPEZA` | Unificadas em `ATIVIDADES` (cada linha já define periodicidade, turno e obrigatoriedade de foto/validação — não há necessidade de duas abas separadas) |
| `CHECKLISTS` + `ITENS_RESPONDIDOS` + `FOTOS` + `VALIDACOES` | Unificadas em `CHECKLISTS` (cada linha = uma atividade executada, com fotos antes/depois e o resultado da validação na mesma linha — assim como a aba `PENDENCIAS` do sistema de armazéns já concentra abertura + resolução + validação) |
| `OCORRENCIAS` | `OCORRENCIAS` (abertura + validação na mesma linha) |
| `CONFIGURACOES` | Não foi necessária — como no sistema de armazéns, tudo que precisa ser mudado sem tocar no código já é uma coluna editável nas abas acima |

**Nada disso muda o que o sistema faz** — só reduz o número de abas que
alguém precisa abrir para editar/consultar algo, sem duplicar dados.

---

## Estrutura de dados (abas da planilha)

| Aba | Uso |
|---|---|
| `USUARIOS` | Agentes de Limpeza e Administradores da Qualidade. `PERFIL = AGENTE_LIMPEZA` ou `ADMIN_QUALIDADE`. Só `ADMIN_QUALIDADE` usa `SENHA` (Agente de Limpeza tem login simples, sem senha, como pedido na spec). `ATIVO = SIM/NAO` controla quem aparece na tela de login. |
| `LOCAIS` | Refeitório, Operação, Laboratório, Casarão, Fábrica, ou quaisquer outros que a empresa cadastrar. |
| `AMBIENTES` | Ambientes vinculados a cada local (ex: Banheiro Feminino → Operação). |
| `TURNOS` | Turnos disponíveis (1º, 2º, 3º turno, ou o nome que preferir). |
| `ATIVIDADES` | O "planejamento de limpeza": cada linha é uma atividade (ex: "Limpeza banheiro feminino") vinculada a um local+ambiente, com periodicidade (`DIARIO`/`SEMANAL`/`MENSAL`), turno (vazio = todos os turnos), e se exige foto antes/depois/validação (`SIM`/`NAO`). Para `SEMANAL`, `DIA_SEMANA` (0=domingo...6=sábado) define em qual dia — deixe vazio para "qualquer dia da semana". Para `MENSAL`, `DIA_MES` (1-31) funciona da mesma forma. |
| `CHECKLISTS` | Gerada automaticamente: cada execução de uma atividade por um agente, com resultado (`CONFORME`/`NAO_CONFORME`/`NAO_SE_APLICA`), fotos antes/depois e o status de validação da Qualidade. |
| `OCORRENCIAS` | Gerada automaticamente: não conformidades abertas livremente pelos agentes, com o responsável identificado automaticamente (última limpeza registrada no local) e o resultado da análise da Qualidade. |
| `NAO_CONFORMIDADES` | Gerada automaticamente: inspeções do próprio Admin, já direcionadas a um Agente de Limpeza específico, com a resolução dele e a validação final da Qualidade. |
| `_SEQ` | Interna — controla a numeração dos IDs (CHK-000001, OCO-000001, NC-000001...). Não edite manualmente. |

Editar locais, ambientes, turnos, atividades e usuários **direto na
planilha** já reflete no app automaticamente — nada fica fixo no código.

---

## Cálculo de "previstos / pendentes / atrasados" nos dashboards

O sistema calcula, para cada dia de um período, quais atividades estavam
previstas (com base em `ATIVIDADES` + periodicidade + `DIA_SEMANA`/`DIA_MES`)
e compara com o que foi de fato registrado em `CHECKLISTS` naquele dia. Uma
simplificação importante: quando uma atividade não tem `TURNO` definido
(vale para todos os turnos), o cálculo de "previstos" a conta uma vez por
turno cadastrado em `TURNOS` — ou seja, ela é considerada uma exigência por
turno, não uma exigência única por dia. Se isso não refletir a realidade de
alguma atividade específica (por exemplo, algo que só precisa ser feito uma
vez por dia, independente do turno), defina um `TURNO` específico para ela
em `ATIVIDADES`.

---

## O que já está implementado

- Login: Agente de Limpeza escolhe seu nome direto na lista (sem senha);
  Administrador da Qualidade escolhe o nome e digita a senha.
- **Checklist**: wizard periodicidade → turno → local → ambiente → lista de
  atividades daquela combinação, com Conforme/Não Conforme/Não se aplica,
  observação obrigatória em não conformidade, e foto antes/depois conforme
  configurado em `ATIVIDADES`.
- **Validação pela Qualidade**: lista de checklists pendentes, fotos
  antes/depois lado a lado, aprovar ou reprovar com motivo e opção de
  marcar necessidade de refazer.
- **Ocorrências**: abertura pelo agente (turno/local/ambiente/descrição/foto)
  e análise pelo admin (procedente/não procedente + observação), com
  acompanhamento de status até Tratada/Encerrada.
- **Painel do dia** (home do admin): mostra o que já foi feito hoje e o que
  ainda está pendente, por atividade.
- **3 dashboards**: Checklist da Qualidade (cumprimento, aprovação, não
  conformidades, rankings por agente/local/ambiente/turno), Ocorrências, e
  Evidências Fotográficas — todos com filtro de período/local/ambiente/turno
  e comparação com o período anterior.
- **Histórico** completo por agente (checklists e ocorrências).
- **Relatórios** exportáveis em CSV (abre direto no Excel/Sheets) e PDF com
  o cabeçalho da ICC Brazil.
- Fotos são enviadas em base64 e salvas automaticamente numa pasta do
  Google Drive (`ChecklistQualidade_Fotos`), com o link salvo na planilha.

## O que ainda precisa de atenção (próximos incrementos)

- **Cadastro de usuários/locais/ambientes/atividades via app**: hoje isso é
  feito só pela planilha, propositalmente — igual ao sistema de armazéns.
- **Notificações**: não há aviso push/e-mail quando uma ocorrência é aberta
  ou um checklist é reprovado; o admin precisa abrir o painel para ver.
  Se precisar disso, a forma mais simples é e-mail automático via
  `MailApp.sendEmail()` no `Code.gs`.
- Senha do admin fica em texto simples na planilha, no mesmo padrão do
  sistema de armazéns. Para mais segurança, pode-se trocar por hash depois.
- O relatório de Relatórios (CSV/PDF) hoje cobre Checklists e Ocorrências;
  se quiser um relatório específico só de itens reprovados ou só de
  evidências fotográficas, é simples adicionar mais uma entrada no objeto
  `REPORTS` em `app.js`.
