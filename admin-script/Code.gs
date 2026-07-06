// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────
const SHEET_NAME     = 'ESTOQUE';
const FOLDER_NAME    = 'nao-apego-fotos';
const VISIBLE_STATUS = ['Disponível'];   // só peças disponíveis aparecem no admin
const ADMIN_PASSWORD = 'naoapego2026';  // troque pela senha que quiser
// ──────────────────────────────────────────────────────────────────────────

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
    .setTitle('não apego — fotos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

function loginHtml() {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:#fafaf8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}' +
    '.box{background:#fff;border:1px solid #e8e4df;border-radius:12px;padding:36px 24px;width:100%;max-width:300px;text-align:center}' +
    '.logo{font-size:1.1rem;font-weight:300;letter-spacing:.18em;margin-bottom:28px}' +
    'input{width:100%;padding:10px 14px;border:1px solid #e8e4df;border-radius:8px;font-size:1rem;outline:none;margin-bottom:12px}' +
    'input:focus{border-color:#2d2d2d}' +
    'button{width:100%;padding:11px;background:#2d2d2d;color:#fff;border:none;border-radius:8px;font-size:.95rem;cursor:pointer}' +
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

const ANALYZE_PROMPT =
  'Você está analisando fotos de uma peça de moda feminina de brechó para cadastro em catálogo. ' +
  'As fotos podem incluir a peça (frente/verso) e a etiqueta interna com marca e tamanho.\n\n' +
  'Retorne:\n' +
  '- marca: o nome da marca lido na etiqueta. Se nenhuma etiqueta de marca estiver visível, retorne string vazia — NUNCA chute.\n' +
  '- descritivo: nome curto da peça começando pelo tipo, com iniciais maiúsculas. ' +
  'O tipo deve ser uma destas palavras: Vestido, Blusa, Camiseta, Camisa, Top, Body, Calça, Saia, Shorts, Macacão, ' +
  'Casaco, Jaqueta, Blazer, Colete, Tricô, Bota, Sandália, Sapato, Tênis, Bolsa, Acessório. ' +
  'Exemplos: "Vestido Midi Floral", "Calça Jeans Cintura Alta", "Blusa Ajuste Frontal".\n' +
  '- tamanho: lido na etiqueta (PP, P, M, G, GG ou numérico como 36, 38). Se não visível, string vazia — NUNCA chute.\n' +
  '- cor: cor predominante em português, no feminino quando aplicável. ' +
  'Exemplos: Preta, Branca, Off-white, Bege, Rosa, Vermelha, Laranja, Amarela, Verde, Azul, Jeans, Cinza, Marrom, Roxa, Dourada, Estampada, Animal Print.\n' +
  '- observacoes: detalhes úteis para a lojista revisar: material aparente, estado, detalhes de modelagem, avisos (ex: "etiqueta de tamanho não visível").';

const ANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    marca:       { type: 'string' },
    descritivo:  { type: 'string' },
    tamanho:     { type: 'string' },
    cor:         { type: 'string' },
    observacoes: { type: 'string' },
  },
  required: ['marca', 'descritivo', 'tamanho', 'cor', 'observacoes'],
  additionalProperties: false,
};

// Analisa as fotos com o Claude e retorna {marca, descritivo, tamanho, cor, observacoes}
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
  return JSON.parse(text);
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
    const headers = estoque.getRange(1, 1, 1, estoque.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colOf = name => headers.indexOf(name);

    // ── Código: PREFIXO + AAMM + sequência de 3 dígitos ──
    const yymm = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyMM');
    const prefix = _closetPrefix(data.closet) + yymm;
    const lastRow = estoque.getLastRow();
    const codes = lastRow > 1
      ? estoque.getRange(2, colOf('Código') + 1, lastRow - 1, 1).getValues().flat().map(String)
      : [];
    let seq = 0;
    codes.forEach(c => {
      if (c.indexOf(prefix) === 0) {
        const n = parseInt(c.substring(prefix.length), 10);
        if (!isNaN(n) && n > seq) seq = n;
      }
    });
    const codigo = prefix + ('00' + (seq + 1)).slice(-3);

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

    // ── Linha no ESTOQUE ──
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
    };
    estoque.appendRow(headers.map(h => estValues[h] !== undefined ? estValues[h] : ''));

    // ── Linha no CATALOGO (mesmo formato do gerarCatalogo) ──
    const catalogo = ss.getSheetByName('CATALOGO');
    if (catalogo && catalogo.getLastRow() >= 1) {
      const catHead = catalogo.getRange(1, 1, 1, catalogo.getLastColumn()).getValues()[0].map(h => String(h).trim());
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
      catalogo.appendRow(catHead.map(h => catValues[h] !== undefined ? catValues[h] : ''));
    }

    return codigo;
  } finally {
    lock.releaseLock();
  }
}
