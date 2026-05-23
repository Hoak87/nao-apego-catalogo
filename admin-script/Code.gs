// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────
const SHEET_NAME    = 'ESTOQUE';
const FOLDER_NAME   = 'nao-apego-fotos';
const HIDDEN_STATUS = ['Pago', 'Cancelado'];
const ADMIN_PASSWORD = 'naoapego2026'; // troque pela senha que quiser
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
    id:   headers.indexOf('Código'),
    desc: headers.indexOf('Descritivo Peça'),
    brand:headers.indexOf('Marca'),
    size: headers.indexOf('Tamanho'),
    price:headers.findIndex(h => h === 'Preço Total'),
    status: headers.findIndex(h => h === 'Status'),
    foto: headers.indexOf('Foto'),
  };

  const missing = Object.entries(col).filter(([, v]) => v === -1).map(([k]) => k);
  if (missing.length) throw new Error('Colunas não encontradas: ' + missing.join(', '));

  const pieces = [];
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const status = String(row[col.status] || '').trim();
    const foto   = String(row[col.foto]   || '').trim();

    if (HIDDEN_STATUS.includes(status)) continue;
    if (foto) continue; // já tem foto

    pieces.push({
      row:   i + 1,
      id:    row[col.id]    || '',
      desc:  row[col.desc]  || '',
      brand: row[col.brand] || '',
      size:  row[col.size]  || '',
      price: row[col.price] || '',
    });
  }
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
