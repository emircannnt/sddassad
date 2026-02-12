const STORAGE_KEYS = {
  profile: "takt.profile",
  report: "takt.lastReport",
  settings: "takt.settings",
};

const MODES = {
  toparlanma: { label: "Toparlanma", high: 15, low: 20, info: "Aktif dinlenme / düşük stres geçişi." },
  yagYakimi: { label: "Yağ Yakımı", high: 20, low: 20, info: "Sürdürülebilir yağ oksidasyonu için dengeli interval." },
  kondisyon: { label: "Kondisyon", high: 20, low: 15, info: "Aerobik kapasiteyi büyüten yoğun ritim." },
  hizEsigi: { label: "Hız Eşiği", high: 20, low: 15, info: "Laktat eşiği toleransını yükseltme." },
  maksimumGuc: { label: "Maksimum Güç", high: 15, low: 20, info: "Patlayıcı efor + teknik toparlanma." },
};

const motivationPool = [
  "Çok iyi gidiyorsun!",
  "Hedefine az kaldı!",
  "Ritmini koru, güç sende.",
  "Nefesini kontrol et, harikasın!",
  "Tempo mükemmel, devam.",
];

const defaultSettings = { voiceCoach: true, speedAnnounce: true, spotifyClientId: "" };

const state = {
  profile: null,
  settings: { ...defaultSettings },
  watchId: null,
  speedKmh: 0,
  lastPos: null,
  totalDistanceKm: 0,
  calories: 0,
  speedSamples: [],
  workout: null,
  phaseTimer: null,
  ticker: null,
  motivationTimer: null,
  speedAnnounceTimer: null,
  wakeLock: null,
  stepCount: 0,
  lastStepAt: 0,
  motionAttached: false,
  hrDevice: null,
  hrCharacteristic: null,
  heartRate: null,
  spotify: {
    accessToken: null,
    expiresAt: 0,
    refreshTimer: null,
    isPlaying: false,
  },
};

const els = {
  onboarding: document.getElementById("onboarding"),
  dashboard: document.getElementById("dashboard"),
  report: document.getElementById("report"),
  form: document.getElementById("profile-form"),
  bmiPreview: document.getElementById("bmi-preview"),
  welcome: document.getElementById("welcome"),
  bmiStatus: document.getElementById("bmi-status"),
  speedDisplay: document.getElementById("speed-display"),
  calorieDisplay: document.getElementById("calorie-display"),
  healthPermission: document.getElementById("health-permission"),
  sensorStatus: document.getElementById("sensor-status"),
  modeSelect: document.getElementById("mode-select"),
  durationMin: document.getElementById("duration-min"),
  endless: document.getElementById("endless"),
  modeInfo: document.getElementById("mode-info"),
  phaseIndicator: document.getElementById("phase-indicator"),
  phaseCountdown: document.getElementById("phase-countdown"),
  totalRemaining: document.getElementById("total-remaining"),
  lapCount: document.getElementById("lap-count"),
  startWorkout: document.getElementById("start-workout"),
  pauseWorkout: document.getElementById("pause-workout"),
  resumeWorkout: document.getElementById("resume-workout"),
  stopWorkout: document.getElementById("stop-workout"),
  totalDistance: document.getElementById("total-distance"),
  avgSpeed: document.getElementById("avg-speed"),
  totalCalories: document.getElementById("total-calories"),
  chart: document.getElementById("speed-chart"),
  researchList: document.getElementById("research-list"),
  ideasList: document.getElementById("ideas-list"),
  voiceCoach: document.getElementById("voice-coach"),
  speedAnnounce: document.getElementById("speed-announce"),
  permGeolocation: document.getElementById("perm-geolocation"),
  permMotion: document.getElementById("perm-motion"),
  permNotification: document.getElementById("perm-notification"),
  stepsDisplay: document.getElementById("steps-display"),
  heartRateDisplay: document.getElementById("heart-rate-display"),
  connectHr: document.getElementById("connect-hr"),
  spotifyClientId: document.getElementById("spotify-client-id"),
  spotifyConnect: document.getElementById("spotify-connect"),
  spotifyDisconnect: document.getElementById("spotify-disconnect"),
  spotifyStatus: document.getElementById("spotify-status"),
  spotifyTrack: document.getElementById("spotify-track"),
  spotifyPrev: document.getElementById("spotify-prev"),
  spotifyToggle: document.getElementById("spotify-toggle"),
  spotifyNext: document.getElementById("spotify-next"),
};

