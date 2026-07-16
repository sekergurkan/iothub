"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BatteryMedium,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  CirclePower,
  Clock3,
  Footprints,
  House,
  Info,
  LampCeiling,
  Lightbulb,
  ListFilter,
  Menu,
  Moon,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Router,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  User,
  WandSparkles,
  Wifi,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";

type View = "home" | "rooms" | "devices" | "rules" | "activity" | "settings";
type DeviceType = "light" | "motion" | "button";
type TriggerType = "motion" | "button" | "time";
type ClickPattern = "singlePress" | "doublePress" | "longPress";

type SmartDevice = {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  model: string;
  online: boolean;
  battery?: number;
  isOn?: boolean;
  brightness?: number;
  temperature?: number;
  lastEvent?: string;
  automatedBy?: string;
};

type Room = {
  id: string;
  name: string;
  icon: "sofa" | "hall" | "bed";
  color: "violet" | "peach" | "blue";
};

type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: TriggerType;
    deviceId?: string;
    clickPattern?: ClickPattern;
    time?: string;
  };
  conditions: {
    startTime?: string;
    endTime?: string;
    days?: string[];
  };
  actions: Array<{
    deviceId: string;
    isOn: boolean;
    brightness?: number;
    temperature?: number;
  }>;
  offAfterSeconds?: number;
  lastRun?: string;
  runCount: number;
};

type TimelineEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: "motion" | "light" | "button" | "rule" | "system";
};

type BridgeSettings = {
  url: string;
  key: string;
};

type RawDirigeraDevice = {
  id: string;
  deviceType: string;
  isReachable?: boolean;
  lastSeen?: string;
  room?: { name?: string };
  attributes?: {
    customName?: string;
    model?: string;
    batteryPercentage?: number;
    isOn?: boolean;
    lightLevel?: number;
    colorTemperature?: number;
  };
};

type RawBridgeEvent = {
  id?: string;
  type?: string;
  time?: string;
  receivedAt?: string;
  bridgeSequence?: number;
  data?: {
    id?: string;
    deviceId?: string;
    clickPattern?: string;
    ruleName?: string;
    attributes?: Record<string, unknown>;
    error?: { message?: string };
  };
};

async function requestBridge(settings: BridgeSettings, path: string, init?: RequestInit) {
  const base = settings.url.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Key": settings.key,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "bridge_error" }));
    throw new Error(error.message || error.error?.message || (typeof error.error === "string" ? error.error : "Köprüye bağlanılamadı"));
  }
  if (response.status === 204) return null;
  return response.json();
}

const rooms: Room[] = [
  { id: "living", name: "Salon", icon: "sofa", color: "violet" },
  { id: "hall", name: "Koridor", icon: "hall", color: "peach" },
  { id: "bedroom", name: "Yatak Odası", icon: "bed", color: "blue" },
];

const initialDevices: SmartDevice[] = [
  {
    id: "light-living-floor",
    name: "Koltuk Lambası",
    room: "Salon",
    type: "light",
    model: "TRÅDFRI E27",
    online: true,
    isOn: true,
    brightness: 68,
    temperature: 2700,
  },
  {
    id: "light-living-ceiling",
    name: "Tavan Işığı",
    room: "Salon",
    type: "light",
    model: "TRÅDFRI GU10",
    online: true,
    isOn: false,
    brightness: 45,
    temperature: 3200,
  },
  {
    id: "button-living",
    name: "Akşam Butonu",
    room: "Salon",
    type: "button",
    model: "STYRBAR",
    online: true,
    battery: 74,
    lastEvent: "Bugün, 18:07",
  },
  {
    id: "light-hall",
    name: "Koridor Işığı",
    room: "Koridor",
    type: "light",
    model: "TRÅDFRI E14",
    online: true,
    isOn: true,
    brightness: 20,
    temperature: 2200,
    automatedBy: "Gece yolu",
  },
  {
    id: "motion-hall",
    name: "Hareket Sensörü",
    room: "Koridor",
    type: "motion",
    model: "VALLHORN",
    online: true,
    battery: 86,
    lastEvent: "2 dk önce",
  },
  {
    id: "light-bedside",
    name: "Başucu Lambası",
    room: "Yatak Odası",
    type: "light",
    model: "TRÅDFRI E14",
    online: true,
    isOn: false,
    brightness: 35,
    temperature: 2400,
  },
];

const initialRules: AutomationRule[] = [
  {
    id: "rule-hall-motion",
    name: "Koridoru hareketle aydınlat",
    enabled: true,
    trigger: { type: "motion", deviceId: "motion-hall" },
    conditions: { startTime: "18:00", endTime: "01:00" },
    actions: [{ deviceId: "light-hall", isOn: true, brightness: 35, temperature: 2400 }],
    offAfterSeconds: 120,
    lastRun: "2 dk önce",
    runCount: 18,
  },
  {
    id: "rule-night-path",
    name: "Gece yolu",
    enabled: true,
    trigger: { type: "motion", deviceId: "motion-hall" },
    conditions: { startTime: "00:00", endTime: "06:00" },
    actions: [{ deviceId: "light-hall", isOn: true, brightness: 10, temperature: 2200 }],
    offAfterSeconds: 60,
    lastRun: "Dün, 03:18",
    runCount: 7,
  },
  {
    id: "rule-evening-button",
    name: "Akşam butonu",
    enabled: true,
    trigger: { type: "button", deviceId: "button-living", clickPattern: "singlePress" },
    conditions: {},
    actions: [
      { deviceId: "light-living-floor", isOn: true, brightness: 65, temperature: 2700 },
      { deviceId: "light-living-ceiling", isOn: true, brightness: 65, temperature: 2700 },
    ],
    lastRun: "Bugün, 18:07",
    runCount: 4,
  },
  {
    id: "rule-away-button",
    name: "Evden çıkış",
    enabled: false,
    trigger: { type: "button", deviceId: "button-living", clickPattern: "longPress" },
    conditions: {},
    actions: [
      { deviceId: "light-living-floor", isOn: false },
      { deviceId: "light-living-ceiling", isOn: false },
      { deviceId: "light-hall", isOn: false },
      { deviceId: "light-bedside", isOn: false },
    ],
    lastRun: "Pazartesi, 08:42",
    runCount: 2,
  },
];

const initialTimeline: TimelineEvent[] = [
  {
    id: "evt-1",
    at: "21:42",
    title: "Koridorda hareket algılandı",
    detail: "Gece yolu · Koridor Işığı %20 açıldı",
    kind: "motion",
  },
  {
    id: "evt-2",
    at: "18:07",
    title: "Akşam Butonu'na basıldı",
    detail: "Akşam butonu · Salon ışıkları %65 açıldı",
    kind: "button",
  },
  {
    id: "evt-3",
    at: "17:58",
    title: "Koltuk Lambası elle açıldı",
    detail: "Parlaklık %68 · Sıcak beyaz",
    kind: "light",
  },
  {
    id: "evt-4",
    at: "08:42",
    title: "Evden çıkış tamamlandı",
    detail: "4 ışık kapatıldı · 0 hata",
    kind: "rule",
  },
];

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Genel Bakış", icon: House },
  { id: "rooms", label: "Odalar", icon: LampCeiling },
  { id: "devices", label: "Cihazlar", icon: SlidersHorizontal },
  { id: "rules", label: "Kurallar", icon: WandSparkles },
  { id: "activity", label: "Geçmiş", icon: Activity },
];

