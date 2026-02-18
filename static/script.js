// Copyright (c) 2026 Trane2012
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

const API = "/api";
let allGames = [];
let currentPage = 0;

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
        if (!d.steam_id) showLogin();
        else { hideLogin(); await loadProfile(); loadLibrary(); }
    } catch (e) { showLogin(); }
}

document.getElementById('sidSaveBtn').onclick = async () => {
    const sid = document.getElementById('sidInput').value.trim();
    if (!sid) return;
    await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steam_id: sid })
    });
    hideLogin(); await loadProfile(); loadLibrary();
};

async function loadProfile() {
    try {
        const r = await fetch(`${API}/steam/profile`);
        const p = await r.json();
        const area = document.getElementById('profileArea');
        area.style.display = 'flex';
        area.innerHTML = `<img src="${p.avatar}" alt="avatar"><div class="profile-info"><div class="profile-name">${p.persona_name}</div><div class="profile-links"><a href="${p.profileurl}" target="_blank">Profilo</a><span onclick="doLogout()">Logout</span></div></div>`;
    } catch (e) { document.getElementById('profileArea').style.display = 'none'; }
}

async function doLogout() { await fetch(`${API}/steam/logout`, { method: 'POST' }); location.reload(); }

async function loadLibrary() {
    const listDiv = document.getElementById('list');
    listDiv.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px;">Caricamento libreria...</div>';

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
        document.getElementById('totalStats').innerText = 'Ore totali: ' + Math.round(allGames.reduce((acc, g) => acc + g.playtime, 0) / 60) + 'h';
        render();
        updateCompletionSummary(allGames);
    } catch (e) { listDiv.innerHTML = 'Errore caricamento.'; }
}

function render() {
    const pageSize = parseInt(document.getElementById('maxGames').value) || 40;
    const term = document.getElementById('search').value.toLowerCase();
    const filtered = allGames.filter(g => g.name.toLowerCase().includes(term));
    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    document.getElementById('pageInfo').innerText = `Pagina ${currentPage + 1} / ${totalPages}`;
    const slice = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    document.getElementById('list').innerHTML = slice.map((g, index) => `
        <div class="card" id="card-${g.appid}" onclick="openPop('${g.appid}')" style="animation-delay: ${index * 0.03}s">
            <div class="img-container">
                <div class="badge-completed">Completato</div>
                <img src="${g.img}" loading="lazy" alt="${g.name}">
            </div>
            <div class="card-info">
                <div class="title" id="title-${g.appid}">${g.name}</div>
                <div class="meta">
                    <span id="ach-${g.appid}" data-tooltip="Obiettivi">
                        <span class="skeleton-inline" style="width:60px;height:12px;display:inline-block;vertical-align:middle;border-radius:6px;"></span>
                    </span>
                    <span id="dlc-${g.appid}" data-tooltip="DLC">📦 <span class="skeleton-inline" style="width:36px;height:12px;display:inline-block;vertical-align:middle;border-radius:6px;"></span></span>
                </div>
                <div class="prog-bg"><div id="bar-${g.appid}" class="prog-fill"></div></div>
            </div>
        </div>
    `).join('');
    fetchDetails(slice);
}

