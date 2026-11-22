/* ==========================================================================
   Ricettario · logica dell'app
   Sezioni: costanti · utilità · quantità · riconoscimento ingredienti · dispensa ·
   conversione delle fonti · CSV · collegamento con Apps Script · stato · icone ·
   filtri · viste · render · azioni · eventi · avvio
   L'app è su GitHub Pages. Le chiamate a Google passano da gas('nomeFunzione', ...),
   che le invia al ponte Apps Script (indirizzo in config.js) insieme al codice di accesso.
   Senza codice l'app chiede di inserirlo, oppure gira in modalità demo.
   ========================================================================== */
'use strict';

/* ============================== Costanti ============================== */

const TIPI = ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Piatto unico', 'Dolce', 'Lievitato', 'Salsa', 'Bevanda', 'Altro'];
const DIFFICOLTA = ['Facile', 'Media', 'Difficile'];
const TIPO_CLASS = { 'Antipasto': 'antipasto', 'Primo': 'primo', 'Secondo': 'secondo', 'Contorno': 'contorno', 'Piatto unico': 'unico', 'Dolce': 'dolce', 'Lievitato': 'lievitato' };
const FONTE_LABEL = { link: 'da link', instagram: 'da Instagram', screenshot: 'da screenshot', appunti: 'da foto appunti', manuale: 'inserita a mano', csv: 'da CSV' };
const CSV_COLS = ['id', 'titolo', 'tipo', 'tempo_min', 'porzioni', 'difficolta', 'ingredienti', 'passaggi', 'note', 'fonte_tipo', 'fonte_url', 'stato', 'preferita', 'creata', 'modificata'];
const DA_PROVARE = 'da provare', CUCINATA = 'cucinata';
const isToTry = (r) => r.stato === DA_PROVARE;
/* Le ricette prese da fonti esterne nascono "da provare"; quelle dai tuoi appunti o scritte a mano "già cucinate". */
const defaultStato = (src) => (src === 'appunti' || src === 'manuale' ? CUCINATA : DA_PROVARE);
/* Collegamento al ponte: indirizzo da config.js, codice di accesso salvato su questo dispositivo */
const CONF = window.RICETTARIO_CONFIG || {};
const CODE_KEY = 'ricettario-codice', URL_KEY = 'ricettario-ponte', MODE_KEY = 'ricettario-modo';
function store0(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
const BRIDGE_URL = String(CONF.url || store0(URL_KEY) || '').trim();
const CODICE = String(store0(CODE_KEY) || '').trim();
const IS_GAS = !!(BRIDGE_URL && CODICE) && !window.RICETTARIO_DEMO;
const DEMO = !IS_GAS && (!!window.RICETTARIO_DEMO || store0(MODE_KEY) === 'demo');

/* ============================== Utilità ============================== */

const $ = (s, el) => (el || document).querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowIso = () => new Date().toISOString();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w) => (w.length > 4 ? w.replace(/[aeio]$/, '') : w);
const cap = (s) => { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

function hash(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 7; }
function rng(seed) { let s = seed % 233280; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const hline = () => ''; // le linee tracciate a mano non fanno più parte del design

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } }
};

function fmtTime(min) {
  min = parseInt(min, 10);
  if (!min) return '';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + m : '');
}
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).toLowerCase();
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|ore|ora)(?![a-z])\s*(\d+)?/);
  const m = h ? null : s.match(/(\d+)\s*(?:m|min|minuti|')/);
  if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60 + (h[2] ? parseInt(h[2], 10) : 0));
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
function parseIsoDuration(s) {
  const m = String(s || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const t = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return t || null;
}
function domain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } }

/* ============================== Quantità e porzioni ============================== */

