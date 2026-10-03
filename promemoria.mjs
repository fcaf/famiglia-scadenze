/* =====================================================================
   Promemoria giornalieri via notifica push.
   Girato da GitHub Actions una volta al giorno (gratis).
   Legge le scadenze da Supabase e invia una notifica a ogni dispositivo
   iscritto, rispettando le attività private: ognuno riceve l'elenco
   condiviso più le proprie private.
   ===================================================================== */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT = "mailto:promemoria@example.com"
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC, VAPID_PRIVATE })) {
  if (!v) { console.error(`Manca il segreto ${k}.`); process.exit(1); }
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const pad = n => String(n).padStart(2, "0");
const romaOggi = () => {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date());                       // formato AAAA-MM-GG
};
const fmt = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";

const oggi = romaOggi();

/* --- attività da fare con scadenza entro oggi ------------------------ */
const { data: attivita, error: e1 } = await sb
  .from("attivita")
  .select("id,descrizione,tag,scadenza,importo,privata,autore,priorita")
  .eq("fatto", false)
  .not("scadenza", "is", null)
  .lte("scadenza", oggi)
  .order("scadenza", { ascending: true });
if (e1) { console.error("Lettura attività non riuscita:", e1.message); process.exit(1); }

const { data: iscrizioni, error: e2 } = await sb
  .from("push_iscrizioni").select("id,utente,endpoint,p256dh,auth");
if (e2) { console.error("Lettura iscrizioni non riuscita:", e2.message); process.exit(1); }

console.log(`Oggi è ${oggi}: ${attivita.length} attività in scadenza, ${iscrizioni.length} dispositivi iscritti.`);
if (!iscrizioni.length) { console.log("Nessun dispositivo da avvisare. Fine."); process.exit(0); }

/* --- costruzione del messaggio per ciascun utente -------------------- */
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
  return {
    titolo: `Scadenze: ${parti.join(", ")}`,
    corpo: elenco + extra + soldi,
    url: "./"
  };
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
    if (err.statusCode === 404 || err.statusCode === 410) {       // dispositivo non più valido
      await sb.from("push_iscrizioni").delete().eq("id", i.id);
      rimosse++;
    } else {
      errori++;
      console.error(`Invio fallito (${err.statusCode || "?"}):`, err.body || err.message);
    }
  }
}
console.log(`Notifiche inviate: ${inviate} · iscrizioni scadute rimosse: ${rimosse} · errori: ${errori}`);
if (inviate === 0 && errori > 0) process.exit(1);
