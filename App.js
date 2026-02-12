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
  toparlanma: { label: "Toparlanma", high: 15, low: 20, tag: "RECOVERY" },
  yagYakimi: { label: "Yağ Yakımı", high: 20, low: 20, tag: "FAT BURN" },
  kondisyon: { label: "Kondisyon", high: 20, low: 15, tag: "CARDIO" },
  hizEsigi: { label: "Hız Eşiği", high: 20, low: 15, tag: "THRESHOLD" },
  maksimumGuc: { label: "Maksimum Güç", high: 15, low: 20, tag: "MAX POWER" },
};

const motivationPool = ["Çok iyi gidiyorsun!", "Ritmi koru!", "Harikasın, devam!", "Hedefe yaklaştın!"];

const bpmFromSpeed = (speed) => Math.round(Math.min(185, Math.max(95, 95 + speed * 4.2)));
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

function RingGauge({ valueText, subtitle, status, accent = "#23B6FF" }) {
  return (
    <View style={styles.ringWrap}>
      <View style={[styles.ringOuter, { borderColor: "rgba(34,146,214,0.25)" }]} />
      <View style={[styles.ringActive, { borderColor: accent }]} />
      <View style={styles.ringCenter}>
        <Text style={styles.ringSubtitle}>{subtitle}</Text>
        <Text style={styles.ringValue}>{valueText}</Text>
        {status ? <Text style={styles.ringStatus}>{status}</Text> : null}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState("onboarding"); // onboarding | home | workout
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", height: "", weight: "", age: "28" });
  const [settings, setSettings] = useState({ voiceCoach: true, speedAnnounce: true, spotifyClientId: "" });

  const [modeKey, setModeKey] = useState("yagYakimi");
  const [totalDurationMin, setTotalDurationMin] = useState("20");

  const [speedKmh, setSpeedKmh] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [caloriePerMin, setCaloriePerMin] = useState(0);
  const [totalCalories, setTotalCalories] = useState(0);
  const [bpm, setBpm] = useState(0);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState("Hazır");
  const [phaseLeft, setPhaseLeft] = useState(0);
  const [sessionLeft, setSessionLeft] = useState(0);
  const [laps, setLaps] = useState(1);

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyTrack, setSpotifyTrack] = useState("-");
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);

  const watchRef = useRef(null);
  const tickerRef = useRef(null);
  const phaseTimeoutRef = useRef(null);
  const motivationRef = useRef(null);
  const spotifyPollRef = useRef(null);
  const phaseRef = useRef("high");

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

  const bmi = useMemo(() => {
    const h = Number(profile?.height || form.height);
    const w = Number(profile?.weight || form.weight);
    if (!h || !w) return 0;
    return w / ((h / 100) ** 2);
  }, [profile, form.height, form.weight]);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([AsyncStorage.getItem(STORAGE.profile), AsyncStorage.getItem(STORAGE.settings)]);
      if (s) setSettings((prev) => ({ ...prev, ...JSON.parse(s) }));
      if (p) {
        const parsed = JSON.parse(p);
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

  const speak = (text) => {
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
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
      (loc) => {
        const kmh = (loc.coords.speed || 0) * 3.6;
        setSpeedKmh(kmh);
        setBpm(bpmFromSpeed(kmh));
        setCaloriePerMin(caloriesFromSpeed(kmh, weight));
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

  const runPhase = (newPhase) => {
    const m = MODES[modeKey];
    const sec = newPhase === "high" ? m.high : m.low;
    phaseRef.current = newPhase;
    setPhase(`${newPhase === "high" ? "HIZLAN" : "YAVAŞLA"}`);
    setPhaseLeft(sec);
    speak(newPhase === "high" ? "Hızlan" : "Yavaşla");

    if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
    phaseTimeoutRef.current = setTimeout(() => {
      if (!running || paused) return;
      if (newPhase === "low") setLaps((v) => v + 1);
      runPhase(newPhase === "high" ? "low" : "high");
    }, sec * 1000);
  };

  const startWorkout = () => {
    if (!profile) return;
    stopWorkoutInternal();
    setScreen("workout");
    setRunning(true);
    setPaused(false);
    setDistanceKm(0);
    setTotalCalories(0);
    setLaps(1);

    const totalSec = Math.max(60, Number(totalDurationMin || 20) * 60);
    setSessionLeft(totalSec);
    runPhase("high");

    tickerRef.current = setInterval(() => {
      setPhaseLeft((v) => Math.max(0, v - 1));
      setSessionLeft((v) => {
        if (v <= 1) {
          stopWorkout();
          return 0;
        }
        return v - 1;
      });
      setDistanceKm((d) => d + speedKmh / 3600);
      setTotalCalories((c) => c + caloriePerMin / 60);
    }, 1000);

    motivationRef.current = setInterval(() => {
      const msg = motivationPool[Math.floor(Math.random() * motivationPool.length)];
      speak(msg);
      if (settings.speedAnnounce) speak(`Hız ${speedKmh.toFixed(1)} kilometre saat`);
    }, 20000);
  };

  const pauseWorkout = () => {
    if (!running) return;
    setPaused(true);
    setPhase("DURAKLATILDI");
    stopWorkoutInternal();
  };

  const resumeWorkout = () => {
    if (!running) return;
    setPaused(false);
    runPhase(phaseRef.current);
    tickerRef.current = setInterval(() => {
      setPhaseLeft((v) => Math.max(0, v - 1));
      setSessionLeft((v) => {
        if (v <= 1) {
          stopWorkout();
          return 0;
        }
        return v - 1;
      });
      setDistanceKm((d) => d + speedKmh / 3600);
      setTotalCalories((c) => c + caloriePerMin / 60);
    }, 1000);
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

  const mode = MODES[modeKey];

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

              <Pressable style={styles.btnPrimary} onPress={onSaveProfile}>
                <Text style={styles.btnTextStrong}>INITIALIZE SYSTEM →</Text>
              </Pressable>
            </View>
          </>
        )}

        {screen === "home" && profile && (
          <>
            <View style={styles.topRow}>
              <Text style={styles.logo}>⚡ TAKT</Text>
              <View>
                <Text style={styles.intervalText}>MODE SELECTED</Text>
                <Text style={styles.intervalSub}>{mode.label.toUpperCase()} • OUTDOOR</Text>
              </View>
            </View>

            <RingGauge
              valueText={speedKmh.toFixed(1)}
              subtitle="CURRENT SPEED"
              status={`BMI ${bmi.toFixed(1)} / ${bmiCategory(bmi)}`}
            />

            <View style={styles.rowWrap}>
              {Object.entries(MODES).map(([key, m]) => (
                <Pressable key={key} style={[styles.modeCard, modeKey === key && styles.modeCardActive]} onPress={() => setModeKey(key)}>
                  <Text style={styles.modeCardTitle}>{m.label}</Text>
                  <Text style={styles.modeCardSub}>{m.high}/{m.low} sn</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.card}> 
              <Text style={styles.label}>Toplam Süre (dk)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={totalDurationMin} onChangeText={setTotalDurationMin} placeholder="20" placeholderTextColor="#7d95a9" />
              <View style={styles.row}><Text style={styles.label}>Voice Coach</Text><Switch value={settings.voiceCoach} onValueChange={(v) => saveSettings({ ...settings, voiceCoach: v })} /></View>
              <View style={styles.row}><Text style={styles.label}>Speed Announce</Text><Switch value={settings.speedAnnounce} onValueChange={(v) => saveSettings({ ...settings, speedAnnounce: v })} /></View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{bpm || "--"}</Text><Text style={styles.metricLabel}>BPM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{distanceKm.toFixed(2)}</Text><Text style={styles.metricLabel}>KM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{totalCalories.toFixed(0)}</Text><Text style={styles.metricLabel}>KCAL</Text></View>
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

            <Pressable style={styles.btnPrimary} onPress={startWorkout}>
              <Text style={styles.btnTextStrong}>START WORKOUT</Text>
            </Pressable>
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

            <RingGauge valueText={speedKmh.toFixed(1)} subtitle={phase} status={formatTimer(sessionLeft)} />

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{bpm || "--"}</Text><Text style={styles.metricLabel}>BPM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{distanceKm.toFixed(2)}</Text><Text style={styles.metricLabel}>KM</Text></View>
              <View style={styles.metricBox}><Text style={styles.metricNum}>{totalCalories.toFixed(0)}</Text><Text style={styles.metricLabel}>KCAL</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Phase Left: {phaseLeft}s</Text>
              <Text style={styles.label}>Session Left: {formatTimer(sessionLeft)}</Text>
              <Text style={styles.label}>Calorie Rate: {caloriePerMin.toFixed(2)} kcal/min</Text>
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
  container: {
    padding: 18,
    gap: 14,
    backgroundColor: "#071925",
  },
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
