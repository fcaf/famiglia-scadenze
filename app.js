/* =====================================================================
   FARO — Famiglia: Attività, Ricorrenze, Organizzazione
   App statica che parla con Supabase. Nessun server da gestire.
   ===================================================================== */
"use strict";

const APP = "FARO";
const VERSIONE = "5 ottobre 2026 (2)";
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio",
              "agosto","settembre","ottobre","novembre","dicembre"];
const GG = ["lun","mar","mer","gio","ven","sab","dom"];
const TAVOLOZZA = ["#1f4f8f","#7a3fa0","#1a7f52","#a85a14","#a62c2c","#0f6f80","#5d5fa8","#8a6d1f"];

const S = {
  utente:null, membri:{}, righe:[], tag:[], priorita:[], ricorrenze:[],
  vista:"elenco", canale:null, modifica:null, cal:new Date(), calSel:null,
  filtri:{ q:"", stato:"todo", chi:"", ord:"scadenza", quando:"", tag:new Set() },
  reportEsclusi:new Set()
};
let sb = null;

/* -------------------------- preferenze locali ------------------------ */
const PREF_DEF = { tag:"", prio:"", ric:"", giorni:7, kpi:["late","today","w","todo","pay"],
                   tema:"auto", gruppi:true };
let PREF = { ...PREF_DEF };
function leggiPref(){
  try{ PREF = { ...PREF_DEF, ...(JSON.parse(localStorage.getItem("pref-scadenze") || "{}")) }; }
  catch(e){ PREF = { ...PREF_DEF }; }
}
function salvaPref(){ try{ localStorage.setItem("pref-scadenze", JSON.stringify(PREF)); }catch(e){} }

/* ----------------------------- scorciatoie --------------------------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,
  m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

/* ---------------------------- date e numeri -------------------------- */
const pad = n => String(n).padStart(2,"0");
const dISO = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const oggi = () => dISO(new Date());
const daISO = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const fmt = s => s ? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : "";
const giorni = (a,b) => Math.round((daISO(b) - daISO(a)) / 86400000);
const piuGiorni = (iso,n) => { const d = daISO(iso); d.setDate(d.getDate()+n); return dISO(d); };
function piuMesi(iso,n){
  const d = daISO(iso), g = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+n);
  d.setDate(Math.min(g, new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()));
  return dISO(d);
}
const ora5 = t => t ? String(t).slice(0,5) : "";               // "09:30:00" -> "09:30"
function orario(r){
  const a = ora5(r.ora_inizio), b = ora5(r.ora_fine);
  return a && b ? a + "–" + b : a ? "dalle " + a : b ? "entro le " + b : "";
}
/* Messaggio chiaro se lo script SQL dei nuovi campi non è ancora stato eseguito. */
function spiegaErrore(err){
  const m = (err && err.message) || String(err || "");
  if(/note|luogo|ora_inizio|ora_fine/.test(m) && /column|schema cache/i.test(m))
    return "Il database non ha ancora i campi note, luogo e orario: esegui su Supabase lo script "
      + "aggiornamento-3.sql (SQL Editor → New query → incolla → Run).";
  return m;
}
/* Collegamento a Google Maps: sul telefono apre l'app Mappe, sul computer il sito. */
const linkMappa = luogo => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(luogo);
const eur = v => (v==null||v==="") ? "" :
  new Intl.NumberFormat("it-IT",{ style:"currency", currency:"EUR" }).format(v);

/* ------------------- valori configurabili: utilità ------------------- */
const nomiTag  = () => S.tag.map(t => t.nome);
const trovaTag = n => S.tag.find(t => t.nome === (n || "").toUpperCase());
function colTag(nome){
  const t = trovaTag(nome);
  const base = t ? t.colore : TAVOLOZZA[Math.abs([...String(nome||"-")]
      .reduce((h,c) => (h*31 + c.charCodeAt(0))|0, 0)) % TAVOLOZZA.length];
  return { forte: base, tenue: mescola(base, scuro() ? 0.72 : 0.88) };
}
function mescola(hex, quanto){                    // avvicina il colore allo sfondo
  const f = hex.replace("#",""), n = parseInt(f.length===3 ? f.replace(/(.)/g,"$1$1") : f, 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const s = scuro() ? 24 : 255;
  const m = c => Math.round(c + (s - c) * quanto);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
const scuro = () => document.documentElement.dataset.tema === "dark";
function pesoPrio(nome){
  const i = S.priorita.findIndex(p => p.nome === nome);
  return i < 0 ? 99 : i;
}
function colPrio(nome){
  const p = S.priorita.find(x => x.nome === nome);
  return p && p.colore ? p.colore : "var(--ink-soft)";
}
function passoRic(nome){ return S.ricorrenze.find(r => r.nome === nome) || null; }
function prossima(iso, nome){
  const v = passoRic(nome);
  if(!v || (!v.giorni && !v.mesi)) return null;
  let d = iso || oggi(); const t = oggi();
  for(let i=0;i<600;i++){
    if(v.mesi)   d = piuMesi(d, v.mesi);
    if(v.giorni) d = piuGiorni(d, v.giorni);
    if(giorni(t,d) > 0) return d;
  }
  return d;
}
const nomeDi = id => (S.membri[id] && S.membri[id].nome) || "—";
const iniziali = n => (n||"?").trim().slice(0,2).toUpperCase();

/* ------------------------------- avvisi ------------------------------ */
function avviso(testo, etichetta, azione, durata){
  const d = document.createElement("div");
  d.className = "avviso"; d.textContent = testo;
  if(etichetta){ const b = document.createElement("button"); b.textContent = etichetta;
    b.onclick = () => { azione(); d.remove(); }; d.appendChild(b); }
  $("#avvisi").appendChild(d);
  setTimeout(() => { d.style.opacity = "0"; d.style.transition = "opacity .3s";
    setTimeout(() => d.remove(), 300); }, durata || (etichetta ? 6000 : 2800));
}
const apri   = id => { $("#"+id).hidden = false; };
const chiudi = id => { $("#"+id).hidden = true; };
function conferma(titolo, testo, ok, extra, etichettaOk){
  $("#cTitolo").textContent = titolo;
  $("#cTesto").textContent = testo;
  $("#cExtra").innerHTML = extra || "";
  const b = $("#cOk"), nb = b.cloneNode(true); b.replaceWith(nb);
  nb.textContent = etichettaOk || "Elimina";
  nb.onclick = () => { const r = ok(); if(r !== false) chiudi("mConf"); };
  apri("mConf");
}
function stato(testo, errore){
  const e = $("#sync"); e.textContent = testo || ""; e.style.color = errore ? "#ffd9d9" : "";
}

/* =====================================================================
   AVVIO E ACCESSO
   ===================================================================== */
function configurato(){
  if(!window.CONFIG) return false;
  const u = String(CONFIG.SUPABASE_URL || "").trim(), k = String(CONFIG.SUPABASE_ANON || "").trim();
  if(/INCOLLA/i.test(u) || /INCOLLA/i.test(k)) return false;
  return /^https?:\/\/[^\s/]+/.test(u) && k.length > 20;
}
async function avvia(){
  try{ await avviaDavvero(); }
  catch(e){
    console.error(e);
    if(window.__erroreFatale)
      window.__erroreFatale("Si è verificato un errore durante l'avvio.", e.message,
        "i valori in config.js e che gli script dello schema siano stati eseguiti su Supabase.");
    else alert("Errore all'avvio: " + e.message);
  }
}
async function avviaDavvero(){
  leggiPref();
  applicaTema();
  collegaEventi();

  if(!configurato()){
    $("#login").hidden = false;
    $("#lgErr").hidden = false;
    $("#lgErr").innerHTML = "L'app non è ancora configurata: apri <b>config.js</b> e inserisci "
      + "l'indirizzo del progetto Supabase e la chiave anon (vedi il README).";
    $("#formLogin").hidden = true;
    return;
  }
  $("#lgNota").textContent = CONFIG.NOTA_ACCESSO || "";
  if(!window.supabase || typeof window.supabase.createClient !== "function")
    throw new Error("La libreria supabase.min.js non è stata caricata: controlla che il file "
      + "sia presente nel repository accanto a index.html.");

  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON, {
    auth:{ persistSession:true, autoRefreshToken:true }
  });

  const { data } = await sb.auth.getSession();
  if(data.session) await entrato(data.session.user); else $("#login").hidden = false;

  sb.auth.onAuthStateChange((evento, sessione) => {
    if(evento === "SIGNED_OUT") location.reload();
    else if(sessione && !S.utente) entrato(sessione.user);
  });

  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
}
async function accedi(e){
  e.preventDefault();
  const b = $("#lgBtn"); b.disabled = true; b.textContent = "Accesso…"; $("#lgErr").hidden = true;
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("#lgEmail").value.trim(), password: $("#lgPass").value
  });
  b.disabled = false; b.textContent = "Entra";
  if(error){
    $("#lgErr").hidden = false;
    $("#lgErr").textContent = /invalid/i.test(error.message)
      ? "Email o password non corretti." : "Accesso non riuscito: " + error.message;
    return;
  }
  await entrato(data.user);
}
async function entrato(utente){
  S.utente = utente;
  $("#login").hidden = true; $("#app").hidden = false;
  $("#btnAccount").textContent = iniziali(utente.email);
  mostraCache();
  await caricaElenchi();
  await Promise.all([ caricaMembri(), carica() ]);
  ascolta();
  aggiornaStatoPush();
}