const safeParse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

const toFixed = (v, d = 1) => Number(v || 0).toFixed(d);
const computeBMI = (weight, heightCm) => weight / ((heightCm / 100) ** 2);

function bmiCategory(bmi) {
  if (bmi < 18.5) return "Düşük - Kilo artışı önerilir";
  if (bmi < 24.9) return "Fit / Normal";
  if (bmi < 29.9) return "Kontrollü Yağ Azaltımı Önerilir";
  return "Yüksek - Profesyonel plan önerilir";
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function load(key, fallback = null) { return safeParse(localStorage.getItem(key), fallback); }

function updatePermissionChip(el, label, status) {
  el.className = "chip";
  if (status === "granted") el.classList.add("ok");
  else if (status === "prompt") el.classList.add("warn");
  else el.classList.add("err");
  el.textContent = `${label}: ${status}`;
}

async function refreshPermissionState() {
  if (navigator.permissions) {
    try {
      const geo = await navigator.permissions.query({ name: "geolocation" });
      updatePermissionChip(els.permGeolocation, "Konum", geo.state);
    } catch {
      updatePermissionChip(els.permGeolocation, "Konum", "unknown");
    }
  }

  const motionState = typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"
    ? "prompt"
    : "granted";
  updatePermissionChip(els.permMotion, "Hareket", motionState);

  const notif = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  updatePermissionChip(els.permNotification, "Bildirim", notif);
}

function renderSensorValues() {
  els.stepsDisplay.textContent = String(state.stepCount);
  els.heartRateDisplay.textContent = state.heartRate ? `${state.heartRate} bpm` : "-- bpm";
}

function handleMotionStep(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;
  const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
  const now = Date.now();
  const threshold = 12.2;
  if (magnitude > threshold && now - state.lastStepAt > 320) {
    state.stepCount += 1;
    state.lastStepAt = now;
    renderSensorValues();
  }
}

async function enableMotionTracking() {
  if (state.motionAttached) return "aktif";
  if (typeof DeviceMotionEvent === "undefined") return "desteklenmiyor";

  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const result = await DeviceMotionEvent.requestPermission();
    if (result !== "granted") return result;
  }

  window.addEventListener("devicemotion", handleMotionStep);
  state.motionAttached = true;
  return "granted";
}

function parseHeartRate(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  const is16Bit = flags & 0x1;
  const hr = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
  state.heartRate = hr;
  renderSensorValues();
}

async function connectHeartRateSensor() {
  if (!navigator.bluetooth) {
    els.sensorStatus.textContent = "Sensör durumu: Bluetooth API desteklenmiyor.";
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0x180d] }],
      optionalServices: [0x180d],
    });
    state.hrDevice = device;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(0x180d);
    const characteristic = await service.getCharacteristic(0x2a37);
    state.hrCharacteristic = characteristic;
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", parseHeartRate);
    device.addEventListener("gattserverdisconnected", () => {
      state.heartRate = null;
      renderSensorValues();
      els.sensorStatus.textContent = "Sensör durumu: Nabız sensörü bağlantısı kesildi.";
    });
    els.sensorStatus.textContent = "Sensör durumu: Nabız sensörü bağlı.";
  } catch {
    els.sensorStatus.textContent = "Sensör durumu: Nabız sensörü bağlantısı kurulamadı.";
  }
}



function spotifyRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function setSpotifyControlsEnabled(enabled) {
  els.spotifyPrev.disabled = !enabled;
  els.spotifyToggle.disabled = !enabled;
  els.spotifyNext.disabled = !enabled;
  els.spotifyDisconnect.disabled = !enabled;
}

