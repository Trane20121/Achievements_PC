// Copyright (c) 2026 Trane2012
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// ─────────────────────────────────────────────
//  HEARTBEAT + GOODBYE (shutdown istantaneo)
// ─────────────────────────────────────────────
(function () {
    const HEARTBEAT_MS = 10000;
    const ping = () => fetch('/api/heartbeat', { method: 'POST' }).catch(() => { });
    ping();
    setInterval(ping, HEARTBEAT_MS);

    const pageOpenTime = Date.now();
    const MIN_UPTIME_MS = 5000;

    const goodbye = () => {
        if ((Date.now() - pageOpenTime) < MIN_UPTIME_MS) return;
        navigator.sendBeacon('/api/goodbye');
    };

    window.addEventListener('pagehide', goodbye);
    window.addEventListener('beforeunload', goodbye);
})();

// ─────────────────────────────────────────────
//  STATO GLOBALE
// ─────────────────────────────────────────────
const API = "/api";
let allGames = [];
let currentPage = 0;
let translations = {};
let currentLang = localStorage.getItem('st_lang') || 'it';
let fetchController = null;
let cachedSummaries = {};       // appid -> {u, t}
let globalPercentCache = {};
let lastTotalHours = 0;

// Filtri
let filterStatus = new Set(['completed', 'inprogress', 'noach']);
let playtimeRange = { min: 0, max: 200 };
let completionRange = { min: 0, max: 100 };
let lastPlayedFilter = 'all';
let yearRange = { min: 1990, max: new Date().getFullYear() };
let genreFilter = 'all';
let filterInstall = 'all';   // 'all' | 'installed' | 'library'
let filterPrice = 'all';     // 'all' | 'free' | 'paid'

let renderScheduled = false;

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// ─────────────────────────────────────────────
//  SLIDER ORE GIOCATE
// ─────────────────────────────────────────────
function initPlaytimeSlider() {
    const sliderEl = document.getElementById('playtimeSlider');
    const labelEl = document.getElementById('playtimeRangeLabel');
    if (!window.noUiSlider || !sliderEl) return;

    noUiSlider.create(sliderEl, {
        start: [0, 200],
        connect: true,
        range: { min: 0, max: 200 },
        step: 1,
        tooltips: false
    });

    sliderEl.noUiSlider.on('update', (values) => {
        const lo = Math.round(values[0]);
        const hi = Math.round(values[1]);
        playtimeRange.min = lo;
        playtimeRange.max = hi;
        if (labelEl) labelEl.textContent = `${lo}h - ${hi >= 200 ? '200h+' : hi + 'h'}`;
    });

    sliderEl.noUiSlider.on('change', () => {
        currentPage = 0;
        scheduleRender();
    });
}

// ─────────────────────────────────────────────
//  SLIDER COMPLETAMENTO %
// ─────────────────────────────────────────────
function initCompletionSlider() {
    const completionSliderEl = document.getElementById('completionSlider');
    const labelEl = document.getElementById('completionRangeLabel');
    if (!window.noUiSlider || !completionSliderEl) return;

    noUiSlider.create(completionSliderEl, {
        start: [0, 100],
        connect: true,
        range: { min: 0, max: 100 },
        step: 1,
        tooltips: false
    });

    completionSliderEl.noUiSlider.on('update', (values) => {
        const lo = Math.round(+values[0]);
        const hi = Math.round(+values[1]);
        completionRange.min = lo;
        completionRange.max = hi;
        if (labelEl) labelEl.textContent = `${lo}% - ${hi}%`;
    });

    completionSliderEl.noUiSlider.on('change', () => {
        currentPage = 0;
        scheduleRender();
    });
}

