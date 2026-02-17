import requests
import json
import os
import time
import logging
from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
CORS(app)

DB_FILE = 'database.json'
CACHE_FILE = 'steam_cache.json'

def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return {"steam_key": "", "steam_id": "", "ubisoft_games": []}

def save_db(d):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)

@app.route('/api/config', methods=['POST'])
def api_config():
    db = load_db()
    db.update(request.json or {})
    save_db(db)
    if os.path.exists(CACHE_FILE): os.remove(CACHE_FILE)
    return jsonify({"status": "ok"})

@app.route('/api/data', methods=['GET'])
def api_data():
    return jsonify(load_db())

@app.route('/api/steam/games_with_achievements', methods=['GET'])
def api_games():
    # Cache valida 1 ora
    if os.path.exists(CACHE_FILE):
        if time.time() - os.path.getmtime(CACHE_FILE) < 3600:
            with open(CACHE_FILE, 'r') as f:
                return jsonify({"games": json.load(f)})

    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    if not sid or not key: return jsonify({"error": "Configurazione mancante"}), 400
    
    try:
        # Carichiamo TUTTI i giochi (fino a 2000+)
        url = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={sid}&include_appinfo=true&include_played_free_games=true"
        r = requests.get(url, timeout=15).json()
        owned_games = r.get('response', {}).get('games', [])

        results = []
        # Filtriamo solo i giochi che hanno almeno un'ora di gioco o sono stati avviati
        # per evitare di caricare migliaia di giochi "spazzatura" se la libreria è enorme
        for g in owned_games:
            appid = str(g['appid'])
            
            # Recupero veloce trofei (Steam permette molte di queste chiamate)
            ach_url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}"
            ach_res = requests.get(ach_url).json()
            p_stats = ach_res.get('playerstats', {})
            p_ach = p_stats.get('achievements', []) if isinstance(p_stats, dict) else []
            
            unlocked = sum(1 for a in p_ach if a.get('achieved') == 1)
            
            results.append({
                "appid": appid,
                "name": g.get('name', 'Unknown'),
                "playtime": g.get('playtime_forever', 0),
                "img": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
                "unlocked_ach": unlocked,
                "total_ach": len(p_ach)
            })
        
        # Ordiniamo per ore giocate prima di salvare
        results.sort(key=lambda x: x['playtime'], reverse=True)

        with open(CACHE_FILE, 'w') as f:
            json.dump(results, f)
            
        return jsonify({"games": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/steam/game_details/<appid>', methods=['GET'])
def get_details(appid):
    db = load_db()
    key, sid = db.get('steam_key'), db.get('steam_id')
    
    try:
        # 1. Recuperiamo la lista di TUTTI gli AppID posseduti per il confronto DLC
        url_all = f"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={sid}"
        r_all = requests.get(url_all).json()
        all_owned_ids = {str(g['appid']) for g in r_all.get('response', {}).get('games', [])}

        # 2. Chiediamo allo Store i DLC di questo gioco specifico
        s_url = f"https://store.steampowered.com/api/appdetails?appids={appid}&filters=dlc"
        s_res = requests.get(s_url).json()
        dlc_list = s_res.get(appid, {}).get('data', {}).get('dlc', [])
        
        owned_dlc = sum(1 for d_id in dlc_list if str(d_id) in all_owned_ids)

        return jsonify({
            "total_dlc": len(dlc_list),
            "owned_dlc": owned_dlc
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)