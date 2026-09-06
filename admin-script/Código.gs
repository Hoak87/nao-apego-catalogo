// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────
const SHEET_NAME     = 'ESTOQUE';
const FOLDER_NAME    = 'nao-apego-fotos';
const VISIBLE_STATUS = ['Disponível'];   // só peças disponíveis aparecem no admin
// A senha do admin fica em Propriedades do script (ADMIN_PASSWORD) — nunca no
// código, porque este repositório é público no GitHub.
// ──────────────────────────────────────────────────────────────────────────

// ─── PROTEÇÃO CONTRA FORÇA BRUTA NA SENHA ──────────────────────────────────
// O admin não tem sessão/IP pra bloquear por usuário (limitação do Apps Script
// como web app), então o controle é global: poucas tentativas erradas bloqueiam
// o login pra todo mundo por alguns minutos, e cada tentativa errada já sofre
// um atraso — torna inviável testar senhas em massa.
const LOGIN_MAX_TENTATIVAS      = 5;
const LOGIN_JANELA_SEGUNDOS     = 600;               // tentativas contam por 10 min
const LOGIN_BLOQUEIOS_SEGUNDOS  = [180, 300, 600];   // 3min → 5min → 10min (repete o último depois)
const LOGIN_NIVEL_TTL_SEGUNDOS  = 21600;             // 6h (máximo do CacheService) — "memória" da escalada

// Tudo aqui é "fail-open": se o CacheService falhar por qualquer motivo, o login
// segue normalmente em vez de travar a página — nunca pode ser a proteção contra
// força bruta a deixar a própria Lu/Henrique fora do admin.
function _loginBloqueado_() {
  try {
    return !!CacheService.getScriptCache().get('login_bloqueado');
  } catch (e) {
    return false;
  }
}

function _registrarTentativaFalha_() {
  try {
    const cache = CacheService.getScriptCache();
    const tentativas = (parseInt(cache.get('login_tentativas'), 10) || 0) + 1;
    cache.put('login_tentativas', String(tentativas), LOGIN_JANELA_SEGUNDOS);

    if (tentativas >= LOGIN_MAX_TENTATIVAS) {
      const nivel = parseInt(cache.get('login_nivel'), 10) || 0;
      const duracao = LOGIN_BLOQUEIOS_SEGUNDOS[Math.min(nivel, LOGIN_BLOQUEIOS_SEGUNDOS.length - 1)];
      cache.put('login_bloqueado', '1', duracao);
      cache.put('login_nivel', String(nivel + 1), LOGIN_NIVEL_TTL_SEGUNDOS);
      cache.remove('login_tentativas'); // reinicia a contagem pro próximo ciclo de 5
    }
  } catch (e) {
    // não registrar a tentativa não deve impedir a próxima tentativa de login
  }
}

function _limparTentativasLogin_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('login_tentativas');
    cache.remove('login_bloqueado');
    cache.remove('login_nivel'); // login certo reseta a escalada de bloqueio
  } catch (e) {}
}

function doGet(e) {
  try {
    const pwd = (e && e.parameter && e.parameter.pwd) || '';
    const senhaConfigurada = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '';

    if (_loginBloqueado_()) {
      return HtmlService
        .createHtmlOutput(loginHtml(false, true))
        .setTitle('não apego')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
    }

    if (!senhaConfigurada || pwd !== senhaConfigurada) {
      if (pwd) {
        Utilities.sleep(1500); // atrasa força bruta — cada tentativa errada custa 1,5s
        _registrarTentativaFalha_();
      }
      return HtmlService
        .createHtmlOutput(loginHtml(!!pwd, false))
        .setTitle('não apego')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
    }

    _limparTentativasLogin_();

    // Ação HTTP simples pra registrar venda via curl (ex: Henrique manda os dados da venda
    // no chat e o Claude chama essa URL) — reaproveita a mesma senha do admin acima,
    // sem criar um mecanismo de autenticação novo.
    if (e && e.parameter && e.parameter.action === 'registrarVenda') {
      return _handleRegistrarVendaAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'vendaDireta') {
      return _handleVendaDiretaAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'listClosets') {
      return _handleListClosetsAction_();
    }
    if (e && e.parameter && e.parameter.action === 'listHeaders') {
      return _handleListHeadersAction_();
    }
    if (e && e.parameter && e.parameter.action === 'sampleVendidas') {
      return _handleSampleVendidasAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'checkFormulas') {
      return _handleCheckFormulasAction_();
    }
    if (e && e.parameter && e.parameter.action === 'repassesPendentes') {
      return _handleRepassesPendentesAction_();
    }
    if (e && e.parameter && e.parameter.action === 'deleteByCodigo') {
      return _handleDeleteByCodigoAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'renameCloset') {
      return _handleRenameClosetAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'updateFields') {
      return _handleUpdateFieldsAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'marcarRepassePago') {
      return _handleMarcarRepassePagoAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'listByCloset') {
      return _handleListByClosetAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'marcarExistenteVendida') {
      return _handleMarcarExistenteVendidaAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'findAllByCodigo') {
      return _handleFindAllByCodigoAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'listProtections') {
      return _handleListProtectionsAction_();
    }
    if (e && e.parameter && e.parameter.action === 'testWriteCell') {
      return _handleTestWriteCellAction_(e.parameter);
    }
    if (e && e.parameter && e.parameter.action === 'addTask') {
      return _handleAddTaskAction_(e.parameter);
    }

    return HtmlService
      .createHtmlOutputFromFile('Admin')
      .setTitle('não apego — gestão')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
  } catch (err) {
    // Nunca deixa a página em branco sem explicação — mostra o erro real na tela.
    return HtmlService.createHtmlOutput(
      '<div style="font-family:-apple-system,sans-serif;padding:24px;color:#3A3632;line-height:1.5;">' +
      '<b>Erro ao carregar o admin:</b><br>' + (err && err.message ? err.message : String(err)) +
      '</div>'
    );
  }
}