// ─────────────────────────────────────────────
//  SLIDER ANNO DI USCITA
// ─────────────────────────────────────────────
function initYearSlider() {
    const sliderEl = document.getElementById('yearSlider');
    const labelEl = document.getElementById('yearRangeLabel');
    if (!window.noUiSlider || !sliderEl) return;

    const currentYear = new Date().getFullYear();

    noUiSlider.create(sliderEl, {
        start: [1990, currentYear],
        connect: true,
        range: { min: 1990, max: currentYear },
        step: 1,
        tooltips: false
    });

    sliderEl.noUiSlider.on('update', (values) => {
        const lo = Math.round(+values[0]);
        const hi = Math.round(+values[1]);
        yearRange.min = lo;
        yearRange.max = hi;
        if (labelEl) labelEl.textContent = `${lo} - ${hi}`;
    });

    sliderEl.noUiSlider.on('change', () => {
        currentPage = 0;
        scheduleRender();
    });
}

// ─────────────────────────────────────────────
//  POPOLA SELECT GENERI
//  Legge i generi da allGames (campo genres[])
//  Se il campo non esiste, la select resta vuota
// ─────────────────────────────────────────────
function populateGenreFilter() {
    const select = document.getElementById('genreFilter');
    if (!select) return;

    const genreSet = new Set();
    allGames.forEach(g => {
        if (Array.isArray(g.genres)) {
            g.genres.forEach(genre => genreSet.add(genre));
        }
    });

    // Rimuovi opzioni precedenti (tranne "Tutti")
    while (select.options.length > 1) select.remove(1);

    const sorted = [...genreSet].sort((a, b) => a.localeCompare(b));
    sorted.forEach(genre => {
        const opt = document.createElement('option');
        opt.value = genre;
        opt.textContent = genre;
        select.appendChild(opt);
    });
}

