# Home Assistant + Xiaomi Home

Bu klasör, Xiaomi cihazlarını Yuva'ya taşıyan yerel Home Assistant katmanını kurar. Home Assistant `127.0.0.1:8124` üzerinde çalışır; bilgisayardaki mevcut `8123` servisine dokunmaz.

## Başlatma

```bash
docker compose -f home-assistant/compose.yaml up -d
./home-assistant/install-xiaomi-home.sh
docker compose -f home-assistant/compose.yaml restart
```

Ardından `http://127.0.0.1:8124` adresini açıp yerel Home Assistant hesabını oluşturun.

## Xiaomi hesabını ekleme

1. Home Assistant'ta **Ayarlar → Cihazlar ve servisler → Entegrasyon ekle** yoluna gidin.
2. **Xiaomi Home** entegrasyonunu seçip Xiaomi hesabınızla giriş yapın; cihazların bulunduğu ülke/bölgeyi seçin.
3. Eklendikten sonra Home Assistant profilinizin en altındaki **Uzun Ömürlü Erişim Jetonları** bölümünden Yuva için bir token oluşturun.
4. Yuva'da **Ayarlar → Xiaomi / Home Assistant** kartını açın. Adres olarak `http://127.0.0.1:8124`, erişim anahtarı olarak oluşturduğunuz token'ı kullanın.

Token yalnız `bridge/.data/config.json` içindeki `0600` izinli yerel dosyada tutulur. Tarayıcı depolamasına veya Git'e yazılmaz. `home-assistant/config/` klasörü de Git tarafından yok sayılır.

## Kapsam

- Xiaomi Smart Air Purifier 4 Pro: güç, mod, fan yüzdesi, PM2.5/PM10 ve filtre bilgileri.
- Xiaomi Smart Dehumidifier: güç, mod, hedef/mevcut nem ve su haznesi durumu.
- Mi Smart LED Bulb White: güç ve parlaklık; cihaz destekliyorsa renk sıcaklığı.
- Xiaomi Smart Camera C701: entegrasyonun sunduğu durum, algılama olayları ve varsa gizlilik anahtarı.

Xiaomi'nin resmî Home Assistant entegrasyonu C701 için genel bir canlı kamera akışı yayımlamaz. Bu nedenle panel sahte bir görüntü göstermez; canlı video Xiaomi Home uygulamasında kalır.
