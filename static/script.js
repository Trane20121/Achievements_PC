// Copyright (c) 2026 Trane2012
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// ─────────────────────────────────────────────
//  CONFIG & TRANSLATIONS
// ─────────────────────────────────────────────
const API = "/api";
let translations = {}; // popolato da loadTranslations()
let currentLang = localStorage.getItem("st_lang") || "it";

// mappa globale dei codici tra il tuo lang.json e i valori accettati da Steam
const steamLangMap = {
  it: "italian",
  en: "english",
  fr: "french",
  de: "german",
  es: "spanish",
  pt: "portuguese",
  ru: "russian",
  zh: "schinese",
  jp: "japanese",
  ko: "korean",
  da: "danish",
  nl: "dutch",
  fi: "finnish",
  no: "norwegian",
  pl: "polish",
  sv: "swedish",
  th: "thai",
  tr: "turkish",
  uk: "ukrainian",
  hu: "hungarian",
  cs: "czech",
  ro: "romanian",
  bg: "bulgarian",
  el: "greek",
  sk: "slovak",
  hr: "croatian",
  lt: "lithuanian",
  lv: "latvian",
  et: "estonian",
  sr: "serbian",
  ca: "catalan",
  id: "indonesian",
  ms: "malay",
  vi: "vietnamese",
  tl: "filipino",
};

// loadTranslations: solo una fetch, timeout e nessun fallback incorporato
async function loadTranslations() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
  try {
    const res = await fetch("/static/lang.json", {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json && typeof json === "object") {
      translations = json;
      return;
    }
    throw new Error("Invalid JSON");
  } catch (e) {
    clearTimeout(timeout);
    console.error("loadTranslations failed:", e);
    translations = {};
  }
}

// ─────────────────────────────────────────────
// THEME TOGGLE
// ─────────────────────────────────────────────
function toggleTheme() {
  const current = document.body.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  document.body.setAttribute("data-theme", next);
  localStorage.setItem("st_theme", next);
  // update button visual state
  const btn = document.getElementById("themeBtn");
  if (btn) {
    btn.classList.toggle("on", next === "light");
    btn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
  }
}

// apply saved theme on load (if present) and sync button
(function applySavedTheme() {
  const savedTheme = localStorage.getItem("st_theme");
  if (savedTheme) {
    document.body.setAttribute("data-theme", savedTheme);
    const btn = document.getElementById("themeBtn");
    if (btn) btn.classList.toggle("on", savedTheme === "light");
  }
})();

// ─────────────────────────────────────────────
//  HEARTBEAT
// ─────────────────────────────────────────────
(function () {
  const HEARTBEAT_MS = 10000;
  const ping = () =>
    fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
  ping();
  setInterval(ping, HEARTBEAT_MS);
})();

// ─────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────
let allGames = [];
let currentPage = 0;
let fetchController = null;
let cachedSummaries = {}; // appid -> { u, t }
let renderScheduled = false;

// Filters (playtime max 200 = "200+")
let playtimeRange = { min: 0, max: 200 };
let filterCompleted = false;
let filterInProgress = false;
let filterStatus = new Set(["completed", "inprogress", "noach"]);
let lastPlayedFilter = "all";
let yearRange = { min: 1990, max: new Date().getFullYear() };
let genreFilter = "all";
let filterInstall = "all";
let filterPrice = "all";

// debounce utility
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// ─────────────────────────────────────────────
//  DATE FORMAT HELPERS
// ─────────────────────────────────────────────
const _dtfCache = new Map();
function getDateFormatter(locale) {
  if (_dtfCache.has(locale)) return _dtfCache.get(locale);
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  _dtfCache.set(locale, fmt);
  return fmt;
}
function formatDateByLocale(dateStr, locale) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return getDateFormatter(locale).format(d);
}
function updateAchievementUnlockDates(locale) {
  document.querySelectorAll(".ach-date[data-unlock-date]").forEach((n) => {
    n.textContent = formatDateByLocale(n.dataset.unlockDate, locale);
  });
}

// ─────────────────────────────────────────────
//  UI TRANSLATIONS
// ─────────────────────────────────────────────
function applyTranslations() {
  const t = translations[currentLang] || {};

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const txt = t[key];
    if (typeof txt === "string") {
      el.textContent = txt;
    }
  });

  const sortLabel = document.querySelector('label[for="sortSelect"]');
  if (sortLabel && t.sort_label) sortLabel.textContent = t.sort_label;

  const search = document.getElementById("search");
  if (search && t.search_placeholder) search.placeholder = t.search_placeholder;

  updatePageInfoUI();

  const titleNode = document.querySelector('title[data-i18n="title"]');
  if (titleNode && t.title) document.title = t.title;
}

// Force re-apply translations & date formatting
function translatePage() {
  applyTranslations();
  updateAchievementUnlockDates(currentLang);
  updateCompletionBar(); // assicurati che la descrizione sotto la barra venga aggiornata
}

