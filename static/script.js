const API = "/api";
let allGames = [];
let currentPage = 0;
let translations = {};
let currentLang = localStorage.getItem('st_lang') || 'it';
let fetchController = null;
let cachedSummaries = {}; // appid -> {u,t}
let fetchingCompletionCache = false;
let globalPercentCache = {}; // appid -> { name: percent }
let lastTotalHours = 0;

// UI helpers
function showLogin() { document.getElementById('loginOverlay').style.display = 'flex'; }
function hideLogin() { document.getElementById('loginOverlay').style.display = 'none'; }
function closePop() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('popup').style.display = 'none';
    document.getElementById('popup-close-btn').style.display = 'none';
    document.getElementById('popup-content').innerHTML = '';
}

async function checkConfig() {
    try {
        const res = await fetch(`${API}/data`);
        const d = await res.json();
        if (!d.steam_id) {
            showLogin();
        } else {
            hideLogin();
            await loadProfile();
            await loadLibrary();
        }
    } catch (e) {
        showLogin();
    }
}

document.getElementById('sidSaveBtn').onclick = async () => {
    const sid = document.getElementById('sidInput').value.trim();
    if (!sid) return;
    try {
        await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steam_id: sid })
        });
        hideLogin();
        await loadProfile();
        await loadLibrary();
    } catch (e) {
        console.error("Errore durante il salvataggio dello SteamID", e);
    }
};

async function loadProfile() {
    try {
        const r = await fetch(`${API}/steam/profile`);
        const p = await r.json();
        const area = document.getElementById('profileArea');
        area.style.display = 'flex';
        area.style.alignItems = 'center';
        area.style.gap = '10px';

        // Mappa dello stato
        const states = {
            0: translations[currentLang]?.['status_offline'] || 'Offline',
            1: translations[currentLang]?.['status_online'] || 'Online',
            2: translations[currentLang]?.['status_busy'] || 'Occupato',
            3: translations[currentLang]?.['status_away'] || 'Assente',
            4: translations[currentLang]?.['status_snooze'] || 'In pausa',
            5: translations[currentLang]?.['status_looking_trade'] || 'Cerca scambi',
            6: translations[currentLang]?.['status_looking_play'] || 'Cerca partita'
        };

        const personaState = p.personastate ?? 0;
        const stateText = p.gameextrainfo ? `${p.gameextrainfo}` : (states[personaState] || '');

        // lastlogoff -> mostra come "last online X ago" se presente e offline
        let lastSeen = '';
        if (p.lastlogoff && personaState === 0) {
            lastSeen = ` • ${timeAgo(new Date(p.lastlogoff * 1000))}`;
        }

        area.innerHTML = `
            <a href="${p.profileurl}" target="_blank" style="display:flex; align-items:center; gap:8px; text-decoration:none; color:inherit;">
                <img src="${p.avatar}" alt="avatar" id="profileAvatar" style="width:32px; height:32px; border-radius:50%; border: 1px solid var(--blue);">
                <div class="profile-info" style="display:flex; flex-direction:column; line-height:1.2;">
                    <span class="profile-name" id="profileName" style="font-weight:600;">${p.persona_name}</span>
                    <span class="profile-state" style="font-size:0.8em; color:var(--muted)">${stateText}${lastSeen}</span>
                </div>
            </a>
            <span class="logout-link" onclick="doLogout()" data-i18n="logout" style="margin-left:8px; cursor:pointer;">${translations[currentLang]?.logout || 'Logout'}</span>
        `;
    } catch (e) {
        console.warn('loadProfile error', e);
        document.getElementById('profileArea').style.display = 'none';
    }
}

function timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const intervals = [
        { label: 'y', seconds: 31536000 },
        { label: 'mo', seconds: 2592000 },
        { label: 'd', seconds: 86400 },
        { label: 'h', seconds: 3600 },
        { label: 'm', seconds: 60 }
    ];
    for (const i of intervals) {
        const val = Math.floor(seconds / i.seconds);
        if (val >= 1) return `${val}${i.label} ago`;
    }
    return 'now';
}