/* =====================================================================
   DATI
   ===================================================================== */
function mostraCache(){
  try{
    const c = JSON.parse(localStorage.getItem("cache-attivita") || "null");
    if(c && Array.isArray(c.righe)){ S.righe = c.righe; S.tag = c.tag || []; S.priorita = c.priorita || [];
      S.ricorrenze = c.ricorrenze || []; disegna(); stato("dati locali"); }
  }catch(e){}
}
function salvaCache(){
  try{ localStorage.setItem("cache-attivita", JSON.stringify({
    righe:S.righe, tag:S.tag, priorita:S.priorita, ricorrenze:S.ricorrenze, il:Date.now() })); }catch(e){}
}
async function caricaElenchi(){
  const [t, v] = await Promise.all([
    sb.from("tag").select("*").order("ordine", { ascending:true }),
    sb.from("valori").select("*").order("ordine", { ascending:true })
  ]);
  if(t.error || v.error){
    const msg = (t.error || v.error).message;
    if(/relation|does not exist|schema cache/i.test(msg))
      throw new Error("Le tabelle «tag» e «valori» non esistono ancora: esegui su Supabase lo script "
        + "aggiornamento-2.sql (SQL Editor → New query → incolla → Run).");
    throw new Error(msg);
  }
  S.tag = t.data || [];
  S.priorita   = (v.data || []).filter(x => x.tipo === "priorita");
  S.ricorrenze = (v.data || []).filter(x => x.tipo === "ricorrenza");
  if(!S.ricorrenze.length) S.ricorrenze = [{ nome:"Nessuna", giorni:0, mesi:0, ordine:0 }];
  if(!S.priorita.length)   S.priorita   = [{ nome:"Media", colore:"#9a6414", ordine:0 }];
}
async function caricaMembri(){
  const { data, error } = await sb.from("membri").select("id,nome,colore");
  if(error) return;
  S.membri = {}; (data||[]).forEach(m => S.membri[m.id] = m);
  if(S.utente && S.membri[S.utente.id]) $("#btnAccount").textContent = iniziali(S.membri[S.utente.id].nome);
}
async function carica(){
  stato("aggiorno…");
  const { data, error } = await sb.from("attivita").select("*").order("scadenza", { ascending:true });
  if(error){ stato("non aggiornato", true); avviso("Dati non aggiornati: " + error.message); return; }
  S.righe = data || [];
  salvaCache();
  stato("");
  disegna();
}
function ascolta(){
  if(S.canale) return;
  const ricarica = () => { clearTimeout(ascolta._t); ascolta._t = setTimeout(async () => {
    await caricaElenchi().catch(()=>{}); await carica(); }, 400); };
  S.canale = sb.channel("tutto-live")
    .on("postgres_changes", { event:"*", schema:"public", table:"attivita" }, ricarica)
    .on("postgres_changes", { event:"*", schema:"public", table:"tag" }, ricarica)
    .on("postgres_changes", { event:"*", schema:"public", table:"valori" }, ricarica)
    .subscribe();
  document.addEventListener("visibilitychange", () => { if(!document.hidden) carica(); });
}

async function salvaAttivita(dati, id){
  const q = id ? sb.from("attivita").update(dati).eq("id", id)
               : sb.from("attivita").insert({ ...dati, autore:S.utente.id });
  const { error } = await q;
  if(error){ avviso("Non salvata: " + spiegaErrore(error), null, null, 9000); return false; }
  await carica(); return true;
}
async function eliminaAttivita(id){
  const { error } = await sb.from("attivita").delete().eq("id", id);
  if(error){ avviso("Non eliminata: " + error.message); return false; }
  await carica(); return true;
}
async function spunta(id){
  const r = S.righe.find(x => x.id === id); if(!r) return;
  const fatto = !r.fatto;
  r.fatto = fatto; r.in_data = fatto ? oggi() : null; disegna();
  const { error } = await sb.from("attivita").update({ fatto, in_data: fatto ? oggi() : null }).eq("id", id);
  if(error){ avviso("Non aggiornata: " + error.message); return carica(); }
  if(fatto){
    const nuova = prossima(r.scadenza, r.ricorrenza);
    if(nuova){
      const copia = {
        tag:r.tag, descrizione:r.descrizione, scadenza:nuova, fatto:false, in_data:null,
        priorita:r.priorita, ricorrenza:r.ricorrenza, importo:r.importo,
        privata:r.privata, autore:S.utente.id
      };
      ["note","luogo","ora_inizio","ora_fine"].forEach(k => { if(r[k] != null) copia[k] = r[k]; });
      const { error:e2 } = await sb.from("attivita").insert(copia);
      if(e2){ avviso("Prossima occorrenza non creata: " + spiegaErrore(e2), null, null, 9000); return carica(); }
      avviso("Fatta ✓ — prossima il " + fmt(nuova));
    }
  }
  carica();
}

/* =====================================================================
   FILTRI
   ===================================================================== */
function fascia(r){
  if(r.fatto) return { k:5, t:"Completate", cls:"" };
  if(!r.scadenza) return { k:4, t:"Senza scadenza", cls:"" };
  const d = giorni(oggi(), r.scadenza);
  if(d < 0)  return { k:0, t:"In ritardo", cls:"late" };
  if(d === 0) return { k:1, t:"Oggi", cls:"today" };
  if(d <= PREF.giorni) return { k:2, t:"Prossimi " + PREF.giorni + " giorni", cls:"" };
  return { k:3, t:"Più avanti", cls:"" };
}
function ordina(arr, chiave){
  return [...arr].sort((x,y) => {
    let v = 0;
    if(chiave === "scadenza"){ const a = x.scadenza||"9999-12-31", b = y.scadenza||"9999-12-31"; v = a<b?-1:a>b?1:0; }
    else if(chiave === "ora"){ const a = ora5(x.ora_inizio)||"99", b = ora5(y.ora_inizio)||"99"; v = a<b?-1:a>b?1:0;
      if(v === 0) v = pesoPrio(x.priorita) - pesoPrio(y.priorita); }
    else if(chiave === "priorita") v = pesoPrio(x.priorita) - pesoPrio(y.priorita);
    else if(chiave === "importo")  v = (+y.importo||0) - (+x.importo||0);
    else v = String(x[chiave]||"").localeCompare(String(y[chiave]||""), "it", { sensitivity:"base" });
    if(v === 0){ const a = x.scadenza||"9999-12-31", b = y.scadenza||"9999-12-31"; v = a<b?-1:a>b?1:0; }
    if(v === 0){ const a = ora5(x.ora_inizio)||"99", b = ora5(y.ora_inizio)||"99"; v = a<b?-1:a>b?1:0; }
    if(v === 0) v = String(x.descrizione||"").localeCompare(String(y.descrizione||""), "it");
    return v;
  });
}
function filtrate(){
  const f = S.filtri, q = f.q.trim().toLowerCase();
  const out = S.righe.filter(r => {
    if(f.stato === "todo" && r.fatto) return false;
    if(f.stato === "done" && !r.fatto) return false;
    if(f.chi === "mie" && r.autore !== S.utente.id) return false;
    if(f.chi === "private" && !r.privata) return false;
    if(f.chi === "condivise" && r.privata) return false;
    if(f.tag.size && !f.tag.has(r.tag || "")) return false;
    if(f.quando === "late"  && !(r.scadenza && giorni(oggi(), r.scadenza) < 0)) return false;
    if(f.quando === "today" && !(r.scadenza && giorni(oggi(), r.scadenza) === 0)) return false;
    if(f.quando === "w" && !(r.scadenza && giorni(oggi(), r.scadenza) >= 0
        && giorni(oggi(), r.scadenza) <= PREF.giorni)) return false;
    if(f.quando === "pay" && r.importo == null) return false;
    if(q && ![r.descrizione, r.tag, r.note, r.luogo].some(x => (x||"").toLowerCase().includes(q))) return false;
    return true;
  });
  return ordina(out, f.ord);
}

/* =====================================================================
   DISEGNO
   ===================================================================== */
function disegna(){ testata(); barraTag(); elenco(); calendario(); tagReport(); anteprima(); }

