# Achievements_PC

<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<br />

<div align="center">
  <a href="https://github.com/Trane20121/Achievements_PC">
    <img src="https://avatars.githubusercontent.com/u/115975065?v=4" alt="Logo" width="80" height="80" />
  </a>

  <h2 align="center">Steam Achievement Tracker</h2>

  <p align="center">
    Un'applicazione web locale per monitorare i tuoi obiettivi Steam, visualizzare i progressi e analizzare le statistiche di gioco.
    <br />
    <a href="https://github.com/Trane20121/Achievements_PC"><strong>Esplora la documentazione »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Trane20121/Achievements_PC">Visualizza Demo</a>
    ·
    <a href="https://github.com/Trane20121/Achievements_PC/issues">Segnala Bug</a>
    ·
    <a href="https://github.com/Trane20121/Achievements_PC/issues">Richiedi Funzionalità</a>
  </p>
</div>

<details>
  <summary>Indice dei contenuti</summary>

  <ol>
    <li>
      <a href="#informazioni-sul-progetto">Informazioni sul Progetto</a>
      <ul>
        <li><a href="#tecnologie-utilizzate">Tecnologie Utilizzate</a></li>
      </ul>
    </li>
    <li>
      <a href="#per-iniziare">Per Iniziare</a>
      <ul>
        <li><a href="#prerequisiti">Prerequisiti</a></li>
        <li><a href="#installazione">Installazione</a></li>
      </ul>
    </li>
    <li><a href="#contribuire">Contribuire</a></li>
    <li><a href="#licenza">Licenza</a></li>
    <li><a href="#contatti">Contatti</a></li>
  </ol>

</details>

## Informazioni sul Progetto

Questa applicazione permette di aggregare i dati del tuo profilo Steam tramite API ufficiali e scraping, offrendo una dashboard pulita con grafici (Chart.js) per visualizzare la percentuale di completamento degli obiettivi e il tempo di gioco.

Caratteristiche principali:

- Dashboard con grafici interattivi.
- Filtro automatico per giochi con achievement.
- Ordinamento per tempo di gioco e ultimo avvio.
- Cache locale per prestazioni ottimali.

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

### Tecnologie Utilizzate

- [![python-shield][python-shield]][python-url]
- [![flask-shield][flask-shield]][flask-url]
- [![chartjs-shield][chartjs-shield]][chartjs-url]
- [![js-shield][js-shield]][js-url]

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

## Per Iniziare

Segui questi passaggi per configurare il progetto localmente.

### Prerequisiti

Assicurati di avere Python installato.

- pip

```sh
pip install flask flask-cors requests requests-cache beautifulsoup4
```

### Installazione

1. Ottieni una Steam API Key su: [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

2. Clona il repository:

```sh
git clone https://github.com/Trane20121/Achievements_PC.git
cd Achievements_PC
```

3. Inserisci la tua API Key e lo SteamID64 nell'interfaccia web dopo l'avvio.

4. Avvia il server Python:

```sh
python server.py
```

5. Apri `index.html` nel tuo browser.

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

## Contribuire

I contributi sono ciò che rende la community open source un posto fantastico per imparare, ispirare e creare. Ogni contributo che farai è **molto apprezzato**.

1. Fai il Fork del progetto  
2. Crea il tuo Feature Branch (`git checkout -b feature/AmazingFeature`)  
3. Fai il Commit delle tue modifiche (`git commit -m 'Add some AmazingFeature'`)  
4. Fai il Push sul Branch (`git push origin feature/AmazingFeature`)  
5. Apri una Pull Request

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

## Licenza

Distribuito sotto Licenza MIT. Vedi `LICENSE` per ulteriori informazioni.

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

## Contatti

Trane20121 - [@X](https://x.com/Trane20121) - bounty_95@hotmail.it

Link Progetto: [https://github.com/Trane20121/Achievements_PC](https://github.com/Trane20121/Achievements_PC)

<p align="right">(<a href="#readme-top">Torna su</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/Trane20121/Achievements_PC.svg?style=for-the-badge
[contributors-url]: https://github.com/Trane20121/Achievements_PC/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Trane20121/Achievements_PC.svg?style=for-the-badge
[forks-url]: https://github.com/Trane20121/Achievements_PC/network/members
[stars-shield]: https://img.shields.io/github/stars/Trane20121/Achievements_PC.svg?style=for-the-badge
[stars-url]: https://github.com/Trane20121/Achievements_PC/stargazers
[issues-shield]: https://img.shields.io/github/issues/Trane20121/Achievements_PC.svg?style=for-the-badge
[issues-url]: https://github.com/Trane20121/Achievements_PC/issues
[license-shield]: https://img.shields.io/github/license/Trane20121/Achievements_PC.svg?style=for-the-badge
[license-url]: https://github.com/Trane20121/Achievements_PC/blob/main/LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/hermes-de-micheli-b7029b21b/
[python-shield]: https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54
[python-url]: https://www.python.org/
[flask-shield]: https://img.shields.io/badge/flask-%23000.svg?style=for-the-badge&logo=flask&logoColor=white
[flask-url]: https://flask.palletsprojects.com/
[chartjs-shield]: https://img.shields.io/badge/chart.js-F5788D.svg?style=for-the-badge&logo=chart.dot_js&logoColor=white
[chartjs-url]: https://www.chartjs.org/
[js-shield]: https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E
[js-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript
