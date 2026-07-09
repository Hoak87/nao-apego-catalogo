// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────
const SHEET_NAME     = 'ESTOQUE';
const FOLDER_NAME    = 'nao-apego-fotos';
const VISIBLE_STATUS = ['Disponível'];   // só peças disponíveis aparecem no admin
const ADMIN_PASSWORD = 'naoapego2026';  // troque pela senha que quiser
// ──────────────────────────────────────────────────────────────────────────

// TEMP — debug do bug "peça não salva na planilha". Remover depois.
function debugInfoBackend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastRowData = lastRow > 1 ? sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  return {
    ssId: ss.getId(),
    ssUrl: ss.getUrl(),
    estoqueLastRow: lastRow,
    estoqueLastRowData: lastRowData,
  };
}

function doGet(e) {
  const pwd = (e && e.parameter && e.parameter.pwd) || '';

  if (pwd !== ADMIN_PASSWORD) {
    return HtmlService
      .createHtmlOutput(loginHtml())
      .setTitle('não apego')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }

  return HtmlService
    .createHtmlOutputFromFile('Admin')
    .setTitle('não apego — gestão')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

function loginHtml() {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:#F2F0EB;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}' +
    '.box{background:#fff;border:1px solid #D8D2C4;border-radius:12px;padding:36px 24px;width:100%;max-width:300px;text-align:center}' +
    '.logo{font-size:1.1rem;font-weight:800;letter-spacing:-0.03em;text-transform:lowercase;margin-bottom:28px;color:#121110}' +
    'input{width:100%;padding:10px 14px;border:1px solid #D8D2C4;border-radius:8px;font-size:1rem;outline:none;margin-bottom:12px}' +
    'input:focus{border-color:#B14A2C}' +
    'button{width:100%;padding:11px;background:#121110;color:#F2F0EB;border:none;border-radius:8px;font-size:.95rem;cursor:pointer}' +
    '.err{color:#e74c3c;font-size:.82rem;margin-top:10px;display:none}</style></head>' +
    '<body><div class="box"><div class="logo">não apego</div>' +
    '<form id="f"><input type="password" id="pwd" placeholder="senha" autofocus/>' +
    '<button type="submit">entrar</button>' +
    '<div class="err" id="err">senha incorreta</div></form></div>' +
    '<script>' +
    'if(location.search.includes("wrong=1"))document.getElementById("err").style.display="block";' +
    'document.getElementById("f").addEventListener("submit",function(e){' +
    'e.preventDefault();var p=document.getElementById("pwd").value;if(!p)return;' +
    'location.href=location.href.split("?")[0]+"?pwd="+encodeURIComponent(p);})' +
    '</script></body></html>';
}

function getPieces() {
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  const col = {
    id:     headers.indexOf('Código'),
    desc:   headers.indexOf('Descritivo Peça'),
    brand:  headers.indexOf('Marca'),
    size:   headers.indexOf('Tamanho'),
    price:  headers.findIndex(h => h === 'Preço Total'),
    status: headers.findIndex(h => h === 'Status'),
    foto:   headers.indexOf('Foto'),
    closet: headers.indexOf('Closet'),
  };

  const missing = Object.entries(col).filter(([, v]) => v === -1).map(([k]) => k);
  if (missing.length) throw new Error('Colunas não encontradas: ' + missing.join(', '));

  const pieces = [];
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[col.status] || '').trim();
    const foto   = String(row[col.foto]   || '').trim();

    if (!VISIBLE_STATUS.includes(status)) continue; // só disponíveis

    pieces.push({
      row:      i + 1,
      id:       row[col.id]     || '',
      desc:     row[col.desc]   || '',
      brand:    row[col.brand]  || '',
      size:     row[col.size]   || '',
      price:    row[col.price]  || '',
      closet:   row[col.closet] || 'Sem closet',
      hasPhoto: !!foto,
      photoUrl: foto ? foto.split('|')[0].trim() : '',
    });
  }

  // Ordena por closet para facilitar o agrupamento no front
  pieces.sort((a, b) => a.closet.localeCompare(b.closet, 'pt-BR'));
  return pieces;
}

function savePhoto(rowIndex, base64Data, mimeType, pieceId) {
  const folder   = getOrCreateFolder();
  const ext      = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const fileName = pieceId + '.' + ext;

  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';

  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                      .map(h => String(h).trim());
  const fotoCol = headers.indexOf('Foto') + 1;

  sheet.getRange(rowIndex, fotoCol).setValue(url);
  return url;
}

function getOrCreateFolder() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

// ─── CADASTRO DE PEÇAS COM IA ─────────────────────────────────────────────
// Chave em: Extensões → Apps Script → Configurações do projeto →
// Propriedades do script → ANTHROPIC_API_KEY
const ANTHROPIC_MODEL = 'claude-haiku-4-5';

// Mesmos valores usados pelo dicionário do site (index.html: TIPO_KEYWORDS / COLOR_MAP).
// Forçar a IA a escolher só entre esses valores (via enum) garante que o catálogo público
// sempre bate com os filtros do site — sem depender de normalização de texto livre depois.
const TIPOS_PECA = ['Vestido', 'Blusa', 'Camiseta', 'Camisa', 'Top', 'Body', 'Calça', 'Saia', 'Shorts', 'Macacão',
  'Casaco', 'Jaqueta', 'Blazer', 'Colete', 'Tricô', 'Bota', 'Sandália', 'Sapato', 'Tênis', 'Bolsa', 'Acessório'];
const CORES_CATALOGO = ['Animal Print', 'Estampado / Floral', 'Jeans', 'Preto', 'Branco', 'Off-white / Cru',
  'Bege / Nude', 'Rosa', 'Vermelho / Vinho', 'Laranja', 'Amarelo / Mostarda', 'Verde', 'Azul', 'Cinza',
  'Marrom / Terra', 'Roxo / Lilás', 'Dourado / Prata'];

const ANALYZE_PROMPT =
  'Você está analisando fotos de uma peça de moda feminina de brechó para cadastro em catálogo. ' +
  'As fotos podem incluir a peça (frente/verso) e a etiqueta interna com marca e tamanho.\n\n' +
  'Retorne:\n' +
  '- marca: o nome da marca lido na etiqueta. Se nenhuma etiqueta de marca estiver visível, retorne string vazia — NUNCA chute.\n' +
  '- tipo: o tipo da peça, escolhido estritamente entre as opções do enum.\n' +
  '- detalhe: 2 a 4 palavras curtas complementando o tipo (material, estampa, corte), com iniciais maiúsculas — não repita o tipo aqui. ' +
  'Exemplos: "Midi Floral", "Jeans Cintura Alta", "Ajuste Frontal", "Puffer Brilhante".\n' +
  '- tamanho: lido na etiqueta (PP, P, M, G, GG ou numérico como 36, 38). Se não visível, string vazia — NUNCA chute.\n' +
  '- cor: a opção do enum mais próxima da cor predominante da peça. Se genuinamente não der pra identificar, string vazia.\n' +
  '- observacoes: detalhes úteis para a lojista revisar: material aparente, estado, detalhes de modelagem, avisos (ex: "etiqueta de tamanho não visível").';

const ANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    marca:       { type: 'string' },
    tipo:        { type: 'string', enum: TIPOS_PECA },
    detalhe:     { type: 'string' },
    tamanho:     { type: 'string' },
    cor:         { type: 'string', enum: CORES_CATALOGO.concat(['']) },
    observacoes: { type: 'string' },
  },
  required: ['marca', 'tipo', 'detalhe', 'tamanho', 'cor', 'observacoes'],
  additionalProperties: false,
};

// Analisa as fotos com o Claude e retorna {marca, descritivo, tamanho, cor, observacoes}
// (descritivo já vem composto como "tipo + detalhe", ex: "Jaqueta Puffer Brilhante")
function analyzeNewPiece(photos) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Chave da IA não configurada. Adicione ANTHROPIC_API_KEY nas Propriedades do script.');

  const content = photos.map(p => ({
    type: 'image',
    source: { type: 'base64', media_type: p.mimeType, data: p.base64 },
  }));
  content.push({ type: 'text', text: ANALYZE_PROMPT });

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: ANALYZE_SCHEMA } },
      messages: [{ role: 'user', content: content }],
    }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());
  if (code !== 200) {
    throw new Error('Erro na análise (' + code + '): ' + ((body.error && body.error.message) || 'desconhecido'));
  }
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);
  return {
    marca: parsed.marca,
    descritivo: (parsed.tipo + (parsed.detalhe ? ' ' + parsed.detalhe : '')).trim(),
    tamanho: parsed.tamanho,
    cor: parsed.cor,
    observacoes: parsed.observacoes,
  };
}

