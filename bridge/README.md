# DIRIGERA + Home Assistant yerel köprüsü

Bu servis IKEA DIRIGERA hub'ını ve Xiaomi cihazlarını sunan yerel Home Assistant örneğini tek bir HTTP API'de birleştirir. Web UI kapalı olsa bile servis çalıştığı sürece kurallar çalışmaya devam eder.

Servis [`dirigera`](https://github.com/lpgera/dirigera) istemcisinin sabitlenmiş `2.0.0` sürümünü kullanır. DIRIGERA'nın yerel API'si resmi ve kararlı bir genel API değildir; hub firmware güncellemeleri uyumluluğu etkileyebilir.

## Kurulum

Node.js `22.13.0` veya daha yenisi gerekir.

```bash
npm install --prefix bridge
cp bridge/.env.example bridge/.env
npm start --prefix bridge
```

Varsayılan adres `http://127.0.0.1:8787`'dir. İlk çalıştırmada kriptografik olarak rastgele bir bridge key üretilir ve terminalde **yalnızca bir kez** gösterilir. Anahtar ile DIRIGERA/Home Assistant access token'ları `bridge/.data/config.json` içinde, dosya modu `0600` olacak şekilde saklanır. Bu dosyayı paylaşmayın veya kaynak kontrolüne eklemeyin.

Anahtarı kaybederseniz yalnızca yerel makinede şu dosyadan okuyabilirsiniz:

```bash
node -e "const c=require('./bridge/.data/config.json'); console.log(c.bridgeKey)"
```

## Hub ile eşleştirme

İlk terminalde bridge çalışırken ikinci terminalde aşağıdaki isteği başlatın, ardından DIRIGERA'nın altındaki action düğmesine 60 saniye içinde basın:

```bash
curl -X POST http://127.0.0.1:8787/api/pair \
  -H 'Content-Type: application/json' \
  -H 'X-Bridge-Key: YOUR_BRIDGE_KEY' \
  -d '{"gatewayIP":"192.168.1.50"}'
```

`gatewayIP` isteğe bağlıdır; verilmezse mDNS ile keşif denenir ve bulunan adres sonraki açılışlar için kaydedilir. IPv4 adresi özel/yerel bir aralıkta olmalıdır. IPv6 kullanan ev ağlarında DIRIGERA global-unicast bir yerel arayüz adresi ilan edebildiğinden unicast IPv6 adresleri de kabul edilir; multicast ve belirsiz adresler reddedilir. Access token hiçbir API cevabında dönmez ve loglanmaz.

Bağlantı durumu:

```bash
curl http://127.0.0.1:8787/api/status \
  -H 'X-Bridge-Key: YOUR_BRIDGE_KEY'
```

## HTTP API

`GET /api/health` ve CORS preflight istekleri dışında bütün endpoint'ler `X-Bridge-Key` ister. JSON hataları her zaman makinece okunabilir ve İngilizcedir:

```json
{
  "error": {
    "code": "NOT_PAIRED",
    "message": "The bridge has not been paired with a DIRIGERA hub."
  }
}
```

| Yöntem | Yol | Gövde / sonuç |
| --- | --- | --- |
| `GET` | `/api/health` | Anahtar gerektirmeyen minimal servis sağlığı |
| `POST` | `/api/pair` | `{ "gatewayIP": "..." }`; alan isteğe bağlı |
| `GET` | `/api/status` | `paired`, `connected`, hub ve köprü durumu |
| `GET` | `/api/home` | DIRIGERA home nesnesi ve kanonik Xiaomi cihazları |
| `GET` | `/api/integrations/home-assistant/status` | Secretsız HA bağlantı durumu |
| `POST`, `DELETE` | `/api/integrations/home-assistant/configure` | `{ "baseUrl": "...", "accessToken": "..." }` ile bağlan / yerel token'ı sil |
| `PATCH` | `/api/devices/:id` | `{ "attributes": {...}, "transitionTime": 500? }` |
| `POST` | `/api/rooms/:id/state` | `{ "isOn": true }` veya `{ "attributes": {...}, "deviceType": "light"? }` |
| `POST` | `/api/scenes/:id/trigger` | Sahneyi tetikler |
| `GET`, `POST` | `/api/rules` | Kuralları listeler / oluşturur |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/rules/:id` | Tek kural CRUD |
| `POST` | `/api/rules/:id/run` | Kaydedilmiş kuralı elle test eder |
| `GET` | `/api/events?limit=100&after=0` | Bellekteki son WebSocket/kural olayları |
| `GET` | `/api/events/stream` | Server-Sent Events akışı |

Oda state endpoint'i `isOn`, `attributes`, `deviceType` ve `transitionTime` alanlarını birlikte de kabul eder. `ha_` önekli Xiaomi cihaz komutları Home Assistant servislerine, diğer cihazlar DIRIGERA'ya yönlendirilir.

## Kural modeli

Aşağıdaki örnek, hareket algılandığında ışığı `%70` parlaklık ve `2700 K` ile açar; son hareket tetiklemesinden 120 saniye sonra kapatır:

```json
{
  "name": "Koridor hareketi",
  "enabled": true,
  "trigger": {
    "type": "motion",
    "deviceId": "MOTION_DEVICE_ID"
  },
  "conditions": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "startTime": "20:00",
    "endTime": "07:00",
    "deviceStates": [
      {
        "deviceId": "REFERENCE_LIGHT_ID",
        "attribute": "isReachable",
        "operator": "equals",
        "value": true
      }
    ]
  },
  "actions": [
    {
      "deviceId": "LIGHT_DEVICE_ID",
      "isOn": true,
      "brightness": 70,
      "temperature": 2700
    }
  ],
  "offAfterSeconds": 120
}
```

Desteklenen tetikleyiciler:

- `motion` ve `occupancy`: `deviceStateChanged` olayındaki `attributes.isDetected` değerini izler. İsteğe bağlı `isDetected` varsayılan olarak `true`'dur.
- `button`: `remotePressEvent` olayını `deviceId` ve `clickPattern` (`singlePress`, `doublePress`, `longPress`) ile eşler.
- `time`: yerel makine saatinde `time: "HH:MM"` değerinde çalışır; tetikleyicide ayrıca `days` verilebilir.
- `state`: bir cihaz özniteliği seçilen eşiği ilk kez geçtiğinde çalışır. Yeni ve önceki değer birlikte değerlendirilir; koşul doğru kaldığı sürece tekrar tetiklenmez.
- `deviceEvent`: Home Assistant'ın güvenli biçimde kanonikleştirdiği kamera olaylarını `deviceId` ve `eventType` ile kesin eşler.

`conditions.days`, `conditions.startTime` ve `conditions.endTime` tüm tetikleyicilerde kullanılabilir. Bitiş saati başlangıçtan küçükse aralık gece yarısını geçer. Hiçbir koşul seçilmediyse bu alanlar JSON'a eklenmez; `days` veya `deviceStates` etkinleştirilmiş fakat boş bırakılmışsa kural reddedilir.

`conditions.deviceStates` içindeki bütün satırlar birlikte doğru olmalıdır. Desteklenen durumlar ve operatörler:

- `isOn`, `isReachable`, `isDetected`, `waterTankFull`, `privacy`: `equals`, `notEquals` ve boolean değer.
- `lightLevel`, `batteryPercentage`, `humidity`, `targetHumidity`, `filterLife`, `percentage`: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual` ve `0-100` değer.
- `pm25`, `pm10`: aynı sayısal operatörler ve `0-1000` değer.
- `temperature`: aynı sayısal operatörler ve `-20–60 °C` değer.
- `colorTemperature`: aynı sayısal operatörler ve `1500-6500 K` değer.
- `presetMode`: `equals`, `notEquals` ve metin değer.