function startSpotifyPolling() {
  if (state.spotify.refreshTimer) clearInterval(state.spotify.refreshTimer);
  state.spotify.refreshTimer = setInterval(refreshSpotifyPlayback, 5000);
}

function stopSpotifyPolling() {
  if (state.spotify.refreshTimer) clearInterval(state.spotify.refreshTimer);
  state.spotify.refreshTimer = null;
}

function loadSpotifySession() {
  const saved = load("takt.spotify");
  if (saved?.accessToken && saved?.expiresAt && Date.now() < saved.expiresAt) {
    state.spotify.accessToken = saved.accessToken;
    state.spotify.expiresAt = saved.expiresAt;
    els.spotifyStatus.textContent = "Spotify durumu: bağlı";
    setSpotifyControlsEnabled(true);
    return true;
  }
  return false;
}

function saveSpotifySession() {
  if (!state.spotify.accessToken) {
    localStorage.removeItem("takt.spotify");
    return;
  }
  save("takt.spotify", { accessToken: state.spotify.accessToken, expiresAt: state.spotify.expiresAt });
}

function clearSpotifySession() {
  stopSpotifyPolling();
  state.spotify.accessToken = null;
  state.spotify.expiresAt = 0;
  state.spotify.isPlaying = false;
  saveSpotifySession();
  els.spotifyStatus.textContent = "Spotify durumu: bağlı değil";
  els.spotifyTrack.textContent = "Çalan: -";
  els.spotifyToggle.textContent = "Oynat / Duraklat";
  setSpotifyControlsEnabled(false);
}

function startSpotifyAuth() {
  const clientId = (els.spotifyClientId.value || "").trim();
  if (!clientId) {
    els.spotifyStatus.textContent = "Spotify durumu: önce Client ID girin.";
    return;
  }
  state.settings.spotifyClientId = clientId;
  save(STORAGE_KEYS.settings, state.settings);

  const scopes = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"].join(" ");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", spotifyRedirectUri());
  url.searchParams.set("scope", scopes);
  url.searchParams.set("show_dialog", "true");
  window.location.href = url.toString();
}

function consumeSpotifyHashToken() {
  if (!window.location.hash.includes("access_token=")) return;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get("access_token");
  const expiresIn = Number(hash.get("expires_in") || 3600);
  if (token) {
    state.spotify.accessToken = token;
    state.spotify.expiresAt = Date.now() + expiresIn * 1000;
    saveSpotifySession();
    els.spotifyStatus.textContent = "Spotify durumu: bağlandı";
    setSpotifyControlsEnabled(true);
  }
  history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

async function spotifyApi(path, method = "GET") {
  if (!state.spotify.accessToken || Date.now() >= state.spotify.expiresAt) {
    clearSpotifySession();
    throw new Error("Spotify token süresi doldu");
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.spotify.accessToken}` },
  });

  if (res.status === 401) {
    clearSpotifySession();
    throw new Error("Spotify yetkilendirme hatası");
  }

  if (res.status === 204) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || "Spotify API hatası");
  }
  return res.json();
}

async function refreshSpotifyPlayback() {
  if (!state.spotify.accessToken) return;
  try {
    const data = await spotifyApi("/me/player");
    if (!data || !data.item) {
      els.spotifyTrack.textContent = "Çalan: aktif cihaz veya parça yok";
      return;
    }
    state.spotify.isPlaying = !!data.is_playing;
    const artist = data.item.artists?.map((a) => a.name).join(", ") || "-";
    els.spotifyTrack.textContent = `Çalan: ${data.item.name} — ${artist}`;
    els.spotifyToggle.textContent = state.spotify.isPlaying ? "Duraklat" : "Oynat";
  } catch {
    els.spotifyStatus.textContent = "Spotify durumu: aktif oynatma bulunamadı veya cihaz seçili değil.";
  }
}

async function spotifyTogglePlay() {
  try {
    await spotifyApi(state.spotify.isPlaying ? "/me/player/pause" : "/me/player/play", "PUT");
    setTimeout(refreshSpotifyPlayback, 300);
  } catch {
    els.spotifyStatus.textContent = "Spotify durumu: oynatma kontrolü başarısız.";
  }
}

async function spotifyNext() {
  try {
    await spotifyApi("/me/player/next", "POST");
    setTimeout(refreshSpotifyPlayback, 300);
  } catch {
    els.spotifyStatus.textContent = "Spotify durumu: sonraki parçaya geçilemedi.";
  }
}

async function spotifyPrev() {
  try {
    await spotifyApi("/me/player/previous", "POST");
    setTimeout(refreshSpotifyPlayback, 300);
  } catch {
    els.spotifyStatus.textContent = "Spotify durumu: önceki parçaya dönülemedi.";
  }
}

function populateModes() {
  Object.entries(MODES).forEach(([key, mode]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${mode.label} (${mode.high}/${mode.low} sn)`;
    els.modeSelect.append(option);
  });
  updateModeInfo();
}

