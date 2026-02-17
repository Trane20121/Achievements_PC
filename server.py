import requests
import json
import os
import time
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DB_FILE = 'database.json'
CACHE_FILE = 'steam_cache.json'

def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {"steam_key": "", "steam_id": "", "ubisoft_games": []}

def save_db(d):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)

@app.route('/api/config', methods=['POST'])
def api_config():
    db = load_db()
    db.update(request.json or {})
    save_db(db)
    if os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)
    return jsonify({"status": "ok"})

@app.route('/api/data', methods=['GET'])
def api_data():
    return jsonify(load_db())

@app.route('/api/steam/games_with_achievements', methods=['GET'])
def api_games():
    # Cache valida 1 ora
    if os.path.exists(CACHE_FILE):
        if time.time() - os.path.getmtime(CACHE_FILE) < 3600:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return jsonify({"games": json.load(f)})

    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Configurazione Steam mancante"}), 400

    try:
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={sid}&include_appinfo=true&include_played_free_games=true"
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        data = r.json()
        games = data.get('response', {}).get('games', [])

        results = []
        for g in games:
            appid = str(g['appid'])
            # Ottieni achievements
            ach_url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}"
            ach_res = requests.get(ach_url, timeout=10)
            if ach_res.status_code == 200:
                ach_data = ach_res.json()
                pstats = ach_data.get('playerstats', {})
                achs = pstats.get('achievements', []) if isinstance(pstats, dict) else []
                unlocked = sum(1 for a in achs if a.get('achieved') == 1)
                total_ach = len(achs)
            else:
                unlocked = 0
                total_ach = 0

            results.append({
                "appid": appid,
                "name": g.get('name', 'Unknown'),
                "playtime": g.get('playtime_forever', 0),
                "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
                "unlocked_ach": unlocked,
                "total_ach": total_ach
            })

        # Ordina per ore giocate decrescente
        results.sort(key=lambda x: x['playtime'], reverse=True)

        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2)

        return jsonify({"games": results})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/steam/game_details/<appid>', methods=['GET'])
def game_details(appid):
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not key or not sid:
        return jsonify({"error": "Configurazione Steam mancante"}), 400

    try:
        # Lista completa giochi per DLC
        url_all = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={sid}"
        r_all = requests.get(url_all, timeout=15)
        r_all.raise_for_status()
        all_games = r_all.json().get('response', {}).get('games', [])
        owned_ids = {str(g['appid']) for g in all_games}

        # Chiedi DLC allo store
        store_url = f"https://store.steampowered.com/api/appdetails?appids={appid}&filters=dlc"
        store_res = requests.get(store_url, timeout=10)
        store_res.raise_for_status()
        dlc_list = store_res.json().get(appid, {}).get('data', {}).get('dlc', [])

        owned_dlc = sum(1 for d in dlc_list if str(d) in owned_ids)

        return jsonify({
            "total_dlc": len(dlc_list),
            "owned_dlc": owned_dlc
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)