// ─────────────────────────────────────────────
//  BADGE FILTRI ATTIVI
// ─────────────────────────────────────────────
function updateFilterBadge() {
    const badge = document.getElementById('filterBadge');
    if (!badge) return;

    let count = 0;

    // Stato achievements (default: tutti e 3 attivi)
    if (filterStatus.size < 3) count++;

    // Ore giocate
    if (playtimeRange.min > 0 || playtimeRange.max < 200) count++;

    // Completamento %
    if (completionRange.min > 0 || completionRange.max < 100) count++;

    // Ultimo accesso
    if (lastPlayedFilter !== 'all') count++;

    // Anno di uscita
    const currentYear = new Date().getFullYear();
    if (yearRange.min > 1990 || yearRange.max < currentYear) count++;

    // Genere
    if (genreFilter !== 'all') count++;

    // Installazione
    if (filterInstall !== 'all') count++;

    // Prezzo
    if (filterPrice !== 'all') count++;

    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function formatHours(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

function getCompletionPct(appid) {
    const s = cachedSummaries[appid];
    if (!s || s.t === 0) return null;
    return Math.round((s.u / s.t) * 100);
}

// ─────────────────────────────────────────────
//  RENDER SCHEDULATO
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
//  RENDER PRINCIPALE
// ─────────────────────────────────────────────
function render() {
    const pageSize = parseInt(document.getElementById('maxGames')?.value) || 40;
    const term = (document.getElementById('search')?.value || '').toLowerCase();
    const sortBy = document.getElementById('sortSelect')?.value || 'played';

    // Filtro per nome
    let filtered = allGames.filter(g => g.name.toLowerCase().includes(term));

    // Filtro per stato achievements
    filtered = filtered.filter(g => {
        const s = cachedSummaries[g.appid];
        if (!s) return filterStatus.has('noach');
        if (s.t === 0) return filterStatus.has('noach');
        const pct = s.t > 0 ? (s.u / s.t) * 100 : 0;
        if (pct >= 100) return filterStatus.has('completed');
        return filterStatus.has('inprogress');
    });

    // Filtro ore giocate
    filtered = filtered.filter(g => {
        const h = Math.floor((g.playtime || 0) / 60);
        if (playtimeRange.max >= 200) return h >= playtimeRange.min;
        return h >= playtimeRange.min && h <= playtimeRange.max;
    });

    // Filtro completamento %
    filtered = filtered.filter(g => {
        const s = cachedSummaries[g.appid];
        if (completionRange.min === 0 && completionRange.max === 100) return true;
        if (!s || s.t === 0) return completionRange.min === 0;
        const pct = Math.round((s.u / s.t) * 100);
        return pct >= completionRange.min && pct <= completionRange.max;
    });

    // Filtro ultimo accesso
    if (lastPlayedFilter !== 'all') {
        const now = Math.floor(Date.now() / 1000);
        filtered = filtered.filter(g => {
            const lp = g.last_played || 0;
            if (lastPlayedFilter === 'never') return lp === 0;
            const days = parseInt(lastPlayedFilter);
            return lp > 0 && (now - lp) <= days * 86400;
        });
    }

    // Filtro anno di uscita
    // Richiede g.release_year (number) — fornito da server.py
    const currentYear = new Date().getFullYear();
    if (yearRange.min > 1990 || yearRange.max < currentYear) {
        filtered = filtered.filter(g => {
            if (!g.release_year) return false; // escludi se anno non ancora in cache
            return g.release_year >= yearRange.min && g.release_year <= yearRange.max;
        });
    }

    // Filtro genere
    // Richiede g.genres (string[]) — fornito da server.py
    if (genreFilter !== 'all') {
        filtered = filtered.filter(g => {
            if (!Array.isArray(g.genres)) return false;
            return g.genres.includes(genreFilter);
        });
    }

    // Filtro installazione
    // Richiede g.installed (boolean) — fornito da server.py
    if (filterInstall !== 'all') {
        filtered = filtered.filter(g => {
            if (filterInstall === 'installed') return g.installed === true;
            if (filterInstall === 'library') return g.installed !== true;
            return true;
        });
    }

    // Filtro prezzo (free-to-play)
    // Richiede g.is_free (boolean) — fornito da server.py
    if (filterPrice !== 'all') {
        filtered = filtered.filter(g => {
            if (filterPrice === 'free') return g.is_free === true;
            if (filterPrice === 'paid') return g.is_free !== true;
            return true;
        });
    }

    // Ordinamento
    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'name':
                return a.name.localeCompare(b.name);
            case 'name_desc':
                return b.name.localeCompare(a.name);
            case 'completion': {
                const pa = getCompletionPct(a.appid) ?? -1;
                const pb = getCompletionPct(b.appid) ?? -1;
                return pb - pa;
            }
            case 'completion_asc': {
                const pa = getCompletionPct(a.appid) ?? 101;
                const pb = getCompletionPct(b.appid) ?? 101;
                return pa - pb;
            }
            case 'recent':
                return (b.last_played || 0) - (a.last_played || 0);
            case 'played':
            default:
                return (b.playtime || 0) - (a.playtime || 0);
        }
    });

    // Paginazione
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    const slice = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    window.pageInfoData = { current: currentPage + 1, total: totalPages };
    updatePageInfoUI();
    updateFilterBadge();

    // Rendering card
    const fragment = document.createDocumentFragment();
    slice.forEach((g, i) => {
        const s = cachedSummaries[g.appid];
        const hasAch = s && s.t > 0;
        const pct = hasAch ? Math.round((s.u / s.t) * 100) : 0;
        const isCompleted = hasAch && pct >= 100;
        const isNoAch = !hasAch;

        const card = document.createElement('div');
        card.className = 'card' + (isCompleted ? ' completed' : '') + (isNoAch ? ' no-achievements' : '');
        card.style.animationDelay = `${i * 30}ms`;
        card.onclick = () => openPop(g);

        card.innerHTML = `
            <div class="badge-completed">✓ 100%</div>
            <div class="img-container">
                <img src="${g.img}" alt="${g.name}" loading="lazy" onerror="this.src='https://placehold.co/460x215/1b2838/66c0f4?text=No+Image'">
            </div>
            <div class="card-info">
                <div class="title">${g.name}</div>
                <div class="meta">
                    <span>⏱ ${formatHours(g.playtime || 0)}</span>
                    <span>${hasAch ? `🏆 ${s.u}/${s.t}` : '—'}</span>
                </div>
                <div class="prog-bg">
                    <div class="prog-fill" style="width:${isNoAch ? 100 : pct}%"></div>
                </div>
            </div>`;
        fragment.appendChild(card);
    });

    const listDiv = document.getElementById('list');
    listDiv.innerHTML = '';
    listDiv.appendChild(fragment);

    applyTranslations();
    updatePageInfoUI();

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    fetchDetails(slice, fetchController.signal);
}

