# TAKT Expo Mobil Kurulum

Bu repo artık **Expo/React Native** mobil başlangıç yapısına sahiptir.

## Neden `npm install` hatası aldınız?

Windows'taki hata:
- `ENOENT: no such file or directory, open ...\package.json`

Bu, bulunduğunuz klasörde `package.json` olmadığı anlamına gelir.
Bu commit ile `package.json` eklendi.

## Kurulum

1. Node 18+ kurun.
2. Proje klasöründe çalıştırın:
   - `npm install`
3. Expo başlatın:
   - `npm run start`
4. Android için:
   - Expo Go ile QR okutun **veya**
   - `eas build -p android --profile preview`

## Spotify Notu

Spotify kontrolü için kendi Spotify App'inden `Client ID` girmeniz gerekir.

## Önemli

Bu çalışma ortamında npm registry erişimi 403 verdiği için burada bağımlılıklar indirilemedi.
Kendi bilgisayarınızda normal internet/policy ile `npm install` başarılı olacaktır.
