import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const STORAGE = {
  profile: "takt.profile",
  settings: "takt.settings",
};

const MODES = {
  recovery: {
    label: "Recovery",
    tag: "TOPARLANMA",
    workMin: 5,
    workMax: 7,
    restMin: 3,
    restMax: 4,
    workSec: 120,
    restSec: 60,
    coachTone: "Sakin ama disiplinli",
  },
  fatBurn: {
    label: "Fat Burn",
    tag: "YAĞ YAKIM",
    workMin: 8,
    workMax: 10,
    restMin: 5,
    restMax: 6,
    workSec: 180,
    restSec: 120,
    coachTone: "Ritim odaklı",
  },
  conditioning: {
    label: "Conditioning",
    tag: "KONDİSYON",
    workMin: 11,
    workMax: 13,
    restMin: 6,
    restMax: 7,
    workSec: 120,
    restSec: 120,
    coachTone: "Dayanıklılık koçu",
  },
  threshold: {
    label: "Threshold",
    tag: "HIZ EŞİĞİ",
    workMin: 14,
    workMax: 16,
    restMin: 7,
    restMax: 8,
    workSec: 240,
    restSec: 120,
    coachTone: "Sert eşik koçu",
  },
  maxPower: {
    label: "Max Power",
    tag: "MAKS GÜÇ",
    workMin: 17,
    workMax: 22,
    restMin: 4,
    restMax: 5,
    workSec: 30,
    restSec: 90,
    coachTone: "En sert mod",
  },
};

const motivationPool = [
  "Çok iyi gidiyorsun!",
  "TAKT'ı yakaladın, devam et!",
  "Ritmi bırakma!",
  "Mükemmel disiplin!",
];

const caloriesFromSpeed = (speed, kg) => {
  const met = speed < 5 ? 3 : speed < 8 ? 6 : speed < 11 ? 9 : 12;
  return (met * 3.5 * kg) / 200;
};

function bmiCategory(bmi) {
  if (bmi < 18.5) return "LOW";
  if (bmi < 24.9) return "FIT";
  if (bmi < 29.9) return "AVG";
  return "HIGH";
}

function formatTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function RingGauge({ valueText, subtitle, status }) {
  return (
    <View style={styles.ringWrap}>
      <View style={styles.ringOuter} />
      <View style={styles.ringActive} />
      <View style={styles.ringCenter}>
        <Text style={styles.ringSubtitle}>{subtitle}</Text>
        <Text style={styles.ringValue}>{valueText}</Text>
        {!!status && <Text style={styles.ringStatus}>{status}</Text>}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState("onboarding");
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", height: "", weight: "", age: "28" });
  const [settings, setSettings] = useState({ voiceCoach: true, speedAnnounce: true, spotifyClientId: "" });

  const [modeKey, setModeKey] = useState("fatBurn");
  const [totalDurationMin, setTotalDurationMin] = useState("20");

  const [speedKmh, setSpeedKmh] = useState(0);
  const [rawSpeedKmh, setRawSpeedKmh] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [calorieRate, setCalorieRate] = useState(0);
  const [totalCalories, setTotalCalories] = useState(0);
  const [bpm, setBpm] = useState(0);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState("READY");
  const [phaseLeft, setPhaseLeft] = useState(0);
  const [sessionLeft, setSessionLeft] = useState(0);
  const [laps, setLaps] = useState(1);
  const [coachLine, setCoachLine] = useState("Hazır");

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyTrack, setSpotifyTrack] = useState("-");
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);

  const watchRef = useRef(null);
  const tickerRef = useRef(null);
  const phaseTimeoutRef = useRef(null);
  const motivationRef = useRef(null);
  const spotifyPollRef = useRef(null);

  const currentPhaseRef = useRef("work");
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const speedRef = useRef(0);
  const calorieRateRef = useRef(0);
  const warningCooldownRef = useRef(0);
  const lastGpsRef = useRef(null);
  const transitionWarnedRef = useRef(false);
  const smoothSpeedRef = useRef(0);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: "taktmobile" });
  const [spotifyRequest, spotifyResponse, spotifyPromptAsync] = AuthSession.useAuthRequest(
    {
      clientId: settings.spotifyClientId?.trim() || "",
      responseType: AuthSession.ResponseType.Token,
      scopes: ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"],
      redirectUri,
    },
    { authorizationEndpoint: "https://accounts.spotify.com/authorize" },
  );

  const mode = MODES[modeKey];

  const bmi = useMemo(() => {
    const h = Number(profile?.height || form.height);
    const w = Number(profile?.weight || form.weight);
    if (!h || !w) return 0;
    return w / ((h / 100) ** 2);
  }, [profile, form.height, form.weight]);

  useEffect(() => {
    runningRef.current = running;
    pausedRef.current = paused;
    speedRef.current = speedKmh;
    calorieRateRef.current = calorieRate;
  }, [running, paused, speedKmh, calorieRate]);

  useEffect(() => {
    (async () => {
      const [storedProfile, storedSettings] = await Promise.all([
        AsyncStorage.getItem(STORAGE.profile),
        AsyncStorage.getItem(STORAGE.settings),
      ]);
      if (storedSettings) setSettings((prev) => ({ ...prev, ...JSON.parse(storedSettings) }));
      if (storedProfile) {
        const parsed = JSON.parse(storedProfile);
        setProfile(parsed);
        setScreen("home");
        startLocation(parsed.weight);
      }
    })();
  }, []);

  useEffect(() => {
    if (spotifyResponse?.type === "success") {
      const token = spotifyResponse.params?.access_token;
      if (token) {
        setSpotifyToken(token);
        Alert.alert("Spotify", "Bağlandı");
      }
    }
  }, [spotifyResponse]);

  useEffect(() => {
    if (!spotifyToken) {
      if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
      setSpotifyTrack("-");
      setSpotifyPlaying(false);
      return;
    }
    refreshSpotifyPlayback(spotifyToken);
    if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
    spotifyPollRef.current = setInterval(() => refreshSpotifyPlayback(spotifyToken), 5000);
    return () => {
      if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
    };
  }, [spotifyToken]);

  useEffect(() => {
    return () => {
      stopWorkoutInternal();
      if (watchRef.current) watchRef.current.remove();
      if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
    };
  }, []);

  const speakCoach = (text) => {
    setCoachLine(text);
    if (!settings.voiceCoach) return;
    Speech.speak(text, { language: "tr-TR", rate: 1, pitch: 1.05 });
  };

  const saveSettings = async (next) => {
    setSettings(next);
    await AsyncStorage.setItem(STORAGE.settings, JSON.stringify(next));
  };

  const startLocation = async (weight) => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return;

    if (watchRef.current) watchRef.current.remove();
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (loc) => {
        const nowTs = loc.timestamp;
        let instantKmh = (loc.coords.speed ?? 0) * 3.6;

        if (!instantKmh && lastGpsRef.current) {
          const prev = lastGpsRef.current;
          const dt = Math.max((nowTs - prev.ts) / 1000, 0.5);
          const dLat = ((loc.coords.latitude - prev.lat) * Math.PI) / 180;
          const dLon = ((loc.coords.longitude - prev.lon) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((prev.lat * Math.PI) / 180) *
              Math.cos((loc.coords.latitude * Math.PI) / 180) *
              Math.sin(dLon / 2) ** 2;
          const km = 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
          instantKmh = (km / dt) * 3600;
        }

        const alpha = 0.35;
        smoothSpeedRef.current = smoothSpeedRef.current
          ? smoothSpeedRef.current * (1 - alpha) + instantKmh * alpha
          : instantKmh;

        setRawSpeedKmh(instantKmh);
        setSpeedKmh(smoothSpeedRef.current);
        setBpm(Math.round(Math.min(185, Math.max(95, 95 + smoothSpeedRef.current * 4.2))));
        setCalorieRate(caloriesFromSpeed(smoothSpeedRef.current, weight));

        lastGpsRef.current = {
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          ts: nowTs,
        };
      },
    );
  };

  const onSaveProfile = async () => {
    const next = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      height: Number(form.height),
      weight: Number(form.weight),
      age: Number(form.age),
    };
    if (!next.firstName || !next.lastName || !next.height || !next.weight) {
      Alert.alert("Eksik bilgi", "Lütfen tüm alanları doldurun.");
      return;
    }
    setProfile(next);
    await AsyncStorage.setItem(STORAGE.profile, JSON.stringify(next));
    await startLocation(next.weight);
    setScreen("home");
  };

  const stopWorkoutInternal = () => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
    if (motivationRef.current) clearInterval(motivationRef.current);
    tickerRef.current = null;
    phaseTimeoutRef.current = null;
    motivationRef.current = null;
  };

  const switchPhase = (to) => {
    currentPhaseRef.current = to;
    const sec = to === "work" ? mode.workSec : mode.restSec;
    setPhase(to === "work" ? "HIZLAN" : "YAVAŞLA");
    setPhaseLeft(sec);
    transitionWarnedRef.current = false;
    warningCooldownRef.current = 0;
    speakCoach(to === "work" ? "Hızlan, hedef hıza çık!" : "Yavaşla, kontrollü toparlan.");
  };

  const startWorkout = () => {
    if (!profile) return;
    stopWorkoutInternal();

    const totalSec = Math.max(60, Number(totalDurationMin || 20) * 60);
    setScreen("workout");
    setRunning(true);
    setPaused(false);
    setDistanceKm(0);
    setTotalCalories(0);
    setSessionLeft(totalSec);
    setLaps(1);
    switchPhase("work");

    tickerRef.current = setInterval(() => {
      const inWork = currentPhaseRef.current === "work";
      const targetMet = speedRef.current >= mode.workMin;

      let decremented = false;

      setPhaseLeft((v) => {
        if (v <= 0) return 0;

        if (inWork) {
          if (!targetMet) return v;
          decremented = true;
          return v - 1;
        }

        decremented = true;
        return v - 1;
      });

      if (inWork && !targetMet) {
        warningCooldownRef.current += 1;
        speakCoach(`Yavaşladın! TAKT'ı yakala: en az ${mode.workMin} km/sa.`);
        if (warningCooldownRef.current >= 6) {
          speakCoach(`Süre durdu. ${mode.workMin} km/sa hıza çık.`);
          warningCooldownRef.current = 0;
        }
      }

      if (decremented) {
        setSessionLeft((v) => {
          if (v <= 1) {
            stopWorkout();
            return 0;
          }
          return v - 1;
        });

        setDistanceKm((d) => d + speedRef.current / 3600);
        setTotalCalories((c) => c + calorieRateRef.current / 60);
      }

      setPhaseLeft((current) => {
        if (!transitionWarnedRef.current && current > 0 && current <= 5) {
          transitionWarnedRef.current = true;
          speakCoach("3, 2, 1... Faz değişiyor.");
        }

        if (current <= 0) {
          if (currentPhaseRef.current === "work") {
            switchPhase("rest");
          } else {
            setLaps((l) => l + 1);
            switchPhase("work");
          }
          return currentPhaseRef.current === "work" ? mode.workSec : mode.restSec;
        }
        return current;
      });
    }, 1000);

    motivationRef.current = setInterval(() => {
      const msg = motivationPool[Math.floor(Math.random() * motivationPool.length)];
      speakCoach(msg);
      if (settings.speedAnnounce) speakCoach(`Anlık hız ${speedRef.current.toFixed(1)} kilometre saat.`);
    }, 20000);
  };

  const pauseWorkout = () => {
    if (!runningRef.current) return;
    setPaused(true);
    setPhase("DURAKLATILDI");
    stopWorkoutInternal();
  };

  const resumeWorkout = () => {
    if (!runningRef.current) return;
    setPaused(false);
    speakCoach("Antrenman devam ediyor.");
    startWorkoutFromCurrentState();
  };

  const startWorkoutFromCurrentState = () => {
    stopWorkoutInternal();

    tickerRef.current = setInterval(() => {
      const inWork = currentPhaseRef.current === "work";
      const targetMet = speedRef.current >= mode.workMin;
      let decremented = false;

      setPhaseLeft((v) => {
        if (v <= 0) return 0;
        if (inWork && !targetMet) return v;
        decremented = true;
        return v - 1;
      });

      if (inWork && !targetMet) {
        warningCooldownRef.current += 1;
        if (warningCooldownRef.current >= 6) {
          speakCoach(`Süre durdu. ${mode.workMin} km/sa hıza çık.`);
          warningCooldownRef.current = 0;
        }
      }

      if (decremented) {
        setSessionLeft((v) => {
          if (v <= 1) {
            stopWorkout();
            return 0;
          }
          return v - 1;
        });
        setDistanceKm((d) => d + speedRef.current / 3600);
        setTotalCalories((c) => c + calorieRateRef.current / 60);
      }

      setPhaseLeft((current) => {
        if (!transitionWarnedRef.current && current > 0 && current <= 5) {
          transitionWarnedRef.current = true;
          speakCoach("3, 2, 1... Faz değişiyor.");
        }
        if (current <= 0) {
          if (currentPhaseRef.current === "work") {
            switchPhase("rest");
          } else {
            setLaps((l) => l + 1);
            switchPhase("work");
          }
          return currentPhaseRef.current === "work" ? mode.workSec : mode.restSec;
        }
        return current;
      });
    }, 1000);

    motivationRef.current = setInterval(() => {
      const msg = motivationPool[Math.floor(Math.random() * motivationPool.length)];
      speakCoach(msg);
      if (settings.speedAnnounce) speakCoach(`Anlık hız ${speedRef.current.toFixed(1)} kilometre saat.`);
    }, 20000);
  };

  const stopWorkout = () => {
    setRunning(false);
    setPaused(false);
    setPhase("TAMAMLANDI");
    stopWorkoutInternal();
    setScreen("home");
  };

  const connectSpotify = async () => {
    if (!settings.spotifyClientId?.trim()) {
      Alert.alert("Spotify", "Client ID girin.");
      return;
    }
    if (!spotifyRequest) {
      Alert.alert("Spotify", "Yetkilendirme hazır değil. Tekrar deneyin.");
      return;
    }
    const result = await spotifyPromptAsync();
    if (result.type !== "success") Alert.alert("Spotify", "Bağlantı tamamlanmadı.");
  };

  const spotifyApi = async (path, method = "GET") => {
    if (!spotifyToken) throw new Error("No token");
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error("Spotify request failed");
    return res.json();
  };

  const refreshSpotifyPlayback = async (token) => {
    try {
      const useToken = token || spotifyToken;
      if (!useToken) return;
      const res = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${useToken}` },
      });
      if (!res.ok || res.status === 204) {
        setSpotifyTrack("Aktif cihaz/parça yok");
        return;
      }
      const data = await res.json();
      const artists = (data.item?.artists || []).map((a) => a.name).join(", ");
      setSpotifyTrack(`${data.item?.name || "-"} — ${artists}`);
      setSpotifyPlaying(Boolean(data.is_playing));
    } catch {
      setSpotifyTrack("Spotify okunamadı");
    }
  };

  const spotifyToggle = async () => {
    try {
      await spotifyApi(spotifyPlaying ? "/me/player/pause" : "/me/player/play", "PUT");
      setTimeout(() => refreshSpotifyPlayback(), 400);
    } catch {
      Alert.alert("Spotify", "Oynatma kontrolü başarısız.");
    }
  };

  const spotifyNext = async () => {
    try {
      await spotifyApi("/me/player/next", "POST");
      setTimeout(() => refreshSpotifyPlayback(), 400);
    } catch {
      Alert.alert("Spotify", "Sonraki parça hatası.");
    }
  };

  const spotifyPrev = async () => {
    try {
      await spotifyApi("/me/player/previous", "POST");
      setTimeout(() => refreshSpotifyPlayback(), 400);
    } catch {
      Alert.alert("Spotify", "Önceki parça hatası.");
    }
  };

  const disconnectSpotify = () => {
    setSpotifyToken(null);
    setSpotifyTrack("-");
    setSpotifyPlaying(false);
    if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {screen === "onboarding" && (
          <>
            <Text style={styles.logo}>⚡ TAKT</Text>
            <Text style={styles.subtitle}>CALIBRATE YOUR PERFORMANCE</Text>
            <RingGauge valueText={bmi ? bmi.toFixed(1) : "--"} subtitle="STATUS" status={bmi ? bmiCategory(bmi) : "WAIT"} />

            <View style={styles.cardLarge}>
              <View style={styles.rowWrap}>
                <TextInput placeholder="FIRST NAME" placeholderTextColor="#7d95a9" style={[styles.input, styles.half]} value={form.firstName} onChangeText={(t) => setForm((f) => ({ ...f, firstName: t }))} />
                <TextInput placeholder="LAST NAME" placeholderTextColor="#7d95a9" style={[styles.input, styles.half]} value={form.lastName} onChangeText={(t) => setForm((f) => ({ ...f, lastName: t }))} />
              </View>
              <View style={styles.rowWrap}>
                <TextInput placeholder="HEIGHT (cm)" placeholderTextColor="#7d95a9" keyboardType="numeric" style={[styles.input, styles.half]} value={form.height} onChangeText={(t) => setForm((f) => ({ ...f, height: t }))} />
                <TextInput placeholder="WEIGHT (kg)" placeholderTextColor="#7d95a9" keyboardType="numeric" style={[styles.input, styles.half]} value={form.weight} onChangeText={(t) => setForm((f) => ({ ...f, weight: t }))} />
              </View>
              <TextInput placeholder="AGE" placeholderTextColor="#7d95a9" keyboardType="numeric" style={styles.input} value={form.age} onChangeText={(t) => setForm((f) => ({ ...f, age: t }))} />
              <Pressable style={styles.btnPrimary} onPress={onSaveProfile}><Text style={styles.btnTextStrong}>INITIALIZE SYSTEM →</Text></Pressable>
            </View>
          </>
        )}

        {screen === "home" && profile && (
          <>
            <View style={styles.topRow}>
              <Text style={styles.logo}>⚡ TAKT</Text>
              <View>
                <Text style={styles.intervalText}>MODE SELECTED</Text>
                <Text style={styles.intervalSub}>{mode.label.toUpperCase()} • {mode.coachTone}</Text>
              </View>
            </View>

            <RingGauge
              valueText={speedKmh.toFixed(1)}
              subtitle="CURRENT SPEED"
              status={`Target ${mode.workMin}-${mode.workMax} km/sa | GPS ${rawSpeedKmh.toFixed(1)} km/sa`}
            />

            <View style={styles.rowWrap}>
              {Object.entries(MODES).map(([key, m]) => (
                <Pressable key={key} style={[styles.modeCard, modeKey === key && styles.modeCardActive]} onPress={() => setModeKey(key)}>
                  <Text style={styles.modeCardTitle}>{m.label}</Text>
                  <Text style={styles.modeCardSub}>Work {formatTimer(m.workSec)} • Rest {formatTimer(m.restSec)}</Text>
                  <Text style={styles.modeCardSub}>{m.workMin}-{m.workMax} / {m.restMin}-{m.restMax} km/sa</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{bpm || "--"}</Text><Text style={styles.metricLabel}>BPM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{distanceKm.toFixed(2)}</Text><Text style={styles.metricLabel}>KM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{totalCalories.toFixed(0)}</Text><Text style={styles.metricLabel}>KCAL</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Toplam Süre (dk)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={totalDurationMin} onChangeText={setTotalDurationMin} placeholder="20" placeholderTextColor="#7d95a9" />
              <View style={styles.row}><Text style={styles.label}>Voice Coach</Text><Switch value={settings.voiceCoach} onValueChange={(v) => saveSettings({ ...settings, voiceCoach: v })} /></View>
              <View style={styles.row}><Text style={styles.label}>Speed Announce</Text><Switch value={settings.speedAnnounce} onValueChange={(v) => saveSettings({ ...settings, speedAnnounce: v })} /></View>
              <Text style={styles.coachLine}>Koç: {coachLine}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Spotify Client ID</Text>
              <TextInput placeholder="Spotify Client ID" placeholderTextColor="#7d95a9" style={styles.input} value={settings.spotifyClientId} onChangeText={(t) => saveSettings({ ...settings, spotifyClientId: t })} />
              <View style={styles.rowWrap}>
                <Pressable style={styles.btnGhost} onPress={connectSpotify}><Text style={styles.btnText}>CONNECT</Text></Pressable>
                <Pressable style={styles.btnGhost} onPress={disconnectSpotify}><Text style={styles.btnText}>DISCONNECT</Text></Pressable>
                <Pressable style={styles.btnGhost} onPress={spotifyPrev} disabled={!spotifyToken}><Text style={styles.btnText}>◀</Text></Pressable>
                <Pressable style={styles.btnGhost} onPress={spotifyToggle} disabled={!spotifyToken}><Text style={styles.btnText}>{spotifyPlaying ? "❚❚" : "▶"}</Text></Pressable>
                <Pressable style={styles.btnGhost} onPress={spotifyNext} disabled={!spotifyToken}><Text style={styles.btnText}>▶▶</Text></Pressable>
              </View>
              <Text style={styles.spotifyTrack}>{spotifyTrack}</Text>
            </View>

            <Pressable style={styles.btnPrimary} onPress={startWorkout}><Text style={styles.btnTextStrong}>START WORKOUT</Text></Pressable>
          </>
        )}

        {screen === "workout" && profile && (
          <>
            <View style={styles.topRow}>
              <Text style={styles.logo}>⚡ TAKT</Text>
              <View>
                <Text style={styles.intervalText}>INTERVAL {laps}</Text>
                <Text style={styles.intervalSub}>{mode.tag}</Text>
              </View>
            </View>

            <RingGauge valueText={speedKmh.toFixed(1)} subtitle={phase} status={`Target ≥ ${mode.workMin} km/sa | ${formatTimer(sessionLeft)}`} />

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{bpm || "--"}</Text><Text style={styles.metricLabel}>BPM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{distanceKm.toFixed(2)}</Text><Text style={styles.metricLabel}>KM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{totalCalories.toFixed(0)}</Text><Text style={styles.metricLabel}>KCAL</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Phase Left: {phaseLeft}s</Text>
              <Text style={styles.label}>Session Left: {formatTimer(sessionLeft)}</Text>
              <Text style={styles.label}>Calorie Rate: {calorieRate.toFixed(2)} kcal/min</Text>
              <Text style={styles.coachLine}>Koç: {coachLine}</Text>
            </View>

            <View style={styles.rowWrap}>
              <Pressable style={styles.btnGhostLarge} onPress={pauseWorkout} disabled={!running || paused}><Text style={styles.btnTextStrong}>PAUSE</Text></Pressable>
              <Pressable style={styles.btnGhostLarge} onPress={resumeWorkout} disabled={!running || !paused}><Text style={styles.btnTextStrong}>RESUME</Text></Pressable>
              <Pressable style={styles.btnPrimaryLarge} onPress={stopWorkout} disabled={!running}><Text style={styles.btnTextStrong}>FINISH</Text></Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#071925" },
  container: { padding: 18, gap: 14, backgroundColor: "#071925" },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { color: "#E8F6FF", fontSize: 34, fontWeight: "900", letterSpacing: 1.4 },
  subtitle: { color: "#86A8BE", fontSize: 20, textAlign: "center", marginBottom: 8, letterSpacing: 1.2 },
  intervalText: { color: "#25B7FF", fontWeight: "800", fontSize: 24, textAlign: "right" },
  intervalSub: { color: "#6F8EA6", fontWeight: "700", textAlign: "right" },

  ringWrap: {
    height: 370,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 8,
    backgroundColor: "rgba(28,71,98,0.22)",
    borderRadius: 22,
  },
  ringOuter: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 18,
    borderColor: "rgba(34,146,214,0.25)",
  },
  ringActive: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 18,
    borderTopColor: "#23B6FF",
    borderRightColor: "#23B6FF",
    borderBottomColor: "#23B6FF",
    borderLeftColor: "rgba(35,182,255,0.15)",
    transform: [{ rotate: "-28deg" }],
  },
  ringCenter: { alignItems: "center", justifyContent: "center" },
  ringSubtitle: { color: "#91AFC3", fontWeight: "800", fontSize: 24, letterSpacing: 1.2 },
  ringValue: { color: "#F4FAFF", fontWeight: "900", fontSize: 82 },
  ringStatus: {
    marginTop: 8,
    color: "#23B6FF",
    backgroundColor: "rgba(20,72,99,0.65)",
    borderColor: "rgba(35,182,255,0.35)",
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 6,
    fontWeight: "900",
  },

  cardLarge: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(90,138,167,0.25)",
    backgroundColor: "rgba(5,33,48,0.78)",
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(90,138,167,0.25)",
    backgroundColor: "rgba(5,33,48,0.78)",
    padding: 14,
    gap: 10,
  },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  half: { width: "48%" },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(122,171,198,0.28)",
    backgroundColor: "rgba(15,45,64,0.78)",
    color: "#EAF6FF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontWeight: "700",
  },
  label: { color: "#A2BDD0", fontWeight: "700" },
  coachLine: { color: "#23B6FF", fontWeight: "800" },
  spotifyTrack: { color: "#A2BDD0", fontSize: 13, marginTop: 4 },

  modeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(106,160,191,0.35)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(15,45,64,0.65)",
  },
  modeCardActive: {
    borderColor: "#23B6FF",
    backgroundColor: "rgba(35,182,255,0.18)",
  },
  modeCardTitle: { color: "#E9F7FF", fontWeight: "800" },
  modeCardSub: { color: "#82A6BD", fontWeight: "700", fontSize: 12 },

  metricsGrid: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  metricBox: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(90,138,167,0.25)",
    backgroundColor: "rgba(10,41,59,0.78)",
    paddingVertical: 18,
    alignItems: "center",
  },
  metricNum: { color: "#F4FAFF", fontSize: 44, fontWeight: "900" },
  metricLabel: { color: "#7C9CB2", fontWeight: "800", letterSpacing: 1.2 },

  btnPrimary: {
    backgroundColor: "#23B6FF",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  btnPrimaryLarge: {
    backgroundColor: "#23B6FF",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minWidth: 120,
    alignItems: "center",
  },
  btnGhost: {
    backgroundColor: "rgba(25,52,72,0.85)",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(90,138,167,0.35)",
  },
  btnGhostLarge: {
    backgroundColor: "rgba(15,37,52,0.92)",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minWidth: 120,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(90,138,167,0.35)",
  },
  btnText: { color: "#DBF3FF", fontWeight: "800" },
  btnTextStrong: { color: "#EFFFFF", fontWeight: "900", fontSize: 18, letterSpacing: 1.2 },
});
