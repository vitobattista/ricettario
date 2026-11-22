/**
 * Ricettario — ponte Google (Apps Script)
 * ---------------------------------------
 * L'app è su GitHub Pages; questo script è il ponte verso Google:
 *   - custodisce le ricette su Drive (ricette.json) e nel Foglio "Ricettario"
 *   - legge i siti di ricette e le descrizioni dei reel di Instagram
 *   - fa l'OCR delle foto
 * Il progetto Apps Script contiene solo questo file e appsscript.json.
 *
 * Accessi richiesti (vedi appsscript.json):
 *   - drive.file        → l'app vede SOLO i file che ha creato lei. Il resto del tuo Drive le è invisibile.
 *   - external_request  → per leggere siti di ricette e reel di Instagram.
 *
 * Cartella "Ricettario" nel tuo Drive, creata dall'app:
 *   ├─ ricette.json   archivio principale
 *   └─ Ricettario     Foglio Google con una riga per ricetta, aggiornato a ogni salvataggio
 *
 * Lettura delle foto: OCR di Google Drive. L'immagine viene caricata come documento temporaneo
 * nella stessa cartella, se ne legge il testo e il documento viene eliminato subito.
 * Le immagini non vengono conservate.
 *
 * Tutte le chiamate a Drive e Fogli passano dalle API REST con il token dell'app:
 * niente DriveApp, SpreadsheetApp o DocumentApp, che richiederebbero l'accesso completo.
 */

const APP_NAME = 'Ricettario';
const DATA_NAME = 'ricette.json';
const SHEET_NAME = 'Ricettario';
const COLS = ['id', 'titolo', 'tipo', 'tempo_min', 'porzioni', 'difficolta', 'ingredienti', 'passaggi', 'note', 'fonte_tipo', 'fonte_url', 'stato', 'preferita', 'creata', 'modificata'];
const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const MIME_DOC = 'application/vnd.google-apps.document';

/* ============================== Ponte per l'app ============================== */
/*
 * L'app chiama questo script con richieste POST in testo semplice:
 *   { codice: "<codice di accesso>", fn: "saveRecipe", args: [ ... ] }
 * e riceve JSON: { ok: true, result: ... } oppure { ok: false, error: "..." }.
 *
 * L'app web è pubblicata con accesso "Chiunque" perché GitHub Pages possa raggiungerla,
 * ma senza il codice di accesso giusto non legge né scrive nulla.
 * Il codice si genera con impostaCodice() e sta nelle Proprietà script (TOKEN):
 * non va mai scritto nel repository GitHub.
 */