function testata(){
  const ora = new Date().getHours();
  const nome = S.membri[S.utente && S.utente.id] ? S.membri[S.utente.id].nome.split(" ")[0] : "";
  $("#saluto").textContent = (ora < 5 ? "Buonanotte" : ora < 13 ? "Buongiorno"
    : ora < 18 ? "Buon pomeriggio" : "Buonasera") + (nome ? ", " + nome : "");
  const t = oggi(), da = S.righe.filter(r => !r.fatto);
  const tardi = da.filter(r => r.scadenza && giorni(t,r.scadenza) < 0).length;
  const diOggi = da.filter(r => r.scadenza && giorni(t,r.scadenza) === 0).length;
  const parti = [];
  if(tardi)  parti.push(tardi + (tardi===1 ? " attività in ritardo" : " attività in ritardo"));
  if(diOggi) parti.push(diOggi + (diOggi===1 ? " scadenza oggi" : " scadenze oggi"));
  $("#sottotitolo").textContent = parti.length ? parti.join(" · ")
    : da.length ? da.length + (da.length===1 ? " attività da fare" : " attività da fare")
                : "Non c'è nulla in sospeso";

  const n = f => da.filter(f).length;
  $("#k1").textContent = tardi;
  $("#k2").textContent = diOggi;
  $("#k3").textContent = n(r => r.scadenza && giorni(t,r.scadenza) > 0 && giorni(t,r.scadenza) <= PREF.giorni);
  $("#k3l").textContent = PREF.giorni + " giorni";
  $("#k4").textContent = da.length;
  const tot = da.reduce((s,r) => s + (+r.importo||0), 0);
  $("#k5").textContent = tot ? eur(tot) : "—";
  $$(".kpi").forEach(k => {
    k.hidden = !PREF.kpi.includes(k.dataset.k);
    const atteso = { late:"late", today:"today", w:"w", todo:"", pay:"pay" }[k.dataset.k];
    k.classList.toggle("on", !!S.filtri.quando && S.filtri.quando === atteso);
  });
}
function barraTag(){
  const bar = $("#tagbar"), conta = {};
  S.righe.forEach(r => { if(S.filtri.stato === "todo" && r.fatto) return;
    const k = r.tag || ""; conta[k] = (conta[k]||0) + 1; });
  bar.innerHTML = "";
  const t0 = document.createElement("button");
  t0.className = "chip" + (S.filtri.tag.size ? "" : " on");
  if(!S.filtri.tag.size) t0.style.background = "var(--accent)";
  t0.textContent = "Tutti";
  t0.onclick = () => { S.filtri.tag.clear(); disegna(); };
  bar.appendChild(t0);
  nomiTag().forEach(t => {
    if(!conta[t] && !S.filtri.tag.has(t)) return;            // mostra solo i tag in uso
    const on = S.filtri.tag.has(t), c = colTag(t), b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "");
    b.style.background = on ? c.forte : c.tenue;
    b.style.color = on ? "#fff" : c.forte;
    b.style.borderColor = "transparent";
    b.innerHTML = esc(t) + `<span class="c">${conta[t]||0}</span>`;
    b.onclick = () => { on ? S.filtri.tag.delete(t) : S.filtri.tag.add(t); disegna(); };
    bar.appendChild(b);
  });
}
function rigaScadenza(r){
  if(!r.scadenza) return "";
  const d = giorni(oggi(), r.scadenza);
  let cls = "", txt = fmt(r.scadenza);
  if(!r.fatto){
    if(d < 0){ cls = "late"; txt += " · in ritardo di " + Math.abs(d) + (Math.abs(d)===1?" giorno":" giorni"); }
    else if(d === 0){ cls = "today"; txt += " · oggi"; }
    else if(d <= PREF.giorni){ txt += " · tra " + d + (d===1?" giorno":" giorni"); }
  }
  return `<span class="scad ${cls}">${txt}</span>`;
}
function schedaAttivita(r){
  const c = colTag(r.tag);
  const d = document.createElement("div");
  const tardi = !r.fatto && r.scadenza && giorni(oggi(), r.scadenza) < 0;
  d.className = "card" + (r.fatto ? " fatta" : "") + (tardi ? " ritardo" : "");
  d.style.setProperty("--c", c.forte);
  d.innerHTML = `
    <button class="spunta ${r.fatto?"on":""}" aria-label="Segna come fatta">
      ${r.fatto?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M20 6L9 17l-5-5"/></svg>':""}
    </button>
    <div class="corpocard">
      <div class="desc">${esc(r.descrizione)}</div>
      ${r.note?`<div class="notaCard">${esc(r.note)}</div>`:""}
      <div class="meta">
        ${r.tag?`<span class="tagb" style="background:${c.tenue};color:${c.forte}">${esc(r.tag)}</span>`:""}
        ${rigaScadenza(r)}
        ${orario(r)?`<span class="pill">🕘 ${esc(orario(r))}</span>`:""}
        ${r.luogo?`<a class="pill mappa" href="${linkMappa(r.luogo)}" target="_blank" rel="noopener" title="Apri in Google Maps">📍 ${esc(r.luogo)}</a>`:""}
        <span class="prio" style="color:${colPrio(r.priorita)}"><i></i>${esc(r.priorita||"")}</span>
        ${r.importo!=null?`<span class="soldi">${eur(r.importo)}</span>`:""}
        ${r.ricorrenza&&passoRic(r.ricorrenza)&&(passoRic(r.ricorrenza).giorni||passoRic(r.ricorrenza).mesi)
          ?`<span class="pill">↻ ${esc(r.ricorrenza)}</span>`:""}
        ${r.privata?`<span class="pill priv">🔒 privata</span>`:`<span class="pill">${esc(nomeDi(r.autore))}</span>`}
        ${r.fatto&&r.in_data?`<span class="pill">fatta il ${fmt(r.in_data)}</span>`:""}
      </div>
    </div>`;
  d.querySelector(".spunta").onclick = e => { e.stopPropagation(); spunta(r.id); };
  d.querySelector(".corpocard").onclick = e => { if(e.target.closest("a.mappa")) return; modale(r.id); };
  return d;
}
function elenco(){
  const righe = filtrate(), box = $("#lista");
  box.innerHTML = ""; $("#vuoto").hidden = righe.length > 0;
  const frag = document.createDocumentFragment();
  if(PREF.gruppi && S.filtri.ord === "scadenza"){
    const gruppi = {};
    righe.forEach(r => { const f = fascia(r); (gruppi[f.t] = gruppi[f.t] || { k:f.k, cls:f.cls, r:[] }).r.push(r); });
    Object.entries(gruppi).sort((a,b) => a[1].k - b[1].k).forEach(([nome, g]) => {
      const h = document.createElement("div");
      h.className = "gruppoTit " + g.cls;
      h.innerHTML = `<span>${esc(nome)}</span><span class="c">${g.r.length}</span>`;
      frag.appendChild(h);
      g.r.forEach(r => frag.appendChild(schedaAttivita(r)));
    });
  } else righe.forEach(r => frag.appendChild(schedaAttivita(r)));
  box.appendChild(frag);
}

/* ---------------------------- calendario ----------------------------- */
function calendario(){
  if(S.vista !== "calendario") return;
  const y = S.cal.getFullYear(), m = S.cal.getMonth();
  $("#calTitolo").textContent = MESI[m] + " " + y;
  const primo = new Date(y, m, 1), inizio = new Date(primo);
  inizio.setDate(1 - ((primo.getDay() + 6) % 7));
  const perGiorno = {};
  S.righe.forEach(r => { if(!r.scadenza || r.fatto) return;
    if(S.filtri.tag.size && !S.filtri.tag.has(r.tag || "")) return;
    (perGiorno[r.scadenza] = perGiorno[r.scadenza] || []).push(r); });

  let html = GG.map(g => `<div class="dow">${g}</div>`).join("");
  const t = oggi();
  for(let i=0;i<42;i++){
    const d = new Date(inizio); d.setDate(inizio.getDate()+i);
    const iso = dISO(d), ev = perGiorno[iso] || [];
    const cls = ["cell"];
    if(d.getMonth() !== m) cls.push("out");
    if(iso === t) cls.push("oggi");
    if(iso === S.calSel) cls.push("scelto");
    const punti = ev.slice(0,4).map(r =>
      `<span class="punto" style="background:${colTag(r.tag).forte}"></span>`).join("");
    html += `<button class="${cls.join(" ")}" data-d="${iso}"><span class="dn">${d.getDate()}</span>
             <span class="punti">${punti}</span></button>`;
  }
  $("#calGrid").innerHTML = html;
  $$("#calGrid .cell").forEach(c => c.onclick = () => { S.calSel = c.dataset.d; calendario(); });
  pannelloGiorno(perGiorno);
}
function pannelloGiorno(perGiorno){
  const p = $("#giorno");
  if(!S.calSel){ p.innerHTML = `<p class="note">Tocca un giorno per vedere le scadenze.</p>`; return; }
  const d = daISO(S.calSel), ev = perGiorno[S.calSel] || [];
  p.innerHTML = `<h3>${GG[(d.getDay()+6)%7]} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()} —
      ${ev.length} ${ev.length===1?"attività":"attività"}</h3>
    <div class="lista" id="listaGiorno"></div>
    <button class="btn wide" id="aggiungiQui" style="margin-top:12px">+ Attività il ${fmt(S.calSel)}</button>`;
  const box = $("#listaGiorno");
  if(!ev.length) box.innerHTML = `<p class="note">Nessuna scadenza in questa data.</p>`;
  else ordina(ev, "ora").forEach(r => box.appendChild(schedaAttivita(r)));
  $("#aggiungiQui").onclick = () => { modale(null); $("#fScad").value = S.calSel; };
}

/* =====================================================================
   MODALE ATTIVITÀ
   ===================================================================== */