function updateModeInfo() {
  const mode = MODES[els.modeSelect.value];
  els.modeInfo.textContent = `${mode.info} | Komutlar ${mode.high}-${mode.low} sn aralığında.`;
}

function renderProfile(profile) {
  const bmi = computeBMI(profile.weight, profile.height);
  els.welcome.textContent = `Hoş geldin ${profile.firstName}!`;
  els.bmiStatus.textContent = `${toFixed(bmi, 1)} — ${bmiCategory(bmi)}`;
  els.onboarding.classList.add("hidden");
  els.dashboard.classList.remove("hidden");
}

function renderReport(report) {
  if (!report) return;
  els.report.classList.remove("hidden");
  els.totalDistance.textContent = `${toFixed(report.distanceKm, 2)} km`;
  els.avgSpeed.textContent = `${toFixed(report.avgSpeed, 2)} km/sa`;
  els.totalCalories.textContent = `${toFixed(report.calories, 1)} kcal`;
  drawChart(report.speedSamples || []);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function estimateCaloriesPerMinute(speedKmh, kg) {
  const met = speedKmh < 5 ? 3 : speedKmh < 8 ? 6 : speedKmh < 11 ? 9 : 12;
  return (met * 3.5 * kg) / 200;
}

function requestGeoTracking() {
  if (!navigator.geolocation) {
    els.sensorStatus.textContent = "GPS desteklenmiyor.";
    return;
  }
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, speed } = pos.coords;
      const now = pos.timestamp;
      let kmh = speed ? speed * 3.6 : 0;

      if (!kmh && state.lastPos) {
        const d = haversine(state.lastPos.latitude, state.lastPos.longitude, latitude, longitude);
        const tHours = (now - state.lastPos.timestamp) / 3_600_000;
        if (tHours > 0) kmh = d / tHours;
        state.totalDistanceKm += d;
      }

      state.lastPos = { latitude, longitude, timestamp: now };
      state.speedKmh = kmh;
      state.speedSamples.push(kmh);
      const caloriePerMin = estimateCaloriesPerMinute(kmh, state.profile.weight);
      state.calories += caloriePerMin / 60;

      els.speedDisplay.innerHTML = `${toFixed(kmh, 1)} <span>km/sa</span>`;
      els.calorieDisplay.textContent = `${toFixed(caloriePerMin, 2)} kcal/dk`;
    },
    () => {
      els.sensorStatus.textContent = "GPS izni reddedildi veya alınamadı.";
      refreshPermissionState();
    },
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 1500 },
  );
}

async function requestHealthPermissions() {
  const messages = [];
  requestGeoTracking();
  messages.push("Konum: isteniyor/alındı");

  const motion = await enableMotionTracking();
  messages.push(`Hareket: ${motion}`);

  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    const notifResult = await Notification.requestPermission();
    messages.push(`Bildirim: ${notifResult}`);
  } else if (typeof Notification !== "undefined") {
    messages.push(`Bildirim: ${Notification.permission}`);
  } else {
    messages.push("Bildirim: desteklenmiyor");
  }

  els.sensorStatus.textContent = `Sensör durumu: ${messages.join(" | ")}`;
  refreshPermissionState();
}

function getTurkishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.startsWith("tr") && /female|kadın/i.test(v.name))
    || voices.find((v) => v.lang.startsWith("tr"));
}

function duckAudio(active) {
  document.querySelectorAll("audio, video").forEach((el) => {
    el.volume = active ? 0.2 : 1;
  });
}

function speak(text) {
  if (!state.settings.voiceCoach || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "tr-TR";
  utterance.rate = 1;
  utterance.pitch = 1.08;
  const voice = getTurkishVoice();
  if (voice) utterance.voice = voice;
  duckAudio(true);
  utterance.onend = () => duckAudio(false);
  speechSynthesis.speak(utterance);
}

function announceSpeed() {
  if (!state.settings.speedAnnounce || !state.workout || state.workout.paused) return;
  speak(`Anlık hızın ${toFixed(state.speedKmh, 1)} kilometre saat`);
}

function startSpeedAnnouncements() {
  clearInterval(state.speedAnnounceTimer);
  state.speedAnnounceTimer = setInterval(announceSpeed, 20_000);
}

function stopSpeedAnnouncements() { clearInterval(state.speedAnnounceTimer); }

function vibratePattern(pattern = [200, 100, 200]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    state.wakeLock = null;
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
  }
}

function resetSessionMetrics() {
  state.totalDistanceKm = 0;
  state.calories = 0;
  state.speedSamples = [];
  state.lastPos = null;
  state.stepCount = 0;
  renderSensorValues();
}

function scheduleMotivation() {
  const delay = (15 + Math.floor(Math.random() * 6)) * 1000;
  state.motivationTimer = setTimeout(() => {
    if (!state.workout || state.workout.paused) return;
    const msg = motivationPool[Math.floor(Math.random() * motivationPool.length)];
    speak(msg);
    scheduleMotivation();
  }, delay);
}

function updateLiveTimer() {
  if (!state.workout) return;
  const now = Date.now();
  els.phaseCountdown.textContent = formatClock(state.workout.phaseEndsAt - now);
  els.totalRemaining.textContent = state.workout.endless ? "∞" : formatClock(state.workout.totalEndsAt - now);
}

function runPhase() {
  if (!state.workout) return;
  const isHigh = state.workout.phase === "high";
  const mode = state.workout.mode;
  const sec = isHigh ? mode.high : mode.low;
  const command = isHigh ? "Hızlan!" : "Yavaşla!";

  els.phaseIndicator.textContent = `${command} (${sec} sn)`;
  els.lapCount.textContent = String(state.workout.laps);
  state.workout.phaseEndsAt = Date.now() + sec * 1000;

  speak(command);
  vibratePattern(isHigh ? [250, 120, 250] : [120, 80, 120]);

  clearTimeout(state.phaseTimer);
  state.phaseTimer = setTimeout(() => {
    if (!state.workout || state.workout.paused) return;
    if (!state.workout.endless && Date.now() >= state.workout.totalEndsAt) {
      stopWorkout();
      return;
    }
    if (!isHigh) state.workout.laps += 1;
    state.workout.phase = isHigh ? "low" : "high";
    runPhase();
  }, sec * 1000);
}

function setControlStates({ start, pause, resume, stop }) {
  els.startWorkout.disabled = !start;
  els.pauseWorkout.disabled = !pause;
  els.resumeWorkout.disabled = !resume;
  els.stopWorkout.disabled = !stop;
}