const API_ = {
  ping: function () { return { app: 'Ricettario', version: 4 }; },
  getRecipes: getRecipes,
  saveRecipe: saveRecipe,
  deleteRecipe: deleteRecipe,
  replaceAll: replaceAll,
  getSheetRows: getSheetRows,
  getSettings: getSettings,
  fetchRecipeUrl: fetchRecipeUrl,
  transcribeImages: transcribeImages
};

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Richiesta non valida.' }); }
  if (!checkCodice_(req.codice)) return json_({ ok: false, auth: false, error: 'Codice di accesso non valido: controllalo nelle Impostazioni dell’app.' });
  const fn = API_[req.fn];
  if (!fn) return json_({ ok: false, error: 'Funzione sconosciuta: ' + req.fn });
  try {
    return json_({ ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json_({ ok: true, app: 'Ricettario', message: 'Ponte attivo. Apri l\'app dal sito GitHub Pages.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Confronto a tempo costante; dopo 20 tentativi sbagliati in 10 minuti il ponte si blocca per 10 minuti. */
function checkCodice_(given) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('FAILS') || 0);
  if (fails >= 20) { Utilities.sleep(1500); return false; }
  const real = props_().getProperty('TOKEN') || '';
  given = String(given || '').trim().toUpperCase();
  let diff = real.length > 0 && real.length === given.length ? 0 : 1;
  if (!diff) for (let i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff === 0) { if (fails) cache.remove('FAILS'); return true; }
  cache.put('FAILS', String(fails + 1), 600);
  Utilities.sleep(800);
  return false;
}

/**
 * Genera un nuovo codice di accesso (12 caratteri) e lo scrive nel Registro di esecuzione.
 * Il codice precedente smette subito di funzionare su tutti i dispositivi.
 */
function impostaCodice() {
  const codice = Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  props_().setProperty('TOKEN', codice);
  Logger.log('Nuovo codice di accesso: ' + codice + '\nInseriscilo nell\'app: Impostazioni › Codice di accesso.');
  return codice;
}

/* ============================== Chiamate REST a Google ============================== */

function api_(method, url, opts) {
  opts = opts || {};
  const params = {
    method: method,
    muteHttpExceptions: true,
    headers: Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, opts.headers || {})
  };
  if (opts.json !== undefined) { params.contentType = 'application/json'; params.payload = JSON.stringify(opts.json); }
  if (opts.payload !== undefined) { params.payload = opts.payload; if (opts.contentType) params.contentType = opts.contentType; }
  const res = UrlFetchApp.fetch(url, params);
  const code = res.getResponseCode();
  if (code >= 300) {
    let msg = res.getContentText();
    try { const er = JSON.parse(msg).error; msg = er.message + (er.errors && er.errors[0] && er.errors[0].reason ? ' · ' + er.errors[0].reason : ''); } catch (e) { /* testo grezzo */ }
    throw new Error('Google Drive (' + code + '): ' + String(msg).slice(0, 200));
  }
  return opts.raw ? res : (res.getContentText() ? JSON.parse(res.getContentText()) : {});
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

function props_() { return PropertiesService.getScriptProperties(); }

/** Restituisce l'id di un file creato dall'app: dalle proprietà, cercandolo, o creandolo. */
const SEEN_ = {}; // id già verificati in questa esecuzione
function ensure_(key, name, mime, parentId, create) {
  if (SEEN_[key]) return SEEN_[key];
  SEEN_[key] = ensureUncached_(key, name, mime, parentId, create);
  return SEEN_[key];
}
function ensureUncached_(key, name, mime, parentId, create) {
  const p = props_();
  const saved = p.getProperty(key);
  if (saved) {
    try {
      const f = api_('get', DRIVE + '/' + saved + '?fields=id,trashed');
      if (!f.trashed) return saved;
    } catch (e) { /* cancellato o non più accessibile */ }
  }
  // con drive.file la ricerca restituisce solo file creati da questa app
  let q = "name = '" + name.replace(/'/g, "\\'") + "' and mimeType = '" + mime + "' and trashed = false";
  if (parentId) q += " and '" + parentId + "' in parents";
  const found = api_('get', DRIVE + '?fields=files(id)&pageSize=1&q=' + encodeURIComponent(q));
  const id = found.files && found.files.length ? found.files[0].id : create();
  p.setProperty(key, id);
  return id;
}

function folderId_() {
  return ensure_('FOLDER_ID', APP_NAME, MIME_FOLDER, null, function () {
    return api_('post', DRIVE + '?fields=id', { json: { name: APP_NAME, mimeType: MIME_FOLDER } }).id;
  });
}

function dataId_() {
  const folder = folderId_();
  return ensure_('DATA_ID', DATA_NAME, 'application/json', folder, function () {
    return multipartUpload_({ name: DATA_NAME, mimeType: 'application/json', parents: [folder] },
      'application/json', Utilities.newBlob(JSON.stringify({ version: 2, recipes: [] }), 'application/json').getBytes()).id;
  });
}

function sheetId_() {
  const folder = folderId_();
  return ensure_('SHEET_ID', SHEET_NAME, MIME_SHEET, folder, function () {
    const id = api_('post', DRIVE + '?fields=id', { json: { name: SHEET_NAME, mimeType: MIME_SHEET, parents: [folder] } }).id;
    // intestazione in grassetto e bloccata
    api_('post', SHEETS + '/' + id + '/values/A1:append?valueInputOption=RAW', { json: { values: [COLS] } });
    api_('post', SHEETS + '/' + id + ':batchUpdate', { json: { requests: [
      { updateSheetProperties: { properties: { sheetId: 0, title: 'Ricette', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }
    ] } });
    return id;
  });
}

function multipartUpload_(meta, mime, bytes, extraQuery) {
  const boundary = 'ricettario' + Date.now();
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n';
  const tail = '\r\n--' + boundary + '--';
  const payload = [].concat(Utilities.newBlob(head).getBytes(), bytes, Utilities.newBlob(tail).getBytes());
  return api_('post', UPLOAD + '?uploadType=multipart&fields=id' + (extraQuery || ''), {
    payload: payload, contentType: 'multipart/related; boundary=' + boundary
  });
}

/* ============================== Archivio ============================== */

function readAll_() {
  const res = api_('get', DRIVE + '/' + dataId_() + '?alt=media', { raw: true });
  const text = res.getContentText('UTF-8');
  if (!text) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : (data.recipes || []);
}

function writeAll_(list) {
  const body = JSON.stringify({ version: 2, updated: new Date().toISOString(), recipes: list });
  api_('patch', UPLOAD + '/' + dataId_() + '?uploadType=media', {
    payload: Utilities.newBlob(body, 'application/json').getBytes(), contentType: 'application/json'
  });
  // ricette.json è l'archivio: se il Foglio non si aggiorna, il salvataggio resta valido
  // e l'errore viene mostrato nelle Impostazioni dell'app.
  try {
    writeSheet_(list);
    props_().deleteProperty('SHEET_ERROR');
  } catch (e) {
    props_().setProperty('SHEET_ERROR', new Date().toISOString() + ' · ' + e.message);
  }
}

function writeSheet_(list) {
  const id = sheetId_();
  const rows = [COLS].concat(list.map(function (r) {
    return [
      r.id, r.titolo, r.tipo, r.tempo_min || '', r.porzioni || '', r.difficolta || '',
      (r.ingredienti || []).map(function (i) { return i.quantita ? i.nome + ': ' + i.quantita : i.nome; }).join('\n'),
      (r.passaggi || []).join('\n'), r.note || '',
      (r.fonte && r.fonte.tipo) || '', (r.fonte && r.fonte.url) || '',
      r.stato === 'da provare' ? 'da provare' : 'cucinata', r.preferita ? 'sì' : '', r.creata || '', r.modificata || ''
    ];
  }));
  // svuoto e riscrivo; "append" allarga il foglio da solo oltre le 1000 righe iniziali
  api_('post', SHEETS + '/' + id + '/values/' + encodeURIComponent('A:Z') + ':clear', { json: {} });
  api_('post', SHEETS + '/' + id + '/values/A1:append?valueInputOption=RAW&insertDataOption=OVERWRITE', { json: { values: rows } });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ============================== Funzioni chiamate dall'app ============================== */

function getRecipes() {
  return readAll_();
}

function saveRecipe(recipe) {
  if (!recipe || !recipe.id || !recipe.titolo) throw new Error('Ricetta non valida: manca il titolo.');
  return withLock_(function () {
    const list = readAll_();
    const i = list.findIndex(function (r) { return r.id === recipe.id; });
    if (i >= 0) list[i] = recipe; else list.push(recipe);
    writeAll_(list);
    return recipe;
  });
}

function deleteRecipe(id) {
  return withLock_(function () {
    writeAll_(readAll_().filter(function (x) { return x.id !== id; }));
    return true;
  });
}

function replaceAll(list) {
  if (!Array.isArray(list)) throw new Error('Dati non validi.');
  return withLock_(function () {
    writeAll_(list);
    return list.length;
  });
}

/** Righe del Foglio, per riportare nell'app le modifiche fatte a mano nel Foglio. */
function getSheetRows() {
  const res = api_('get', SHEETS + '/' + sheetId_() + '/values/' + encodeURIComponent('A:Z'));
  return res.values || [];
}

function getSettings() {
  return {
    folderUrl: 'https://drive.google.com/drive/folders/' + folderId_(),
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId_() + '/edit',
    sheetError: props_().getProperty('SHEET_ERROR') || ''
  };
}

/* ============================== Import da link ============================== */

function fetchRecipeUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('Il link deve iniziare con http:// o https://');
  const ig = String(url).match(/instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) return fetchInstagram_(url, ig[1]);
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.6'
    }
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('Il sito ha risposto con un errore (' + code + '). Prova da screenshot.');
  const html = res.getContentText();
  const ld = findJsonLdRecipe_(html);
  if (ld) return { kind: 'jsonld', data: pickRecipeFields_(ld), url: url };
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { kind: 'text', title: titleMatch ? decodeEntities_(titleMatch[1]).trim() : '', text: htmlToText_(html).slice(0, 8000), url: url };
}

/* ============================== Import da Instagram ============================== */

/**
 * Legge la descrizione (caption) di un reel o di un post pubblico.
 * Instagram non offre un accesso ufficiale senza login: si prova prima la pagina di incorporamento,
 * poi l'anteprima pubblicata per i social. Il parlato del video non è accessibile.
 */
function fetchInstagram_(url, code) {
  let caption = '';
  let author = '';
  try {
    const r = UrlFetchApp.fetch('https://www.instagram.com/p/' + code + '/embed/captioned/', {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.6'
      }
    });
    if (r.getResponseCode() === 200) {
      const html = r.getContentText();
      const div = html.match(/<div class="Caption">([\s\S]*?)<div class="CaptionComments">/) ||
                  html.match(/<div class="Caption">([\s\S]*?)<\/div>/);
      if (div) {
        caption = htmlToText_(div[1]
          .replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, '')
          .replace(/<br\s*\/?>/gi, '\n'));
      }
      if (!caption) caption = jsonCaption_(html);
      const a = html.match(/class="UsernameText"[^>]*>([^<]+)</) || html.match(/class="CaptionUsername"[^>]*>([^<]+)</);
      if (a) author = decodeEntities_(a[1]).trim();
    }
  } catch (e) { /* passo al metodo successivo */ }

  if (!caption) {
    try {
      const r = UrlFetchApp.fetch('https://www.instagram.com/reel/' + code + '/', {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' }
      });
      const html = r.getContentText();
      const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ||
                 html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
      if (og) {
        const d = decodeEntities_(og[1]);
        const q = d.match(/:\s*["“]([\s\S]*)["”]\.?\s*$/);
        caption = q ? q[1] : d;
        const who = d.match(/-\s*([\w.]+)\s+(?:on|il|del)\s/);
        if (who && !author) author = who[1];
      }
      if (!caption) caption = jsonCaption_(html);
    } catch (e) { /* nessuna descrizione */ }
  }

  caption = String(caption || '').trim();
  if (caption.length < 20) {
    throw new Error('Non riesco a leggere la descrizione di questo reel: può essere di un profilo privato o Instagram ha bloccato la lettura. Fai uno screenshot della descrizione e importalo da “Screenshot”.');
  }
  return { kind: 'text', title: '', text: caption, url: url, source: 'instagram', author: author };
}

function jsonCaption_(html) {
  const patterns = [
    /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /\\"edge_media_to_caption\\"\s*:\s*\{\s*\\"edges\\"\s*:\s*\[\s*\{\s*\\"node\\"\s*:\s*\{\s*\\"text\\"\s*:\s*\\"((?:[^"\\]|\\\\.)*?)\\"/,
    /"caption"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.)*)"/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = html.match(patterns[i]);
    if (!m) continue;
    try {
      let t = JSON.parse('"' + m[1] + '"');
      if (i === 1) t = JSON.parse('"' + t + '"');
      if (t) return t;
    } catch (e) { /* formato inatteso */ }
  }
  return '';
}

function findJsonLdRecipe_(html) {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let json;
    try {
      json = JSON.parse(m[1].trim());
    } catch (e) {
      try { json = JSON.parse(m[1].replace(/[\u0000-\u001F]+/g, ' ').trim()); } catch (e2) { continue; }
    }
    const found = walkForRecipe_(json, 0);
    if (found) return found;
  }
  return null;
}

function walkForRecipe_(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const f = walkForRecipe_(node[i], depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const types = [].concat(node['@type'] || []);
  if (types.some(function (t) { return String(t).toLowerCase() === 'recipe'; })) return node;
  return walkForRecipe_(node['@graph'], depth + 1) || walkForRecipe_(node.mainEntity, depth + 1);
}

function pickRecipeFields_(r) {
  const keys = ['name', 'description', 'recipeIngredient', 'ingredients', 'recipeInstructions',
    'totalTime', 'prepTime', 'cookTime', 'recipeYield', 'recipeCategory', 'recipeCuisine', 'keywords'];
  const out = {};
  keys.forEach(function (k) { if (r[k] !== undefined) out[k] = r[k]; });
  return JSON.parse(JSON.stringify(out));
}

function htmlToText_(html) {
  return decodeEntities_(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function decodeEntities_(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&egrave;/g, 'è').replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à')
    .replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù').replace(/&igrave;/g, 'ì')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

/* ============================== Lettura delle foto (OCR di Google Drive) ============================== */

/** payload = { kind: 'screenshot' | 'appunti', images: [{ data: base64, mime }] } */
function transcribeImages(payload) {
  const images = (payload && payload.images) || [];
  if (!images.length) throw new Error('Nessuna immagine ricevuta.');
  const folder = folderId_();
  const texts = images.map(function (img) {
    // 1. carico l'immagine come documento Google: Drive ne estrae il testo
    const doc = multipartUpload_({ name: 'ocr-temporaneo', mimeType: MIME_DOC, parents: [folder] },
      img.mime || 'image/jpeg', Utilities.base64Decode(img.data), '&ocrLanguage=it');
    try {
      // 2. leggo il testo
      return api_('get', DRIVE + '/' + doc.id + '/export?mimeType=text/plain', { raw: true }).getContentText('UTF-8');
    } finally {
      // 3. elimino il documento temporaneo
      try { api_('delete', DRIVE + '/' + doc.id, { raw: true }); } catch (e) { /* già eliminato */ }
    }
  });
  const text = texts.join('\n').replace(/﻿/g, '').trim();
  if (!text) throw new Error('Non ho trovato testo leggibile nelle immagini. Prova con una foto più nitida e dritta.');
  return { kind: 'ocr', text: text };
}

/**
 * Esegui questa funzione una volta dall'editor: autorizza l'app, crea cartella, archivio e Foglio
 * e verifica che lettura e scrittura funzionino davvero. Il risultato è nel Registro di esecuzione.
 */
function setup() {
  const log = [];
  const ok = function (t) { log.push('OK  ' + t); };
  try {
    const folder = folderId_(); ok('cartella Ricettario: https://drive.google.com/drive/folders/' + folder);
    const list = readAll_(); ok('lettura ricette.json (' + list.length + ' ricette)');
    // scrittura dell'archivio: riscrivo lo stesso contenuto e lo rileggo
    const body = JSON.stringify({ version: 2, updated: new Date().toISOString(), recipes: list });
    api_('patch', UPLOAD + '/' + dataId_() + '?uploadType=media', { payload: Utilities.newBlob(body, 'application/json').getBytes(), contentType: 'application/json' });
    if (readAll_().length !== list.length) throw new Error('ricette.json riletto con un numero di ricette diverso');
    ok('scrittura ricette.json');
    writeSheet_(list); ok('scrittura Foglio: https://docs.google.com/spreadsheets/d/' + sheetId_() + '/edit');
    const rows = getSheetRows(); ok('lettura Foglio (' + Math.max(0, rows.length - 1) + ' righe di ricette)');
    props_().deleteProperty('SHEET_ERROR');
    // OCR: carico un'immagine di prova, leggo il testo e cancello il documento temporaneo.
    // Un problema qui non blocca il resto: link, Instagram e inserimento a mano funzionano comunque.
    try {
      const png = Utilities.newBlob(Utilities.base64Decode(TEST_PNG_), 'image/png');
      const doc = multipartUpload_({ name: 'ocr-temporaneo', mimeType: MIME_DOC, parents: [folder] }, 'image/png', png.getBytes(), '&ocrLanguage=it');
      const letto = api_('get', DRIVE + '/' + doc.id + '/export?mimeType=text/plain', { raw: true }).getContentText('UTF-8').trim();
      api_('delete', DRIVE + '/' + doc.id, { raw: true });
      ok('OCR: letto "' + letto.slice(0, 40) + '" e documento temporaneo eliminato');
    } catch (eOcr) {
      log.push('AVVISO  OCR non riuscito (' + eOcr.message + '): la lettura delle foto potrebbe non funzionare, il resto sì.');
    }
    const codice = props_().getProperty('TOKEN') || impostaCodice();
    let url = '';
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e2) { /* non ancora pubblicata */ }
    log.push('');
    log.push('Indirizzo del ponte (va in config.js): ' + (url || '(pubblica prima l\'app web, poi esegui di nuovo setup)'));
    log.push('Codice di accesso (va inserito nell\'app): ' + codice);
    log.push('Tutto pronto.');
  } catch (e) {
    log.push('ERRORE  ' + e.message);
  }
  Logger.log(log.join('\n'));
  return log.join('\n');
}

// piccola immagine con la scritta "Pasta al pomodoro", per verificare che l'OCR funzioni
const TEST_PNG_ = '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';
