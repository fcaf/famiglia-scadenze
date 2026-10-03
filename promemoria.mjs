/* =====================================================================
   Promemoria giornalieri via notifica push.
   Eseguito da GitHub Actions una volta al giorno (gratis).

   Parla con Supabase via chiamate HTTP diritte, senza la libreria
   @supabase/supabase-js: quella porta con sé il client "tempo reale",
   che su alcune versioni di Node pretende un WebSocket non disponibile
   e faceva fallire l'esecuzione. Qui serve solo leggere e cancellare
   qualche riga, e fetch basta e avanza.
   ===================================================================== */
import webpush from "web-push";

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT = "mailto:promemoria@example.com"
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC, VAPID_PRIVATE })) {
  if (!v) { console.error(`Manca il segreto ${k}.`); process.exit(1); }
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const BASE = String(SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/";
const INTESTAZIONI = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
  "Content-Type": "application/json"
};
async function api(percorso, opzioni = {}) {
  const r = await fetch(BASE + percorso, { ...opzioni, headers: { ...INTESTAZIONI, ...(opzioni.headers || {}) } });
  if (!r.ok) {
    const testo = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} su ${percorso} — ${testo.slice(0, 300)}`);
  }
  return r.status === 204 ? null : r.json();
}

const pad = n => String(n).padStart(2, "0");
const romaOggi = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());                                  // formato AAAA-MM-GG
const fmt = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";

const oggi = romaOggi();

/* --- attività da fare con scadenza entro oggi ------------------------ */
let attivita, iscrizioni;
try {
  attivita = await api("attivita?select=id,descrizione,tag,scadenza,importo,privata,autore,priorita"
    + "&fatto=eq.false&scadenza=not.is.null&scadenza=lte." + oggi + "&order=scadenza.asc");
} catch (e) {
  console.error("Lettura attività non riuscita:", e.message);
  console.error("Controlla i segreti SUPABASE_URL e SUPABASE_SERVICE_KEY (serve la chiave service_role).");
  process.exit(1);
}
try {
  iscrizioni = await api("push_iscrizioni?select=id,utente,endpoint,p256dh,auth");
} catch (e) {
  console.error("Lettura iscrizioni non riuscita:", e.message);
  process.exit(1);
}

console.log(`Oggi è ${oggi}: ${attivita.length} attività in scadenza, ${iscrizioni.length} dispositivi iscritti.`);
if (!iscrizioni.length) {
  console.log("Nessun dispositivo iscritto: attiva «Promemoria sul telefono» nelle impostazioni dell'app.");
  process.exit(0);
}
if (!attivita.length) {
  console.log("Niente di scaduto o in scadenza oggi: nessuna notifica da inviare.");
  process.exit(0);
}

/* --- messaggio su misura per ciascun utente -------------------------- */
function messaggio(perUtente) {
  const visibili = attivita.filter(a => !a.privata || a.autore === perUtente);
  if (!visibili.length) return null;
  const tardi = visibili.filter(a => a.scadenza < oggi);
  const diOggi = visibili.filter(a => a.scadenza === oggi);
  const parti = [];
  if (tardi.length) parti.push(`${tardi.length} in ritardo`);
  if (diOggi.length) parti.push(`${diOggi.length} in scadenza oggi`);
  const elenco = visibili.slice(0, 3)
    .map(a => `• ${a.descrizione}${a.scadenza < oggi ? " (dal " + fmt(a.scadenza) + ")" : ""}`).join("\n");
  const extra = visibili.length > 3 ? `\n…e altre ${visibili.length - 3}` : "";
  const daPagare = visibili.reduce((s, a) => s + (+a.importo || 0), 0);
  const soldi = daPagare
    ? `\nDa pagare: ${new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(daPagare)}`
    : "";
  return { titolo: `Scadenze: ${parti.join(", ")}`, corpo: elenco + extra + soldi, url: "./" };
}

/* --- invio ----------------------------------------------------------- */
let inviate = 0, rimosse = 0, errori = 0;
for (const i of iscrizioni) {
  const msg = messaggio(i.utente);
  if (!msg) continue;
  if (process.env.DRY_RUN) {                                   // prova senza inviare nulla
    console.log(`[prova] utente ${i.utente}: ${msg.titolo}\n${msg.corpo}\n`);
    inviate++;
    continue;
  }
  try {
    await webpush.sendNotification(
      { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
      JSON.stringify(msg),
      { TTL: 12 * 3600, urgency: "normal" }
    );
    inviate++;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {    // dispositivo non più valido
      await api("push_iscrizioni?id=eq." + i.id, { method: "DELETE" }).catch(() => {});
      rimosse++;
    } else {
      errori++;
      console.error(`Invio fallito (${err.statusCode || "?"}):`, String(err.body || err.message).slice(0, 300));
      if (err.statusCode === 403)
        console.error("403 di solito significa che le chiavi VAPID dei segreti non sono quelle usate "
          + "dall'app in config.js: rigenerale e riattiva l'interruttore sui telefoni.");
    }
  }
}
console.log(`Notifiche inviate: ${inviate} · iscrizioni scadute rimosse: ${rimosse} · errori: ${errori}`);
if (inviate === 0 && errori > 0) process.exit(1);
