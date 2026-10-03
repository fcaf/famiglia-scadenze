# Attività e Scadenze di famiglia

App web installabile sul telefono per gestire le attività e le scadenze di casa, lavoro e
famiglia: elenco condiviso, attività private, calendario, report stampabili in PDF e
promemoria giornalieri. Tutto con servizi gratuiti, senza carta di credito.

```
   telefono / PC                GitHub Pages              Supabase (gratis)
  ┌───────────────┐            ┌──────────────┐          ┌──────────────────┐
  │  app (PWA)    │ ─ pagina ─►│ i file di    │          │ database Postgres│
  │  installata   │            │ questo repo  │          │ + accessi utente │
  └───────┬───────┘            └──────────────┘          └────────┬─────────┘
          └──────────── dati, in tempo reale ─────────────────────┘
                                   ▲
                  GitHub Actions ──┘  (una volta al giorno: promemoria push)
```

---

## Che cosa serve

* un account **Supabase** gratuito (https://supabase.com) — non chiede la carta di credito;
* il tuo account **GitHub**;
* circa mezz'ora la prima volta.

---

## 1. Crea il progetto Supabase

1. Entra in https://supabase.com → **New project**.
2. Nome: `famiglia-scadenze`. Scegli una password per il database (conservala) e la regione
   **Central EU (Frankfurt)**, la più vicina all'Italia.
3. Attendi un paio di minuti che il progetto sia pronto.
4. Vai in **Project Settings → API** e tieni a portata di mano:
   * **Project URL** → somiglia a `https://abcdefgh.supabase.co`
   * **anon public** → una stringa lunga
   * **service_role** → l'altra stringa lunga: **è una chiave riservata**, serve solo al
     punto 6 e non va mai messa nei file dell'app.

## 2. Crea le tabelle

1. Nel menù a sinistra: **SQL Editor → New query**.
2. Apri il file `supabase/schema.sql` di questo progetto, copia tutto il contenuto, incollalo
   nell'editor e premi **Run**.
3. Deve comparire *Success*. Da ora esistono le tabelle `attivita`, `membri` e
   `push_iscrizioni`, con le regole che rendono visibili a tutti le attività condivise e solo
   all'autore quelle private.
4. Ripeti la stessa operazione con il file `aggiornamento-2.sql`: aggiunge le tabelle `tag` e
   `valori`, che rendono modificabili dall'app i tag, le priorità e le ricorrenze. Senza
   questo passaggio l'app avvisa che le tabelle mancano e non parte.

## 3. Crea gli accessi dei familiari

1. **Authentication → Users → Add user → Create new user**.
2. Inserisci email e password del familiare e **attiva «Auto Confirm User»** (altrimenti
   l'utente resta in attesa di una mail di conferma).
3. Ripeti per ogni persona di famiglia. Ognuno potrà poi cambiare il proprio nome
   visualizzato dentro l'app.
4. Consigliato: **Authentication → Sign In / Providers → Email** e disattiva
   *«Allow new users to sign up»*, così nessuno può registrarsi da solo.

## 4. Chiavi per le notifiche (facoltativo ma consigliato)

1. Apri con un doppio clic il file `strumenti/chiavi-vapid.html` (si apre nel browser, le
   chiavi vengono generate sul tuo computer e non vengono inviate a nessuno).
2. Premi **Genera la coppia di chiavi**.
3. Copia la **chiave pubblica**: serve al punto 5. Tieni da parte la **chiave privata**: serve
   al punto 6 e va messa solo nei «Secrets» di GitHub.

## 5. Compila la configurazione

Apri `config.js` con un editor di testo (Blocco note va benissimo) e sostituisci i tre valori:

```js
SUPABASE_URL:  "https://abcdefgh.supabase.co",   // punto 1
SUPABASE_ANON: "la-chiave-anon-public",          // punto 1
VAPID_PUBLIC:  "la-chiave-pubblica-generata"     // punto 4 (lascia "" se niente notifiche)
```

## 6. Pubblica l'app su GitHub Pages

1. Su GitHub crea un nuovo repository, ad esempio `famiglia-scadenze`, **pubblico**
   (con il piano gratuito GitHub Pages funziona solo sui repository pubblici).
2. Carica tutti i file di questa cartella: *Add file → Upload files*, poi seleziona tutti i
   file e trascinali nella pagina. Stanno tutti sullo stesso livello proprio per evitare
   problemi: non ci sono sottocartelle da ricostruire.
   L'unica eccezione è il file del promemoria giornaliero, che **deve** stare in
   `.github/workflows/`: si crea con *Add file → Create new file* scrivendo come nome
   `.github/workflows/promemoria.yml` (le barre creano le cartelle da sole) e incollando
   dentro il contenuto del file `promemoria.yml`.
3. **Settings → Pages → Build and deployment → Deploy from a branch**, ramo `main`,
   cartella `/ (root)`, **Save**.
4. Dopo un paio di minuti l'app è online all'indirizzo
   `https://TUO-UTENTE.github.io/famiglia-scadenze/` — provala e accedi con uno degli
   utenti creati al punto 3.

> **Il repository è pubblico: è un problema?** No. Nei file ci sono solo l'indirizzo del
> progetto e la chiave *anon*, che sono pensati per stare in chiaro dentro le pagine web: da
> soli non danno accesso a nulla, perché ogni lettura e scrittura passa dal login e dalle
> regole impostate al punto 2. Le uniche cose riservate — la chiave *service_role* e la chiave
> VAPID privata — stanno nei Secrets di GitHub, che restano nascosti anche nei repository
> pubblici.

## 7. Attiva i promemoria giornalieri

1. Nel repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Crea questi cinque segreti:

   | Nome | Valore |
   |---|---|
   | `SUPABASE_URL` | l'indirizzo del progetto (punto 1) |
   | `SUPABASE_SERVICE_KEY` | la chiave **service_role** (punto 1) |
   | `VAPID_PUBLIC` | la chiave pubblica (punto 4) |
   | `VAPID_PRIVATE` | la chiave privata (punto 4) |
   | `VAPID_SUBJECT` | `mailto:tua@email.it` |

2. Vai nella scheda **Actions** e, se richiesto, conferma l'abilitazione dei workflow.
3. Apri **Promemoria scadenze → Run workflow** per una prova immediata.
4. Nell'app, su ogni telefono: tocca l'iniziale in alto a destra → attiva
   **Promemoria sul telefono** e concedi il permesso.

L'orario si cambia in `.github/workflows/promemoria.yml`: `cron: "0 6 * * *"` significa le
06:00 UTC, cioè le 8 del mattino con l'ora legale e le 7 con l'ora solare.

## 8. Installa l'app sul telefono

* **Android (Chrome)**: apri l'indirizzo → menù ⋮ → *Installa app* / *Aggiungi a schermata Home*.
* **iPhone (Safari)**: apri l'indirizzo → tasto Condividi → *Aggiungi a Home*.
  Su iPhone le notifiche push funzionano **solo** dopo averla aggiunta alla schermata Home
  (serve iOS 16.4 o successivo).

## 9. Porta dentro i dati dell'Excel

Nell'app: iniziale in alto a destra → **Importa da Excel** → scegli il file `attivita.xlsx`.
Vengono riconosciute le colonne `tag`, `descrizione`, `scadenza`, `fatto`, `in data`,
`priorita`, `ricorrenza`, `importo` (e `privata`, se c'è). Le attività importate nascono come
condivise; puoi renderne private singolarmente quelle che vuoi.

---

## Come si usa

* **Impostazioni** — la rotella in basso a destra: qui si gestiscono i **tag** (aggiungi,
  rinomina, cambia colore, riordina, elimina spostando le attività su un altro tag), le
  **priorità** e le **ricorrenze** (ogni ricorrenza ha un passo in giorni e/o mesi, quindi se
  ne possono creare di nuove, per esempio «ogni 10 giorni»). Più in basso: i valori proposti
  per le nuove attività, i giorni di preavviso, quali indicatori mostrare in alto, il tema
  chiaro/scuro e il tuo account.
* **Elenco** — le attività di tutta la famiglia, raggruppate per periodo. Il quadratino a sinistra le spunta; toccando
  il testo si aprono i dettagli. Le caselle in alto (scadute, oggi, 7 giorni, da fare, da
  pagare) sono pulsanti: toccale per filtrare.
* **Privata** — l'interruttore dentro la scheda dell'attività. Un'attività privata è visibile e
  modificabile solo da chi l'ha creata: gli altri familiari non la vedono proprio, nemmeno
  nei loro report.
* **Ricorrenza** — quando spunti un'attività ricorrente, l'app crea subito la successiva con la
  scadenza calcolata in base al passo impostato nelle impostazioni.
* **Calendario** — le scadenze del mese; tocca un giorno per vedere e aggiungere.
* **Report** — scegli tag, stato, periodo, ordinamento e raggruppamento, poi *Stampa / Salva
  come PDF*. Dal telefono: Condividi → Stampa → Salva come PDF.
* **Sincronizzazione** — le modifiche appaiono sugli altri dispositivi entro pochi secondi.
  Senza rete l'app si apre comunque e mostra l'ultimo elenco scaricato.

## Da sapere

* **Supabase gratuito** mette in pausa i progetti dopo 7 giorni di inattività. Il lavoro
  giornaliero dei promemoria interroga il database ogni mattina e quindi lo tiene sveglio da
  solo. Se dovesse comunque risultare in pausa, si riattiva con un clic dal pannello Supabase.
* **GitHub Actions** sospende i lavori programmati dopo 60 giorni senza modifiche al
  repository: basta un commit qualsiasi, o il pulsante *Enable workflow*, per riattivarli.
* **Limiti gratuiti** (ampiamente sufficienti per una famiglia): 500 MB di database, 50.000
  utenti attivi al mese, 5 GB di traffico.
* **Backup**: *Esporta in Excel* dal menù account, ogni tanto. Il file contiene anche le tue
  attività private.

## Se qualcosa non va

> Se qualcosa non va, l'app non resta mai bianca: mostra un riquadro con il motivo. Se vedi
> comunque una pagina bianca o la schermata «File not found» di GitHub, il problema è a monte —
> vedi le prime due righe della tabella.

| Sintomo | Causa più probabile |
|---|---|
| Pagina bianca o «404 File not found» | i file sono finiti dentro una sottocartella: nella pagina iniziale del repository devi vedere subito `index.html`, `app.js`, `stile.css` e gli altri, senza doppi clic |
| La pagina non cambia dopo una modifica | la pubblicazione richiede 1-2 minuti (vedi il pallino giallo/verde in alto a destra nel repository); poi ricarica con Ctrl+F5, o chiudi e riapri l'app sul telefono |
| «L'app non è ancora configurata» | `config.js` non compilato, o caricato su GitHub senza le modifiche |
| «Email o password non corretti» | utente non creato, oppure creato senza *Auto Confirm User* |
| L'elenco resta vuoto | lo `schema.sql` non è stato eseguito, oppure è stato eseguito a metà |
| Riquadro «Un file necessario non è stato caricato» | quel file manca nel repository o è finito in una sottocartella: deve stare accanto a `index.html` |
| Le notifiche non arrivano | chiave VAPID diversa fra `config.js` e i Secrets, interruttore non attivato su quel telefono, oppure su iPhone l'app non è stata aggiunta alla schermata Home |
| Il workflow fallisce | controlla i cinque segreti nella scheda Actions: il messaggio di errore dice quale manca |
| Vuoi vedere che cosa verrebbe inviato | dal tuo PC, nella cartella del progetto: `npm install` e poi `DRY_RUN=1 SUPABASE_URL=... SUPABASE_SERVICE_KEY=... VAPID_PUBLIC=... VAPID_PRIVATE=... node scripts/promemoria.mjs` — stampa i messaggi senza spedirli |
| Scritta «offline» in alto | manca la rete, oppure il progetto Supabase è in pausa |

## Nota sulle librerie

Nel progetto ci sono due librerie open source incluse: `supabase.min.js`
(client Supabase, licenza MIT) e `xlsx.full.min.js` (SheetJS, licenza Apache 2.0). Sono incluse
di proposito invece di essere richiamate da un servizio esterno: così l'app funziona anche se
una rete, un antivirus o un blocco pubblicità impedisce di raggiungere i CDN.

## I file

Tutti i file stanno sullo stesso livello, nella radice del repository: l'unico che va in una
cartella è il workflow dei promemoria.

```
index.html                       la pagina dell'app
config.js                        i tuoi tre valori (unico file da compilare)
app.js                           tutta la logica dell'app
stile.css                        aspetto, compresa l'impaginazione del report
supabase.min.js                  libreria Supabase (inclusa: nessuna dipendenza esterna)
591.supabase.js                  piccolo file di servizio della libreria Supabase
xlsx.full.min.js                 libreria per leggere e scrivere i file Excel
sw.js, manifest.webmanifest      installazione sul telefono e funzionamento offline
icona-192.png, icona-512.png,
icona-maskable.png               icone dell'app
schema.sql                       tabelle e regole di accesso del database (primo avvio)
aggiornamento-2.sql              tabelle tag e valori (da eseguire una volta sola)
GUIDA-PROMEMORIA.txt             come attivare i promemoria giornalieri, passo passo
chiavi-vapid.html                generatore delle chiavi per le notifiche
promemoria.mjs                   invio dei promemoria giornalieri
package.json                     elenco delle librerie usate dal promemoria
.github/workflows/promemoria.yml quando farlo partire (unico file in una cartella)
```