// ─────────────────────────────────────────────
//  SLIDERS
// ─────────────────────────────────────────────
function initPlaytimeSlider() {
  const sliderEl = document.getElementById("playtimeSlider");
  const labelEl = document.getElementById("playtimeRangeLabel");
  if (!sliderEl || !window.noUiSlider) return;
  if (sliderEl.noUiSlider) {
    try {
      sliderEl.noUiSlider.destroy();
    } catch (e) {}
  }
  noUiSlider.create(sliderEl, {
    start: [playtimeRange.min || 0, playtimeRange.max || 200],
    connect: true,
    range: { min: 0, max: 200 },
    step: 1,
    tooltips: false,
  });
  sliderEl.noUiSlider.on("update", (vals) => {
    const lo = Math.round(vals[0]);
    const hi = Math.round(vals[1]);
    playtimeRange.min = lo;
    playtimeRange.max = hi;
    const t = translations[currentLang] || {};
    const hS = t.hour_short || "h";
    const p200 = t.playtime_200_plus || "200h+";
    if (labelEl)
      labelEl.textContent = `${lo}${hS} - ${hi >= 200 ? p200 : hi + hS}`;
  });
  sliderEl.noUiSlider.on("change", () => {
    currentPage = 0;
    scheduleRender();
  });
}

function initYearSlider() {
  const sliderEl = document.getElementById("yearSlider");
  const labelEl = document.getElementById("yearRangeLabel");
  if (!sliderEl || !window.noUiSlider) return;
  const currentYear = new Date().getFullYear();
  if (sliderEl.noUiSlider) {
    try {
      sliderEl.noUiSlider.destroy();
    } catch (e) {}
  }
  noUiSlider.create(sliderEl, {
    start: [1990, currentYear],
    connect: true,
    range: { min: 1990, max: currentYear },
    step: 1,
    tooltips: false,
  });
  sliderEl.noUiSlider.on("update", (vals) => {
    const lo = Math.round(vals[0]),
      hi = Math.round(vals[1]);
    yearRange.min = lo;
    yearRange.max = hi;
    if (labelEl) labelEl.textContent = `${lo} - ${hi}`;
  });
  sliderEl.noUiSlider.on("change", () => {
    currentPage = 0;
    scheduleRender();
  });
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatHours(minutes) {
  const h = Math.floor((minutes || 0) / 60);
  const m = (minutes || 0) % 60;
  const t = translations[currentLang] || {};
  const hS = t.hour_short || "h";
  const mS = t.minute_short || "m";
  if (h === 0) return `${m}${mS}`;
  if (m === 0) return `${h}${hS}`;
  return `${h}${hS} ${m}${mS}`;
}

function getCompletionPct(appid) {
  const s = cachedSummaries[appid];
  if (!s || s.t === 0) return null;
  return Math.round((s.u / s.t) * 100);
}

// Normalizza stringa per matching robusto (rimuove diacritici, whitespace e caratteri non alfanumerici)
function normalizeKey(s) {
  if (!s && s !== 0) return "";
  try {
    return String(s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove diacritics
      .toLowerCase()
      .replace(/[\s\-\_]+/g, "") // remove spaces/underscores/dashes
      .replace(/[^a-z0-9]/g, ""); // keep alphanum
  } catch (e) {
    return String(s).toLowerCase().replace(/\s+/g, "");
  }
}

// ─────────────────────────────────────────────
//  FILTER BADGE
// ─────────────────────────────────────────────
function updateFilterBadge() {
  const badge = document.getElementById("activeFiltersBadge");
  if (!badge) return;
  let count = 0;
  if (filterStatus.size < 3) count++;
  if (playtimeRange.min > 0 || playtimeRange.max < 200) count++;
  if (filterCompleted || filterInProgress) count++;
  if (lastPlayedFilter !== "all") count++;
  const currentYear = new Date().getFullYear();
  if (yearRange.min > 1990 || yearRange.max < currentYear) count++;
  if (genreFilter !== "all") count++;
  if (filterInstall !== "all") count++;
  if (filterPrice !== "all") count++;

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

// ─────────────────────────────────────────────
//  FETCH GAMES FILTERED (server-side)
// ─────────────────────────────────────────────
async function fetchGamesFiltered(
  filters = {},
  page = 1,
  per_page = 50,
  sort_by = "played",
) {
  const resp = await fetch("/api/games_filtered", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters, page, per_page, sort_by }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "<​​​​​​​no body>");
    throw new Error(`Fetch games_filtered failed ${resp.status} - ${txt}`);
  }
  return await resp.json();
}

// ─────────────────────────────────────────────
//  RENDER (server-driven) - usato per filtrare via server
// ─────────────────────────────────────────────
async function render() {
  const pageSize = parseInt(document.getElementById("maxGames")?.value) || 40;
  const term = (document.getElementById("search")?.value || "").toLowerCase();
  const sortBy = document.getElementById("sortSelect")?.value || "played";

  const filters = {};
  if (filterStatus.size < 3)
    filters.achievement_status = Array.from(filterStatus);
  if (playtimeRange.min > 0 || playtimeRange.max < 200) {
    filters.playtime_min = playtimeRange.min;
    filters.playtime_max = playtimeRange.max;
  }
  filters.completed = filterCompleted;
  filters.in_progress = filterInProgress;
  if (lastPlayedFilter !== "all") {
    filters.last_played_days =
      lastPlayedFilter === "never" ? -1 : parseInt(lastPlayedFilter);
  }
  const currentYear = new Date().getFullYear();
  if (yearRange.min > 1990 || yearRange.max < currentYear) {
    filters.min_year = yearRange.min;
    filters.max_year = yearRange.max;
  }
  if (genreFilter !== "all") filters.genre = genreFilter;
  if (filterInstall !== "all") filters.installed = filterInstall;
  if (filterPrice !== "all") filters.is_free = filterPrice === "free";
  if (term) filters.query = term;

  try {
    const data = await fetchGamesFiltered(
      filters,
      currentPage + 1,
      pageSize,
      sortBy,
    );
    allGames = data.results || [];
    window.pageInfoData = {
      current: data.page,
      total: Math.max(1, Math.ceil(data.total / data.per_page)),
    };
    updatePageInfoUI();
    updateFilterBadge();
    renderGameCards(allGames);

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    fetchDetails(allGames, fetchController.signal);
  } catch (e) {
    console.error("render error:", e);
  }
}

// ─────────────────────────────────────────────
//  RENDER IMMEDIATE FROM LOCAL (mostra subito le card)
// ─────────────────────────────────────────────
function renderImmediateFromLocal(page = 0, pageSize = 40, sortBy = "played") {
  const arr = [...allGames];
  if (sortBy === "played")
    arr.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
  else if (sortBy === "name")
    arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (sortBy === "name_desc")
    arr.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
  else if (sortBy === "completion")
    arr.sort(
      (a, b) =>
        (getCompletionPct(b.appid) || 0) - (getCompletionPct(a.appid) || 0),
    );
  else if (sortBy === "completion_asc")
    arr.sort(
      (a, b) =>
        (getCompletionPct(a.appid) || 0) - (getCompletionPct(b.appid) || 0),
    );

  const start = page * pageSize;
  const pageSlice = arr.slice(start, start + pageSize);
  window.pageInfoData = {
    current: page + 1,
    total: Math.max(1, Math.ceil(arr.length / pageSize)),
  };
  updatePageInfoUI();
  updateFilterBadge();

  renderGameCards(pageSlice);

  if (fetchController) fetchController.abort();
  fetchController = new AbortController();
  fetchDetails(pageSlice, fetchController.signal);
}

// ─────────────────────────────────────────────
//  RENDER CARDS
// ─────────────────────────────────────────────
function renderGameCards(games) {
  const frag = document.createDocumentFragment();
  const t = translations[currentLang] || {};
  const placeholderText = encodeURIComponent(t.no_image || "No image");
  const hS = t.hour_short || "h";

  games.forEach((g, i) => {
    const s = cachedSummaries[g.appid];
    const hasAch = s && s.t > 0;
    const pct = hasAch ? Math.round((s.u / s.t) * 100) : 0;
    const isCompleted = hasAch && pct >= 100;
    const isNoAch = !hasAch;

    const card = document.createElement("div");
    card.className =
      "card" +
      (isCompleted ? " completed" : "") +
      (isNoAch ? " no-achievements" : "");
    card.style.animationDelay = `${i * 20}ms`;
    card.onclick = () => openPop(g);

    card.innerHTML =
      `  
  <div class="badge-completed" data-i18n="completed_badge" style="display:${isCompleted ? "block" : "none"}">` +
      escapeHtml(t.completed_badge || "COMPLETED") +
      `</div>  
  <div class="img-container">  
    <img src="${escapeHtml(g.img || "")}" alt="${escapeHtml(g.name || "")}" loading="lazy" onerror="this.src='https://placehold.co/460x215/1b2838/66c0f4?text=${placeholderText}'">  
  </div>  
  <div class="card-info">  
    <div class="title">${escapeHtml(g.name || "")}</div>  
    <div class="meta">  
      <span>⏱ ${formatHours(g.playtime || 0)}</span>  
      <span>${hasAch ? `🏆 ${s.u}/${s.t}` : escapeHtml(t.no_achievements || "—")}</span>  
    </div>  
    <div class="prog-bg"><div class="prog-fill" style="width:${isNoAch ? 100 : pct}%"></div></div>  
  </div>`;
    frag.appendChild(card);
  });

  const list = document.getElementById("list");
  if (list) {
    list.innerHTML = "";
    list.appendChild(frag);
  }
  applyTranslations();
}

// ─────────────────────────────────────────────
//  FETCH DETAILS (achievements bulk) - in background
// ─────────────────────────────────────────────
async function fetchDetails(games, signal) {
  const appids = games.map((g) => g.appid).filter(Boolean);
  if (!appids.length) return;
  try {
    const res = await fetch(`${API}/steam/achievements_bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appids }),
      signal,
    });
    if (!res.ok) throw new Error("achievements_bulk failed");
    const data = await res.json();
    let changed = false;
    for (const [appid, summary] of Object.entries(data)) {
      if (
        !cachedSummaries[appid] ||
        cachedSummaries[appid].u !== summary.u ||
        cachedSummaries[appid].t !== summary.t
      ) {
        cachedSummaries[appid] = summary;
        changed = true;
      }
    }
    if (changed) {
      renderImmediateFromLocal(
        currentPage,
        parseInt(document.getElementById("maxGames")?.value) || 40,
        document.getElementById("sortSelect")?.value || "played",
      );
      // aggiorna la barra con i giochi correnti come riferimento
      updateCompletionBar();
    } else {
      updateCompletionBar();
    }
  } catch (e) {
    if (e.name !== "AbortError") console.error("fetchDetails error:", e);
  }
}

// ─────────────────────────────────────────────
//  PREFETCH ALL ACHIEVEMENTS (background, batched)
// ─────────────────────────────────────────────
async function prefetchAllAchievements() {
  const BATCH = 40;
  const missing = allGames
    .map((g) => g.appid)
    .filter((id) => id && !cachedSummaries[id]);
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    try {
      const res = await fetch(`${API}/steam/achievements_bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appids: batch }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const [appid, summary] of Object.entries(data))
        cachedSummaries[appid] = summary;
      // aggiorna usando tutti i giochi correnti
      updateCompletionBar();
    } catch (e) {
      console.warn("prefetch batch error:", e);
    }
  }
}