function updatePageInfoUI() {
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo && window.pageInfoData) {
        pageInfo.textContent = `${translations[currentLang]?.page || 'Pagina'} ${window.pageInfoData.current}/${window.pageInfoData.total}`;
    }
}

// ─────────────────────────────────────────────
//  FETCH DETTAGLI (achievements bulk)
// ─────────────────────────────────────────────
async function fetchDetails(games, signal) {
    const appids = games.map(g => g.appid);

    try {
        const achRes = await fetch(`${API}/steam/achievements_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appids }),
            signal
        });
        if (!achRes.ok) throw new Error('ach bulk failed');
        const achData = await achRes.json();

        let changed = false;
        for (const [appid, summary] of Object.entries(achData)) {
            if (!cachedSummaries[appid] ||
                cachedSummaries[appid].u !== summary.u ||
                cachedSummaries[appid].t !== summary.t) {
                cachedSummaries[appid] = summary;
                changed = true;
            }
        }
        if (changed) scheduleRender();

        updateCompletionBar();

    } catch (e) {
        if (e.name !== 'AbortError') console.error('fetchDetails error:', e);
    }
}

// ─────────────────────────────────────────────
//  BARRA COMPLETAMENTO MEDIO
// ─────────────────────────────────────────────
function updateCompletionBar() {
    let totalPct = 0;
    let count = 0;
    for (const appid of Object.keys(cachedSummaries)) {
        const s = cachedSummaries[appid];
        if (s && s.t > 0) {
            totalPct += (s.u / s.t) * 100;
            count++;
        }
    }

    if (count === 0) return;

    const pct = Math.round(totalPct / count);

    const bar = document.getElementById('completionBar');
    const barBg = document.getElementById('completionBarBg');
    const pctEl = document.getElementById('completionPercent');
    const textEl = document.getElementById('completionText');

    if (bar) {
        bar.classList.remove('loading', 'shimmer-effect');
        bar.style.width = pct + '%';
        bar.style.height = '8px';
    }
    if (barBg) {
        barBg.classList.remove('loading');
        barBg.classList.add('expanded');
        barBg.style.width = '100%';
    }
    if (pctEl) pctEl.classList.remove('hidden');

    const t = translations[currentLang] || {};
    const desc = (t.avg_completion_desc || '{percent}% ({count} giochi con achievements)')
        .replace('{percent}', pct)
        .replace('{count}', count);
    if (textEl) textEl.textContent = desc;
}

// ─────────────────────────────────────────────
//  POPUP DETTAGLIO GIOCO
// ─────────────────────────────────────────────
async function openPop(g) {
    const overlay = document.getElementById('overlay');
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');

    overlay.style.display = 'block';
    popup.style.display = 'flex';
    content.innerHTML = `<div style="text-align:center; padding:20px;"><div class="sp"></div></div>`;

    try {
        const lang = currentLang || 'it';
        const [schemaRes, playerRes, globalRes] = await Promise.all([
            fetch(`${API}/steam/schema/${g.appid}?l=${lang}`),
            fetch(`${API}/steam/player_achievements/${g.appid}`),
            fetch(`${API}/steam/global_ach/${g.appid}`)
        ]);

        const schemaJson = await schemaRes.json();
        const schema = schemaJson.achievements || [];
        const playerJson = await playerRes.json();
        const playerMap = playerJson.achievements || {};
        const globalJson = await globalRes.json();
        const globalMap = globalJson.percentages || {};

        let html = `<h3 style="color:var(--blue);margin-top:0;margin-bottom:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">${g.name}</h3>`;
        html += `<div style="display:flex; gap:12px; margin-bottom:12px; color:var(--muted); flex-wrap:wrap;">
            <div>⏱ ${formatHours(g.playtime || 0)}</div>
        </div>`;

        if (schema.length === 0) {
            html += `<p style="color:var(--muted); text-align:center;">Nessun achievement disponibile.</p>`;
        } else {
            const achieved = schema.filter(a => playerMap[a.name]?.achieved === 1);
            const notAchieved = schema.filter(a => playerMap[a.name]?.achieved !== 1);
            const pct = Math.round((achieved.length / schema.length) * 100);

            html += `<div style="margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; font-size:0.85em; color:var(--muted); margin-bottom:4px;">
                    <span>🏆 ${achieved.length}/${schema.length} achievements</span>
                    <span>${pct}%</span>
                </div>
                <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
            </div>`;

            const renderAch = (list, done) => list.map(a => {
                const techName = (a.name || '').toLowerCase();
                const dispName = (a.displayName || a.name || '').toLowerCase();
                const globalPct = globalMap[techName] ?? globalMap[dispName] ?? null;
                const rarityClass = globalPct === null ? '' :
                    globalPct < 5 ? 'rarity-epic' :
                        globalPct < 15 ? 'rarity-rare' :
                            globalPct < 35 ? 'rarity-uncommon' : 'rarity-common';
                const icon = done ? (a.icon || '') : (a.icongray || a.icon || '');
                const unlockTime = done && playerMap[a.name]?.unlocktime
                    ? new Date(playerMap[a.name].unlocktime * 1000).toLocaleDateString()
                    : '';
                return `<div class="ach-item ${rarityClass}" style="opacity:${done ? 1 : 0.55}">
                    ${icon ? `<img src="${icon}" alt="">` : ''}
                    <div class="ach-text">
                        <div class="ach-name">${a.displayName || a.name}</div>
                        <div class="ach-desc">${a.description || ''}</div>
                        ${globalPct !== null ? `<div style="font-size:0.75em;color:var(--muted);margin-top:2px;">🌍 ${globalPct.toFixed(1)}% giocatori${unlockTime ? ' · 📅 ' + unlockTime : ''}</div>` : ''}
                    </div>
                </div>`;
            }).join('');

            if (achieved.length > 0) {
                html += `<div style="font-size:0.8em;color:var(--blue);font-weight:600;margin-bottom:6px;">✅ Sbloccati (${achieved.length})</div>`;
                html += renderAch(achieved, true);
            }
            if (notAchieved.length > 0) {
                html += `<div style="font-size:0.8em;color:var(--muted);font-weight:600;margin:10px 0 6px;">🔒 Non sbloccati (${notAchieved.length})</div>`;
                html += renderAch(notAchieved, false);
            }
        }

        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = `<p style="color:#ff6b6b;">Errore nel caricamento dei dettagli.</p>`;
        console.error(e);
    }
}

function closePop() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('popup').style.display = 'none';
}

// ─────────────────────────────────────────────
//  CONFIG / LOGIN
// ─────────────────────────────────────────────
async function checkConfig() {
    try {
        const res = await fetch(`${API}/data`);
        const db = await res.json();
        if (!db.steam_id) {
            showLogin();
            return;
        }
        hideLogin();
        await loadGames();
        loadProfile();
    } catch (e) {
        console.error('checkConfig error:', e);
        showLogin();
    }
}

function showLogin() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLogin() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
}

// ─────────────────────────────────────────────
//  PRECARICA ACHIEVEMENTS DI TUTTI I GIOCHI
//  in background, a batch da 40
// ─────────────────────────────────────────────
async function prefetchAllAchievements() {
    const BATCH = 40;
    const missing = allGames
        .map(g => g.appid)
        .filter(id => !cachedSummaries[id]);

    for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        try {
            const res = await fetch(`${API}/steam/achievements_bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appids: batch })
            });
            if (!res.ok) continue;
            const data = await res.json();
            for (const [appid, summary] of Object.entries(data)) {
                cachedSummaries[appid] = summary;
            }
            updateCompletionBar();
        } catch (e) {
            console.warn('prefetch batch error:', e);
        }
    }
}