function riempiSelect(sel, valori, scelto, vuota){
  sel.innerHTML = (vuota ? `<option value="">${esc(vuota)}</option>` : "") + valori.map(v => `<option value="${esc(v)}"${v===scelto?" selected":""}>${esc(v)}</option>`).join("");
  if(scelto && !valori.includes(scelto))                       // valore non più in elenco: lo conserva
    sel.insertAdjacentHTML("afterbegin", `<option value="${esc(scelto)}" selected>${esc(scelto)} (non in elenco)</option>`);
}
function modale(id){
  S.modifica = id || null;
  const r = id ? S.righe.find(x => x.id === id) : null;
  // Nuova attività: tag vuoto, da scegliere (salvo un tag predefinito scelto in Impostazioni).
  const tagIniziale = r ? r.tag : (PREF.tag && trovaTag(PREF.tag) ? PREF.tag : "");
  $("#mTitolo").textContent = r ? "Modifica attività" : "Nuova attività";
  $("#fDesc").value   = r ? r.descrizione : "";
  riempiSelect($("#fTag"),  nomiTag(), tagIniziale, "— scegli un tag —");
  $("#fTag").classList.remove("errore");
  riempiSelect($("#fPrio"), S.priorita.map(p => p.nome), r ? r.priorita : (PREF.prio || S.priorita[0].nome));
  riempiSelect($("#fRic"),  S.ricorrenze.map(x => x.nome), r ? r.ricorrenza : (PREF.ric || S.ricorrenze[0].nome));
  $("#fScad").value   = r && r.scadenza ? r.scadenza : "";
  $("#fImp").value    = r && r.importo != null ? r.importo : "";
  $("#fOraIni").value = r ? ora5(r.ora_inizio) : "";
  $("#fOraFin").value = r ? ora5(r.ora_fine) : "";
  $("#fLuogo").value  = r && r.luogo ? r.luogo : "";
  aggiornaLinkMappa();
  $("#fNote").value   = r && r.note ? r.note : "";
  $("#fPriv").checked = r ? !!r.privata : false;
  $("#fFatto").value  = r && r.fatto ? "si" : "no";
  $("#fInData").value = r && r.in_data ? r.in_data : "";
  const mio = !r || r.autore === S.utente.id;
  $("#btnElimina").hidden = !r;
  $("#mAutore").textContent = r ? "Inserita da " + nomeDi(r.autore) : "";
  $("#fPriv").disabled = r && !mio;
  apri("mAtt");
  if(!r) setTimeout(() => $("#fDesc").focus(), 80);
}
function aggiornaLinkMappa(){
  const v = $("#fLuogo").value.trim(), a = $("#fMappa");
  a.hidden = !v; if(v) a.href = linkMappa(v);
}
async function salvaDaModale(){
  const desc = $("#fDesc").value.trim();
  if(!desc){ $("#fDesc").focus(); avviso("La descrizione è obbligatoria"); return; }
  if(!$("#fTag").value){ $("#fTag").classList.add("errore"); $("#fTag").focus(); avviso("Scegli un tag"); return; }
  const oi = $("#fOraIni").value, of = $("#fOraFin").value;
  if(oi && of && of < oi){ $("#fOraFin").focus(); avviso("L'ora di fine è prima di quella di inizio"); return; }
  const fatto = $("#fFatto").value === "si";
  const dati = {
    tag: $("#fTag").value,
    descrizione: desc,
    scadenza: $("#fScad").value || null,
    priorita: $("#fPrio").value,
    ricorrenza: $("#fRic").value,
    importo: $("#fImp").value === "" ? null : parseFloat($("#fImp").value),
    ora_inizio: oi || null,
    ora_fine: of || null,
    luogo: $("#fLuogo").value.trim() || null,
    note: $("#fNote").value.trim() || null,
    privata: $("#fPriv").checked,
    fatto,
    in_data: fatto ? ($("#fInData").value || oggi()) : null
  };
  // I campi nuovi si inviano solo se servono: così l'app continua a funzionare anche
  // prima che su Supabase sia stato eseguito aggiornamento-3.sql.
  const prima = S.modifica ? S.righe.find(x => x.id === S.modifica) : null;
  ["note","luogo","ora_inizio","ora_fine"].forEach(k => {
    if(dati[k] == null && !(prima && prima[k] != null)) delete dati[k];
  });
  const b = $("#btnSalvaAtt"); b.disabled = true;
  const ok = await salvaAttivita(dati, S.modifica);
  b.disabled = false;
  if(ok){ chiudi("mAtt"); avviso(S.modifica ? "Attività aggiornata" : "Attività aggiunta"); }
}

/* =====================================================================
   REPORT
   ===================================================================== */
function tagReport(){
  const box = $("#rTags"); if(!box) return;
  box.innerHTML = "";
  const usati = [...new Set(S.righe.map(r => r.tag || "").filter(Boolean))];
  const elenco = nomiTag().filter(t => usati.includes(t));
  elenco.forEach(t => {
    const on = !S.reportEsclusi.has(t), c = colTag(t), b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "");
    b.style.background = on ? c.forte : "transparent";
    b.style.color = on ? "#fff" : "var(--ink-soft)";
    b.style.borderColor = on ? "transparent" : "var(--line-strong)";
    b.textContent = t;
    b.onclick = () => { on ? S.reportEsclusi.add(t) : S.reportEsclusi.delete(t); tagReport(); anteprima(); };
    box.appendChild(b);
  });
  const dentro = elenco.filter(t => !S.reportEsclusi.has(t)).length;
  $("#rConteggioTag").textContent = elenco.length ? `(${dentro} di ${elenco.length})` : "";
}
function righeReport(){
  const st = $("#rStato").value, quando = $("#rQuando").value, conPriv = $("#rPriv").checked;
  const out = S.righe.filter(r => {
    if(st === "todo" && r.fatto) return false;
    if(st === "done" && !r.fatto) return false;
    if(r.privata && !conPriv && r.autore !== S.utente.id) return false;
    if(r.privata && !conPriv) return false;
    if(r.tag && S.reportEsclusi.has(r.tag)) return false;
    if(quando === "none") return !r.scadenza;
    if(quando === "late") return !!r.scadenza && giorni(oggi(), r.scadenza) < 0;
    if(quando){ if(!r.scadenza) return false; return giorni(oggi(), r.scadenza) <= +quando; }
    return true;
  });
  return ordina(out, $("#rOrd").value);
}
function documento(){
  const righe = righeReport();
  const o = { box:$("#rBox").checked, data:$("#rData").checked, prio:$("#rPrio").checked,
              imp:$("#rImp").checked, ric:$("#rRic").checked, chi:$("#rChi").checked, gruppo:$("#rGruppo").value,
              ora:$("#rOra").checked, note:$("#rNote").checked };
  const ora = new Date();
  const stampa = pad(ora.getDate())+"/"+pad(ora.getMonth()+1)+"/"+ora.getFullYear();
  const usati = [...new Set(S.righe.map(r => r.tag || "").filter(Boolean))];
  const sel = usati.filter(t => !S.reportEsclusi.has(t));
  const etTag = sel.length >= usati.length ? "tutte le aree" : (sel.join(" · ") || "nessuna area selezionata");
  const etStato = { todo:"solo attività da fare", all:"tutte le attività", done:"solo attività completate" }[$("#rStato").value];

  let gruppi;
  if(o.gruppo === "tag"){
    const m = {}; righe.forEach(r => { const k = r.tag || "(senza tag)"; (m[k] = m[k] || []).push(r); });
    gruppi = Object.keys(m).sort((a,b)=>a.localeCompare(b,"it")).map(k => [k, m[k]]);
  } else if(o.gruppo === "quando"){
    const m = {}; righe.forEach(r => { const f = fascia(r); (m[f.t] = m[f.t] || { k:f.k, r:[] }).r.push(r); });
    gruppi = Object.entries(m).sort((a,b) => a[1].k - b[1].k).map(([k,v]) => [k, v.r]);
  } else gruppi = [["", righe]];

  const tot = righe.reduce((s,r) => s + (+r.importo||0), 0);
  const corpo = !righe.length
    ? `<div class="none">Nessuna attività corrisponde ai criteri selezionati.</div>`
    : gruppi.map(([nome, rs]) => {
        const st = rs.reduce((s,r) => s + (+r.importo||0), 0);
        return `<div class="grp">${nome?`<div class="gt">${esc(nome)}<span style="float:right;font-weight:normal">${rs.length}</span></div>`:""}
          <table>${rs.map(r => {
            const tardi = !r.fatto && r.scadenza && giorni(oggi(), r.scadenza) < 0;
            return `<tr class="${r.fatto?"done":""}">
              ${o.box?`<td class="bx"><span class="${r.fatto?"f":""}"></span></td>`:""}
              ${o.prio?`<td class="pr">${pesoPrio(r.priorita)===0?"!":pesoPrio(r.priorita)===1?"·":""}</td>`:""}
              <td>${esc(r.descrizione)}${o.gruppo!=="tag"&&r.tag?` <span class="rg">[${esc(r.tag)}]</span>`:""}${r.privata?` <span class="rg">(privata)</span>`:""}${
                o.ora && (orario(r) || r.luogo) ? `<div class="sub">${[orario(r) ? esc(orario(r)) : "",
                  r.luogo ? `<a href="${linkMappa(r.luogo)}">${esc(r.luogo)}</a>` : ""].filter(Boolean).join(" · ")}</div>` : ""}${
                o.note && r.note ? `<div class="sub nt">${esc(r.note)}</div>` : ""}</td>
              ${o.chi?`<td class="rg">${esc(nomeDi(r.autore))}</td>`:""}
              ${o.ric?`<td class="rg">${passoRic(r.ricorrenza)&&(passoRic(r.ricorrenza).giorni||passoRic(r.ricorrenza).mesi)?"↻ "+esc(r.ricorrenza):""}</td>`:""}
              ${o.data?`<td class="dt ${tardi?"late":""}">${r.scadenza?fmt(r.scadenza):"—"}</td>`:""}
              ${o.imp?`<td class="am">${r.importo!=null?eur(r.importo):""}</td>`:""}
            </tr>`; }).join("")}</table>
          ${o.imp && st ? `<div class="tot">Totale ${esc(nome)||"elenco"}: <b>${eur(st)}</b></div>` : ""}</div>`;
      }).join("");

  return `<div id="doc">
    <div class="rh">
      <div><h1>${esc($("#rTitolo").value || "Elenco attività")}</h1>
        <div style="font-size:9pt;color:#555;margin-top:3px">${esc(etTag)} — ${etStato}</div></div>
      <div class="testata"><div>Stampato il ${stampa}</div><div>${righe.length} attività</div>${o.imp && tot ? `<div>Totale da pagare: <b>${eur(tot)}</b></div>` : ""}</div>
    </div>${corpo}
    <div class="foot"><span>${APP} · Attività e scadenze di famiglia</span><span>${esc(nomeDi(S.utente && S.utente.id))}</span></div></div>`;
}
/* L'anteprima e il documento da stampare vengono tenuti sempre allineati:
   così anche la stampa avviata dal menù del browser produce il report. */
