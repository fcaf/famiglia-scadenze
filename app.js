/* =====================================================================
   Attività e Scadenze di famiglia
   App statica che parla con Supabase. Nessun server da gestire.
   ===================================================================== */
"use strict";

/* ---------------------------------------------------------------- base */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const RICORRENZE = ["Nessuna","Giornaliera","Settimanale","Quindicinale","Mensile",
                    "Bimestrale","Trimestrale","Semestrale","Annuale"];
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio",
              "agosto","settembre","ottobre","novembre","dicembre"];
const GG = ["lun","mar","mer","gio","ven","sab","dom"];
const PESO = { Alta:0, Media:1, Bassa:2 };

const S = {
  utente:null, membri:{}, righe:[], vista:"elenco",
  filtri:{ q:"", stato:"todo", chi:"", ord:"scadenza", tag:new Set() },
  cal:new Date(), calSel:null, modifica:null, reportEsclusi:new Set(), canale:null
};

let sb = null;

/* ------------------------------------------------------- date e numeri */
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
const eur = v => (v==null||v==="") ? "" :
  new Intl.NumberFormat("it-IT",{ style:"currency", currency:"EUR" }).format(v);
function prossima(iso, ric){
  let d = iso || oggi(); const t = oggi();
  const passo = x => ({ Giornaliera:()=>piuGiorni(x,1), Settimanale:()=>piuGiorni(x,7),
    Quindicinale:()=>piuGiorni(x,14), Mensile:()=>piuMesi(x,1), Bimestrale:()=>piuMesi(x,2),
    Trimestrale:()=>piuMesi(x,3), Semestrale:()=>piuMesi(x,6), Annuale:()=>piuMesi(x,12) }[ric] || (()=>null))();
  for(let i=0;i<500;i++){ const n = passo(d); if(!n) return null; d = n; if(giorni(t,d) > 0) return d; }
  return d;
}
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,
  m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

/* --------------------------------------------------------- colori tag */
const TAVOLOZZA = [["#1f4f8f","#e8eff9"],["#7a3fa0","#f1e9f8"],["#1a7f52","#e3f4ec"],["#a85a14","#fbeedd"],
                   ["#a62c2c","#fbe9e9"],["#0f6f80","#e0f2f4"],["#5d5fa8","#eaeafb"],["#8a6d1f","#f8f0da"]];
const scuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
function hash(s){ let h=0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))|0; return Math.abs(h); }
function colTag(t){
  const p = TAVOLOZZA[hash(t||"—") % TAVOLOZZA.length];
  return scuro() ? { fg:"#fff", bg:p[0] } : { fg:p[0], bg:p[1] };
}
const tuttiTag = () => [...new Set(S.righe.map(r => r.tag || "GENERALE"))].sort((a,b)=>a.localeCompare(b,"it"));
const nomeDi = id => (S.membri[id] && S.membri[id].nome) || "—";
const iniziali = n => (n||"?").trim().slice(0,2).toUpperCase();

/* ------------------------------------------------------------- avvisi */
function avviso(testo, etichetta, azione){
  const d = document.createElement("div");
  d.className = "avviso"; d.textContent = testo;
  if(etichetta){ const b = document.createElement("button"); b.textContent = etichetta;
    b.onclick = () => { azione(); d.remove(); }; d.appendChild(b); }
  $("#avvisi").appendChild(d);
  setTimeout(() => { d.style.opacity = "0"; d.style.transition = "opacity .3s";
    setTimeout(() => d.remove(), 300); }, etichetta ? 6000 : 2600);
}
function apri(id){ $("#"+id).hidden = false; }
function chiudi(id){ $("#"+id).hidden = true; }
function conferma(titolo, testo, ok){
  $("#cTitolo").textContent = titolo; $("#cTesto").textContent = testo;
  const b = $("#cOk"), nb = b.cloneNode(true); b.replaceWith(nb);
  nb.onclick = () => { chiudi("mConf"); ok(); };
  apri("mConf");
}
function stato(testo, errore){
  const e = $("#sync"); e.textContent = testo || ""; e.className = "sync" + (errore ? " ko" : "");
}

/* =====================================================================
   ACCESSO
   ===================================================================== */