// ─────────────────────────────────────────────
//  COMPLETION BAR
// ─────────────────────────────────────────────
function updateCompletionBar(considerAppids) {
  const t = translations[currentLang] || {};
  // costruisci set di appid da considerare
  let appidList;
  if (Array.isArray(considerAppids) && considerAppids.length > 0) {
    appidList = considerAppids;
  } else {
    appidList = allGames.map((g) => g.appid).filter(Boolean);
  }
  const appidSet = new Set(appidList);

  let totalRatio = 0;
  let count = 0;
  for (const appid of appidSet) {
    const s = cachedSummaries[appid];
    if (s && s.t > 0) {
      totalRatio += s.u / s.t;
      count++;
    }
  }

  // percentuale come media delle frazioni (u/t) arrotondata
  const pct = count === 0 ? 0 : Math.round((totalRatio / count) * 100);

  const bar = document.getElementById("completionBar");
  const bg = document.getElementById("completionBarBg");
  const pctEl = document.getElementById("completionPercent");
  const textEl = document.getElementById("completionText");

  if (bar) {
    if (count === 0) {
      bar.classList.add("loading");
      bar.style.width = "0%";
      bar.style.height = "8px";
    } else {
      bar.classList.remove("loading");
      bar.style.width = pct + "%";
      bar.style.height = "8px";
    }
  }
  if (bg) {
    bg.classList.remove("loading");
    bg.classList.add("expanded");
    bg.style.width = "100%";
  }
  if (pctEl) pctEl.classList.toggle("hidden", count === 0);

  const descTemplate =
    t.avg_completion_desc || "{percent}% ({count} giochi analizzati)";
  const desc = descTemplate.replace("{percent}", pct).replace("{count}", count);

  if (textEl) textEl.textContent = desc;
}