function startWorkout() {
  if (!state.profile) return;
  resetSessionMetrics();

  const mode = MODES[els.modeSelect.value];
  const endless = els.endless.checked;
  const totalMs = Number(els.durationMin.value) * 60_000;

  state.workout = { mode, endless, totalMs, totalEndsAt: Date.now() + totalMs, phase: "high", phaseEndsAt: Date.now(), laps: 1, paused: false };

  setControlStates({ start: false, pause: true, resume: false, stop: true });
  requestWakeLock();
  requestGeoTracking();

  clearInterval(state.ticker);
  state.ticker = setInterval(() => {
    updateLiveTimer();
    if (!state.workout?.endless && Date.now() >= state.workout.totalEndsAt) stopWorkout();
  }, 250);

  clearTimeout(state.motivationTimer);
  scheduleMotivation();
  startSpeedAnnouncements();
  runPhase();
}

function pauseWorkout() {
  if (!state.workout || state.workout.paused) return;
  state.workout.paused = true;
  state.workout.pauseStartedAt = Date.now();
  clearTimeout(state.phaseTimer);
  clearTimeout(state.motivationTimer);
  stopSpeedAnnouncements();
  els.phaseIndicator.textContent = "Duraklatıldı";
  setControlStates({ start: false, pause: false, resume: true, stop: true });
}

function resumeWorkout() {
  if (!state.workout || !state.workout.paused) return;
  const pausedMs = Date.now() - state.workout.pauseStartedAt;
  if (!state.workout.endless) state.workout.totalEndsAt += pausedMs;
  state.workout.phaseEndsAt += pausedMs;
  state.workout.paused = false;
  setControlStates({ start: false, pause: true, resume: false, stop: true });
  scheduleMotivation();
  startSpeedAnnouncements();

  const remainingPhaseMs = Math.max(100, state.workout.phaseEndsAt - Date.now());
  clearTimeout(state.phaseTimer);
  state.phaseTimer = setTimeout(() => {
    if (!state.workout || state.workout.paused) return;
    const wasHigh = state.workout.phase === "high";
    if (!wasHigh) state.workout.laps += 1;
    state.workout.phase = wasHigh ? "low" : "high";
    runPhase();
  }, remainingPhaseMs);

  els.phaseIndicator.textContent = "Devam ediyor";
}

function stopWorkout() {
  clearTimeout(state.phaseTimer);
  clearTimeout(state.motivationTimer);
  clearInterval(state.ticker);
  stopSpeedAnnouncements();
  releaseWakeLock();
  setControlStates({ start: true, pause: false, resume: false, stop: false });
  els.phaseIndicator.textContent = "Tamamlandı";

  const avgSpeed = state.speedSamples.length ? state.speedSamples.reduce((a, b) => a + b, 0) / state.speedSamples.length : 0;
  const report = { distanceKm: state.totalDistanceKm, avgSpeed, calories: state.calories, speedSamples: state.speedSamples.slice(-80), at: new Date().toISOString() };

  save(STORAGE_KEYS.report, report);
  renderReport(report);
  state.workout = null;
}

function drawChart(samples) {
  const ctx = els.chart.getContext("2d");
  ctx.clearRect(0, 0, els.chart.width, els.chart.height);
  if (!samples.length) return;

  ctx.strokeStyle = "#2ba8ff";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = (i / Math.max(samples.length - 1, 1)) * (els.chart.width - 20) + 10;
    const y = els.chart.height - (Math.min(s, 20) / 20) * (els.chart.height - 34) - 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderResearch() {
  const rows = [
    "Toparlanma: 15sn hızlan + 20sn yavaşla, toplam 12-20 dk.",
    "Yağ Yakımı: 20sn orta-yüksek tempo + 20sn aktif dinlenme, 20-30 dk.",
    "Kondisyon: 20sn yüksek tempo + 15sn düşük tempo, 15-24 dk.",
    "Hız Eşiği: 20sn eşik üstü + 15sn kontrol, 12-20 dk.",
    "Maksimum Güç: 15sn tam güç + 20sn toparlanma, 10-16 dk.",
  ];
  els.researchList.innerHTML = "";
  rows.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    els.researchList.append(li);
  });
}

