# Copyright (c) 2026 Trane2012
# 
# This software is released under the MIT License.
# https://opensource.org/licenses/MIT

# server.py (revisione: usa cartella "static" per assets)
import os
import json
import time
import re
from urllib.parse import urlencode
from flask import Flask, jsonify, request, redirect, send_from_directory, url_for
from flask_cors import CORS
import requests
import requests_cache
from concurrent.futures import ThreadPoolExecutor, as_completed

# Hardcoded Steam API key (kept as requested).
STEAM_API_KEY = "32191D6A0AA3C7AE0C4DE2EE70B8E2C9"

requests_cache.install_cache('steam_cache', backend='sqlite', expire_after=3600)

# CONFIGURAZIONE CARTELLA STATIC
app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

DB_FILE = 'database.json'
CACHE_DIR = 'cache'
os.makedirs(CACHE_DIR, exist_ok=True)

APPDETAILS_CACHE_FILE = os.path.join(CACHE_DIR, 'appdetails_cache.json')
ACH_CACHE_FILE = os.path.join(CACHE_DIR, 'achievements_cache.json')
OWNED_CACHE_FILE = os.path.join(CACHE_DIR, 'owned_cache.json')
OWNED_LIST_CACHE_FILE = os.path.join(CACHE_DIR, 'owned_list_cache.json')
SCHEMA_CACHE_FILE = os.path.join(CACHE_DIR, 'schema_cache.json')

APPDETAILS_TTL = 24 * 3600
ACH_TTL = 6 * 3600
OWNED_TTL = 5 * 60
OWNED_LIST_TTL = 60
SCHEMA_TTL = 24 * 3600
MAX_WORKERS = 10

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
    if not db:
        db = {"steam_id": "", "tsa_profile_url": "", "ubisoft_games": []}
    return db

# --- FUNZIONI HELPER (Invariate) ---

def get_owned_games_list_cached(steamid):
    cache = _load_json(OWNED_LIST_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_LIST_TTL) > now:
        return entry.get('games', [])
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={STEAM_API_KEY}&steamid={steamid}&include_appinfo=true&include_played_free_games=true"
        r = requests.get(url, timeout=12)
        games = r.json().get('response', {}).get('games', []) or []
        games.sort(key=lambda x: x.get('playtime_forever', 0), reverse=True)
        cache[steamid] = {'ts': now, 'games': games}
        _save_json(OWNED_LIST_CACHE_FILE, cache)
        return games
    except:
        return []

def get_owned_appids_cached(steamid):
    cache = _load_json(OWNED_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_TTL) > now:
        return set(entry.get('owned', []))
    owned = set()
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={STEAM_API_KEY}&steamid={steamid}&include_appinfo=false&include_played_free_games=true"
        r = requests.get(url, timeout=10)
        for g in r.json().get('response', {}).get('games', []):
            owned.add(str(g.get('appid')))
    except:
        pass
    cache[steamid] = {'ts': now, 'owned': list(owned)}
    _save_json(OWNED_CACHE_FILE, cache)
    return owned

def fetch_appdetails_cached(appid):
    cache = _load_json(APPDETAILS_CACHE_FILE)
    now = int(time.time())
    if appid in cache and (cache[appid].get('ts', 0) + APPDETAILS_TTL) > now:
        return cache[appid].get('data', {})
    try:
        r = requests.get(f"https://store.steampowered.com/api/appdetails?appids={appid}", timeout=8)
        j = r.json()
        if j and j.get(str(appid), {}).get('success'):
            data = j[str(appid)]['data']
            cache[appid] = {'ts': now, 'data': data}
            _save_json(APPDETAILS_CACHE_FILE, cache)
            return data
    except:
        pass
    return {}