function configurato(){
  return window.CONFIG && /^https:\/\/[a-z0-9-]+\.supabase\.co/.test(CONFIG.SUPABASE_URL||"")
      && (CONFIG.SUPABASE_ANON||"").length > 20;
}
async function avvia(){
  $("#fRic").innerHTML = RICORRENZE.map(r => `<option>${r}</option>`).join("");
  collegaEventi();

  if(!configurato()){
    $("#login").hidden = false;
    $("#lgErr").hidden = false;
    $("#lgErr").innerHTML = "L'app non è ancora configurata: apri <b>js/config.js</b> e inserisci "
      + "l'indirizzo del progetto Supabase e la chiave anon (vedi il README).";
    $("#formLogin").hidden = true;
    return;
  }
  $("#lgNota").textContent = CONFIG.NOTA_ACCESSO || "";
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON, {
    auth:{ persistSession:true, autoRefreshToken:true }
  });

  const { data } = await sb.auth.getSession();
  if(data.session) await entrato(data.session.user); else $("#login").hidden = false;

  sb.auth.onAuthStateChange((evento, sessione) => {
    if(evento === "SIGNED_OUT"){ location.reload(); }
    else if(sessione && !S.utente) entrato(sessione.user);
  });

  if("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(()=>{});
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
    if(c && Array.isArray(c.righe)){ S.righe = c.righe; disegna(); stato("dati locali"); }
  }catch(e){}
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
  if(error){ stato("offline", true); avviso("Dati non aggiornati: " + error.message); return; }
  S.righe = data || [];
  try{ localStorage.setItem("cache-attivita", JSON.stringify({ righe:S.righe, il:Date.now() })); }catch(e){}
  stato("");
  disegna();
}
function ascolta(){
  if(S.canale) return;
  S.canale = sb.channel("attivita-live")
    .on("postgres_changes", { event:"*", schema:"public", table:"attivita" }, () => {
      clearTimeout(ascolta._t); ascolta._t = setTimeout(carica, 400);
    })
    .subscribe();
  document.addEventListener("visibilitychange", () => { if(!document.hidden) carica(); });
}

async function salvaAttivita(dati, id){
  const q = id ? sb.from("attivita").update(dati).eq("id", id)
               : sb.from("attivita").insert({ ...dati, autore:S.utente.id });
  const { error } = await q;
  if(error){ avviso("Non salvata: " + error.message); return false; }
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
  r.fatto = fatto; r.in_data = fatto ? oggi() : null; disegna();   // risposta immediata
  const { error } = await sb.from("attivita").update({ fatto, in_data: fatto ? oggi() : null }).eq("id", id);
  if(error){ avviso("Non aggiornata: " + error.message); return carica(); }
  if(fatto && r.ricorrenza && r.ricorrenza !== "Nessuna"){
    const nuova = prossima(r.scadenza, r.ricorrenza);
    await sb.from("attivita").insert({
      tag:r.tag, descrizione:r.descrizione, scadenza:nuova, fatto:false, in_data:null,
      priorita:r.priorita, ricorrenza:r.ricorrenza, importo:r.importo,
      privata:r.privata, autore:S.utente.id
    });
    avviso("Fatta ✓ — prossima il " + fmt(nuova));
  }
  carica();
}

/* =====================================================================
   FILTRI E ORDINAMENTO
   ===================================================================== */
function situazione(r){
  if(r.fatto) return "fatta";
  if(!r.scadenza) return "senzadata";
  const d = giorni(oggi(), r.scadenza);
  return d < 0 ? "late" : d === 0 ? "today" : d <= 7 ? "soon" : "futura";
}
function ordina(arr, chiave){
  return [...arr].sort((x,y) => {
    let v = 0;
    if(chiave === "scadenza"){ const a = x.scadenza||"9999-12-31", b = y.scadenza||"9999-12-31"; v = a<b?-1:a>b?1:0; }
    else if(chiave === "priorita") v = PESO[x.priorita] - PESO[y.priorita];
    else if(chiave === "importo")  v = (y.importo||0) - (x.importo||0);
    else v = String(x[chiave]||"").localeCompare(String(y[chiave]||""), "it", { sensitivity:"base" });
    if(v === 0){ const a = x.scadenza||"9999-12-31", b = y.scadenza||"9999-12-31"; v = a<b?-1:a>b?1:0; }
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
    if(f.tag.size && !f.tag.has(r.tag || "GENERALE")) return false;
    if(f.quando === "late" && !(r.scadenza && giorni(oggi(), r.scadenza) < 0)) return false;
    if(f.quando === "today" && !(r.scadenza && giorni(oggi(), r.scadenza) === 0)) return false;
    if(f.quando === "7" && !(r.scadenza && giorni(oggi(), r.scadenza) >= 0 && giorni(oggi(), r.scadenza) <= 7)) return false;
    if(f.quando === "pay" && r.importo == null) return false;
    if(q && !((r.descrizione||"").toLowerCase().includes(q) || (r.tag||"").toLowerCase().includes(q))) return false;
    return true;
  });
  return ordina(out, f.ord);
}

