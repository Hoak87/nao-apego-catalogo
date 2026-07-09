// ============================================================
//  NÃO APEGO — Gestão do Catálogo Público
//
//  Cria e mantém a aba CATALOGO a partir do ESTOQUE.
//  NÃO MODIFICA a aba ESTOQUE em nenhuma situação.
//
//  Fluxo da Luiza:
//  1. Rodar "Gerar / Atualizar Catálogo" sempre que quiser
//  2. Linhas amarelas = drop 02 disponível | laranja = desapego final
//  3. Editar "Sugestão Drop 02" ou "Sugestão Desapego Final" se quiser valor diferente
//  4. Rodar "Aplicar drops pendentes" → confirmar → Preço Atual atualiza
//
//  O site lê a coluna "Preço Atual" da aba CATALOGO (via CSV publicado).
// ============================================================

const SHEET_ESTOQUE  = 'ESTOQUE';
const SHEET_CATALOGO = 'CATALOGO';
const COL_PRECO_ESTOQUE = 'Preço Total';
const STATUS_OCULTOS = ['Pago', 'Cancelado', 'Devolvido'];

// ── Layout fixo da aba CATALOGO ──────────────────────────
// A ordem importa — é exatamente o que o CSV exporta
const CAT_HEADERS = [
  'Código',                   // A  1
  'Marca',                    // B  2
  'Descritivo Peça',          // C  3
  'Tamanho',                  // D  4
  'Cor',                      // E  5
  'Status',                   // F  6
  'Data Entrada',             // G  7
  'Closet',                   // H  8  mascarado se Closed
  'Tipo Closet',              // I  9  Open ou Closed — editável aqui
  'Foto',                     // J  10
  'Preço Original',           // K  11 referência do ESTOQUE (somente leitura)
  'Sugestão Drop 02',         // L  12 −20% calculado — editável pela Luiza
  'Sugestão Desapego Final',  // M  13 −40% calculado — editável pela Luiza
  'Preço Atual',              // N  14 o que o site exibe — PRESERVADO no rebuild
  'Drop Atual',               // O  15 fórmula automática (atualiza todo dia)
  'Status Drop',              // P  16 fórmula automática (alerta visual)
];

// Índices 1-based por nome (para referencias fáceis no código)
const C = {};
CAT_HEADERS.forEach((h, i) => { C[h] = i + 1; });


// ============================================================
//  MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Não Apego')
    .addItem('🔄  Gerar / Atualizar Catálogo', 'gerarCatalogo')
    .addSeparator()
    .addItem('✅  Aplicar drops pendentes', 'aplicarDropsPendentes')
    .addSeparator()
    .addItem('🔒  Resetar tudo pra Drop 01 (preço cheio)', 'resetarParaDropUm')
    .addToUi();
}


// ============================================================
//  GERAR CATÁLOGO
//  Rebuild completo. Preserva apenas o que a Luiza controla:
//    – Tipo Closet (Open / Closed por peça)
//    – Preço Atual (o preço aprovado e publicado)
//  Sugestões sempre recalculadas do ESTOQUE (preço fresco).
// ============================================================
function gerarCatalogo() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const estoque = ss.getSheetByName(SHEET_ESTOQUE);
  if (!estoque) { _alerta('Aba "ESTOQUE" não encontrada.'); return; }

  const estLastRow = estoque.getLastRow();
  const estLastCol = estoque.getLastColumn();
  if (estLastRow < 2) { _alerta('ESTOQUE está vazio.'); return; }

  // ── Ler ESTOQUE ──────────────────────────────────────────
  const estAll  = estoque.getRange(1, 1, estLastRow, estLastCol).getValues();
  const estHead = estAll[0].map(h => String(h).trim());
  const estRows = estAll.slice(1);

  // Mapa coluna→índice no ESTOQUE
  const E = {};
  estHead.forEach((h, i) => { E[h] = i; });

  if (E[COL_PRECO_ESTOQUE] === undefined) {
    _alerta('Coluna "' + COL_PRECO_ESTOQUE + '" não encontrada no ESTOQUE.');
    return;
  }

  // ── Preservar o que a Luiza controla no CATALOGO atual ───
  const preserved = {};  // { codigo: { tipoCloset, precoAtual } }
  const catAtual = ss.getSheetByName(SHEET_CATALOGO);
  if (catAtual && catAtual.getLastRow() > 1) {
    const catAll  = catAtual.getRange(1, 1, catAtual.getLastRow(), CAT_HEADERS.length).getValues();
    const catHead = catAll[0].map(h => String(h).trim());
    const iCod    = catHead.indexOf('Código');
    const iTipo   = catHead.indexOf('Tipo Closet');
    const iAtual  = catHead.indexOf('Preço Atual');
    catAll.slice(1).forEach(row => {
      const cod = String(row[iCod] || '').trim();
      if (!cod) return;
      preserved[cod] = {
        tipoCloset: String(row[iTipo] || 'Open').trim() || 'Open',
        precoAtual: row[iAtual] || null,
      };
    });
  }

  // ── Filtrar peças ativas ──────────────────────────────────
  const ativas = estRows.filter(row =>
    !STATUS_OCULTOS.includes(String(row[E['Status']] || '').trim())
  );
  if (ativas.length === 0) { _alerta('Nenhuma peça ativa no ESTOQUE.'); return; }

  // ── Montar linhas do CATALOGO ─────────────────────────────
  const dataRows = ativas.map(row => {
    const cod       = String(row[E['Código']] || '').trim();
    const prev      = preserved[cod] || {};
    const tipoCloset = prev.tipoCloset || 'Open';
    const closet     = tipoCloset === 'Closed' ? 'anônimo' : (row[E['Closet']] || '');
    const preco       = _parsePreco(row[E[COL_PRECO_ESTOQUE]]);
    const dataEntrada = _parseData(row[E['Data Entrada']]);
    const dias        = _calcDias(row[E['Data Entrada']]);

    // Sugestões: calculadas do preço atual do ESTOQUE
    const sug02    = Math.round(preco * 0.8 / 10) * 10;
    const sugFinal = Math.round(preco * 0.6 / 10) * 10;

    // Preço Atual: preserva o que a Luiza aprovou; se novo, começa no preço cheio
    const precoAtual = (prev.precoAtual && prev.precoAtual > 0) ? prev.precoAtual : preco;

    // Drop Atual e Status Drop: calculados no script (sem fórmula)
    const dropAtual = dias <= 30 ? 'Drop 01' : dias <= 60 ? 'Drop 02' : 'Desapego Final';
    let statusDrop = '✓ ok';
    if (dropAtual === 'Drop 02'       && precoAtual > sug02)    statusDrop = '⚠️ drop 02 disponível';
    if (dropAtual === 'Desapego Final' && precoAtual > sugFinal) statusDrop = '🔴 desapego final disponível';

    return [
      cod,
      row[E['Marca']]            || '',
      row[E['Descritivo Peça']]  || '',
      row[E['Tamanho']]          || '',
      row[E['Cor']]              || '',
      row[E['Status']]           || '',
      dataEntrada,
      closet,
      tipoCloset,
      row[E['Foto']]             || '',
      preco,        // Preço Original  (col K)
      sug02,        // Sugestão Drop 02 (col L)
      sugFinal,     // Sugestão Desapego Final (col M)
      precoAtual,   // Preço Atual (col N) — PRESERVADO
      dropAtual,    // Drop Atual (col O)
      statusDrop,   // Status Drop (col P)
    ];
  });

  // ── Criar ou limpar aba CATALOGO ──────────────────────────
  let catalogo = ss.getSheetByName(SHEET_CATALOGO);
  if (!catalogo) {
    catalogo = ss.insertSheet(SHEET_CATALOGO);
    ss.setActiveSheet(catalogo);
    ss.moveActiveSheet(2);
  } else {
    catalogo.clearContents();
    catalogo.clearConditionalFormatRules();
  }

  // ── Escrever cabeçalho e dados ────────────────────────────
  const nCols = CAT_HEADERS.length;
  const nRows = dataRows.length;
  catalogo.getRange(1, 1, 1, nCols).setValues([CAT_HEADERS]);
  if (nRows > 0) {
    catalogo.getRange(2, 1, nRows, nCols).setValues(dataRows);
  }

  // ── Formatação ────────────────────────────────────────────
  _formatarCatalogo(catalogo, nRows);

  // ── Informar GID para a URL do CSV ───────────────────────
  const gid = catalogo.getSheetId();
  ss.toast(
    `✅ ${nRows} peças no catálogo.\n\nGID da aba: ${gid}\nAdicione &gid=${gid} na URL de publicação do CSV no site.`,
    'Catálogo gerado', 10
  );
}