def fetch_schema_cached(appid, lang='italian'):  
    cache = _load_json(SCHEMA_CACHE_FILE)  
    now = int(time.time())  
    cache_key = f"{appid}:{lang}"  
    entry = cache.get(cache_key)  
    if entry and (entry.get('ts', 0) + SCHEMA_TTL) > now:  
        return entry.get('data', [])  
  
    try:  
        # Usa la variabile STEAM_API_KEY corretta e passa il parametro l=lang  
        url = f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={STEAM_API_KEY}&appid={appid}&l={lang}"  
        r = requests.get(url, timeout=10)  
        j = r.json()  
        achs = j.get('game', {}).get('availableGameStats', {}).get('achievements', []) or []  
        normalized = []  
        for a in achs:  
            normalized.append({  
                'name': a.get('name'),  
                'displayName': a.get('displayName') or a.get('name'),  
                'description': a.get('description') or '',  
                'icon': a.get('icon') or '',  
                'icongray': a.get('icongray') or ''  
            })  
        cache[cache_key] = {'ts': now, 'data': normalized}  
        _save_json(SCHEMA_CACHE_FILE, cache)  
        return normalized  
    except Exception:  
        return []

def fetch_player_achievements(key, sid, appid):
    try:
        url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}"
        r = requests.get(url, timeout=10)
        j = r.json()
        achs = j.get('playerstats', {}).get('achievements', []) or []
        mapping = {}
        for a in achs:
            apiname = a.get('apiname') or a.get('name')
            mapping[apiname] = {
                'achieved': int(a.get('achieved', 0)),
                'unlocktime': int(a.get('unlocktime', 0)) if a.get('unlocktime') else 0
            }
        return mapping
    except:
        return {}

def fetch_player_achievements_cached(key, sid, appid):
    cache = _load_json(ACH_CACHE_FILE)
    now = int(time.time())
    key_cache = f"{sid}:{appid}"
    if key_cache in cache and (cache[key_cache].get('ts', 0) + ACH_TTL) > now:
        return cache[key_cache].get('summary', {'u':0, 't':0})
    try:
        url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}"
        r = requests.get(url, timeout=5)
        achs = r.json().get('playerstats', {}).get('achievements', []) or []
        u = sum(1 for a in achs if a.get('achieved') == 1)
        t = len(achs)
        cache[key_cache] = {'ts': now, 'summary': {'u': u, 't': t}}
        _save_json(ACH_CACHE_FILE, cache)
        return {'u': u, 't': t}
    except:
        return {'u': 0, 't': 0}

# --- ROUTE PER I FILE STATICI ---

@app.route('/')
def index():
    # Serve index.html dalla cartella static
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # Serve altri file (css, js) dalla cartella static
    return send_from_directory('static', path)

# --- API ROUTES ---

@app.route('/api/steam/login', methods=['GET'])
def steam_login():
    return_to = url_for('steam_return', _external=True)
    realm = request.host_url.rstrip('/')
    params = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': return_to,
        'openid.realm': realm,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    }
    steam_openid = 'https://steamcommunity.com/openid/login?' + urlencode(params)
    return redirect(steam_openid)

@app.route('/api/steam/return', methods=['GET', 'POST'])
def steam_return():
    data = {}
    data.update(request.args.to_dict(flat=True))
    data.update(request.form.to_dict(flat=True))

    if not data:
        return "OpenID response vuota", 400

    verify = dict(data)
    verify['openid.mode'] = 'check_authentication'

    try:
        r = requests.post('https://steamcommunity.com/openid/login', data=verify, timeout=10)
        if r.status_code == 200 and 'is_valid:true' in r.text:
            claimed = data.get('openid.claimed_id') or data.get('openid.identity') or ''
            # CORREZIONE REGEX PER ESTRARRE STEAMID
            m = re.search(r'/id/([0-9]+)/?$', claimed)
            if not m:
                m = re.search(r'/profiles/([0-9]+)/?$', claimed)
            
            if m:
                steamid = m.group(1)
                db = load_db()
                db['steam_id'] = steamid
                _save_json(DB_FILE, db)
                return redirect('/')
        return "Login Steam fallito o non valido", 400
    except Exception as e:
        return f"Errore di verifica OpenID: {str(e)}", 500

@app.route('/api/config', methods=['POST'])
def api_config():
    db = load_db()
    payload = request.json or {}
    if 'steam_id' in payload:
        db['steam_id'] = payload.get('steam_id')
    if 'tsa_profile_url' in payload:
        db['tsa_profile_url'] = payload.get('tsa_profile_url')
    if 'ubisoft_games' in payload:
        db['ubisoft_games'] = payload.get('ubisoft_games')
    _save_json(DB_FILE, db)
    return jsonify({"status": "ok"})

