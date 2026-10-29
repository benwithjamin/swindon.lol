(() => {
  'use strict';

  if (!window.L) {
    const intro = document.getElementById('screen-intro');
    if (intro) {
      intro.insertAdjacentHTML('beforeend', '<p class="note">The map failed to load. Check your connection and refresh.</p>');
    }
    return;
  }

  const TARGET = { lat: 51.5558, lng: -1.7797 };
  const ROUNDS = 5;
  const MAX_ROUND_SCORE = 5000;
  const SCALE_KM = 50;
  const STORAGE_PREFIX = 'swindon.lol:daily:';
  const WORLD_BOUNDS = L.latLngBounds([[-58, -180], [78, 180]]);
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DARK = window.matchMedia('(prefers-color-scheme: dark)');

  const $ = (id) => document.getElementById(id);
  const screens = {
    intro: $('screen-intro'),
    game: $('screen-game'),
    results: $('screen-results'),
  };

  const state = {
    mode: 'daily',
    dailyKey: null,
    guesses: [],
    round: 1,
    locked: false,
    pin: null,
  };

  const PIN_ICON = L.divIcon({
    className: 'pin',
    html: '<span class="pin__ring"><span class="pin__dot"></span></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  let gameMap = null;
  let resultsMap = null;
  let gamePin = null;
  let resultsLayers = null;
  const tileLayers = new Map();
  const mapLabels = new Map();

  /* ---------- maps ---------- */

  function createMap(element, labels, options = {}) {
    const map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 0,
      maxZoom: 16,
      zoomSnap: options.smooth ? 0 : 1,
      zoomDelta: 1,
      doubleClickZoom: false,
      boxZoom: false,
      preferCanvas: true,
      wheelPxPerZoomLevel: 32,
      wheelDebounceTime: 40,
      inertiaDeceleration: 2600,
    });

    if (options.smooth) {
      map.zoomIn = function zoomIn(delta = 1) {
        return this.setZoom(Math.round(this.getZoom()) + delta);
      };
      map.zoomOut = function zoomOut(delta = 1) {
        return this.setZoom(Math.round(this.getZoom()) - delta);
      };
    }

    map.fitBounds(WORLD_BOUNDS, { animate: false });
    map.attributionControl.setPrefix('');
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapLabels.set(map, labels);
    tileLayers.set(map, addTiles(map, labels));

    return map;
  }

  function addTiles(map, labels) {
    const theme = DARK.matches ? 'dark' : 'light';
    const base = theme === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base';
    const reference = theme === 'dark' ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference';
    const root = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
    const attribution = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    const layers = [
      L.tileLayer(`${root}/${base}/MapServer/tile/{z}/{y}/{x}`, {
        attribution,
        maxZoom: 16,
      }).addTo(map),
    ];

    if (labels) {
      layers.push(L.tileLayer(`${root}/${reference}/MapServer/tile/{z}/{y}/{x}`, {
        maxZoom: 16,
        opacity: 0.9,
      }).addTo(map));
    }

    return layers;
  }

  function refreshTiles() {
    for (const map of [...tileLayers.keys()]) {
      for (const layer of tileLayers.get(map)) map.removeLayer(layer);
      tileLayers.set(map, addTiles(map, mapLabels.get(map)));
    }

    if (!screens.results.hidden && state.guesses.length) {
      renderResultsMap(computeResults());
    }
  }

  if (typeof DARK.addEventListener === 'function') {
    DARK.addEventListener('change', refreshTiles);
  } else if (typeof DARK.addListener === 'function') {
    DARK.addListener(refreshTiles);
  }

  function showScreen(name) {
    for (const [key, element] of Object.entries(screens)) {
      element.hidden = key !== name;
    }

    if (name === 'game') {
      ensureGameMap();
      requestAnimationFrame(() => gameMap.invalidateSize());
    }

    if (name === 'results' && resultsMap) {
      requestAnimationFrame(() => resultsMap.invalidateSize());
    }
  }

  function ensureGameMap() {
    if (gameMap) return;

    gameMap = createMap($('map'), false, { smooth: true });

    gameMap.on('click', (event) => {
      if (state.locked || screens.game.hidden) return;
      placePin(event.latlng.wrap());
    });

    const container = $('map');
    container.addEventListener('keydown', (event) => {
      if (event.target !== container) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (state.locked || screens.game.hidden) return;
      event.preventDefault();
      placePin(gameMap.getCenter().wrap());
    });
  }

  /* ---------- game ---------- */

  function placePin(latlng) {
    state.pin = { lat: latlng.lat, lng: latlng.lng };

    if (gamePin) {
      gamePin.setLatLng(latlng);
    } else {
      gamePin = L.marker(latlng, {
        icon: PIN_ICON,
        keyboard: false,
        alt: 'Your guess',
        zIndexOffset: 1000,
      }).addTo(gameMap);
    }

    $('btn-lock').disabled = false;
    $('pin-hint').textContent = 'Tap again to adjust.';
  }

  function clearPin() {
    if (gamePin && gameMap) gameMap.removeLayer(gamePin);
    gamePin = null;
    state.pin = null;
    $('btn-lock').disabled = true;
    $('pin-hint').textContent = 'Tap the map to drop a pin.';
  }

  function resetView() {
    if (!gameMap) return;
    gameMap.fitBounds(WORLD_BOUNDS, { animate: false });
  }

  async function lockIn() {
    if (!state.pin || state.locked) return;

    state.locked = true;
    state.guesses.push({ lat: state.pin.lat, lng: state.pin.lng });
    persistDaily();
    $('btn-lock').disabled = true;

    const mapElement = $('map');
    mapElement.classList.add('is-fading');

    await delay(REDUCED_MOTION.matches ? 20 : 170);

    clearPin();
    resetView();
    mapElement.classList.remove('is-fading');

    if (state.guesses.length >= ROUNDS) {
      finish();
      return;
    }

    state.round = state.guesses.length + 1;
    updateRoundUI();
    state.locked = false;
    announce(`Guess ${state.round} of ${ROUNDS}.`);
  }

  function startDaily() {
    const record = loadDaily();

    state.mode = 'daily';
    state.dailyKey = dailyKey();
    state.guesses = record ? record.guesses.slice(0, ROUNDS) : [];
    state.pin = null;
    state.locked = false;

    if (state.guesses.length >= ROUNDS) {
      showScreen('results');
      renderResults();
      return;
    }

    state.round = state.guesses.length + 1;
    showScreen('game');
    clearPin();
    resetView();
    updateRoundUI();
    announce(`Guess ${state.round} of ${ROUNDS}.`);
  }

  function startPractice() {
    state.mode = 'practice';
    state.dailyKey = null;
    state.guesses = [];
    state.pin = null;
    state.locked = false;
    state.round = 1;

    showScreen('game');
    clearPin();
    resetView();
    updateRoundUI();
    announce(`Practice. Guess 1 of ${ROUNDS}.`);
  }

  function finish() {
    state.locked = true;
    showScreen('results');
    renderResults();

    const total = totalScore(computeResults());
    announce(`Results. ${formatNumber(total)} out of 25,000. ${tierFor(total)}.`);
  }

  function updateRoundUI() {
    const round = Math.min(state.round, ROUNDS);
    $('round-counter').textContent = `Guess ${round} of ${ROUNDS}`;

    const dots = $('round-dots').children;
    for (let index = 0; index < dots.length; index += 1) {
      dots[index].classList.toggle('is-done', index < state.guesses.length);
      dots[index].classList.toggle('is-current', index === state.guesses.length && state.guesses.length < ROUNDS);
    }
  }

  function buildProgress() {
    const dots = $('round-dots');
    dots.replaceChildren();

    for (let index = 0; index < ROUNDS; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'progress__dot';
      dots.append(dot);
    }
  }

  /* ---------- results ---------- */

  function computeResults() {
    return state.guesses.map((guess, index) => {
      const km = haversineKm(guess, TARGET);
      return {
        index: index + 1,
        lat: guess.lat,
        lng: guess.lng,
        km,
        score: Math.round(MAX_ROUND_SCORE * Math.exp(-km / SCALE_KM)),
      };
    });
  }

  function totalScore(results) {
    return results.reduce((sum, result) => sum + result.score, 0);
  }

  function renderResults() {
    const results = computeResults();
    const total = totalScore(results);
    const daily = state.mode === 'daily';

    $('results-mode').textContent = daily ? 'Daily' : 'Practice';
    $('results-date').textContent = daily ? formatDate(new Date()) : 'Practice run';
    animateNumber($('results-total'), total);
    $('results-tier').textContent = tierFor(total);

    const list = $('results-list');
    list.replaceChildren();

    results.forEach((result, index) => {
      const item = document.createElement('li');
      item.style.setProperty('--i', index);
      item.setAttribute('aria-label', `Guess ${result.index}: ${formatDistance(result.km)}, ${formatNumber(result.score)} points`);

      const chip = document.createElement('span');
      chip.className = `row__chip ${chipClass(result.km)}`;
      chip.setAttribute('aria-hidden', 'true');

      const round = document.createElement('span');
      round.className = 'row__round';
      round.textContent = pad(result.index);

      const distance = document.createElement('span');
      distance.className = 'row__dist';
      distance.textContent = formatDistance(result.km);

      const score = document.createElement('span');
      score.className = 'row__score';
      score.textContent = formatNumber(result.score);

      item.append(chip, round, distance, score);
      list.append(item);
    });

    const again = $('btn-again');
    const note = $('results-note');

    if (daily) {
      again.textContent = 'Practice';
      note.textContent = 'A new daily challenge arrives at midnight.';
    } else {
      again.textContent = 'Go again';
      note.textContent = 'Practice runs don’t count toward the daily.';
    }

    const share = $('btn-share');
    share.textContent = 'Copy score';
    share.dataset.label = 'Copy score';

    renderResultsMap(results);
  }

  function renderResultsMap(results) {
    if (!resultsMap) {
      resultsMap = createMap($('results-map'), true);
    }

    if (!resultsLayers) {
      resultsLayers = L.layerGroup().addTo(resultsMap);
    }

    resultsLayers.clearLayers();

    const accent = getAccent();
    const targetLatLng = L.latLng(TARGET.lat, TARGET.lng);

    L.marker(targetLatLng, {
      icon: L.divIcon({
        className: 'target',
        html: '<span class="target__dot"></span><span class="target__label">Swindon</span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      keyboard: false,
      alt: 'Swindon',
      zIndexOffset: 1000,
    }).addTo(resultsLayers);

    const points = [targetLatLng];

    results.forEach((result) => {
      const latlng = L.latLng(result.lat, result.lng);
      points.push(latlng);

      L.polyline([latlng, targetLatLng], {
        color: accent,
        weight: 1.25,
        opacity: 0.5,
        dashArray: '3 5',
        interactive: false,
      }).addTo(resultsLayers);

      L.marker(latlng, {
        icon: L.divIcon({
          className: 'guess',
          html: `<span>${result.index}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        keyboard: false,
        alt: `Guess ${result.index}`,
        zIndexOffset: 500,
      }).addTo(resultsLayers);
    });

    requestAnimationFrame(() => {
      if (!resultsMap) return;
      resultsMap.invalidateSize();

      const bounds = L.latLngBounds(points);
      if (!bounds.isValid()) return;

      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      const isPoint = Math.abs(northEast.lat - southWest.lat) < 1e-9
        && Math.abs(northEast.lng - southWest.lng) < 1e-9;

      if (isPoint) {
        resultsMap.setView(bounds.getCenter(), 10, { animate: false });
      } else {
        resultsMap.fitBounds(bounds, { animate: false, padding: [48, 48], maxZoom: 12 });
      }
    });
  }

  function animateNumber(element, to) {
    if (REDUCED_MOTION.matches) {
      element.textContent = formatNumber(to);
      return;
    }

    const duration = 700;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatNumber(Math.round(to * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  /* ---------- share ---------- */

  async function shareResult() {
    const results = computeResults();
    const total = totalScore(results);
    const daily = state.mode === 'daily';
    const date = formatDateShort(new Date());
    const squares = results.map((result) => emojiFor(result.km)).join('');
    const text = [
      `swindon.lol · ${daily ? date : 'practice'}`,
      `${squares} ${formatNumber(total)} / 25,000`,
      tierFor(total),
    ].join('\n');

    let copied = false;

    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = fallbackCopy(text);
    }

    if (copied) {
      flashButton($('btn-share'), 'Copied');
      announce('Score copied to clipboard.');
    }
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    area.remove();
    return copied;
  }

  function flashButton(button, label) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = label;
    clearTimeout(button._flashTimer);
    button._flashTimer = setTimeout(() => {
      button.textContent = button.dataset.label || 'Copy score';
    }, 1600);
  }

  /* ---------- daily storage ---------- */

  function dailyKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function storageKey(dateKey) {
    return `${STORAGE_PREFIX}${dateKey}`;
  }

  function loadDaily() {
    try {
      const raw = localStorage.getItem(storageKey(dailyKey()));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.guesses)) return null;

      const guesses = parsed.guesses
        .filter((guess) => Number.isFinite(guess?.lat) && Number.isFinite(guess?.lng))
        .map((guess) => ({ lat: guess.lat, lng: guess.lng }));

      return { guesses };
    } catch {
      return null;
    }
  }

  function persistDaily() {
    if (state.mode !== 'daily' || !state.dailyKey) return;

    try {
      localStorage.setItem(storageKey(state.dailyKey), JSON.stringify({
        guesses: state.guesses,
        updated: Date.now(),
      }));
    } catch {
      /* storage unavailable, the game still works */
    }
  }

  function pruneDaily() {
    try {
      const today = storageKey(dailyKey());
      const stale = [];

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(STORAGE_PREFIX) && key !== today) stale.push(key);
      }

      stale.forEach((key) => localStorage.removeItem(key));
    } catch {
      /* ignore */
    }
  }

  function updateIntro() {
    const record = loadDaily();
    const count = record ? record.guesses.length : 0;
    const done = count >= ROUNDS;
    const button = $('btn-daily');
    const note = $('daily-note');

    $('intro-date').textContent = `Daily geography game · ${formatDateShort(new Date())}`;

    if (done) {
      button.textContent = 'View today’s result';
      note.textContent = 'Today’s run is done. Practice is open.';
    } else if (count > 0) {
      button.textContent = 'Continue today’s run';
      note.textContent = `Guess ${count + 1} of ${ROUNDS} waiting.`;
    } else {
      button.textContent = 'Daily challenge';
      note.textContent = 'One run a day. Practice is unlimited.';
    }
  }

  /* ---------- helpers ---------- */

  function haversineKm(a, b) {
    const radius = 6371.0088;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(b.lat - a.lat);
    const deltaLng = toRadians(b.lng - a.lng);
    const latA = toRadians(a.lat);
    const latB = toRadians(b.lat);

    const h = Math.sin(deltaLat / 2) ** 2
      + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;

    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatNumber(value) {
    return value.toLocaleString('en-GB');
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  function formatDateShort(date) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  function formatDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    if (km < 1000) return `${Math.round(km)} km`;
    return `${formatNumber(Math.round(km))} km`;
  }

  function tierFor(total) {
    if (total >= 22000) return 'Swindonian';
    if (total >= 15000) return 'Basically local';
    if (total >= 9000) return 'Wiltshire';
    if (total >= 4000) return 'Right island, wrong bit';
    if (total >= 1000) return 'Europe-adjacent';
    return 'Did you even look at a map?';
  }

  function chipClass(km) {
    if (km <= 5) return 'row__chip--green';
    if (km <= 25) return 'row__chip--yellow';
    if (km <= 100) return 'row__chip--orange';
    if (km <= 500) return 'row__chip--red';
    return 'row__chip--black';
  }

  function emojiFor(km) {
    if (km <= 5) return '🟩';
    if (km <= 25) return '🟨';
    if (km <= 100) return '🟧';
    if (km <= 500) return '🟥';
    return '⬛';
  }

  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8102e';
  }

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function announce(message) {
    const live = $('live');
    live.textContent = '';
    setTimeout(() => {
      live.textContent = message;
    }, 30);
  }

  /* ---------- boot ---------- */

  function bind() {
    $('btn-daily').addEventListener('click', startDaily);
    $('btn-practice').addEventListener('click', startPractice);
    $('btn-lock').addEventListener('click', lockIn);
    $('btn-share').addEventListener('click', shareResult);
    $('btn-again').addEventListener('click', startPractice);

    window.addEventListener('resize', () => {
      if (gameMap) gameMap.invalidateSize();
      if (resultsMap) resultsMap.invalidateSize();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updateIntro();
    });
  }

  pruneDaily();
  buildProgress();
  updateRoundUI();
  updateIntro();
  bind();
})();
