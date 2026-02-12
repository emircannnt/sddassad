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

const STORAGE = {
  profile: "takt.profile",
  settings: "takt.settings",
};

const MODES = {
  toparlanma: { label: "Toparlanma", high: 15, low: 20 },
  yagYakimi: { label: "Yağ Yakımı", high: 20, low: 20 },
  kondisyon: { label: "Kondisyon", high: 20, low: 15 },
  hizEsigi: { label: "Hız Eşiği", high: 20, low: 15 },
  maksimumGuc: { label: "Maksimum Güç", high: 15, low: 20 },
};

const motivationPool = [
  "Çok iyi gidiyorsun!",
  "Hedefine az kaldı!",
  "Ritmini koru!",
  "Harika tempo!",
];

function bmiCategory(bmi) {
  if (bmi < 18.5) return "Düşük";
  if (bmi < 24.9) return "Fit / Normal";
  if (bmi < 29.9) return "Fazla";
  return "Yüksek";
}

const kcalPerMin = (speedKmh, kg) => {
  const met = speedKmh < 5 ? 3 : speedKmh < 8 ? 6 : speedKmh < 11 ? 9 : 12;
  return (met * 3.5 * kg) / 200;
};

export default function App() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", height: "", weight: "" });
  const [settings, setSettings] = useState({ voiceCoach: true, speedAnnounce: true, spotifyClientId: "" });

  const [speedKmh, setSpeedKmh] = useState(0);
  const [caloriePerMin, setCaloriePerMin] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);

  const [modeKey, setModeKey] = useState("yagYakimi");
  const [durationMin, setDurationMin] = useState("20");
  const [endless, setEndless] = useState(false);
  const [phase, setPhase] = useState("Hazır");
  const [phaseLeft, setPhaseLeft] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyTrack, setSpotifyTrack] = useState("-");
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);

  const watchRef = useRef(null);
  const tickerRef = useRef(null);
  const phaseTimeoutRef = useRef(null);
  const motivationRef = useRef(null);
  const spotifyPollRef = useRef(null);
  const phaseRef = useRef("high");

  const bmi = useMemo(() => {
    const h = Number(profile?.height || form.height);
    const w = Number(profile?.weight || form.weight);
    if (!h || !w) return 0;
    return w / ((h / 100) ** 2);
  }, [profile, form.height, form.weight]);

  useEffect(() => {
    (async () => {
      const rawProfile = await AsyncStorage.getItem(STORAGE.profile);
      const rawSettings = await AsyncStorage.getItem(STORAGE.settings);
      if (rawProfile) setProfile(JSON.parse(rawProfile));
      if (rawSettings) setSettings((prev) => ({ ...prev, ...JSON.parse(rawSettings) }));
    })();
  }, []);

  useEffect(() => {
    return () => {
      stopWorkoutInternal();
      if (watchRef.current) watchRef.current.remove();
      if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
    };
  }, []);

  const speak = (text) => {
    if (!settings.voiceCoach) return;
    Speech.speak(text, { language: "tr-TR", pitch: 1.08, rate: 1.0 });
  };

  const startLocation = async (weight) => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Konum izni gerekli", "Hız ve mesafe takibi için konum izni verin.");
      return;
    }

    if (watchRef.current) watchRef.current.remove();
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1200, distanceInterval: 1 },
      (loc) => {
        const kmh = (loc.coords.speed || 0) * 3.6;
        setSpeedKmh(kmh);
        setCaloriePerMin(kcalPerMin(kmh, weight));
      },
    );
  };

  const saveProfile = async () => {
    const next = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      height: Number(form.height),
      weight: Number(form.weight),
    };
    if (!next.firstName || !next.lastName || !next.height || !next.weight) {
      Alert.alert("Eksik bilgi", "Lütfen tüm alanları doldurun.");
      return;
    }
    setProfile(next);
    await AsyncStorage.setItem(STORAGE.profile, JSON.stringify(next));
    startLocation(next.weight);
  };

  const runPhase = (newPhase) => {
    const mode = MODES[modeKey];
    const sec = newPhase === "high" ? mode.high : mode.low;
    phaseRef.current = newPhase;
    setPhase(`${newPhase === "high" ? "Hızlan" : "Yavaşla"} (${sec} sn)`);
    setPhaseLeft(sec);
    speak(newPhase === "high" ? "Hızlan" : "Yavaşla");

    if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
    phaseTimeoutRef.current = setTimeout(() => {
      if (!running || paused) return;
      runPhase(newPhase === "high" ? "low" : "high");
    }, sec * 1000);
  };

  const stopWorkoutInternal = () => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
    if (motivationRef.current) clearInterval(motivationRef.current);
    tickerRef.current = null;
    phaseTimeoutRef.current = null;
    motivationRef.current = null;
  };

  const startWorkout = () => {
    if (!profile) return Alert.alert("Profil gerekli", "Önce profil oluşturun.");
    setDistanceKm(0);
    setRunning(true);
    setPaused(false);
    setRemaining(Number(durationMin) * 60);

    runPhase("high");
    tickerRef.current = setInterval(() => {
      setPhaseLeft((v) => Math.max(v - 1, 0));
      if (!endless) {
        setRemaining((v) => {
          if (v <= 1) {
            stopWorkout();
            return 0;
          }
          return v - 1;
        });
      }
      setDistanceKm((d) => d + speedKmh / 3600);
    }, 1000);

    motivationRef.current = setInterval(() => {
      const msg = motivationPool[Math.floor(Math.random() * motivationPool.length)];
      speak(msg);
      if (settings.speedAnnounce) speak(`Anlık hız ${speedKmh.toFixed(1)} kilometre saat`);
    }, 20000);
  };

  const pauseWorkout = () => {
    setPaused(true);
    stopWorkoutInternal();
    setPhase("Duraklatıldı");
  };

  const resumeWorkout = () => {
    if (!running) return;
    setPaused(false);
    runPhase(phaseRef.current);
    tickerRef.current = setInterval(() => {
      setPhaseLeft((v) => Math.max(v - 1, 0));
      if (!endless) {
        setRemaining((v) => {
          if (v <= 1) {
            stopWorkout();
            return 0;
          }
          return v - 1;
        });
      }
      setDistanceKm((d) => d + speedKmh / 3600);
    }, 1000);
  };

  const stopWorkout = () => {
    setRunning(false);
    setPaused(false);
    setPhase("Tamamlandı");
    stopWorkoutInternal();
  };

  const saveSettings = async (next) => {
    setSettings(next);
    await AsyncStorage.setItem(STORAGE.settings, JSON.stringify(next));
  };

  const connectSpotify = async () => {
    if (!settings.spotifyClientId?.trim()) {
      Alert.alert("Spotify Client ID", "Önce Spotify Client ID girin.");
      return;
    }

    const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
    const authUrl =
      `https://accounts.spotify.com/authorize?client_id=${settings.spotifyClientId.trim()}` +
      `&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent("user-read-playback-state user-modify-playback-state user-read-currently-playing")}`;

    const result = await AuthSession.startAsync({ authUrl });
    if (result.type === "success" && result.params?.access_token) {
      setSpotifyToken(result.params.access_token);
      Alert.alert("Spotify", "Bağlantı başarılı.");
      refreshSpotifyPlayback(result.params.access_token);
      if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
      spotifyPollRef.current = setInterval(() => refreshSpotifyPlayback(result.params.access_token), 5000);
    }
  };

  const spotifyApi = async (path, method = "GET") => {
    if (!spotifyToken) throw new Error("no token");
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error("spotify error");
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
      setSpotifyTrack(`${data.item?.name || "-"} — ${(data.item?.artists || []).map((a) => a.name).join(", ")}`);
      setSpotifyPlaying(!!data.is_playing);
    } catch {
      setSpotifyTrack("Spotify okunamadı");
    }
  };

  const spotifyToggle = async () => {
    try {
      await spotifyApi(spotifyPlaying ? "/me/player/pause" : "/me/player/play", "PUT");
      setTimeout(refreshSpotifyPlayback, 400);
    } catch {
      Alert.alert("Spotify", "Oynatma kontrolü başarısız. Aktif cihaz seçili olmalı.");
    }
  };

  const spotifyNext = async () => {
    try {
      await spotifyApi("/me/player/next", "POST");
      setTimeout(refreshSpotifyPlayback, 400);
    } catch {
      Alert.alert("Spotify", "Sonraki parça başarısız.");
    }
  };

  const spotifyPrev = async () => {
    try {
      await spotifyApi("/me/player/previous", "POST");
      setTimeout(refreshSpotifyPlayback, 400);
    } catch {
      Alert.alert("Spotify", "Önceki parça başarısız.");
    }
  };

  const disconnectSpotify = () => {
    setSpotifyToken(null);
    setSpotifyTrack("-");
    setSpotifyPlaying(false);
    if (spotifyPollRef.current) clearInterval(spotifyPollRef.current);
  };

  const currentMode = MODES[modeKey];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>TAKT Mobile (Expo)</Text>

        {!profile && (
          <View style={styles.card}>
            <Text style={styles.h2}>Onboarding</Text>
            {[
              ["firstName", "İsim"],
              ["lastName", "Soyisim"],
              ["height", "Boy (cm)"],
              ["weight", "Kilo (kg)"],
            ].map(([key, ph]) => (
              <TextInput
                key={key}
                placeholder={ph}
                placeholderTextColor="#8d8d8d"
                value={form[key]}
                onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))}
                keyboardType={key === "height" || key === "weight" ? "numeric" : "default"}
                style={styles.input}
              />
            ))}
            <Text style={styles.meta}>Anlık VKİ: {bmi ? `${bmi.toFixed(1)} (${bmiCategory(bmi)})` : "-"}</Text>
            <Pressable style={styles.btn} onPress={saveProfile}><Text style={styles.btnText}>Profili Kaydet</Text></Pressable>
          </View>
        )}

        {profile && (
          <>
            <View style={styles.card}>
              <Text style={styles.h2}>Hoş geldin {profile.firstName}</Text>
              <Text style={styles.meta}>VKİ: {bmi.toFixed(1)} ({bmiCategory(bmi)})</Text>
              <Text style={styles.metric}>Hız: {speedKmh.toFixed(1)} km/sa</Text>
              <Text style={styles.meta}>Kalori: {caloriePerMin.toFixed(2)} kcal/dk</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.h2}>Ayarlar</Text>
              <View style={styles.row}><Text style={styles.meta}>Sesli koç</Text><Switch value={settings.voiceCoach} onValueChange={(v) => saveSettings({ ...settings, voiceCoach: v })} /></View>
              <View style={styles.row}><Text style={styles.meta}>Hız anonsu (20 sn)</Text><Switch value={settings.speedAnnounce} onValueChange={(v) => saveSettings({ ...settings, speedAnnounce: v })} /></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.h2}>Spotify</Text>
              <TextInput
                placeholder="Spotify Client ID"
                placeholderTextColor="#8d8d8d"
                value={settings.spotifyClientId}
                onChangeText={(t) => saveSettings({ ...settings, spotifyClientId: t })}
                style={styles.input}
              />
              <View style={styles.rowWrap}>
                <Pressable style={styles.btnSecondary} onPress={connectSpotify}><Text style={styles.btnText}>Bağlan</Text></Pressable>
                <Pressable style={styles.btnSecondary} onPress={disconnectSpotify}><Text style={styles.btnText}>Kes</Text></Pressable>
              </View>
              <Text style={styles.meta}>Çalan: {spotifyTrack}</Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.btnSecondary} onPress={spotifyPrev} disabled={!spotifyToken}><Text style={styles.btnText}>Önceki</Text></Pressable>
                <Pressable style={styles.btnSecondary} onPress={spotifyToggle} disabled={!spotifyToken}><Text style={styles.btnText}>{spotifyPlaying ? "Duraklat" : "Oynat"}</Text></Pressable>
                <Pressable style={styles.btnSecondary} onPress={spotifyNext} disabled={!spotifyToken}><Text style={styles.btnText}>Sonraki</Text></Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.h2}>Interval</Text>
              <View style={styles.rowWrap}>
                {Object.entries(MODES).map(([k, m]) => (
                  <Pressable key={k} style={[styles.mode, modeKey === k && styles.modeActive]} onPress={() => setModeKey(k)}>
                    <Text style={styles.modeText}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={durationMin} onChangeText={setDurationMin} keyboardType="numeric" style={styles.input} placeholder="Süre dakika" placeholderTextColor="#8d8d8d" />
              <View style={styles.row}><Text style={styles.meta}>Süresiz</Text><Switch value={endless} onValueChange={setEndless} /></View>
              <Text style={styles.meta}>Mod: {currentMode.label} ({currentMode.high}/{currentMode.low} sn)</Text>
              <Text style={styles.metric}>{phase}</Text>
              <Text style={styles.meta}>Faz kalan: {phaseLeft} sn</Text>
              <Text style={styles.meta}>Toplam kalan: {endless ? "∞" : `${remaining} sn`}</Text>
              <Text style={styles.meta}>Mesafe: {distanceKm.toFixed(2)} km</Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.btn} onPress={startWorkout} disabled={running}><Text style={styles.btnText}>Başlat</Text></Pressable>
                <Pressable style={styles.btnSecondary} onPress={pauseWorkout} disabled={!running || paused}><Text style={styles.btnText}>Duraklat</Text></Pressable>
                <Pressable style={styles.btnSecondary} onPress={resumeWorkout} disabled={!running || !paused}><Text style={styles.btnText}>Devam</Text></Pressable>
                <Pressable style={styles.btnDanger} onPress={stopWorkout} disabled={!running}><Text style={styles.btnText}>Bitir</Text></Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#1a1a1b" },
  container: { padding: 16, gap: 12 },
  title: { color: "#fff", fontSize: 28, fontWeight: "900" },
  card: { backgroundColor: "#24262b", borderRadius: 14, padding: 14, gap: 8 },
  h2: { color: "#d8fbff", fontSize: 18, fontWeight: "800" },
  input: { backgroundColor: "#121317", color: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#333" },
  meta: { color: "#b9b9b9" },
  metric: { color: "#72ff7d", fontSize: 24, fontWeight: "900" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { backgroundColor: "#2ba8ff", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnSecondary: { backgroundColor: "#3a3b40", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnDanger: { backgroundColor: "#ff5f6d", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnText: { color: "#fff", fontWeight: "800" },
  mode: { backgroundColor: "#30323a", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  modeActive: { backgroundColor: "#2ba8ff" },
  modeText: { color: "#fff", fontSize: 12 },
});