async function fetchDetails(games) {
    const appids = games.map(g => g.appid);
    const res = await fetch(`${API}/steam/achievements_bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appids })
    });
    const achs = await res.json();

    appids.forEach(async id => {
        const a = achs[id];
        const card = document.getElementById(`card-${id}`);
        const title = document.getElementById(`title-${id}`);
        const bar = document.getElementById(`bar-${id}`);
        const achText = document.getElementById(`ach-${id}`);
        const dlcEl = document.getElementById(`dlc-${id}`);

        if (a && a.t > 0) {
            const trophy = (a.u === a.t) ? ' <span style="color:var(--gold)">🏆</span>' : '';
            achText.innerHTML = `<b>${a.u}</b>/${a.t}${trophy}`;
            bar.style.width = (a.u / a.t * 100) + '%';
            if (a.u === a.t) {
                card.classList.add('completed');
                title.innerHTML = title.innerHTML.replace(' 🏆', '');
            } else {
                card.classList.remove('completed');
            }
        } else {
            achText.innerHTML = `<span style="font-size:0.8em; color:var(--muted);">Nessun obiettivo</span>`;
            bar.style.width = '100%';
            card.classList.add('no-achievements');
        }

        if (dlcEl) dlcEl.innerHTML = '📦 <span class="skeleton-inline" style="width:36px;height:12px;display:inline-block;vertical-align:middle;border-radius:6px;"></span>';

        try {
            const dRes = await fetch(`${API}/steam/game_details/${id}`);
            const d = await dRes.json();
            if (dlcEl) {
                if (typeof d.owned_dlc === 'number' && typeof d.total_dlc === 'number') dlcEl.innerHTML = `📦 ${d.owned_dlc}/${d.total_dlc}`;
                else if (d.total_dlc === 0) dlcEl.innerHTML = '📦 0/0';
                else dlcEl.innerHTML = '📦 —';
            }
        } catch (err) { if (dlcEl) dlcEl.innerHTML = '📦 —'; }
    });
}

async function updateCompletionSummary(games) {
    const percentText = document.getElementById('completionText');
    const bar = document.getElementById('completionBar');
    const barBg = document.getElementById('completionBarBg');
    const pctWrap = document.getElementById('completionPercent');

    if (!games || games.length === 0) {
        barBg.classList.remove('expanded');
        barBg.classList.add('loading');
        bar.classList.add('loading');
        percentText.innerText = '';
        pctWrap.classList.add('hidden');
        return;
    }

    barBg.classList.remove('expanded');
    barBg.classList.add('loading');
    bar.classList.remove('shimmer-effect');
    bar.classList.add('loading');
    percentText.innerText = '';
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
                bar.style.width = `${pct}%`;
                percentText.innerText = `${pct}% (${count} giochi analizzati)`;
            } else {
                bar.style.width = '0%';
                percentText.innerText = 'N/A';
            }
            pctWrap.classList.remove('hidden');
        }, 260);

    } catch (err) {
        bar.classList.remove('loading');
        barBg.classList.remove('loading');
        barBg.classList.add('expanded');
        bar.style.width = '0%';
        percentText.innerText = 'Errore nel calcolo';
        pctWrap.classList.remove('hidden');
    }
}

async function openPop(appid) {
    const g = allGames.find(x => x.appid === appid);
    document.getElementById('overlay').style.display = 'block';
    const popup = document.getElementById('popup');
    popup.style.display = 'flex';
    document.getElementById('popup-close-btn').style.display = 'block';
    document.getElementById('popup-content').innerHTML = 'Caricamento obiettivi...';
    const [schemaRes, playerRes] = await Promise.all([
        fetch(`${API}/steam/schema/${appid}`),
        fetch(`${API}/steam/player_achievements/${appid}`)
    ]);
    const schema = (await schemaRes.json()).achievements || [];
    const playerMap = (await playerRes.json()).achievements || {};
    let html = `<h3 style="color:var(--blue);margin-top:0;margin-bottom:15px;border-bottom:1px solid #e6e6e6;padding-bottom:10px;">${g.name}</h3>`;
    if (schema.length === 0) html += "<p>Nessun obiettivo.</p>";
    else {
        schema.forEach(a => {
            const p = playerMap[a.name] || playerMap[a.displayName] || { achieved: 0 };
            const unlocked = p.achieved === 1;
            html += `<div class="ach-item" style="${unlocked ? '' : 'opacity:0.6'}"><img src="${unlocked ? a.icon : a.icongray}"><div class="ach-text"><div class="ach-name" style="color:var(--text)">${a.displayName} ${unlocked ? '✅' : ''}</div><div class="ach-desc">${a.description || ''}</div></div></div>`;
        });
    }
    document.getElementById('popup-content').innerHTML = html;
}

function toggleTheme() {
    const body = document.body;
    const isLight = body.getAttribute('data-theme') === 'light';
    if (isLight) {
        body.removeAttribute('data-theme');
        document.getElementById('themeBtn').innerText = '🌙 Tema';
    } else {
        body.setAttribute('data-theme', 'light');
        document.getElementById('themeBtn').innerText = '☀️ Chiaro';
    }
}

document.getElementById('refreshBtn').onclick = async () => { await loadLibrary(); };
document.getElementById('prevBtn').onclick = () => { if (currentPage > 0) { currentPage--; render(); } };
document.getElementById('nextBtn').onclick = () => { currentPage++; render(); };
document.getElementById('search').oninput = () => { currentPage = 0; render(); };
window.onload = checkConfig;