// ============================================================
//  APLICAR DROPS PENDENTES
//  Mostra prévia das peças com desconto disponível.
//  A Luiza pode editar as sugestões antes de confirmar.
//  Só atualiza "Preço Atual" após confirmação explícita.
// ============================================================
function aplicarDropsPendentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const catalogo = ss.getSheetByName(SHEET_CATALOGO);
  if (!catalogo || catalogo.getLastRow() < 2) {
    _alerta('Catálogo vazio. Execute "Gerar / Atualizar Catálogo" primeiro.');
    return;
  }

  const lastRow = catalogo.getLastRow();
  const dados   = catalogo.getRange(2, 1, lastRow - 1, CAT_HEADERS.length).getValues();

  const pendentes = { drop02: [], desapego: [] };

  dados.forEach((row, i) => {
    const statusDrop = String(row[C['Status Drop'] - 1] || '').trim();
    if (!statusDrop.startsWith('⚠️') && !statusDrop.startsWith('🔴')) return;

    const item = {
      rowNum:     i + 2,
      marca:      row[C['Marca'] - 1],
      nome:       row[C['Descritivo Peça'] - 1],
      tam:        row[C['Tamanho'] - 1],
      precoAtual: row[C['Preço Atual'] - 1],
      novoPreco:  statusDrop.startsWith('⚠️')
                    ? row[C['Sugestão Drop 02'] - 1]
                    : row[C['Sugestão Desapego Final'] - 1],
    };

    if (statusDrop.startsWith('⚠️')) pendentes.drop02.push(item);
    else                              pendentes.desapego.push(item);
  });

  const total = pendentes.drop02.length + pendentes.desapego.length;
  if (total === 0) {
    _alerta('✓ Nenhuma peça com drop pendente. Tudo atualizado!');
    return;
  }

  // ── Montar mensagem de confirmação ───────────────────────
  let msg = `${total} peça(s) prontas para desconto:\n\n`;

  if (pendentes.drop02.length > 0) {
    msg += `DROP 02 (sugestão −20%):\n`;
    pendentes.drop02.forEach(p => {
      msg += `  • ${p.marca} ${p.nome} (${p.tam})\n`;
      msg += `    R$ ${_fmtNum(p.precoAtual)}  →  R$ ${_fmtNum(p.novoPreco)}\n`;
    });
    msg += '\n';
  }
  if (pendentes.desapego.length > 0) {
    msg += `DESAPEGO FINAL (sugestão −40%):\n`;
    pendentes.desapego.forEach(p => {
      msg += `  • ${p.marca} ${p.nome} (${p.tam})\n`;
      msg += `    R$ ${_fmtNum(p.precoAtual)}  →  R$ ${_fmtNum(p.novoPreco)}\n`;
    });
    msg += '\n';
  }

  msg += 'Para ajustar um valor antes de aplicar, feche esta caixa e edite a\n'
       + 'coluna "Sugestão Drop 02" ou "Sugestão Desapego Final" na planilha.\n\n'
       + 'Confirmar e aplicar agora?';

  const ui   = SpreadsheetApp.getUi();
  const resp = ui.alert('Aplicar descontos', msg, ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  // ── Aplicar ───────────────────────────────────────────────
  const todas = [...pendentes.drop02, ...pendentes.desapego];
  todas.forEach(p => {
    catalogo.getRange(p.rowNum, C['Preço Atual']).setValue(p.novoPreco);
    // Status Drop é fórmula — vai recalcular automaticamente
  });

  ss.toast(`✅ ${todas.length} preço(s) atualizado(s).`, 'Drops aplicados', 5);
}


// ============================================================
//  RESETAR PRA DROP 01 (preço cheio)
//  A dinâmica de desconto progressivo (drop 02 / desapego final) ainda não
//  está ativa — nem na planilha nem no site (ver CONFIG.dropsAtivos no
//  index.html). Isso força Drop Atual/Status Drop/Preço Atual de volta ao
//  estado "recém-cadastrado" pra tudo que já existe no CATALOGO, sem apagar
//  as colunas (ficam como referência pra quando a dinâmica for ativada).
// ============================================================
function resetarParaDropUm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const catalogo = ss.getSheetByName(SHEET_CATALOGO);
  if (!catalogo || catalogo.getLastRow() < 2) {
    _alerta('CATALOGO vazio. Execute "Gerar / Atualizar Catálogo" primeiro.');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    'Resetar pra Drop 01',
    'Isso marca todas as peças do CATALOGO como "Drop 01" (preço cheio da Preço Original), ' +
    'desfazendo qualquer desconto já aplicado. Confirmar?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const lastRow = catalogo.getLastRow();
  const dados = catalogo.getRange(2, 1, lastRow - 1, CAT_HEADERS.length).getValues();

  dados.forEach(row => {
    const precoOriginal = row[C['Preço Original'] - 1];
    row[C['Preço Atual'] - 1] = (precoOriginal && precoOriginal > 0) ? precoOriginal : row[C['Preço Atual'] - 1];
    row[C['Drop Atual'] - 1]  = 'Drop 01';
    row[C['Status Drop'] - 1] = '✓ ok';
  });

  catalogo.getRange(2, 1, dados.length, CAT_HEADERS.length).setValues(dados);
  ss.toast(`✅ ${dados.length} peça(s) resetada(s) pra Drop 01 / preço cheio.`, 'Reset concluído', 6);
}