Durumu okunamayan veya ilgili özniteliği bulunmayan cihaz koşulu güvenli biçimde `false` kabul edilir; kural aksiyonları çalışmaz. Aynı değerlendirmede aynı cihaz yalnız bir kez okunur.

Bir kuralda en fazla 32 aksiyon bulunabilir. `brightness`, DIRIGERA `lightLevel`; `temperature` ise `colorTemperature` özniteliğine dönüştürülür. İleri kullanım için bir aksiyonda doğrudan `attributes` ve `transitionTime` da verilebilir. Aksiyon düzeyindeki `offAfterSeconds`, kural düzeyindeki değeri geçersiz kılar ve yalnız cihazı açan aksiyonlarda kullanılabilir. `cooldownSeconds`, peş peşe gelen tetiklemeler arasındaki en kısa süreyi belirler. Etkinleştirilmeyen ileri seçenekler kural verisine eklenmez.

Birden fazla ışığı aynı anda uyarı amacıyla yanıp söndürmek için kural düzeyinde `effect` kullanılabilir. Köprü bütün hedeflerin açık/kapalı, parlaklık ve renk sıcaklığı durumunu ışıklara dokunmadan önce okur; fazları paralel gönderir ve süre sonunda her hedefi kendi başlangıç durumuna döndürür. Home Assistant ışıklarında başlangıç durumu doğrudan entity state uç noktasından taze okunur. Gecikmeli bulut komutlarının son durumu sonradan bozmasını önlemek için restore sonrasında beş saniyelik bir doğrulama penceresi çalışır ve sapma görülürse başlangıçtaki güç durumu tekrar uygulanır. Efekt sırasında başka bir kural veya panelden doğrudan cihaz komutu verilirse yeni komut öncelik kazanır ve eski efekt o cihazın durumunu geri yazmaz.

```json
{
  "trigger": {
    "type": "deviceEvent",
    "deviceId": "CAMERA_DEVICE_ID",
    "eventType": "babyCry"
  },
  "actions": [
    { "deviceId": "LIGHT_1", "isOn": true },
    { "deviceId": "LIGHT_2", "isOn": true }
  ],
  "effect": {
    "type": "blink",
    "durationSeconds": 5,
    "intervalMilliseconds": 500,
    "restoreState": true
  }
}
```

