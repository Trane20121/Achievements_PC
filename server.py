# Copyright (c) 2026 Trane2012
# This software is released under the MIT License.
# https://opensource.org/licenses/MIT

import os
import json
import time
import re
import threading
import sys
import unicodedata
from urllib.parse import urlencode
from flask import Flask, jsonify, request, redirect, send_from_directory, url_for
from flask_cors import CORS
import requests
import requests_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
import webbrowser
from waitress import serve

# CONFIGURAZIONE
STEAM_API_KEY = "32191D6A0AA3C7AE0C4DE2EE70B8E2C9"
requests_cache.install_cache('steam_cache', backend='sqlite', expire_after=7200)

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

DB_FILE = 'database.json'
CACHE_DIR = 'cache'
os.makedirs(CACHE_DIR, exist_ok=True)

ACH_CACHE_FILE        = os.path.join(CACHE_DIR, 'achievements_cache.json')
OWNED_LIST_CACHE_FILE = os.path.join(CACHE_DIR, 'owned_list_cache.json')
SCHEMA_CACHE_FILE     = os.path.join(CACHE_DIR, 'schema_cache.json')
STORE_CACHE_FILE      = os.path.join(CACHE_DIR, 'store_cache.json')

ACH_TTL        = 12 * 3600
OWNED_LIST_TTL = 300
SCHEMA_TTL     = 48 * 3600
STORE_TTL      = 48 * 3600
MAX_WORKERS    = 20

last_heartbeat = time.time()
HEARTBEAT_TIMEOUT = 30

# HELPERS JSON
def _load_json(path):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def load_db():
    db = _load_json(DB_FILE)
    return db if db else {"steam_id": "", "tsa_profile_url": "", "ubisoft_games": []}

# Normalizzazione stringhe - rimuove diacritici, non-alnum e abbassa
def normalize_key(s):
    if not s:
        return ""
    try:
        s = str(s)
        nk = unicodedata.normalize("NFD", s)
        nk = nk.encode("ascii", "ignore").decode("ascii")
        nk = re.sub(r'[^a-zA-Z0-9]', '', nk)
        return nk.lower()
    except Exception:
        return re.sub(r'[^a-z0-9]', '', str(s).lower())

# CACHE LISTA GIOCHI POSSEDUTI
def get_owned_games_list_cached(steamid):
    cache = _load_json(OWNED_LIST_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_LIST_TTL) > now:
        return entry.get('games', [])
    try:
        url = (
            f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
            f"?key={STEAM_API_KEY}&steamid={steamid}"
            f"&include_appinfo=true&include_played_free_games=true"
        )
        r = requests.get(url, timeout=10)
        games = r.json().get('response', {}).get('games', []) or []
        cache[steamid] = {'ts': now, 'games': games}
        _save_json(OWNED_LIST_CACHE_FILE, cache)
        return games
    except Exception:
        return entry.get('games', []) if entry else []

# CACHE DATI STORE (genere, anno, is_free)
def fetch_store_details_cached(appid):
    """
    Restituisce dict con:
      - release_year: int | None
      - genres: list[str]
      - is_free: bool
    Usa cache locale con TTL di 48h.
    """
    cache = _load_json(STORE_CACHE_FILE)
    now = int(time.time())
    key = str(appid)

    if key in cache and (cache[key].get('ts', 0) + STORE_TTL) > now:
        return cache[key].get('data', {})

    result = {'release_year': None, 'genres': [], 'is_free': False}
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic,genres,release_date"
        r = requests.get(url, timeout=8)
        if r.status_code == 200:
            payload = r.json().get(str(appid), {})
            if payload.get('success'):
                d = payload.get('data', {})
                result['is_free'] = bool(d.get('is_free', False))
                # Generi
                result['genres'] = [g.get('description') for g in d.get('genres', [])]
                # Anno di uscita
                rd = d.get('release_date', {})
                date_str = rd.get('date', '')
                if date_str:
                    m = re.search(r'(19|20)\d{2}', date_str)
                    if m:
                        result['release_year'] = int(m.group(0))
                    else:
                        result['release_year'] = None
    except Exception:
        pass

    cache[key] = {'ts': now, 'data': result}
    _save_json(STORE_CACHE_FILE, cache)
    return result