async function loadGames() {
    try {
        const res = await fetch(`${API}/steam/games_summary`);
        const data = await res.json();
        allGames = data.games || [];

        const totalH = Math.floor(allGames.reduce((acc, g) => acc + (g.playtime || 0), 0) / 60);
        const statsEl = document.getElementById('totalStats');
        if (statsEl) statsEl.textContent = `${translations[currentLang]?.total_hours || 'Ore totali'}: ${totalH}h`;

        currentPage = 0;
        populateGenreFilter();
        render();
        updateCompletionBar();
        prefetchAllAchievements();

    } catch (e) {
        console.error('loadGames error:', e);
    }
}

async function loadProfile() {
    try {
        const res = await fetch(`${API}/steam/profile`);
        const p = await res.json();
        if (p.error) return;

        const area = document.getElementById('profileArea');
        if (!area) return;

        const stateMap = { 0: '⚫ Offline', 1: '🟢 Online', 2: '🟡 Occupato', 3: '🟡 Lontano', 4: '🟡 Snooze', 5: '🟢 Cerca partita', 6: '🟢 Gioca' };
        const state = stateMap[p.personastate] || '';

        area.innerHTML = `
            <a href="${p.profileurl}" target="_blank" rel="noopener">
                <img src="${p.avatar}" alt="avatar">
                <div>
                    <div class="profile-name">${p.persona_name}</div>
                    <div class="profile-state">${state}</div>
                </div>
            </a>
            <div class="profile-links">
                <span class="logout-link" onclick="logout()">${translations[currentLang]?.logout || 'Logout'}</span>
            </div>`;
    } catch (e) {
        console.error('loadProfile error:', e);
    }
}