function translatePage() {
    applyTranslations();
    // placeholder e statistiche
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.placeholder = translations[currentLang]?.['search_placeholder'] || '';

    const totalStats = document.getElementById('totalStats');
    if (totalStats && window.lastTotalHours !== undefined) {
        totalStats.textContent = `${translations[currentLang]?.['total_hours'] || 'Ore totali'}: ${window.lastTotalHours}h`;
    }

    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo && window.pageInfoData) {
        pageInfo.textContent = `${translations[currentLang]?.['page'] || 'Pagina'} ${window.pageInfoData.current}`;
    }
}

function applyTranslations() {
    const langData = translations[currentLang] || {};
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = langData[key] || el.placeholder;
        } else {
            let text = langData[key] || el.innerText;
            if (key === 'page_of' && window.pageInfoData) {
                text = text.replace('{current}', window.pageInfoData.current).replace('{total}', window.pageInfoData.total);
            }
            if (key === 'avg_completion_desc' && window.avgCompletionData) {
                text = text.replace('{percent}', window.avgCompletionData.percent).replace('{count}', window.avgCompletionData.count);
            }
            el.innerText = text;
        }
    });
}

async function doLogout() { await fetch(`${API}/steam/logout`, { method: 'POST' }); location.reload(); }

async function loadLibrary() {
    const listDiv = document.getElementById('list');
    listDiv.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:50px;">${translations[currentLang]?.loading_library || 'Caricamento libreria...'}</div>`;

    const barBg = document.getElementById('completionBarBg');
    const bar = document.getElementById('completionBar');
    const pct = document.getElementById('completionPercent');
    const txt = document.getElementById('completionText');

    barBg.classList.add('loading');
    bar.classList.add('loading');
    barBg.classList.remove('expanded');
    pct.classList.add('hidden');
    txt.innerText = '';

    try {
        const res = await fetch(`${API}/steam/games_summary`);
        const data = await res.json();
        allGames = data.games || [];
        const totalHours = Math.round(allGames.reduce((acc, g) => acc + (g.playtime || 0), 0) / 60);
        window.lastTotalHours = totalHours;
        document.getElementById('totalStats').innerText = `${translations[currentLang]?.total_hours || 'Ore totali'}: ${totalHours}h`;
        render();
        await updateCompletionSummary(allGames);
    } catch (e) {
        console.error('loadLibrary error', e);
        listDiv.innerHTML = translations[currentLang]?.error_fetching_data || 'Errore caricamento.';
    }
}

function formatHours(minutes) {
    const h = Math.round((minutes || 0) / 60);
    return `${h}h`;
}