# CACHE ACHIEVEMENTS PLAYER (solo summary: unlocked/total)
def fetch_player_achievements_cached(key, sid, appid, lang='english'):
    cache = _load_json(ACH_CACHE_FILE)
    now = int(time.time())
    cache_key = f"{sid}:{appid}:{lang}"
    if cache_key in cache and (cache[cache_key].get('ts', 0) + ACH_TTL) > now:
        return cache[cache_key].get('summary', {'u': 0, 't': 0})

    unlocked, total = 0, 0
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
            f"?key={key}&steamid={sid}&appid={appid}&l={lang}"
        )
        r = requests.get(url, timeout=7)
        if r.status_code == 200:
            achs = r.json().get('playerstats', {}).get('achievements', []) or []
            total = len(achs)
            unlocked = sum(1 for a in achs if a.get('achieved') == 1)
    except Exception:
        pass

    res = {'u': unlocked, 't': total}
    cache[cache_key] = {'ts': now, 'summary': res}
    _save_json(ACH_CACHE_FILE, cache)
    return res

# HEARTBEAT / WATCHDOG / GOODBYE
@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    global last_heartbeat
    last_heartbeat = time.time()
    return jsonify({'status': 'ok'})

@app.route('/api/goodbye', methods=['POST'])
def goodbye():
    os._exit(0)

def watchdog():
    time.sleep(20)
    while True:
        time.sleep(5)
        if (time.time() - last_heartbeat) > HEARTBEAT_TIMEOUT:
            os._exit(0)

# STATIC / INDEX
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# STEAM LOGIN (OpenID)
@app.route('/api/steam/login', methods=['GET'])
def steam_login():
    return_to = url_for('steam_return', _external=True)
    realm = request.host_url.rstrip('/') + '/'

    params = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': return_to,
        'openid.realm': realm,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    }
    auth_url = 'https://steamcommunity.com/openid/login?' + urlencode(params)
    return redirect(auth_url)

@app.route('/api/steam/return')
def steam_return():
    claimed = request.args.get('openid.claimed_id', '')
    m = re.search(r'/id/([0-9]+)/?$', claimed) or re.search(r'/profiles/([0-9]+)/?$', claimed)
    if m:
        db = load_db()
        db['steam_id'] = m.group(1)
        _save_json(DB_FILE, db)
    return redirect('/')

# API DATA
@app.route('/api/data')
def api_data():
    return jsonify(load_db())

@app.route('/api/config', methods=['POST'])
def api_config():
    db = load_db()
    body = request.json or {}
    if 'steam_id' in body:
        db['steam_id'] = body['steam_id']
    _save_json(DB_FILE, db)
    return jsonify({'status': 'ok'})

# GAMES SUMMARY
@app.route('/api/steam/games_summary')
def games_summary():
    try:
        sid = load_db().get('steam_id')
        if not sid:
            return jsonify({"error": "No SID"}), 400

        games = get_owned_games_list_cached(sid)
        store_cache = _load_json(STORE_CACHE_FILE)

        out = []
        for g in games:
            appid = str(g['appid'])
            cached_entry = store_cache.get(appid, {}).get('data', {})

            out.append({
                "appid":        appid,
                "name":         g.get('name', 'Unknown'),
                "playtime":     g.get('playtime_forever', 0),
                "last_played":  g.get('rtime_last_played') or g.get('last_played') or 0,
                "img":          f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
                "release_year": cached_entry.get('release_year'),
                "genres":       cached_entry.get('genres', []),
                "is_free":      cached_entry.get('is_free', False)
            })

        # Popolamento cache store in background (non blocca la risposta)
        def populate_cache_bg(appids):
            for aid in appids:
                try:
                    fetch_store_details_cached(aid)
                except Exception:
                    pass
                time.sleep(0.2)

        needing_cache = [str(g['appid']) for g in games if str(g['appid']) not in store_cache]
        if needing_cache:
            threading.Thread(target=populate_cache_bg, args=(needing_cache,), daemon=True).start()

        return jsonify({"total_count": len(out), "games": out})
    except Exception as e:
        print("games_summary error:", e, file=sys.stderr)
        return jsonify({"error": "internal", "details": str(e)}), 500

# ACHIEVEMENTS BULK
@app.route('/api/steam/achievements_bulk', methods=['POST'])
def ach_bulk():
    sid = load_db().get('steam_id')
    appids = request.json.get('appids', []) or []
    res = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_player_achievements_cached, STEAM_API_KEY, sid, aid): aid for aid in appids}
        for f in as_completed(futures):
            try:
                res[futures[f]] = f.result()
            except Exception:
                res[futures[f]] = {'u': 0, 't': 0}
    return jsonify(res)

