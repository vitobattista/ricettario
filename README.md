# Ricettario

Web app per iPhone che raccoglie le mie ricette: import da siti di ricette, reel di Instagram, screenshot e foto di appunti, oppure inserimento a mano. Filtri per tipo e ingredienti, dispensa, preferite, "da provare". Stile Liquid Glass (iOS 27). Si aggiunge alla schermata Home e si apre anche senza rete con l'ultima copia delle ricette.

## Come funziona

- **Il sito** (questo repository) è su GitHub Pages: solo interfaccia, nessun dato e nessun codice segreto.
- **Il ponte** è un progetto Google Apps Script (cartella `apps-script/`, da incollare in Apps Script: GitHub non lo esegue). Custodisce le ricette e fa il lavoro che un sito statico non può fare:
  - salva le ricette in `ricette.json` e nel **Foglio Google "Ricettario"**, nella cartella "Ricettario" del Drive;
  - legge i siti di ricette e le descrizioni dei reel di Instagram;
  - fa l'OCR delle foto (documento temporaneo, eliminato subito).
- **La memoria consultabile fuori dal sito** è il Foglio Google: una riga per ricetta, riscritto a ogni salvataggio. Se lo correggi a mano, nell'app: Impostazioni › *Aggiorna dal Foglio*. Non rinominare la colonna `id`.
- Il ponte vede **solo i file che ha creato** (permesso `drive.file`), non il resto del Drive.

## File

```
index.html              la pagina
styles.css              aspetto (colori, vetro, misure: variabili all'inizio del file)
app.js                  logica dell'app
config.js               URL del ponte Apps Script
manifest.webmanifest    nome e icona per "Aggiungi alla schermata Home"
sw.js                   cache per aprire l'app anche senza rete
icons/                  icone dell'app (apple-touch-icon.png 180×180)
apps-script/            il ponte: Code.gs e appsscript.json
```

## Configurazione

### 1. Il ponte (Apps Script)
**Se hai già il Ricettario su Apps Script**, usa lo stesso progetto: ricette e Foglio restano dove sono.
1. Sostituisci `Code.gs` e `appsscript.json` con quelli di `apps-script/`. Elimina i file HTML `Index`, `Styles`, `Script`.
2. **Esegui il deployment → Gestisci deployment → matita**: *Chi ha accesso* = **Chiunque**, *Versione* = **Nuova versione**. L'URL non cambia.
3. Esegui **setup**. In fondo al *Registro di esecuzione* trovi l'indirizzo del ponte e il codice di accesso.

**Da zero:** nuovo progetto su script.google.com → incolla `Code.gs` e `appsscript.json` (Impostazioni progetto › *Mostra il file manifest*) → esegui **setup** e autorizza → **Nuovo deployment → App web** (*Esegui come*: Me, *Chi ha accesso*: Chiunque) → esegui di nuovo **setup**.

I permessi richiesti devono essere solo: *file di Google Drive che utilizzi con questa app* e *collegarsi a un servizio esterno*.

### 2. Il sito (GitHub Pages)
1. Incolla l'URL che finisce con `/exec` in `config.js`.
2. Carica tutti i file nel repository (compresi `.nojekyll`, `icons/` e `apps-script/`).
3. **Settings → Pages** → Deploy from a branch → `main` / `(root)`.

### 3. Sull'iPhone
Apri il sito in Safari → **Condividi → Aggiungi alla schermata Home** → apri l'app dall'icona e inserisci il codice di accesso. L'app installata ha una memoria separata da Safari: il codice va inserito lì.

## Codice di accesso
Il ponte è pubblico ("Chiunque") perché GitHub Pages possa raggiungerlo, ma senza il codice non legge né scrive nulla; dopo 20 tentativi sbagliati in 10 minuti si blocca per 10 minuti. Il codice sta nelle Proprietà script (`TOKEN`) e **non va mai scritto in questo repository**.
Per cambiarlo: esegui `impostaCodice()` nell'editor; il vecchio smette di funzionare su tutti i dispositivi. Nell'app: Impostazioni › *Cambia codice di accesso*.

## Aggiornare
- **Sito:** dopo aver modificato i file aumenta `VERSION` in `sw.js` (es. `ricettario-v2`), così l'iPhone scarica la versione nuova.
- **Ponte:** sostituisci `Code.gs`, poi Gestisci deployment → matita → Nuova versione. URL e codice restano gli stessi.