async function fetchAllSummariesIfNeeded() {
    if (fetchingCompletionCache) return;
    const allAppids = allGames.map(g => g.appid);
    const missing = allAppids.filter(id => !(id in cachedSummaries));
    if (missing.length === 0) return;
    try {
        fetchingCompletionCache = true;
        const res = await fetch(`${API}/steam/achievements_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appids: missing })
        });
        const achs = await res.json();
        for (const id of Object.keys(achs)) {
            cachedSummaries[id] = achs[id];
        }
    } catch (e) {
        console.warn('Impossibile prefetch completamento', e);
    } finally {
        fetchingCompletionCache = false;
    }
}

function getCompletionPercentFor(id) {
    const s = cachedSummaries[id];
    if (!s || !s.t || s.t === 0) return 0;
    return Math.round((s.u / s.t) * 100);
}

function render() {
    const pageSize = parseInt(document.getElementById('maxGames').value) || 40;
    const term = (document.getElementById('search').value || '').toLowerCase();
    const filter = document.getElementById('filterSelect')?.value || 'all';
    const sortBy = document.getElementById('sortSelect')?.value || 'played';

    // filter by name first
    let filtered = allGames.filter(g => g.name.toLowerCase().includes(term));

    // apply filters
    if (filter === 'completed') {
        filtered = filtered.filter(g => {
            const s = cachedSummaries[g.appid];
            return s && s.t > 0 && s.u === s.t;
        });
    } else if (filter === 'inprogress') {
        filtered = filtered.filter(g => {
            const s = cachedSummaries[g.appid];
            return s && s.t > 0 && s.u > 0 && s.u < s.t;
        });
    } else if (filter === 'noach') {
        filtered = filtered.filter(g => {
            const s = cachedSummaries[g.appid];
            return !s || s.t === 0;
        });
    } else if (filter === 'recent') {
        // optionally sort by last played
        filtered = filtered.filter(g => g.last_played !== undefined);
        filtered.sort((a, b) => (b.last_played || 0) - (a.last_played || 0));
    }

    // Sorting
    if (sortBy === 'played') {
        filtered.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    } else if (sortBy === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'completion') {
        const need = filtered.some(g => !(g.appid in cachedSummaries));
        if (need) {
            fetchAllSummariesIfNeeded().then(() => render());
        }
        filtered.sort((a, b) => getCompletionPercentFor(b.appid) - getCompletionPercentFor(a.appid));
    }

    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;
    window.pageInfoData = { current: currentPage + 1, total: totalPages };

    const slice = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();

    document.getElementById('list').innerHTML = slice.map((g, index) => `    
        <div class="card" id="card-${g.appid}" onclick="openPop('${g.appid}')" style="animation-delay: ${index * 0.03}s">    
            <div class="img-container">    
                <div class="badge-completed" data-i18n="completed_badge">${translations[currentLang]?.completed_badge || 'COMPLETATO'}</div>    
                <img src="${g.img}" loading="lazy" alt="${g.name}">    
            </div>    
            <div class="card-info">    
                <div class="title" id="title-${g.appid}">${g.name}</div>    
                <div class="meta">    
                    <span id="ach-${g.appid}">    
                        <span class="skeleton-inline" style="width:60px;height:12px;display:inline-block;vertical-align:middle;border-radius:6px;"></span>    
                    </span>    
                    <span id="dlc-${g.appid}">📦 <span class="skeleton-inline" style="width:36px;height:12px;display:inline-block;vertical-align:middle;border-radius:6px;"></span></span>    
                </div>    
                <div class="prog-bg"><div id="bar-${g.appid}" class="prog-fill"></div></div>    
                <div style="font-size:0.85em; color:var(--muted); margin-top:6px;">${formatHours(g.playtime)}</div>
            </div>    
        </div>    
    `).join('');

    applyTranslations();
    updatePageInfoUI();
    fetchDetails(slice, fetchController.signal);
}

function updatePageInfoUI(){
    const pageInfo = document.getElementById('pageInfo');
    if(pageInfo && window.pageInfoData){
        pageInfo.textContent = `${translations[currentLang]?.page || 'Pagina'} ${window.pageInfoData.current}/${window.pageInfoData.total}`;
    }
}

async function fetchDetails(games, signal) {
    const appids = games.map(g => g.appid);
    try {
        const res = await fetch(`${API}/steam/achievements_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appids }),
            signal: signal
        });
        const achs = await res.json();

        for (const id of appids) {
            if (signal.aborted) return;

            const a = achs[id];
            const card = document.getElementById(`card-${id}`);
            const achText = document.getElementById(`ach-${id}`);
            const bar = document.getElementById(`bar-${id}`);
            const dlcEl = document.getElementById(`dlc-${id}`);

            if (!card || !achText) continue;

            // cache summary for later sort/filter
            if (a && a.t !== undefined) cachedSummaries[id] = a;

            if (a && a.t > 0) {
                const trophy = (a.u === a.t) ? ' <span style="color:var(--gold)">🏆</span>' : '';
                achText.innerHTML = `<b>${a.u}</b>/${a.t}${trophy}`;
                bar.style.width = (a.u / a.t * 100) + '%';
                if (a.u === a.t) card.classList.add('completed');
                else card.classList.remove('completed');
            } else {
                achText.innerHTML = `<span style="font-size:0.8em; color:var(--muted);">${translations[currentLang]?.no_achievements || '---'}</span>`;
                bar.style.width = '100%';
                card.classList.add('no-achievements');
            }

            // Fetch dettagli DLC  
            fetch(`${API}/steam/game_details/${id}`, { signal })
                .then(r => r.json())
                .then(d => {
                    const el = document.getElementById(`dlc-${id}`);
                    if (!el) return;
                    if (typeof d.owned_dlc === 'number') el.innerHTML = `📦 ${d.owned_dlc}/${d.total_dlc}`;
                    else el.innerHTML = '📦 0/0';
                })
                .catch(() => { /* Silenzioso se annullato */ });
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error("Fetch error:", err);
    }
}