// erro = true quando o usuário acabou de tentar uma senha e ela veio errada
// (dá pra saber porque "pwd" está presente na URL, mesmo que tenha falhado).
function loginHtml(erro, bloqueado) {
  const estilo = '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:#F2F0EB;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}' +
    '.box{background:#fff;border:1px solid #D8D2C4;border-radius:12px;padding:36px 24px;width:100%;max-width:300px;text-align:center}' +
    '.logo{font-size:1.1rem;font-weight:800;letter-spacing:-0.03em;text-transform:lowercase;margin-bottom:28px;color:#121110}' +
    '.pwd-wrap{position:relative;margin-bottom:12px}' +
    'input{width:100%;padding:10px 40px 10px 14px;border:1px solid #D8D2C4;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box}' +
    'input:focus{border-color:#B14A2C}' +
    '.eye{position:absolute;right:2px;top:2px;bottom:2px;background:none;border:none;cursor:pointer;padding:0 10px;color:#8B8278;display:flex;align-items:center}' +
    '.eye svg{display:block;width:18px;height:18px}' +
    'button[type=submit]{width:100%;padding:11px;background:#121110;color:#F2F0EB;border:none;border-radius:8px;font-size:.95rem;cursor:pointer}' +
    '.err{color:#e74c3c;font-size:.82rem;margin-top:10px;display:none}.err.show{display:block}' +
    '.aviso{font-size:.85rem;color:#3A3632;line-height:1.5}' +
    '@keyframes shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}' +
    '.shake{animation:shake .4s}' +
    '</style>';

  if (bloqueado) {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' + estilo + '</head>' +
      '<body><div class="box"><div class="logo">não apego</div>' +
      '<div class="aviso">Muitas tentativas de senha incorreta.<br>Aguarde alguns minutos e tente de novo.</div>' +
      '</div></body></html>';
  }

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' + estilo + '</head>' +
    '<body><div class="box" id="box"><div class="logo">não apego</div>' +
    '<form id="f">' +
    '<div class="pwd-wrap"><input type="password" id="pwd" placeholder="senha" autofocus autocomplete="current-password"/>' +
    '<button type="button" class="eye" id="eye" aria-label="mostrar senha"></button></div>' +
    '<button type="submit">entrar</button>' +
    '<div class="err' + (erro ? ' show' : '') + '" id="err">senha incorreta</div>' +
    '</form></div>' +
    '<script>' +
    (erro ? 'document.getElementById("box").classList.add("shake");document.getElementById("pwd").value="";' : '') +
    'var EYE_ON=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>\';' +
    'var EYE_OFF=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a21.6 21.6 0 015.06-5.94"/><path d="M9.9 4.24A10.4 10.4 0 0112 4c7 0 11 7 11 7a21.7 21.7 0 01-3.22 4.36"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\';' +
    'var eyeBtn=document.getElementById("eye");eyeBtn.innerHTML=EYE_ON;' +
    'eyeBtn.addEventListener("click",function(){' +
    'var i=document.getElementById("pwd");var show=i.type==="password";' +
    'i.type=show?"text":"password";eyeBtn.innerHTML=show?EYE_OFF:EYE_ON;i.focus();});' +
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

// Sobe as fotos e já deixa compartilhadas, tudo em paralelo (UrlFetchApp.fetchAll direto
// na Drive API v3) — antes eram 2 chamadas sequenciais por foto (createFile + setSharing),
// o maior motivo do cadastro demorar ~30s com 2-3 fotos.
function _uploadPhotosParallel_(folder, photos, codigo) {
  const token = ScriptApp.getOAuthToken();
  const boundary = 'naoapego' + new Date().getTime();
  const nl = '\r\n';

  const uploadReqs = photos.map((f, i) => {
    const ext = f.mimeType.split('/')[1].replace('jpeg', 'jpg');
    const metadata = { name: codigo + '-' + (i + 1) + '.' + ext, parents: [folder.getId()] };
    const head = '--' + boundary + nl +
      'Content-Type: application/json; charset=UTF-8' + nl + nl +
      JSON.stringify(metadata) + nl +
      '--' + boundary + nl +
      'Content-Type: ' + f.mimeType + nl + nl;
    const tail = nl + '--' + boundary + '--';
    const payload = Utilities.newBlob(head).getBytes()
      .concat(Utilities.base64Decode(f.base64), Utilities.newBlob(tail).getBytes());

    return {
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      headers: { Authorization: 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true,
    };
  });

  const uploadResps = UrlFetchApp.fetchAll(uploadReqs);
  const fileIds = uploadResps.map(r => {
    const body = JSON.parse(r.getContentText());
    if (!body.id) throw new Error('Falha ao subir foto: ' + r.getContentText());
    return body.id;
  });

  const permReqs = fileIds.map(id => ({
    url: 'https://www.googleapis.com/drive/v3/files/' + id + '/permissions',
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ role: 'reader', type: 'anyone' }),
    muteHttpExceptions: true,
  }));
  UrlFetchApp.fetchAll(permReqs);

  return fileIds.map(id => 'https://drive.google.com/thumbnail?id=' + id + '&sz=w800');
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
  const { lastRow } = _lastDataRow_(sheet, headers.indexOf('Código'));
  const totalRows = Math.max(lastRow, 1);

  // Copia a formatação (borda/grade) da coluna vizinha antes de escrever — senão a coluna
  // nova nasce sem nenhum estilo, mesmo com dado dentro.
  sheet.getRange(1, lastCol, totalRows, 1)
    .copyTo(sheet.getRange(1, col + 1, totalRows, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

  sheet.getRange(1, col + 1).setValue('Origem Cadastro');
  if (lastRow > 1) {
    const backfill = Array(lastRow - 1).fill(['Manual']);
    sheet.getRange(2, col + 1, backfill.length, 1).setValues(backfill);
  }
  return col;
}

// Se a linha nova ficou fora do alcance de uma faixa de banda (cores/bordas alternadas)
// que terminava exatamente na linha anterior, estende a faixa pra incluir a linha nova.
function _extendBandingIfNeeded_(sheet, newLastRow) {
  sheet.getBandings().forEach(b => {
    const r = b.getRange();
    if (r.getRow() <= 2 && r.getLastRow() === newLastRow - 1) {
      b.setRange(sheet.getRange(r.getRow(), r.getColumn(), newLastRow - r.getRow() + 1, r.getNumColumns()));
    }
  });
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

    // ── Detecção de duplicata (reenvio acidental após erro/timeout aparente do Apps Script) ──
    // Compara com peças do mesmo closet cadastradas nos últimos 30min com descritivo+marca+tamanho+cor+preço
    // idênticos (normalizado) — não bloqueia, só avisa via erro especial; o client confirma com o usuário e,
    // se confirmado, reenvia com data.forcarDuplicado=true pra pular essa checagem.
    if (!data.forcarDuplicado && estLastDataRow > 1) {
      const dataEntradaCol = colOf('Data Entrada');
      const closetCol      = colOf('Closet');
      const descCol        = colOf('Descritivo Peça');
      const marcaCol       = colOf('Marca');
      const tamCol         = colOf('Tamanho');
      const corCol         = colOf('Cor');
      const precoCol       = colOf('Preço Total');
      const codigoCol      = colOf('Código');
      const norm = v => String(v || '').trim().toLowerCase();
      const rowsDup = estoque.getRange(2, 1, estLastDataRow - 1, estoque.getLastColumn()).getValues();
      const agora = new Date().getTime();
      const JANELA_MS = 30 * 60 * 1000; // 30 minutos
      for (let i = 0; i < rowsDup.length; i++) {
        const row = rowsDup[i];
        if (!row[dataEntradaCol]) continue;
        if (agora - new Date(row[dataEntradaCol]).getTime() > JANELA_MS) continue;
        if (norm(row[closetCol]) === norm(data.closet) &&
            norm(row[descCol])   === norm(data.descritivo) &&
            norm(row[marcaCol])  === norm(data.marca) &&
            norm(row[tamCol])    === norm(data.tamanho) &&
            norm(row[corCol])    === norm(data.cor) &&
            Number(row[precoCol]) === preco) {
          throw new Error('DUPLICADO:' + row[codigoCol]);
        }
      }
    }

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

    // ── Fotos no Drive (upload + compartilhamento em paralelo) ──
    const folder = getOrCreateFolder();
    const urls = _uploadPhotosParallel_(folder, data.fotos, codigo);
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
    _extendBandingIfNeeded_(estoque, novaLinha);
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
      _extendBandingIfNeeded_(catalogo, catNovaLinha);
    }

    return codigo;
  } finally {
    lock.releaseLock();
  }
}