const FRAC = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3 };
function parseNum(s) {
  s = String(s).trim();
  if (FRAC[s] != null) return FRAC[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const fr = s.match(/^(\d+)\/(\d+)$/);
  if (fr) return fr[1] / fr[2];
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? null : n;
}
function fmtNum(v) {
  if (v >= 10) return String(Math.round(v));
  const q = Math.round(v * 4) / 4, i = Math.floor(q), f = q - i;
  const fs = f === .25 ? '¼' : f === .5 ? '½' : f === .75 ? '¾' : '';
  if (!i && !fs) return String(Math.round(v * 100) / 100).replace('.', ',');
  return (i ? String(i) : '') + (i && fs ? ' ' : '') + fs;
}
const NUM_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/;
function scaleQty(q, factor) {
  if (!q || factor === 1) return q;
  const m = String(q).match(NUM_RE);
  if (!m) return q;
  const a = parseNum(m[1]);
  if (a == null) return q;
  let out = fmtNum(a * factor);
  if (m[2]) { const b = parseNum(m[2]); if (b != null) out += '–' + fmtNum(b * factor); }
  return out + String(q).slice(m[0].length);
}

/* ============================== Riconoscimento ingredienti ============================== */

const UNIT = '(?:kg|g|gr|grammi|mg|l|lt|litr[oi]|ml|cl|dl|cucchiai(?:ni|no)?|cucchiaio|cucch\\.?|tazz[ae]|bicchier[ei]|spicchi[o]?|pizzic[ho]|pizzico|fogli[ae]|foglie|ramett[oi]|mazzett[oi]|ciuff[oi]|ciuffo|cesp[oi]|fett[ae]|bustin[ae]|confezion[ei]|scatol[ae]|lattin[ae]|vasett[oi]|pz|pezz[io]|noce|manciat[ae]|tbsp|tsp|cups?|oz)';
const QB = "(?:q\\.?\\s?b\\.?|quanto basta|a piacere|qb)";
const LEAD_RE = new RegExp('^(?:circa\\s+)?((?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾⅓⅔]|una|uno|un|mezz[oa])\\s*(?:' + UNIT + '\\b\\.?)?)\\s*(?:di\\s+|d[\'’]\\s*)?(.+)$', 'i');
const TRAIL_RE = new RegExp('^(.+?)[\\s,:–-]+((?:circa\\s+)?(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾])\\s*(?:' + UNIT + '\\b\\.?)?|' + QB + ')\\.?$', 'i');

function splitIngredient(raw) {
  let s = String(raw || '').replace(/^[\s•·\-–*▪◦]+/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let m = s.match(TRAIL_RE);
  if (m && !/^\d/.test(s)) return { nome: cap(m[1].replace(/[,:]\s*$/, '')), quantita: m[2].replace(/\s+/g, ' ').replace(/^qb$/i, 'q.b.') };
  m = s.match(LEAD_RE);
  if (m) {
    let nome = m[2].trim(), q = m[1].trim();
    const tail = nome.match(new RegExp('^(.+?)[\\s,]+' + QB + '\\.?$', 'i'));
    if (tail) nome = tail[1];
    return { nome: cap(nome), quantita: q };
  }
  const qb = s.match(new RegExp('^(.+?)[\\s,]+(' + QB + ')\\.?$', 'i'));
  if (qb) return { nome: cap(qb[1]), quantita: 'q.b.' };
  return { nome: cap(s), quantita: '' };
}

/* ============================== Ingredienti unificati e categorie ============================== */
/* Ogni riga: Voce unica = forme riconosciute (regex su testo minuscolo senza accenti; "~" = qualsiasi finale).
   Le forme di più parole hanno la precedenza; per il resto vince la prima voce dell'elenco.
   Una sezione "-" raccoglie ciò che non va in dispensa (acqua, ghiaccio). */
const DIZIONARIO = `
# Ortaggi e verdure
Aglio = aglio
Cipollotti = cipollott~
Cipolle = cipoll~
Scalogno = scalogn~
Porri = porr[oi]
Carote = carot~
Sedano = sedan~
Pomodori = pomodor~|pelati|passata~|concentrato|datterin~|pachino|ciliegin~|salsa di pomodoro
Melanzane = melanzan~
Fiori di zucca = fiori di zucc~
Zucchine = zucchin~
Zucca = zucca|zucche
Peperoni = peperon[ei]
Patate = patat~
Spinaci = spinac~
Bietole = biet[ea]~
Cavolfiore = cavolfior~
Cime di rapa = cime di rapa
Broccoli = broccol~
Cavoli = cavol~|verza|verze|cappucc~
Carciofi = carciof~
Asparagi = asparag~
Funghi = fung[oh]i?|porcin~|champignon~|chiodin~|finferl~
Fagiolini = fagiolin~
Insalata = lattug~|insalat~|songino|valeriana|iceberg
Rucola = rucol~
Radicchio = radicch~|trevisan~
Scarola = scarol~|indivia
Finocchi = finocchi|finocchio
Cetrioli = cetriol~
Ravanelli = ravanell~
Barbabietole = barbabietol~|rapa rossa
Mais = mais
Avocado = avocado
# Frutta
Latte di cocco = latte di cocco
Cocco = cocco
Limoni = limon~
Lime = lime
Arance = aranc~
Mandarini = mandarin~
Mele = mel[ae]
Pere = per[ae]
Banane = banan~
Fragole = fragol~
Frutti di bosco = frutti di bosco|mirtill~|lampon~|more|ribes
Uvetta = uva passa|uva sultanina|uvett~|sultanina
Uva = uva
Pesche = pesc[ah]e?
Albicocche = albicocc~
Ciliegie = cilieg~|amaren[ae]
Ananas = ananas
Mango = mango
Kiwi = kiwi
Fichi = fich[io]
Prugne = prugn~
Melone = melon[ei]
Anguria = anguri~
Melagrana = melagran~
# Frutta secca e semi
Burro di arachidi = burro di arachidi
Noci = noc[ei]|gherigli~
Mandorle = mandorl~
Nocciole = nocciol~
Pistacchi = pistacch~
Pinoli = pinol~
Arachidi = arachid~
Anacardi = anacard~
Datteri = datter~
Castagne = castagn~
Sesamo = sesamo
Semi di girasole = girasol~
Semi di chia = chia
Semi di lino = lino
# Erbe e spezie
Noce moscata = noce moscata
Chiodi di garofano = chiod~ di garofano
Erba cipollina = erba cipollina
Erbe aromatiche = erbe aromatiche|erbe di provenza|mazzetto odoroso
Basilico = basilic~
Prezzemolo = prezzemol~
Rosmarino = rosmarin~
Salvia = salvia
Timo = timo
Origano = origan~
Alloro = allor~
Menta = ment[ae]
Maggiorana = maggioran~
Finocchietto = finocchiett~
Aneto = aneto
Coriandolo = coriandol~
Pepe = pepe
Peperoncino = peperoncin~|chili
Cannella = cannell[ae]
Zafferano = zafferan~
Curcuma = curcuma
Paprika = paprika
Curry = curry
Cumino = cumino
Zenzero = zenzer~
Vaniglia = vanigli~|vanillin~
# Latticini e uova
Fiocchi di latte = fiocchi di latte
Panna = panna|crema di latte
Formaggio spalmabile = formaggio spalmabile|formaggio fresco spalmabile|philadelphia|robiola
Mozzarella = fior di latte|mozzarell~|bufala
Uova = uov[oa]|tuorl~|album~
Latte = latte
Burro = burro
Yogurt = yogurt~|yoghurt~
Mascarpone = mascarpone
Ricotta = ricott~
Burrata = burrat~
Stracciatella = stracciatella
Parmigiano e grana = parmigian~|grana|reggiano
Pecorino = pecorin~
Gorgonzola = gorgonzola
Scamorza = scamorz~
Provola = provol~
Fontina = fontina
Stracchino = stracchin~|crescenza
Feta = feta
Emmental e groviera = emmental~|groviera|gruyere
Formaggio = formagg~
# Carne e salumi
Carne macinata = carne macinata|macinat[oa]
Guanciale = guancial~
Pancetta = pancett~
Prosciutto = prosciutt~
Salsiccia = salsicc~
Speck = speck
Mortadella = mortadell~
Salame = salam[ei]
Nduja = nduja
Bresaola = bresaola
Würstel = wurstel
Lardo = lardo
Pollo = poll[oi]
Manzo = manzo|vitellone|hamburger|roast beef
Vitello = vitell[oi]
Maiale = maial~|lonza|arista|costin[ae]|braciol[ae]
Agnello = agnell~
Tacchino = tacchin~
Coniglio = conigli~
Anatra = anatra
Carne = carne
# Pesce e frutti di mare
Pesce spada = pesce spada
Salmone = salmon~
Tonno = tonn[oi]
Merluzzo e baccalà = merluzz~|baccala|stoccafisso
Acciughe = acciug~|alic[ei]
Gamberi = gamber~|mazzancoll~|scamp[io]
Vongole = vongol~|tellin[ae]
Cozze = cozz~
Calamari = calamar~|totan[oi]
Seppie = seppi[ae]|seppiolin~
Polpo = polp[oi]|moscardin~
Orata = orat[ae]
Branzino = branzin~|spigol~
Sgombro = sgombr~
Sarde = sard[ei]|sardin~
Bottarga = bottarga
Pesce = pesce|pesci
# Pasta, riso e cereali
Polenta = farina di mais|polenta|bramata
Gnocchi = gnocch~
Pasta = pasta|spaghett~|rigaton~|penn[ei]|fusill~|linguin~|tagliatell~|pappardell~|bucatin~|maccheron~|paccher~|orecchiett~|farfall~|mezze maniche|ditalin~|lasagn~|tortellin~|tortell[io]|raviol~|trofie|casarecc~|caserecc~|vermicell~|tagliolin~|fettuccin~|sedanin~|conchigli~|calamarat~|mafald~|strozzapret~|pici|tonnarell~|fregola|anelletti|noodles
Riso = riso|carnaroli|arborio|vialone|basmati|venere
Couscous = cous cous|couscous
Farro = farr[oi]
Orzo = orzo
Quinoa = quinoa
Avena = avena
# Farine, pane e lieviti
Pasta sfoglia = pasta sfoglia|sfoglia
Pasta frolla = pasta frolla|frolla
Pasta brisée = pasta brise~|brisee
Pangrattato = pane grattugiato|pan grattato|pangrattat~
Farina = farin~|semola|manitoba
Amido = amido|fecola|maizena
Lievito = pasta madre|lievit~|cremor tartaro
Bicarbonato = bicarbonat~
Pane = pan carre|pane|pancarre|panin[oi]|baguette|mollica|piadin~|tortill~|crostin[io]|fette biscottate
# Legumi
Ceci = ceci
Fagioli = fagiol[io]|borlott~|cannellin~
Lenticchie = lenticch~
Piselli = pisell~
Fave = fav[ae]
Soia = soia|edamame
Tofu = tofu
# Oli, aceti e condimenti
Salsa di soia = salsa di soia
Olio = olio|oli
Aceto = acet[oi]
Sale = fior di sale|sale
Capperi = capper~
Olive = oliv[ae]
Senape = senap~
Maionese = maionese
Ketchup = ketchup
Pesto = pesto
Brodo = brodo|brodi|dado|dadi
Tahina = tahin[ai]
# Zuccheri e dolci
Sciroppo d'acero = sciroppo d acero
Crema spalmabile = crema spalmabile|crema di nocciole|nutella
Gelatina = colla di pesce|gelatina|agar~
Zucchero = zuccher~
Miele = miele
Cioccolato = cioccolat~
Cacao = cacao
Marmellata = marmellat~|confettur~
Biscotti = biscott~|amaretti|savoiard~|pavesin~|frollin~|digestive
Canditi = candit[io]|scorzett~
# Bevande e alcolici
Vino = vin[oi]|marsala|spumante|prosecco
Birra = birra
Liquori = rum|brandy|cognac|grappa|amaretto|limoncello|vodka|gin|whisky|liquor~|maraschino|cointreau|vermouth
Caffè = caffe|espresso
# -
Acqua = acqua|ghiaccio
`;
const CATS = ['Ortaggi e verdure', 'Frutta', 'Frutta secca e semi', 'Erbe e spezie', 'Latticini e uova', 'Carne e salumi', 'Pesce e frutti di mare', 'Pasta, riso e cereali', 'Farine, pane e lieviti', 'Legumi', 'Oli, aceti e condimenti', 'Zuccheri e dolci', 'Bevande e alcolici', 'Altro'];
const DIZ = (() => {
  const out = []; let cat = 'Altro';
  DIZIONARIO.split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '#') { cat = line.slice(1).trim(); return; }
    const k = line.indexOf(' = ');
    const label = line.slice(0, k).trim();
    const alts = line.slice(k + 3).split('|').map((a) => a.trim().replace(/~/g, '\\w*'));
    const mk = (list) => (list.length ? new RegExp('^(?:' + list.join('|') + ')(?![\\w])') : null);
    out.push({ label: label, cat: cat, multi: mk(alts.filter((a) => a.indexOf(' ') >= 0)), single: mk(alts.filter((a) => a.indexOf(' ') < 0)) });
  });
  return out;
})();
const QUALIFIERS = /\b(fresc[aohi]e?|secc[aohi]e?|tritat[aoie]|grattugiat[aoie]|in scaglie|a cubetti|a fette|a dadini|a rondelle|pelat[aoie]|sgusciat[aoie]|tostat[aoie]|biologic[aoie]|bio|inter[aoie]|macinat[aoie]|in polvere|sott olio|surgelat[aoie]|congelat[aoie]|grand[ei]|piccol[aoie]|medi[aoe]|matur[aoie]|q b|qb|a piacere|per (?:friggere|ungere|spolverare|decorare|servire|la teglia|lo stampo))\b/g;
const canonCache = new Map();
function canonical(nome) {
  const key = norm(nome);
  if (!key) return null;
  if (canonCache.has(key)) return canonCache.get(key);
  const s = key.replace(/^(?:(?:una|un|mezza|mezzo)\s+)?noc[ei]\s+(?:di|d)\s+/, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ');
  let hit = null;
  for (let i = 0; i < tokens.length && !hit; i++) {
    const rest = tokens.slice(i).join(' ');
    hit = DIZ.find((e) => e.multi && e.multi.test(rest)) || DIZ.find((e) => e.single && e.single.test(rest));
  }
  let res;
  if (hit) res = { label: hit.label, cat: hit.cat };
  else {
    const base = s.replace(QUALIFIERS, ' ').replace(/\s+(di|d|del|della|con|e)$/, '').replace(/\s+/g, ' ').trim();
    res = { label: cap(base || s), cat: 'Altro' };
  }
  canonCache.set(key, res);
  return res;
}

/* ============================== Conversione delle fonti in ricetta ============================== */

const TIPO_HINTS = [
  ['Dolce', /dolc|dessert|torta|biscott|crostat|tiramis|cheesecake|muffin|budin|gelat|crema pasticc|semifredd|panna cotta|cantucc|ciambell|plumcake|brownie|cookie/],
  ['Lievitato', /lievitat|\bpane\b|pizza|focacc|brioche|panin|grissin|bread/],
  ['Antipasto', /antipast|appetizer|starter|bruschett|crostin|tartin|finger food|stuzzichin/],
  ['Piatto unico', /piatt[oi] unic|one.pot/],
  ['Primo', /\bprim[oi]\b|pasta|spaghett|risott|gnocch|lasagn|tagliatell|penne|rigatoni|fusill|orecchiett|ravioli|tortell|zupp|minestr|vellutat|linguine|bucatin/],
  ['Contorno', /contorn|side dish|insalat|caponat|peperonat|verdur|patate al forno|purè|pure di/],
  ['Secondo', /second[oi]|main course|pollo|manzo|maiale|vitello|agnello|tacchino|pesce|salmone|merluzz|orata|branzino|polpett|arrost|filett|scaloppin|frittat|spezzatin|cotolett|hamburger|involtin/],
  ['Salsa', /\bsals[ae]\b|sauce|pesto|maionese|besciamella/],
  ['Bevanda', /bevand|drink|cocktail|smoothie|frullat|tisana|liquore/]
];
function guessTipo() {
  const text = norm(Array.prototype.join.call(arguments, ' '));
  for (const [tipo, re] of TIPO_HINTS) if (re.test(text)) return tipo;
  return 'Altro';
}
function emptyRecipe(src) {
  return { id: uid(), titolo: '', tipo: 'Primo', tempo_min: null, porzioni: 4, difficolta: '', ingredienti: [], passaggi: [], note: '', fonte: { tipo: src || 'manuale', url: '' }, stato: defaultStato(src || 'manuale'), preferita: false, creata: '', modificata: '' };
}
/* Alcuni siti (es. Giallo Zafferano) inseriscono nel testo dei passaggi il numero della foto
   corrispondente: "versate la pasta nell'acqua 15. Scolate…". Li tolgo, lasciando i numeri veri
   (dosi, minuti, gradi, porzioni): un numero è un rimando a una foto solo se segue una parola
   comune (non una preposizione o un altro numero) e chiude la frase o precede una maiuscola. */
const KEEP_BEFORE = /^(?:a|ad|al|alla|allo|ai|alle|agli|in|nel|nella|di|da|dal|per|con|su|fra|tra|circa|almeno|oltre|sotto|sopra|fino|ogni|ancora|altri|altre|altro|altra|max|min|x|n|nr|n°|step|passo|e|o|ed|od|meno|più|piu|tutto|tutti|tutte|ore|ora|cottura|grado|gradi|temperatura|forno|livello|potenza|velocità|velocita|vel)$/i;
function stripImageRefs(text) {
  let t = String(text || '');
  t = t.replace(/\s*\(\s*\d{1,3}(?:\s*[-–,]\s*\d{1,3})*\s*\)/g, '');
  t = t.replace(/(^|[\s(])([A-Za-zÀ-ÿ'’]+)((?:\s+\d{1,3})+)(?=\s*(?:[.,;:!?)]|$)|\s+[A-ZÀ-Ý])/g, (m, pre, word, nums, at, all) => {
    if (KEEP_BEFORE.test(word)) return m;
    const list = nums.trim().split(/\s+/);
    if (list.length === 1 && +list[0] > 60) return m; // 180, 200… probabilmente gradi o grammi
    const next = all.slice(at + m.length);
    return pre + word + (/^\s+[A-ZÀ-Ý]/.test(next) ? '.' : ''); // il numero separava due frasi
  });
  return t.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function flattenInstructions(x, out) {
  out = out || [];
  if (!x) return out;
  if (typeof x === 'string') {
    x.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s));
  } else if (Array.isArray(x)) {
    x.forEach((y) => flattenInstructions(y, out));
  } else if (typeof x === 'object') {
    if (x.itemListElement) flattenInstructions(x.itemListElement, out);
    else if (x.text) flattenInstructions(String(x.text).replace(/<[^>]+>/g, ' '), out);
    else if (x.name) flattenInstructions(x.name, out);
  }
  return out.map((s) => s.replace(/^\s*(?:\d+[.)]|passo\s+\d+:?)\s*/i, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function fromJsonLd(d, url) {
  const r = emptyRecipe('link');
  r.titolo = cap(String(d.name || '').trim());
  const ingr = [].concat(d.recipeIngredient || d.ingredients || []);
  r.ingredienti = ingr.map((s) => splitIngredient(String(s).replace(/<[^>]+>/g, ''))).filter(Boolean);
  r.passaggi = flattenInstructions(d.recipeInstructions).map(stripImageRefs).filter(Boolean);
  r.tempo_min = parseIsoDuration(d.totalTime) || ((parseIsoDuration(d.prepTime) || 0) + (parseIsoDuration(d.cookTime) || 0)) || null;
  const y = [].concat(d.recipeYield || [])[0];
  const yn = y != null ? parseInt(String(y).match(/\d+/) || '', 10) : NaN;
  r.porzioni = isNaN(yn) ? null : yn;
  r.tipo = guessTipo([].concat(d.recipeCategory || []).join(' '), r.titolo);
  if (r.tipo === 'Altro') r.tipo = guessTipo([].concat(d.keywords || []).join(' '));
  r.fonte = { tipo: 'link', url: url };
  return r;
}
/* Pulisce testi da social: emoji, hashtag, menzioni, numeri-emoji (1️⃣ → 1.). */
function cleanSocial(text) {
  return String(text || '')
    .replace(/(\d)\uFE0F?\u20E3/g, '$1. ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]+/gu, ' ¦ ')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)[#@][\p{L}\p{N}_.]+/gu, ' ').replace(/[ \t]+/g, ' ').replace(/^[\s¦]+|[\s¦]+$/g, '').trim())
    .filter((l) => l && !/^[.\-–_•·*~¦ ]+$/.test(l))
    .filter((l) => !(l.length < 90 && /^(salva|salvat[ei]|condividi|seguimi|segui|tagga|commenta|scrivimi|link in bio|iscriviti|save|follow|share|ti piace|fammi sapere)\b/i.test(l)))
    .join('\n');
}
function shortTitle(s) {
  s = String(s || '').split(/\s*¦\s*/)[0].trim();
  const caps = s.match(/^([A-ZÀ-Ù0-9'’,&]+(?:\s+[A-ZÀ-Ù0-9'’,&]+)+)(?=\s+[a-zà-ù])/);
  if (caps) s = caps[1];
  if (s && !/[a-zà-ù]/.test(s)) s = s.toLowerCase();
  const cut = s.split(/(?<=[.!?:])\s|\s[–-]\s/)[0];
  s = cut.length >= 4 ? cut : s;
  if (s.length > 80) s = s.slice(0, 80).replace(/\s+\S*$/, '');
  return cap(s.replace(/[.!?:]+$/, ''));
}
function parseRecipeText(text, src, fallbackTitle) {
  const r = emptyRecipe(src);
  r.porzioni = null;
  const rawTitled = cleanSocial(text).split(/\r?\n/).filter(Boolean);
  const firstLine = rawTitled[0] || '';
  const raw = rawTitled.map((s) => s.replace(/¦/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = [];
  raw.forEach((s) => {
    const m = s.match(/^(ingredienti|ingredients|procedimento|preparazione|istruzioni|metodo|method|directions)(\s+per\s+[^:]{1,30})?\s*:\s*(.+)$/i);
    if (!m) { lines.push(s); return; }
    lines.push(m[1] + (m[2] || ''));
    if (/^ingr/i.test(m[1])) m[3].split(/\s*[,;•]\s*/).forEach((x) => x && lines.push(x));
    else lines.push(m[3]);
  });
  const isIngrH = (s) => /^(ingredienti|ingredients)\b[\s:]*(per\s[^.]{0,40})?:?$/i.test(s);
  const isStepH = (s) => /^(procedimento|preparazione|istruzioni|metodo|come (si )?prepara|esecuzione|method|directions|instructions)\b[\s:]*$/i.test(s);
  const iI = lines.findIndex(isIngrH), iS = lines.findIndex(isStepH);
  const titleIdx = lines.findIndex((s) => !isIngrH(s) && !isStepH(s));
  const tline = titleIdx === 0 ? firstLine : (titleIdx >= 0 && (iI < 0 || titleIdx < iI) ? lines[titleIdx] : '');
  r.titolo = shortTitle(tline || fallbackTitle || '');
  let ingrLines = [], stepLines = [];
  if (iI >= 0) {
    ingrLines = lines.slice(iI + 1, iS > iI ? iS : undefined);
    stepLines = iS > iI ? lines.slice(iS + 1) : [];
    if (iS < 0) { // senza intestazione dei passaggi: le righe lunghe sono passaggi
      const cut = ingrLines.findIndex((s) => s.length > 70);
      if (cut >= 0) { stepLines = ingrLines.slice(cut); ingrLines = ingrLines.slice(0, cut); }
    }
  } else {
    lines.forEach((s, i) => {
      if (i === titleIdx || isStepH(s)) return;
      const sp = splitIngredient(s);
      if (s.length < 60 && sp && sp.quantita && (iS < 0 || i < iS)) ingrLines.push(s); else stepLines.push(s);
    });
  }
  r.ingredienti = ingrLines.map(splitIngredient).filter((x) => x && x.nome.length > 1);
  const steps = [];
  stepLines.forEach((s) => {
    const numbered = /^\s*(\d+[.)]|[•\-–*])\s*/.test(s);
    const clean = s.replace(/^\s*(\d+[.)]|[•\-–*])\s*/, '');
    if (!steps.length || numbered || /[.!?:]$/.test(steps[steps.length - 1])) steps.push(clean);
    else steps[steps.length - 1] += ' ' + clean;
  });
  r.passaggi = steps.map((s) => (src === 'appunti' ? s : stripImageRefs(s))).filter((s) => s.length > 2);
  if (r.passaggi.length === 1 && /[.!?]\s+\S/.test(r.passaggi[0])) {
    r.passaggi = r.passaggi[0].split(/(?<=[.!?])\s+/).map((x) => cap(x.trim())).filter((x) => x.length > 2);
  }
  const all = lines.join(' ');
  const pz = all.match(/(?:per|dosi per)\s+(\d+)\s+(?:persone|porzioni)|porzioni[:\s]+(\d+)/i);
  if (pz) r.porzioni = parseInt(pz[1] || pz[2], 10);
  const tm = all.match(/(?:tempo(?: totale)?|pronto in)[:\s]+([^.;]{1,20})/i);
  if (tm) r.tempo_min = parseTime(tm[1]);
  r.tipo = guessTipo(r.titolo);
  return r;
}

/* ============================== CSV ============================== */

function csvCell(v) {
  v = v == null ? '' : String(v);
  return /[",;\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(list) {
  const rows = [CSV_COLS.join(',')];
  list.forEach((r) => {
    rows.push([
      r.id, r.titolo, r.tipo, r.tempo_min || '', r.porzioni || '', r.difficolta || '',
      (r.ingredienti || []).map((i) => (i.quantita ? i.nome + ': ' + i.quantita : i.nome)).join('\n'),
      (r.passaggi || []).join('\n'),
      r.note || '', (r.fonte && r.fonte.tipo) || '', (r.fonte && r.fonte.url) || '',
      isToTry(r) ? DA_PROVARE : CUCINATA, r.preferita ? 'sì' : '', r.creata || '', r.modificata || ''
    ].map(csvCell).join(','));
  });
  return '﻿' + rows.join('\r\n');
}
function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  const sep = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const HEADER_ALIASES = {
  id: ['id'], titolo: ['titolo', 'nome', 'title', 'ricetta'], tipo: ['tipo', 'categoria', 'portata', 'category'],
  tempo_min: ['tempo_min', 'tempo', 'minuti', 'durata'], porzioni: ['porzioni', 'persone', 'dosi'],
  difficolta: ['difficolta'], ingredienti: ['ingredienti', 'ingredients'], passaggi: ['passaggi', 'procedimento', 'preparazione', 'istruzioni'],
  note: ['note', 'notes'], fonte_tipo: ['fonte_tipo', 'fonte'], fonte_url: ['fonte_url', 'url', 'link'],
  stato: ['stato', 'status', 'provata'], preferita: ['preferita', 'preferito', 'preferiti'], creata: ['creata'], modificata: ['modificata']
};
function recipesFromCSV(text) { return recipesFromRows(parseCSV(text)); }
function recipesFromRows(rows) {
  rows = (rows || []).map((r) => r.map((c) => (c == null ? '' : String(c))));
  if (rows.length < 2) throw new Error('Non ci sono ricette da importare.');
  const head = rows[0].map((h) => norm(h).replace(/\s+/g, '_'));
  const idx = {};
  Object.keys(HEADER_ALIASES).forEach((k) => {
    const i = head.findIndex((h) => HEADER_ALIASES[k].indexOf(h) >= 0);
    if (i >= 0) idx[k] = i;
  });
  if (idx.titolo == null) throw new Error('Nel CSV manca la colonna "titolo".');
  const get = (row, k) => (idx[k] != null ? (row[idx[k]] || '').trim() : '');
  const split = (s) => s.split(/\r?\n| \| /).map((x) => x.trim()).filter(Boolean);
  return rows.slice(1).map((row) => {
    const titolo = get(row, 'titolo');
    if (!titolo) return null;
    const tipoRaw = get(row, 'tipo');
    const tipo = TIPI.find((t) => norm(t) === norm(tipoRaw)) || (tipoRaw ? guessTipo(tipoRaw) : guessTipo(titolo));
    const fonteTipo = get(row, 'fonte_tipo');
    return {
      id: get(row, 'id') || uid(),
      titolo: titolo, tipo: tipo,
      tempo_min: parseTime(get(row, 'tempo_min')),
      porzioni: parseInt(get(row, 'porzioni'), 10) || null,
      difficolta: DIFFICOLTA.find((d) => norm(d) === norm(get(row, 'difficolta'))) || '',
      ingredienti: split(get(row, 'ingredienti')).map((s) => {
        const k = s.lastIndexOf(': ');
        return k > 0 ? { nome: cap(s.slice(0, k)), quantita: s.slice(k + 2).trim() } : splitIngredient(s);
      }).filter(Boolean),
      passaggi: split(get(row, 'passaggi')),
      note: get(row, 'note'),
      fonte: { tipo: FONTE_LABEL[fonteTipo] ? fonteTipo : 'csv', url: get(row, 'fonte_url') },
      stato: /prova|todo|^no$|^false$|^0$/i.test(get(row, 'stato')) ? DA_PROVARE : CUCINATA,
      preferita: /^(s[iì]|true|1|x|yes)$/i.test(get(row, 'preferita')),
      creata: get(row, 'creata') || nowIso(),
      modificata: get(row, 'modificata') || nowIso()
    };
  }).filter(Boolean);
}

/* ============================== Collegamento con Google (o demo locale) ============================== */

/* Richiesta al ponte: POST in testo semplice, così il browser non fa la richiesta preliminare (CORS) */
async function callBridge(url, codice, fn, args) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ codice: codice, fn: fn, args: args || [] })
    });
  } catch (e) { throw new Error('Nessuna connessione con Google. Controlla la rete e riprova.'); }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Il ponte Google non ha risposto come previsto: controlla che l’app web sia pubblicata con accesso “Chiunque”.'); }
  if (!data.ok) { const err = new Error(data.error || 'Errore sconosciuto.'); err.auth = data.auth === false; throw err; }
  return data.result;
}
function gas(fn) { return callBridge(BRIDGE_URL, CODICE, fn, Array.prototype.slice.call(arguments, 1)); }
const DEMO_KEY = 'ricettario-demo-v1';
const demoOnly = () => Promise.reject(new Error('Nella demo questa funzione non è attiva: funziona dopo il collegamento a Google.'));
const api = IS_GAS ? {
  getRecipes: () => gas('getRecipes'),
  saveRecipe: (r) => gas('saveRecipe', r),
  deleteRecipe: (id) => gas('deleteRecipe', id),
  replaceAll: (list) => gas('replaceAll', list),
  getSheetRows: () => gas('getSheetRows'),
  getSettings: () => gas('getSettings'),
  fetchRecipeUrl: (u) => gas('fetchRecipeUrl', u),
  transcribeImages: (p) => gas('transcribeImages', p)
} : {
  getRecipes: () => Promise.resolve(store.get(DEMO_KEY) || demoRecipes()),
  saveRecipe: (r) => { const l = (store.get(DEMO_KEY) || demoRecipes()).filter((x) => x.id !== r.id).concat([r]); store.set(DEMO_KEY, l); return Promise.resolve(r); },
  deleteRecipe: (id) => { store.set(DEMO_KEY, (store.get(DEMO_KEY) || demoRecipes()).filter((x) => x.id !== id)); return Promise.resolve(true); },
  replaceAll: (l) => { store.set(DEMO_KEY, l); return Promise.resolve(l.length); },
  getSheetRows: demoOnly,
  getSettings: () => Promise.resolve({ demo: true }),
  fetchRecipeUrl: demoOnly, transcribeImages: demoOnly
};