function anteprima(){
  if(S.vista !== "report") return;
  const d = documento();
  $("#anteprima").innerHTML = d;
  $("#stampa").innerHTML = d;
  const n = righeReport().length;
  $("#rConteggio").textContent = n ? (n === 1 ? "1 attività nel report" : n + " attività nel report")
                                   : "Nessuna attività con questi criteri";
}
/* Stampa: invece di affidarsi solo alle regole @media print (che alcuni browser, soprattutto
   sui telefoni e nelle app installate, applicano male producendo pagine bianche), l'app passa
   in «modalità documento»: a schermo resta SOLO il report. Qualunque strada si usi per
   stampare — il pulsante, il menù del browser, Condividi → Stampa — esce il report. */
const TITOLO_APP = document.title;
function stampaReport(){
  $("#stampa").innerHTML = documento();
  document.title = ($("#rTitolo").value || "Elenco attività");
  document.body.classList.add("modoStampa");
  window.scrollTo(0, 0);
  // sui computer, chiusa la finestra di stampa si torna da soli all'app
  if(matchMedia("(pointer: fine)").matches){
    const fine = () => { window.removeEventListener("afterprint", fine); setTimeout(esciStampa, 300); };
    window.addEventListener("afterprint", fine);
  }
  setTimeout(() => { try{ window.print(); }catch(e){} }, 350);   // tempo per comporre la pagina
}
function esciStampa(){
  document.body.classList.remove("modoStampa");
  document.title = TITOLO_APP;
}

/* =====================================================================
   IMPOSTAZIONI: tag, priorità, ricorrenze
   ===================================================================== */
const usiTag  = n => S.righe.filter(r => (r.tag||"") === n).length;
const usiPrio = n => S.righe.filter(r => (r.priorita||"") === n).length;
const usiRic  = n => S.righe.filter(r => (r.ricorrenza||"") === n).length;

function disegnaImpostazioni(){
  if(S.vista !== "impostazioni") return;
  /* ---- tag ---- */
  const bt = $("#listaTag"); bt.innerHTML = "";
  S.tag.forEach((t,i) => {
    const r = document.createElement("div");
    r.className = "rigaConf";
    r.innerHTML = `
      <div class="frecce"><button data-su title="Sposta su">▲</button><button data-giu title="Sposta giù">▼</button></div>
      <input type="color" value="${t.colore}" title="Colore">
      <input type="text" value="${esc(t.nome)}" maxlength="30">
      <span class="usi">${usiTag(t.nome)} attività</span>
      <button class="iconbtn" title="Elimina"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;
    const [su, giu] = r.querySelectorAll(".frecce button");
    su.disabled = i === 0; giu.disabled = i === S.tag.length - 1;
    su.onclick  = () => spostaTag(i, -1);
    giu.onclick = () => spostaTag(i, +1);
    r.querySelector('input[type=color]').onchange = e => aggiornaTag(t, { colore:e.target.value });
    const testo = r.querySelector('input[type=text]');
    testo.onblur = () => { const nuovo = testo.value.trim().toUpperCase();
      if(nuovo && nuovo !== t.nome) rinominaTag(t, nuovo); else testo.value = t.nome; };
    testo.onkeydown = e => { if(e.key === "Enter") testo.blur(); };
    r.querySelector(".iconbtn").onclick = () => eliminaTag(t);
    bt.appendChild(r);
  });

  /* ---- priorità ---- */
  const bp = $("#listaPrio"); bp.innerHTML = "";
  S.priorita.forEach((p,i) => {
    const r = document.createElement("div");
    r.className = "rigaConf";
    r.innerHTML = `
      <div class="frecce"><button data-su>▲</button><button data-giu>▼</button></div>
      <input type="color" value="${p.colore || '#5b6472'}" title="Colore">
      <input type="text" value="${esc(p.nome)}" maxlength="20">
      <span class="usi">${usiPrio(p.nome)} attività</span>
      <button class="iconbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;
    const [su, giu] = r.querySelectorAll(".frecce button");
    su.disabled = i === 0; giu.disabled = i === S.priorita.length - 1;
    su.onclick  = () => spostaValore(S.priorita, i, -1);
    giu.onclick = () => spostaValore(S.priorita, i, +1);
    r.querySelector('input[type=color]').onchange = e => aggiornaValore(p, { colore:e.target.value });
    const testo = r.querySelector('input[type=text]');
    testo.onblur = () => { const nuovo = testo.value.trim();
      if(nuovo && nuovo !== p.nome) rinominaValore(p, nuovo, "priorita"); else testo.value = p.nome; };
    testo.onkeydown = e => { if(e.key === "Enter") testo.blur(); };
    r.querySelector(".iconbtn").onclick = () => eliminaValore(p, "priorita");
    bp.appendChild(r);
  });

  /* ---- ricorrenze ---- */
  const br = $("#listaRic"); br.innerHTML = "";
  S.ricorrenze.forEach((v,i) => {
    const fisso = !v.giorni && !v.mesi;                 // la voce «nessuna ricorrenza»
    const r = document.createElement("div");
    r.className = "rigaConf ric";
    r.innerHTML = `
      <div class="frecce"><button data-su>▲</button><button data-giu>▼</button></div>
      <input type="text" value="${esc(v.nome)}" maxlength="24">
      <button class="iconbtn"${fisso?" disabled style=\"opacity:.3\"":""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
      <span class="passo"><span class="usi">${fisso ? "non si ripete" : "ogni"}</span>
        <input type="number" min="0" max="999" value="${v.giorni}" title="giorni"><span class="usi">gg</span>
        <input type="number" min="0" max="120" value="${v.mesi}" title="mesi"><span class="usi">mesi</span></span>`;
    const [su, giu] = r.querySelectorAll(".frecce button");
    su.disabled = i === 0; giu.disabled = i === S.ricorrenze.length - 1;
    su.onclick  = () => spostaValore(S.ricorrenze, i, -1);
    giu.onclick = () => spostaValore(S.ricorrenze, i, +1);
    const [ng, nm] = r.querySelectorAll('input[type=number]');
    if(fisso){ ng.disabled = nm.disabled = true; ng.style.opacity = nm.style.opacity = ".45"; }
    ng.onchange = () => aggiornaValore(v, { giorni:+ng.value || 0 });
    nm.onchange = () => aggiornaValore(v, { mesi:+nm.value || 0 });
    const testo = r.querySelector('input[type=text]');
    testo.onblur = () => { const nuovo = testo.value.trim();
      if(nuovo && nuovo !== v.nome) rinominaValore(v, nuovo, "ricorrenza"); else testo.value = v.nome; };
    testo.onkeydown = e => { if(e.key === "Enter") testo.blur(); };
    if(!fisso) r.querySelector(".iconbtn").onclick = () => eliminaValore(v, "ricorrenza");
    br.appendChild(r);
  });

  /* ---- preferenze ---- */
  riempiSelect($("#defTag"),  ["(nessuno)", ...nomiTag()], PREF.tag || "(nessuno)");
  riempiSelect($("#defPrio"), S.priorita.map(p => p.nome), PREF.prio || S.priorita[0].nome);
  riempiSelect($("#defRic"),  S.ricorrenze.map(v => v.nome), PREF.ric || S.ricorrenze[0].nome);
  $("#defGiorni").value = PREF.giorni;
  $("#defTema").value = PREF.tema;
  $("#defGruppi").checked = PREF.gruppi;
  $$(".kpiOn").forEach(c => c.checked = PREF.kpi.includes(c.value));

  /* ---- account ---- */
  const m = S.membri[S.utente.id];
  $("#accInfo").textContent = "Collegato come " + S.utente.email;
  $("#accNome").value = m ? m.nome : "";
  $("#elencoMembri").innerHTML = Object.values(S.membri).map(x => {
    const c = colTag(x.nome);
    return `<span class="membro"><span class="pal" style="background:${c.forte}">${esc(iniziali(x.nome))}</span>${esc(x.nome)}</span>`;
  }).join("") || `<span class="note">Nessun altro membro registrato.</span>`;
  $("#accVersione").textContent = "Versione dell'app: " + VERSIONE
    + (navigator.serviceWorker && navigator.serviceWorker.controller ? " · copia locale attiva" : "");
  aggiornaStatoPush();
}