// ─── CADASTRO POR DITADO (texto) ───────────────────────────────────────────
// Mesma chave/modelo de analyzeNewPiece — só muda a entrada (texto ditado no
// teclado do celular em vez de fotos) e o schema (aqui dá pra extrair preço também).
const ANALYZE_TEXT_PROMPT =
  'Você está extraindo dados de uma peça de brechó (moda feminina) a partir de uma descrição falada/ditada em português.\n\n' +
  'Retorne:\n' +
  '- marca: nome da marca, se mencionada. Se não, string vazia — NUNCA chute.\n' +
  '- tipo: o tipo da peça, escolhido estritamente entre as opções do enum.\n' +
  '- detalhe: 2 a 4 palavras curtas complementando o tipo (material, estampa, corte), com iniciais maiúsculas — não repita o tipo aqui. ' +
  'Exemplo: em "jaqueta bomber preta com brilho", tipo="Jaqueta", detalhe="Bomber Brilhante".\n' +
  '- tamanho: se mencionado (PP, P, M, G, GG ou numérico). Se não, string vazia.\n' +
  '- cor: a opção do enum mais próxima da cor mencionada. Se não mencionada, string vazia.\n' +
  '- preco: apenas o número mencionado, sem "R$" nem "reais" (ex: "200 reais" → "200"). Se não mencionado, string vazia.\n' +
  '- observacoes: detalhes extras mencionados que não couberam nos campos acima (ex: "com brilho" quando não cabe na cor).';

const ANALYZE_TEXT_SCHEMA = {
  type: 'object',
  properties: {
    marca:       { type: 'string' },
    tipo:        { type: 'string', enum: TIPOS_PECA },
    detalhe:     { type: 'string' },
    tamanho:     { type: 'string' },
    cor:         { type: 'string', enum: CORES_CATALOGO.concat(['']) },
    preco:       { type: 'string' },
    observacoes: { type: 'string' },
  },
  required: ['marca', 'tipo', 'detalhe', 'tamanho', 'cor', 'preco', 'observacoes'],
  additionalProperties: false,
};

// Extrai os campos da peça a partir de um texto ditado (ex: teclado do iPhone → campo de texto).
function analyzeVoiceText(texto) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Chave da IA não configurada. Adicione ANTHROPIC_API_KEY nas Propriedades do script.');

  texto = String(texto || '').trim();
  if (!texto) throw new Error('Descrição vazia.');

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      output_config: { format: { type: 'json_schema', schema: ANALYZE_TEXT_SCHEMA } },
      messages: [{ role: 'user', content: ANALYZE_TEXT_PROMPT + '\n\nDescrição: "' + texto + '"' }],
    }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());
  if (code !== 200) {
    throw new Error('Erro na extração (' + code + '): ' + ((body.error && body.error.message) || 'desconhecido'));
  }
  const text2 = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text2);
  return {
    marca: parsed.marca,
    descritivo: (parsed.tipo + (parsed.detalhe ? ' ' + parsed.detalhe : '')).trim(),
    tamanho: parsed.tamanho,
    cor: parsed.cor,
    preco: parsed.preco,
    observacoes: parsed.observacoes,
  };
}

// Prefixo do código a partir das iniciais do closet: "Bea Romano" → BR
function _closetPrefix(closet) {
  const clean = String(closet).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const prefix = words.length >= 2 ? words[0][0] + words[1][0] : clean.substring(0, 2);
  return prefix.toUpperCase();
}

// Cria a peça: gera código, sobe fotos, grava no ESTOQUE e no CATALOGO.
// data: {closet, marca, descritivo, tamanho, cor, preco, fotos: [{base64, mimeType}]}
// Acha a última linha REAL de dados pela coluna Código, em vez de confiar em
// getLastRow()/appendRow() — o ESTOQUE tem formatação/validação residual bem
// abaixo dos dados que infla o "último uso" do sheet e fazia appendRow() gravar
// milhares de linhas depois do fim de verdade (e também deixava tudo mais lento).
function _lastDataRow_(sheet, codigoColIndex) {
  const sheetLastRow = sheet.getLastRow();
  if (sheetLastRow < 2) return { lastRow: 1, codigoValues: [] };
  const codigoValues = sheet.getRange(2, codigoColIndex + 1, sheetLastRow - 1, 1).getValues().flat().map(String);
  let lastRow = 1;
  codigoValues.forEach((c, i) => { if (c.trim()) lastRow = i + 2; });
  return { lastRow: lastRow, codigoValues: codigoValues };
}