const weekDayLabels: Record<string, string> = {
  Mon: "Pzt",
  Tue: "Sal",
  Wed: "Çar",
  Thu: "Per",
  Fri: "Cum",
  Sat: "Cmt",
  Sun: "Paz",
};

const allWeekDays = Object.keys(weekDayLabels);

function DeviceGlyph({ type, size = 20 }: { type: DeviceType; size?: number }) {
  if (type === "light") return <Lightbulb size={size} />;
  if (type === "motion") return <Footprints size={size} />;
  return <MousePointerClick size={size} />;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

function nowLabel() {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function isRawDirigeraDevice(value: unknown): value is RawDirigeraDevice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RawDirigeraDevice>;
  return typeof candidate.id === "string" && typeof candidate.deviceType === "string";
}

function normalizeHome(raw: unknown): SmartDevice[] {
  const home = raw && typeof raw === "object" ? (raw as { devices?: unknown }) : {};
  const rawDevices = Array.isArray(home.devices) ? home.devices.filter(isRawDirigeraDevice) : [];
  return rawDevices
    .filter((device) =>
      ["light", "motionSensor", "occupancySensor", "shortcutController", "lightController", "genericSwitch"].includes(
        device.deviceType,
      ),
    )
    .map((device): SmartDevice => {
      const type: DeviceType =
        device.deviceType === "light"
          ? "light"
          : ["motionSensor", "occupancySensor"].includes(device.deviceType)
            ? "motion"
            : "button";
      return {
        id: device.id,
        name: device.attributes?.customName || device.attributes?.model || "İsimsiz cihaz",
        room: device.room?.name || "Odasız",
        type,
        model: device.attributes?.model || device.deviceType,
        online: device.isReachable !== false,
        battery: device.attributes?.batteryPercentage,
        isOn: type === "light" ? Boolean(device.attributes?.isOn) : undefined,
        brightness: device.attributes?.lightLevel,
        temperature: device.attributes?.colorTemperature,
        lastEvent: device.lastSeen,
      };
    });
}

function normalizeBridgeEvents(raw: unknown, devices: SmartDevice[]): TimelineEvent[] {
  const payload = raw && typeof raw === "object" ? (raw as { events?: unknown }) : {};
  if (!Array.isArray(payload.events)) return [];

  return payload.events
    .filter((event): event is RawBridgeEvent => Boolean(event && typeof event === "object"))
    .map((event, index): TimelineEvent => {
      const data = event.data || {};
      const deviceId = data.id || data.deviceId;
      const device = devices.find((item) => item.id === deviceId);
      const deviceName = device?.name || "Bir cihaz";
      const attributes = data.attributes || {};
      const dateValue = event.time || event.receivedAt;
      const parsedDate = dateValue ? new Date(dateValue) : null;
      const at = parsedDate && Number.isFinite(parsedDate.getTime())
        ? parsedDate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
        : "—";
      const id = event.id || `bridge-event-${event.bridgeSequence || index}`;

      if (event.type === "remotePressEvent") {
        const press = data.clickPattern === "doublePress" ? "Çift basış" : data.clickPattern === "longPress" ? "Uzun basış" : "Tek basış";
        return { id, at, title: `${deviceName} kullanıldı`, detail: `${press} DIRIGERA tarafından algılandı`, kind: "button" };
      }
      if (event.type === "bridgeRuleExecuted" || event.type === "bridgeRuleFailed") {
        const failed = event.type === "bridgeRuleFailed";
        return {
          id,
          at,
          title: `${data.ruleName || "Kural"} ${failed ? "tamamlanamadı" : "çalıştı"}`,
          detail: failed ? data.error?.message || "Bir kural eylemi başarısız oldu" : "Tüm kural eylemleri tamamlandı",
          kind: "rule",
        };
      }
      if (event.type === "deviceStateChanged" && typeof attributes.isDetected === "boolean") {
        return {
          id,
          at,
          title: attributes.isDetected ? `${deviceName} hareket algıladı` : `${deviceName} sakin`,
          detail: device?.room ? `${device.room} sensör durumu güncellendi` : "Sensör durumu güncellendi",
          kind: "motion",
        };
      }
      if (event.type === "deviceStateChanged" && typeof attributes.isOn === "boolean") {
        return {
          id,
          at,
          title: `${deviceName} ${attributes.isOn ? "açıldı" : "kapatıldı"}`,
          detail: "DIRIGERA cihaz durumu güncellendi",
          kind: "light",
        };
      }
      return { id, at, title: `${deviceName} güncellendi`, detail: "DIRIGERA'dan yeni bir olay alındı", kind: "system" };
    })
    .reverse();
}

function describeRule(rule: AutomationRule, devices: SmartDevice[]) {
  const triggerDevice = devices.find((device) => device.id === rule.trigger.deviceId)?.name;
  let trigger = "Belirlenen anda";
  if (rule.trigger.type === "motion") trigger = `${triggerDevice || "Sensör"} hareket algıladığında`;
  if (rule.trigger.type === "button") {
    const click =
      rule.trigger.clickPattern === "doublePress"
        ? "çift basıldığında"
        : rule.trigger.clickPattern === "longPress"
          ? "uzun basıldığında"
          : "basıldığında";
    trigger = `${triggerDevice || "Buton"} ${click}`;
  }
  if (rule.trigger.type === "time") trigger = `Saat ${rule.trigger.time || "--:--"} olduğunda`;

  const targets = rule.actions
    .map((action) => devices.find((device) => device.id === action.deviceId)?.name)
    .filter(Boolean);
  const firstAction = rule.actions[0];
  const actionText = firstAction?.isOn
    ? `${targets.join(", ")} ${firstAction.brightness ? `%${firstAction.brightness}` : ""} açılsın`
    : `${targets.join(", ")} kapatılsın`;
  return `${trigger}, ${actionText}${rule.offAfterSeconds ? `; ${Math.round(rule.offAfterSeconds / 60)} dk sonra kapansın` : ""}.`;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
    >
      <span />
    </button>
  );
}