Blink efektinde aksiyonlar yalnız benzersiz hedef seçer ve `isOn: true` içerir; geçiş, otomatik kapatma veya başka özniteliklerle birleştirilemez. Süre `1–60` saniye, faz aralığı `100–2000` milisaniye olabilir ve en az bir tam yanıp-sönme çevrimi bulunmalıdır.

Bir hedef cihaz hata verirse kural motoru diğer hedefleri yine dener. Denenen çalıştırma `lastRun` ve `runCount` alanlarına kaydedilir; sonuç `RULE_ACTIONS_PARTIAL_FAILURE` kodlu bir `bridgeRuleFailed` olayıdır. Açma komutu başarılı olduysa, daha sonraki parlaklık veya sıcaklık komutu hata verse bile güvenlik için gecikmeli kapatma zamanlayıcısı kurulur.

Bridge her aksiyon denemesinden sonra `lastRun` ve `runCount` alanlarını kalıcı olarak günceller. Aynı WebSocket olay kimliği tekrar gelirse kural ikinci kez çalıştırılmaz.

## Olay akışı

Geçmiş yalnızca bellektedir ve varsayılan olarak son 500 olayı tutar. DIRIGERA WebSocket olaylarına `bridgeSequence` ve `receivedAt` eklenir. Kural başarı/hataları da `bridgeRuleExecuted` veya `bridgeRuleFailed` olayı olarak yayınlanır.

Köprü, gayriresmî istemcinin sertifika denetimini kapatan dahili WebSocket dinleyicisini kullanmaz. Olay kanalı ayrı bir dinleyiciyle, IKEA sertifika otoritesi sabitlenmiş ve TLS doğrulaması açık olarak kurulur; olay gövdeleri 256 KiB ile sınırlandırılır.

Tarayıcının yerleşik `EventSource` API'si özel header gönderemez. Anahtar zorunluluğunu korumak için SSE akışını header destekleyen `fetch()` ile okuyun:

```js
const response = await fetch("http://127.0.0.1:8787/api/events/stream", {
  headers: { "X-Bridge-Key": bridgeKey },
});

for await (const chunk of response.body) {
  // SSE satırlarını parse edin.
}
```

## CORS ve güvenlik

Servis varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler. Private Network Access preflight için `Access-Control-Allow-Private-Network: true` ve gerekli CORS header'ları eklenir.

- `CORS_ORIGINS=*`, bridge key bilen farklı origin'deki UI'ları destekler. Sabit UI adresleriniz varsa virgülle ayrılmış allowlist daha dar bir ayardır: `CORS_ORIGINS=https://ui.example,https://second.example`.
- Loopback dışındaki bir `HOST` ayarı varsayılan olarak reddedilir. Gerçekten gerekiyorsa `ALLOW_REMOTE_BIND=true` ekleyin; bu durumda ağ firewall'u ve TLS reverse proxy kullanın.
- Bridge key'i frontend kaynak koduna gömmeyin. Kullanıcıdan yerel olarak alın ve mümkünse yalnızca tarayıcı oturumu süresince bellekte tutun.
- `.data/config.json` veya yedekleri access token içerir; bunları buluta yüklemeyin.

## Çalışma sürekliliği

Kural tanımları ile çalışma sayaçları diskte kalıcıdır. Bekleyen “bir süre sonra kapat” sayaçları ise işlem belleğindedir; köprü servisi yeniden başlatılırsa o anda bekleyen sayaç iptal olur. Süreli hareket kurallarında ışık, bir sonraki geçerli sensör olayıyla yeniden normal akışına girer. Bu nedenle köprüyü sürekli açık bir cihazda servis olarak çalıştırın ve servis yeniden başlatmalarını mümkün olduğunca ışıklar kapalıyken yapın.

## Ayarlar

`npm start --prefix bridge`, `bridge/.env` dosyasını varsa otomatik yükler.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind adresi |
| `PORT` | `8787` | HTTP portu |
| `CORS_ORIGINS` | `*` | `*` veya virgülle ayrılmış origin listesi |
| `DIRIGERA_GATEWAY_IP` | boş | İlk eşleştirme için isteğe bağlı hub IP'si |
| `DIRIGERA_REJECT_UNAUTHORIZED` | `true` | Hub sertifika doğrulaması |
| `EVENT_HISTORY_LIMIT` | `500` | Bellekte tutulan olay sayısı (`50..5000`) |
| `BRIDGE_DATA_DIR` | `bridge/.data` | Yerel secret/kural klasörü |
| `ALLOW_REMOTE_BIND` | `false` | Loopback dışı bind için açık onay |

Hub sertifikası değiştiği için bağlantı hatası alırsanız önce hub firmware'ini ve sistem saatini kontrol edin. Son çare olarak yerel, güvendiğiniz ağda `DIRIGERA_REJECT_UNAUTHORIZED=false` kullanılabilir.

## Doğrulama

```bash
npm run check --prefix bridge
npm test --prefix bridge
```