// ─────────────────────────────────────────────
//  OPEN POPUP (dettagli gioco) - non bloccare UI
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  OPEN POPUP (dettagli gioco) - non bloccare UI
// ─────────────────────────────────────────────
async function openPop(g) {
  const overlay = document.getElementById("overlay");
  const popup = document.getElementById("popup");
  const content = document.getElementById("popup-content");
  if (overlay) overlay.style.display = "block";
  if (popup) popup.style.display = "flex";

  if (content) {
    content.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px; gap:15px;">
        <div class="sp"></div>
        <div style="color:var(--muted); font-size:0.9em; font-weight:500;">Caricamento obiettivi...</div>
      </div>`;
  }

  try {
    const t = translations[currentLang] || {};
    const labelAch = t.achievements_label || "obiettivi";
    const labelUnlocked = t.unlocked_label || "Sbloccati";
    const labelLocked = t.locked_label || "Bloccati";
    const labelNoAch = t.no_achievements || "Nessun obiettivo disponibile";
    const showGlobalLabel = t.show_global_label || "Mostra % globale";
    const globalNotAvailable = t.global_not_available || "N/D";
    const closeLabel = t.close || "Chiudi";

    const steamLang = steamLangMap[currentLang] || "english";

    const [schemaRes, playerRes, globalRes] = await Promise.allSettled([
      fetch(`${API}/steam/schema/${g.appid}?l=${steamLang}`),
      fetch(`${API}/steam/player_achievements/${g.appid}?l=${steamLang}`),
      fetch(`${API}/steam/global_ach/${g.appid}`),
    ]);

    const schema =
      schemaRes.status === "fulfilled" && schemaRes.value.ok
        ? (await schemaRes.value.json()).achievements || []
        : [];
    const playerMap =
      playerRes.status === "fulfilled" && playerRes.value.ok
        ? (await playerRes.value.json()).achievements || {}
        : {};
    const globalMap =
      globalRes.status === "fulfilled" && globalRes.value.ok
        ? (await globalRes.value.json()).percentages || {}
        : {};

    const globalIndex = new Map();
    for (const [k, v] of Object.entries(globalMap)) {
      globalIndex.set(normalizeKey(k), Number(v));
    }

    let html = `
      <div class="pop-header" style="margin-bottom:24px;">
        <h2 style="margin:0; font-size:1.6em; color:#fff; letter-spacing:-0.5px;">${escapeHtml(g.name)}</h2>
        <div style="display:flex; gap:15px; margin-top:8px; font-size:0.85em; color:var(--muted); font-weight:500;">
          <span>⏱ ${formatHours(g.playtime || 0)}</span>
          <span>🆔 ${g.appid}</span>
        </div>
      </div>`;

    if (!schema.length) {
      html += `<div style="padding:40px; text-align:center; color:var(--muted); background:rgba(255,255,255,0.03); border-radius:12px;">${escapeHtml(labelNoAch)}</div>`;
    } else {
      const achieved = schema.filter((a) => playerMap[a.name]?.achieved === 1);
      const notAchieved = schema.filter(
        (a) => playerMap[a.name]?.achieved !== 1,
      );
      const pct = Math.round((achieved.length / schema.length) * 100);

      html += `
        <div style="background:rgba(255,255,255,0.03); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.05); margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-weight:600; font-size:0.95em; color:var(--blue);">🏆 ${achieved.length} / ${schema.length} ${labelAch}</span>
            <span style="font-weight:bold; color:#fff;">${pct}%</span>
          </div>
          <div style="height:8px; background:rgba(255,255,255,0.1); border-radius:10px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #4fc3f7, #2196f3); box-shadow: 0 0 10px rgba(33,150,243,0.4); transition: width 0.5s ease;"></div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px; padding:0 5px;">
          <input id="showGlobalPct" type="checkbox" class="modern-checkbox" />
          <label for="showGlobalPct" style="font-size:0.85em; color:var(--muted); cursor:pointer; user-select:none;">${showGlobalLabel}</label>
        </div>`;

      const renderAch = (list, done) =>
        list
          .map((a) => {
            const norm = normalizeKey(a.name || a.apiname || "");
            const globalPct = globalIndex.has(norm)
              ? globalIndex.get(norm)
              : null;

            let rarityColor = "#888";
            if (globalPct !== null) {
              if (globalPct < 10) rarityColor = "#f44336";
              else if (globalPct < 25) rarityColor = "#ff9800";
              else if (globalPct < 50) rarityColor = "#2196f3";
            }

            const icon = done ? a.icon : a.icongray || a.icon;
            const unlockTime =
              done && playerMap[a.name]?.unlocktime
                ? playerMap[a.name].unlocktime * 1000
                : null;

            return `
          <div class="ach-card" style="display:flex; gap:16px; background:rgba(255,255,255,0.02); padding:14px; border-radius:12px; margin-bottom:12px; border:1px solid rgba(255,255,255,0.04); transition: transform 0.2s ease;">
            <div style="position:relative; flex-shrink:0;">
              <img src="${icon}" style="width:54px; height:54px; border-radius:8px; filter:${done ? "none" : "grayscale(1) opacity(0.6)"}; border:1px solid rgba(255,255,255,0.1);">
              ${done ? '<div style="position:absolute; bottom:-4px; right:-4px; background:#4caf50; border-radius:50%; width:16px; height:16px; display:flex; align-items:center; justify-content:center; font-size:10px; border:2px solid #1a1a1a;">✓</div>' : ""}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:600; color:${done ? "#fff" : "#aaa"}; font-size:0.95em; margin-bottom:2px;">${escapeHtml(a.displayName || a.name)}</div>
              <div style="font-size:0.82em; color:var(--muted); line-height:1.4; margin-bottom:8px;">${escapeHtml(a.description || "")}</div>
              
              <div class="ach-footer-info" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <!-- Solo questa parte viene nascosta dalla checkbox -->
                <div class="global-stats-wrapper" style="display:flex; align-items:center; gap:8px;">
                  <div style="font-size:0.72em; font-weight:700; color:${rarityColor}; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:4px; border:1px solid ${rarityColor}44;">
                    🌍 ${globalPct !== null ? globalPct.toFixed(1) + "%" : globalNotAvailable}
                  </div>
                </div>
                <!-- La data rimane sempre visibile se presente -->
                ${unlockTime ? `<div style="font-size:0.72em; color:var(--muted); font-weight:500;">📅 <span class="ach-date" data-unlock-date="${new Date(unlockTime).toISOString()}"></span></div>` : ""}
              </div>
            </div>
          </div>`;
          })
          .join("");

      html += `<div id="ach-list-container" style="max-height:50vh; overflow-y:auto; padding-right:8px;">`;
      if (achieved.length) {
        html +=
          `<div style="font-size:0.75em; text-transform:uppercase; letter-spacing:1px; color:var(--blue); font-weight:800; margin:10px 0 12px 5px;">${labelUnlocked} (${achieved.length})</div>` +
          renderAch(achieved, true);
      }
      if (notAchieved.length) {
        html +=
          `<div style="font-size:0.75em; text-transform:uppercase; letter-spacing:1px; color:var(--muted); font-weight:800; margin:25px 0 12px 5px;">${labelLocked} (${notAchieved.length})</div>` +
          renderAch(notAchieved, false);
      }
      html += `</div>`;
    }

    html += `
      <div style="margin-top:24px;">
        <button onclick="closePop()" class="pop-close-btn" style="width:100%; padding:14px; border-radius:10px; border:none; background:#333; color:#fff; font-weight:600; cursor:pointer; transition:background 0.2s;">
          ${closeLabel}
        </button>
      </div>`;

    if (content) content.innerHTML = html;

    // Reset dello scroll all'inizio
    const listContainer = document.getElementById("ach-list-container");
    if (listContainer) listContainer.scrollTop = 0;

    // Logica Checkbox (nasconde solo la percentuale globale)
    const checkbox = document.getElementById("showGlobalPct");
    if (checkbox) {
      const setVisibility = (v) => {
        document.querySelectorAll(".global-stats-wrapper").forEach((el) => {
          el.style.display = v ? "flex" : "none";
        });
      };
      const pref = localStorage.getItem("st_show_global_pct") !== "false";
      checkbox.checked = pref;
      setVisibility(pref);
      checkbox.addEventListener("change", () => {
        setVisibility(checkbox.checked);
        localStorage.setItem("st_show_global_pct", checkbox.checked);
      });
    }

    updateAchievementUnlockDates(currentLang);
  } catch (e) {
    console.error(e);
    if (content)
      content.innerHTML = `<div style="padding:40px; text-align:center; color:#ff6b6b;">Errore nel caricamento.</div>`;
  }
}

// ─────────────────────────────────────────────
//  detectUserLang - usa steamLangMap globale
// ─────────────────────────────────────────────
function detectUserLang() {
  const nav = (
    navigator.language ||
    navigator.userLanguage ||
    "en"
  ).toLowerCase();
  const primary = nav.slice(0, 2);
  if (steamLangMap[primary]) return primary;
  const parts = nav.split("-");
  if (parts.length > 1 && steamLangMap[parts[0]]) return parts[0];
  return "en";
}

function closePop() {
  document.getElementById("overlay")?.style &&
    (document.getElementById("overlay").style.display = "none");
  document.getElementById("popup")?.style &&
    (document.getElementById("popup").style.display = "none");
}

// ─────────────────────────────────────────────
//  LOGIN / CONFIG CHECK
// ─────────────────────────────────────────────
let loginPollInterval = null;
const LOGIN_POLL_MS = 2000;

function startLoginPoll() {
  if (loginPollInterval) return;
  loginPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API}/data`, { cache: "no-store" });
      if (!res.ok) return;
      const db = await res.json();
      if (db && db.steam_id) {
        stopLoginPoll();
        hideLogin();
        loadGames().catch((e) =>
          console.error("loadGames after login error:", e),
        );
        loadProfile().catch((e) =>
          console.error("loadProfile after login error:", e),
        );
      }
    } catch (e) {
      console.debug("login poll error:", e);
    }
  }, LOGIN_POLL_MS);
}
function stopLoginPoll() {
  if (!loginPollInterval) return;
  clearInterval(loginPollInterval);
  loginPollInterval = null;
}

