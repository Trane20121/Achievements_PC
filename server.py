# Copyright (c) 2026 Trane2012
# 
# This software is released under the MIT License.
# https://opensource.org/licenses/MIT

import os
import json
import time
import re
import threading
import signal
import sys
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
STORE_CACHE_FILE      = os.path.join(CACHE_DIR, 'store_cache.json')   # ← NUOVO

ACH_TTL        = 12 * 3600
OWNED_LIST_TTL = 300
SCHEMA_TTL     = 48 * 3600
STORE_TTL      = 48 * 3600   # ← NUOVO: dati Store (genere, anno, is_free)
MAX_WORKERS    = 20

last_heartbeat = time.time()
HEARTBEAT_TIMEOUT = 30

# ─────────────────────────────────────────────
#  HELPERS JSON
# ─────────────────────────────────────────────
def _load_json(path):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def _save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def load_db():
    db = _load_json(DB_FILE)
    return db if db else {"steam_id": "", "tsa_profile_url": "", "ubisoft_games": []}

# ─────────────────────────────────────────────
#  CACHE LISTA GIOCHI POSSEDUTI
# ─────────────────────────────────────────────
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
    except:
        return entry.get('games', []) if entry else []

# ─────────────────────────────────────────────
#  CACHE DATI STORE (genere, anno, is_free)  ← NUOVO
# ─────────────────────────────────────────────
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
                result['genres'] = [g['description'] for g in d.get('genres', [])]
                # Anno di uscita
                rd = d.get('release_date', {})
                date_str = rd.get('date', '')
                if date_str:
                    # Cerca 4 cifre che iniziano con 19 o 20
                    m = re.search(r'(19|20)\d{2}', date_str)
                    if m:
                        result['release_year'] = int(m.group(0))
                    else:
                        # Se non trova l'anno (es. "TBA"), mettiamo un valore nullo
                        result['release_year'] = None
    except:
        pass

    cache[key] = {'ts': now, 'data': result}
    _save_json(STORE_CACHE_FILE, cache)
    return result

# ─────────────────────────────────────────────
#  CACHE ACHIEVEMENTS PLAYER
# ─────────────────────────────────────────────
def fetch_player_achievements_cached(key, sid, appid):
    cache = _load_json(ACH_CACHE_FILE)
    now = int(time.time())
    cache_key = f"{sid}:{appid}"
    if cache_key in cache and (cache[cache_key].get('ts', 0) + ACH_TTL) > now:
        return cache[cache_key].get('summary', {'u': 0, 't': 0})

    unlocked, total = 0, 0
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
            f"?key={key}&steamid={sid}&appid={appid}"
        )
        r = requests.get(url, timeout=7)
        if r.status_code == 200:
            achs = r.json().get('playerstats', {}).get('achievements', []) or []
            total = len(achs)
            unlocked = sum(1 for a in achs if a.get('achieved') == 1)
    except:
        pass

    res = {'u': unlocked, 't': total}
    cache[cache_key] = {'ts': now, 'summary': res}
    _save_json(ACH_CACHE_FILE, cache)
    return res

# ─────────────────────────────────────────────
#  HEARTBEAT / WATCHDOG / GOODBYE
# ─────────────────────────────────────────────
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

# ─────────────────────────────────────────────
#  STATIC / INDEX
# ─────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# ─────────────────────────────────────────────
#  STEAM LOGIN (OpenID)
# ─────────────────────────────────────────────
@app.route('/api/steam/login')
def steam_login():
    params = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': url_for('steam_return', _external=True),
        'openid.realm': request.host_url.rstrip('/'),
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    }
    return redirect('https://steamcommunity.com/openid/login?' + urlencode(params))

@app.route('/api/steam/return')
def steam_return():
    claimed = request.args.get('openid.claimed_id', '')
    m = re.search(r'/id/([0-9]+)/?$', claimed) or re.search(r'/profiles/([0-9]+)/?$', claimed)
    if m:
        db = load_db()
        db['steam_id'] = m.group(1)
        _save_json(DB_FILE, db)
    return redirect('/')

