# TAKT Ürün Geliştirme Planı (Pazar Karşılaştırmalı)

Bu doküman, mevcut TAKT prototipinin **ürünleşme** sürecini pazar liderleriyle karşılaştırarak net bir yol haritasına dönüştürür.

## 1) Mevcut Durum Özeti (Bugünkü Güçlü / Zayıf)

### Güçlü taraflar
- 15–20 sn ritim odaklı interval motoru var.
- Türkçe sesli komut (`Hızlan / Yavaşla`) ve motivasyon akışı var.
- GPS hız takibi, yaklaşık kalori hesabı ve antrenman özeti var.
- PWA olarak çalışıyor; temel offline yaklaşımı mevcut.

### Zayıf taraflar
- Adım/nabız verisi web API sınırlamaları nedeniyle her cihazda stabil değil.
- “Gerçek” sağlık ekosistemi entegrasyonu (HealthKit/Google Fit) yok.
- Programlama/koçluk tarafı henüz kişiselleştirilmiş değil.
- Analitik, hedef takibi ve davranışsal bağlılık (retention loop) zayıf.

---

## 2) Pazar Kıyaslaması (Kısa Benchmark)

Aşağıdaki uygulamaların güçlü yönleri TAKT için referans alınmalı:

1. **Nike Run Club (NRC)**
   - Güçlü yön: Koç sesleri, planlı programlar, yeni başlayan dostu onboarding.
   - TAKT fırsatı: NRC kadar akıcı “guided workout” + Türkçe yerel koç deneyimi.

2. **Adidas Running / Strava**
   - Güçlü yön: Sosyal motivasyon, segment/rekabet, güçlü rapor ekranları.
   - TAKT fırsatı: Ritim odaklı farklılaşmayı sosyal “tempo challenge” ile birleştirmek.

3. **Freeletics / HIIT odaklı uygulamalar**
   - Güçlü yön: Adaptif plan, performansa göre otomatik seviyeleme.
   - TAKT fırsatı: Interval sürelerini kullanıcının toparlanma ve nabız verisine göre otomatik ayarlama.

4. **Garmin / Polar / WHOOP ekosistemi**
   - Güçlü yön: Sensör doğruluğu, recovery/readiness skoru, derin biyometrik analiz.
   - TAKT fırsatı: BLE + HealthKit + Fit entegrasyonu sonrası “Readiness skoru” üretmek.

**Sonuç:** TAKT’nin farklılaşma alanı “Türkçe sesli, ritim odaklı, kısa fazlı profesyonel interval koçu”.

---

## 3) Sensör Entegrasyonu: Gerçekçi Mimari Önerisi

Web tarafı prototip için iyi; ama üretim için hibrit/native katman şart.

### Önerilen teknik yığın
- **Mobil uygulama:** React Native + Expo (veya Flutter / native Swift+Kotlin)
- **Sensör köprüsü:**
  - iOS: HealthKit, CoreMotion, CoreBluetooth
  - Android: Health Connect, SensorManager, Bluetooth LE
- **Cloud:** Firebase/Supabase + event pipeline

### Sensör öncelik sırası
1. **GPS hız/mesafe** (zaten var, iyileştirilecek)
2. **Nabız (BLE HRM bandı + watch kaynakları)**
3. **Adım / cadence (hareket + health store doğrulaması)**
4. **Opsiyonel:** VO2max tahmini, HRV, recovery metrikleri

### Veri kalitesi kuralları
- Sensör fusion (GPS + cadence + HR) ile outlier filtreleme
- Kayıp sinyalde graceful fallback (ör: hız düşerse faz uyarı tonu)
- Cihaz bazlı kalibrasyon profili

---

## 4) Ürün Yol Haritası (90 Gün)

## Faz 1 (0–30 gün): Altyapı + Güvenilir Sensör
**Hedef:** “Çalışıyor” seviyesinden “güvenilir” seviyeye çıkmak.

