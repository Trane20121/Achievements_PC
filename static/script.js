// Copyright (c) 2026 Trane2012
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

const API = "/api";
let allGames = [];
let currentPage = 0;
let translations = {};
let currentLang = localStorage.getItem('st_lang') || 'it';
let fetchController = null;

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

        area.innerHTML = `
            <img src="${p.avatar}" alt="avatar" style="width:32px; height:32px; border-radius:50%; border: 1px solid var(--blue);">
            <div class="profile-info" style="display:flex; flex-direction:column; line-height:1.2;">
                <span class="profile-name">${p.persona_name}</span>
                <span class="logout-link" onclick="doLogout()" data-i18n="logout">${translations[currentLang]?.logout || 'Logout'}</span>
            </div>
        `;
    } catch (e) {
        document.getElementById('profileArea').style.display = 'none';
    }
}

function translatePage() {
    // Applichiamo le traduzioni a tutti gli elementi con data-i18n
    applyTranslations();

    // Gestione specifica per icone e placeholder che applyTranslations non copre bene
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = translations[currentLang]?.[key];
        if (!translation) return;

        if (key === 'theme_btn' || key === 'theme_btn_light' || key === 'configure' || key === 'language_toggle' || key === 'update_btn') {
            // Re-iniettiamo le icone se necessario (opzionale se già nel json)
            if (key === 'configure' && !translation.includes('⚙️')) el.innerHTML = `⚙️ ${translation}`;
            if (key === 'update_btn' && el.id === 'refreshBtn') el.textContent = translation;
        }
    });

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

            // Sostituzioni dinamiche
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
        const totalHours = Math.round(allGames.reduce((acc, g) => acc + g.playtime, 0) / 60);
        window.lastTotalHours = totalHours;
        document.getElementById('totalStats').innerText = `${translations[currentLang]?.total_hours || 'Ore totali'}: ${totalHours}h`;
        render();
        await updateCompletionSummary(allGames);
    } catch (e) {
        console.error('loadLibrary error', e);
        listDiv.innerHTML = translations[currentLang]?.error_fetching_data || 'Errore caricamento.';
    }
}

function render() {
    const pageSize = parseInt(document.getElementById('maxGames').value) || 40;
    const term = (document.getElementById('search').value || '').toLowerCase();
    const filtered = allGames.filter(g => g.name.toLowerCase().includes(term));
    const totalPages = Math.ceil(filtered.length / pageSize) || 1;

    if (currentPage >= totalPages) currentPage = totalPages - 1;
    window.pageInfoData = { current: currentPage + 1, total: totalPages };

    const slice = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    // 1. Annulliamo eventuali fetch in corso della pagina precedente  
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
            </div>    
        </div>    
    `).join('');

    applyTranslations();

    fetchDetails(slice, fetchController.signal);
}
async function fetchDetails(games, signal) {
    const appids = games.map(g => g.appid);
    try {
        const res = await fetch(`${API}/steam/achievements_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appids }),
            signal: signal // Se l'utente cambia pagina, questa fetch si ferma  
        });
        const achs = await res.json();

        for (const id of appids) {
            // Se nel frattempo il segnale è stato annullato, usciamo dal loop  
            if (signal.aborted) return;

            const a = achs[id];
            const card = document.getElementById(`card-${id}`);
            const achText = document.getElementById(`ach-${id}`);
            const bar = document.getElementById(`bar-${id}`);
            const dlcEl = document.getElementById(`dlc-${id}`);

            // Controllo silenzioso: se l'elemento non c'è più, ignoriamo e basta  
            if (!card || !achText) continue;

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

            // Fetch dettagli DLC (opzionale: puoi aggiungere il signal anche qui)  
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
        if (err.name === 'AbortError') return; // Normale amministrazione  
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
        percentText.innerText = translations[currentLang]?.['avg_completion_desc']
            .replace('{percent}', percent)
            .replace('{count}', count);
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

async function openPop(appid) {
    const g = allGames.find(x => x.appid === appid);
    document.getElementById('overlay').style.display = 'block';
    const popup = document.getElementById('popup');
    popup.style.display = 'flex';
    document.getElementById('popup-close-btn').style.display = 'block';
    document.getElementById('popup-content').innerHTML = translations[currentLang]?.loading || '...';

    const [schemaRes, playerRes] = await Promise.all([
        fetch(`${API}/steam/schema/${appid}?l=${currentLang}`),
        fetch(`${API}/steam/player_achievements/${appid}`)
    ]);
    const schema = (await schemaRes.json()).achievements || [];
    const playerMap = (await playerRes.json()).achievements || {};

    let html = `<h3 style="color:var(--blue);margin-top:0;margin-bottom:15px;border-bottom:1px solid #e6e6e6;padding-bottom:10px;">${g.name}</h3>`;
    if (schema.length === 0) {
        html += `<p>${translations[currentLang]?.no_achievements || "Nessun obiettivo."}</p>`;
    } else {
        schema.forEach(a => {
            const p = playerMap[a.name] || playerMap[a.displayName] || { achieved: 0 };
            const unlocked = p.achieved === 1;
            html += `<div class="ach-item" style="${unlocked ? '' : 'opacity:0.6'}">  
                        <img src="${unlocked ? a.icon : a.icongray}">  
                        <div class="ach-text">  
                            <div class="ach-name" style="color:var(--text)">  
                                ${a.displayName} ${unlocked ? '✅' : ''}  
                            </div>  
                            <div class="ach-desc">${a.description || ''}</div>  
                        </div>  
                     </div>`;
        });
    }
    document.getElementById('popup-content').innerHTML = html;
}

async function loadTranslations() {
    try {
        const response = await fetch('/static/lang.json', { cache: 'no-cache' });
        translations = await response.json();
    } catch (e) {
        console.error('Errore caricamento lang.json', e);
        translations = {};
    }

    // Popola il select delle lingue  
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
        langSelect.innerHTML = ''; // pulisci  
        // Ordina le lingue se vuoi (es. it prima)  
        const keys = Object.keys(translations);
        keys.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.text = translations[k].language_name || k.toUpperCase();
            langSelect.appendChild(opt);
        });
        // Imposta valore corrente  
        if (keys.includes(currentLang)) langSelect.value = currentLang;
        else langSelect.value = keys[0] || 'it';

        langSelect.addEventListener('change', (ev) => {
            currentLang = ev.target.value;
            localStorage.setItem('st_lang', currentLang);
            translatePage();
        });
    }

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
    translatePage(); // Aggiorna icone tema
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

window.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    await checkConfig();
});