async function nuovoTag(){
  const nome = $("#nuovoTag").value.trim().toUpperCase();
  if(!nome) return;
  if(trovaTag(nome)){ avviso("Questo tag esiste già"); return; }
  const ordine = S.tag.length ? Math.max(...S.tag.map(t => t.ordine)) + 10 : 0;
  const { error } = await sb.from("tag").insert({ nome, colore:$("#nuovoTagColore").value, ordine });
  if(error){ avviso("Non aggiunto: " + error.message); return; }
  $("#nuovoTag").value = "";
  await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna();
  avviso("Tag aggiunto");
}
async function aggiornaTag(t, campi){
  const { error } = await sb.from("tag").update(campi).eq("id", t.id);
  if(error){ avviso("Non salvato: " + error.message); return; }
  Object.assign(t, campi); salvaCache(); disegna(); disegnaImpostazioni();
}
async function rinominaTag(t, nuovo){
  if(trovaTag(nuovo)){ avviso("Esiste già un tag con questo nome"); disegnaImpostazioni(); return; }
  const vecchio = t.nome;
  const a = await sb.from("attivita").update({ tag:nuovo }).eq("tag", vecchio);
  if(a.error){ avviso("Non rinominato: " + a.error.message); disegnaImpostazioni(); return; }
  const b = await sb.from("tag").update({ nome:nuovo }).eq("id", t.id);
  if(b.error){ avviso("Non rinominato: " + b.error.message); }
  if(PREF.tag === vecchio){ PREF.tag = nuovo; salvaPref(); }
  await caricaElenchi(); await carica(); disegnaImpostazioni();
  avviso("Tag rinominato in " + nuovo);
}
function eliminaTag(t){
  const n = usiTag(t.nome);
  if(!n){
    conferma("Eliminare il tag?", `«${t.nome}» non è usato da nessuna attività.`, async () => {
      const { error } = await sb.from("tag").delete().eq("id", t.id);
      if(error){ avviso("Non eliminato: " + error.message); return; }
      await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna(); avviso("Tag eliminato");
    });
    return;
  }
  const altri = nomiTag().filter(x => x !== t.nome);
  if(!altri.length){ avviso("È l'unico tag: creane un altro prima di eliminarlo"); return; }
  conferma("Eliminare il tag?",
    `«${t.nome}» è usato da ${n} ${n===1?"attività":"attività"}. Scegli dove spostarle:`,
    async () => {
      const dest = $("#destTag").value;
      const a = await sb.from("attivita").update({ tag:dest }).eq("tag", t.nome);
      if(a.error){ avviso("Non spostate: " + a.error.message); return; }
      const b = await sb.from("tag").delete().eq("id", t.id);
      if(b.error){ avviso("Tag non eliminato: " + b.error.message); }
      await caricaElenchi(); await carica(); disegnaImpostazioni();
      avviso(`${n} attività spostate su ${dest}`);
    },
    `<label class="campo" style="margin-top:12px"><span>Sposta le attività su</span>
       <select id="destTag">${altri.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>`,
    "Sposta ed elimina");
}
async function spostaTag(i, verso){
  const j = i + verso; if(j < 0 || j >= S.tag.length) return;
  const a = S.tag[i], b = S.tag[j];
  const oa = a.ordine, ob = b.ordine;
  await Promise.all([
    sb.from("tag").update({ ordine: ob }).eq("id", a.id),
    sb.from("tag").update({ ordine: oa }).eq("id", b.id)
  ]);
  await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna();
}

async function nuovoValore(tipo){
  const nome = (tipo === "priorita" ? $("#nuovaPrio") : $("#nuovaRic")).value.trim();
  if(!nome) return;
  const elenco = tipo === "priorita" ? S.priorita : S.ricorrenze;
  if(elenco.some(v => v.nome.toLowerCase() === nome.toLowerCase())){ avviso("Esiste già"); return; }
  const riga = { tipo, nome, ordine: elenco.length ? Math.max(...elenco.map(v => v.ordine)) + 10 : 0 };
  if(tipo === "priorita") riga.colore = $("#nuovaPrioColore").value;
  else { riga.giorni = +$("#nuovaRicGiorni").value || 0; riga.mesi = +$("#nuovaRicMesi").value || 0;
    if(!riga.giorni && !riga.mesi){ avviso("Indica ogni quanti giorni o mesi si ripete"); return; } }
  const { error } = await sb.from("valori").insert(riga);
  if(error){ avviso("Non aggiunto: " + error.message); return; }
  if(tipo === "priorita") $("#nuovaPrio").value = "";
  else { $("#nuovaRic").value = ""; $("#nuovaRicGiorni").value = 0; $("#nuovaRicMesi").value = 0; }
  await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna();
  avviso("Voce aggiunta");
}
async function aggiornaValore(v, campi){
  const { error } = await sb.from("valori").update(campi).eq("id", v.id);
  if(error){ avviso("Non salvato: " + error.message); return; }
  Object.assign(v, campi); salvaCache(); disegna();
}
async function rinominaValore(v, nuovo, tipo){
  const elenco = tipo === "priorita" ? S.priorita : S.ricorrenze;
  if(elenco.some(x => x.nome.toLowerCase() === nuovo.toLowerCase())){ avviso("Esiste già"); disegnaImpostazioni(); return; }
  const campo = tipo === "priorita" ? "priorita" : "ricorrenza";
  const vecchio = v.nome;
  const a = await sb.from("attivita").update({ [campo]:nuovo }).eq(campo, vecchio);
  if(a.error){ avviso("Non rinominata: " + a.error.message); disegnaImpostazioni(); return; }
  const b = await sb.from("valori").update({ nome:nuovo }).eq("id", v.id);
  if(b.error) avviso("Non rinominata: " + b.error.message);
  if(tipo === "priorita" && PREF.prio === vecchio){ PREF.prio = nuovo; salvaPref(); }
  if(tipo === "ricorrenza" && PREF.ric === vecchio){ PREF.ric = nuovo; salvaPref(); }
  await caricaElenchi(); await carica(); disegnaImpostazioni();
  avviso("Rinominata in " + nuovo);
}
function eliminaValore(v, tipo){
  const elenco = tipo === "priorita" ? S.priorita : S.ricorrenze;
  const campo  = tipo === "priorita" ? "priorita" : "ricorrenza";
  const n = tipo === "priorita" ? usiPrio(v.nome) : usiRic(v.nome);
  const altri = elenco.filter(x => x.id !== v.id).map(x => x.nome);
  if(!altri.length){ avviso("Deve restarne almeno una"); return; }
  if(!n){
    conferma("Eliminare la voce?", `«${v.nome}» non è usata da nessuna attività.`, async () => {
      const { error } = await sb.from("valori").delete().eq("id", v.id);
      if(error){ avviso("Non eliminata: " + error.message); return; }
      await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna(); avviso("Voce eliminata");
    });
    return;
  }
  conferma("Eliminare la voce?",
    `«${v.nome}» è usata da ${n} ${n===1?"attività":"attività"}. Scegli con che cosa sostituirla:`,
    async () => {
      const dest = $("#destValore").value;
      const a = await sb.from("attivita").update({ [campo]:dest }).eq(campo, v.nome);
      if(a.error){ avviso("Non sostituita: " + a.error.message); return; }
      const b = await sb.from("valori").delete().eq("id", v.id);
      if(b.error) avviso("Voce non eliminata: " + b.error.message);
      await caricaElenchi(); await carica(); disegnaImpostazioni();
      avviso("Voce eliminata");
    },
    `<label class="campo" style="margin-top:12px"><span>Sostituisci con</span>
       <select id="destValore">${altri.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>`,
    "Sostituisci ed elimina");
}
async function spostaValore(elenco, i, verso){
  const j = i + verso; if(j < 0 || j >= elenco.length) return;
  const a = elenco[i], b = elenco[j], oa = a.ordine, ob = b.ordine;
  await Promise.all([
    sb.from("valori").update({ ordine: ob }).eq("id", a.id),
    sb.from("valori").update({ ordine: oa }).eq("id", b.id)
  ]);
  await caricaElenchi(); salvaCache(); disegnaImpostazioni(); disegna();
}

/* ------------------------------- tema -------------------------------- */
function applicaTema(){
  const t = PREF.tema === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : PREF.tema;
  document.documentElement.dataset.tema = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = t === "dark" ? "#0f1319" : "#1f4f8f";
}

/* =====================================================================
   NOTIFICHE PUSH
   ===================================================================== */
function b64ToU8(base64){
  const p = "=".repeat((4 - base64.length % 4) % 4);
  const s = (base64 + p).replace(/-/g,"+").replace(/_/g,"/");
  const raw = atob(s), out = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}