function demoRecipes() {
  const t = Date.now();
  const mk = (i, titolo, tipo, tempo, porz, diff, ingr, steps, note, fonte) => ({
    id: 'demo' + i, titolo, tipo, tempo_min: tempo, porzioni: porz, difficolta: diff,
    ingredienti: ingr.map((s) => { const [n, q] = s.split('|'); return { nome: n, quantita: q || '' }; }),
    passaggi: steps, note: note || '', fonte: { tipo: fonte, url: '' }, stato: [2, 3, 5].indexOf(i) >= 0 ? DA_PROVARE : CUCINATA, preferita: i === 1,
    creata: new Date(t - i * 864e5).toISOString(), modificata: new Date(t - i * 864e5).toISOString()
  });
  return [
    mk(1, 'Pasta alla Norma', 'Primo', 45, 4, 'Facile',
      ['Rigatoni|320 g', 'Melanzane|2', 'Pomodori pelati|400 g', 'Ricotta salata|80 g', 'Aglio|1 spicchio', 'Basilico|q.b.', 'Olio extravergine|q.b.', 'Sale|q.b.'],
      ['Taglia le melanzane a cubetti, salale e lasciale spurgare 30 minuti.', 'Friggile in olio caldo finché dorate, poi scolale su carta assorbente.', 'Soffriggi l’aglio, aggiungi i pelati e il basilico e cuoci 15 minuti.', 'Scola la pasta, condiscila con sugo e melanzane e completa con ricotta salata grattugiata.'],
      'Un pizzico di zucchero nel sugo se i pelati sono acidi.', 'appunti'),
    mk(2, 'Parmigiana di melanzane alla napoletana', 'Secondo', 90, 6, 'Media',
      ['Melanzane|1 kg', 'Passata di pomodoro|700 ml', 'Fior di latte|250 g', 'Parmigiano grattugiato|100 g', 'Basilico|q.b.', 'Olio per friggere|q.b.', 'Sale|q.b.'],
      ['Affetta le melanzane a 5 mm, salale e lasciale riposare 30 minuti.', 'Asciugale e friggile poche alla volta.', 'Cuoci la passata 15 minuti con olio, sale e basilico.', 'In una teglia alterna sugo, melanzane, fior di latte e parmigiano, finendo con sugo e parmigiano.', 'Cuoci a 180 °C per 35 minuti e lascia riposare prima di tagliare.'],
      '', 'link'),
    mk(3, 'Caponata siciliana', 'Contorno', 60, 4, 'Facile',
      ['Melanzane|2', 'Cipolla|1', 'Sedano|2 coste', 'Pomodori pelati|300 g', 'Olive verdi|50 g', 'Capperi|1 cucchiaio', 'Aceto di vino bianco|50 ml', 'Zucchero|1 cucchiaio', 'Basilico|q.b.', 'Olio extravergine|q.b.'],
      ['Taglia le melanzane a cubetti e friggile.', 'Rosola cipolla e sedano, aggiungi pelati, olive e capperi e cuoci 10 minuti.', 'Unisci le melanzane, sfuma con aceto e zucchero e cuoci altri 5 minuti.', 'Servi a temperatura ambiente con basilico fresco.'],
      'Meglio il giorno dopo.', 'screenshot'),
    mk(4, 'Polpette di melanzane', 'Secondo', 50, 4, 'Facile',
      ['Melanzane|2', 'Uovo|1', 'Parmigiano grattugiato|60 g', 'Pangrattato|80 g', 'Aglio|1 spicchio', 'Basilico|q.b.', 'Sale|q.b.', 'Pepe|q.b.'],
      ['Cuoci le melanzane intere in forno a 200 °C per 30 minuti, poi sbucciale e strizza la polpa.', 'Impasta la polpa con uovo, parmigiano, pangrattato, aglio tritato e basilico.', 'Forma le polpette e cuocile in forno a 200 °C per 20 minuti, girandole a metà cottura.'],
      '', 'manuale'),
    mk(5, 'Torta caprese', 'Dolce', 60, 8, 'Media',
      ['Mandorle pelate|200 g', 'Cioccolato fondente|200 g', 'Burro|200 g', 'Zucchero|200 g', 'Uova|4', 'Zucchero a velo|q.b.'],
      ['Sciogli il cioccolato con il burro e lascia intiepidire.', 'Monta i tuorli con lo zucchero, poi unisci cioccolato e mandorle tritate finemente.', 'Incorpora gli albumi montati a neve con movimenti dal basso verso l’alto.', 'Cuoci a 170 °C per circa 45 minuti e spolvera con zucchero a velo.'],
      '', 'link'),
    mk(6, 'Risotto alla milanese', 'Primo', 35, 4, 'Media',
      ['Riso Carnaroli|320 g', 'Brodo di carne|1 l', 'Zafferano|1 bustina', 'Cipolla|1/2', 'Burro|60 g', 'Parmigiano grattugiato|60 g', 'Vino bianco|100 ml'],
      ['Appassisci la cipolla tritata in metà del burro.', 'Tosta il riso, sfuma con il vino e porta a cottura aggiungendo brodo caldo poco alla volta.', 'A metà cottura aggiungi lo zafferano sciolto in un mestolo di brodo.', 'Fuori dal fuoco manteca con il burro rimasto e il parmigiano.'],
      '', 'manuale')
  ];
}

