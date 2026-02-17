import os, json, time, re, threading
from urllib.parse import urljoin
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import requests_cache
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

requests_cache.install_cache('steam_cache', backend='sqlite', expire_after=3600)

app = Flask(__name__)
CORS(app)

DB_FILE = 'database.json'
CACHE_DIR = 'cache'
os.makedirs(CACHE_DIR, exist_ok=True)

SCRAPE_CACHE_FILE = os.path.join(CACHE_DIR, 'scrape_dlc_cache.json')
APPDETAILS_CACHE_FILE = os.path.join(CACHE_DIR, 'appdetails_cache.json')
ACH_CACHE_FILE = os.path.join(CACHE_DIR, 'achievements_cache.json')
OWNED_CACHE_FILE = os.path.join(CACHE_DIR, 'owned_cache.json')
OWNED_LIST_CACHE_FILE = os.path.join(CACHE_DIR, 'owned_list_cache.json')
TSA_CACHE_FILE = os.path.join(CACHE_DIR, 'tsa_cache.json')
SCHEMA_CACHE_FILE = os.path.join(CACHE_DIR, 'schema_cache.json')

SCRAPE_TTL = 24 * 3600
APPDETAILS_TTL = 24 * 3600
ACH_TTL = 6 * 3600
OWNED_TTL = 5 * 60
OWNED_LIST_TTL = 60
TSA_TTL = 12 * 3600
SCHEMA_TTL = 24 * 3600
MAX_WORKERS = 10

def _load_json(path):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: return {}
    return {}

def _save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def load_db():
    db = _load_json(DB_FILE)
    if not db: db = {"steam_key": "", "steam_id": "", "tsa_profile_url": "", "ubisoft_games": []}
    return db

def get_owned_games_list_cached(key, steamid):
    cache = _load_json(OWNED_LIST_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_LIST_TTL) > now:
        return entry.get('games', [])
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={steamid}&include_appinfo=true&include_played_free_games=true"
        r = requests.get(url, timeout=12)
        games = r.json().get('response', {}).get('games', []) or []
        games.sort(key=lambda x: x.get('playtime_forever', 0), reverse=True)
        cache[steamid] = {'ts': now, 'games': games}
        _save_json(OWNED_LIST_CACHE_FILE, cache)
        return games
    except: return []

def get_owned_appids_cached(key, steamid):
    cache = _load_json(OWNED_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_TTL) > now:
        return set(entry.get('owned', []))
    owned = set()
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={steamid}&include_appinfo=false&include_played_free_games=true"
        r = requests.get(url, timeout=10)
        for g in r.json().get('response', {}).get('games', []):
            owned.add(str(g.get('appid')))
    except: pass
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
    except: pass
    return {}

def fetch_tsa_owned(profile_url, appid, attempts=3):
    if not profile_url: return {'found': False}
    cache = _load_json(TSA_CACHE_FILE)
    key = f"{profile_url}::{appid}"
    now = int(time.time())
    if key in cache and (cache[key].get('ts', 0) + TSA_TTL) > now:
        return cache[key].get('data')
    
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    result = {'found': False, 'owned_dlc': 0, 'total_dlc': 0}
    url = profile_url if 'gamecollection' in profile_url else urljoin(profile_url, 'gamecollection')
    
    for i in range(attempts):
        try:
            r = requests.get(url, headers=headers, timeout=10 + (i*5))
            if r.status_code == 200:
                if str(appid) in r.text:
                    m = re.search(r'(\d+)\s*(?:of|/|su)\s*(\d+)\s*DLC', r.text[r.text.find(str(appid)):r.text.find(str(appid))+600], re.I)
                    if m:
                        result.update({'found': True, 'owned_dlc': int(m.group(1)), 'total_dlc': int(m.group(2))})
                        break
            time.sleep(1)
        except: pass
    cache[key] = {'ts': now, 'data': result}
    _save_json(TSA_CACHE_FILE, cache)
    return result

def fetch_schema_cached(key, appid):
    cache = _load_json(SCHEMA_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(appid)
    if entry and (entry.get('ts', 0) + SCHEMA_TTL) > now:
        return entry.get('data', [])
    try:
        url = f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={key}&appid={appid}"
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
        cache[appid] = {'ts': now, 'data': normalized}
        _save_json(SCHEMA_CACHE_FILE, cache)
        return normalized
    except:
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

@app.route('/api/config', methods=['POST'])
def api_config():
    db = load_db()
    db.update(request.json or {})
    _save_json(DB_FILE, db)
    return jsonify({"status": "ok"})

@app.route('/api/data', methods=['GET'])
def api_data():
    return jsonify(load_db())

@app.route('/api/steam/games_summary', methods=['GET'])
def games_summary():
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Config missing"}), 400
    games = get_owned_games_list_cached(key, sid)
    out = [{"appid": str(g['appid']), "name": g.get('name', 'Unknown'), "playtime": g.get('playtime_forever', 0), "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{g['appid']}/header.jpg"} for g in games]
    return jsonify({"total_count": len(out), "games": out})

@app.route('/api/steam/achievements_bulk', methods=['POST'])
def ach_bulk():
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    appids = request.json.get('appids', [])
    res = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_player_achievements_cached, key, sid, aid): aid for aid in appids}
        for f in as_completed(futures):
            res[futures[f]] = f.result()
    return jsonify(res)

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

@app.route('/api/steam/game_details/<appid>', methods=['GET'])
def game_details(appid):
    db = load_db()
    data = fetch_appdetails_cached(appid)
    dlc_list = [str(x) for x in data.get('dlc', [])]
    owned_set = get_owned_appids_cached(db.get('steam_key'), db.get('steam_id'))
    owned_count = sum(1 for d in dlc_list if str(d) in owned_set)
    
    if owned_count == 0 and db.get('tsa_profile_url'):
        tsa = fetch_tsa_owned(db.get('tsa_profile_url'), appid)
        if tsa['found']:
            return jsonify({"total_dlc": tsa['total_dlc'], "owned_dlc": tsa['owned_dlc'], "source": "tsa"})
    
    return jsonify({"total_dlc": len(dlc_list), "owned_dlc": owned_count, "source": "steam"})

@app.route('/api/steam/schema/<appid>', methods=['GET'])
def api_schema(appid):
    db = load_db()
    key = db.get('steam_key')
    if not key:
        return jsonify({'error': 'Missing Steam API key in config'}), 400
    data = fetch_schema_cached(key, appid)
    return jsonify({'achievements': data})

@app.route('/api/steam/player_achievements/<appid>', methods=['GET'])
def api_player_achievements(appid):
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({'error': 'Missing Steam API key or SteamID in config'}), 400
    data = fetch_player_achievements(key, sid, appid)
    return jsonify({'achievements': data})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)