async function checkConfig() {
  try {
    const res = await fetch(`${API}/data`);
    if (!res.ok) {
      showLogin();
      startLoginPoll();
      return;
    }
    const db = await res.json();
    if (!db.steam_id) {
      showLogin();
      startLoginPoll();
      return;
    }
    hideLogin();
    // Carica giochi+profilo in background (per non bloccare UI)
    loadGames().catch((e) => console.error("loadGames error:", e));
    loadProfile().catch((e) => console.error("loadProfile error:", e));
  } catch (e) {
    console.error("checkConfig error:", e);
    showLogin();
    startLoginPoll();
  }
}
function showLogin() {
  document.getElementById("loginOverlay")?.style &&
    (document.getElementById("loginOverlay").style.display = "flex");
  startLoginPoll();
}
function hideLogin() {
  document.getElementById("loginOverlay")?.style &&
    (document.getElementById("loginOverlay").style.display = "none");
  stopLoginPoll();
}

// popup login postMessage handler
window.addEventListener("message", (ev) => {
  try {
    if (!ev.data || ev.data.type !== "steam_login_complete") return;
    (async () => {
      try {
        const res = await fetch(`${API}/data`, { cache: "no-store" });
        if (!res.ok) return;
        const db = await res.json();
        if (db && db.steam_id) {
          hideLogin();
          loadGames().catch((e) => console.error("loadGames error:", e));
          loadProfile().catch((e) => console.error("loadProfile error:", e));
        }
      } catch (e) {
        console.error("postMessage handler error:", e);
      }
    })();
  } catch (e) {
    console.debug("message event error:", e);
  }
});

// ─────────────────────────────────────────────
//  LOAD GAMES
// ─────────────────────────────────────────────
async function loadGames() {
  try {
    const res = await fetch(`${API}/steam/games_summary`);
    if (!res.ok) throw new Error("games_summary failed");
    const data = await res.json();
    allGames = data.games || [];

    currentPage = 0;
    populateGenreFilter();

    const pageSize = parseInt(document.getElementById("maxGames")?.value) || 40;
    const sortBy = document.getElementById("sortSelect")?.value || "played";

    // mostra SUBITO
    renderImmediateFromLocal(currentPage, pageSize, sortBy);

    // calcola ore totali (background) e aggiorna UI
    const totalH = Math.floor(
      allGames.reduce((acc, g) => acc + (g.playtime || 0), 0) / 60,
    );
    const hoursEl = document.getElementById("totalHoursValue");
    if (hoursEl) hoursEl.textContent = totalH;

    applyTranslations();

    // prefetch achievements in background (batched)
    prefetchAllAchievements().catch((e) =>
      console.warn("prefetchAllAchievements error:", e),
    );
    updateCompletionBar();
  } catch (e) {
    console.error("loadGames error:", e);
  }
}

// ─────────────────────────────────────────────
//  LOAD PROFILE
// ─────────────────────────────────────────────
async function loadProfile() {
  try {
    const res = await fetch(`${API}/steam/profile`);
    if (!res.ok) return;
    const p = await res.json();
    if (p.error) return;

    const area = document.getElementById("profileArea");
    if (!area) return;

    const stateKeys = {
      0: "state_offline",
      1: "state_online",
      2: "state_busy",
      3: "state_away",
      4: "state_snooze",
      5: "state_looking_to_play",
      6: "state_looking_to_trade",
    };

    const currentKey = stateKeys[p.personastate] || "state_offline";
    const t = translations[currentLang] || {};
    const stateText = t[currentKey] || t.state_offline || "Offline";

    area.innerHTML = `
      <a href="${p.profileurl}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:10px; text-decoration:none; color:inherit;">
        <img src="${p.avatar}" alt="avatar" style="border-radius:50%; width:32px; height:32px;">
        <div style="text-align:left;">
          <div class="profile-name" style="font-weight:bold; font-size:0.9em;">${escapeHtml(p.persona_name)}</div>
          <div class="profile-state" data-i18n="${currentKey}" style="font-size:0.8em; color:var(--muted);">${escapeHtml(stateText)}</div>
        </div>
      </a>
      <div class="profile-links" style="margin-left:10px;">
        <span class="logout-link" onclick="logout()" data-i18n="logout" style="cursor:pointer; font-size:0.8em; color:var(--blue); text-decoration:underline;">
          ${t.logout || "Logout"}
        </span>
      </div>
    `;
  } catch (e) {
    console.error("loadProfile error:", e);
  }
}