/* ============================== Stato ============================== */

const S = {
  recipes: store.get('ricettario-cache') || [],
  loaded: false, sync: 'busy', syncMsg: '',
  view: 'list', id: null, prev: 'list',
  q: '', tipo: '', ingr: [], mode: 'tabella', sort: 'recenti', coll: '', addingIngr: false,
  servings: null, checked: {},
  draft: null, draftIsNew: false, draftNotice: null, pasteOpen: false,
  src: 'link', url: '', pendingSrc: null,
  settings: null, pantryQ: '', sheet: null, importList: null
};
/* Trasparenza del vetro, come il cursore di iOS 27: 0 = trasparente, 100 = colorato */
S.glassLevel = (() => { const v = store.get('ricettario-vetro'); return typeof v === 'number' ? v : 55; })();
function setGlass(v) {
  S.glassLevel = Math.max(0, Math.min(100, v));
  const a = 0.28 + (S.glassLevel / 100) * 0.64;          // opacità del vetro: da 0,28 a 0,92
  const b = Math.round(22 - (S.glassLevel / 100) * 8);   // sfocatura: più forte quando è trasparente
  document.documentElement.style.setProperty('--glass-a', a.toFixed(2));
  document.documentElement.style.setProperty('--glass-blur', b + 'px');
  store.set('ricettario-vetro', S.glassLevel);
}
setGlass(S.glassLevel);
const byId = (id) => S.recipes.find((r) => r.id === id);
function setRecipes(list) { S.recipes = list; if (IS_GAS) store.set('ricettario-cache', list); }

/* ============================== Icone ============================== */

const I = {
  search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  x: '<svg class="icon s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg class="icon s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  heart: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  heartOn: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  heartS: '<svg class="icon s" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  more: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  arrows: '<svg class="icon s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>',
  nBook: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h11.5"/></svg>',
  nBasket: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5h17l-1.6 9a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5l3-5M16 9.5l-3-5"/></svg>',
  nHeart: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  nTry: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>',
  chevL: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4.5L7.5 12l7.5 7.5"/></svg>',
  chevR: '<svg class="icon chev-i" viewBox="0 0 10 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l6 6-6 6"/></svg>',
  chevD: '<svg class="icon xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9.5l5 5 5-5"/></svg>',
  grid: '<svg class="icon s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 4v16"/></svg>',
  minus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  plusC: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7.5v9M7.5 12h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  paste: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 14h7M8.5 18h4"/></svg>',
  nBookOn: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3.5h11a2.5 2.5 0 0 1 2.5 2.5v13.5a1 1 0 0 1-1 1H7a2.5 2.5 0 0 1-2.5-2.5V5A1.5 1.5 0 0 1 6 3.5zm.9 13.9a.9.9 0 0 0 0 1.8h10.8v-1.8z"/></svg>',
  nBasketOn: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.1 9h17.8a.6.6 0 0 1 .6.7l-1.7 9a2.5 2.5 0 0 1-2.5 2H6.7a2.5 2.5 0 0 1-2.5-2l-1.7-9a.6.6 0 0 1 .6-.7z"/><path d="M8 9.5l3-5M16 9.5l-3-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  nHeartOn: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  nTryOn: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.5 3h11a.5.5 0 0 1 .5.5v17a.5.5 0 0 1-.8.4L12 17.1l-5.2 3.8a.5.5 0 0 1-.8-.4v-17a.5.5 0 0 1 .5-.5z"/></svg>',
  plusL: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg class="icon s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  sliders: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  gear: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 0z"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  camera: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  link: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  pen: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/></svg>',
  bulb: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  spinner: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5c10 .3 18.6 8.4 19 18.6M43 26c-1 9.6-9 17.2-18.8 17.4"/></svg>'
};
const tag = (tipo) => '<span class="tag ' + (TIPO_CLASS[tipo] || '') + '">' + esc(tipo) + '</span>';

/* ============================== Filtri ============================== */

