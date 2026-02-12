# TAKT Expo Mobil Kurulum

Bu repo artık **Expo/React Native** mobil başlangıç yapısına sahiptir.

## 1) Neden `npm install` ENOENT hatası aldınız?

Windows hatası:
- `ENOENT: no such file or directory, open ...\\package.json`

Bu, bulunduğunuz klasörde `package.json` olmadığı anlamına gelir.
Bu proje için `package.json` artık eklidir.

## 2) Neden `:app:createBundleReleaseJsAndAssets` hatası olur?

Bu Gradle adımı React Native JS bundle üretirken patlar. En sık nedenler:
- JS tarafında runtime/syntax hatası
- Node sürüm uyumsuzluğu (öneri: Node 18 LTS veya 20 LTS)
- Yanlış/eksik Expo auth yapılandırması
- Cache bozulması

Bu sürümde Spotify auth akışı `expo-auth-session` + `expo-web-browser` uyumlu şekilde güncellendi ve `scheme` tanımlandı.

## 3) Temiz kurulum adımları (Windows)

```bash
# proje kökünde
npm cache clean --force
rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
npm install
npx expo doctor
npm run start
```

## 4) APK alma (EAS)

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview
```

## 5) Hâlâ Gradle bundle hatası varsa

Aşağıdaki komutla detaylı log alın:

```bash
cd android
gradlew app:bundleRelease --stacktrace --info
```

ve özellikle `createBundleReleaseJsAndAssets` bölümündeki ilk JS hata satırını kontrol edin.

## 6) Spotify Notu

Spotify kontrolü için Spotify Developer panelinden bir app açıp `Client ID` girmeniz gerekir.