# SCHEMA ACHIEVEMENTS
@app.route('/api/steam/schema/<appid>')
def steam_schema(appid):
    # Il client può passare ?l=russian|english|schinese ecc.
    lang = request.args.get('l', 'english')
    cache = _load_json(SCHEMA_CACHE_FILE)
    now = int(time.time())
    key = f"{appid}:{lang}"
    if key in cache and (cache[key].get('ts', 0) + SCHEMA_TTL) > now:
        return jsonify(cache[key].get('data', {}))
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
            f"?key={STEAM_API_KEY}&appid={appid}&l={lang}"
        )
        r = requests.get(url, timeout=10)
        data = r.json().get('game', {}).get('availableGameStats', {})
        achs = data.get('achievements', [])
        result = {'achievements': achs}
        cache[key] = {'ts': now, 'data': result}
        _save_json(SCHEMA_CACHE_FILE, cache)
        return jsonify(result)
    except Exception as e:
        return jsonify({'achievements': [], 'error': str(e)})

# PLAYER ACHIEVEMENTS
@app.route('/api/steam/player_achievements/<appid>')
def player_achievements(appid):
    # Accetta ?l=russian|english|schinese ecc. (passato dal client)
    lang = request.args.get('l', 'english')
    sid = load_db().get('steam_id')
    if not sid:
        return jsonify({"error": "No SID"}), 400
    try:
        # Includiamo il parametro l per chiedere a Steam i testi nella lingua richiesta.
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
            f"?key={STEAM_API_KEY}&steamid={sid}&appid={appid}&l={lang}"
        )
        r = requests.get(url, timeout=10)
        data = r.json()
        achs = data.get('playerstats', {}).get('achievements', []) or []
        # Mappiamo per apiname (o name), ma restituiamo la struttura completa che il client aspetta
        ach_map = {}
        for a in achs:
            key_name = a.get('apiname') or a.get('name') or ''
            if not key_name:
                continue
            ach_map[key_name] = {
                'achieved': a.get('achieved', 0),
                'unlocktime': a.get('unlocktime', 0),
                'name': a.get('name', ''),
                'description': a.get('description', '')
            }
        return jsonify({'achievements': ach_map})
    except Exception as e:
        return jsonify({'achievements': {}, 'error': str(e)})

# GLOBAL ACHIEVEMENT PERCENTAGES
@app.route('/api/steam/global_ach/<appid>')
def global_ach(appid):
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/"
            f"?gameid={appid}"
        )
        r = requests.get(url, timeout=10)
        achs = r.json().get('achievementpercentages', {}).get('achievements', []) or []

        pct_map = {}
        for a in achs:
            # estrai chiavi
            name = a.get('name') or ''
            display = a.get('displayName') or a.get('displayname') or ''

            # estrai percent e converti in float in modo robusto
            raw_pct = a.get('percent', 0)
            val = 0.0
            try:
                if isinstance(raw_pct, str):
                    cleaned = re.sub(r'[^\d\.,\-]+', '', raw_pct)
                    cleaned = cleaned.replace(',', '.')
                    val = float(cleaned) if cleaned != '' else 0.0
                else:
                    val = float(raw_pct)
            except Exception:
                try:
                    val = float(str(raw_pct))
                except Exception:
                    val = 0.0

            # arrotonda a 2 decimali (manteniamo precisione)
            val = round(val, 2)

            # costruisci insiemi di chiavi possibili per matching client
            keys = set()
            if name:
                keys.add(name.lower())
                keys.add(re.sub(r'\s+', '', name.lower()))
                keys.add(normalize_key(name))
            if display:
                keys.add(display.lower())
                keys.add(re.sub(r'\s+', '', display.lower()))
                keys.add(normalize_key(display))

            # inserisci in mappa, evita sovrascritture indesiderate (mantieni primo valore)
            for k in keys:
                if k and k not in pct_map:
                    try:
                        pct_map[k] = val
                    except Exception:
                        pct_map[k] = val

        return jsonify({'percentages': pct_map})
    except Exception as e:
        return jsonify({'percentages': {}, 'error': str(e)})