function matches(r) {
  if (S.coll === 'fav' && !r.preferita) return false;
  if (S.coll === 'prova' && !isToTry(r)) return false;
  if (S.tipo && r.tipo !== S.tipo) return false;
  if (S.ingr.length) {
    const labels = new Set((r.ingredienti || []).map((i) => (canonical(i.nome) || {}).label));
    const names = (r.ingredienti || []).map((i) => norm(i.nome));
    if (!S.ingr.every((f) => labels.has(f) || names.some((n) => n.indexOf(stem(norm(f))) >= 0))) return false;
  }
  if (S.q.trim()) {
    const hay = norm([r.titolo, r.tipo, r.note, (r.ingredienti || []).map((i) => i.nome).join(' '), (r.passaggi || []).join(' ')].join(' '));
    if (!norm(S.q).split(' ').every((t) => hay.indexOf(stem(t)) >= 0)) return false;
  }
  return true;
}
function sorted(list) {
  const l = list.slice();
  if (S.sort === 'az') l.sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
  else if (S.sort === 'tempo') l.sort((a, b) => (a.tempo_min || 1e9) - (b.tempo_min || 1e9));
  else l.sort((a, b) => String(b.modificata || '').localeCompare(String(a.modificata || '')));
  return l;
}
function ingredientIndex() {
  const map = new Map();
  S.recipes.forEach((r) => {
    const seen = new Set();
    (r.ingredienti || []).forEach((i) => {
      const c = canonical(i.nome);
      if (!c || c.cat === '-' || seen.has(c.label)) return;
      seen.add(c.label);
      const e = map.get(c.label) || { label: c.label, cat: c.cat, count: 0 };
      e.count++; map.set(c.label, e);
    });
  });
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

/* ============================== Viste ============================== */

/* ============================== Viste (Liquid Glass) ============================== */
/* Struttura comune: barra superiore con pulsanti di vetro, titolo grande, contenuti in gruppi
   a blocchi (.group) e barra dei tab flottante con il "+" staccato (.dock). */

function syncBadge() {
  if (!IS_GAS) return '<span class="sync"><i></i>Demo</span>';
  const cls = S.sync === 'ok' ? '' : S.sync === 'err' ? 'err' : 'busy';
  const txt = S.sync === 'ok' ? 'Sincronizzato' : S.sync === 'err' ? 'Drive non raggiungibile' : 'Sincronizzo…';
  return '<span class="sync ' + cls + '" title="' + esc(S.syncMsg) + '"><i></i>' + txt + '</span>';
}
function markText(t) {
  const tokens = norm(S.q).split(' ').filter((x) => x.length >= 2).map((x) => stem(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return esc(t);
  const re = new RegExp('(' + tokens.join('|') + ')', 'gi');
  return String(t).split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
}
const COLL_TITLE = { '': 'Ricettario', fav: 'Preferite', prova: 'Da provare' };
const collTitle = () => COLL_TITLE[S.coll] || 'Ricettario';

/* Pezzi riutilizzati */
const topbar = (left, right) => '<header class="topbar"><div class="tb-side">' + (left || '') + '</div><div class="tb-side end">' + (right || '') + '</div></header>';
const glassIcon = (act, label, icon, extra) => '<button class="gbtn round' + (extra || '') + '" data-act="' + act + '" aria-label="' + esc(label) + '">' + icon + '</button>';
const backBtn = (act, label) => '<button class="gbtn round" data-act="' + act + '" aria-label="' + esc(label) + '">' + I.chevL + '</button>';
const secH = (title, extra) => '<h2 class="sec-h">' + title + (extra || '') + '</h2>';
function statoSeg(cur, act) {
  return '<span class="seg" role="group" aria-label="Stato">' +
    '<button class="seg-b" data-act="' + act + '" data-v="' + CUCINATA + '" aria-pressed="' + (cur === CUCINATA) + '">Cucinata</button>' +
    '<button class="seg-b" data-act="' + act + '" data-v="' + DA_PROVARE + '" aria-pressed="' + (cur === DA_PROVARE) + '">Da provare</button></span>';
}

/* ---------- Lista ---------- */
function viewList() {
  const tipoOptions = ['<option value="">tutti</option>'].concat(TIPI.map((t) => '<option' + (S.tipo === t ? ' selected' : '') + '>' + esc(t) + '</option>')).join('');
  const sorts = { recenti: 'Recenti', az: 'A–Z', tempo: 'Più veloci' };
  return '' +
    topbar(syncBadge(),
      '<button class="gbtn" data-act="sheet-data">' + I.grid + 'Foglio</button>' +
      glassIcon('go-settings', 'Impostazioni', I.more)) +
    '<h1 class="large">' + collTitle() + '</h1>' +
    (S.coll === 'prova' ? '<p class="sub">Ricette salvate che non hai ancora cucinato. Tocca il segno di spunta quando le hai provate.</p>' : '') +
    '<label class="searchbar" for="q">' + I.search + '<span class="sr">Cerca ricette</span>' +
      '<input id="q" type="search" placeholder="Cerca per nome o ingrediente" value="' + esc(S.q) + '" autocomplete="off" enterkeyhint="search"></label>' +
    '<div class="toolbar">' +
      '<span class="seg" role="group" aria-label="Vista">' +
        '<button class="seg-b" data-act="mode" data-v="tabella" aria-pressed="' + (S.mode === 'tabella') + '">Tabella</button>' +
        '<button class="seg-b" data-act="mode" data-v="tipo" aria-pressed="' + (S.mode === 'tipo') + '">Per tipo</button></span>' +
      '<span class="spacer"></span>' +
      '<label class="menu-pill" for="sort-sel"><span class="sr">Ordina</span><select id="sort-sel">' +
        Object.keys(sorts).map((k) => '<option value="' + k + '"' + (S.sort === k ? ' selected' : '') + '>' + sorts[k] + '</option>').join('') +
      '</select>' + I.chevD + '</label>' +
    '</div>' +
    '<div class="chips" id="chips">' + chipsHtml(tipoOptions) + '</div>' +
    '<div id="results">' + resultsHtml() + '</div>' +
    navHtml();
}
function chipsHtml(tipoOptions) {
  let h = '<label class="chip' + (S.tipo ? ' on' : '') + '" for="tipo-sel">Tipo: <select id="tipo-sel">' + tipoOptions + '</select>' + I.chevD + '</label>';
  S.ingr.forEach((v) => {
    h += '<button class="chip on" data-act="ingr-remove" data-v="' + esc(v) + '" aria-label="Togli filtro ' + esc(v) + '">' + esc(v) + I.x + '</button>';
  });
  if (S.addingIngr) {
    h += '<span class="add-ingr"><label class="sr" for="ingr-in">Ingrediente da cercare</label><input id="ingr-in" list="ingr-list" placeholder="es. mandorle" enterkeyhint="done" autocomplete="off">' +
      '<datalist id="ingr-list">' + ingredientIndex().map((e) => '<option value="' + esc(e.label) + '"></option>').join('') + '</datalist></span>';
  } else {
    h += '<button class="btn link" data-act="ingr-add">+ Ingrediente</button>';
  }
  return h;
}
function rowHtml(r) {
  const n = (r.ingredienti || []).length;
  const viaIngr = S.ingr.length ? ' · con ' + S.ingr.join(', ').toLowerCase() : '';
  const sub = FONTE_LABEL[(r.fonte && r.fonte.tipo) || 'manuale'] + (viaIngr || ' · ' + n + (n === 1 ? ' ingrediente' : ' ingredienti'));
  const main = '<span class="cell-main"><span class="cell-title">' + markText(r.titolo) + (r.preferita ? '<span class="fav" aria-label="preferita">' + I.heartS + '</span>' : '') + '</span>' +
    '<span class="cell-sub">' + (isToTry(r) && S.coll !== 'prova' ? '<span class="try">da provare</span>' : '') + esc(sub) + '</span></span>';
  const right = (S.mode === 'tabella' ? tag(r.tipo) : '');
  if (S.coll === 'prova') {
    // dalla lista "Da provare" si segna come cucinata con un tocco, senza aprire la ricetta
    return '<div class="cell split"><button class="cell-open" data-act="open" data-id="' + esc(r.id) + '">' + main + right + '</button>' +
      '<button class="quick" data-act="quick-done" data-id="' + esc(r.id) + '" aria-label="Segna “' + esc(r.titolo) + '” come cucinata">' + I.check + '</button></div>';
  }
  return '<button class="cell" data-act="open" data-id="' + esc(r.id) + '">' + main + right + '<span class="chev" aria-hidden="true">' + I.chevR + '</span></button>';
}
function resultsHtml() {
  if (!S.recipes.length) {
    if (!S.loaded) return '<p class="count">Carico le ricette…</p>';
    return '<div class="group empty"><h2>Il ricettario è vuoto</h2><p>Aggiungi una ricetta da un link, da uno screenshot, da una foto dei tuoi appunti o scrivendola a mano. Se hai già un elenco, importa un CSV.</p>' +
      '<div class="chips"><button class="btn solid" data-act="go-new">' + I.plus + 'Nuova ricetta</button><button class="btn fill" data-act="csv-import">Importa CSV</button></div></div>';
  }
  const list = sorted(S.recipes.filter(matches));
  const filtered = S.q || S.tipo || S.ingr.length;
  if (!list.length) {
    const msg = S.coll === 'fav' && !filtered ? 'Non hai ancora preferite. Tocca il cuore in una ricetta per aggiungerla.'
      : S.coll === 'prova' && !filtered ? 'Hai già cucinato tutto quello che hai salvato. Le ricette importate da link, Instagram o screenshot arrivano qui finché non le segni come cucinate.'
      : 'Prova a togliere qualche filtro o a cercare un’altra parola.';
    return '<div class="group empty"><h2>Nessuna ricetta</h2><p>' + msg + '</p>' +
      (filtered ? '<button class="btn fill" data-act="clear-filters">Azzera i filtri</button>' : '') + '</div>';
  }
  let h = '';
  if (S.mode === 'tabella') {
    h += '<div class="group cells">' + list.map(rowHtml).join('') + '</div>';
  } else {
    TIPI.forEach((t) => {
      const g = list.filter((r) => r.tipo === t);
      if (!g.length) return;
      h += secH(tag(t), '<span class="sec-count">' + g.length + '</span>') + '<div class="group cells">' + g.map(rowHtml).join('') + '</div>';
    });
  }
  h += '<p class="foot">' + list.length + (list.length === 1 ? ' ricetta' : ' ricette') + (filtered ? ' · <button class="btn link inline" data-act="clear-filters">azzera filtri</button>' : '') + '</p>';
  return h;
}
function navHtml() {
  const on = (k) => (S.view === 'list' && k === 'c:' + S.coll) || (S.view === 'pantry' && k === 'pantry');
  const tab = (act, k, iconOff, iconOn, label) => '<button class="tab" data-act="' + act + '"' + (on(k) ? ' aria-current="page"' : '') + '>' + (on(k) ? iconOn : iconOff) + '<span>' + label + '</span></button>';
  return '<div class="dock"><nav class="tabbar glass" aria-label="Sezioni">' +
    tab('go-list', 'c:', I.nBook, I.nBookOn, 'Ricette') +
    tab('go-pantry', 'pantry', I.nBasket, I.nBasketOn, 'Dispensa') +
    tab('go-fav', 'c:fav', I.nHeart, I.nHeartOn, 'Preferite') +
    tab('go-try', 'c:prova', I.nTry, I.nTryOn, 'Da provare') +
    '</nav><button class="fab glass tint" data-act="go-new" aria-label="Nuova ricetta">' + I.plusL + '</button></div>';
}

/* ---------- Scheda ricetta ---------- */
function viewDetail() {
  const r = byId(S.id);
  if (!r) { S.view = 'list'; return viewList(); }
  const base = r.porzioni || null;
  const serv = S.servings || base;
  const factor = base && serv ? serv / base : 1;
  const f = r.fonte || {};
  let fonte = '<span class="val">' + esc(cap(FONTE_LABEL[f.tipo] || 'inserita a mano')) + '</span>';
  if (f.url) fonte = '<a class="val link" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.tipo === 'instagram' ? 'Instagram' : domain(f.url)) + '</a>';
  const row = (k, v) => '<div class="prop"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  return '' +
    topbar(backBtn('back', 'Torna a ' + collTitle()),
      '<span class="gcap glass">' +
        '<button class="gcap-b' + (r.preferita ? ' on' : '') + '" data-act="fav-toggle" aria-pressed="' + !!r.preferita + '" aria-label="' + (r.preferita ? 'Togli dalle preferite' : 'Aggiungi alle preferite') + '">' + (r.preferita ? I.heartOn : I.heart) + '</button>' +
        '<button class="gcap-b" data-act="edit" aria-label="Modifica">' + I.pen + '</button>' +
        '<button class="gcap-b" data-act="sheet-more" aria-label="Altre azioni">' + I.more + '</button>' +
      '</span>') +
    '<h1 class="large">' + esc(r.titolo) + '</h1>' +
    '<div class="group props">' +
      row('Stato', statoSeg(isToTry(r) ? DA_PROVARE : CUCINATA, 'stato')) +
      row('Tipo', tag(r.tipo)) +
      (r.tempo_min ? row('Tempo', '<span class="val">' + esc(fmtTime(r.tempo_min)) + '</span>') : '') +
      (r.difficolta ? row('Difficoltà', '<span class="val">' + esc(r.difficolta) + '</span>') : '') +
      (base ? row('Porzioni', '<b class="serv" aria-live="polite">' + serv + '</b>' +
        (serv !== base ? '<button class="btn link inline" data-act="serv-reset">da ' + base + '</button>' : '') +
        '<span class="stepper"><button data-act="serv" data-v="-1" aria-label="Meno porzioni">−</button><i aria-hidden="true"></i><button data-act="serv" data-v="1" aria-label="Più porzioni">+</button></span>') : '') +
      row('Fonte', fonte) +
    '</div>' +
    secH('Ingredienti') +
    '<div class="group cells">' + ((r.ingredienti || []).length ? r.ingredienti.map((i, k) => {
      const id = 'ck-' + k;
      return '<label class="ingr" for="' + id + '"><input type="checkbox" id="' + id + '" data-check="' + k + '"' + (S.checked[k] ? ' checked' : '') + '>' +
        '<span class="n">' + esc(i.nome) + '</span><span class="q">' + esc(scaleQty(i.quantita, factor)) + '</span></label>';
    }).join('') : '<p class="count pad">Nessun ingrediente inserito.</p>') + '</div>' +
    secH('Procedimento') +
    '<div class="group pad">' + ((r.passaggi || []).length ? '<ol class="steps">' + r.passaggi.map((s) => '<li><span>' + esc(s) + '</span></li>').join('') + '</ol>' : '<p class="count">Nessun passaggio inserito.</p>') + '</div>' +
    (r.note ? secH('Note') + '<div class="group pad note"><p>' + esc(r.note) + '</p></div>' : '') +
    navHtml();
}

/* ---------- Nuova ricetta ---------- */
function viewNew() {
  const opts = [
    ['link', I.link, 'Link', 'Sito di ricette o reel di Instagram'],
    ['screenshot', I.phone, 'Screenshot', 'Una o più immagini dalla libreria Foto'],
    ['appunti', I.camera, 'Foto di appunti', 'Ricetta scritta a mano: meglio se in stampatello'],
    ['manuale', I.pen, 'Compila a mano', 'Titolo, tipo, ingredienti e passaggi']
  ];
  return '' +
    topbar('<button class="gbtn" data-act="go-list">Annulla</button>', '') +
    '<h1 class="large">Nuova ricetta</h1>' +
    '<p class="sub">Da dove la prendiamo?</p>' +
    '<div class="group cells" role="group" aria-label="Origine della ricetta">' +
      opts.map((o) => '<button class="cell opt" data-act="src" data-v="' + o[0] + '" aria-pressed="' + (S.src === o[0]) + '"><span class="ic">' + o[1] + '</span><span class="cell-main"><span class="cell-title">' + o[2] + '</span><span class="cell-sub">' + o[3] + '</span></span><span class="chev" aria-hidden="true">' + (S.src === o[0] && o[0] === 'link' ? I.check : I.chevR) + '</span></button>').join('') +
    '</div>' +
    (S.src === 'link' ? secH('Indirizzo') + '<div class="group pad field">' +
      '<label class="sr" for="url-in">Indirizzo della ricetta</label><input id="url-in" class="field-input" type="url" inputmode="url" placeholder="https://" value="' + esc(S.url) + '" autocomplete="off" enterkeyhint="go">' +
      '<button class="btn big solid" data-act="transcribe-url">Trascrivi dal link</button>' +
      '<p class="count">Dai siti leggo i dati della ricetta; dai reel di Instagram leggo la descrizione. Potrai correggere tutto prima di salvare.</p></div>' : '') +
    (!IS_GAS ? '<p class="demo-band">Nella demo funziona solo “Compila a mano”: link e foto vengono letti dal tuo account Google.</p>' : '') +
    navHtml();
}

/* ---------- Modifica / inserimento ---------- */
function viewEdit() {
  const d = S.draft;
  const n = S.draftNotice;
  const tipoOpts = TIPI.map((t) => '<option' + (d.tipo === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  const diffOpts = ['<option value="">—</option>'].concat(DIFFICOLTA.map((t) => '<option' + (d.difficolta === t ? ' selected' : '') + '>' + t + '</option>')).join('');
  const prop = (label, id, control) => '<div class="prop"><label class="k" for="' + id + '">' + label + '</label><span class="v">' + control + '</span></div>';
  return '' +
    topbar('<button class="gbtn" data-act="edit-cancel">Annulla</button>', '<button class="gbtn tint" data-act="edit-save">Salva</button>') +
    (n ? '<div class="notice"><span class="lbl">' + esc(n.title) + '</span><span>' + esc(n.text) + '</span></div>' : '') +
    '<label class="sr" for="f-titolo">Titolo</label><input id="f-titolo" class="title-input" data-f="titolo" placeholder="Titolo della ricetta" value="' + esc(d.titolo) + '" autocomplete="off">' +
    '<div class="group props">' +
      '<div class="prop"><span class="k">Stato</span><span class="v">' + statoSeg(d.stato === DA_PROVARE ? DA_PROVARE : CUCINATA, 'f-stato') + '</span></div>' +
      prop('Tipo', 'f-tipo', '<select id="f-tipo" data-f="tipo">' + tipoOpts + '</select>' + I.chevD) +
      prop('Tempo', 'f-tempo', '<input id="f-tempo" type="number" inputmode="numeric" min="0" data-f="tempo_min" value="' + esc(d.tempo_min || '') + '" placeholder="0"><span class="unit">min</span>') +
      prop('Porzioni', 'f-porz', '<input id="f-porz" type="number" inputmode="numeric" min="1" data-f="porzioni" value="' + esc(d.porzioni || '') + '" placeholder="4">') +
      prop('Difficoltà', 'f-diff', '<select id="f-diff" data-f="difficolta">' + diffOpts + '</select>' + I.chevD) +
      prop('Link', 'f-url', '<input id="f-url" type="url" inputmode="url" data-f="url" value="' + esc((d.fonte && d.fonte.url) || '') + '" placeholder="facoltativo">') +
    '</div>' +
    secH('Ingredienti') +
    '<div class="group cells">' +
      d.ingredienti.map((i, k) => '<div class="edit-ingr">' +
        '<label class="sr" for="in-' + k + '">Ingrediente ' + (k + 1) + '</label><input class="n" id="in-' + k + '" data-i="' + k + '" data-k="nome" value="' + esc(i.nome) + '" placeholder="Ingrediente">' +
        '<label class="sr" for="iq-' + k + '">Quantità ' + (k + 1) + '</label><input class="q" id="iq-' + k + '" data-i="' + k + '" data-k="quantita" value="' + esc(i.quantita) + '" placeholder="Quantità">' +
        '<button class="del" data-act="ing-del" data-v="' + k + '" aria-label="Elimina ingrediente ' + (k + 1) + '">' + I.minus + '</button></div>').join('') +
      '<button class="cell add" data-act="ing-add">' + I.plusC + 'Aggiungi ingrediente</button>' +
      '<button class="cell add" data-act="paste-toggle">' + I.paste + 'Incolla un elenco</button>' +
    '</div>' +
    (S.pasteOpen ? '<div class="group pad field"><label for="paste-in" class="count">Un ingrediente per riga, es. “rigatoni 320 g”, “320 g di rigatoni” o “sale q.b.”</label>' +
      '<textarea id="paste-in" class="area" rows="5"></textarea><button class="btn fill" data-act="paste-apply">Aggiungi all’elenco</button></div>' : '') +
    secH('Procedimento') +
    '<div class="group cells">' +
      d.passaggi.map((s, k) => '<div class="edit-step"><span class="num" aria-hidden="true">' + (k + 1) + '</span>' +
        '<label class="sr" for="st-' + k + '">Passaggio ' + (k + 1) + '</label><textarea class="area" id="st-' + k + '" data-s="' + k + '" rows="2">' + esc(s) + '</textarea>' +
        '<button class="del" data-act="step-del" data-v="' + k + '" aria-label="Elimina passaggio ' + (k + 1) + '">' + I.minus + '</button></div>').join('') +
      '<button class="cell add" data-act="step-add">' + I.plusC + 'Aggiungi passaggio</button>' +
    '</div>' +
    secH('Note') +
    '<div class="group pad"><label class="sr" for="f-note">Note</label><textarea id="f-note" class="area plain" data-f="note" rows="3" placeholder="Varianti, consigli, da chi l’hai avuta…">' + esc(d.note) + '</textarea></div>' +
    '<div class="edit-end"></div>';
}

/* ---------- Dispensa ---------- */
function viewPantry() {
  return '' +
    topbar(syncBadge(), '') +
    '<h1 class="large">Dispensa</h1>' +
    '<p class="sub">Gli ingredienti delle tue ricette, riuniti per voce. Toccane uno per vedere cosa puoi cucinare.</p>' +
    '<label class="searchbar" for="pq">' + I.search + '<span class="sr">Cerca ingrediente</span><input id="pq" type="search" placeholder="Cerca ingrediente" value="' + esc(S.pantryQ) + '" autocomplete="off"></label>' +
    '<div id="pantry-list" class="stack">' + pantryListHtml() + '</div>' + navHtml();
}
function pantryListHtml() {
  const q = norm(S.pantryQ);
  const all = ingredientIndex().filter((e) => !q || norm(e.label).indexOf(q) >= 0);
  if (!all.length) return '<p class="count">' + (S.recipes.length ? 'Nessun ingrediente corrisponde.' : 'Gli ingredienti compariranno qui quando aggiungerai le prime ricette.') + '</p>';
  return CATS.map((cat) => {
    const items = all.filter((e) => e.cat === cat);
    if (!items.length) return '';
    return '<section class="group pad pantry-cat"><h2>' + esc(cat) + '<span class="sec-count">' + items.length + '</span></h2>' +
      '<div class="chips">' + items.map((e) => '<button class="pantry-chip" data-act="pantry-pick" data-v="' + esc(e.label) + '">' + esc(e.label) + '<small>' + e.count + '</small></button>').join('') + '</div></section>';
  }).join('');
}

/* ---------- Impostazioni ---------- */
function viewConnect() {
  const c = S.connect || (S.connect = { url: BRIDGE_URL, codice: CODICE });
  const askUrl = !CONF.url;
  return '' +
    topbar(CODICE ? backBtn('go-settings', 'Torna alle Impostazioni') : '', '') +
    '<h1 class="large">' + (CODICE ? 'Codice di accesso' : 'Ricettario') + '</h1>' +
    '<p class="sub">' + (CODICE ? 'Inserisci il nuovo codice generato con impostaCodice() nel progetto Apps Script.' : 'Inserisci il codice di accesso per collegare l’app alle tue ricette su Google.') + '</p>' +
    '<div class="group pad field">' +
      (askUrl ? '<label class="count" for="c-url">Indirizzo del ponte (finisce con /exec)</label><input id="c-url" class="field-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(c.url) + '">' : '') +
      '<label class="count" for="c-codice">Codice di accesso</label><input id="c-codice" class="field-input code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="12 caratteri" value="' + esc(c.codice) + '">' +
      '<button class="btn big solid" data-act="connect-save">Collega</button>' +
      '<p class="count">Il codice resta solo su questo dispositivo. Lo trovi nel Registro di esecuzione di Apps Script dopo aver eseguito setup o impostaCodice.</p>' +
    '</div>' +
    (CODICE ? '' : '<button class="btn link" style="align-self:center" data-act="demo-start">Prima voglio provare la demo</button>');
}
function viewSettings() {
  const s = S.settings;
  const glass = '<div class="group pad">' +
      '<div class="glass-row"><span>Trasparente</span><span>Colorato</span></div>' +
      '<label class="sr" for="glass-range">Trasparenza del vetro</label>' +
      '<input id="glass-range" class="range" type="range" min="0" max="100" step="1" value="' + S.glassLevel + '">' +
      '<p class="count">Regola quanto il vetro di barre e pulsanti lascia vedere il contenuto, come in Impostazioni › Schermo di iOS 27. Vale solo per questo dispositivo.</p></div>';
  let h = topbar(backBtn('go-list', 'Torna al ricettario'), '') + '<h1 class="large">Impostazioni</h1>' + secH('Aspetto') + glass;
  if (!IS_GAS) {
    return h + secH('Demo') + '<div class="group pad"><p class="count">Questa è la demo: le ricette restano in questo browser. Inserendo il codice di accesso l’app salva sul tuo Drive e nel Foglio e importa da link, Instagram e foto.</p>' +
      '<div class="chips">' + (window.RICETTARIO_DEMO ? '' : '<button class="btn solid" data-act="go-connect">Inserisci il codice</button>') + '<button class="btn fill" data-act="demo-reset">Ripristina le ricette di esempio</button></div></div>' + navHtml();
  }
  h += secH('Google Drive') +
    '<div class="group pad"><p class="count">L’app vede solo i file che ha creato: la cartella “Ricettario” con <strong>ricette.json</strong> (l’archivio) e il Foglio <strong>Ricettario</strong>, aggiornato a ogni salvataggio. Il resto del tuo Drive le è invisibile.</p>' +
    (s ? '<div class="chips"><a class="btn solid" href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">Apri il Foglio</a><a class="btn fill" href="' + esc(s.folderUrl) + '" target="_blank" rel="noopener">Apri la cartella</a></div>' : '<p class="count">Carico…</p>') +
    (s && s.sheetError ? '<div class="notice"><span class="lbl">Foglio non aggiornato</span><span>Le ricette sono salvate in ricette.json, ma l’ultimo aggiornamento del Foglio non è riuscito: ' + esc(s.sheetError) + '. Riprova salvando una ricetta; se l’errore resta, esegui “setup” dall’editor di Apps Script.</span></div>' : '') +
    '</div>' +
    '<div class="group cells">' +
      '<button class="cell" data-act="sheet-pull"><span class="cell-main"><span class="cell-title">Aggiorna dal Foglio</span><span class="cell-sub">Riporta nell’app le modifiche fatte a mano nel Foglio</span></span><span class="chev" aria-hidden="true">' + I.chevR + '</span></button>' +
      '<button class="cell" data-act="csv-download"><span class="cell-main"><span class="cell-title">Scarica CSV</span></span><span class="chev" aria-hidden="true">' + I.chevR + '</span></button>' +
      '<button class="cell" data-act="csv-import"><span class="cell-main"><span class="cell-title">Importa CSV</span></span><span class="chev" aria-hidden="true">' + I.chevR + '</span></button>' +
    '</div>' +
    secH('Lettura delle foto') +
    '<div class="group pad"><p class="count">Uso l’OCR di Google Drive: la foto diventa per pochi secondi un documento nella cartella “Ricettario”, ne leggo il testo e lo elimino. Le foto non vengono conservate. Funziona bene con testo stampato e scrittura in stampatello; con il corsivo è meno preciso.</p></div>';
  h += secH('Accesso') + '<div class="group cells">' +
    '<button class="cell" data-act="go-connect"><span class="cell-main"><span class="cell-title">Cambia codice di accesso</span><span class="cell-sub">Dopo aver eseguito impostaCodice() in Apps Script</span></span><span class="chev" aria-hidden="true">' + I.chevR + '</span></button>' +
    '<button class="cell" data-act="ask-disconnect"><span class="cell-main"><span class="cell-title" style="color:var(--danger)">Scollega questo dispositivo</span></span></button>' +
  '</div>';
  return h + navHtml();
}

/* ============================== Render ============================== */

const app = $('#app'), layer = $('#layer');
function render(keepScroll) {
  const y = window.scrollY;
  const v = { list: viewList, detail: viewDetail, new: viewNew, edit: viewEdit, pantry: viewPantry, settings: viewSettings, connect: viewConnect }[S.view] || viewList;
  app.innerHTML = v();
  renderLayer();
  if (!keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, y);
}
function refreshResults() { const el = $('#results'); if (el) el.innerHTML = resultsHtml(); }
function go(view, extra) { Object.assign(S, extra || {}); S.prev = S.view; S.view = view; S.sheet = null; render(); }

let toastTimer = null, busyText = null;
function toast(msg, err) {
  S.toast = { msg: msg, err: !!err };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; renderLayer(); }, err ? 6000 : 2600);
  renderLayer();
}
function busy(text, sub) { busyText = text ? { text: text, sub: sub || '' } : null; renderLayer(); }

function renderLayer() {
  let h = '';
  const sh = S.sheet;
  if (sh) {
    h += '<div class="scrim" data-act="sheet-close"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(sh.title || 'Azioni') + '" data-stop><span class="grab" aria-hidden="true"></span>';
    if (sh.type === 'more') {
      h += '<button class="menu-item" data-act="edit">' + I.pen + 'Modifica</button>' +
        '<button class="menu-item" data-act="duplicate">' + I.plus + 'Duplica</button>' +
        '<button class="menu-item danger" data-act="ask-delete">' + I.x + 'Elimina</button>' +
        '<button class="btn big line" data-act="sheet-close">Chiudi</button>';
    } else if (sh.type === 'delete') {
      const r = byId(S.id);
      h += '<h2>Eliminare “' + esc(r ? r.titolo : '') + '”?</h2><p>La ricetta sparisce dall’app e dal Foglio.</p>' +
        '<div class="chips"><button class="btn big line" style="flex:1" data-act="sheet-close">Annulla</button><button class="btn big solid" style="flex:1;background:var(--danger)" data-act="delete-confirm">Elimina</button></div>';
    } else if (sh.type === 'disconnect') {
      h += '<h2>Scollegare questo dispositivo?</h2><p>Il codice di accesso viene tolto dal telefono. Le ricette restano su Google e tornano visibili quando reinserisci il codice.</p>' +
        '<div class="chips"><button class="btn big fill" style="flex:1" data-act="sheet-close">Annulla</button><button class="btn big solid" style="flex:1;background:var(--danger)" data-act="disconnect">Scollega</button></div>';
    } else if (sh.type === 'data') {
      h += '<h2>Foglio e CSV</h2><p>Il Foglio Google contiene tutte le ricette, una per riga, e si aggiorna a ogni salvataggio.</p>' +
        (S.settings && S.settings.sheetUrl ? '<a class="menu-item" href="' + esc(S.settings.sheetUrl) + '" target="_blank" rel="noopener">' + I.link + 'Apri il Foglio</a>' : '') +
        '<button class="menu-item" data-act="sheet-pull">' + I.arrows + 'Aggiorna dal Foglio</button>' +
        '<button class="menu-item" data-act="csv-download">' + I.arrows + 'Scarica CSV</button>' +
        '<button class="menu-item" data-act="csv-import">' + I.plus + 'Importa CSV</button>' +
        '<button class="btn big line" data-act="sheet-close">Chiudi</button>';
    } else if (sh.type === 'csv-text') {
      h += '<h2>Testo del CSV</h2><p>Qui il download non è disponibile: copia il testo e incollalo in un file .csv, oppure collega l’app a Google.</p>' +
        '<label class="sr" for="csv-text">CSV</label><textarea id="csv-text" readonly>' + esc(sh.text) + '</textarea>' +
        '<div class="chips"><button class="btn big solid" style="flex:1" data-act="csv-copy">Copia</button><button class="btn big line" style="flex:1" data-act="sheet-close">Chiudi</button></div>';
    } else if (sh.type === 'import') {
      const n = S.importList.length, cur = S.recipes.length;
      const existing = S.importList.filter((r) => byId(r.id)).length;
      h += '<h2>' + n + (n === 1 ? ' ricetta trovata' : ' ricette trovate') + (sh.from === 'sheet' ? ' nel Foglio' : '') + '</h2>' +
        '<p>' + (existing ? existing + ' corrispondono a ricette già presenti e le aggiornano. ' : '') + 'Scegli come importarle.</p>' +
        '<button class="btn big solid" data-act="import-merge">Aggiungi e aggiorna</button>' +
        (cur ? '<button class="btn big line" data-act="import-replace">Sostituisci tutte le ' + cur + ' ricette attuali</button>' : '') +
        '<button class="btn big ghost" data-act="sheet-close">Annulla</button>';
    }
    h += '</div></div>';
  }
  if (busyText) h += '<div class="busy" role="status">' + I.spinner + '<p>' + esc(busyText.text) + '</p><small>' + esc(busyText.sub) + '</small></div>';
  if (S.toast) h += '<div class="toast' + (S.toast.err ? ' err' : '') + '" role="status">' + esc(S.toast.msg) + '</div>';
  layer.innerHTML = h;
}

/* ============================== Azioni ============================== */

async function persistRecipe(r) {
  const next = S.recipes.filter((x) => x.id !== r.id).concat([r]);
  S.sync = 'busy';
  await api.saveRecipe(r);
  setRecipes(next);
  S.sync = 'ok';
}
function startEdit(recipe, isNew, notice) {
  S.draft = JSON.parse(JSON.stringify(recipe));
  if (!S.draft.ingredienti.length) S.draft.ingredienti.push({ nome: '', quantita: '' });
  if (!S.draft.passaggi.length) S.draft.passaggi.push('');
  S.draftIsNew = isNew; S.draftNotice = notice || null; S.pasteOpen = false;
  go('edit');
}
async function saveDraft() {
  const d = S.draft;
  d.titolo = (d.titolo || '').trim();
  if (!d.titolo) { toast('Scrivi il titolo prima di salvare.', true); const t = $('#f-titolo'); if (t) t.focus(); return; }
  d.ingredienti = d.ingredienti.map((i) => ({ nome: cap(i.nome), quantita: (i.quantita || '').trim() })).filter((i) => i.nome);
  d.passaggi = d.passaggi.map((s) => s.trim()).filter(Boolean);
  d.tempo_min = parseInt(d.tempo_min, 10) || null;
  d.porzioni = parseInt(d.porzioni, 10) || null;
  d.modificata = nowIso();
  if (!d.creata) d.creata = d.modificata;
  busy('Salvo la ricetta…', IS_GAS ? 'Scrivo su Google Drive' : '');
  try {
    await persistRecipe(d);
    busy(null);
    toast(S.draftIsNew ? 'Ricetta aggiunta' : 'Modifiche salvate');
    S.draft = null; S.servings = null; S.checked = {};
    go('detail', { id: d.id });
  } catch (e) {
    busy(null); S.sync = 'err';
    toast('Non salvata: ' + e.message, true);
  }
}
async function setFavorite(r, on) {
  const copy = Object.assign({}, r, { preferita: on, modificata: r.modificata });
  try { await persistRecipe(copy); render(true); } catch (e) { S.sync = 'err'; toast('Non salvato: ' + e.message, true); }
}
async function setStato(r, stato) {
  const copy = Object.assign({}, r, { stato: stato, modificata: nowIso() });
  try {
    await persistRecipe(copy);
    render(true);
    toast(stato === CUCINATA ? '“' + r.titolo + '” segnata come cucinata' : 'Spostata in Da provare');
  } catch (e) { S.sync = 'err'; toast('Non salvato: ' + e.message, true); }
}
async function deleteCurrent() {
  const id = S.id;
  const next = S.recipes.filter((x) => x.id !== id);
  S.sheet = null; busy('Elimino…');
  try {
    await api.deleteRecipe(id);
    setRecipes(next); busy(null); toast('Ricetta eliminata'); go('list');
  } catch (e) { busy(null); toast('Non eliminata: ' + e.message, true); }
}
function downloadCsv() {
  const csv = toCSV(sorted(S.recipes));
  if (!IS_GAS) { S.sheet = { type: 'csv-text', text: csv, title: 'Testo del CSV' }; renderLayer(); return; }
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ricettario-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    S.sheet = null; renderLayer(); toast('CSV scaricato');
  } catch (e) {
    S.sheet = { type: 'csv-text', text: csv, title: 'Testo del CSV' }; renderLayer();
  }
}
async function doImport(mode) {
  let list;
  if (mode === 'replace') list = S.importList.slice();
  else {
    const map = new Map(S.recipes.map((r) => [r.id, r]));
    S.importList.forEach((r) => map.set(r.id, r));
    list = Array.from(map.values());
  }
  S.sheet = null; busy('Importo ' + S.importList.length + ' ricette…');
  try {
    await api.replaceAll(list);
    setRecipes(list); busy(null); toast('Importazione completata'); S.importList = null; go('list');
  } catch (e) { busy(null); toast('Importazione non riuscita: ' + e.message, true); }
}

/* Immagini: ridimensiona e, se lo screenshot è molto lungo, lo divide in parti leggibili. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({ img: img, url: url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Non riesco ad aprire “' + file.name + '”.')); };
    img.src = url;
  });
}
async function prepareImages(files) {
  const out = [];
  for (const file of files) {
    const { img, url } = await loadImage(file);
    const W = img.naturalWidth, H = img.naturalHeight;
    const scale = Math.min(1, 1400 / W);
    const tileH = Math.round(W * 1.5);
    const tiles = H / W > 2.2 ? Math.ceil(H / tileH) : 1;
    for (let t = 0; t < tiles; t++) {
      const sy = tiles > 1 ? Math.max(0, t * tileH - 60) : 0;
      const sh = tiles > 1 ? Math.min(H - sy, tileH + 60) : H;
      let w = Math.round(W * scale), h = Math.round(sh * scale);
      const lim = Math.max(w, h) > 2000 ? 2000 / Math.max(w, h) : 1;
      w = Math.round(w * lim); h = Math.round(h * lim);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, sy, W, sh, 0, 0, w, h);
      out.push({ data: c.toDataURL('image/jpeg', 0.86).split(',')[1], mime: 'image/jpeg', name: file.name });
    }
    URL.revokeObjectURL(url);
  }
  return out.slice(0, 12);
}
async function transcribeFiles(files, kind) {
  if (!files.length) return;
  if (!IS_GAS) { toast('Nella demo la lettura delle immagini non è attiva.', true); return; }
  busy(kind === 'appunti' ? 'Leggo i tuoi appunti…' : 'Leggo lo screenshot…', 'Può richiedere fino a mezzo minuto');
  try {
    const images = await prepareImages(files);
    const res = await api.transcribeImages({ kind: kind, images: images });
    const recipe = parseRecipeText(res.text, kind, '');
    const notice = recipe.ingredienti.length
      ? { title: 'Letta con l’OCR di Google', text: 'Ho diviso il testo in titolo, ingredienti e passaggi: verifica che sia tutto al posto giusto.' }
      : { title: 'Lettura incerta', text: 'Non ho riconosciuto un elenco di ingredienti. Controlla il testo qui sotto e sistemalo, oppure riprova con una foto più nitida e dritta.' };
    busy(null);
    startEdit(recipe, true, notice);
  } catch (e) { busy(null); toast(e.message, true); }
}
async function transcribeUrl() {
  const url = (S.url || '').trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) { toast('Incolla un indirizzo completo, che inizia con https://', true); return; }
  if (!IS_GAS) { toast('Nella demo l’import da link non è attivo.', true); return; }
  busy('Leggo la ricetta dal sito…', domain(url));
  try {
    const res = await api.fetchRecipeUrl(url);
    const ig = res.source === 'instagram';
    const src = ig ? 'instagram' : 'link';
    const where = ig ? 'dal reel' + (res.author ? ' di @' + res.author : '') : 'da ' + domain(url);
    let recipe, notice;
    if (res.kind === 'jsonld') {
      recipe = fromJsonLd(res.data, url);
      notice = { title: 'Importata ' + where, text: 'Ho usato i dati pubblicati dal sito. Controlla il tipo di piatto e le quantità.' };
    } else {
      recipe = parseRecipeText(res.text, src, res.title);
      recipe.fonte.url = url;
      notice = ig
        ? { title: 'Letta la descrizione ' + where, text: 'Ho diviso il testo in titolo, ingredienti e passaggi: verifica che sia tutto al posto giusto.' }
        : { title: 'Lettura parziale', text: 'Questo sito non pubblica i dati della ricetta. Ho estratto quello che potevo: correggi i campi, oppure importa da screenshot.' };
    }
    if (ig && !recipe.ingredienti.length) {
      notice = { title: 'Nella descrizione non c’è la ricetta', text: 'Questo reel sembra spiegare la ricetta solo nel video. Puoi completarla a mano oppure fare uno screenshot dei passaggi mostrati e importarlo.' };
    }
    recipe.fonte.tipo = src;
    busy(null);
    startEdit(recipe, true, notice);
  } catch (e) { busy(null); toast(e.message, true); }
}

async function pullFromSheet() {
  S.sheet = null;
  if (!IS_GAS) { toast('Nella demo il Foglio non è collegato.', true); return; }
  busy('Leggo il Foglio…');
  try {
    const rows = await api.getSheetRows();
    S.importList = recipesFromRows(rows);
    busy(null);
    S.sheet = { type: 'import', title: 'Aggiorna dal Foglio', from: 'sheet' }; renderLayer();
  } catch (e) { busy(null); toast(e.message, true); }
}

const actions = {
  'go-list': () => go('list', { coll: '' }),
  'go-fav': () => go('list', { coll: 'fav' }),
  'go-try': () => go('list', { coll: 'prova' }),
  'quick-done': (el) => { const r = byId(el.dataset.id); if (r) setStato(r, CUCINATA); },
  'stato': (el) => { const r = byId(S.id); if (r && r.stato !== el.dataset.v) setStato(r, el.dataset.v); },
  'f-stato': (el) => { S.draft.stato = el.dataset.v; render(true); },
  'go-pantry': () => go('pantry'),
  'go-new': () => go('new', { src: 'link' }),
  'go-settings': () => { go('settings'); loadSettings(); },
  back: () => go('list'),
  mode: (el) => { S.mode = el.dataset.v; render(true); },
  'clear-filters': () => { S.q = ''; S.tipo = ''; S.ingr = []; render(); },
  'ingr-add': () => { S.addingIngr = true; render(true); const i = $('#ingr-in'); if (i) i.focus(); },
  'ingr-remove': (el) => { S.ingr = S.ingr.filter((v) => v !== el.dataset.v); render(true); },
  open: (el) => go('detail', { id: el.dataset.id, servings: null, checked: {} }),
  'fav-toggle': () => { const r = byId(S.id); if (r) setFavorite(r, !r.preferita); },
  serv: (el) => { const r = byId(S.id); S.servings = Math.max(1, (S.servings || r.porzioni) + parseInt(el.dataset.v, 10)); render(true); },
  'serv-reset': () => { S.servings = null; render(true); },
  'sheet-more': () => { S.sheet = { type: 'more', title: 'Azioni ricetta' }; renderLayer(); },
  'sheet-data': () => { S.sheet = { type: 'data', title: 'Foglio e CSV' }; renderLayer(); if (IS_GAS && !S.settings) loadSettings().then(() => { if (S.sheet && S.sheet.type === 'data') renderLayer(); }); },
  'sheet-pull': pullFromSheet,
  'sheet-close': () => { S.sheet = null; renderLayer(); },
  edit: () => { const r = byId(S.id); if (r) startEdit(r, false); },
  duplicate: () => { const r = byId(S.id); if (!r) return; const c = JSON.parse(JSON.stringify(r)); c.id = uid(); c.titolo += ' (copia)'; c.creata = ''; c.preferita = false; c.stato = DA_PROVARE; startEdit(c, true); },
  'ask-delete': () => { S.sheet = { type: 'delete', title: 'Elimina' }; renderLayer(); },
  'delete-confirm': deleteCurrent,
  src: (el) => {
    const v = el.dataset.v;
    if (v === 'manuale') { startEdit(emptyRecipe('manuale'), true); return; }
    S.src = v;
    if (v === 'screenshot' || v === 'appunti') { S.pendingSrc = v; const f = $('#file-img'); f.value = ''; f.click(); }
    render(true);
    if (v === 'link') { const u = $('#url-in'); if (u) u.focus(); }
  },
  'transcribe-url': transcribeUrl,
  'ing-add': () => { S.draft.ingredienti.push({ nome: '', quantita: '' }); render(true); const k = S.draft.ingredienti.length - 1; const el = $('#in-' + k); if (el) el.focus(); },
  'ing-del': (el) => { S.draft.ingredienti.splice(+el.dataset.v, 1); render(true); },
  'step-add': () => { S.draft.passaggi.push(''); render(true); const el = $('#st-' + (S.draft.passaggi.length - 1)); if (el) el.focus(); },
  'step-del': (el) => { S.draft.passaggi.splice(+el.dataset.v, 1); render(true); },
  'paste-toggle': () => { S.pasteOpen = !S.pasteOpen; render(true); const p = $('#paste-in'); if (p) p.focus(); },
  'paste-apply': () => {
    const t = $('#paste-in').value;
    const items = t.split(/\r?\n/).map(splitIngredient).filter(Boolean);
    S.draft.ingredienti = S.draft.ingredienti.filter((i) => i.nome || i.quantita).concat(items);
    S.pasteOpen = false; render(true); toast(items.length + ' ingredienti aggiunti');
  },
  'edit-save': saveDraft,
  'edit-cancel': () => { const wasNew = S.draftIsNew; S.draft = null; if (wasNew) go('list'); else go('detail'); },
  'pantry-pick': (el) => { S.ingr = [el.dataset.v]; S.q = ''; S.tipo = ''; go('list', { coll: '' }); },
  'csv-download': downloadCsv,
  'csv-import': () => { S.sheet = null; renderLayer(); const f = $('#file-csv'); f.value = ''; f.click(); },
  'csv-copy': () => {
    const ta = $('#csv-text');
    const done = () => toast('Copiato');
    try { navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); }); } catch (e) { ta.select(); }
  },
  'import-merge': () => doImport('merge'),
  'import-replace': () => doImport('replace'),
  'go-connect': () => { S.connect = null; go('connect'); },
  'demo-start': () => { store.set(MODE_KEY, 'demo'); location.reload(); },
  'ask-disconnect': () => { S.sheet = { type: 'disconnect', title: 'Scollega' }; renderLayer(); },
  'disconnect': () => {
    ['ricettario-cache', CODE_KEY, MODE_KEY].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* storage non disponibile */ } });
    location.reload();
  },
  'connect-save': async () => {
    const url = String(CONF.url || S.connect.url || '').trim();
    const codice = String(S.connect.codice || '').trim().toUpperCase();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { toast(CONF.url ? 'L’indirizzo in config.js non è valido: deve finire con /exec.' : 'L’indirizzo deve iniziare con https://script.google.com/macros/s/ e finire con /exec', true); return; }
    if (codice.length < 8) { toast('Il codice è troppo corto: copialo intero dal Registro di esecuzione.', true); return; }
    busy('Provo il collegamento…');
    try {
      await callBridge(url, codice, 'ping', []);
      store.set(CODE_KEY, codice);
      if (!CONF.url) store.set(URL_KEY, url);
      try { localStorage.removeItem(MODE_KEY); localStorage.removeItem('ricettario-cache'); } catch (e) { /* storage non disponibile */ }
      location.reload();
    } catch (e) { busy(null); toast(e.message, true); }
  },
  'demo-reset': () => { const l = demoRecipes(); store.set(DEMO_KEY, l); setRecipes(l); toast('Ricette di esempio ripristinate'); go('list'); }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.classList.contains('scrim') && e.target.closest('[data-stop]')) return; // click dentro il foglio
  e.preventDefault();
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderLayer(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'c-url') { S.connect.url = t.value; return; }
  if (t.id === 'c-codice') { S.connect.codice = t.value; return; }
  if (t.id === 'q') { S.q = t.value; refreshResults(); return; }
  if (t.id === 'pq') { S.pantryQ = t.value; $('#pantry-list').innerHTML = pantryListHtml(); return; }
  if (t.id === 'url-in') { S.url = t.value; return; }
  if (t.id === 'glass-range') { setGlass(+t.value); return; }
  if (!S.draft) return;
  if (t.dataset.f) {
    if (t.dataset.f === 'url') S.draft.fonte = Object.assign({}, S.draft.fonte, { url: t.value.trim() });
    else S.draft[t.dataset.f] = t.value;
  } else if (t.dataset.i != null) {
    S.draft.ingredienti[+t.dataset.i][t.dataset.k] = t.value;
  } else if (t.dataset.s != null) {
    S.draft.passaggi[+t.dataset.s] = t.value;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tipo-sel') { S.tipo = t.value; render(true); }
  else if (t.id === 'sort-sel') { S.sort = t.value; refreshResults(); }
  else if (t.dataset.check != null) { S.checked[t.dataset.check] = t.checked; }
  else if (t.id === 'ingr-in') { addIngrFilter(t.value); }
  else if (t.id === 'file-img') { transcribeFiles(Array.from(t.files || []), S.pendingSrc || 'screenshot'); }
  else if (t.id === 'file-csv') {
    const f = t.files && t.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { S.importList = recipesFromCSV(reader.result); S.sheet = { type: 'import', title: 'Importa CSV' }; renderLayer(); }
      catch (err) { toast(err.message, true); }
    };
    reader.onerror = () => toast('Non riesco a leggere il file.', true);
    reader.readAsText(f, 'UTF-8');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'ingr-in') { e.preventDefault(); addIngrFilter(e.target.value); }
  else if (e.target.id === 'url-in') { e.preventDefault(); transcribeUrl(); }
  else if (e.target.id === 'q') { e.target.blur(); }
});
function addIngrFilter(v) {
  v = String(v || '').trim();
  S.addingIngr = false;
  if (v) {
    const c = canonical(v);
    const label = c && c.cat !== 'Altro' ? c.label : cap(v.toLowerCase());
    if (S.ingr.indexOf(label) < 0) S.ingr.push(label);
  }
  render(true);
}

/* ============================== Avvio ============================== */

async function loadSettings() {
  try { S.settings = await api.getSettings(); if (S.view === 'settings') render(true); } catch (e) { toast(e.message, true); }
}
async function boot() {
  if (!IS_GAS && !DEMO) { S.view = 'connect'; render(); return; }
  render();
  try {
    const list = await api.getRecipes();
    setRecipes(list || []); S.loaded = true; S.sync = 'ok';
  } catch (e) {
    S.loaded = true; S.sync = 'err'; S.syncMsg = e.message;
    if (e.auth) { toast(e.message, true); S.connect = null; go('connect'); return; }
    toast('Google non raggiungibile: mostro l’ultima copia salvata sul telefono.', true);
  }
  if (S.view === 'list' || S.view === 'pantry') render(true);
  if (IS_GAS) loadSettings();
}
boot();
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.RICETTARIO_DEMO) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* senza cache offline */ }); });
}