const pushDisponibile = () => "serviceWorker" in navigator && "PushManager" in window
  && window.CONFIG && (CONFIG.VAPID_PUBLIC||"").length > 20;

async function aggiornaStatoPush(){
  const sw = $("#accPush"), nota = $("#accPushNota");
  if(!sw) return;
  if(!pushDisponibile()){
    sw.checked = false; sw.disabled = true;
    nota.textContent = !window.isSecureContext
      ? "Disponibili solo sul sito pubblicato (https)."
      : "Non configurate: manca la chiave VAPID in config.js.";
    return;
  }
  const reg = await navigator.serviceWorker.ready.catch(()=>null);
  const sott = reg && await reg.pushManager.getSubscription();
  sw.checked = !!sott; sw.disabled = false;
  nota.textContent = sott ? "Attive su questo dispositivo."
    : "Avviso ogni mattina per le scadenze del giorno e quelle in ritardo.";
}
async function cambiaPush(e){
  const vuole = e.target.checked;
  try{
    const reg = await navigator.serviceWorker.ready;
    if(vuole){
      const permesso = await Notification.requestPermission();
      if(permesso !== "granted"){ e.target.checked = false; avviso("Permesso negato dal telefono"); return; }
      const sott = await reg.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:b64ToU8(CONFIG.VAPID_PUBLIC)
      });
      const j = sott.toJSON();
      const { error } = await sb.from("push_iscrizioni").upsert({
        utente:S.utente.id, endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth,
        etichetta: navigator.userAgent.slice(0,60)
      }, { onConflict:"endpoint" });
      if(error) throw error;
      avviso("Promemoria attivati su questo dispositivo");
    } else {
      const sott = await reg.pushManager.getSubscription();
      if(sott){ await sb.from("push_iscrizioni").delete().eq("endpoint", sott.endpoint); await sott.unsubscribe(); }
      avviso("Promemoria disattivati");
    }
  }catch(err){ e.target.checked = !vuole; avviso("Notifiche non attivate: " + err.message); }
  aggiornaStatoPush();
}

/* =====================================================================
   EXCEL
   ===================================================================== */
function caricaSheetJS(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((ok,ko) => {
    const s = document.createElement("script");
    s.src = "xlsx.full.min.js";
    s.onload = ok; s.onerror = () => ko(new Error("libreria xlsx.full.min.js non trovata"));
    document.head.appendChild(s);
  });
}
function giorniDaCivile(y,m,d){
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y>=0?y:y-399)/400), yoe = y - era*400;
  const doy = Math.floor((153*(m + (m>2?-3:9)) + 2)/5) + d - 1;
  return era*146097 + (yoe*365 + Math.floor(yoe/4) - Math.floor(yoe/100) + doy) - 719468;
}
function civileDaGiorni(z){
  z += 719468;
  const era = Math.floor((z>=0?z:z-146096)/146097), doe = z - era*146097;
  const yoe = Math.floor((doe - Math.floor(doe/1460) + Math.floor(doe/36524) - Math.floor(doe/146096))/365);
  const y = yoe + era*400, doy = doe - (365*yoe + Math.floor(yoe/4) - Math.floor(yoe/100));
  const mp = Math.floor((5*doy + 2)/153), d = doy - Math.floor((153*mp + 2)/5) + 1, m = mp + (mp<10?3:-9);
  return [y + (m<=2?1:0), m, d];
}
const EP1900 = giorniDaCivile(1899,12,30), EP1899 = giorniDaCivile(1899,12,31);
function serialeAISO(n){
  const s = Math.floor(n + 1e-9);
  if(s < 1) return null;
  const [y,m,d] = civileDaGiorni((s >= 61 ? EP1900 : EP1899) + s);
  return (y < 1900 || y > 2200) ? null : y+"-"+pad(m)+"-"+pad(d);
}
function isoDaSeriale(iso){
  const [y,m,d] = iso.split("-").map(Number), abs = giorniDaCivile(y,m,d);
  const s = abs - EP1900; return s >= 61 ? s : abs - EP1899;
}
function leggiData(v){
  if(v == null || v === "") return null;
  if(typeof v === "number") return serialeAISO(v);
  if(v instanceof Date && !isNaN(v)) return dISO(v);
  const s = String(v).trim(); if(!s) return null;
  if(/^\d+(\.\d+)?$/.test(s)) return serialeAISO(parseFloat(s));
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return m[1]+"-"+pad(+m[2])+"-"+pad(+m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){ let g = +m[1], me = +m[2], y = +m[3];
    if(me > 12 && g <= 12){ const t = g; g = me; me = t; }
    if(y < 100) y += 2000;
    if(me < 1 || me > 12 || g < 1 || g > 31) return null;
    return y+"-"+pad(me)+"-"+pad(g); }
  return null;
}
const norm = s => String(s==null?"":s).trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[\s_.\-]+/g," ").trim();
const MAPPA = { "tag":"tag","area":"tag","categoria":"tag","descrizione":"descrizione","attivita":"descrizione",
  "scadenza":"scadenza","data scadenza":"scadenza","fatto":"fatto","fatta":"fatto","svolto":"fatto",
  "in data":"in_data","fatto in data":"in_data","data":"in_data","priorita":"priorita",
  "ricorrenza":"ricorrenza","frequenza":"ricorrenza","importo":"importo","costo":"importo","privata":"privata",
  "note":"note","nota":"note","luogo":"luogo","dove":"luogo","indirizzo":"luogo",
  "ora inizio":"ora_inizio","inizio":"ora_inizio","dalle":"ora_inizio","ora":"ora_inizio",
  "ora fine":"ora_fine","fine":"ora_fine","alle":"ora_fine" };
