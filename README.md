# swindon.lol

Five rounds. One Swindon.

A minimalist geography game in the spirit of MapTap, except every round asks the same question: where is Swindon?
Guesses are hidden, feedback is withheld, and the map resets after every round.
The reveal only happens once all five guesses are in.

## Run locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy

Upload `index.html`, `styles.css`, `app.js`, and `assets/` to any static host.
Point the `swindon.lol` DNS record at that host.

## How it works

- Target: Swindon town centre, `51.5558, -1.7797`.
- Five rounds, each scored `5000 × e^(−distance / 50 km)`, for a maximum of 25,000.
- The daily run is stored in `localStorage` under `swindon.lol:daily:<date>`.
  Reloading mid-run resumes at the right round without revealing earlier guesses.
- Practice runs are never stored and can be replayed indefinitely.
- The play map uses Esri's gray canvas base without the city reference layer, so the town name is not given away.
  The results map adds the reference layer.
- Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors.

## Tweaking

Scoring constants live at the top of `app.js`: `MAX_ROUND_SCORE`, `SCALE_KM`, and the thresholds in `tierFor`.
