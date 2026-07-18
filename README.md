# Yuva

Yuva; IKEA DIRIGERA ve Xiaomi Home cihazlarını tek bir Türkçe web arayüzünden yönetmek ve bunlar için görsel kurallar oluşturmak üzere hazırlanmış yerel öncelikli bir kontrol merkezidir.

## Neler var?

- Oda ve cihaz bazında ışık açma/kapatma, parlaklık ve renk sıcaklığı
- Hareket sensörü ve butonların pil/son olay bilgileri
- Hareket başlangıcı/bitimi, butonda tek/çift/uzun basış veya saat ile başlayan 5 adımlı kural oluşturucu
- Açılmadıkça kural verisine eklenmeyen gün, saat aralığı, cihaz durumu ve tekrar bekleme koşulları
- Tüm ışıkları, oda grubunu veya tek tek cihazları seçip her ışığa farklı aç/kapat, parlaklık, renk sıcaklığı, geçiş ve otomatik kapanma ayarı
- BILRESA çift butonun üst ve alt tuşlarını ayrı tetikleyici olarak seçebilme
- Canlı olay geçmişi ve cihaz bağlantı durumu
- Hub bulunmadığında tüm ekranları deneyebilmek için demo modu
- Web UI kapalıyken de kuralları çalıştıran ayrı yerel DIRIGERA köprüsü
- Home Assistant üzerinden Xiaomi hava temizleyici, nem alma cihazı, ampul ve kamera kontrolleri

## Hızlı demo

Node.js 22 veya daha yenisi gerekir.

```bash
npm install
npm run dev
```

Ardından `http://localhost:3000` adresini açın. Uygulama ilk açılışta güvenli demo modundadır; tüm kontroller ve kural oluşturucu örnek IKEA cihazlarıyla çalışır.

## Gerçek DIRIGERA bağlantısı

DIRIGERA yerel API'si tarayıcıdan güvenli ve kararlı biçimde kullanılamadığı için Yuva, hub ile aynı ağda çalışan küçük bir Node.js köprüsü kullanır:

```text
Web arayüzü → Yuva yerel köprüsü → DIRIGERA → IKEA cihazları
```

Köprüyü kurup başlatın:

```bash
npm install --prefix bridge
npm start --prefix bridge
```

İlk çalıştırmada terminalde bir **bağlantı anahtarı** gösterilir. Web arayüzünde **Ayarlar → Gerçek eve bağlan** ekranını açın, varsayılan `http://127.0.0.1:8787` adresini ve bu anahtarı girin. Köprü adresi cihazda hatırlanır; bağlantı anahtarı yalnızca açık tarayıcı oturumu boyunca `sessionStorage` içinde tutulur.

Hub daha önce eşleştirilmediyse **Köprüye bağlan** düğmesine bastıktan sonra DIRIGERA'nın altındaki işlem düğmesine 60 saniye içinde basın. mDNS keşfi çalışmazsa aynı ekranda hub'ın yerel IP adresini de yazabilirsiniz. DIRIGERA access token'ı tarayıcıya gönderilmez; yalnızca `bridge/.data/config.json` içinde yerel olarak saklanır.

Yuva yalnızca yerel kullanım için yapılandırılmıştır. Paneli köprüyle aynı makinede `http://localhost:3000` üzerinden açın. Başka bir ev cihazından erişim gerekiyorsa köprünün önüne ev ağınıza ait bir HTTPS reverse proxy koyun.

Köprünün API, ağ erişimi ve güvenlik ayarları için [bridge/README.md](bridge/README.md) dosyasına bakın.

## Xiaomi / Home Assistant bağlantısı

Xiaomi cihazları resmî **Xiaomi Home** Home Assistant entegrasyonu üzerinden bağlanır. Hazır Docker kurulumu `127.0.0.1:8124` adresini kullanır:

```bash
docker compose -f home-assistant/compose.yaml up -d
./home-assistant/install-xiaomi-home.sh
docker compose -f home-assistant/compose.yaml restart
```

İlk Home Assistant hesabını oluşturduktan sonra Xiaomi Home entegrasyonunda Xiaomi hesabınızla giriş yapın. Home Assistant profilinden oluşturacağınız uzun ömürlü erişim token'ını Yuva'daki **Ayarlar → Xiaomi / Home Assistant** ekranına girin. Ayrıntılı yönerge için [home-assistant/README.md](home-assistant/README.md) dosyasına bakın.

Yuva, Air Purifier 4 Pro, Smart Dehumidifier ve Mi Smart LED Bulb White için Home Assistant'ın sunduğu gerçek kontrolleri kullanır. Xiaomi Smart Camera C701 için durum/algılama olayları ve varsa gizlilik kontrolü gösterilir; resmî entegrasyon canlı video akışı sunmadığı için panelde sahte bir kamera görüntüsü oluşturulmaz.

## Kurallar nasıl çalışır?

Kural motoru köprü servisinde çalışır; DIRIGERA ve Home Assistant olaylarını izler. Bir kural en fazla 32 cihazı yönetebilir; gün/saat filtresi, cihaz durumu ve tekrar çalışma beklemesi birlikte kullanılabilir. Tek sensörlü giriş/çıkış modu ilk ayrı harekette ışığı açabilir, 10 saniyelik korumadan sonraki geçişte kapatabilir ve çıkış kaçırılırsa kalıcı 5 dakikalık hareketsizlik emniyetini uygulayabilir. Xiaomi ışık, hava temizleyici ve nem alma cihazı da kural hedefi olabilir. Kamera olayları (örneğin C701 bebek ağlaması) birden fazla ışığı eşzamanlı yanıp söndüren ve süre sonunda her ışığın başlangıç durumunu geri yükleyen uyarılar başlatabilir. Kurallar `bridge/.data/rules.json` içinde saklanır. Böylece web sayfasını kapatabilirsiniz; köprü servisi açık kaldığı sürece otomasyonlar devam eder.

Bir otomasyondaki cihazlardan biri çevrimdışıysa diğer hedeflerin komutları yine denenir ve sonuç geçmiş ekranında hata olarak görünür. Etkinleştirmediğiniz ileri seçenekler kaydedilen kural JSON'una hiç eklenmez; etkinleştirip zorunlu seçimi boş bıraktığınız seçeneklerde arayüz kayda izin vermez.

Köprünün sürekli çalışması için Raspberry Pi, NAS veya evde sürekli açık bir mini PC uygundur. Daha sonra basit kuralların doğrudan DIRIGERA sahnelerine çevrilmesi de eklenebilir; bu durumda köprü kapalıyken de ilgili hub-native kurallar çalışabilir.

## Doğrulama

```bash
npm run build
npx eslint app/home-control.tsx app/page.tsx app/layout.tsx
npm run check --prefix bridge
npm test --prefix bridge
```

## Güvenlik notları

- `bridge/.data/`, `home-assistant/config/`, `.env` dosyaları ve access token'lar kaynak kontrolüne eklenmez.
- Köprü varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler.
- Başka bir cihazdan erişim açmadan önce TLS reverse proxy, firewall ve dar bir CORS origin listesi kullanın.
- Kullanılan [`dirigera`](https://github.com/lpgera/dirigera) istemcisi tersine mühendisliğe dayalı gayriresmî bir kütüphanedir; DIRIGERA firmware güncellemeleri uyumluluğu etkileyebilir.