/* Ora da Excel: frazione di giorno (0,5 = 12:00), data+ora, oppure testo «9:30», «9.30», «930». */
function leggiOra(v){
  if(v == null || v === "") return null;
  if(typeof v === "number"){ const min = Math.round((v - Math.floor(v)) * 1440) % 1440;
    return pad(Math.floor(min/60)) + ":" + pad(min%60); }
  const m = String(v).trim().match(/^(\d{1,2})(?:[:.,h](\d{2}))?$/) || String(v).trim().match(/^(\d{1,2})(\d{2})$/);
  if(!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  return h < 24 && mi < 60 ? pad(h) + ":" + pad(mi) : null;
}
const vero = v => ["si","sì","s","x","true","vero","1","yes","ok","fatto","fatta"]
  .includes(String(v==null?"":v).trim().toLowerCase());

async function importaExcel(file){
  try{
    await caricaSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {});
    const nome = wb.SheetNames.find(n => norm(n) === "attivita") || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header:1, raw:true, defval:"" });
    if(aoa.length < 2){ avviso("Il file non contiene righe"); return; }
    const testa = aoa[0].map(h => MAPPA[norm(h)] || null);
    const predefinitaPrio = (PREF.prio || S.priorita[0].nome);
    const predefinitaRic  = S.ricorrenze[0].nome;
    const nuove = [], tagNuovi = new Set();
    for(let i=1;i<aoa.length;i++){
      const l = aoa[i]; if(!l || l.every(c => String(c==null?"":c).trim() === "")) continue;
      const o = { tag:(PREF.tag || nomiTag()[0] || "GENERALE"), descrizione:"", scadenza:null, fatto:false,
                  in_data:null, priorita:predefinitaPrio, ricorrenza:predefinitaRic, importo:null,
                  privata:false, autore:S.utente.id };
      l.forEach((cella,j) => {
        const k = testa[j]; if(!k) return;
        if(k === "scadenza" || k === "in_data") o[k] = leggiData(cella);
        else if(k === "ora_inizio" || k === "ora_fine") o[k] = leggiOra(cella);
        else if(k === "note" || k === "luogo"){ const t = String(cella==null?"":cella).trim(); o[k] = t || null; }
        else if(k === "fatto" || k === "privata") o[k] = vero(cella);
        else if(k === "importo"){ const n = parseFloat(String(cella).replace(",", ".")); o.importo = isNaN(n) ? null : n; }
        else if(k === "priorita"){ const s = norm(cella);
          const p = S.priorita.find(x => norm(x.nome) === s)
                 || S.priorita.find(x => norm(x.nome).startsWith(s.slice(0,1)));
          o.priorita = p ? p.nome : predefinitaPrio; }
        else if(k === "ricorrenza"){ const s = norm(cella);
          const v = S.ricorrenze.find(x => norm(x.nome) === s);
          o.ricorrenza = v ? v.nome : predefinitaRic; }
        else o[k] = String(cella==null?"":cella).trim();
      });
      if(!o.descrizione) continue;
      o.tag = (o.tag || "GENERALE").toUpperCase();
      if(!trovaTag(o.tag)) tagNuovi.add(o.tag);
      if(o.fatto && !o.in_data) o.in_data = o.scadenza || oggi();
      nuove.push(o);
    }
    if(!nuove.length){ avviso("Nessuna attività valida trovata (serve la colonna «descrizione»)"); return; }

    if(tagNuovi.size){                                  // i tag nuovi entrano nell'elenco condiviso
      let ordine = S.tag.length ? Math.max(...S.tag.map(t => t.ordine)) + 10 : 0;
      const righe = [...tagNuovi].map((n,i) => ({
        nome:n, colore:TAVOLOZZA[(S.tag.length + i) % TAVOLOZZA.length], ordine: ordine + i*10 }));
      const { error } = await sb.from("tag").insert(righe);
      if(error) console.warn(error);
      await caricaElenchi();
    }
    for(let i=0;i<nuove.length;i+=200){
      const { error } = await sb.from("attivita").insert(nuove.slice(i, i+200));
      if(error) throw error;
    }
    await carica(); disegnaImpostazioni();
    avviso("Importate " + nuove.length + " attività"
      + (tagNuovi.size ? " e " + tagNuovi.size + " nuovi tag" : ""));
  }catch(e){ avviso("Importazione non riuscita: " + spiegaErrore(e), null, null, 9000); }
}
async function esportaExcel(){
  try{
    await caricaSheetJS();
    const intest = ["tag","descrizione","scadenza","fatto","in data","priorita","ricorrenza","importo","privata","inserita da",
                    "ora inizio","ora fine","luogo","note"];
    const aoa = [intest];
    ordina(S.righe, "tag").forEach(r => aoa.push([
      r.tag, r.descrizione, r.scadenza ? isoDaSeriale(r.scadenza) : null,
      r.fatto ? "SI" : "NO", r.in_data ? isoDaSeriale(r.in_data) : null,
      r.priorita, r.ricorrenza, r.importo == null ? null : +r.importo,
      r.privata ? "SI" : "NO", nomeDi(r.autore),
      ora5(r.ora_inizio), ora5(r.ora_fine), r.luogo || "", r.note || ""
    ]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for(let R=1;R<=range.e.r;R++){
      for(const C of [2,4]){ const c = ws[XLSX.utils.encode_cell({ r:R, c:C })];
        if(c && c.t === "n"){ c.z = "dd/mm/yyyy"; delete c.w; } }
      const a = ws[XLSX.utils.encode_cell({ r:R, c:7 })]; if(a && a.t === "n") a.z = "#,##0.00";
    }
    ws["!cols"] = [{wch:15},{wch:48},{wch:12},{wch:8},{wch:12},{wch:11},{wch:14},{wch:12},{wch:9},{wch:16},
                   {wch:10},{wch:10},{wch:24},{wch:40}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attivita");
    XLSX.writeFile(wb, "attivita-" + oggi() + ".xlsx");
  }catch(e){ avviso("Esportazione non riuscita: " + e.message); }
}

/* =====================================================================
   ACCOUNT E AGGIORNAMENTO
   ===================================================================== */
async function salvaNome(){
  const nome = $("#accNome").value.trim();
  if(!nome) return;
  const { error } = await sb.from("membri").update({ nome }).eq("id", S.utente.id);
  if(error){ avviso("Non salvato: " + error.message); return; }
  await caricaMembri(); disegna(); disegnaImpostazioni(); avviso("Nome aggiornato");
}
async function forzaAggiornamento(){
  const b = $("#btnAggiorna"); b.disabled = true; b.textContent = "Aggiornamento…";
  try{
    if("serviceWorker" in navigator){
      const reg = await navigator.serviceWorker.getRegistrations();
      await Promise.all(reg.map(r => r.unregister()));
    }
    if(window.caches){
      const nomi = await caches.keys();
      await Promise.all(nomi.map(n => caches.delete(n)));
    }
  }catch(e){ console.warn(e); }
  location.replace(location.pathname + "?v=" + Date.now());
}

/* =====================================================================
   NAVIGAZIONE ED EVENTI
   ===================================================================== */
function vista(v){
  S.vista = v;
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  $("#vElenco").hidden = v !== "elenco";
  $("#vCal").hidden    = v !== "calendario";
  $("#vReport").hidden = v !== "report";
  $("#vSet").hidden    = v !== "impostazioni";
  $("#btnNuova").hidden = v === "report" || v === "impostazioni";
  if(v === "calendario") calendario();
  if(v === "report"){ tagReport(); anteprima(); }
  if(v === "impostazioni") disegnaImpostazioni();
  window.scrollTo({ top:0, behavior:"smooth" });
}
function collegaEventi(){
  $("#formLogin").addEventListener("submit", accedi);
  $$("[data-close]").forEach(b => b.onclick = () => chiudi(b.dataset.close));
  $$(".velo").forEach(v => v.onclick = e => { if(e.target === v) v.hidden = true; });
  $$("#tabbar button").forEach(b => b.onclick = () => vista(b.dataset.v));

  $("#q").oninput       = e => { S.filtri.q = e.target.value; elenco(); };
  $("#fStato").onchange = e => { S.filtri.stato = e.target.value; disegna(); };
  $("#fChi").onchange   = e => { S.filtri.chi = e.target.value; disegna(); };
  $("#fOrd").onchange   = e => { S.filtri.ord = e.target.value; elenco(); };
  $$(".kpi").forEach(k => k.onclick = () => {
    const m = { late:["todo","late"], today:["todo","today"], w:["todo","w"],
                todo:["todo",""], pay:["todo","pay"] }[k.dataset.k];
    S.filtri.stato = m[0];
    S.filtri.quando = (S.filtri.quando === m[1] && m[1]) ? "" : m[1];
    $("#fStato").value = m[0];
    vista("elenco"); disegna();
  });

  $("#btnNuova").onclick    = () => modale(null);
  $("#btnSalvaAtt").onclick = salvaDaModale;
  $("#fTag").onchange = e => e.target.classList.remove("errore");
  $("#fLuogo").oninput = aggiornaLinkMappa;
  $("#btnElimina").onclick  = () => {
    const r = S.righe.find(x => x.id === S.modifica); if(!r) return;
    conferma("Eliminare l'attività?", `«${r.descrizione}» verrà rimossa per tutti.`, async () => {
      if(await eliminaAttivita(r.id)){ chiudi("mAtt"); avviso("Attività eliminata"); }
    });
  };

  $("#calPrev").onclick = () => { S.cal.setMonth(S.cal.getMonth()-1); calendario(); };
  $("#calNext").onclick = () => { S.cal.setMonth(S.cal.getMonth()+1); calendario(); };
  $("#calOggi").onclick = () => { S.cal = new Date(); S.calSel = oggi(); calendario(); };

  ["rTitolo","rStato","rQuando","rOrd","rGruppo","rBox","rData","rPrio","rImp","rRic","rChi","rPriv","rOra","rNote"]
    .forEach(id => { const e = $("#"+id); if(e) e.oninput = e.onchange = anteprima; });
  $("#rTutti").onclick   = () => { S.reportEsclusi.clear(); tagReport(); anteprima(); };
  $("#rNessuno").onclick = () => { S.reportEsclusi = new Set(nomiTag()); tagReport(); anteprima(); };
  $("#btnStampa").onclick = stampaReport;
  $("#psStampa").onclick  = () => { try{ window.print(); }catch(e){} };
  $("#psTorna").onclick   = esciStampa;
  window.addEventListener("beforeprint", () => {
    if(!$("#stampa").innerHTML.trim()) $("#stampa").innerHTML = documento();
  });

  $("#btnAccount").onclick  = () => vista("impostazioni");
  $("#btnNome").onclick     = salvaNome;
  $("#accPush").onchange    = cambiaPush;
  $("#btnImporta").onclick  = () => $("#fileExcel").click();
  $("#fileExcel").onchange  = e => { const f = e.target.files[0]; if(f) importaExcel(f); e.target.value = ""; };
  $("#btnEsporta").onclick  = esportaExcel;
  $("#btnAggiorna").onclick = forzaAggiornamento;
  $("#btnEsci").onclick     = () => conferma("Uscire dall'app?", "Dovrai inserire di nuovo email e password.",
                                async () => { await sb.auth.signOut(); location.reload(); }, "", "Esci");

  $("#btnNuovoTag").onclick  = nuovoTag;
  $("#nuovoTag").onkeydown   = e => { if(e.key === "Enter") nuovoTag(); };
  $("#btnNuovaPrio").onclick = () => nuovoValore("priorita");
  $("#btnNuovaRic").onclick  = () => nuovoValore("ricorrenza");

  $("#defTag").onchange  = e => { PREF.tag = e.target.value === "(nessuno)" ? "" : e.target.value; salvaPref(); };
  $("#defPrio").onchange = e => { PREF.prio = e.target.value; salvaPref(); };
  $("#defRic").onchange  = e => { PREF.ric = e.target.value; salvaPref(); };
  $("#defGiorni").onchange = e => { PREF.giorni = Math.min(90, Math.max(1, +e.target.value || 7));
    e.target.value = PREF.giorni; salvaPref(); disegna(); };
  $("#defTema").onchange = e => { PREF.tema = e.target.value; salvaPref(); applicaTema(); disegna(); };
  $("#defGruppi").onchange = e => { PREF.gruppi = e.target.checked; salvaPref(); elenco(); };
  $$(".kpiOn").forEach(c => c.onchange = () => {
    PREF.kpi = $$(".kpiOn").filter(x => x.checked).map(x => x.value); salvaPref(); testata(); });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if(PREF.tema === "auto"){ applicaTema(); disegna(); } });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){ $$(".velo").forEach(v => v.hidden = true); esciStampa(); }
  });
  window.addEventListener("online",  () => { stato(""); carica(); });
  window.addEventListener("offline", () => stato("non connesso", true));
}

document.addEventListener("DOMContentLoaded", avvia);