function setAverageCompletion(percent, count) {
    window.avgCompletionData = { percent, count };
    applyTranslations();
    const bar = document.getElementById('completionBar');
    const percentText = document.getElementById('completionText');
    if (bar) {
        bar.style.width = percent + '%';
        bar.classList.remove('loading');
    }
    if (percentText) {
        percentText.innerText = (translations[currentLang]?.['avg_completion_desc'] || '{percent}% of {count}').replace('{percent}', percent).replace('{count}', count);
    }
    const pctWrap = document.getElementById('completionPercent');
    if (pctWrap) {
        pctWrap.classList.remove('hidden');
    }
}

async function updateCompletionSummary(games) {
    const percentText = document.getElementById('completionText');
    const bar = document.getElementById('completionBar');
    const barBg = document.getElementById('completionBarBg');
    const pctWrap = document.getElementById('completionPercent');

    if (!games || games.length === 0) return;

    barBg.classList.remove('expanded');
    barBg.classList.add('loading');
    bar.classList.add('loading');
    percentText.innerText = translations[currentLang]?.['calculating'] || '';
    pctWrap.classList.add('hidden');

    const appids = games.map(g => g.appid);
    try {
        const res = await fetch(`${API}/steam/achievements_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appids })
        });
        const achs = await res.json();
        let sum = 0, count = 0;
        for (const id of appids) {
            const a = achs[id];
            if (a && a.t > 0) {
                // cache for later
                cachedSummaries[id] = a;
                sum += (a.u / a.t);
                count++;
            }
        }

        bar.classList.remove('loading');
        barBg.classList.remove('loading');
        void barBg.offsetWidth;
        barBg.classList.add('expanded');

        setTimeout(() => {
            bar.style.height = '100%';
            bar.style.background = 'linear-gradient(90deg, #2f80ed 0%, #56ccf2 100%)';
            if (count > 0) {
                const pct = Math.round((sum / count) * 100);
                setAverageCompletion(pct, count);
            } else {
                bar.style.width = '0%';
                percentText.innerText = 'N/A';
                pctWrap.classList.remove('hidden');
            }
        }, 260);

    } catch (err) {
        console.error('updateCompletionSummary error', err);
        bar.classList.remove('loading');
        barBg.classList.remove('loading');
        barBg.classList.add('expanded');
        bar.style.width = '0%';
        percentText.innerText = translations[currentLang]?.error_fetching_data || 'Error';
        pctWrap.classList.remove('hidden');
    }
}

function rarityClassForPercent(pct) {
    // percent is global percent (higher = common)
    if (pct >= 40) return 'rarity-common';
    if (pct >= 10) return 'rarity-uncommon';
    if (pct >= 2) return 'rarity-rare';
    return 'rarity-epic';
}

async function openPop(appid) {
    const g = allGames.find(x => x.appid === appid);
    document.getElementById('overlay').style.display = 'block';
    const popup = document.getElementById('popup');
    popup.style.display = 'flex';
    document.getElementById('popup-close-btn').style.display = 'block';
    document.getElementById('popup-content').innerHTML = translations[currentLang]?.loading || '...';

    try {
        // usa cache per percentuali globali se disponibile
        const [schemaRes, playerRes, globalRes] = await Promise.all([
            fetch(`${API}/steam/schema/${appid}?l=${currentLang}`),
            fetch(`${API}/steam/player_achievements/${appid}`),
            fetch(`${API}/steam/global_ach/${appid}`)
        ]);
        const schemaJson = await schemaRes.json();
        const schema = schemaJson.achievements || [];
        const playerJson = await playerRes.json();
        const playerMap = playerJson.achievements || {};
        const globalJson = await globalRes.json();
        const globalMap = globalJson.percentages || {};

        // cache a livello front-end per evitare chiamate ripetute
        if (globalMap && Object.keys(globalMap).length) globalPercentCache[appid] = globalMap;

        let html = `<h3 style="color:var(--blue);margin-top:0;margin-bottom:15px;border-bottom:1px solid #e6e6e6;padding-bottom:10px;">${g.name}</h3>`;

        // Show specific stats for this title
        html += `<div style="display:flex; gap:12px; margin-bottom:12px; color:var(--muted);">
                    <div>${translations[currentLang]?.playtime || 'Playtime'}: <strong>${formatHours(g.playtime)}</strong></div>
                    ${g.appid ? `<div>${translations[currentLang]?.appid || 'AppID'}: <strong>${g.appid}</strong></div>` : ''}
                 </div>`;

        if (schema.length === 0) {
            html += `<p>${translations[currentLang]?.no_achievements || "Nessun obiettivo."}</p>`;
        } else {
            schema.forEach(a => {
                // try both keys, some schema variants use different keys
                const keyName = a.name || a.displayName || a.key || '';
                const p = playerMap[keyName] || playerMap[a.name] || playerMap[a.displayName] || { achieved: 0 };
                const unlocked = (p.achieved === 1) || (p.achieved === true);
                // fallback to cached global if available
                const pct = (globalMap[a.name] ?? globalMap[keyName]) || (globalPercentCache[appid]?.[a.name] ?? 0) || 0;
                const rclass = rarityClassForPercent(pct);
                html += `<div class="ach-item ${rclass}" style="${unlocked ? '' : 'opacity:0.7'}">
                            <img src="${unlocked ? (a.icon || '') : (a.icongray || a.icon || '')}" alt="${a.displayName || a.name}">
                            <div class="ach-text">
                                <div class="ach-name">${a.displayName || a.name} ${unlocked ? '✅' : ''}</div>
                                <div class="ach-desc">${a.description || ''}</div>
                                <div style="font-size:0.8em; color:var(--muted); margin-top:6px;">${translations[currentLang]?.global_percent || 'Global'}: ${pct.toFixed(2)}%</div>
                            </div>
                         </div>`;
            });
        }
        document.getElementById('popup-content').innerHTML = html;
    } catch (err) {
        console.error('openPop error', err);
        document.getElementById('popup-content').innerHTML = `<div style="color:var(--danger)">${translations[currentLang]?.error_fetching_data || 'Errore caricamento obiettivi.'}</div>`;
    }
}

async function loadTranslations() {
    try {
        const response = await fetch('/static/lang.json', { cache: 'no-cache' });
        translations = await response.json();
    } catch (e) {
        console.error('Errore caricamento lang.json', e);
    }

    // Popola il select delle lingue
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
        langSelect.innerHTML = '';
        const keys = Object.keys(translations);
        keys.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.text = translations[k].language_name || k.toUpperCase();
            langSelect.appendChild(opt);
        });
        if (keys.includes(currentLang)) langSelect.value = currentLang;
        else langSelect.value = keys[0] || 'it';

        langSelect.addEventListener('change', (ev) => {
            currentLang = ev.target.value;
            localStorage.setItem('st_lang', currentLang);
            translatePage();
            // ricarica libreria per testi che dipendono dalla lingua (opzionale)
            render();
        });
    }

    // Filtri e ordinamento
    const filterSelect = document.getElementById('filterSelect');
    const sortSelect = document.getElementById('sortSelect');
    const maxGames = document.getElementById('maxGames');
    if (filterSelect) filterSelect.addEventListener('change', () => { currentPage = 0; render(); });
    if (sortSelect) sortSelect.addEventListener('change', () => { currentPage = 0; render(); });
    if (maxGames) maxGames.addEventListener('change', () => { currentPage = 0; render(); });

    translatePage();
}

function toggleTheme() {
    const body = document.body;
    const isLight = body.getAttribute('data-theme') === 'light';
    if (isLight) {
        body.removeAttribute('data-theme');
    } else {
        body.setAttribute('data-theme', 'light');
    }
    translatePage();
}

function toggleLang() {
    const keys = Object.keys(translations);
    const i = keys.indexOf(currentLang);
    const next = keys[(i + 1) % keys.length];
    currentLang = next;
    localStorage.setItem('st_lang', currentLang);
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = currentLang;
    translatePage();
}

document.getElementById('refreshBtn').onclick = async () => { await loadLibrary(); };
document.getElementById('prevBtn').onclick = () => { if (currentPage > 0) { currentPage--; render(); } };
document.getElementById('nextBtn').onclick = () => { currentPage++; render(); };
document.getElementById('search').oninput = () => { currentPage = 0; render(); };

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
});

window.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    await checkConfig();
});