function EmptyState({ icon: Icon, title, copy }: { icon: LucideIcon; title: string; copy: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={25} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

export function HomeControl() {
  const [view, setView] = useState<View>("home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [devices, setDevices] = useState(initialDevices);
  const [rules, setRules] = useState(initialRules);
  const [timeline, setTimeline] = useState(initialTimeline);
  const [selectedRoom, setSelectedRoom] = useState<string>("Tümü");
  const [search, setSearch] = useState("");
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<"demo" | "bridge">("demo");
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettings>({
    url: "http://127.0.0.1:8787",
    key: "",
  });
  const [lastSync, setLastSync] = useState("şimdi");
  const [welcome, setWelcome] = useState({ greeting: "Merhaba", date: "Bugün" });

  const lights = useMemo(() => devices.filter((device) => device.type === "light"), [devices]);
  const activeLights = lights.filter((device) => device.isOn).length;
  const onlineDevices = devices.filter((device) => device.online).length;
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const displayedRooms = useMemo<Room[]>(() => {
    if (mode === "demo") return rooms;
    const icons: Room["icon"][] = ["sofa", "hall", "bed"];
    const colors: Room["color"][] = ["violet", "peach", "blue"];
    return Array.from(new Set(devices.map((device) => device.room))).map((name, index) => ({
      id: `room-${index}`,
      name,
      icon: icons[index % icons.length],
      color: colors[index % colors.length],
    }));
  }, [devices, mode]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWelcome({ greeting: greeting(), date: nowLabel() });
      try {
        const legacy = window.localStorage.getItem("yuva-bridge-settings");
        const legacySettings = legacy ? (JSON.parse(legacy) as Partial<BridgeSettings>) : {};
        const url = window.localStorage.getItem("yuva-bridge-url") || legacySettings.url;
        const key = window.sessionStorage.getItem("yuva-bridge-key") || legacySettings.key;
        if (url || key) setBridgeSettings((current) => ({ url: url || current.url, key: key || "" }));
        if (legacySettings.key) window.sessionStorage.setItem("yuva-bridge-key", legacySettings.key);
        window.localStorage.removeItem("yuva-bridge-settings");
      } catch {
        // Connection preferences are optional; the key remains session-scoped.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const bridgeFetch = useCallback(
    (path: string, init?: RequestInit) => requestBridge(bridgeSettings, path, init),
    [bridgeSettings],
  );

  const syncBridge = useCallback(async (settingsOverride?: BridgeSettings) => {
    const settings = settingsOverride || bridgeSettings;
    if (!settings.key) return false;
    const status = await requestBridge(settings, "/api/status");
    if (!status.connected) throw new Error("DIRIGERA henüz eşleştirilmemiş");
    const home = await requestBridge(settings, "/api/home");
    const normalized = normalizeHome(home);
    if (normalized.length) setDevices(normalized);
    const [rulesPayload, eventsPayload] = await Promise.all([
      requestBridge(settings, "/api/rules").catch(() => []),
      requestBridge(settings, "/api/events?limit=100").catch(() => ({ events: [] })),
    ]);
    const bridgeRules = Array.isArray(rulesPayload) ? rulesPayload : Array.isArray(rulesPayload?.rules) ? rulesPayload.rules : [];
    if (Array.isArray(bridgeRules)) setRules(bridgeRules);
    setTimeline(normalizeBridgeEvents(eventsPayload, normalized));
    setMode("bridge");
    setBridgeOnline(true);
    setLastSync("şimdi");
    return true;
  }, [bridgeSettings]);

  useEffect(() => {
    if (mode !== "bridge") return;
    const timer = window.setInterval(() => {
      syncBridge().catch(() => setBridgeOnline(false));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [mode, syncBridge]);

  async function sendDeviceAttributes(id: string, attributes: Record<string, unknown>) {
    if (mode !== "bridge") return;
    await bridgeFetch(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ attributes }),
    });
  }

  function toggleLight(id: string) {
    const device = devices.find((item) => item.id === id);
    if (!device || !device.online) return;
    const next = !device.isOn;
    setDevices((current) => current.map((item) => (item.id === id ? { ...item, isOn: next } : item)));
    setTimeline((current) => [
      {
        id: `evt-${Date.now()}`,
        at: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        title: `${device.name} ${next ? "açıldı" : "kapatıldı"}`,
        detail: "Web panelinden elle kontrol edildi",
        kind: "light",
      },
      ...current,
    ]);
    showToast(`${device.name} ${next ? "açıldı" : "kapatıldı"}`);
    sendDeviceAttributes(id, { isOn: next }).catch(() => {
      setDevices((current) => current.map((item) => (item.id === id ? { ...item, isOn: !next } : item)));
      showToast("Komut iletilemedi; önceki duruma dönüldü");
    });
  }

  function setBrightness(id: string, brightness: number) {
    setDevices((current) =>
      current.map((item) => (item.id === id ? { ...item, brightness, isOn: true } : item)),
    );
  }

  function commitBrightness(id: string, brightness: number) {
    sendDeviceAttributes(id, { isOn: true, lightLevel: brightness }).catch(() =>
      showToast("Parlaklık komutu iletilemedi"),
    );
  }

  function setAllLights(isOn: boolean) {
    setDevices((current) => current.map((device) => (device.type === "light" ? { ...device, isOn } : device)));
    showToast(isOn ? "Tüm ışıklar açıldı" : "Evdeki tüm ışıklar kapatıldı");
    if (mode === "bridge") {
      Promise.all(lights.map((light) => sendDeviceAttributes(light.id, { isOn }))).catch(() =>
        showToast("Bazı ışıklara ulaşılamadı"),
      );
    }
  }

  function applyEveningScene() {
    const attributesFor = (device: SmartDevice) => ({
      isOn: device.room !== "Yatak Odası",
      lightLevel: device.room === "Koridor" ? 20 : 65,
      colorTemperature: 2400,
    });
    setDevices((current) =>
      current.map((device) =>
        device.type === "light"
          ? { ...device, isOn: device.room !== "Yatak Odası", brightness: device.room === "Koridor" ? 20 : 65, temperature: 2400 }
          : device,
      ),
    );
    showToast("Akşam modu hazır");
    if (mode === "bridge") {
      Promise.all(lights.map((light) => sendDeviceAttributes(light.id, attributesFor(light)))).catch(() =>
        showToast("Akşam modu bazı ışıklara iletilemedi"),
      );
    }
  }

  function toggleRoom(roomName: string) {
    const roomLights = lights.filter((device) => device.room === roomName);
    const shouldTurnOn = roomLights.every((device) => !device.isOn);
    setDevices((current) =>
      current.map((device) => (device.room === roomName && device.type === "light" ? { ...device, isOn: shouldTurnOn } : device)),
    );
    showToast(`${roomName} ışıkları ${shouldTurnOn ? "açıldı" : "kapatıldı"}`);
    if (mode === "bridge") {
      Promise.all(roomLights.map((light) => sendDeviceAttributes(light.id, { isOn: shouldTurnOn }))).catch(() => {
        showToast("Bazı oda ışıklarına ulaşılamadı");
        syncBridge().catch(() => setBridgeOnline(false));
      });
    }
  }

  function saveRule(rule: AutomationRule) {
    const existing = rules.some((item) => item.id === rule.id);
    setRules((current) => (existing ? current.map((item) => (item.id === rule.id ? rule : item)) : [rule, ...current]));
    setRuleModalOpen(false);
    setEditingRule(null);
    showToast(existing ? "Kural güncellendi" : "Yeni kural etkinleştirildi");
    if (mode === "bridge") {
      bridgeFetch(`/api/rules${existing ? `/${rule.id}` : ""}`, {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify(rule),
      }).catch(() => showToast("Kural köprüye kaydedilemedi"));
    }
  }

  function toggleRule(id: string) {
    const target = rules.find((rule) => rule.id === id);
    if (!target) return;
    const updated = { ...target, enabled: !target.enabled };
    setRules((current) => current.map((rule) => (rule.id === id ? updated : rule)));
    showToast(updated.enabled ? "Kural etkin" : "Kural duraklatıldı");
    if (mode === "bridge") {
      bridgeFetch(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(updated) }).catch(() =>
        showToast("Kural durumu köprüye iletilemedi"),
      );
    }
  }

  function testRule(rule: AutomationRule) {
    setDevices((current) =>
      current.map((device) => {
        const action = rule.actions.find((item) => item.deviceId === device.id);
        return action
          ? {
              ...device,
              isOn: action.isOn,
              brightness: action.brightness ?? device.brightness,
              temperature: action.temperature ?? device.temperature,
            }
          : device;
      }),
    );
    showToast(`“${rule.name}” test edildi`);
    if (mode === "bridge") {
      Promise.all(
        rule.actions.map((action) =>
          sendDeviceAttributes(action.deviceId, {
            isOn: action.isOn,
            ...(action.brightness !== undefined ? { lightLevel: action.brightness } : {}),
            ...(action.temperature !== undefined ? { colorTemperature: action.temperature } : {}),
          }),
        ),
      ).catch(() => showToast("Test eylemlerinin bazıları iletilemedi"));
    }
  }

  function deleteRule(rule: AutomationRule) {
    setRules((current) => current.filter((item) => item.id !== rule.id));
    showToast("Kural silindi");
    if (mode === "bridge") {
      bridgeFetch(`/api/rules/${rule.id}`, { method: "DELETE" }).catch(() =>
        showToast("Kural köprüden silinemedi"),
      );
    }
  }

  function openRuleEditor(rule?: AutomationRule) {
    setEditingRule(rule || null);
    setRuleModalOpen(true);
  }

  function navigate(next: View) {
    setView(next);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filteredDevices = devices.filter((device) => {
    const matchesRoom = selectedRoom === "Tümü" || device.room === selectedRoom;
    const matchesSearch = `${device.name} ${device.room} ${device.model}`.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"));
    return matchesRoom && matchesSearch;
  });

  const pageTitle: Record<View, { eyebrow: string; title: string; copy: string }> = {
    home: { eyebrow: welcome.date, title: `${welcome.greeting}, Gürkan`, copy: "Evin sakin; her şey planlandığı gibi çalışıyor." },
    rooms: { eyebrow: `${displayedRooms.length} oda`, title: "Odalar", copy: "Her alanı tek dokunuşla kontrol et." },
    devices: { eyebrow: `${devices.length} ürün`, title: "Cihazlar", copy: "Işık, sensör ve butonların son durumu." },
    rules: { eyebrow: `${activeRules} kural çalışıyor`, title: "Kurallar", copy: "Evin ne zaman, nasıl davranacağını sen belirle." },
    activity: { eyebrow: "Son 24 saat", title: "Geçmiş", copy: "Evde olan biten her şeyi sakin bir akışta izle." },
    settings: { eyebrow: "Yerel ve güvenli", title: "Ayarlar", copy: "DIRIGERA bağlantını ve panel tercihlerini yönet." },
  };

  const title = pageTitle[view];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <div className="brand" aria-label="Yuva ana sayfa">
          <span className="brand-mark"><Zap size={20} strokeWidth={2.5} /></span>
          <span className="brand-name">yuva</span>
          <span className="brand-tag">home</span>
        </div>

        <div className="home-selector">
          <span className="home-avatar"><House size={18} /></span>
          <span><strong>Evim</strong><small>{devices.length} cihaz · {displayedRooms.length} oda</small></span>
          <ChevronRight size={16} />
        </div>

        <nav className="main-nav" aria-label="Ana menü">
          <span className="nav-label">EVİM</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={19} />
                <span>{item.label}</span>
                {item.id === "rules" && <em>{activeRules}</em>}
              </button>
            );
          })}
          <span className="nav-label nav-label-spaced">SİSTEM</span>
          <button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}>
            <Settings2 size={19} />
            <span>Ayarlar</span>
          </button>
          <button onClick={() => showToast("Yardım merkezi yakında burada")}>
            <CircleHelp size={19} />
            <span>Yardım</span>
          </button>
        </nav>

        <div className="sidebar-status">
          <span className={`status-orb ${bridgeOnline || mode === "demo" ? "online" : "offline"}`}><Radio size={15} /></span>
          <span>
            <strong>{mode === "demo" ? "Demo evi" : bridgeOnline ? "DIRIGERA bağlı" : "Bağlantı kesildi"}</strong>
            <small>{mode === "demo" ? "Örnek veriler" : `Son eşitleme ${lastSync}`}</small>
          </span>
          <button aria-label="Bağlantı ayarları" onClick={() => setConnectionModalOpen(true)}><MoreHorizontal size={18} /></button>
        </div>
      </aside>

      {mobileNavOpen && <button className="nav-scrim" aria-label="Menüyü kapat" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Menüyü aç" onClick={() => setMobileNavOpen(true)}><Menu /></button>
          <div className="mobile-brand"><span className="brand-mark"><Zap size={17} /></span><b>yuva</b></div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Ara" onClick={() => view !== "devices" && navigate("devices")}><Search size={19} /></button>
            <button className="icon-button notification" aria-label="Bildirimler" onClick={() => showToast("Yeni bildirim yok")}><Bell size={19} /><span /></button>
            <button className="profile-button" onClick={() => navigate("settings")}><span><User size={17} /></span><b>GS</b></button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div><span className="eyebrow">{title.eyebrow}</span><h1>{title.title}</h1><p>{title.copy}</p></div>
            {view === "rules" && <button className="primary-button" onClick={() => openRuleEditor()}><Plus size={18} /> Yeni kural</button>}
            {view === "devices" && <button className="secondary-button" onClick={() => showToast("Cihaz listesi yenilendi")}><RefreshCw size={17} /> Eşitle</button>}
          </section>

          {view === "home" && (
            <DashboardView
              devices={devices}
              rooms={displayedRooms}
              rules={rules}
              timeline={timeline}
              activeLights={activeLights}
              onlineDevices={onlineDevices}
              toggleLight={toggleLight}
              setBrightness={setBrightness}
              commitBrightness={commitBrightness}
              toggleRoom={toggleRoom}
              setAllLights={setAllLights}
              applyEveningScene={applyEveningScene}
              navigate={navigate}
              openRuleEditor={openRuleEditor}
            />
          )}
          {view === "rooms" && (
            <RoomsView rooms={displayedRooms} devices={devices} toggleLight={toggleLight} toggleRoom={toggleRoom} setBrightness={setBrightness} commitBrightness={commitBrightness} />
          )}
          {view === "devices" && (
            <DevicesView
              devices={filteredDevices}
              allDevices={devices}
              selectedRoom={selectedRoom}
              setSelectedRoom={setSelectedRoom}
              search={search}
              setSearch={setSearch}
              toggleLight={toggleLight}
              setBrightness={setBrightness}
              commitBrightness={commitBrightness}
            />
          )}
          {view === "rules" && (
            <RulesView rules={rules} devices={devices} toggleRule={toggleRule} testRule={testRule} editRule={openRuleEditor} deleteRule={deleteRule} />
          )}
          {view === "activity" && <ActivityView timeline={timeline} />}
          {view === "settings" && (
            <SettingsView
              mode={mode}
              bridgeOnline={bridgeOnline}
              bridgeSettings={bridgeSettings}
              openConnection={() => setConnectionModalOpen(true)}
              useDemo={() => {
                setMode("demo");
                setBridgeOnline(false);
                setDevices(initialDevices);
                setRules(initialRules);
                showToast("Demo evine dönüldü");
              }}
            />
          )}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobil menü">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={20} /><span>{item.label.replace("Genel ", "")}</span></button>;
        })}
      </nav>

      {ruleModalOpen && (
        <RuleBuilder
          devices={devices}
          initialRule={editingRule}
          onClose={() => {
            setRuleModalOpen(false);
            setEditingRule(null);
          }}
          onSave={saveRule}
          onTest={testRule}
        />
      )}
      {connectionModalOpen && (
        <ConnectionModal
          settings={bridgeSettings}
          onClose={() => setConnectionModalOpen(false)}
          onConnect={async (settings, gatewayIP) => {
            setBridgeSettings(settings);
            window.localStorage.setItem("yuva-bridge-url", settings.url);
            window.sessionStorage.setItem("yuva-bridge-key", settings.key);
            try {
              const status = await requestBridge(settings, "/api/status");
              if (!status.paired) {
                await requestBridge(settings, "/api/pair", {
                  method: "POST",
                  body: JSON.stringify(gatewayIP ? { gatewayIP } : {}),
                });
              }
              await syncBridge(settings);
              setConnectionModalOpen(false);
              showToast("DIRIGERA köprüsüne bağlanıldı");
            } catch (error) {
              setBridgeOnline(false);
              throw error;
            }
          }}
          onDemo={() => {
            setMode("demo");
            setBridgeOnline(false);
            setDevices(initialDevices);
            setRules(initialRules);
            setConnectionModalOpen(false);
            showToast("Demo modunda devam ediliyor");
          }}
        />
      )}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function DashboardView({
  devices,
  rooms,
  rules,
  timeline,
  activeLights,
  onlineDevices,
  toggleLight,
  setBrightness,
  commitBrightness,
  toggleRoom,
  setAllLights,
  applyEveningScene,
  navigate,
  openRuleEditor,
}: {
  devices: SmartDevice[];
  rooms: Room[];
  rules: AutomationRule[];
  timeline: TimelineEvent[];
  activeLights: number;
  onlineDevices: number;
  toggleLight: (id: string) => void;
  setBrightness: (id: string, value: number) => void;
  commitBrightness: (id: string, value: number) => void;
  toggleRoom: (name: string) => void;
  setAllLights: (isOn: boolean) => void;
  applyEveningScene: () => void;
  navigate: (view: View) => void;
  openRuleEditor: (rule?: AutomationRule) => void;
}) {
  const featuredLights = devices.filter((device) => device.type === "light").slice(0, 3);
  const lastMotion = devices.find((device) => device.type === "motion")?.lastEvent || "—";
  return (
    <>
      <section className="summary-strip">
        <div className="summary-intro">
          <span className="summary-icon"><Sparkles size={21} /></span>
          <div><strong>Evde huzur var.</strong><p>Tüm sistemler normal çalışıyor.</p></div>
        </div>
        <div className="summary-metrics">
          <div><b>{onlineDevices}</b><span>Cihaz çevrimiçi</span></div>
          <div><b>{activeLights}</b><span>Işık açık</span></div>
          <div><b>{lastMotion}</b><span>Son hareket</span></div>
        </div>
      </section>

      <section className="quick-actions" aria-label="Hızlı işlemler">
        <button onClick={() => setAllLights(false)}><span className="quick-icon navy"><CirclePower size={20} /></span><span><b>Tümünü kapat</b><small>Evdeki tüm ışıklar</small></span><ChevronRight size={17} /></button>
        <button onClick={applyEveningScene}><span className="quick-icon amber"><Moon size={20} /></span><span><b>Akşam modu</b><small>Sıcak ve loş ışıklar</small></span><ChevronRight size={17} /></button>
        <button onClick={() => openRuleEditor()}><span className="quick-icon blue"><WandSparkles size={20} /></span><span><b>Yeni otomasyon</b><small>Kendi kuralını oluştur</small></span><ChevronRight size={17} /></button>
      </section>

      <section className="content-section">
        <div className="section-title"><div><span>ODALAR</span><h2>Yaşam alanların</h2></div><button onClick={() => navigate("rooms")}>Tümünü gör <ArrowRight size={16} /></button></div>
        <div className="room-grid">
          {rooms.map((room) => {
            const roomDevices = devices.filter((device) => device.room === room.name);
            const roomLights = roomDevices.filter((device) => device.type === "light");
            const onCount = roomLights.filter((device) => device.isOn).length;
            return (
              <article className={`room-card ${room.color}`} key={room.id}>
                <div className="room-card-top"><span className="room-pictogram"><House size={24} /></span><Switch checked={onCount > 0} label={`${room.name} ışıklarını değiştir`} onChange={() => toggleRoom(room.name)} /></div>
                <div><span className="room-kicker">{roomDevices.length} CİHAZ</span><h3>{room.name}</h3><p>{onCount ? `${onCount} ışık açık` : "Tüm ışıklar kapalı"}</p></div>
                <div className="room-dots">{roomDevices.slice(0, 5).map((device) => <span key={device.id} className={device.isOn ? "on" : ""}><DeviceGlyph type={device.type} size={14} /></span>)}</div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="content-section device-section">
          <div className="section-title"><div><span>CİHAZLAR</span><h2>Hızlı kontrol</h2></div><button onClick={() => navigate("devices")}>Tümünü gör <ArrowRight size={16} /></button></div>
          <div className="compact-device-list">
            {featuredLights.map((device) => (
              <article className={`compact-device ${device.isOn ? "is-active" : ""}`} key={device.id}>
                <button className="device-main" onClick={() => toggleLight(device.id)} aria-label={`${device.name} ${device.isOn ? "kapat" : "aç"}`}>
                  <span className="device-icon"><Lightbulb size={21} /></span>
                  <span><b>{device.name}</b><small>{device.room} · {device.isOn ? `%${device.brightness} açık` : "Kapalı"}</small></span>
                </button>
                <Switch checked={Boolean(device.isOn)} label={`${device.name} anahtarı`} onChange={() => toggleLight(device.id)} />
                {device.isOn && <div className="mini-dimmer"><Sun size={13} /><input aria-label={`${device.name} parlaklık`} type="range" min="1" max="100" value={device.brightness} onChange={(event) => setBrightness(device.id, Number(event.target.value))} onPointerUp={() => commitBrightness(device.id, device.brightness || 1)} style={{ "--range-progress": `${device.brightness}%` } as React.CSSProperties} /></div>}
              </article>
            ))}
          </div>
        </section>

        <section className="content-section activity-preview">
          <div className="section-title"><div><span>CANLI</span><h2>Son hareketler</h2></div><button onClick={() => navigate("activity")}>Geçmiş <ArrowRight size={16} /></button></div>
          <div className="timeline compact">
            {timeline.slice(0, 3).map((event) => <TimelineRow event={event} key={event.id} />)}
          </div>
        </section>
      </div>

      <section className="rule-callout">
        <div className="rule-callout-art"><span><WandSparkles size={30} /></span><i /><i /><i /></div>
        <div><span className="eyebrow">AKILLI AKIŞLAR</span><h2>Evin, ritmine ayak uydursun.</h2><p>Hareketi, saatleri ve butonlarını bir araya getir. {rules.filter((rule) => rule.enabled).length} kural şu anda senin için çalışıyor.</p></div>
        <button onClick={() => navigate("rules")}>Kuralları yönet <ArrowRight size={17} /></button>
      </section>
    </>
  );
}

function RoomsView({ rooms, devices, toggleLight, toggleRoom, setBrightness, commitBrightness }: { rooms: Room[]; devices: SmartDevice[]; toggleLight: (id: string) => void; toggleRoom: (name: string) => void; setBrightness: (id: string, value: number) => void; commitBrightness: (id: string, value: number) => void }) {
  return (
    <div className="room-detail-grid">
      {rooms.map((room) => {
        const roomDevices = devices.filter((device) => device.room === room.name);
        const roomLights = roomDevices.filter((device) => device.type === "light");
        return (
          <section className={`room-detail ${room.color}`} key={room.id}>
            <header><div><span>{roomDevices.length} cihaz</span><h2>{room.name}</h2></div><Switch checked={roomLights.some((light) => light.isOn)} onChange={() => toggleRoom(room.name)} label={`${room.name} toplu anahtar`} /></header>
            <div className="room-device-stack">
              {roomDevices.map((device) => <DeviceListItem key={device.id} device={device} onToggle={() => toggleLight(device.id)} onBrightness={(value) => setBrightness(device.id, value)} onBrightnessCommit={() => commitBrightness(device.id, device.brightness || 1)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DevicesView({ devices, allDevices, selectedRoom, setSelectedRoom, search, setSearch, toggleLight, setBrightness, commitBrightness }: { devices: SmartDevice[]; allDevices: SmartDevice[]; selectedRoom: string; setSelectedRoom: (room: string) => void; search: string; setSearch: (search: string) => void; toggleLight: (id: string) => void; setBrightness: (id: string, value: number) => void; commitBrightness: (id: string, value: number) => void }) {
  const roomNames = ["Tümü", ...Array.from(new Set(allDevices.map((device) => device.room)))];
  return (
    <section className="panel devices-panel">
      <div className="filter-toolbar">
        <label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cihaz veya oda ara" /></label>
        <div className="room-filters"><ListFilter size={17} />{roomNames.map((room) => <button key={room} className={selectedRoom === room ? "active" : ""} onClick={() => setSelectedRoom(room)}>{room}</button>)}</div>
      </div>
      <div className="devices-table-head"><span>CİHAZ</span><span>DURUM</span><span>PİL / SEVİYE</span><span>KONTROL</span></div>
      <div className="devices-table">
        {devices.map((device) => <DeviceListItem key={device.id} device={device} onToggle={() => toggleLight(device.id)} onBrightness={(value) => setBrightness(device.id, value)} onBrightnessCommit={() => commitBrightness(device.id, device.brightness || 1)} table />)}
        {!devices.length && <EmptyState icon={Search} title="Cihaz bulunamadı" copy="Arama veya oda filtresini değiştirip yeniden dene." />}
      </div>
    </section>
  );
}

function DeviceListItem({ device, onToggle, onBrightness, onBrightnessCommit, table = false }: { device: SmartDevice; onToggle: () => void; onBrightness: (value: number) => void; onBrightnessCommit: () => void; table?: boolean }) {
  return (
    <article className={`device-row ${table ? "is-table" : ""} ${device.isOn ? "is-on" : ""}`}>
      <div className="device-identity"><span className={`device-type-icon ${device.type}`}><DeviceGlyph type={device.type} /></span><span><b>{device.name}</b><small>{device.room} · {device.model}</small></span></div>
      <div className="device-state"><span className={`online-dot ${device.online ? "" : "offline"}`} />{device.online ? (device.type === "motion" ? `Hareket yok · ${device.lastEvent}` : device.type === "button" ? `Son basış ${device.lastEvent}` : device.isOn ? "Açık" : "Kapalı") : "Çevrimdışı"}</div>
      <div className="device-level">{device.type === "light" ? <>{device.isOn ? `%${device.brightness}` : "—"}</> : <><BatteryMedium size={17} /> %{device.battery}</>}</div>
      <div className="device-control">
        {device.type === "light" ? <Switch checked={Boolean(device.isOn)} onChange={onToggle} label={`${device.name} anahtarı`} /> : <button className="text-icon-button" aria-label={`${device.name} ayrıntıları`}><ChevronRight size={18} /></button>}
      </div>
      {device.type === "light" && device.isOn && (
        <div className="device-dimmer"><Sun size={15} /><input type="range" min="1" max="100" value={device.brightness} aria-label={`${device.name} parlaklık`} onChange={(event) => onBrightness(Number(event.target.value))} onPointerUp={onBrightnessCommit} style={{ "--range-progress": `${device.brightness}%` } as React.CSSProperties} /><b>%{device.brightness}</b></div>
      )}
      {device.automatedBy && <span className="automation-note"><WandSparkles size={13} /> {device.automatedBy} tarafından açık</span>}
    </article>
  );
}

function RulesView({ rules, devices, toggleRule, testRule, editRule, deleteRule }: { rules: AutomationRule[]; devices: SmartDevice[]; toggleRule: (id: string) => void; testRule: (rule: AutomationRule) => void; editRule: (rule: AutomationRule) => void; deleteRule: (rule: AutomationRule) => void }) {
  return (
    <div className="rules-layout">
      <section className="rules-list">
        {rules.map((rule) => {
          const TriggerIcon = rule.trigger.type === "motion" ? Footprints : rule.trigger.type === "button" ? MousePointerClick : Clock3;
          return (
            <article className={`rule-card ${rule.enabled ? "is-enabled" : ""}`} key={rule.id}>
              <span className="rule-icon"><TriggerIcon size={21} /></span>
              <div className="rule-copy"><div className="rule-title-row"><h3>{rule.name}</h3><span className={rule.enabled ? "status-pill active" : "status-pill"}>{rule.enabled ? "Çalışıyor" : "Duraklatıldı"}</span></div><p>{describeRule(rule, devices)}</p><div className="rule-meta"><span><Clock3 size={14} /> Son çalışma: {rule.lastRun || "Henüz çalışmadı"}</span><span><Zap size={14} /> {rule.runCount} kez</span></div></div>
              <div className="rule-actions"><Switch checked={rule.enabled} onChange={() => toggleRule(rule.id)} label={`${rule.name} durumunu değiştir`} /><button onClick={() => testRule(rule)} title="Kuralı test et"><Play size={17} /></button><button onClick={() => editRule(rule)} title="Kuralı düzenle"><Pencil size={17} /></button><button onClick={() => deleteRule(rule)} title="Kuralı sil" className="danger"><Trash2 size={17} /></button></div>
            </article>
          );
        })}
      </section>
      <aside className="rules-insight">
        <span className="insight-icon"><ShieldCheck size={24} /></span><h3>Kurallar evde çalışır</h3><p>Kuralların yerel köprüde saklanır. Panel kapalı olsa da köprü açık kaldığı sürece devam eder.</p><div><span><b>{rules.filter((rule) => rule.enabled).length}</b> etkin kural</span><span><b>{rules.reduce((sum, rule) => sum + rule.runCount, 0)}</b> toplam çalışma</span></div><button><Info size={16} /> Nasıl çalışır?</button>
      </aside>
    </div>
  );
}

function ActivityView({ timeline }: { timeline: TimelineEvent[] }) {
  return (
    <section className="panel activity-panel">
      <div className="activity-toolbar"><div><button className="active">Tümü</button><button>Işıklar</button><button>Sensörler</button><button>Kurallar</button></div><button className="secondary-button"><ListFilter size={16} /> Filtrele</button></div>
      <div className="date-divider"><span>BUGÜN</span><i /></div>
      <div className="timeline full">
        {timeline.map((event) => <TimelineRow event={event} key={event.id} />)}
        {!timeline.length && <EmptyState icon={Activity} title="Henüz olay yok" copy="DIRIGERA'dan gelen sensör, buton ve kural olayları burada görünecek." />}
      </div>
    </section>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon = event.kind === "motion" ? Footprints : event.kind === "button" ? MousePointerClick : event.kind === "rule" ? WandSparkles : event.kind === "system" ? Router : Lightbulb;
  return <div className="timeline-row"><time>{event.at}</time><span className={`timeline-icon ${event.kind}`}><Icon size={17} /></span><div><b>{event.title}</b><p>{event.detail}</p></div><button aria-label="Ayrıntılar"><ChevronRight size={17} /></button></div>;
}

function SettingsView({ mode, bridgeOnline, bridgeSettings, openConnection, useDemo }: { mode: "demo" | "bridge"; bridgeOnline: boolean; bridgeSettings: BridgeSettings; openConnection: () => void; useDemo: () => void }) {
  return (
    <div className="settings-grid">
      <section className="panel connection-card">
        <div className="settings-card-title"><span className={bridgeOnline ? "success" : ""}><Router size={22} /></span><div><h2>DIRIGERA bağlantısı</h2><p>Hub ve cihaz verileri yalnızca ev ağında kalır.</p></div></div>
        <div className="connection-state"><span className={`large-status ${mode === "demo" || bridgeOnline ? "online" : ""}`}><Wifi size={25} /></span><div><small>AKTİF KAYNAK</small><b>{mode === "demo" ? "Demo evi" : bridgeOnline ? "DIRIGERA · Çevrimiçi" : "DIRIGERA · Ulaşılamıyor"}</b><p>{mode === "demo" ? "Arayüz örnek cihazlarla çalışıyor." : bridgeSettings.url}</p></div></div>
        <div className="settings-actions"><button className="primary-button" onClick={openConnection}><Router size={17} /> {mode === "bridge" ? "Bağlantıyı düzenle" : "Gerçek eve bağlan"}</button>{mode === "bridge" && <button className="secondary-button" onClick={useDemo}>Demo moduna dön</button>}</div>
      </section>
      <section className="panel preference-card"><div className="settings-card-title"><span><Bell size={21} /></span><div><h2>Bildirimler</h2><p>Önemli durumları öne çıkar.</p></div></div><SettingRow title="Düşük pil uyarısı" copy="Pil %20 altına indiğinde" checked /><SettingRow title="Cihaz çevrimdışı" copy="10 dakikadan uzun sürerse" checked /><SettingRow title="Kural hataları" copy="Bir eylem tamamlanamazsa" checked /></section>
      <section className="panel preference-card"><div className="settings-card-title"><span><Clock3 size={21} /></span><div><h2>Ev ayarları</h2><p>Kurallarda kullanılan temel değerler.</p></div></div><div className="setting-value"><span><b>Saat dilimi</b><small>Gün doğumu ve saatli kurallar</small></span><button>Europe/Istanbul <ChevronRight size={16} /></button></div><div className="setting-value"><span><b>Düşük pil eşiği</b><small>Tüm pilli cihazlar için</small></span><button>%20 <ChevronRight size={16} /></button></div></section>
      <section className="security-note"><ShieldCheck size={24} /><div><b>Yerel kontrol, evde kalan veri</b><p>Hub erişim anahtarı web paneline gönderilmez; yerel köprüde saklanır. Panel yalnızca senin oluşturduğun bağlantı anahtarıyla konuşur.</p></div></section>
    </div>
  );
}

function SettingRow({ title, copy, checked }: { title: string; copy: string; checked: boolean }) {
  const [value, setValue] = useState(checked);
  return <div className="setting-row"><span><b>{title}</b><small>{copy}</small></span><Switch checked={value} onChange={() => setValue((current) => !current)} label={`${title} ayarı`} /></div>;
}

function RuleBuilder({ devices, initialRule, onClose, onSave, onTest }: { devices: SmartDevice[]; initialRule: AutomationRule | null; onClose: () => void; onSave: (rule: AutomationRule) => void; onTest: (rule: AutomationRule) => void }) {
  const sensors = devices.filter((device) => device.type === "motion");
  const buttons = devices.filter((device) => device.type === "button");
  const lights = devices.filter((device) => device.type === "light");
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initialRule?.name || "Yeni ev kuralı");
  const [triggerType, setTriggerType] = useState<TriggerType>(initialRule?.trigger.type || "motion");
  const [triggerDevice, setTriggerDevice] = useState(initialRule?.trigger.deviceId || sensors[0]?.id || buttons[0]?.id || "");
  const [clickPattern, setClickPattern] = useState<ClickPattern>(initialRule?.trigger.clickPattern || "singlePress");
  const [triggerTime, setTriggerTime] = useState(initialRule?.trigger.time || "20:00");
  const [startTime, setStartTime] = useState(initialRule?.conditions.startTime || "18:00");
  const [endTime, setEndTime] = useState(initialRule?.conditions.endTime || "06:00");
  const [days, setDays] = useState(initialRule?.conditions.days || allWeekDays);
  const [targetDevice, setTargetDevice] = useState(initialRule?.actions[0]?.deviceId || lights[0]?.id || "");
  const [actionOn, setActionOn] = useState(initialRule?.actions[0]?.isOn ?? true);
  const [brightness, setBrightnessValue] = useState(initialRule?.actions[0]?.brightness || 35);
  const [temperature, setTemperature] = useState(initialRule?.actions[0]?.temperature || 2700);
  const [offAfter, setOffAfter] = useState(initialRule?.offAfterSeconds ? Math.round(initialRule.offAfterSeconds / 60) : 2);
  const generatedId = useId();

  function selectTriggerType(nextType: TriggerType) {
    setTriggerType(nextType);
    const options = nextType === "motion" ? sensors : nextType === "button" ? buttons : [];
    if (options.length && !options.some((device) => device.id === triggerDevice)) {
      setTriggerDevice(options[0].id);
    }
  }

  const draft: AutomationRule = {
    id: initialRule?.id || `rule-${generatedId.replace(/:/g, "")}`,
    name,
    enabled: initialRule?.enabled ?? true,
    trigger: { type: triggerType, deviceId: triggerType === "time" ? undefined : triggerDevice, clickPattern: triggerType === "button" ? clickPattern : undefined, time: triggerType === "time" ? triggerTime : undefined },
    conditions: { startTime: triggerType === "time" ? undefined : startTime, endTime: triggerType === "time" ? undefined : endTime, days },
    actions: [{ deviceId: targetDevice, isOn: actionOn, brightness: actionOn ? brightness : undefined, temperature: actionOn ? temperature : undefined }],
    offAfterSeconds: actionOn && offAfter > 0 ? offAfter * 60 : undefined,
    lastRun: initialRule?.lastRun,
    runCount: initialRule?.runCount || 0,
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="rule-builder-title">
      <button className="modal-scrim" aria-label="Kapat" onClick={onClose} />
      <div className="rule-builder-modal">
        <header><div><span>KURAL OLUŞTURUCU</span><h2 id="rule-builder-title">{initialRule ? "Kuralı düzenle" : "Yeni bir akış kur"}</h2></div><button aria-label="Kapat" onClick={onClose}><X size={20} /></button></header>
        <div className="builder-progress">{["Tetikleyici", "Koşullar", "Eylem"].map((label, index) => <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>{label}</button>)}</div>
        <div className="builder-body">
          <div className="builder-form">
            {step === 1 && <>
              <label className="field"><span>Kuralın adı</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
              <fieldset><legend>Ne zaman çalışsın?</legend><div className="option-grid three">
                <button type="button" className={triggerType === "motion" ? "selected" : ""} onClick={() => selectTriggerType("motion")}><Footprints size={20} /><b>Hareket</b><small>Sensör algıladığında</small></button>
                <button type="button" className={triggerType === "button" ? "selected" : ""} onClick={() => selectTriggerType("button")}><MousePointerClick size={20} /><b>Buton</b><small>Basış türüne göre</small></button>
                <button type="button" className={triggerType === "time" ? "selected" : ""} onClick={() => selectTriggerType("time")}><Clock3 size={20} /><b>Saat</b><small>Belirli bir anda</small></button>
              </div></fieldset>
              {triggerType !== "time" ? <label className="field"><span>{triggerType === "motion" ? "Hareket sensörü" : "Buton"}</span><select value={triggerDevice} onChange={(event) => setTriggerDevice(event.target.value)}>{(triggerType === "motion" ? sensors : buttons).map((device) => <option key={device.id} value={device.id}>{device.name} · {device.room}</option>)}</select></label> : <label className="field"><span>Çalışma saati</span><input type="time" value={triggerTime} onChange={(event) => setTriggerTime(event.target.value)} /></label>}
              {triggerType === "button" && <label className="field"><span>Basış şekli</span><select value={clickPattern} onChange={(event) => setClickPattern(event.target.value as ClickPattern)}><option value="singlePress">Tek basış</option><option value="doublePress">Çift basış</option><option value="longPress">Uzun basış</option></select></label>}
            </>}
            {step === 2 && <>
              <div className="builder-section-heading"><span className="soft-icon"><Clock3 size={19} /></span><div><h3>Çalışma aralığı</h3><p>Kuralı günün uygun saatleriyle sınırla.</p></div></div>
              {triggerType !== "time" && <div className="time-pair"><label className="field"><span>Başlangıç</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><span>—</span><label className="field"><span>Bitiş</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>}
              <fieldset><legend>Hangi günler?</legend><div className="day-picker">{allWeekDays.map((day) => <button type="button" key={day} className={days.includes(day) ? "selected" : ""} onClick={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}>{weekDayLabels[day]}</button>)}</div></fieldset>
              <div className="condition-note"><Info size={17} /><p>Gece yarısını aşan saat aralıkları otomatik olarak ertesi güne devam eder.</p></div>
            </>}
            {step === 3 && <>
              <div className="builder-section-heading"><span className="soft-icon"><Lightbulb size={19} /></span><div><h3>Işık eylemi</h3><p>Tetiklendiğinde ne olacağını seç.</p></div></div>
              <label className="field"><span>Kontrol edilecek ışık</span><select value={targetDevice} onChange={(event) => setTargetDevice(event.target.value)}>{lights.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.room}</option>)}</select></label>
              <fieldset><legend>İşlem</legend><div className="segmented"><button type="button" className={actionOn ? "selected" : ""} onClick={() => setActionOn(true)}>Işığı aç</button><button type="button" className={!actionOn ? "selected" : ""} onClick={() => setActionOn(false)}>Işığı kapat</button></div></fieldset>
              {actionOn && <><label className="range-field"><span><b>Parlaklık</b><em>%{brightness}</em></span><input type="range" min="1" max="100" value={brightness} onChange={(event) => setBrightnessValue(Number(event.target.value))} style={{ "--range-progress": `${brightness}%` } as React.CSSProperties} /></label><label className="range-field temperature"><span><b>Renk sıcaklığı</b><em>{temperature}K</em></span><div><Moon size={15} /><input type="range" min="2200" max="4000" step="100" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} style={{ "--range-progress": `${((temperature - 2200) / 1800) * 100}%` } as React.CSSProperties} /><Sun size={15} /></div></label><label className="field"><span>Ne kadar sonra kapansın? (dakika)</span><input type="number" min="0" max="1440" value={offAfter} onChange={(event) => setOffAfter(Number(event.target.value))} /><small>0 seçersen elle kapatılana kadar açık kalır.</small></label></>}
            </>}
          </div>
          <aside className="rule-preview"><span className="preview-label">CANLI ÖZET</span><span className="preview-icon"><WandSparkles size={24} /></span><h3>{name || "İsimsiz kural"}</h3><p>{describeRule(draft, devices)}</p><div className="preview-flow"><span><b>1</b>{triggerType === "motion" ? "Hareket" : triggerType === "button" ? "Buton basışı" : triggerTime}</span><i /><span><b>2</b>{actionOn ? `%${brightness} ışık` : "Işığı kapat"}</span></div><button type="button" onClick={() => onTest(draft)}><Play size={16} /> Şimdi test et</button></aside>
        </div>
        <footer><button className="secondary-button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Vazgeç" : <><ArrowLeft size={16} /> Geri</>}</button>{step < 3 ? <button className="primary-button" onClick={() => setStep((current) => current + 1)}>Devam <ArrowRight size={16} /></button> : <button className="primary-button" onClick={() => onSave(draft)} disabled={!name.trim() || !targetDevice}><Save size={16} /> Kuralı kaydet</button>}</footer>
      </div>
    </div>
  );
}

function ConnectionModal({ settings, onClose, onConnect, onDemo }: { settings: BridgeSettings; onClose: () => void; onConnect: (settings: BridgeSettings, gatewayIP?: string) => Promise<void>; onDemo: () => void }) {
  const [url, setUrl] = useState(settings.url);
  const [key, setKey] = useState(settings.key);
  const [gatewayIP, setGatewayIP] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try { await onConnect({ url, key }, gatewayIP.trim() || undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : "Bağlantı kurulamadı"); } finally { setLoading(false); }
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="connection-title">
      <button className="modal-scrim" aria-label="Kapat" onClick={onClose} />
      <form className="connection-modal" onSubmit={submit}>
        <header><span className="connection-hero-icon"><Router size={25} /></span><button type="button" aria-label="Kapat" onClick={onClose}><X size={20} /></button></header>
        <span className="eyebrow">YEREL BAĞLANTI</span><h2 id="connection-title">Evinle tanıştıralım.</h2><p>Yuva köprüsü, web paneliyle DIRIGERA arasında ev ağında güvenli bir bağlantı kurar.</p>
        <label className="field"><span>Köprü adresi</span><div className="input-with-icon"><Wifi size={17} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8787" /></div></label>
        <label className="field"><span>Bağlantı anahtarı</span><div className="input-with-icon"><ShieldCheck size={17} /><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Köprü terminalinde görünen anahtar" /></div><small>DIRIGERA erişim tokenı değil; yalnızca Yuva köprüsünün ürettiği anahtar.</small></label>
        <label className="field"><span>DIRIGERA IP adresi <em>(isteğe bağlı)</em></span><div className="input-with-icon"><Router size={17} /><input value={gatewayIP} onChange={(event) => setGatewayIP(event.target.value)} placeholder="Örn. 192.168.1.24" /></div><small>Otomatik keşif çalışmazsa doldur. İlk eşleştirmede hub altındaki işlem düğmesine bas.</small></label>
        {error && <div className="form-error"><WifiOff size={17} />{error}</div>}
        <div className="connection-steps"><span><b>1</b><em>Yerel köprüyü çalıştır</em></span><i /><span><b>2</b><em>Anahtarı buraya gir</em></span><i /><span><b>3</b><em>Cihazları eşitle</em></span></div>
        <button className="primary-button wide" type="submit" disabled={loading || !url || !key}>{loading ? <><RefreshCw size={17} className="spin" /> Hub düğmesine bas; bağlanıyor…</> : <><Router size={17} /> Köprüye bağlan</>}</button>
        <button className="text-button" type="button" onClick={onDemo}>Şimdilik demo eviyle devam et</button>
      </form>
    </div>
  );
}