async function logout() {
  try {
    await fetch(`${API}/steam/logout`, { method: "POST" });
  } catch (e) {}
  allGames = [];
  cachedSummaries = {};
  document.getElementById("list")?.remove();
  document.getElementById("profileArea") &&
    (document.getElementById("profileArea").innerHTML = "");
  showLogin();
}

// ─────────────────────────────────────────────
//  RESET FILTERS
// ─────────────────────────────────────────────
function resetFilters() {
  filterCompleted = false;
  filterInProgress = false;
  document.getElementById("btnCompleted")?.classList.remove("active");
  document.getElementById("btnInProgress")?.classList.remove("active");
  document.querySelectorAll(".filter-status").forEach((cb) => {
    if (cb.checked) cb.checked = true;
  });
  filterStatus = new Set(["completed", "inprogress", "noach"]);
  const slider = document.getElementById("playtimeSlider");
  if (slider?.noUiSlider) slider.noUiSlider.set([0, 200]);
  playtimeRange = { min: 0, max: 200 };
  const currentYear = new Date().getFullYear();
  const yearSlider = document.getElementById("yearSlider");
  if (yearSlider?.noUiSlider) yearSlider.noUiSlider.set([1990, currentYear]);
  yearRange = { min: 1990, max: currentYear };
  document.getElementById("genreFilter") &&
    (document.getElementById("genreFilter").value = "all");
  genreFilter = "all";
  document
    .querySelectorAll(".filter-install")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.filter-install[data-value="all"]`)
    ?.classList.add("active");
  filterInstall = "all";
  document
    .querySelectorAll(".filter-price")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.filter-price[data-value="all"]`)
    ?.classList.add("active");
  filterPrice = "all";
  document.getElementById("lastPlayedFilter") &&
    (document.getElementById("lastPlayedFilter").value = "all");
  lastPlayedFilter = "all";
  document.getElementById("sortSelect") &&
    (document.getElementById("sortSelect").value = "played");
  document.getElementById("search") &&
    (document.getElementById("search").value = "");
  currentPage = 0;
  scheduleRender();
}

// ─────────────────────────────────────────────
//  PAGE INFO
// ─────────────────────────────────────────────
function updatePageInfoUI() {
  const pageInfo = document.getElementById("pageInfo");
  if (!pageInfo) return;

  const t = translations[currentLang] || {};
  const pageLabel = t.page || "Pagina";

  if (window.pageInfoData) {
    pageInfo.textContent = `${pageLabel} ${window.pageInfoData.current}/${window.pageInfoData.total}`;
  } else {
    pageInfo.textContent = `${pageLabel} --/--`;
  }
}

// ─────────────────────────────────────────────
//  SCHEDULE RENDER
// ─────────────────────────────────────────────
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    render();
    renderScheduled = false;
  });
}

// ─────────────────────────────────────────────
//  GENRE POPULATE
// ─────────────────────────────────────────────
function populateGenreFilter() {
  const select = document.getElementById("genreFilter");
  if (!select) return;
  const set = new Set();
  allGames.forEach(
    (g) => Array.isArray(g.genres) && g.genres.forEach((x) => set.add(x)),
  );
  while (select.options.length > 1) select.remove(1);
  [...set]
    .sort((a, b) => a.localeCompare(b))
    .forEach((genre) => {
      const opt = document.createElement("option");
      opt.value = genre;
      opt.textContent = genre;
      select.appendChild(opt);
    });
}