/* =====================================================================
   DISEGNO
   ===================================================================== */
function disegna(){ indicatori(); barraTag(); elenco(); calendario(); tagReport(); anteprima(); }

function indicatori(){
  const t = oggi(), da = S.righe.filter(r => !r.fatto);
  const n = (f) => da.filter(f).length;
  $("#k1").textContent = n(r => r.scadenza && giorni(t,r.scadenza) < 0);
  $("#k2").textContent = n(r => r.scadenza && giorni(t,r.scadenza) === 0);
  $("#k3").textContent = n(r => r.scadenza && giorni(t,r.scadenza) > 0 && giorni(t,r.scadenza) <= 7);
  $("#k4").textContent = da.length;
  const tot = da.reduce((s,r) => s + (+r.importo||0), 0);
  $("#k5").textContent = tot ? eur(tot) : "—";
  $$(".kpi").forEach(k => k.classList.toggle("on",
    (S.filtri.quando||"") === ({ late:"late", today:"today", w:"7", pay:"pay", todo:"" })[k.dataset.k]
    && (k.dataset.k !== "todo" || !S.filtri.quando)));
}
function barraTag(){
  const bar = $("#tagbar"), conta = {};
  S.righe.forEach(r => { if(S.filtri.stato === "todo" && r.fatto) return;
    const k = r.tag || "GENERALE"; conta[k] = (conta[k]||0) + 1; });
  bar.innerHTML = "";
  const t0 = document.createElement("button");
  t0.className = "chip" + (S.filtri.tag.size ? "" : " on"); t0.textContent = "Tutti";
  t0.onclick = () => { S.filtri.tag.clear(); disegna(); };
  bar.appendChild(t0);
  tuttiTag().forEach(t => {
    const on = S.filtri.tag.has(t), c = colTag(t), b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "");
    if(!on){ b.style.background = c.bg; b.style.color = c.fg; b.style.borderColor = "transparent"; }
    b.innerHTML = esc(t) + `<span class="c">${conta[t]||0}</span>`;
    b.onclick = () => { S.filtri.tag.has(t) ? S.filtri.tag.delete(t) : S.filtri.tag.add(t); disegna(); };
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
    else if(d <= 7){ txt += " · tra " + d + (d===1?" giorno":" giorni"); }
  }
  return `<span class="scad ${cls}">${txt}</span>`;
}
function elenco(){
  const righe = filtrate(), box = $("#lista");
  box.innerHTML = ""; $("#vuoto").hidden = righe.length > 0;
  const frag = document.createDocumentFragment();
  righe.forEach(r => {
    const c = colTag(r.tag || "GENERALE");
    const d = document.createElement("div");
    d.className = "card" + (r.fatto ? " fatta" : "");
    d.innerHTML = `
      <button class="spunta ${r.fatto?"on":""}" aria-label="Segna come fatta">
        ${r.fatto?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M20 6L9 17l-5-5"/></svg>':""}
      </button>
      <div class="corpocard">
        <div class="desc">${esc(r.descrizione)}</div>
        <div class="meta">
          <span class="tagb" style="background:${c.bg};color:${c.fg}">${esc(r.tag||"GENERALE")}</span>
          ${rigaScadenza(r)}
          <span class="prio p-${(r.priorita||"Media").toLowerCase()}"><i></i>${r.priorita}</span>
          ${r.importo!=null?`<span class="soldi">${eur(r.importo)}</span>`:""}
          ${r.ricorrenza&&r.ricorrenza!=="Nessuna"?`<span class="pill">↻ ${r.ricorrenza}</span>`:""}
          ${r.privata?`<span class="pill priv">🔒 privata</span>`:`<span class="pill">${esc(nomeDi(r.autore))}</span>`}
          ${r.fatto&&r.in_data?`<span class="pill">fatta il ${fmt(r.in_data)}</span>`:""}
        </div>
      </div>`;
    d.querySelector(".spunta").onclick = e => { e.stopPropagation(); spunta(r.id); };
    d.querySelector(".corpocard").onclick = () => modale(r.id);
    frag.appendChild(d);
  });
  box.appendChild(frag);
}