// Copia a fórmula da linha de cima pra "Valor Repasse"/"Valor Comissão" (o Sheets ajusta as
// referências relativas sozinho, igual acontece ao inserir uma linha manualmente). Se a linha
// de cima não tiver fórmula (só valor estático), calcula direto em vez de copiar um número errado.
function _copyOrComputeValorCol_(sheet, sourceRow, targetRow, colIndex, computedValue) {
  if (colIndex < 0) return;
  const targetCell = sheet.getRange(targetRow, colIndex + 1);
  if (sourceRow > 1) {
    const sourceCell = sheet.getRange(sourceRow, colIndex + 1);
    if (sourceCell.getFormula()) {
      sourceCell.copyTo(targetCell);
      return;
    }
    const fmt = sourceCell.getNumberFormat();
    if (fmt) targetCell.setNumberFormat(fmt);
  }
  targetCell.setValue(computedValue);
}

// Garante que a coluna "Origem Cadastro" existe no ESTOQUE (cria no final, sem mexer na
// posição das colunas existentes) e marca todo o histórico já presente como "Manual" —
// tudo que for cadastrado por essa ferramenta a partir de agora vai virar "Automático".
// Roda sozinha e uma única vez, na primeira peça cadastrada após o deploy (idempotente).
function _ensureOrigemCadastroColumn_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let col = headers.indexOf('Origem Cadastro');
  if (col > -1) return col;

  col = lastCol; // próxima coluna livre (0-indexado)
  sheet.getRange(1, col + 1).setValue('Origem Cadastro');

  const { lastRow } = _lastDataRow_(sheet, headers.indexOf('Código'));
  if (lastRow > 1) {
    const backfill = Array(lastRow - 1).fill(['Manual']);
    sheet.getRange(2, col + 1, backfill.length, 1).setValues(backfill);
  }
  return col;
}