// ============================================================
//  FORMATAÇÃO DA ABA CATALOGO
// ============================================================
function _formatarCatalogo(sh, nRows) {
  const nCols = CAT_HEADERS.length;

  // Cabeçalho
  sh.getRange(1, 1, 1, nCols)
    .setFontWeight('bold')
    .setBackground('#f2f0eb')
    .setFontColor('#121110')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  if (nRows < 1) { sh.setFrozenRows(1); return; }

  // Preço Original — cinza, somente leitura visual
  sh.getRange(2, C['Preço Original'], nRows)
    .setNumberFormat('R$ #,##0.00')
    .setBackground('#fafaf8')
    .setFontColor('#aaa');

  // Sugestões — azul suave, editável
  sh.getRange(2, C['Sugestão Drop 02'], nRows)
    .setNumberFormat('R$ #,##0.00')
    .setBackground('#e8f0fe');
  sh.getRange(2, C['Sugestão Desapego Final'], nRows)
    .setNumberFormat('R$ #,##0.00')
    .setBackground('#e8f0fe');

  // Preço Atual — negrito, destaque
  sh.getRange(2, C['Preço Atual'], nRows)
    .setNumberFormat('R$ #,##0.00')
    .setFontWeight('bold');

  // Tipo Closet — dropdown
  const tipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Open', 'Closed'], true)
    .setHelpText('Open: nome da influencer visível. Closed: aparece como "anônimo".')
    .build();
  sh.getRange(2, C['Tipo Closet'], nRows).setDataValidation(tipoRule);

  // Congela cabeçalho, ajusta largura
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, nCols);

  // ── Formatação condicional ────────────────────────────────
  const colP = _colLetra(C['Status Drop']);
  const range = sh.getRange(2, 1, nRows, nCols);

  const rules = [
    // Amarelo: drop 02 disponível
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colP}2="⚠️ drop 02 disponível"`)
      .setBackground('#fff9c4')
      .setRanges([range])
      .build(),
    // Laranja: desapego final disponível
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colP}2="🔴 desapego final disponível"`)
      .setBackground('#ffe0b2')
      .setRanges([range])
      .build(),
  ];
  sh.setConditionalFormatRules(rules);
}


// ============================================================
//  HELPERS
// ============================================================

function _parsePreco(val) {
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val || 0).replace(/[R$\s.]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function _parseData(val) {
  // Retorna Date object. Aceita: Date nativo, "01 mar 25", "01/mar/25", "2025-03-01"
  if (val instanceof Date && !isNaN(val)) return val;
  const meses = {
    jan:0, fev:1, mar:2, abr:3, mai:4, jun:5,
    jul:6, ago:7, set:8, out:9, nov:10, dez:11
  };
  const s = String(val || '').toLowerCase().replace(/\./g, '');
  // Tenta padrão dd mmm yy(yy)
  const m = s.match(/(\d{1,2})[^\d]+([a-z]{3})[^\d]*(\d{2,4})/);
  if (m) {
    const mon = meses[m[2]];
    if (mon !== undefined) {
      const yr = parseInt(m[3]) + (parseInt(m[3]) < 100 ? 2000 : 0);
      return new Date(yr, mon, parseInt(m[1]));
    }
  }
  // Tenta ISO ou dd/mm/aaaa
  const d = new Date(val);
  return isNaN(d) ? '' : d;
}

function _calcDias(val) {
  const d = _parseData(val);
  if (!d || !(d instanceof Date) || isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function _fmtNum(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function _colLetra(col) {
  let l = '';
  while (col > 0) {
    l = String.fromCharCode(64 + (col % 26 || 26)) + l;
    col = Math.floor((col - 1) / 26);
  }
  return l;
}

function _alerta(msg) {
  SpreadsheetApp.getUi().alert(msg);
}