# STEAM PROFILE
@app.route('/api/steam/profile')
def steam_profile():
    sid = load_db().get('steam_id')
    if not sid:
        return jsonify({"error": "No SID"}), 400
    try:
        url = (
            f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
            f"?key={STEAM_API_KEY}&steamids={sid}"
        )
        r = requests.get(url, timeout=10)
        players = r.json().get('response', {}).get('players', [])
        if not players:
            return jsonify({"error": "Player not found"}), 404
        p = players[0]
        return jsonify({
            'persona_name': p.get('personaname', ''),
            'avatar':       p.get('avatarfull', ''),
            'profileurl':   p.get('profileurl', ''),
            'personastate': p.get('personastate', 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# GAMES FILTERED (route completa e robusta)
@app.route('/api/games_filtered', methods=['POST'])
def games_filtered():
    sid = load_db().get('steam_id')
    if not sid:
        return jsonify({"error": "No SID"}), 400

    data = request.json or {}
    filters = data.get('filters', {}) or {}
    page = int(data.get('page', 1) or 1)
    per_page = int(data.get('per_page', 50) or 50)
    sort_by = data.get('sort_by', 'played') or 'played'

    games = get_owned_games_list_cached(sid)
    store_cache = _load_json(STORE_CACHE_FILE)

    extended_games = []
    for g in games:
        appid = str(g['appid'])
        cached_entry = store_cache.get(appid, {}).get('data', {})
        extended_games.append({
            "appid": appid,
            "name": g.get('name', 'Unknown'),
            "playtime": g.get('playtime_forever', 0),
            "last_played": g.get('rtime_last_played') or g.get('last_played') or 0,
            "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
            "release_year": cached_entry.get('release_year'),
            "genres": cached_entry.get('genres', []),
            "is_free": cached_entry.get('is_free', False)
        })

    summaries = {}
    need_ach = any(k in filters for k in ['achievement_status', 'completed', 'in_progress'])
    if need_ach and extended_games:
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(extended_games))) as ex:
            futures = {ex.submit(fetch_player_achievements_cached, STEAM_API_KEY, sid, g['appid']): g['appid'] for g in extended_games}
            for f in as_completed(futures):
                try:
                    summaries[futures[f]] = f.result()
                except Exception:
                    summaries[futures[f]] = {'u': 0, 't': 0}

    def check_match(game):
        try:
            now = int(time.time())

            # Ricerca testuale
            q = (filters.get('query') or "").strip().lower()
            if q:
                name = (game.get('name') or "").lower()
                genres = [gn.lower() for gn in (game.get('genres') or [])]
                year = str(game.get('release_year') or "")
                if q not in name and not any(q in gn for gn in genres) and q not in year:
                    return False

            # Playtime (ore) — il client passa ore, il campo playtime è in minuti
            min_h = float(filters.get('playtime_min', 0) or 0)
            max_h = float(filters.get('playtime_max', 200) or 200)

            # Interpretazione: valore 200 (default UI) significa "200 o più" => trattalo come infinito
            if max_h >= 200:
                max_h = 9999999.0

            game_h = (game.get('playtime') or 0) / 60.0
            if not (min_h <= game_h <= max_h):
                return False

            # Anno
            min_y = filters.get('min_year')
            max_y = filters.get('max_year')
            gy = game.get('release_year')
            if gy is not None:
                if min_y is not None and gy < int(min_y): return False
                if max_y is not None and gy > int(max_y): return False

            # Genere
            target_genre = filters.get('genre')
            if target_genre and target_genre != 'all':
                if target_genre.lower() not in [gn.lower() for gn in game.get('genres', [])]:
                    return False

            # is_free
            if 'is_free' in filters and filters.get('is_free') is not None:
                if bool(game.get('is_free')) != bool(filters.get('is_free')):
                    return False

            # Achievements status
            if need_ach:
                s = summaries.get(game['appid'], {'u': 0, 't': 0})
                u, t = int(s.get('u', 0)), int(s.get('t', 0))
                stat = 'noach' if t == 0 else ('completed' if u >= t else 'inprogress')

                allowed = set(filters.get('achievement_status') or [])
                if filters.get('completed'): allowed.add('completed')
                if filters.get('in_progress'): allowed.add('inprogress')

                if allowed and stat not in allowed:
                    return False

            return True
        except Exception:
            return False

    filtered = [g for g in extended_games if check_match(g)]

    if sort_by == 'played':
        filtered.sort(key=lambda x: int(x.get('playtime', 0)), reverse=True)
    elif sort_by == 'name':
        filtered.sort(key=lambda x: (x.get('name') or "").lower())
    elif sort_by == 'release_year':
        filtered.sort(key=lambda x: x.get('release_year') or 0, reverse=True)

    total = len(filtered)
    start = (page - 1) * per_page
    paged = filtered[start: start + per_page]

    # Popola cache store in background
    def populate_cache_bg(appids):
        for aid in appids:
            try:
                fetch_store_details_cached(aid)
            except Exception:
                pass
            time.sleep(0.2)

    needing_cache = [str(g['appid']) for g in extended_games if str(g['appid']) not in store_cache]
    if needing_cache:
        threading.Thread(target=populate_cache_bg, args=(needing_cache,), daemon=True).start()

    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "results": paged
    })

# STEAM LOGOUT
@app.route('/api/steam/logout', methods=['POST'])
def steam_logout():
    db = load_db()
    db['steam_id'] = ''
    _save_json(DB_FILE, db)
    return jsonify({'status': 'ok'})

# MAIN
if __name__ == '__main__':
    threading.Thread(target=watchdog, daemon=True).start()
    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:5000")).start()
    serve(app, host='127.0.0.1', port=5000)