# ─────────────────────────────────────────────
#  API DATA
# ─────────────────────────────────────────────
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

# ─────────────────────────────────────────────
#  GAMES SUMMARY  ← aggiornato con store data
# ─────────────────────────────────────────────
@app.route('/api/steam/games_summary')
def games_summary():
    sid = load_db().get('steam_id')
    if not sid:
        return jsonify({"error": "No SID"}), 400

    games = get_owned_games_list_cached(sid)
    store_cache = _load_json(STORE_CACHE_FILE)
    
    out = []
    for g in games:
        appid = str(g['appid'])
        # Prendi dalla cache se c'è, altrimenti metti valori vuoti temporanei
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

    # Avvia il popolamento della cache in un thread separato per non bloccare la risposta
    def populate_cache_bg(appids):
        for aid in appids:
            fetch_store_details_cached(aid)
            time.sleep(0.2) # Rispetta i limiti di Steam

    needing_cache = [str(g['appid']) for g in games if str(g['appid']) not in store_cache]
    if needing_cache:
        threading.Thread(target=populate_cache_bg, args=(needing_cache,), daemon=True).start()

    return jsonify({"total_count": len(out), "games": out})

# ─────────────────────────────────────────────
#  ACHIEVEMENTS BULK
# ─────────────────────────────────────────────
@app.route('/api/steam/achievements_bulk', methods=['POST'])
def ach_bulk():
    sid = load_db().get('steam_id')
    appids = request.json.get('appids', [])
    res = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_player_achievements_cached, STEAM_API_KEY, sid, aid): aid for aid in appids}
        for f in as_completed(futures):
            res[futures[f]] = f.result()
    return jsonify(res)

# ─────────────────────────────────────────────
#  SCHEMA ACHIEVEMENTS
# ─────────────────────────────────────────────
@app.route('/api/steam/schema/<appid>')
def steam_schema(appid):
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

# ─────────────────────────────────────────────
#  PLAYER ACHIEVEMENTS
# ─────────────────────────────────────────────
@app.route('/api/steam/player_achievements/<appid>')
def player_achievements(appid):
    sid = load_db().get('steam_id')
    if not sid:
        return jsonify({"error": "No SID"}), 400
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
            f"?key={STEAM_API_KEY}&steamid={sid}&appid={appid}&l=italian"
        )
        r = requests.get(url, timeout=10)
        achs = r.json().get('playerstats', {}).get('achievements', []) or []
        ach_map = {a['apiname']: {'achieved': a.get('achieved', 0), 'unlocktime': a.get('unlocktime', 0)} for a in achs}
        return jsonify({'achievements': ach_map})
    except Exception as e:
        return jsonify({'achievements': {}, 'error': str(e)})

# ─────────────────────────────────────────────
#  GLOBAL ACHIEVEMENT PERCENTAGES
# ─────────────────────────────────────────────
@app.route('/api/steam/global_ach/<appid>')
def global_ach(appid):
    try:
        url = (
            f"https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/"
            f"?gameid={appid}"
        )
        r = requests.get(url, timeout=10)
        achs = r.json().get('achievementpercentages', {}).get('achievements', []) or []
        pct_map = {a['name'].lower(): round(a.get('percent', 0), 2) for a in achs}
        return jsonify({'percentages': pct_map})
    except Exception as e:
        return jsonify({'percentages': {}, 'error': str(e)})

# ─────────────────────────────────────────────
#  STEAM PROFILE
# ─────────────────────────────────────────────
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

# ─────────────────────────────────────────────
#  STEAM LOGOUT
# ─────────────────────────────────────────────
@app.route('/api/steam/logout', methods=['POST'])
def steam_logout():
    db = load_db()
    db['steam_id'] = ''
    _save_json(DB_FILE, db)
    return jsonify({'status': 'ok'})

# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
if __name__ == '__main__':
    threading.Thread(target=watchdog, daemon=True).start()
    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:5000")).start()
    serve(app, host='127.0.0.1', port=5000)
