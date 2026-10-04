(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const CATS = {
    flight:{n:"Flights",c:"#0f6b5c"}, stay:{n:"Stay",c:"#f2b632"}, transport:{n:"Local transport",c:"#5b7fd6"},
    food:{n:"Food & drinks",c:"#d9734a"}, activity:{n:"Activities",c:"#9b5fc0"}, other:{n:"Other",c:"#8a9a94"}
  };
  const CAT_KEYS = Object.keys(CATS);
  const ls = {
    get(k){ try { return localStorage.getItem(k) || ""; } catch(e){ return ""; } },
    set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
  };
  let trip = {name:"", currency:"CAD", budgetPP:0, crew:[], chosen:""};
  let options = [], items = [], days = [], filter = "all", loaded = false;
  let me = ls.get("trip-me"), code = ls.get("trip-code"), sel = ls.get("trip-opt");

  // ---------- API ----------
  // If the server API is missing (site deployed without its function), fall back to
  // saving in this browser only, and say so on the page.
  let localMode = false;
  async function api(method, path, body){
    if (localMode) return localApi(method, path, body);
    let r;
    try {
      r = await fetch("/api/" + path, {
        method, headers: {"content-type":"application/json", "x-trip-code": code},
        body: body ? JSON.stringify(body) : undefined
      });
    } catch(e) { throw new Error("network"); }
    if (r.status === 401) { showLock(code ? "Wrong code. Try again." : ""); throw new Error("locked"); }
    const isJson = (r.headers.get("content-type") || "").includes("application/json");
    if (r.status === 404 && !isJson) { enterLocalMode(); return localApi(method, path, body); }
    if (!r.ok) throw new Error("http " + r.status);
    return r.status === 204 ? null : r.json();
  }
  function enterLocalMode(){
    localMode = true;
    $("#localBanner").hidden = false;
  }
  const LKEY = "trip-local-db";
  const lload = () => { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch(e){ return {}; } };
  const lsave = db => { try { localStorage.setItem(LKEY, JSON.stringify(db)); } catch(e){} };
  const lid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function localApi(method, path, body){
    const db = lload(); db.options = db.options || []; db.items = db.items || []; db.days = db.days || [];
    const [res, id, sub] = path.split("/").map(decodeURIComponent);
    const find = (arr) => arr.find(x => x.id === id);
    let out = null;
    if (res === "state") return {trip: db.trip || null, options: db.options, items: db.items, days: db.days};
    if (res === "trip" && method === "PUT") { db.trip = body; out = body; }
    if (res === "options") {
      if (!id && method === "POST") { out = {...body, id: lid(), votes: [], created: Date.now()}; db.options.push(out); }
      else if (sub === "vote") {
        const removing = (find(db.options)?.votes || []).includes(body.name);
        db.options.forEach(o => { const v = new Set(o.votes || []); (o.id === id && !removing) ? v.add(body.name) : v.delete(body.name); o.votes = [...v]; });
        out = {ok: true};
      } else if (method === "DELETE") {
        db.options = db.options.filter(o => o.id !== id); db.items = db.items.filter(i => i.optionId !== id);
        if (db.trip && db.trip.chosen === id) db.trip.chosen = "";
      }
    }
    if (res === "items") {
      if (!id && method === "POST") { out = {...body, id: lid(), votes: [], created: Date.now()}; db.items.push(out); }
      else if (sub === "vote") { const it = find(db.items); if (it) { const v = new Set(it.votes || []); v.has(body.name) ? v.delete(body.name) : v.add(body.name); it.votes = [...v]; } out = it; }
      else if (method === "PATCH") { const it = find(db.items); if (it) Object.assign(it, body); out = it; }
      else if (method === "DELETE") db.items = db.items.filter(i => i.id !== id);
    }
    if (res === "days") {
      if (!id && method === "POST") { out = {...body, id: lid()}; db.days.push(out); }
      else if (method === "DELETE") db.days = db.days.filter(d => d.id !== id);
    }
    lsave(db);
    return out;
  }
  const status = m => { $("#status").textContent = m || ""; };
  async function run(method, path, body){
    try { const out = await api(method, path, body); status(""); await refresh(); return out; }
    catch(e){ if (e.message !== "locked") status("Could not save. Check your connection and try again."); }
  }
  async function refresh(){
    try {
      const s = await api("GET", "state");
      trip = {...trip, ...(s.trip || {})}; trip.crew = trip.crew || [];
      options = (s.options || []).sort((a,b) => (a.created||0) - (b.created||0));
      items = s.items || []; days = s.days || []; loaded = true;
      $("#lock").hidden = true; $("#app").hidden = false;
      renderAll();
    } catch(e){ if (e.message !== "locked") status("Could not reach the server. Retrying…"); }
  }
  function showLock(msg){ $("#app").hidden = true; $("#lock").hidden = false; $("#lockMsg").textContent = msg || ""; }
  $("#lock").onsubmit = e => { e.preventDefault(); code = $("#codeIn").value.trim(); ls.set("trip-code", code); refresh(); };

  // ---------- helpers ----------
  const N = () => Math.max(trip.crew.length, 1);
  const money = (v, dp) => {
    const cur = trip.currency || "CAD";
    try { return new Intl.NumberFormat(undefined,{style:"currency",currency:cur,maximumFractionDigits:dp??0,minimumFractionDigits:dp??0}).format(v||0); }
    catch(e){ return cur + " " + Math.round(v||0); }
  };
  const total = it => (+it.amount||0) * (it.basis === "person" ? N() : 1);
  const fmtDate = d => d ? new Date(d+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";
  const nights = o => (o && o.start && o.end) ? Math.round((new Date(o.end) - new Date(o.start))/864e5) : 0;
  const dateLine = o => {
    if (!o || !o.start) return "Dates not set";
    let s = fmtDate(o.start) + (o.end ? " – " + fmtDate(o.end) : "");
    const n = nights(o); if (n > 0) s += ` · ${n} night${n>1?"s":""}`;
    return s;
  };
  const optById = id => options.find(o => o.id === id);
  const itemsFor = id => items.filter(i => i.optionId === id);
  function totals(id){
    let all=0, booked=0, ideas=0, nb=0, ni=0; const byCat = {};
    itemsFor(id).forEach(it => { const t = total(it); all += t; byCat[it.category] = (byCat[it.category]||0)+t;
      if (it.status==="booked"){ booked+=t; nb++; } else { ideas+=t; ni++; } });
    return {all, booked, ideas, nb, ni, byCat, pp: all / N(), count: nb + ni};
  }
  // Leader = most votes; null on a tie or when nobody has voted.
  function leader(){
    if (!options.length) return null;
    const sorted = options.slice().sort((a,b) => (b.votes||[]).length - (a.votes||[]).length);
    const top = (sorted[0].votes||[]).length;
    if (!top) return null;
    if (sorted[1] && (sorted[1].votes||[]).length === top) return null;
    return sorted[0];
  }
  function focusOption(){
    if (sel && optById(sel)) return optById(sel);
    return optById(trip.chosen) || leader() || options[0] || null;
  }
  const decided = () => optById(trip.chosen) || null;

  // ---------- tabs / filters ----------
  function showTab(name){
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === name));
    ["options","costs","plan","settle","setup"].forEach(t => $("#p-"+t).hidden = t !== name);
  }
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
  document.querySelectorAll("#filters .chip").forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll("#filters .chip").forEach(x => x.setAttribute("aria-pressed", x===b));
    renderItems();
  });
  $("#optSel").onchange = e => { sel = e.target.value; ls.set("trip-opt", sel); renderAll(); };

  // ---------- price-check links ----------
  function renderPriceLinks(){
    const o = focusOption();
    if (!o) { $("#priceLinks").innerHTML = `Add a trip option first. Then you get price-check links here.`; return; }
    const d = o.destination, q = encodeURIComponent(d || ""), n = N(), ci = o.start || "", co = o.end || "";
    const cat = $("#iCat").value;
    let links = [];
    if (cat === "flight") links = [
      ["Google Flights", `https://www.google.com/travel/flights?q=${encodeURIComponent("Flights to " + d + (ci ? " on " + ci : "") + (co ? " returning " + co : ""))}`],
      ["Skyscanner", `https://www.skyscanner.ca/`]];
    else if (cat === "stay") links = [
      ["Airbnb", `https://www.airbnb.ca/s/${q}/homes?adults=${n}${ci?`&checkin=${ci}`:""}${co?`&checkout=${co}`:""}`],
      ["Booking.com", `https://www.booking.com/searchresults.html?ss=${q}&group_adults=${n}${ci?`&checkin=${ci}`:""}${co?`&checkout=${co}`:""}`],
      ["Google Hotels", `https://www.google.com/travel/hotels?q=${encodeURIComponent("hotels in " + d)}`]];
    else if (cat === "activity") links = [
      ["GetYourGuide", `https://www.getyourguide.com/s/?q=${q}`],
      ["Tripadvisor", `https://www.tripadvisor.ca/Search?q=${q}`]];
    else if (cat === "transport") links = [
      ["Rome2Rio", `https://www.rome2rio.com/s/${q}`],
      ["Car rentals", `https://www.google.com/search?q=${encodeURIComponent("car rental " + d)}`]];
    else links = [["Search prices", `https://www.google.com/search?q=${encodeURIComponent(($("#iTitle").value || "cost") + " " + d + " price")}`]];
    $("#priceLinks").innerHTML = `<span class="hint">Check real prices for ${esc(d)}:</span> ` +
      links.map(([t,u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join("");
  }
  $("#iCat").onchange = renderPriceLinks;

  // ---------- render: header + people ----------
  function renderHeader(){
    const dec = decided(), lead = leader();
    $("#tripName").textContent = trip.name || "Your next trip";
    document.title = (trip.name ? trip.name + " · " : "") + "Group Trip Planner";
    if (dec) {
      const t = totals(dec.id);
      $("#stubLabel").textContent = "Group trip · decided";
      $("#tripDest").innerHTML = `To <b>${esc(dec.destination)}</b>`;
      $("#tripDates").textContent = dateLine(dec);
      $("#ppLabel").textContent = "Per person";
      $("#ppBig").textContent = money(t.pp);
      $("#ppSub").textContent = trip.crew.length ? `split ${trip.crew.length} ways` : "add the crew to split";
    } else if (options.length) {
      $("#stubLabel").textContent = "Group trip · voting";
      $("#tripDest").innerHTML = `<b>${options.length}</b> option${options.length>1?"s":""} on the table`;
      $("#tripDates").innerHTML = lead ? `Leading: <b>${esc(lead.name)}</b>` : "No clear leader yet";
      const show = lead || options[0], t = totals(show.id);
      $("#ppLabel").textContent = lead ? "Leader, per person" : "Cheapest, per person";
      if (!lead) {
        const cheapest = options.map(o => [o, totals(o.id)]).filter(x => x[1].count).sort((a,b) => a[1].pp - b[1].pp)[0];
        $("#ppBig").textContent = cheapest ? money(cheapest[1].pp) : money(0);
        $("#ppSub").textContent = cheapest ? cheapest[0].name : "add costs to compare";
      } else {
        $("#ppBig").textContent = money(t.pp);
        $("#ppSub").textContent = lead.name;
      }
    } else {
      $("#stubLabel").textContent = "Group trip";
      $("#tripDest").textContent = "Add trip options to start";
      $("#tripDates").textContent = "";
      $("#ppLabel").textContent = "Per person"; $("#ppBig").textContent = money(0); $("#ppSub").textContent = "no costs yet";
    }
    $("#tripCrew").textContent = `${trip.crew.length} traveller${trip.crew.length===1?"":"s"}`;

    const crewOpts = trip.crew.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const keepPaid = $("#iPaid").value;
    $("#iPaid").innerHTML = `<option value="">Nobody yet</option>` + crewOpts; $("#iPaid").value = keepPaid;
    $("#meSel").innerHTML = `<option value="">— pick your name —</option>` + crewOpts;
    if (loaded && me && !trip.crew.includes(me)) { me = ""; ls.set("trip-me", ""); }
    $("#meSel").value = me;
    $("#meHint").textContent = me ? "" : (trip.crew.length ? "Pick your name to vote." : "Add the crew in Setup first.");
    $("#crewList").innerHTML = trip.crew.length
      ? trip.crew.map((c,i) => `<span>${esc(c)}<button type="button" aria-label="Remove ${esc(c)}" data-rm="${i}">×</button></span>`).join("")
      : `<span class="hint" style="border:0;background:none;padding:0">No one yet.</span>`;
    $("#crewList").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const c = trip.crew.slice(); c.splice(+b.dataset.rm,1); saveTrip({crew:c}); });
    if (!$("#tripForm").contains(document.activeElement)) {
      $("#tName").value = trip.name||""; $("#tCur").value = trip.currency||"CAD"; $("#tBudget").value = trip.budgetPP||"";
    }
  }

  // ---------- render: options board ----------
  function renderOptions(){
    if (!loaded) return;
    const lead = leader(), dec = decided();
    const voted = new Set(options.flatMap(o => o.votes || []));
    const waiting = trip.crew.filter(c => !voted.has(c));
    // Vote summary
    if (!options.length) {
      $("#voteSummary").innerHTML = `<h3 style="font-size:18px">Where should we go?</h3><p class="hint" style="margin:0">Add two or more trip options below. Add costs to each one, then everyone votes.</p>`;
      $("#optDetails").open = true;
    } else {
      const done = trip.crew.length - waiting.length;
      $("#voteSummary").innerHTML = `
        <div class="opt-top"><div><span class="label">Votes in</span><h3 style="font-size:22px">${done} of ${trip.crew.length}</h3></div>
        <div style="text-align:right"><span class="label">Status</span><div style="font-weight:600">${dec ? "Decided: " + esc(dec.name) : lead ? "Leading: " + esc(lead.name) : "Tied / no votes"}</div></div></div>
        ${trip.crew.length ? `<div class="votebar"><i style="width:${done / trip.crew.length * 100}%"></i></div>` : ""}
        <p class="hint" style="margin:0">${!trip.crew.length ? "Add the crew in Setup so people can vote." : waiting.length ? "Still waiting on: " + waiting.map(esc).join(", ") : "Everyone has voted."}</p>`;
    }
    // Cards
    const budget = +trip.budgetPP || 0;
    $("#opts").innerHTML = options.length ? options.map(o => {
      const t = totals(o.id), v = o.votes || [], mine = me && v.includes(me);
      const isLead = lead && lead.id === o.id, isChosen = dec && dec.id === o.id;
      const badges = [
        isChosen ? `<span class="badge chosen">Final pick</span>` : "",
        isLead && !isChosen ? `<span class="badge lead">Leading</span>` : "",
        budget && t.count ? (t.pp > budget ? `<span class="badge over">${money(t.pp - budget)} over budget</span>` : `<span class="badge under">Within budget</span>`) : "",
      ].join("");
      return `<article class="opt ${isChosen ? "chosen" : isLead ? "lead" : ""}" data-id="${esc(o.id)}">
        <div class="opt-top">
          <div style="min-width:0;display:grid;gap:4px">
            ${badges ? `<div class="badges">${badges}</div>` : ""}
            <h3>${esc(o.name)}</h3>
            <div class="where">${esc(o.destination)} · ${esc(dateLine(o))}</div>
          </div>
          <div class="pp">${t.count ? money(t.pp) : "—"}<small>${t.count ? "per person" : "no costs yet"}</small></div>
        </div>
        ${o.notes ? `<p class="notes">${esc(o.notes)}</p>` : ""}
        <div class="hint">${t.count} cost${t.count===1?"":"s"} · ${money(t.booked / N())} booked /pp</div>
        <div class="votebar" aria-label="${v.length} votes"><i style="width:${trip.crew.length ? v.length / trip.crew.length * 100 : 0}%"></i></div>
        <div class="voters"><b>${v.length} vote${v.length===1?"":"s"}</b>${v.length ? ": " + v.map(esc).join(", ") : ""}</div>
        <div class="opt-actions">
          <button class="btn ${mine ? "voted" : "primary"}" data-oact="vote" ${!me ? "disabled" : ""}>${mine ? "✓ Your vote" : "Vote for this"}</button>
          <button class="btn" data-oact="costs">${t.count ? "See costs" : "Add costs"}</button>
          <button class="btn ghost" data-oact="final">${isChosen ? "Undo final pick" : "Make final pick"}</button>
          <button class="btn ghost" data-oact="del">Delete</button>
        </div>
      </article>`;
    }).join("") : "";
    // Compare table
    $("#compareCard").hidden = options.length < 2;
    if (options.length >= 2) {
      const tots = options.map(o => totals(o.id));
      const cats = CAT_KEYS.filter(k => tots.some(t => t.byCat[k]));
      const withCosts = tots.filter(t => t.count).map(t => t.pp);
      const min = withCosts.length ? Math.min(...withCosts) : -1;
      $("#compare").innerHTML = `<thead><tr><th>Per person</th>${options.map(o => `<th class="n">${esc(o.name)}</th>`).join("")}</tr></thead>
        <tbody>${cats.map(k => `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${CATS[k].c};margin-right:6px"></i>${CATS[k].n}</td>${tots.map(t => `<td class="n">${t.byCat[k] ? money(t.byCat[k]/N()) : "—"}</td>`).join("")}</tr>`).join("")}
        <tr><td>Nights</td>${options.map(o => `<td class="n">${nights(o) || "—"}</td>`).join("")}</tr>
        <tr><td>Votes</td>${options.map(o => `<td class="n">${(o.votes||[]).length}</td>`).join("")}</tr></tbody>
        <tfoot><tr><td>Total</td>${tots.map(t => `<td class="n ${t.count && t.pp === min ? "best" : ""}">${t.count ? money(t.pp) : "—"}${t.count && t.pp === min ? " ✓" : ""}</td>`).join("")}</tr></tfoot>`;
    }
  }
  $("#opts").addEventListener("click", e => {
    const b = e.target.closest("[data-oact]"); if (!b) return;
    const id = b.closest(".opt").dataset.id, o = optById(id); if (!o) return;
    const act = b.dataset.oact;
    if (act === "vote" && me) run("POST", "options/" + encodeURIComponent(id) + "/vote", {name: me});
    if (act === "costs") { sel = id; ls.set("trip-opt", sel); renderAll(); showTab("costs"); window.scrollTo({top: 0}); }
    if (act === "final") saveTrip({chosen: trip.chosen === id ? "" : id});
    if (act === "del") {
      if (b.dataset.confirm) run("DELETE", "options/" + encodeURIComponent(id));
      else { b.dataset.confirm = "1"; b.textContent = "Tap again: deletes its costs too"; setTimeout(()=>{ if(b.isConnected){ delete b.dataset.confirm; b.textContent="Delete"; } }, 3500); }
    }
  });

  // ---------- render: costs for one option ----------
  function renderCosts(){
    const o = focusOption();
    $("#optSel").innerHTML = options.length
      ? options.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${trip.chosen === x.id ? " (final pick)" : ""}</option>`).join("")
      : `<option value="">No trip options yet</option>`;
    $("#optSel").value = o ? o.id : "";
    $("#itemForm").hidden = !o;
    $("#itemFormTitle").textContent = o ? "Add a cost to " + o.name : "Add a cost";
    const t = o ? totals(o.id) : totals("");
    $("#kTotal").textContent = money(t.all);
    $("#kBooked").textContent = money(t.booked); $("#kBookedS").textContent = `${t.nb} item${t.nb===1?"":"s"}`;
    $("#kIdeas").textContent = money(t.ideas); $("#kIdeasS").textContent = `${t.ni} item${t.ni===1?"":"s"}`;
    if (trip.budgetPP > 0) {
      const r = t.pp / trip.budgetPP;
      $("#kBudget").textContent = money(trip.budgetPP);
      $("#kMeter").style.width = Math.min(r*100,100)+"%";
      $("#kMeter").classList.toggle("over", r>1);
      $("#kBudgetS").textContent = r>1 ? `${money(t.pp-trip.budgetPP)} over` : `${money(trip.budgetPP-t.pp)} left`;
    } else { $("#kBudget").textContent = "—"; $("#kMeter").style.width="0%"; $("#kBudgetS").textContent = "Set it in Setup"; }
    const cats = CAT_KEYS.filter(k => t.byCat[k] > 0);
    $("#catbar").innerHTML = t.all ? cats.map(k => `<i style="width:${t.byCat[k]/t.all*100}%;background:${CATS[k].c}" title="${CATS[k].n}"></i>`).join("") : "";
    $("#legend").innerHTML = t.all ? cats.map(k => `<span><i style="background:${CATS[k].c}"></i>${CATS[k].n} <span class="mono">${money(t.byCat[k]/N())}</span>/pp</span>`).join("") : `<span>Add costs to see the breakdown.</span>`;
    renderItems();
  }

  function renderItems(){
    if (!loaded) return;
    const o = focusOption();
    if (!o) { $("#items").innerHTML = `<div class="empty">Add a trip option in the Options tab first.</div>`; return; }
    let list = itemsFor(o.id);
    const count = list.length;
    if (filter==="idea"||filter==="booked") list = list.filter(i => i.status===filter);
    if (filter==="votes") list.sort((a,b) => (b.votes||[]).length - (a.votes||[]).length);
    else list.sort((a,b) => (CAT_KEYS.indexOf(a.category) - CAT_KEYS.indexOf(b.category)) || ((b.created||0)-(a.created||0)));
    if (!list.length) { $("#items").innerHTML = `<div class="empty">${count ? "Nothing in this filter." : "No costs for this option yet. Add flights, a place to stay, or an activity above."}</div>`; return; }
    $("#items").innerHTML = list.map(it => {
      const cat = CATS[it.category] || CATS.other, v = it.votes||[], mine = me && v.includes(me), t = total(it);
      return `<div class="item" data-id="${esc(it.id)}">
        <i class="dot" style="background:${cat.c}"></i>
        <div class="t">${esc(it.title)}</div>
        <div class="price">${money(t)}<small>${money(t/N())} /pp</small></div>
        <div class="meta">
          <span class="pill ${it.status==="booked"?"booked":"idea"}">${it.status==="booked"?"Booked":"Idea"}</span>
          <span>${cat.n}</span>
          ${it.basis==="person" ? `<span class="mono">${money(+it.amount,2)} each</span>` : ""}
          ${it.paidBy ? `<span>Paid by ${esc(it.paidBy)}</span>` : ""}
          ${it.url && /^https?:\/\//i.test(it.url) ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">Link</a>` : ""}
          <button class="vote ${mine?"on":""}" data-act="vote" ${!me?"disabled":""} aria-label="Like this cost">▲ ${v.length}</button>
          <button class="btn ghost" data-act="toggle">${it.status==="booked"?"Mark idea":"Mark booked"}</button>
          <button class="btn ghost" data-act="del">Delete</button>
        </div></div>`;
    }).join("");
  }

  // ---------- render: itinerary + settle ----------
  function renderDays(){
    if (!loaded) return;
    if (!days.length) { $("#days").innerHTML = `<div class="empty">No plans yet. Add the first day above.</div>`; return; }
    const base = decided() || focusOption();
    const g = {};
    days.forEach(d => (g[d.date] = g[d.date] || []).push(d));
    $("#days").innerHTML = Object.keys(g).sort().map(k => {
      const x = new Date(k+"T12:00:00");
      let dn = "";
      if (base && base.start) { const n = Math.round((x - new Date(base.start+"T12:00:00"))/864e5)+1; if (n>0) dn = "Day "+n; }
      const rows = g[k].sort((a,b)=>(a.time||"99").localeCompare(b.time||"99"));
      return `<div class="day"><div class="d">${x.toLocaleDateString(undefined,{month:"short",day:"numeric"})}<small>${dn || x.toLocaleDateString(undefined,{weekday:"short"})}</small></div>
        <ul>${rows.map(r => `<li><span class="tm">${esc(r.time||"—")}</span><span class="tx">${esc(r.text)}</span><button class="btn ghost" data-del-day="${esc(r.id)}" aria-label="Remove">×</button></li>`).join("")}</ul></div>`;
    }).join("");
    $("#days").querySelectorAll("[data-del-day]").forEach(b => b.onclick = () => run("DELETE", "days/" + encodeURIComponent(b.dataset.delDay)));
  }

  function renderSettle(){
    const crew = trip.crew, paid = {}, share = {}, o = decided() || focusOption();
    $("#settleHint").textContent = o
      ? `For "${o.name}"${decided() ? "" : " (not the final pick yet)"}. Uses booked costs that have a "Paid by" name, split evenly across the crew.`
      : "Add a trip option first.";
    crew.forEach(c => { paid[c]=0; share[c]=0; });
    let any = false;
    (o ? itemsFor(o.id) : []).filter(i => i.status==="booked" && i.paidBy && crew.includes(i.paidBy)).forEach(i => {
      any = true; const t = total(i); paid[i.paidBy] += t; crew.forEach(c => share[c] += t/crew.length);
    });
    $("#balBody").innerHTML = crew.length ? crew.map(c => { const b = paid[c]-share[c];
      return `<tr><td>${esc(c)}</td><td class="n">${money(paid[c],2)}</td><td class="n">${money(share[c],2)}</td><td class="n ${b>0.005?"pos":b<-0.005?"neg":""}">${b>0?"+":""}${money(b,2)}</td></tr>`; }).join("")
      : `<tr><td colspan="4" class="hint">Add the crew in Setup.</td></tr>`;
    if (!any) { $("#transfers").innerHTML = `<div class="empty">Nothing to settle yet. Mark a cost as booked and set who paid.</div>`; return; }
    const cred = [], debt = [];
    crew.forEach(c => { const b = Math.round((paid[c]-share[c])*100)/100; if (b>0) cred.push([c,b]); else if (b<0) debt.push([c,-b]); });
    cred.sort((a,b)=>b[1]-a[1]); debt.sort((a,b)=>b[1]-a[1]);
    const out = []; let i=0, j=0;
    while (i<debt.length && j<cred.length) {
      const amt = Math.min(debt[i][1], cred[j][1]);
      if (amt >= 0.01) out.push(`<div class="transfer"><b>${esc(debt[i][0])}</b> pays <b>${esc(cred[j][0])}</b><span style="flex:1"></span><span class="mono" style="font-weight:600">${money(amt,2)}</span></div>`);
      debt[i][1]-=amt; cred[j][1]-=amt;
      if (debt[i][1] < 0.01) i++;
      if (cred[j][1] < 0.01) j++;
    }
    $("#transfers").innerHTML = out.join("") || `<div class="empty">Everyone is even.</div>`;
  }

  function renderAll(){ renderHeader(); renderOptions(); renderCosts(); renderDays(); renderSettle(); renderPriceLinks(); }

  // ---------- actions ----------
  function saveTrip(patch){ trip = {...trip, ...patch}; renderAll(); return run("PUT", "trip", trip); }
  $("#meSel").onchange = e => { me = e.target.value; ls.set("trip-me", me); renderAll(); };
  $("#tripForm").onsubmit = e => { e.preventDefault();
    saveTrip({name:$("#tName").value.trim(), currency:$("#tCur").value, budgetPP:+$("#tBudget").value||0});
    $("#tripMsg").textContent = "Saved"; setTimeout(()=>$("#tripMsg").textContent="",1500);
  };
  $("#crewForm").onsubmit = e => { e.preventDefault();
    const n = $("#cName").value.trim(); if (!n || trip.crew.includes(n)) return;
    $("#cName").value = ""; saveTrip({crew:[...trip.crew, n]});
  };
  $("#optForm").onsubmit = async e => { e.preventDefault();
    const o = {name:$("#oName").value.trim(), destination:$("#oDest").value.trim(), start:$("#oStart").value, end:$("#oEnd").value, notes:$("#oNotes").value.trim()};
    if (!o.name || !o.destination) return;
    const made = await run("POST", "options", o);
    if (made) { $("#optForm").reset(); $("#optDetails").open = false; }
  };
  $("#itemForm").onsubmit = async e => { e.preventDefault();
    const o = focusOption(); if (!o) return;
    const amt = parseFloat($("#iAmount").value);
    if (!$("#iTitle").value.trim() || !(amt >= 0)) return;
    $("#addBtn").disabled = true;
    await run("POST", "items", { optionId:o.id, title:$("#iTitle").value.trim(), category:$("#iCat").value, amount:amt, basis:$("#iBasis").value,
      status:$("#iStatus").value, paidBy:$("#iPaid").value, url:$("#iUrl").value.trim() });
    $("#addBtn").disabled = false;
    $("#itemForm").reset(); renderPriceLinks();
  };
  $("#items").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest(".item").dataset.id, it = items.find(x => x.id===id); if (!it) return;
    const path = "items/" + encodeURIComponent(id);
    if (b.dataset.act==="vote" && me) run("POST", path + "/vote", {name: me});
    if (b.dataset.act==="toggle") run("PATCH", path, {status: it.status==="booked"?"idea":"booked"});
    if (b.dataset.act==="del") {
      if (b.dataset.confirm) run("DELETE", path);
      else { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; setTimeout(()=>{ if(b.isConnected){ delete b.dataset.confirm; b.textContent="Delete"; } }, 3000); }
    }
  });
  $("#dayForm").onsubmit = async e => { e.preventDefault();
    const d = {date:$("#dDate").value, time:$("#dTime").value, text:$("#dText").value.trim()};
    if (!d.date || !d.text) return;
    await run("POST", "days", d);
    $("#dText").value = ""; $("#dTime").value = "";
  };

  // ---------- start + live refresh ----------
  renderAll();
  refresh();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (!typing) refresh();
  }, 10000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