function createPiece(data) {
  if (!data.closet) throw new Error('Closet é obrigatório.');
  if (!data.descritivo) throw new Error('Descritivo é obrigatório.');
  const preco = parseFloat(String(data.preco).replace(',', '.'));
  if (isNaN(preco) || preco <= 0) throw new Error('Preço inválido.');
  if (!data.fotos || !data.fotos.length) throw new Error('Adicione pelo menos uma foto.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const estoque = ss.getSheetByName(SHEET_NAME);
    _ensureOrigemCadastroColumn_(estoque);
    const headers = estoque.getRange(1, 1, 1, estoque.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colOf = name => headers.indexOf(name);

    const { lastRow: estLastDataRow, codigoValues: codes } = _lastDataRow_(estoque, colOf('Código'));

    // ── Código: PREFIXO + AAMM + sequência de 3 dígitos ──
    const yymm = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyMM');
    const prefix = _closetPrefix(data.closet) + yymm;
    let seq = 0;
    codes.forEach(c => {
      if (c.indexOf(prefix) === 0) {
        const n = parseInt(c.substring(prefix.length), 10);
        if (!isNaN(n) && n > seq) seq = n;
      }
    });
    const codigo = prefix + ('00' + (seq + 1)).slice(-3);

    // ── Repasse/Comissão: herda a mesma % já usada por esse closet; padrão 60/40 se for closet novo ──
    const repasseCol  = colOf('Repasse');
    const comissaoCol = colOf('Comissão');
    const closetCol   = colOf('Closet');
    let split = { repasse: 0.6, comissao: 0.4 };
    if (repasseCol > -1 && comissaoCol > -1 && closetCol > -1 && estLastDataRow > 1) {
      const rows = estoque.getRange(2, 1, estLastDataRow - 1, estoque.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][closetCol]).trim() === data.closet) {
          split = { repasse: rows[i][repasseCol], comissao: rows[i][comissaoCol] };
          break;
        }
      }
    }

    // ── Fotos no Drive ──
    const folder = getOrCreateFolder();
    const urls = data.fotos.map((f, i) => {
      const ext = f.mimeType.split('/')[1].replace('jpeg', 'jpg');
      const blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mimeType, codigo + '-' + (i + 1) + '.' + ext);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
    });
    const fotoStr = urls.join('|');

    // ── Linha no ESTOQUE (escrita na linha real seguinte, não no getLastRow() do sheet) ──
    const estValues = {
      'Código': codigo,
      'Marca': data.marca || '',
      'Descritivo Peça': data.descritivo,
      'Tamanho': data.tamanho || '',
      'Cor': data.cor || '',
      'Status': 'Disponível',
      'Preço Total': preco,
      'Data Entrada': new Date(),
      'Closet': data.closet,
      'Foto': fotoStr,
      'Repasse': split.repasse,
      'Comissão': split.comissao,
      'Origem Cadastro': 'Automático',
    };
    const estRow = headers.map(h => estValues[h] !== undefined ? estValues[h] : '');
    const novaLinha = estLastDataRow + 1;
    estoque.getRange(novaLinha, 1, 1, estRow.length).setValues([estRow]);
    // Copia só a formatação (bordas, grade, cor, número) da linha de cima — sem mexer nos valores.
    if (estLastDataRow > 1) {
      estoque.getRange(estLastDataRow, 1, 1, estoque.getLastColumn())
        .copyTo(estoque.getRange(novaLinha, 1, 1, estoque.getLastColumn()), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
    if (repasseCol > -1)  estoque.getRange(novaLinha, repasseCol + 1).setNumberFormat('0%');
    if (comissaoCol > -1) estoque.getRange(novaLinha, comissaoCol + 1).setNumberFormat('0%');

    // ── Valor Repasse/Valor Comissão: mesma fórmula da linha de cima (copia e o Sheets
    // ajusta as referências sozinho); se a linha de cima não tiver fórmula, calcula direto. ──
    const valorRepasseCol  = colOf('Valor Repasse');
    const valorComissaoCol = colOf('Valor Comissão');
    _copyOrComputeValorCol_(estoque, estLastDataRow, novaLinha, valorRepasseCol, preco * split.repasse);
    _copyOrComputeValorCol_(estoque, estLastDataRow, novaLinha, valorComissaoCol, preco * split.comissao);

    // ── Linha no CATALOGO (mesmo formato do gerarCatalogo) — sem dados financeiros ──
    const catalogo = ss.getSheetByName('CATALOGO');
    if (catalogo && catalogo.getLastRow() >= 1) {
      const catHead = catalogo.getRange(1, 1, 1, catalogo.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const { lastRow: catLastDataRow } = _lastDataRow_(catalogo, catHead.indexOf('Código'));
      const catValues = {
        'Código': codigo,
        'Marca': data.marca || '',
        'Descritivo Peça': data.descritivo,
        'Tamanho': data.tamanho || '',
        'Cor': data.cor || '',
        'Status': 'Disponível',
        'Data Entrada': new Date(),
        'Closet': data.closet,
        'Tipo Closet': 'Open',
        'Foto': fotoStr,
        'Preço Original': preco,
        'Sugestão Drop 02': Math.round(preco * 0.8 / 10) * 10,
        'Sugestão Desapego Final': Math.round(preco * 0.6 / 10) * 10,
        'Preço Atual': preco,
        'Drop Atual': 'Drop 01',
        'Status Drop': '✓ ok',
      };
      const catRow = catHead.map(h => catValues[h] !== undefined ? catValues[h] : '');
      const catNovaLinha = catLastDataRow + 1;
      catalogo.getRange(catNovaLinha, 1, 1, catRow.length).setValues([catRow]);
      if (catLastDataRow > 1) {
        catalogo.getRange(catLastDataRow, 1, 1, catalogo.getLastColumn())
          .copyTo(catalogo.getRange(catNovaLinha, 1, 1, catalogo.getLastColumn()), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      }
    }

    return codigo;
  } finally {
    lock.releaseLock();
  }
}

// ─── HOME: ESTATÍSTICAS ────────────────────────────────────────────────────
function getHomeStats() {
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  const col = {
    status:     headers.indexOf('Status'),
    foto:       headers.indexOf('Foto'),
    closet:     headers.indexOf('Closet'),
    compradora: headers.indexOf('Compradora'),
  };

  let disponiveis = 0, semFoto = 0, vendidas = 0;
  const closets = new Set();
  const compradoras = new Set();

  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[col.status] || '').trim();
    const foto   = String(row[col.foto]   || '').trim();
    const closet = String(row[col.closet] || '').trim();
    const compradora = col.compradora > -1 ? String(row[col.compradora] || '').trim() : '';

    if (status === 'Disponível') {
      disponiveis++;
      if (!foto) semFoto++;
    }
    if (status === 'Pago') vendidas++;
    if (closet) closets.add(closet);
    if (compradora) compradoras.add(compradora);
  }

  return {
    disponiveis: disponiveis,
    semFoto: semFoto,
    // sem recorte por mês — ESTOQUE ainda não tem "Data Venda" confiável (ver Fase 2 do plano)
    vendidasMes: vendidas,
    closets: closets.size,
    compradoras: compradoras.size,
  };
}