// ─────────────────────────────────────────────
//  INIT: DOMContentLoaded
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const savedTheme = localStorage.getItem("st_theme");
    if (savedTheme) document.body.setAttribute("data-theme", savedTheme);
    const themeBtn = document.getElementById("themeBtn");
    if (themeBtn) themeBtn.classList.toggle("on", savedTheme === "light");

    // 1) Carica traduzioni (una sola fetch)
    await loadTranslations();

    // 2) Popola select lingua e applica traduzioni
    const langSelect = document.getElementById("langSelect");
    if (langSelect && translations && typeof translations === "object") {
      Object.keys(translations).forEach((lang) => {
        const opt = document.createElement("option");
        opt.value = lang;
        opt.textContent =
          translations[lang]?.language_name || lang.toUpperCase();
        if (lang === currentLang) opt.selected = true;
        langSelect.appendChild(opt);
      });
      langSelect.addEventListener("change", async (e) => {
        currentLang = e.target.value;
        localStorage.setItem("st_lang", currentLang);
        applyTranslations();
        translatePage();
        loadProfile().catch((e) => console.error("loadProfile error:", e));
        // Usa renderImmediateFromLocal per aggiornare UI senza rifare fetch
        renderImmediateFromLocal(
          currentPage,
          parseInt(document.getElementById("maxGames")?.value) || 40,
          document.getElementById("sortSelect")?.value || "played",
        );
        updateAchievementUnlockDates(currentLang);
        updateCompletionBar(); // aggiorna immediatamente testo percentuale
      });
    }

    applyTranslations();

    // 3) Init UI controls
    initPlaytimeSlider();
    initYearSlider();

    const searchEl = document.getElementById("search");
    if (searchEl)
      searchEl.addEventListener(
        "input",
        debounce(() => {
          currentPage = 0;
          scheduleRender();
        }, 300),
      );

    document.getElementById("sortSelect")?.addEventListener("change", () => {
      currentPage = 0;
      scheduleRender();
    });
    document.getElementById("maxGames")?.addEventListener("change", () => {
      currentPage = 0;
      scheduleRender();
    });

    document.getElementById("prevBtn")?.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        scheduleRender();
      }
    });
    document.getElementById("nextBtn")?.addEventListener("click", () => {
      if (window.pageInfoData && currentPage < window.pageInfoData.total - 1) {
        currentPage++;
        scheduleRender();
      }
    });

    document
      .getElementById("refreshBtn")
      ?.addEventListener("click", async () => {
        cachedSummaries = {};
        currentPage = 0;
        await loadGames();
      });

    document
      .getElementById("sidSaveBtn")
      ?.addEventListener("click", async () => {
        const sid = document.getElementById("sidInput")?.value?.trim();
        if (!sid) return;
        await fetch(`${API}/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steam_id: sid }),
        });
        hideLogin();
        loadGames().catch((e) => console.error("loadGames error:", e));
        loadProfile().catch((e) => console.error("loadProfile error:", e));
      });

    document.querySelectorAll(".filter-status").forEach((cb) =>
      cb.addEventListener("change", () => {
        filterStatus = new Set(
          Array.from(document.querySelectorAll(".filter-status:checked")).map(
            (x) => x.value,
          ),
        );
        currentPage = 0;
        scheduleRender();
      }),
    );

    document.querySelectorAll(".filter-install").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-install")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filterInstall = btn.dataset.value;
        currentPage = 0;
        scheduleRender();
      });
    });

    document.querySelectorAll(".filter-price").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-price")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filterPrice = btn.dataset.value;
        currentPage = 0;
        scheduleRender();
      });
    });

    document
      .querySelectorAll(".filter-toggle-btn[data-value]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.classList.toggle("active");
          const val = btn.dataset.value;
          if (val === "completed")
            filterCompleted = btn.classList.contains("active");
          else if (val === "inprogress")
            filterInProgress = btn.classList.contains("active");
          updateFilterStatusFromButtons();
          currentPage = 0;
          scheduleRender();
        });
      });

    document.getElementById("genreFilter")?.addEventListener("change", (e) => {
      genreFilter = e.target.value;
      currentPage = 0;
      scheduleRender();
    });

    document
      .getElementById("resetFiltersBtn")
      ?.addEventListener("click", resetFilters);

    const btnCompleted = document.getElementById("btnCompleted");
    const btnInProgress = document.getElementById("btnInProgress");
    if (btnCompleted)
      btnCompleted.classList.toggle("active", !!filterCompleted);
    if (btnInProgress)
      btnInProgress.classList.toggle("active", !!filterInProgress);
    btnCompleted?.addEventListener("click", () => {
      filterCompleted = !filterCompleted;
      btnCompleted.classList.toggle("active", filterCompleted);
      updateFilterStatusFromButtons();
      currentPage = 0;
      scheduleRender();
    });
    btnInProgress?.addEventListener("click", () => {
      filterInProgress = !filterInProgress;
      btnInProgress.classList.toggle("active", filterInProgress);
      updateFilterStatusFromButtons();
      currentPage = 0;
      scheduleRender();
    });

    function updateFilterStatusFromButtons() {
      const newStatus = new Set();
      if (filterCompleted) newStatus.add("completed");
      if (filterInProgress) newStatus.add("inprogress");
      if (!filterCompleted && !filterInProgress) newStatus.add("noach");
      filterStatus = newStatus;
    }

    // Drawer UI
    const filterToggleBtn = document.getElementById("filterToggleBtn");
    const closeFiltersBtn = document.getElementById("closeFiltersBtn");
    const filterDrawer = document.getElementById("filterDrawer");
    const filterBackdrop = document.getElementById("filterBackdrop");
    const toggleDrawer = () => {
      filterDrawer?.classList.toggle("open");
      filterBackdrop?.classList.toggle("visible");
    };
    const closeDrawer = () => {
      filterDrawer?.classList.remove("open");
      filterBackdrop?.classList.remove("visible");
    };
    filterToggleBtn?.addEventListener("click", toggleDrawer);
    closeFiltersBtn?.addEventListener("click", closeDrawer);
    filterBackdrop?.addEventListener("click", closeDrawer);

    // 4) Check config (login) - attende solo internamente, ma abbiamo già caricato traduzioni
    await checkConfig();

    // 5) Ensure initial state for install/price buttons
    const activeInstall = document.querySelector(
      `.filter-install[data-value="${filterInstall}"]`,
    );
    if (activeInstall)
      (document
        .querySelectorAll(".filter-install")
        .forEach((b) => b.classList.remove("active")),
        activeInstall.classList.add("active"));
    const activePrice = document.querySelector(
      `.filter-price[data-value="${filterPrice}"]`,
    );
    if (activePrice)
      (document
        .querySelectorAll(".filter-price")
        .forEach((b) => b.classList.remove("active")),
        activePrice.classList.add("active"));
  } catch (err) {
    console.error("init error:", err);
  }
});