- Mobil app shell (native/hybrid) kurulumu
- İzin orkestrasyonu (ilk açılışta adım adım izin sihirbazı)
- GPS ve BLE nabızın stabil bağlanması
- Arka planda antrenman devamı + ekran uyku kilidi yönetimi
- Basit hata izleme (Sentry/Crashlytics)

**Başarı metrikleri**
- Antrenman sırasında sensör kopma oranı < %3
- İzin tamamlama oranı > %70

## Faz 2 (31–60 gün): Koçluk Motoru + Kişiselleştirme
**Hedef:** Kullanıcının seviyesine adapte olan tempo koçu.

- Adaptif interval: nabız zonuna göre high/low süre modülasyonu
- Hız seslendirme ve koç tonunun kişiselleştirilmesi
- Haftalık plan oluşturucu (yağ yakımı / kondisyon / güç)
- RPE (algılanan efor) ve toparlanma anketi

**Başarı metrikleri**
- 4 hafta retention +%15
- Tamamlanan antrenman oranı +%20

## Faz 3 (61–90 gün): Raporlama + Büyüme Loop’ları
**Hedef:** Alışkanlık ve paylaşılabilir ilerleme.

- Gelişmiş rapor: zone distribution, tempo stabilitesi, HR trend
- Hedef sistemi (haftalık km, zone dakika, kalori)
- Challenge ve arkadaş daveti
- Koç paneli / premium planlama başlangıcı

**Başarı metrikleri**
- WAU/MAU > %40
- Haftalık ortalama antrenman sayısı +%25

---

## 5) Detaylı Özellik Backlog’u (Önceliklendirilmiş)

## P0 – Kritik
- Native permission wizard
- BLE HRM stable reconnect
- Background workout session
- Battery-aware sampling policy
- Offline first workout queue + sync

## P1 – Yüksek değer
- Adaptive pacing engine (HR zone feedback)
- AI tabanlı “bugün hangi mod?” önerisi
- Program kütüphanesi (8-12 haftalık planlar)
- Auto pause / resume iyileştirmesi

## P2 – Büyüme
- Sosyal challenge
- Koç ses paketleri
- Spotify/Apple Music gerçek ducking entegrasyonu
- Cihaz ekosistemi partnerlikleri

---

## 6) Analitik Planı (Ne Ölçülecek?)

### Funnel
- `onboarding_started`
- `onboarding_completed`
- `permissions_completed`
- `workout_started`
- `workout_completed`

### Kalite
- `gps_signal_lost`
- `ble_hr_disconnect`
- `voice_prompt_failed`
- `workout_background_interrupted`

### Koçluk
- Faz bazlı pace uyum skoru
- Zone hedef tutturma yüzdesi
- Kullanıcı başına haftalık aktif antrenman dakikası

---

## 7) Riskler ve Önlemler

1. **Web API limitleri**
   - Önlem: Prototip webde; üretim native bridge.
2. **Pil tüketimi**
   - Önlem: adaptif örnekleme + düşük güç modu.
3. **BLE uyumluluk karmaşası**
   - Önlem: marka/model whitelist + reconnect state machine.
4. **İzin reddi**
   - Önlem: izin değerini anlatan eğitim ekranı + kısmi mod fallback.

---

## 8) Hızlı Kazanımlar (1-2 hafta içinde yapılabilir)

- İzin ekranını adım adım wizard yapmak
- Nabız sensörü bağlantı durumunu daha görünür yapmak
- “Anlık hız + nabız” ikili sesli geri bildirim
- Antrenman bitişinde kişisel öneri kartı (yarın hangi mod?)
- Hata durumlarında kullanıcıya sade çözüm önerileri

---

## 9) TAKT için Konumlandırma Cümlesi

> “TAKT, kısa fazlı (15–20 sn) ritim temelli interval koçluğu ile Türkçe sesli yönlendirme sunan, sensör destekli profesyonel tempo asistanıdır.”