// ─── TAREFAS ────────────────────────────────────────────────────────────────
const TASKS_SHEET = 'TAREFAS';

function getOrCreateTarefasSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TASKS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TASKS_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Id', 'Texto', 'Tag', 'Feita', 'Criada em', 'Concluída em']]);
  }
  return sheet;
}

function getTasks() {
  const sheet = getOrCreateTarefasSheet_();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const col = {
    id:        headers.indexOf('Id'),
    texto:     headers.indexOf('Texto'),
    tag:       headers.indexOf('Tag'),
    feita:     headers.indexOf('Feita'),
    criada:    headers.indexOf('Criada em'),
    concluida: headers.indexOf('Concluída em'),
  };

  return data.slice(1)
    .filter(row => row[col.id])
    .map(row => ({
      id:          String(row[col.id]),
      texto:       row[col.texto] || '',
      tag:         row[col.tag] || '',
      feita:       row[col.feita] === true,
      criadaEm:    row[col.criada]    ? new Date(row[col.criada]).toISOString()    : '',
      concluidaEm: row[col.concluida] ? new Date(row[col.concluida]).toISOString() : '',
    }));
}

// Cria uma nova tarefa pendente. tag é opcional (string livre, ex: "fotos", "financeiro").
function addTask(texto, tag) {
  texto = String(texto || '').trim();
  if (!texto) throw new Error('Texto da tarefa é obrigatório.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet    = getOrCreateTarefasSheet_();
    const id       = Utilities.getUuid();
    const criadaEm = new Date();
    sheet.appendRow([id, texto, tag || '', false, criadaEm, '']);
    return { id: id, texto: texto, tag: tag || '', feita: false, criadaEm: criadaEm.toISOString(), concluidaEm: '' };
  } finally {
    lock.releaseLock();
  }
}

// Alterna feito/pendente e grava a data de conclusão (usada para decidir o que some da home no dia seguinte).
function toggleTask(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet   = getOrCreateTarefasSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('Tarefa não encontrada.');

    const data    = sheet.getRange(1, 1, lastRow, 6).getValues();
    const headers = data[0].map(h => String(h).trim());
    const idCol        = headers.indexOf('Id');
    const feitaCol      = headers.indexOf('Feita');
    const concluidaCol  = headers.indexOf('Concluída em');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(id)) {
        const novoFeita    = !data[i][feitaCol];
        const concluidaEm  = novoFeita ? new Date() : '';
        sheet.getRange(i + 1, feitaCol + 1).setValue(novoFeita);
        sheet.getRange(i + 1, concluidaCol + 1).setValue(concluidaEm);
        return { feita: novoFeita, concluidaEm: novoFeita ? concluidaEm.toISOString() : '' };
      }
    }
    throw new Error('Tarefa não encontrada.');
  } finally {
    lock.releaseLock();
  }
}

// Remove definitivamente as tarefas já concluídas (botão "limpar" na tela de Tarefas).
function clearCompletedTasks() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet   = getOrCreateTarefasSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;

    const data    = sheet.getRange(1, 1, lastRow, 6).getValues();
    const headers = data[0].map(h => String(h).trim());
    const feitaCol = headers.indexOf('Feita');

    let removed = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][feitaCol] === true) {
        sheet.deleteRow(i + 1);
        removed++;
      }
    }
    return removed;
  } finally {
    lock.releaseLock();
  }
}