/* ------------------------------------------------------- calendario */
function calendario(){
  if(S.vista !== "calendario") return;
  const y = S.cal.getFullYear(), m = S.cal.getMonth();
  $("#calTitolo").textContent = MESI[m] + " " + y;
  const primo = new Date(y, m, 1), inizio = new Date(primo);
  inizio.setDate(1 - ((primo.getDay() + 6) % 7));
  const perGiorno = {};
  S.righe.forEach(r => { if(!r.scadenza || r.fatto) return;
    if(S.filtri.tag.size && !S.filtri.tag.has(r.tag || "GENERALE")) return;
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
    const punti = ev.slice(0,4).map(r => { const c = colTag(r.tag||"GENERALE");
      return `<span class="punto" style="background:${scuro()?c.bg:c.fg}"></span>`; }).join("");
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
  p.innerHTML = `<h3>${GG[(d.getDay()+6)%7]} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()} — ${ev.length} ${ev.length===1?"attività":"attività"}</h3>
    <div class="lista" id="listaGiorno"></div>
    <button class="btn wide" id="aggiungiQui" style="margin-top:10px">+ Attività il ${fmt(S.calSel)}</button>`;
  const box = $("#listaGiorno");
  if(!ev.length) box.innerHTML = `<p class="note">Nessuna scadenza in questa data.</p>`;
  ordina(ev, "priorita").forEach(r => {
    const c = colTag(r.tag || "GENERALE");
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<button class="spunta" aria-label="Segna come fatta"></button>
      <div class="corpocard"><div class="desc">${esc(r.descrizione)}</div>
      <div class="meta"><span class="tagb" style="background:${c.bg};color:${c.fg}">${esc(r.tag||"GENERALE")}</span>
      <span class="prio p-${(r.priorita||"Media").toLowerCase()}"><i></i>${r.priorita}</span>
      ${r.importo!=null?`<span class="soldi">${eur(r.importo)}</span>`:""}
      ${r.privata?`<span class="pill priv">🔒 privata</span>`:""}</div></div>`;
    el.querySelector(".spunta").onclick = e => { e.stopPropagation(); spunta(r.id); };
    el.querySelector(".corpocard").onclick = () => modale(r.id);
    box.appendChild(el);
  });
  $("#aggiungiQui").onclick = () => { modale(null); $("#fScad").value = S.calSel; };
}

/* =====================================================================
   MODALE ATTIVITÀ
   ===================================================================== */
function modale(id){
  S.modifica = id || null;
  const r = id ? S.righe.find(x => x.id === id) : null;
  $("#mTitolo").textContent = r ? "Modifica attività" : "Nuova attività";
  $("#fDesc").value   = r ? r.descrizione : "";
  $("#fTag").value    = r ? (r.tag||"") : (S.filtri.tag.size === 1 ? [...S.filtri.tag][0] : "");
  $("#fPrio").value   = r ? r.priorita : "Media";
  $("#fScad").value   = r && r.scadenza ? r.scadenza : "";
  $("#fRic").value    = r ? r.ricorrenza : "Nessuna";
  $("#fImp").value    = r && r.importo != null ? r.importo : "";
  $("#fPriv").checked = r ? !!r.privata : false;
  $("#fFatto").value  = r && r.fatto ? "si" : "no";
  $("#fInData").value = r && r.in_data ? r.in_data : "";
  $("#dlTags").innerHTML = tuttiTag().map(t => `<option value="${esc(t)}">`).join("");
  const mio = !r || r.autore === S.utente.id;
  $("#btnElimina").hidden = !r;
  $("#mAutore").textContent = r ? "Inserita da " + nomeDi(r.autore) : "";
  $("#fPriv").disabled = r && !mio;
  apri("mAtt");
  if(!r) setTimeout(() => $("#fDesc").focus(), 60);
}
async function salvaDaModale(){
  const desc = $("#fDesc").value.trim();
  if(!desc){ $("#fDesc").focus(); avviso("La descrizione è obbligatoria"); return; }
  const fatto = $("#fFatto").value === "si";
  const dati = {
    tag: ($("#fTag").value.trim() || "GENERALE").toUpperCase(),
    descrizione: desc,
    scadenza: $("#fScad").value || null,
    priorita: $("#fPrio").value,
    ricorrenza: $("#fRic").value,
    importo: $("#fImp").value === "" ? null : parseFloat($("#fImp").value),
    privata: $("#fPriv").checked,
    fatto,
    in_data: fatto ? ($("#fInData").value || oggi()) : null
  };
  const b = $("#btnSalvaAtt"); b.disabled = true;
  const ok = await salvaAttivita(dati, S.modifica);
  b.disabled = false;
  if(ok){ chiudi("mAtt"); avviso(S.modifica ? "Attività aggiornata" : "Attività aggiunta"); }
}

/* =====================================================================
   REPORT STAMPABILE
   ===================================================================== */
function tagReport(){
  const box = $("#rTags"); if(!box) return;
  box.innerHTML = "";
  tuttiTag().forEach(t => {
    const on = !S.reportEsclusi.has(t), c = colTag(t), b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "");
    if(on){ b.style.background = c.bg; b.style.color = c.fg; b.style.borderColor = "transparent"; }
    b.textContent = t;
    b.onclick = () => { on ? S.reportEsclusi.add(t) : S.reportEsclusi.delete(t); tagReport(); anteprima(); };
    box.appendChild(b);
  });
}
function righeReport(){
  const stato = $("#rStato").value, quando = $("#rQuando").value, conPriv = $("#rPriv").checked;
  const out = S.righe.filter(r => {
    if(stato === "todo" && r.fatto) return false;
    if(stato === "done" && !r.fatto) return false;
    if(r.privata && !conPriv) return false;
    if(S.reportEsclusi.has(r.tag || "GENERALE")) return false;
    if(quando === "none") return !r.scadenza;
    if(quando === "late") return r.scadenza && giorni(oggi(), r.scadenza) < 0;
    if(quando){ if(!r.scadenza) return false; return giorni(oggi(), r.scadenza) <= +quando; }
    return true;
  });
  return ordina(out, $("#rOrd").value);
}
function fascia(r){
  if(!r.scadenza) return { k:9, t:"Senza scadenza" };
  const d = giorni(oggi(), r.scadenza);
  if(d < 0) return { k:0, t:"Scadute" };
  if(d === 0) return { k:1, t:"Oggi" };
  if(d <= 7) return { k:2, t:"Prossimi 7 giorni" };
  if(d <= 31) return { k:3, t:"Entro il mese" };
  return { k:4, t:"Oltre il mese" };
}
function documento(){
  const righe = righeReport();
  const o = { box:$("#rBox").checked, data:$("#rData").checked, prio:$("#rPrio").checked,
              imp:$("#rImp").checked, ric:$("#rRic").checked, chi:$("#rChi").checked, gruppo:$("#rGruppo").value };
  const ora = new Date();
  const stampa = pad(ora.getDate())+"/"+pad(ora.getMonth()+1)+"/"+ora.getFullYear();
  const sel = tuttiTag().filter(t => !S.reportEsclusi.has(t));
  const etTag = sel.length === tuttiTag().length ? "tutte le aree" : (sel.join(" · ") || "nessuna area selezionata");
  const etStato = { todo:"solo attività da fare", all:"tutte le attività", done:"solo attività completate" }[$("#rStato").value];

  let gruppi;
  if(o.gruppo === "tag"){
    const m = {}; righe.forEach(r => { const k = r.tag || "GENERALE"; (m[k] = m[k] || []).push(r); });
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
              ${o.prio?`<td class="pr">${r.priorita==="Alta"?"!":r.priorita==="Media"?"·":""}</td>`:""}
              <td>${esc(r.descrizione)}${o.gruppo!=="tag"&&r.tag?` <span class="rg">[${esc(r.tag)}]</span>`:""}${r.privata?` <span class="rg">(privata)</span>`:""}</td>
              ${o.chi?`<td class="rg">${esc(nomeDi(r.autore))}</td>`:""}
              ${o.ric?`<td class="rg">${r.ricorrenza!=="Nessuna"?"↻ "+r.ricorrenza:""}</td>`:""}
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
    <div class="foot"><span>Attività e Scadenze di famiglia</span><span>${esc(nomeDi(S.utente && S.utente.id))}</span></div></div>`;
}
function anteprima(){ if(S.vista === "report") $("#anteprima").innerHTML = documento(); }
function stampaReport(){
  $("#stampa").innerHTML = documento();
  const t = document.title;
  document.title = $("#rTitolo").value || "Elenco attività";
  window.print();
  setTimeout(() => { document.title = t; $("#stampa").innerHTML = ""; }, 900);
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
      if(permesso !== "granted"){ e.target.checked = false;
        avviso("Permesso negato dal telefono"); return; }
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
   EXCEL (importazione ed esportazione)
   ===================================================================== */
function caricaSheetJS(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((ok,ko) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = ok; s.onerror = () => ko(new Error("libreria non raggiungibile"));
    document.head.appendChild(s);
  });
}
/* conversione seriale Excel -> data, con sola aritmetica intera */
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
  "ricorrenza":"ricorrenza","frequenza":"ricorrenza","importo":"importo","costo":"importo","privata":"privata" };
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
    const nuove = [];
    for(let i=1;i<aoa.length;i++){
      const l = aoa[i]; if(!l || l.every(c => String(c==null?"":c).trim() === "")) continue;
      const o = { tag:"GENERALE", descrizione:"", scadenza:null, fatto:false, in_data:null,
                  priorita:"Media", ricorrenza:"Nessuna", importo:null, privata:false, autore:S.utente.id };
      l.forEach((cella,j) => {
        const k = testa[j]; if(!k) return;
        if(k === "scadenza" || k === "in_data") o[k] = leggiData(cella);
        else if(k === "fatto" || k === "privata") o[k] = vero(cella);
        else if(k === "importo"){ const n = parseFloat(String(cella).replace(",", ".")); o.importo = isNaN(n) ? null : n; }
        else if(k === "priorita"){ const s = norm(cella);
          o.priorita = s.startsWith("a") ? "Alta" : s.startsWith("b") ? "Bassa" : "Media"; }
        else if(k === "ricorrenza"){ const f = RICORRENZE.find(r => norm(r) === norm(cella)); o.ricorrenza = f || "Nessuna"; }
        else o[k] = String(cella==null?"":cella).trim();
      });
      if(!o.descrizione) continue;
      o.tag = (o.tag || "GENERALE").toUpperCase();
      if(o.fatto && !o.in_data) o.in_data = o.scadenza || oggi();
      nuove.push(o);
    }
    if(!nuove.length){ avviso("Nessuna attività valida trovata (serve la colonna «descrizione»)"); return; }
    for(let i=0;i<nuove.length;i+=200){
      const { error } = await sb.from("attivita").insert(nuove.slice(i, i+200));
      if(error) throw error;
    }
    await carica();
    avviso("Importate " + nuove.length + " attività");
  }catch(e){ avviso("Importazione non riuscita: " + e.message); }
}
async function esportaExcel(){
  try{
    await caricaSheetJS();
    const intest = ["tag","descrizione","scadenza","fatto","in data","priorita","ricorrenza","importo","privata","inserita da"];
    const aoa = [intest];
    ordina(S.righe, "tag").forEach(r => aoa.push([
      r.tag, r.descrizione, r.scadenza ? isoDaSeriale(r.scadenza) : null,
      r.fatto ? "SI" : "NO", r.in_data ? isoDaSeriale(r.in_data) : null,
      r.priorita, r.ricorrenza, r.importo == null ? null : +r.importo,
      r.privata ? "SI" : "NO", nomeDi(r.autore)
    ]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for(let R=1;R<=range.e.r;R++){
      for(const C of [2,4]){ const c = ws[XLSX.utils.encode_cell({ r:R, c:C })];
        if(c && c.t === "n"){ c.z = "dd/mm/yyyy"; delete c.w; } }
      const a = ws[XLSX.utils.encode_cell({ r:R, c:7 })]; if(a && a.t === "n") a.z = "#,##0.00";
    }
    ws["!cols"] = [{wch:15},{wch:48},{wch:12},{wch:8},{wch:12},{wch:11},{wch:14},{wch:12},{wch:9},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attivita");
    XLSX.writeFile(wb, "attivita-" + oggi() + ".xlsx");
  }catch(e){ avviso("Esportazione non riuscita: " + e.message); }
}

/* =====================================================================
   ACCOUNT
   ===================================================================== */
function apriAccount(){
  const m = S.membri[S.utente.id];
  $("#accInfo").textContent = "Collegato come " + S.utente.email;
  $("#accNome").value = m ? m.nome : "";
  const box = $("#elencoMembri");
  box.innerHTML = Object.values(S.membri).map(x => {
    const c = colTag(x.nome);
    return `<span class="membro"><span class="pal" style="background:${scuro()?c.bg:c.fg}">${esc(iniziali(x.nome))}</span>${esc(x.nome)}</span>`;
  }).join("") || `<span class="note">Nessun altro membro registrato.</span>`;
  aggiornaStatoPush();
  apri("mAccount");
}
async function salvaNome(){
  const nome = $("#accNome").value.trim();
  if(!nome) return;
  const { error } = await sb.from("membri").update({ nome }).eq("id", S.utente.id);
  if(error){ avviso("Non salvato: " + error.message); return; }
  await caricaMembri(); disegna(); avviso("Nome aggiornato");
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
  $("#titoloVista").textContent = { elenco:"Elenco", calendario:"Calendario", report:"Report" }[v];
  $("#btnNuova").hidden = v === "report";
  if(v === "calendario") calendario();
  if(v === "report"){ tagReport(); anteprima(); }
}
function collegaEventi(){
  $("#formLogin").addEventListener("submit", accedi);
  $$("[data-close]").forEach(b => b.onclick = () => chiudi(b.dataset.close));
  $$(".velo").forEach(v => v.onclick = e => { if(e.target === v) v.hidden = true; });
  $$("#tabbar button").forEach(b => b.onclick = () => vista(b.dataset.v));

  $("#q").oninput      = e => { S.filtri.q = e.target.value; elenco(); };
  $("#fStato").onchange = e => { S.filtri.stato = e.target.value; disegna(); };
  $("#fChi").onchange   = e => { S.filtri.chi = e.target.value; disegna(); };
  $("#fOrd").onchange   = e => { S.filtri.ord = e.target.value; elenco(); };
  $$(".kpi").forEach(k => k.onclick = () => {
    const m = { late:["todo","late"], today:["todo","today"], w:["todo","7"], todo:["todo",""], pay:["todo","pay"] }[k.dataset.k];
    S.filtri.stato = m[0]; S.filtri.quando = m[1]; $("#fStato").value = m[0];
    vista("elenco"); disegna();
  });

  $("#btnNuova").onclick  = () => modale(null);
  $("#btnSalvaAtt").onclick = salvaDaModale;
  $("#btnElimina").onclick = () => {
    const r = S.righe.find(x => x.id === S.modifica); if(!r) return;
    conferma("Eliminare l'attività?", `«${r.descrizione}» verrà rimossa per tutti.`, async () => {
      if(await eliminaAttivita(r.id)){ chiudi("mAtt"); avviso("Attività eliminata"); }
    });
  };

  $("#calPrev").onclick = () => { S.cal.setMonth(S.cal.getMonth()-1); calendario(); };
  $("#calNext").onclick = () => { S.cal.setMonth(S.cal.getMonth()+1); calendario(); };
  $("#calOggi").onclick = () => { S.cal = new Date(); S.calSel = oggi(); calendario(); };

  ["rTitolo","rStato","rQuando","rOrd","rGruppo","rBox","rData","rPrio","rImp","rRic","rChi","rPriv"]
    .forEach(id => { const e = $("#"+id); if(e) e.oninput = e.onchange = anteprima; });
  $("#rTutti").onclick   = () => { S.reportEsclusi.clear(); tagReport(); anteprima(); };
  $("#rNessuno").onclick = () => { S.reportEsclusi = new Set(tuttiTag()); tagReport(); anteprima(); };
  $("#btnStampa").onclick = stampaReport;

  $("#btnAccount").onclick = apriAccount;
  $("#btnNome").onclick    = salvaNome;
  $("#accPush").onchange   = cambiaPush;
  $("#btnImporta").onclick = () => $("#fileExcel").click();
  $("#fileExcel").onchange = e => { const f = e.target.files[0]; if(f) importaExcel(f); e.target.value = ""; };
  $("#btnEsporta").onclick = esportaExcel;
  $("#btnEsci").onclick    = () => conferma("Uscire dall'app?", "Dovrai inserire di nuovo email e password.",
                                            async () => { await sb.auth.signOut(); location.reload(); });

  document.addEventListener("keydown", e => {
    if(e.key === "Escape") $$(".velo").forEach(v => v.hidden = true);
  });
  window.addEventListener("online",  () => { stato(""); carica(); });
  window.addEventListener("offline", () => stato("offline", true));
}

document.addEventListener("DOMContentLoaded", avvia);
