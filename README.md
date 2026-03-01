<a name="readme-top"></a>

# Achievements_PC

<div align="center">

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

</div>

<br />

<div align="center">
  <a href="https://github.com/Trane20121/Achievements_PC">
    <img src="https://avatars.githubusercontent.com/u/115975065?v=4" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Steam Achievement Tracker</h3>

  <p align="center">
    Un'applicazione web locale per monitorare i tuoi obiettivi Steam, visualizzare i progressi e analizzare le statistiche di gioco.
    <br />
    <a href="https://github.com/Trane20121/Achievements_PC"><strong>Esplora la documentazione »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Trane20121/Achievements_PC/issues">Segnala Bug</a>
    ·
    <a href="https://github.com/Trane20121/Achievements_PC/issues">Richiedi Funzionalità</a>
  </p>
</div>

---

## 🧐 Informazioni sul Progetto

Questa applicazione permette di aggregare i dati del tuo profilo Steam tramite API ufficiali e scraping, offrendo una dashboard pulita con grafici interattivi per visualizzare la percentuale di completamento degli obiettivi e il tempo di gioco.

### 🌟 Caratteristiche principali:

- **Dashboard Dinamica:** Grafici interattivi realizzati con Chart.js.
- **Smart Filtering:** Filtro automatico per mostrare solo i giochi che possiedono achievement.
- **Ordinamento Intelligente:** Organizza la tua libreria per tempo di gioco o ultimo avvio.
- **Performance:** Cache locale per minimizzare le chiamate alle API e velocizzare il caricamento.

> [!IMPORTANT]
> **Nota sulla Privacy:** Per poter visualizzare correttamente i dati, il tuo profilo Steam deve essere impostato come **Pubblico**. Assicurati che nelle [Impostazioni sulla privacy](https://help.steampowered.com/it/faqs/view/588C-C67D-0251-C276) siano pubblici:
> * Profilo
> * Dettagli di gioco

<p align="right">(<a href="#readme-top">torna su</a>)</p>

### 🛠 Tecnologie Utilizzate

* [![Python][python-shield]][python-url]
* [![Flask][flask-shield]][flask-url]
* [![Chart.js][chartjs-shield]][chartjs-url]
* [![JavaScript][js-shield]][js-url]

---

## 🚀 Per Iniziare

Il progetto è progettato per essere "Plug & Play" su Windows. Non è necessario installare manualmente Python o configurare variabili d'ambiente.

1. Scarica o clona la repository.
2. Fai click destro sul file **`start.bat`**.
3. Seleziona **"Esegui come amministratore"**.

**Cosa fa lo script automaticamente?**
- Controlla la presenza di Python e lo installa tramite `winget` se mancante.
- Installa o aggiorna tutte le dipendenze necessarie (`Flask`, `Waitress`, ecc.).
- Configura il PATH di sistema.
- Avvia il server web locale.

> [!TIP]
> **Per chiudere l'app:** Premi `Ctrl + C` nella finestra del terminale e chiudi la scheda del browser.

<p align="right">(<a href="#readme-top">torna su</a>)</p>

---

## 🤝 Contribuire

I contributi sono ciò che rende la community open source un posto fantastico per imparare, ispirare e creare.

1. Fai il Fork del progetto.
2. Crea il tuo Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Fai il Commit delle tue modifiche (`git commit -m 'Add some AmazingFeature'`).
4. Fai il Push sul Branch (`git push origin feature/AmazingFeature`).
5. Apri una Pull Request.

---

## 📄 Licenza

Distribuito sotto Licenza MIT. Vedi il file `LICENSE` per ulteriori informazioni.

## ✉️ Contatti

Trane20121 - [@X](https://x.com/Trane20121) - bounty_95@hotmail.it

Project Link: [https://github.com/Trane20121/Achievements_PC](https://github.com/Trane20121/Achievements_PC)

<p align="right">(<a href="#readme-top">torna su</a>)</p>

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