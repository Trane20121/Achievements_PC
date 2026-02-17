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

SCRAPE_TTL = 24 * 3600
APPDETAILS_TTL = 24 * 3600
ACH_TTL = 6 * 3600
OWNED_TTL = 5 * 60
OWNED_LIST_TTL = 60  # cache lista completa per 1 minuto
TSA_TTL = 12 * 3600
MAX_WORKERS = 10

prefetch_state = {'running': False, 'progress': 0, 'total': 0, 'last_error': None}

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
    return db if db else {"steam_key": "", "steam_id": "", "ubisoft_games": []}

# --- Owned games list (con cache) ---
def get_owned_games_list_cached(key, steamid):
    cache = _load_json(OWNED_LIST_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_LIST_TTL) > now:
        return entry.get('games', [])
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={steamid}&include_appinfo=true&include_played_free_games=true"
        r = requests.get(url, timeout=12)
        j = r.json()
        games = j.get('response', {}).get('games', []) or []
        # ordina per playtime decrescente
        games.sort(key=lambda x: x.get('playtime_forever', 0), reverse=True)
        cache[steamid] = {'ts': now, 'games': games}
        _save_json(OWNED_LIST_CACHE_FILE, cache)
        return games
    except Exception as e:
        print(f"[get_owned_games_list_cached] errore: {e}")
        return []

def get_owned_appids_cached(key, steamid):
    cache = _load_json(OWNED_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(steamid)
    if entry and (entry.get('ts', 0) + OWNED_TTL) > now:
        return set(entry.get('owned', []))
    owned = set()
    # 1) GetOwnedGames semplice
    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={steamid}&include_appinfo=false&include_played_free_games=true"
        r = requests.get(url, timeout=10)
        data = r.json()
        games = data.get('response', {}).get('games', []) or []
        for g in games:
            owned.add(str(g.get('appid')))
    except Exception as e:
        print(f"[get_owned_appids_cached] api error: {e}")
    # 2) Fallback scraping profilo
    try:
        url2 = f"https://steamcommunity.com/profiles/{steamid}/games/?tab=all"
        headers = {"User-Agent": "Mozilla/5.0"}
        r2 = requests.get(url2, headers=headers, timeout=10)
        if r2.status_code == 200:
            for m in re.findall(r'data-ds-appid="(\d+)"', r2.text):
                owned.add(str(m))
    except Exception as e:
        print(f"[get_owned_appids_cached] scrape fallback error: {e}")

    cache[steamid] = {'ts': now, 'owned': list(owned)}
    _save_json(OWNED_CACHE_FILE, cache)
    return owned

def fetch_appdetails_cached(appid):
    cache = _load_json(APPDETAILS_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(appid, {})
    if entry and (entry.get('ts', 0) + APPDETAILS_TTL) > now:
        return entry.get('data', {})
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        r = requests.get(url, timeout=8)
        j = r.json()
        if j and j.get(str(appid), {}).get('success'):
            data = j[str(appid)]['data']
            cache[appid] = {'ts': now, 'data': data}
            _save_json(APPDETAILS_CACHE_FILE, cache)
            return data
    except Exception as e:
        print(f"[fetch_appdetails_cached] error fetching appdetails for {appid}: {e}")
    return {}

def scrape_store_dlc_cached(appid):
    cache = _load_json(SCRAPE_CACHE_FILE)
    now = int(time.time())
    entry = cache.get(appid, {})
    if entry and (entry.get('ts', 0) + SCRAPE_TTL) > now:
        return entry.get('dlc', [])
    try:
        url = f"https://store.steampowered.com/app/{appid}/"
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code != 200:
            return []
        text = r.text
        soup = BeautifulSoup(text, "html.parser")
        dlc_set = set()
        sec = soup.find(id='game_area_dlc_section') or soup.find(id='game_area_dlc_coming_soon')
        if sec:
            for a in sec.find_all("a", href=True):
                m = re.search(r"/app/(\d+)", a['href'])
                if m:
                    dlc_set.add(m.group(1))
        m_js = re.search(r'var rgDLC\s*=\s*(\[[^\]]*\])', text)
        if m_js:
            for m in re.findall(r'appid\s*[:=]\s*(\d+)', m_js.group(1)):
                dlc_set.add(m)
        for m in re.findall(r'"dlc"\s*:\s*\[([^\]]*)\]', text):
            for mm in re.findall(r'(\d+)', m):
                dlc_set.add(mm)
        if not dlc_set:
            for a in soup.find_all("a", href=True):
                m = re.search(r"/app/(\d+)", a['href'])
                if m:
                    dlc_set.add(m.group(1))
        dlc_list = sorted(dlc_set, key=int)
        cache[appid] = {'ts': now, 'dlc': dlc_list}
        _save_json(SCRAPE_CACHE_FILE, cache)
        return dlc_list
    except Exception as e:
        print(f"[scrape_store_dlc_cached] error for {appid}: {e}")
        return []

def fetch_player_achievements_cached(key, sid, appid):
    cache = _load_json(ACH_CACHE_FILE)
    now = int(time.time())
    keyname = f"{sid}:{appid}"
    entry = cache.get(keyname, {})
    if entry and (entry.get('ts', 0) + ACH_TTL) > now:
        return entry.get('summary', {'u': 0, 't': 0})
    try:
        url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}"
        r = requests.get(url, timeout=8)
        j = r.json()
        achs = j.get('playerstats', {}).get('achievements', []) or []
        summary = {'u': sum(1 for a in achs if a.get('achieved') == 1), 't': len(achs)}
        cache[keyname] = {'ts': now, 'summary': summary}
        _save_json(ACH_CACHE_FILE, cache)
        return summary
    except Exception as e:
        print(f"[fetch_player_achievements_cached] error for {appid}: {e}")
        return {'u': 0, 't': 0}

# Improved TSA scraping with retries and robust URL handling
def fetch_tsa_owned(profile_url, appid, attempts=3, base_timeout=8):
    cache = _load_json(TSA_CACHE_FILE)
    key = f"{profile_url}::{appid}"
    now = int(time.time())
    entry = cache.get(key, {})
    if entry and (entry.get('ts', 0) + TSA_TTL) > now:
        return entry.get('data')
    headers = {"User-Agent": "Mozilla/5.0"}
    result = {'found': False, 'owned_dlc': None, 'total_dlc': None, 'source': 'not_found'}
    try:
        url = profile_url
        if 'gamecollection' not in url and not url.rstrip('/').endswith('/gamecollection'):
            url = url.rstrip('/') + '/gamecollection'
        # Normalize to absolute URL
        if not url.lower().startswith('http'):
            url = urljoin('https://truesteamachievements.com/', url)

        # retry loop for profile page
        timeout = base_timeout
        profile_text = None
        for attempt in range(1, attempts + 1):
            try:
                r = requests.get(url, headers=headers, timeout=timeout)
                if r.status_code == 200:
                    profile_text = r.text
                    break
                else:
                    print(f"[fetch_tsa_owned] profile request {attempt} status {r.status_code} for {url}")
            except Exception as e:
                print(f"[fetch_tsa_owned] profile request {attempt} error for {url}: {e}")
            if attempt < attempts:
                sleep_time = 1.5 ** attempt
                time.sleep(sleep_time)
                timeout = int(timeout * 1.5)

        if not profile_text:
            cache[key] = {'ts': now, 'data': result}
            _save_json(TSA_CACHE_FILE, cache)
            return result

        text = profile_text
        if str(appid) in text:
            idx = text.find(str(appid))
            start = max(0, idx - 400)
            snippet = text[start: idx + 400]

            m = re.search(r'(\d{1,3})\s*(?:of|di|su)\s*(\d{1,4})\s*(?:DLC|dlc|DLCs|contenuti aggiuntivi)', snippet, re.IGNORECASE)
            if not m:
                m = re.search(r'(\d{1,3})\s*/\s*(\d{1,4})\s*(?:DLC|dlc|DLCs)', snippet, re.IGNORECASE)
            if m:
                a = int(m.group(1)); b = int(m.group(2))
                result.update({'found': True, 'owned_dlc': a, 'total_dlc': b, 'source': 'collection'})
            else:
                # trova link alla pagina del gioco su TSA e richiedi con retry
                mlink = re.search(r'href=["\']([^"\']+/game/[^"\']+?)["\']', snippet)
                if mlink:
                    game_page = mlink.group(1)
                    if game_page.startswith('/'):
                        game_page = urljoin('https://truesteamachievements.com', game_page)
                    # retry loop for game page
                    timeout = base_timeout
                    game_text = None
                    for attempt in range(1, attempts + 1):
                        try:
                            rg = requests.get(game_page, headers=headers, timeout=timeout)
                            if rg.status_code == 200:
                                game_text = rg.text
                                break
                            else:
                                print(f"[fetch_tsa_owned] game page request {attempt} status {rg.status_code} for {game_page}")
                        except Exception as e:
                            print(f"[fetch_tsa_owned] game page request {attempt} error for {game_page}: {e}")
                        if attempt < attempts:
                            sleep_time = 1.5 ** attempt
                            time.sleep(sleep_time)
                            timeout = int(timeout * 1.5)

                    if game_text:
                        s2 = game_text
                        m2 = re.search(r'(\d{1,3})\s*(?:of|di|su)\s*(\d{1,4})\s*(?:DLC|dlc|DLCs|contenuti aggiuntivi)', s2, re.IGNORECASE)
                        if not m2:
                            m2 = re.search(r'(\d{1,3})\s*/\s*(\d{1,4})\s*(?:DLC|dlc|DLCs)', s2, re.IGNORECASE)
                        if m2:
                            a = int(m2.group(1)); b = int(m2.group(2))
                            result.update({'found': True, 'owned_dlc': a, 'total_dlc': b, 'source': 'gamepage'})
                        else:
                            soup = BeautifulSoup(s2, 'html.parser')
                            owned_count = 0
                            total_count = 0
                            for li in soup.select('.dlc-list .dlc-item, .dlc .dlc-item, .owned-dlc, li.dlc'):
                                total_count += 1
                                txt = str(li)
                                if 'owned' in txt.lower() or 'possessed' in txt.lower() or 'posseduto' in txt.lower():
                                    owned_count += 1
                            if total_count > 0:
                                result.update({'found': True, 'owned_dlc': owned_count, 'total_dlc': total_count, 'source': 'gamepage-list'})
                else:
                    # fallback: prova a cercare conteggi direttamente nella pagina principale
                    m_inline = re.search(r'(\d{1,3})\s*(?:of|di|su)\s*(\d{1,4})\s*(?:DLC|dlc|DLCs)', text, re.IGNORECASE)
                    if m_inline:
                        a = int(m_inline.group(1)); b = int(m_inline.group(2))
                        result.update({'found': True, 'owned_dlc': a, 'total_dlc': b, 'source': 'inline'})

        cache[key] = {'ts': now, 'data': result}
        _save_json(TSA_CACHE_FILE, cache)
        return result

    except Exception as e:
        # log dell'eccezione e salvataggio cache in ogni caso
        print(f"[fetch_tsa_owned] eccezione generale: {e}")
        cache[key] = {'ts': now, 'data': result}
        _save_json(TSA_CACHE_FILE, cache)
        return result

# API endpoints (unchanged)
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
    try:
        games = get_owned_games_list_cached(key, sid)
        out = []
        for g in games:
            appid = str(g['appid'])
            out.append({
                "appid": appid,
                "name": g.get('name', 'Unknown'),
                "playtime": g.get('playtime_forever', 0),
                "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{g['appid']}/header.jpg"
            })
        return jsonify({"total_count": len(out), "games": out})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/steam/games_with_achievements', methods=['GET'])
def api_games():
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Config missing"}), 400
    try:
        limit = request.args.get('limit', type=int)
        offset = request.args.get('offset', type=int, default=0)
        games = get_owned_games_list_cached(key, sid)
        total = len(games)
        # slice according to offset/limit
        if limit and limit > 0:
            games_slice = games[offset: offset + limit]
        else:
            games_slice = games[offset:]
        ach_cache = _load_json(ACH_CACHE_FILE)
        appd_cache = _load_json(APPDETAILS_CACHE_FILE)
        out = []
        for g in games_slice:
            appid = str(g['appid'])
            data = {
                "appid": appid,
                "name": g.get('name', 'Unknown'),
                "playtime": g.get('playtime_forever', 0),
                "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{g['appid']}/header.jpg"
            }
            ach_entry = ach_cache.get(f"{sid}:{appid}", {}).get('summary') if ach_cache else None
            if ach_entry:
                data['u'] = ach_entry.get('u', 0)
                data['t'] = ach_entry.get('t', 0)
            ad_entry = appd_cache.get(appid, {}).get('data') if appd_cache else None
            if ad_entry:
                dlc_field = ad_entry.get('dlc') or []
                data['dlc_total'] = len(dlc_field)
            out.append(data)
        return jsonify({"total_count": total, "games": out})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/steam/achievements_bulk', methods=['POST'])
def ach_bulk():
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    appids = request.json.get('appids', [])
    res = {}
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(appids) or 1)) as ex:
        futures = {ex.submit(fetch_player_achievements_cached, key, sid, aid): aid for aid in appids}
        for f in as_completed(futures):
            aid = futures[f]
            try:
                s = f.result()
                res[aid] = {"u": s.get('u', 0), "t": s.get('t', 0)}
            except Exception:
                res[aid] = {"u": 0, "t": 0}
    return jsonify(res)