async function logout() {
    await fetch(`${API}/steam/logout`, { method: 'POST' });
    allGames = [];
    cachedSummaries = {};
    document.getElementById('list').innerHTML = '';
    document.getElementById('profileArea').innerHTML = '';
    showLogin();
}

// ─────────────────────────────────────────────
//  TEMA
// ─────────────────────────────────────────────
function toggleTheme() {
    const body = document.body;
    const isLight = body.getAttribute('data-theme') === 'light';
    body.setAttribute('data-theme', isLight ? '' : 'light');
    localStorage.setItem('st_theme', isLight ? '' : 'light');
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = isLight ? '🌙' : '☀️';
}

// ─────────────────────────────────────────────
//  TRADUZIONI
// ─────────────────────────────────────────────
async function loadTranslations() {
    try {
        const res = await fetch('/static/lang.json');
        translations = await res.json();
    } catch (e) {
        console.warn('Traduzioni non caricate:', e);
        translations = {};
    }
}

function applyTranslations() {
    const t = translations[currentLang] || {};
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
    });
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.textContent = document.body.getAttribute('data-theme') === 'light' ? '☀️' : '🌙';
}

function translatePage() {
    applyTranslations();
}

// ─────────────────────────────────────────────
//  RESET FILTRI
// ─────────────────────────────────────────────
function resetFilters() {
    // Checkbox stato achievements
    document.querySelectorAll('.filter-status').forEach(cb => { cb.checked = true; });
    filterStatus = new Set(['completed', 'inprogress', 'noach']);

    // Slider ore
    const playtimeSliderEl = document.getElementById('playtimeSlider');
    if (playtimeSliderEl?.noUiSlider) playtimeSliderEl.noUiSlider.set([0, 200]);
    playtimeRange = { min: 0, max: 200 };

    // Slider completamento
    const completionSliderEl = document.getElementById('completionSlider');
    if (completionSliderEl?.noUiSlider) completionSliderEl.noUiSlider.set([0, 100]);
    completionRange = { min: 0, max: 100 };

    // Slider anno
    const currentYear = new Date().getFullYear();
    const yearSliderEl = document.getElementById('yearSlider');
    if (yearSliderEl?.noUiSlider) yearSliderEl.noUiSlider.set([1990, currentYear]);
    yearRange = { min: 1990, max: currentYear };

    // Genere
    const genreEl = document.getElementById('genreFilter');
    if (genreEl) genreEl.value = 'all';
    genreFilter = 'all';

    // Installazione
    document.querySelectorAll('.filter-install').forEach(btn => btn.classList.remove('active'));
    const installAllBtn = document.querySelector('.filter-install[data-value="all"]');
    if (installAllBtn) installAllBtn.classList.add('active');
    filterInstall = 'all';

    // Prezzo
    document.querySelectorAll('.filter-price').forEach(btn => btn.classList.remove('active'));
    const priceAllBtn = document.querySelector('.filter-price[data-value="all"]');
    if (priceAllBtn) priceAllBtn.classList.add('active');
    filterPrice = 'all';

    // Ultimo accesso
    const lastPlayedEl = document.getElementById('lastPlayedFilter');
    if (lastPlayedEl) lastPlayedEl.value = 'all';
    lastPlayedFilter = 'all';

    // Sort
    const sortEl = document.getElementById('sortSelect');
    if (sortEl) sortEl.value = 'played';

    // Ricerca
    const searchEl = document.getElementById('search');
    if (searchEl) searchEl.value = '';

    currentPage = 0;
    scheduleRender();
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Tema salvato
    const savedTheme = localStorage.getItem('st_theme');
    if (savedTheme) document.body.setAttribute('data-theme', savedTheme);

    await loadTranslations();

    // Lingua
    const langSelect = document.getElementById('langSelect');
    if (langSelect && translations) {
        Object.keys(translations).forEach(lang => {
            const opt = document.createElement('option');
            opt.value = lang;
            opt.textContent = translations[lang]?.language_name || lang.toUpperCase();
            if (lang === currentLang) opt.selected = true;
            langSelect.appendChild(opt);
        });
        langSelect.addEventListener('change', (e) => {
            currentLang = e.target.value;
            localStorage.setItem('st_lang', currentLang);
            translatePage();
            render();
        });
    }

    // Sliders
    initPlaytimeSlider();
    initCompletionSlider();
    initYearSlider();

    // Ricerca (debounced)
    const searchEl = document.getElementById('search');
    if (searchEl) {
        searchEl.addEventListener('input', debounce(() => {
            currentPage = 0;
            scheduleRender();
        }, 300));
    }

    // Sort
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.addEventListener('change', () => { currentPage = 0; scheduleRender(); });

    // Giochi per pagina
    const maxGames = document.getElementById('maxGames');
    if (maxGames) maxGames.addEventListener('change', () => { currentPage = 0; scheduleRender(); });

    // Paginazione
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (currentPage > 0) { currentPage--; scheduleRender(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (window.pageInfoData && currentPage < window.pageInfoData.total - 1) {
            currentPage++;
            scheduleRender();
        }
    });

    // Refresh
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        cachedSummaries = {};
        currentPage = 0;
        await loadGames();
    });

    // SID manuale
    const sidSaveBtn = document.getElementById('sidSaveBtn');
    if (sidSaveBtn) sidSaveBtn.addEventListener('click', async () => {
        const sid = document.getElementById('sidInput')?.value?.trim();
        if (!sid) return;
        await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steam_id: sid })
        });
        hideLogin();
        await loadGames();
        loadProfile();
    });

    // Filtro ultimo accesso
    const lastPlayedEl = document.getElementById('lastPlayedFilter');
    if (lastPlayedEl) {
        lastPlayedFilter = lastPlayedEl.value || 'all';
        lastPlayedEl.addEventListener('change', (e) => {
            lastPlayedFilter = e.target.value;
            currentPage = 0;
            scheduleRender();
        });
    }

    // Checkbox stato achievements
    document.querySelectorAll('.filter-status').forEach(cb => {
        cb.addEventListener('change', () => {
            filterStatus = new Set(
                Array.from(document.querySelectorAll('.filter-status:checked')).map(x => x.value)
            );
            currentPage = 0;
            scheduleRender();
        });
    });

    // Chip installazione (data-value="all|installed|library")
    document.querySelectorAll('.filter-install').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-install').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterInstall = btn.dataset.value;
            currentPage = 0;
            scheduleRender();
        });
    });

    // Chip prezzo (data-value="all|free|paid")
    document.querySelectorAll('.filter-price').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-price').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterPrice = btn.dataset.value;
            currentPage = 0;
            scheduleRender();
        });
    });

    // Select genere
    const genreEl = document.getElementById('genreFilter');
    if (genreEl) {
        genreEl.addEventListener('change', (e) => {
            genreFilter = e.target.value;
            currentPage = 0;
            scheduleRender();
        });
    }

    // Reset filtri
    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    translatePage();
    await checkConfig();
});