@app.route('/api/data', methods=['GET'])
def api_data():
    db = load_db()
    return jsonify(db)

@app.route('/api/steam/profile', methods=['GET'])
def steam_profile():
    db = load_db()
    sid = db.get('steam_id')
    if not sid:
        return jsonify({'error': 'Missing SteamID'}), 400
    try:
        url = f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={STEAM_API_KEY}&steamids={sid}"
        r = requests.get(url, timeout=8)
        players = r.json().get('response', {}).get('players', []) or []
        if not players:
            return jsonify({'error': 'No player data'}), 404
        p = players[0]
        return jsonify({
            'steamid': p.get('steamid'),
            'persona_name': p.get('personaname'),
            'avatar': p.get('avatarfull'),
            'profileurl': p.get('profileurl')
        })
    except Exception as e:
        return jsonify({'error': 'Failed to fetch profile', 'detail': str(e)}), 500

@app.route('/api/steam/games_summary', methods=['GET'])
def games_summary():
    db = load_db()
    sid = db.get('steam_id')
    if not sid:
        return jsonify({"error": "Missing SteamID configuration"}), 400
    games = get_owned_games_list_cached(sid)
    out = [{"appid": str(g['appid']), "name": g.get('name', 'Unknown'), "playtime": g.get('playtime_forever', 0), "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{g['appid']}/header.jpg"} for g in games]
    return jsonify({"total_count": len(out), "games": out})

@app.route('/api/steam/achievements_bulk', methods=['POST'])
def ach_bulk():
    db = load_db()
    sid = db.get('steam_id')
    if not sid:
        return jsonify({"error": "Missing SteamID configuration"}), 400
    appids = request.json.get('appids', [])
    res = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_player_achievements_cached, STEAM_API_KEY, sid, aid): aid for aid in appids}
        for f in as_completed(futures):
            res[futures[f]] = f.result()
    return jsonify(res)

@app.route('/api/steam/game_details/<appid>', methods=['GET'])
def game_details(appid):
    db = load_db()
    sid = db.get('steam_id')
    data = fetch_appdetails_cached(appid)
    dlc_list = [str(x) for x in data.get('dlc', [])]
    owned_set = get_owned_appids_cached(sid) if sid else set()
    owned_count = sum(1 for d in dlc_list if str(d) in owned_set)
    return jsonify({"total_dlc": len(dlc_list), "owned_dlc": owned_count, "source": "steam"})

@app.route('/api/steam/schema/<appid>', methods=['GET'])  
def api_schema(appid):  
    # Codici lato client come 'it'/'en' -> mappa ai nomi Steam aspettati  
    lang_param = request.args.get('l', 'en')  
    lang_map = {  
        'en': 'english',  
        'it': 'italian',  
        'fr': 'french',  
        'de': 'german',  
        'es': 'spanish',  
        'pt': 'portuguese',  
        'ru': 'russian',  
        'zh': 'schinese',
        'jp': 'japanese',
    }  
    steam_lang = lang_map.get(lang_param.lower(), lang_param)  
    data = fetch_schema_cached(appid, steam_lang)  
    return jsonify({'achievements': data})

@app.route('/api/steam/player_achievements/<appid>', methods=['GET'])
def api_player_achievements(appid):
    db = load_db()
    sid = db.get('steam_id')
    if not sid:
        return jsonify({'error': 'Missing SteamID in config'}), 400
    data = fetch_player_achievements(STEAM_API_KEY, sid, appid)
    return jsonify({'achievements': data})

@app.route('/api/steam/logout', methods=['POST'])
def api_logout():
    db = load_db()
    db['steam_id'] = ""
    _save_json(DB_FILE, db)
    return jsonify({'status': 'ok'})

@app.route('/api/steam/schema/<appid>')  
def get_schema(appid):  
    lang = request.args.get('l', 'en')  # Prende il parametro 'l' o default 'en'  
    # Chiamata all'API Steam con parametro lingua  
    steam_url = f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid={appid}&l={lang}&key=YOUR_STEAM_KEY"  
    response = requests.get(steam_url)  
    return jsonify(response.json())

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)