function renderIdeas() {
  const ideas = [
    "Native köprü (Capacitor/React Native) ile HealthKit + Google Fit adım/nabız entegrasyonu.",
    "Bluetooth kalp atış sensörü (BLE) ile gerçek nabız zonları ve canlı uyarı.",
    "Kişiye özel yüklenme: son 7 antrenman trendine göre otomatik mod/süre önerisi.",
    "Bulut senkronizasyonu + koç paneli: antrenman geçmişi, hedef planı, uzak takip.",
    "Müzik uygulaması SDK entegrasyonu ile gerçek audio ducking ve tempo eşleştirme.",
  ];
  els.ideasList.innerHTML = "";
  ideas.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    els.ideasList.append(li);
  });
}

function registerPWA() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
}

function bindEvents() {
  const heightInput = els.form.elements.height;
  const weightInput = els.form.elements.weight;

  const updateBMI = () => {
    const h = Number(heightInput.value);
    const w = Number(weightInput.value);
    if (!h || !w) {
      els.bmiPreview.textContent = "-";
      return;
    }
    const bmi = computeBMI(w, h);
    els.bmiPreview.textContent = `${toFixed(bmi, 1)} (${bmiCategory(bmi)})`;
  };

  heightInput.addEventListener("input", updateBMI);
  weightInput.addEventListener("input", updateBMI);

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(els.form);
    const profile = {
      firstName: data.get("firstName").toString().trim(),
      lastName: data.get("lastName").toString().trim(),
      height: Number(data.get("height")),
      weight: Number(data.get("weight")),
    };
    state.profile = profile;
    save(STORAGE_KEYS.profile, profile);
    renderProfile(profile);
    requestGeoTracking();
  });

  els.voiceCoach.addEventListener("change", () => {
    state.settings.voiceCoach = els.voiceCoach.checked;
    save(STORAGE_KEYS.settings, state.settings);
  });

  els.speedAnnounce.addEventListener("change", () => {
    state.settings.speedAnnounce = els.speedAnnounce.checked;
    if (!state.settings.speedAnnounce) stopSpeedAnnouncements();
    else if (state.workout && !state.workout.paused) startSpeedAnnouncements();
    save(STORAGE_KEYS.settings, state.settings);
  });

  els.modeSelect.addEventListener("change", updateModeInfo);
  els.spotifyClientId.addEventListener("change", () => {
    state.settings.spotifyClientId = els.spotifyClientId.value.trim();
    save(STORAGE_KEYS.settings, state.settings);
  });
  els.spotifyConnect.addEventListener("click", startSpotifyAuth);
  els.spotifyDisconnect.addEventListener("click", clearSpotifySession);
  els.spotifyToggle.addEventListener("click", spotifyTogglePlay);
  els.spotifyNext.addEventListener("click", spotifyNext);
  els.spotifyPrev.addEventListener("click", spotifyPrev);
  els.healthPermission.addEventListener("click", requestHealthPermissions);
  els.connectHr.addEventListener("click", connectHeartRateSensor);
  els.startWorkout.addEventListener("click", startWorkout);
  els.pauseWorkout.addEventListener("click", pauseWorkout);
  els.resumeWorkout.addEventListener("click", resumeWorkout);
  els.stopWorkout.addEventListener("click", stopWorkout);
}

function boot() {
  populateModes();
  renderResearch();
  renderIdeas();
  bindEvents();
  registerPWA();
  refreshPermissionState();

  state.settings = { ...defaultSettings, ...load(STORAGE_KEYS.settings, defaultSettings) };
  els.voiceCoach.checked = state.settings.voiceCoach;
  els.speedAnnounce.checked = state.settings.speedAnnounce;
  els.spotifyClientId.value = state.settings.spotifyClientId || "";
  setSpotifyControlsEnabled(false);
  renderSensorValues();

  consumeSpotifyHashToken();
  const spotifyConnected = loadSpotifySession();
  if (spotifyConnected) {
    refreshSpotifyPlayback();
    startSpotifyPolling();
  }

  const profile = load(STORAGE_KEYS.profile);
  if (profile) {
    state.profile = profile;
    renderProfile(profile);
    requestGeoTracking();
  }

  renderReport(load(STORAGE_KEYS.report));
}

boot();