@app.route('/api/steam/game_details/<appid>', methods=['GET'])
def game_details(appid):
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Config missing"}), 400

    data = fetch_appdetails_cached(appid)
    dlc_list = []
    total_dlc = 0
    if data:
        dlc_field = data.get('dlc') or []
        dlc_list = [str(x) for x in dlc_field]
        total_dlc = len(dlc_list)

    if total_dlc == 0:
        scraped = scrape_store_dlc_cached(appid)
        if scraped:
            dlc_list = scraped
            total_dlc = len(dlc_list)

    owned_set = get_owned_appids_cached(key, sid)
    owned_count = 0
    if dlc_list:
        for d in dlc_list:
            if not re.match(r'^\d+$', str(d)):
                continue
            if str(d) in owned_set:
                owned_count += 1

    return jsonify({"total_dlc": total_dlc, "owned_dlc": owned_count, "dlc_list": dlc_list})

@app.route('/api/steam/tsa_owned', methods=['GET'])
def tsa_owned():
    appid = request.args.get('appid')
    profile_url = request.args.get('profile_url')
    if not appid or not profile_url:
        return jsonify({"error": "Missing appid or profile_url"}), 400
    try:
        res = fetch_tsa_owned(profile_url, appid)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _background_prefetch(apps, key, sid):
    prefetched_tasks = 0
    prefetch_state['running'] = True
    prefetch_state['progress'] = 0
    prefetch_state['total'] = len(apps) * 2
    prefetch_state['last_error'] = None
    try:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futures = []
            for app in apps:
                appid = app['appid']
                futures.append(ex.submit(fetch_appdetails_cached, appid))
                futures.append(ex.submit(fetch_player_achievements_cached, key, sid, appid))
            for f in as_completed(futures):
                try:
                    _ = f.result()
                except Exception as e:
                    prefetch_state['last_error'] = str(e)
                prefetched_tasks += 1
                prefetch_state['progress'] = prefetched_tasks
    finally:
        prefetch_state['running'] = False

@app.route('/api/steam/prefetch_details', methods=['POST'])
def prefetch_details():
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Config missing"}), 400
    try:
        games = get_owned_games_list_cached(key, sid)
        apps = [{"appid": str(g['appid']), "name": g.get('name', '')} for g in games]
        if prefetch_state.get('running'):
            return jsonify({"status": "already_running"}), 202
        t = threading.Thread(target=_background_prefetch, args=(apps, key, sid), daemon=True)
        t.start()
        return jsonify({"status": "started", "total": len(apps)}), 202
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/steam/prefetch_status', methods=['GET'])
def prefetch_status():
    return jsonify(prefetch_state)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)