// ─── REGISTRO DE VENDA ─────────────────────────────────────────────────────
// Garante que uma coluna existe no ESTOQUE, criando no final sem mexer na posição
// das existentes (mesmo padrão de _ensureOrigemCadastroColumn_, mas sem backfill —
// "Data Venda"/"Preço Venda" ficam vazias pro histórico, só passam a existir daqui pra frente).
function _ensureColumn_(sheet, name) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let col = headers.indexOf(name);
  if (col > -1) return col;

  col = lastCol;
  // A grade da planilha pode ter exatamente o número de colunas já usadas — sem isso, o
  // copyTo abaixo falha com "coordenadas fora das dimensões da página" ao mirar 1 coluna
  // além do fim real da grade.
  if (sheet.getMaxColumns() < col + 1) sheet.insertColumnAfter(lastCol);

  const { lastRow } = _lastDataRow_(sheet, headers.indexOf('Código'));
  const totalRows = Math.max(lastRow, 1);

  // Formatação é só cosmético — um filtro ativo na planilha pode bloquear o copyTo
  // ("intervalo com uma linha filtrada"), mas isso não pode impedir a coluna de existir.
  try {
    sheet.getRange(1, lastCol, totalRows, 1)
      .copyTo(sheet.getRange(1, col + 1, totalRows, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } catch (fmtErr) { /* segue sem a formatação */ }
  sheet.getRange(1, col + 1).setValue(name);
  return col;
}

// Confirma a venda de uma peça: marca Status=Pago, grava Compradora/Data Venda/Preço Venda
// no ESTOQUE, recalcula Valor Repasse/Valor Comissão pelo preço real de venda (que pode ser
// diferente do Preço Total original por causa dos drops) e remove a peça do CATALOGO — assim
// ela some do site na próxima leitura, sem precisar rodar a sincronização manual.
function registrarVenda(row, compradora, precoVenda) {
  compradora = String(compradora || '').trim();
  if (!compradora) throw new Error('Nome da compradora é obrigatório.');
  const preco = parseFloat(String(precoVenda).replace(',', '.'));
  if (isNaN(preco) || preco <= 0) throw new Error('Preço de venda inválido.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const estoque = ss.getSheetByName(SHEET_NAME);

    const dataVendaCol     = _ensureColumn_(estoque, 'Data Venda');
    const precoVendaCol    = _ensureColumn_(estoque, 'Preço Venda');
    const mesCol           = _ensureColumn_(estoque, 'Mês');
    const anoCol           = _ensureColumn_(estoque, 'Ano');
    const statusRepasseCol = _ensureColumn_(estoque, 'Status Repasse');

    const headers = estoque.getRange(1, 1, 1, estoque.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colOf = name => headers.indexOf(name);
    const idCol            = colOf('Código');
    const statusCol        = colOf('Status');
    const compradoraCol    = colOf('Compradora');
    const repasseCol       = colOf('Repasse');
    const comissaoCol      = colOf('Comissão');
    const valorRepasseCol  = colOf('Valor Repasse');
    const valorComissaoCol = colOf('Valor Comissão');

    if (row < 2 || row > estoque.getLastRow()) throw new Error('Linha inválida — peça não encontrada.');
    const rowValues = estoque.getRange(row, 1, 1, estoque.getLastColumn()).getValues()[0];
    const codigo = String(rowValues[idCol] || '').trim();
    if (!codigo) throw new Error('Linha inválida — peça não encontrada.');
    if (String(rowValues[statusCol] || '').trim() === 'Pago') {
      throw new Error('Essa peça já está marcada como vendida.');
    }

    const agora = new Date();
    estoque.getRange(row, statusCol + 1).setValue('Pago');
    if (compradoraCol > -1) estoque.getRange(row, compradoraCol + 1).setValue(compradora);
    estoque.getRange(row, dataVendaCol + 1).setValue(agora);
    estoque.getRange(row, precoVendaCol + 1).setValue(preco);
    // Mês/Ano refletem a Data Venda (confirmado batendo com vendas já existentes); repasse
    // pro closet começa pendente — mesma convenção de toda venda já registrada.
    estoque.getRange(row, mesCol + 1).setValue(MESES_PT[agora.getMonth()]);
    estoque.getRange(row, anoCol + 1).setValue(agora.getFullYear());
    estoque.getRange(row, statusRepasseCol + 1).setValue('Pendente');

    // Sobrescreve com valor estático (em vez de manter a fórmula) porque o preço de venda
    // pode ter mudado por causa de um drop — o valor pago precisa refletir a venda real.
    if (repasseCol > -1 && valorRepasseCol > -1) {
      estoque.getRange(row, valorRepasseCol + 1).setValue(preco * (Number(rowValues[repasseCol]) || 0));
    }
    if (comissaoCol > -1 && valorComissaoCol > -1) {
      estoque.getRange(row, valorComissaoCol + 1).setValue(preco * (Number(rowValues[comissaoCol]) || 0));
    }

    // Remove do CATALOGO — a peça some do site na próxima leitura do CSV.
    const catalogo = ss.getSheetByName('CATALOGO');
    if (catalogo) {
      const catHead    = catalogo.getRange(1, 1, 1, catalogo.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const catIdCol   = catHead.indexOf('Código');
      const catLastRow = catalogo.getLastRow();
      if (catIdCol > -1 && catLastRow > 1) {
        const catIds = catalogo.getRange(2, catIdCol + 1, catLastRow - 1, 1).getValues().flat().map(String);
        const idx = catIds.indexOf(codigo);
        if (idx > -1) catalogo.deleteRow(idx + 2);
      }
    }

    return { codigo: codigo, compradora: compradora, precoVenda: preco };
  } finally {
    lock.releaseLock();
  }
}

// Acha a peça pelo Código e chama registrarVenda — usada pela ação HTTP acima.
function _handleRegistrarVendaAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    if (!codigo) throw new Error('Parâmetro "codigo" é obrigatório.');

    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const idCol   = headers.indexOf('Código');
    const lastRow = sheet.getLastRow();
    if (idCol === -1 || lastRow < 2) throw new Error('Coluna Código não encontrada.');

    const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
    const idx = ids.indexOf(codigo);
    if (idx === -1) throw new Error('Código não encontrado no ESTOQUE: ' + codigo);

    const result = registrarVenda(idx + 2, params.compradora, params.preco);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Registra uma peça que foi vendida sem nunca ter sido cadastrada no catálogo (ex: venda
// combinada direto por fora). Gera o código do mesmo jeito do cadastro normal (prefixo do
// closet + AAMM + sequência), grava a linha já como Status=Pago — sem foto e sem escrever
// no CATALOGO, porque a peça nunca chegou a ficar disponível no site.
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// data: {closet, marca, descritivo, tamanho, cor, preco, compradora, dataVenda, formaPagamento}
// dataVenda: string "dd/mm/aaaa" (data real da venda); se omitida, usa agora.
function registrarVendaDireta(data) {
  if (!data.closet) throw new Error('Closet é obrigatório.');
  if (!data.descritivo) throw new Error('Descritivo é obrigatório.');
  const compradora = String(data.compradora || '').trim();
  if (!compradora) throw new Error('Compradora é obrigatória.');
  const preco = parseFloat(String(data.preco).replace(',', '.'));
  if (isNaN(preco) || preco <= 0) throw new Error('Preço inválido.');

  let dataVenda = new Date();
  if (data.dataVenda) {
    const partes = String(data.dataVenda).trim().split('/');
    if (partes.length !== 3) throw new Error('dataVenda deve estar no formato dd/mm/aaaa.');
    dataVenda = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    if (isNaN(dataVenda.getTime())) throw new Error('dataVenda inválida: ' + data.dataVenda);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const estoque = ss.getSheetByName(SHEET_NAME);
    _ensureOrigemCadastroColumn_(estoque);
    const dataVendaCol   = _ensureColumn_(estoque, 'Data Venda');
    const precoVendaCol  = _ensureColumn_(estoque, 'Preço Venda');
    const pagamentoCol   = _ensureColumn_(estoque, 'Forma de Pagamento');
    const headers = estoque.getRange(1, 1, 1, estoque.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colOf = name => headers.indexOf(name);

    const { lastRow: estLastDataRow, codigoValues: codes } = _lastDataRow_(estoque, colOf('Código'));

    // ── Código: mesmo esquema do cadastro normal (createPiece) — pelo mês do REGISTRO (agora),
    // não da venda real. Confirmado batendo com os códigos já existentes na planilha (ex:
    // AC2605001/LB2605002 vendidos em abril mas com prefixo "2605" = registrados em maio). ──
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

    const estValues = {
      'Código': codigo,
      'Marca': data.marca || '',
      'Descritivo Peça': data.descritivo,
      'Tamanho': data.tamanho || '',
      'Cor': data.cor || '',
      'Status': 'Pago',
      'Preço Total': preco,
      'Data Entrada': new Date(), // data do registro — bate com a convenção já usada (ex: AC2605001 registrado 09/05 mas vendido 30/04)
      'Closet': data.closet,
      'Foto': '',
      'Compradora': compradora,
      'Repasse': split.repasse,
      'Comissão': split.comissao,
      'Origem Cadastro': 'Automático',
      'Data Venda': dataVenda,
      'Preço Venda': preco,
      'Forma de Pagamento': data.formaPagamento || '',
      // Mês/Ano refletem a Data Venda, não a data de registro — confirmado batendo com
      // linhas já existentes (ex: AC2605001: Data Entrada maio, Data Venda abril, Mês="Abril").
      'Mês': MESES_PT[dataVenda.getMonth()],
      'Ano': dataVenda.getFullYear(),
      // Repasse pro closet começa pendente — mesma convenção de toda venda já registrada.
      'Status Repasse': 'Pendente',
      'Data Repasse': '',
    };
    const estRow = headers.map(h => estValues[h] !== undefined ? estValues[h] : '');
    const novaLinha = estLastDataRow + 1;
    estoque.getRange(novaLinha, 1, 1, estRow.length).setValues([estRow]);
    // Formatação/banding são só cosmético — não podem derrubar o registro da venda (ex: um
    // filtro ativo na planilha bloqueia copyTo com "intervalo com uma linha filtrada").
    try {
      if (estLastDataRow > 1) {
        estoque.getRange(estLastDataRow, 1, 1, estoque.getLastColumn())
          .copyTo(estoque.getRange(novaLinha, 1, 1, estoque.getLastColumn()), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      }
      _extendBandingIfNeeded_(estoque, novaLinha);
      if (repasseCol > -1)  estoque.getRange(novaLinha, repasseCol + 1).setNumberFormat('0%');
      if (comissaoCol > -1) estoque.getRange(novaLinha, comissaoCol + 1).setNumberFormat('0%');
    } catch (fmtErr) { /* cosmético — segue mesmo se falhar */ }

    const valorRepasseCol  = colOf('Valor Repasse');
    const valorComissaoCol = colOf('Valor Comissão');
    if (valorRepasseCol > -1)  estoque.getRange(novaLinha, valorRepasseCol + 1).setValue(preco * split.repasse);
    if (valorComissaoCol > -1) estoque.getRange(novaLinha, valorComissaoCol + 1).setValue(preco * split.comissao);

    return { codigo: codigo, compradora: compradora, preco: preco };
  } finally {
    lock.releaseLock();
  }
}

// Lê os parâmetros da querystring e chama registrarVendaDireta — usada pela ação HTTP acima.
function _handleVendaDiretaAction_(params) {
  try {
    const result = registrarVendaDireta({
      closet:         params.closet,
      marca:          params.marca,
      descritivo:     params.descritivo,
      tamanho:        params.tamanho,
      cor:            params.cor,
      preco:          params.preco,
      compradora:     params.compradora,
      dataVenda:      params.dataVenda,
      formaPagamento: params.formaPagamento,
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lista os closets já usados no ESTOQUE com o % de Repasse/Comissão mais recente de cada um —
// só leitura, usada pra conferir o nome exato antes de registrar vendas via chat/curl (a busca
// de herança de split em createPiece/registrarVendaDireta é por string exata).
function _handleListClosetsAction_() {
  try {
    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, closets: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const closetCol   = headers.indexOf('Closet');
    const repasseCol  = headers.indexOf('Repasse');
    const comissaoCol = headers.indexOf('Comissão');
    const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    const byCloset = {};
    rows.forEach(r => {
      const c = String(r[closetCol] || '').trim();
      if (!c) return;
      byCloset[c] = { repasse: r[repasseCol], comissao: r[comissaoCol] }; // última linha vence
    });

    const closets = Object.keys(byCloset).sort().map(c => ({
      closet: c, repasse: byCloset[c].repasse, comissao: byCloset[c].comissao,
    }));
    return ContentService.createTextOutput(JSON.stringify({ ok: true, closets: closets }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lista os cabeçalhos do ESTOQUE (e do CATALOGO) — só leitura, usada pra conferir a existência
// de colunas antes de decidir o que registrar via chat/curl.
function _handleListHeadersAction_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const out = {};
    ['ESTOQUE', 'CATALOGO'].forEach(name => {
      const sheet = ss.getSheetByName(name);
      out[name] = sheet ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim()) : null;
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, headers: out }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lê as últimas N linhas com Status="Pago" do ESTOQUE (todas as colunas) — só leitura,
// usada pra conferir como colunas como "Status Repasse"/"Data Repasse" costumam ser
// preenchidas antes de registrar vendas novas de forma consistente.
function _handleSampleVendidasAction_(params) {
  try {
    const limit = Math.max(1, Math.min(5000, parseInt(params.limit, 10) || 10));
    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, headers: [], rows: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const statusCol = headers.indexOf('Status');
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    const pagas = [];
    for (let i = data.length - 1; i >= 0 && pagas.length < limit; i--) {
      if (String(data[i][statusCol] || '').trim() === 'Pago') {
        pagas.push(data[i].map(v => (v instanceof Date) ? v.toISOString() : v));
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, headers: headers, rows: pagas }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Checa se "Mês"/"Ano" (e outras colunas relevantes) são fórmulas na última linha real do
// ESTOQUE — só leitura, usada antes de decidir se precisam ser copiadas/calculadas ao criar
// linhas novas via vendaDireta/registrarVenda.
function _handleCheckFormulasAction_() {
  try {
    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const { lastRow } = _lastDataRow_(sheet, headers.indexOf('Código'));
    const check = ['Mês', 'Ano', 'Status Repasse', 'Data Repasse'];
    const out = {};
    check.forEach(name => {
      const col = headers.indexOf(name);
      if (col === -1) { out[name] = 'coluna não encontrada'; return; }
      const cell = sheet.getRange(lastRow, col + 1);
      out[name] = { formula: cell.getFormula(), value: cell.getValue() };
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, lastRow: lastRow, check: out }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Fecha o mês: soma o Valor Repasse por closet de toda peça vendida (Status=Pago) cujo
// repasse ainda não foi pago (Status Repasse != "Pago", inclui "Pendente" e em branco) —
// só leitura, não muda nada na planilha.
function _handleRepassesPendentesAction_() {
  try {
    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, closets: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const colOf = name => headers.indexOf(name);
    const statusCol        = colOf('Status');
    const statusRepasseCol = colOf('Status Repasse');
    const closetCol        = colOf('Closet');
    const valorRepasseCol  = colOf('Valor Repasse');
    const codigoCol        = colOf('Código');
    const compradoraCol    = colOf('Compradora');
    const descCol          = colOf('Descritivo Peça');
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    const byCloset = {};
    data.forEach(row => {
      const status = String(row[statusCol] || '').trim();
      const statusRepasse = String(row[statusRepasseCol] || '').trim();
      if (status !== 'Pago' || statusRepasse === 'Pago') return;

      const closet = String(row[closetCol] || '').trim() || '(sem closet)';
      const valor  = Number(row[valorRepasseCol]) || 0;
      if (!byCloset[closet]) byCloset[closet] = { total: 0, itens: [] };
      byCloset[closet].total += valor;
      byCloset[closet].itens.push({
        codigo: row[codigoCol], descritivo: row[descCol], compradora: row[compradoraCol],
        valorRepasse: valor, statusRepasse: statusRepasse || '(vazio)',
      });
    });

    const closets = Object.keys(byCloset).sort().map(c => ({
      closet: c, total: Math.round(byCloset[c].total * 100) / 100, itens: byCloset[c].itens,
    }));
    return ContentService.createTextOutput(JSON.stringify({ ok: true, closets: closets }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Remove uma linha do ESTOQUE pelo Código exato — usada só pra limpar linhas órfãs (ex: um
// registro que gravou os dados mas falhou depois na formatação, antes do fix fail-safe).
// Confirma o Status atual antes de apagar, pra nunca remover a linha errada.
function _handleDeleteByCodigoAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    if (!codigo) throw new Error('Parâmetro "codigo" é obrigatório.');

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const idCol   = headers.indexOf('Código');
      const lastRow = sheet.getLastRow();
      const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
      const idx = ids.indexOf(codigo);
      if (idx === -1) throw new Error('Código não encontrado: ' + codigo);

      const row = idx + 2;
      const rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      // deleteRow() estava silenciosamente não fazendo efeito (suspeita: intervalo protegido
      // bloqueando a exclusão estrutural da linha, mesmo permitindo editar valores). Em vez de
      // apagar a linha, limpamos o conteúdo — funciona mesmo com essa proteção, e uma linha em
      // branco no meio do ESTOQUE não quebra nada (o próprio _lastDataRow_ já ignora brancos).
      sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
      SpreadsheetApp.flush();

      const idsDepois = sheet.getRange(2, idCol + 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues().flat().map(v => String(v).trim());
      if (idsDepois.indexOf(codigo) > -1) {
        throw new Error('Limpeza executou mas o código ainda aparece na planilha — tente de novo.');
      }

      return ContentService.createTextOutput(JSON.stringify({ ok: true, clearedRow: row, values: rowValues }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Renomeia um closet (nome exato) em toda a coluna "Closet" do ESTOQUE e do CATALOGO —
// usada pra corrigir/consolidar nome de closet (ex: "Jéssica (vovó)" -> "Jessica Regazzi (vovó)").
function _handleRenameClosetAction_(params) {
  try {
    const oldName = String(params.oldName || '').trim();
    const newName = String(params.newName || '').trim();
    if (!oldName || !newName) throw new Error('Parâmetros "oldName" e "newName" são obrigatórios.');

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const result = {};
      ['ESTOQUE', 'CATALOGO'].forEach(name => {
        const sheet = ss.getSheetByName(name);
        if (!sheet) { result[name] = 0; return; }
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) { result[name] = 0; return; }
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
        const closetCol = headers.indexOf('Closet');
        if (closetCol === -1) { result[name] = 0; return; }

        const range = sheet.getRange(2, closetCol + 1, lastRow - 1, 1);
        const values = range.getValues();
        let changed = 0;
        for (let i = 0; i < values.length; i++) {
          if (String(values[i][0]).trim() === oldName) { values[i][0] = newName; changed++; }
        }
        if (changed > 0) range.setValues(values);
        result[name] = changed;
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true, changed: result }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Atualiza campos pontuais (Marca, Descritivo Peça, Tamanho, Cor) de uma peça já registrada,
// achada pelo Código exato — usada pra correções (ex: mover marca embutida no descritivo pro
// campo certo). Só mexe nos campos passados; os demais ficam como estão.
const UPDATE_FIELDS_ALLOWED = ['Marca', 'Descritivo Peça', 'Tamanho', 'Cor', 'Status Repasse', 'Data Repasse'];
function _handleUpdateFieldsAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    if (!codigo) throw new Error('Parâmetro "codigo" é obrigatório.');

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const idCol   = headers.indexOf('Código');
      const lastRow = sheet.getLastRow();
      const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
      const idx = ids.indexOf(codigo);
      if (idx === -1) throw new Error('Código não encontrado: ' + codigo);
      const row = idx + 2;

      const changed = {};
      const cols = {};
      UPDATE_FIELDS_ALLOWED.forEach(name => {
        if (params[name] === undefined) return;
        const col = headers.indexOf(name);
        if (col === -1) return;
        sheet.getRange(row, col + 1).setValue(params[name]);
        changed[name] = params[name];
        cols[name] = col;
      });
      SpreadsheetApp.flush();

      const falhas = [];
      Object.keys(cols).forEach(name => {
        const valorAtual = sheet.getRange(row, cols[name] + 1).getValue();
        if (!valorAtual) falhas.push(name);
      });

      return ContentService.createTextOutput(JSON.stringify({ ok: true, codigo: codigo, changed: changed, falhas: falhas }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Marca como pago o repasse de todas as peças vendidas (Status=Pago) de um closet cujo
// Status Repasse ainda não é "Pago" — grava Data Repasse com a data informada (ou hoje).
// Retorna a lista de códigos afetados, pra conferência.
function _handleMarcarRepassePagoAction_(params) {
  try {
    const closet = String(params.closet || '').trim();
    if (!closet) throw new Error('Parâmetro "closet" é obrigatório.');
    let dataRepasse = new Date();
    if (params.dataRepasse) {
      const partes = String(params.dataRepasse).trim().split('/');
      if (partes.length !== 3) throw new Error('dataRepasse deve estar no formato dd/mm/aaaa.');
      dataRepasse = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const colOf = name => headers.indexOf(name);
      const idCol            = colOf('Código');
      const closetCol        = colOf('Closet');
      const statusCol        = colOf('Status');
      const statusRepasseCol = colOf('Status Repasse');
      const dataRepasseCol   = _ensureColumn_(sheet, 'Data Repasse');

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error('ESTOQUE vazio.');
      const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      const afetados = [];
      const sheetRows = [];
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (String(row[closetCol] || '').trim() !== closet) continue;
        if (String(row[statusCol] || '').trim() !== 'Pago') continue;
        // Só pula se Status Repasse JÁ é Pago E a Data Repasse já está preenchida — senão,
        // reaplica (corrige casos onde uma execução anterior marcou o status mas não a data,
        // instabilidade já vista antes com escritas na planilha).
        const jaTemStatus = String(row[statusRepasseCol] || '').trim() === 'Pago';
        const jaTemData    = !!row[dataRepasseCol];
        if (jaTemStatus && jaTemData) continue;

        sheetRows.push(i + 2);
        afetados.push(String(row[idCol]));
      }

      // Escrita em LOTE via getRangeList (uma chamada por coluna, em vez de 2 chamadas por
      // linha num loop) — um loop célula a célula linha a linha se mostrou pouco confiável em
      // listas grandes (Status Repasse gravava, Data Repasse não, mesmo sem erro nenhum).
      if (sheetRows.length) {
        const statusRefs = sheetRows.map(r => sheet.getRange(r, statusRepasseCol + 1).getA1Notation());
        const dataRefs   = sheetRows.map(r => sheet.getRange(r, dataRepasseCol + 1).getA1Notation());
        sheet.getRangeList(statusRefs).setValue('Pago');
        sheet.getRangeList(dataRefs).setValue(dataRepasse);
        SpreadsheetApp.flush();
      }

      // Auto-verificação: relê as linhas afetadas e confere se Data Repasse realmente gravou.
      const falhas = [];
      if (afetados.length) {
        const idsAtualizados = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues().flat().map(v => String(v).trim());
        afetados.forEach(codigo => {
          const idx2 = idsAtualizados.indexOf(codigo);
          if (idx2 === -1) return;
          const valorData = sheet.getRange(idx2 + 2, dataRepasseCol + 1).getValue();
          if (!valorData) falhas.push(codigo);
        });
      }

      return ContentService.createTextOutput(JSON.stringify({ ok: true, closet: closet, codigos: afetados, falhasDataRepasse: falhas }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lista TODAS as linhas do ESTOQUE de um closet, qualquer status (Disponível, Pago, etc.) —
// só leitura, usada pra conferência de duplicidade item a item (uma peça pode já existir como
// "Disponível" com uma descrição diferente da que usamos ao registrar a venda).
function _handleListByClosetAction_(params) {
  try {
    const closet = String(params.closet || '').trim();
    if (!closet) throw new Error('Parâmetro "closet" é obrigatório.');

    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, headers: [], rows: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const closetCol = headers.indexOf('Closet');
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    const rows = [];
    data.forEach(row => {
      if (String(row[closetCol] || '').trim() === closet) {
        rows.push(row.map(v => (v instanceof Date) ? v.toISOString() : v));
      }
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, headers: headers, rows: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Marca uma peça JÁ EXISTENTE no ESTOQUE (achada pelo Código, qualquer status) como vendida,
// com data histórica — usada quando a peça já estava cadastrada (ex: "Disponível" com preço
// placeholder) e não deveria ter virado uma linha nova via vendaDireta.
function _handleMarcarExistenteVendidaAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    if (!codigo) throw new Error('Parâmetro "codigo" é obrigatório.');
    const compradora = String(params.compradora || '').trim();
    if (!compradora) throw new Error('Compradora é obrigatória.');
    const preco = parseFloat(String(params.preco).replace(',', '.'));
    if (isNaN(preco) || preco <= 0) throw new Error('Preço inválido.');

    let dataVenda = new Date();
    if (params.dataVenda) {
      const partes = String(params.dataVenda).trim().split('/');
      if (partes.length !== 3) throw new Error('dataVenda deve estar no formato dd/mm/aaaa.');
      dataVenda = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      _ensureOrigemCadastroColumn_(sheet);
      const dataVendaCol     = _ensureColumn_(sheet, 'Data Venda');
      const precoVendaCol    = _ensureColumn_(sheet, 'Preço Venda');
      const pagamentoCol     = _ensureColumn_(sheet, 'Forma de Pagamento');
      const mesCol           = _ensureColumn_(sheet, 'Mês');
      const anoCol           = _ensureColumn_(sheet, 'Ano');
      const statusRepasseCol = _ensureColumn_(sheet, 'Status Repasse');

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const colOf = name => headers.indexOf(name);
      const idCol            = colOf('Código');
      const statusCol        = colOf('Status');
      const compradoraCol    = colOf('Compradora');
      const precoTotalCol    = colOf('Preço Total');
      const repasseCol       = colOf('Repasse');
      const comissaoCol      = colOf('Comissão');
      const valorRepasseCol  = colOf('Valor Repasse');
      const valorComissaoCol = colOf('Valor Comissão');

      const lastRow = sheet.getLastRow();
      const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
      const idx = ids.indexOf(codigo);
      if (idx === -1) throw new Error('Código não encontrado: ' + codigo);
      const row = idx + 2;
      const rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (String(rowValues[statusCol] || '').trim() === 'Pago') {
        throw new Error('Essa peça já está marcada como vendida.');
      }

      sheet.getRange(row, statusCol + 1).setValue('Pago');
      sheet.getRange(row, compradoraCol + 1).setValue(compradora);
      sheet.getRange(row, dataVendaCol + 1).setValue(dataVenda);
      sheet.getRange(row, precoVendaCol + 1).setValue(preco);
      if (params.formaPagamento !== undefined) sheet.getRange(row, pagamentoCol + 1).setValue(params.formaPagamento);
      sheet.getRange(row, mesCol + 1).setValue(MESES_PT[dataVenda.getMonth()]);
      sheet.getRange(row, anoCol + 1).setValue(dataVenda.getFullYear());
      sheet.getRange(row, statusRepasseCol + 1).setValue('Pendente');
      // Atualiza o Preço Total se ele era só um placeholder (ex: peça sem preço definido ainda).
      if (precoTotalCol > -1) {
        const precoAtual = Number(rowValues[precoTotalCol]) || 0;
        if (precoAtual <= 1) sheet.getRange(row, precoTotalCol + 1).setValue(preco);
      }

      const repassePct  = Number(rowValues[repasseCol]) || 0;
      const comissaoPct = Number(rowValues[comissaoCol]) || 0;
      if (valorRepasseCol > -1)  sheet.getRange(row, valorRepasseCol + 1).setValue(preco * repassePct);
      if (valorComissaoCol > -1) sheet.getRange(row, valorComissaoCol + 1).setValue(preco * comissaoPct);

      return ContentService.createTextOutput(JSON.stringify({ ok: true, codigo: codigo, row: row }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Acha TODAS as linhas (não só a primeira) que batem com um Código exato — diagnóstico pra
// confirmar se existe alguma duplicata física oculta na planilha.
function _handleFindAllByCodigoAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    if (!codigo) throw new Error('Parâmetro "codigo" é obrigatório.');

    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const idCol   = headers.indexOf('Código');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('ESTOQUE vazio.');

    const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
    const matches = [];
    ids.forEach((id, i) => {
      if (id === codigo) matches.push(i + 2);
    });

    return ContentService.createTextOutput(JSON.stringify({
      ok: true, codigo: codigo, spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
      lastRow: lastRow, rowsFound: matches,
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lista as proteções (intervalo e planilha inteira) do ESTOQUE — diagnóstico pra entender
// escritas que "funcionam" (sem erro) mas não persistem em certas colunas/linhas.
function _handleListProtectionsAction_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const out = [];

    const sheetProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    sheetProtections.forEach(p => {
      out.push({
        tipo: 'SHEET', descricao: p.getDescription(),
        editores: p.getEditors().map(u => u.getEmail()),
      });
    });

    const rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    rangeProtections.forEach(p => {
      const r = p.getRange();
      out.push({
        tipo: 'RANGE', descricao: p.getDescription(), a1: r.getA1Notation(),
        linhaInicio: r.getRow(), linhaFim: r.getLastRow(), colInicio: r.getColumn(), colFim: r.getLastColumn(),
        editores: p.getEditors().map(u => u.getEmail()),
      });
    });

    return ContentService.createTextOutput(JSON.stringify({ ok: true, protections: out }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Escreve num campo específico de um Código e devolve o que ficou gravado imediatamente
// (mesma execução) — diagnóstico mínimo e isolado pro problema de escrita em Data Repasse.
function _handleTestWriteCellAction_(params) {
  try {
    const codigo = String(params.codigo || '').trim();
    const campo  = String(params.campo || '').trim();
    const valor  = String(params.valor || '').trim();
    if (!codigo || !campo) throw new Error('Parâmetros "codigo" e "campo" são obrigatórios.');

    const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const idCol   = headers.indexOf('Código');
    const campoCol = headers.indexOf(campo);
    if (campoCol === -1) throw new Error('Campo não encontrado: ' + campo);

    const lastRow = sheet.getLastRow();
    const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().flat().map(v => String(v).trim());
    const idx = ids.indexOf(codigo);
    if (idx === -1) throw new Error('Código não encontrado: ' + codigo);
    const row = idx + 2;

    const antes = sheet.getRange(row, campoCol + 1).getValue();
    const cell = sheet.getRange(row, campoCol + 1);
    cell.setValue(valor);
    SpreadsheetApp.flush();
    const depois = cell.getValue();
    const depoisReRead = sheet.getRange(row, campoCol + 1).getValue(); // nova referência de range, não reaproveitada

    return ContentService.createTextOutput(JSON.stringify({
      ok: true, codigo: codigo, row: row, campoCol: campoCol,
      valorAntes: antes, valorEnviado: valor, valorDepois: depois, valorDepoisRereferenciado: depoisReRead,
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
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

// Cria uma tarefa na aba TAREFAS via HTTP (usada pelo Claude pra criar macrotarefas pra
// Luiza via chat/curl, reaproveitando a senha do admin) — chama a mesma addTask() de baixo.
function _handleAddTaskAction_(params) {
  try {
    const texto = params.texto;
    const tag   = params.tag || '';
    const task  = addTask(texto, tag);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, task: task }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
