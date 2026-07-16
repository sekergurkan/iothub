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
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = "home" | "rooms" | "devices" | "rules" | "activity" | "settings";
type DeviceType = "light" | "motion" | "button";
type TriggerType = "motion" | "occupancy" | "button" | "time";
type ClickPattern = "singlePress" | "doublePress" | "longPress";
type DeviceStateAttribute =
  | "isOn"
  | "isReachable"
  | "isDetected"
  | "lightLevel"
  | "batteryPercentage"
  | "colorTemperature";
type DeviceStateOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

type DeviceStateCondition = {
  deviceId: string;
  attribute: DeviceStateAttribute;
  operator: DeviceStateOperator;
  value: boolean | number;
};

type AutomationAction = {
  deviceId: string;
  isOn?: boolean;
  brightness?: number;
  temperature?: number;
  transitionTime?: number;
  offAfterSeconds?: number;
  attributes?: Record<string, unknown>;
};

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
  controlLabel?: string;
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
    isDetected?: boolean;
    days?: string[];
  };
  conditions: {
    startTime?: string;
    endTime?: string;
    days?: string[];
    deviceStates?: DeviceStateCondition[];
  };
  actions: AutomationAction[];
  offAfterSeconds?: number;
  cooldownSeconds?: number;
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
    isDetected?: boolean;
    isReachable?: boolean;
    relativePosition?: string[];
    switchLabel?: string;
    serialNumber?: string;
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

const stateAttributeLabels: Record<DeviceStateAttribute, string> = {
  isOn: "Açık / kapalı",
  isReachable: "Çevrimiçi",
  isDetected: "Hareket",
  lightLevel: "Parlaklık",
  batteryPercentage: "Pil seviyesi",
  colorTemperature: "Renk sıcaklığı",
};

const stateOperatorLabels: Record<DeviceStateOperator, string> = {
  equals: "eşitse",
  notEquals: "eşit değilse",
  greaterThan: "büyükse",
  greaterThanOrEqual: "en az ise",
  lessThan: "küçükse",
  lessThanOrEqual: "en fazla ise",
};

const numericStateAttributes = new Set<DeviceStateAttribute>([
  "lightLevel",
  "batteryPercentage",
  "colorTemperature",
]);

function mergedActionAttributes(action: AutomationAction) {
  const attributes = { ...(action.attributes || {}) };
  if (action.isOn !== undefined) attributes.isOn = action.isOn;
  if (action.brightness !== undefined) attributes.lightLevel = action.brightness;
  if (action.temperature !== undefined) attributes.colorTemperature = action.temperature;
  return attributes;
}

function actionSettingsSummary(action: AutomationAction) {
  const attributes = mergedActionAttributes(action);
  const details = [
    attributes.isOn === true ? "aç" : attributes.isOn === false ? "kapat" : "açık/kapalı durumunu koru",
    typeof attributes.lightLevel === "number" ? `%${attributes.lightLevel}` : null,
    typeof attributes.colorTemperature === "number" ? `${attributes.colorTemperature}K` : null,
    action.offAfterSeconds && attributes.isOn === true
      ? `${Math.round(action.offAfterSeconds / 60)} dk sonra kapat`
      : null,
    action.transitionTime !== undefined ? `${action.transitionTime / 1_000} sn geçiş` : null,
  ].filter(Boolean);
  return details.join(" · ");
}

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
      const position = device.attributes?.relativePosition?.[0]?.toLocaleLowerCase("tr-TR");
      const controlLabel =
        position === "top"
          ? "Üst tuş"
          : position === "bottom"
            ? "Alt tuş"
            : device.attributes?.switchLabel
              ? device.attributes.switchLabel.replace(/button\s*/i, "Tuş ").trim()
              : undefined;
      const sharedRoom = device.attributes?.serialNumber
        ? rawDevices.find(
            (candidate) =>
              candidate.room?.name &&
              candidate.attributes?.serialNumber === device.attributes?.serialNumber,
          )?.room?.name
        : undefined;
      const baseName = device.attributes?.customName || device.attributes?.model || "İsimsiz cihaz";
      return {
        id: device.id,
        name: type === "button" && controlLabel ? `${baseName} · ${controlLabel}` : baseName,
        room: device.room?.name || sharedRoom || "Odasız",
        type,
        model: device.attributes?.model || device.deviceType,
        online: device.isReachable !== false,
        battery: device.attributes?.batteryPercentage,
        isOn: type === "light" && typeof device.attributes?.isOn === "boolean" ? device.attributes.isOn : undefined,
        brightness: device.attributes?.lightLevel,
        temperature: device.attributes?.colorTemperature,
        lastEvent: device.lastSeen,
        controlLabel,
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
  if (rule.trigger.type === "motion" || rule.trigger.type === "occupancy") {
    trigger = `${triggerDevice || "Sensör"} ${rule.trigger.isDetected === false ? "hareket kesildiğinde" : "hareket algıladığında"}`;
  }
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

  const filters: string[] = [];
  const applicableDays = rule.conditions.days || rule.trigger.days;
  if (applicableDays?.length) {
    filters.push(applicableDays.map((day) => weekDayLabels[day] || day).join(", "));
  }
  if (rule.conditions.startTime && rule.conditions.endTime) {
    filters.push(`${rule.conditions.startTime}–${rule.conditions.endTime} arasında`);
  }
  if (rule.conditions.deviceStates?.length) {
    filters.push(`${rule.conditions.deviceStates.length} cihaz koşulu sağlandığında`);
  }

  const actions = rule.actions.map((action) => {
    const target = devices.find((device) => device.id === action.deviceId)?.name || "Seçili ışık";
    const attributes = mergedActionAttributes(action);
    if (attributes.isOn === false) return `${target} kapansın`;
    const details = [
      typeof attributes.lightLevel === "number" ? `%${attributes.lightLevel}` : null,
      typeof attributes.colorTemperature === "number" ? `${attributes.colorTemperature}K` : null,
    ].filter(Boolean);
    const autoOff = action.offAfterSeconds ?? rule.offAfterSeconds;
    const verb = attributes.isOn === true ? "açılsın" : "durumu korunarak ayarlansın";
    return `${target}${details.length ? ` ${details.join(" · ")}` : ""} ${verb}${autoOff && attributes.isOn === true ? `, ${Math.round(autoOff / 60)} dk sonra kapansın` : ""}`;
  });

  return `${trigger}${filters.length ? `; yalnızca ${filters.join(" ve ")}` : ""}. ${actions.join("; ")}.${rule.cooldownSeconds ? ` Yeniden çalışmadan önce ${Math.round(rule.cooldownSeconds / 60)} dk bekler.` : ""}`;
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
  const rulesRevisionRef = useRef(0);
  const pendingRuleWritesRef = useRef(0);
  const testOffTimersRef = useRef(new Map<string, number>());
  const toastTimerRef = useRef<number | null>(null);

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
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2800);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWelcome({ greeting: greeting(), date: nowLabel() });
      try {
        const legacy = window.localStorage.getItem("yuva-bridge-settings");
        const legacySettings = legacy ? (JSON.parse(legacy) as Partial<BridgeSettings>) : {};
        const url = window.localStorage.getItem("yuva-bridge-url") || legacySettings.url;
        const key = window.sessionStorage.getItem("yuva-bridge-key") || legacySettings.key;
        const savedMode = window.localStorage.getItem("yuva-connection-mode");
        if (url || key) setBridgeSettings((current) => ({ url: url || current.url, key: key || "" }));
        if (legacySettings.key) window.sessionStorage.setItem("yuva-bridge-key", legacySettings.key);
        if (key && savedMode !== "demo") setMode("bridge");
        window.localStorage.removeItem("yuva-bridge-settings");
      } catch {
        // Connection preferences are optional; the key remains session-scoped.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timers = testOffTimersRef.current;
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [mode, bridgeSettings.url, bridgeSettings.key]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const bridgeFetch = useCallback(
    (path: string, init?: RequestInit) => requestBridge(bridgeSettings, path, init),
    [bridgeSettings],
  );

  const syncBridge = useCallback(async (settingsOverride?: BridgeSettings) => {
    const settings = settingsOverride || bridgeSettings;
    if (!settings.key) return false;
    const rulesRevision = rulesRevisionRef.current;
    const status = await requestBridge(settings, "/api/status");
    if (!status.connected) throw new Error("DIRIGERA henüz eşleştirilmemiş");
    const home = await requestBridge(settings, "/api/home");
    const normalized = normalizeHome(home);
    setDevices(normalized);
    const [rulesResult, eventsPayload] = await Promise.all([
      requestBridge(settings, "/api/rules")
        .then((payload) => ({ ok: true as const, payload }))
        .catch(() => ({ ok: false as const, payload: null })),
      requestBridge(settings, "/api/events?limit=100").catch(() => ({ events: [] })),
    ]);
    const rulesPayload = rulesResult.payload;
    const bridgeRules = Array.isArray(rulesPayload) ? rulesPayload : Array.isArray(rulesPayload?.rules) ? rulesPayload.rules : null;
    if (
      rulesResult.ok &&
      bridgeRules &&
      rulesRevision === rulesRevisionRef.current &&
      pendingRuleWritesRef.current === 0
    ) {
      setRules(bridgeRules);
    }
    setTimeline(normalizeBridgeEvents(eventsPayload, normalized));
    setMode("bridge");
    setBridgeOnline(true);
    setLastSync("şimdi");
    return true;
  }, [bridgeSettings]);

  useEffect(() => {
    if (mode !== "bridge" || !bridgeSettings.key) return;
    const initialSync = window.setTimeout(() => {
      syncBridge().catch(() => setBridgeOnline(false));
    }, 0);
    const timer = window.setInterval(() => {
      syncBridge().catch(() => setBridgeOnline(false));
    }, 8000);
    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(timer);
    };
  }, [bridgeSettings.key, mode, syncBridge]);

  async function sendDeviceAttributes(id: string, attributes: Record<string, unknown>, transitionTime?: number) {
    if (mode !== "bridge") return;
    await bridgeFetch(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ attributes, ...(transitionTime !== undefined ? { transitionTime } : {}) }),
    });
  }

  async function sendLightAttributes(
    id: string,
    attributes: Record<string, unknown>,
    transitionTime?: number,
  ) {
    const remaining = { ...attributes };
    const isOn = typeof remaining.isOn === "boolean" ? remaining.isOn : undefined;
    delete remaining.isOn;
    const requests: Array<Record<string, unknown>> = [];
    if (isOn === true) requests.push({ isOn: true });
    for (const attribute of ["lightLevel", "colorTemperature"]) {
      if (remaining[attribute] !== undefined) {
        requests.push({ [attribute]: remaining[attribute] });
        delete remaining[attribute];
      }
    }
    if (Object.keys(remaining).length) requests.push(remaining);
    if (isOn === false) requests.push({ isOn: false });

    const failures: unknown[] = [];
    for (const request of requests) {
      try {
        await sendDeviceAttributes(id, request, transitionTime);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }

  function cancelTestOffTimer(deviceId: string) {
    const timer = testOffTimersRef.current.get(deviceId);
    if (timer !== undefined) window.clearTimeout(timer);
    testOffTimersRef.current.delete(deviceId);
  }

  function scheduleTestAutoOff(rule: AutomationRule, action: AutomationAction) {
    const attributes = mergedActionAttributes(action);
    const delay = action.offAfterSeconds ?? rule.offAfterSeconds;
    if (attributes.isOn !== true || !delay) return;
    cancelTestOffTimer(action.deviceId);
    const timer = window.setTimeout(() => {
      testOffTimersRef.current.delete(action.deviceId);
      setDevices((current) => current.map((device) =>
        device.id === action.deviceId ? { ...device, isOn: false } : device,
      ));
      sendLightAttributes(action.deviceId, { isOn: false }, action.transitionTime).catch(() => {
        showToast("Test otomatik kapatma komutu iletilemedi");
        syncBridge().catch(() => setBridgeOnline(false));
      });
    }, delay * 1_000);
    testOffTimersRef.current.set(action.deviceId, timer);
  }

  function toggleLight(id: string) {
    const device = devices.find((item) => item.id === id);
    if (!device || !device.online) return;
    cancelTestOffTimer(id);
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
    cancelTestOffTimer(id);
    setDevices((current) =>
      current.map((item) => (item.id === id ? { ...item, brightness, isOn: true } : item)),
    );
  }

  function commitBrightness(id: string, brightness: number) {
    sendLightAttributes(id, { isOn: true, lightLevel: brightness }).catch(() =>
      showToast("Parlaklık komutu iletilemedi"),
    );
  }

  function setAllLights(isOn: boolean) {
    for (const light of lights) cancelTestOffTimer(light.id);
    setDevices((current) => current.map((device) => (device.type === "light" ? { ...device, isOn } : device)));
    showToast(isOn ? "Tüm ışıklar açıldı" : "Evdeki tüm ışıklar kapatıldı");
    if (mode === "bridge") {
      Promise.all(lights.map((light) => sendDeviceAttributes(light.id, { isOn }))).catch(() =>
        showToast("Bazı ışıklara ulaşılamadı"),
      );
    }
  }

  function applyEveningScene() {
    for (const light of lights) cancelTestOffTimer(light.id);
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
      Promise.all(lights.map((light) => sendLightAttributes(light.id, attributesFor(light)))).catch(() =>
        showToast("Akşam modu bazı ışıklara iletilemedi"),
      );
    }
  }

  function toggleRoom(roomName: string) {
    const roomLights = lights.filter((device) => device.room === roomName);
    for (const light of roomLights) cancelTestOffTimer(light.id);
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

  async function saveRule(rule: AutomationRule) {
    const existing = rules.some((item) => item.id === rule.id);
    let savedRule = rule;
    if (mode === "bridge") {
      rulesRevisionRef.current += 1;
      pendingRuleWritesRef.current += 1;
      try {
        savedRule = await bridgeFetch(`/api/rules${existing ? `/${rule.id}` : ""}`, {
          method: existing ? "PUT" : "POST",
          body: JSON.stringify(rule),
        });
      } catch (error) {
        showToast(error instanceof Error ? `Kural kaydedilemedi: ${error.message}` : "Kural köprüye kaydedilemedi");
        return;
      } finally {
        pendingRuleWritesRef.current -= 1;
      }
    }
    setRules((current) => (existing ? current.map((item) => (item.id === rule.id ? savedRule : item)) : [savedRule, ...current]));
    setRuleModalOpen(false);
    setEditingRule(null);
    showToast(existing ? "Kural güncellendi" : "Yeni kural etkinleştirildi");
  }

  function toggleRule(id: string) {
    const target = rules.find((rule) => rule.id === id);
    if (!target) return;
    const updated = { ...target, enabled: !target.enabled };
    setRules((current) => current.map((rule) => (rule.id === id ? updated : rule)));
    showToast(updated.enabled ? "Kural etkin" : "Kural duraklatıldı");
    if (mode === "bridge") {
      rulesRevisionRef.current += 1;
      pendingRuleWritesRef.current += 1;
      bridgeFetch(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(updated) })
        .then((savedRule) => setRules((current) => current.map((rule) => (rule.id === id ? savedRule : rule))))
        .catch(() => {
          setRules((current) => current.map((rule) => (rule.id === id ? target : rule)));
          showToast("Kural durumu köprüye iletilemedi; önceki duruma dönüldü");
        })
        .finally(() => { pendingRuleWritesRef.current -= 1; });
    }
  }

  function testRule(rule: AutomationRule) {
    for (const action of rule.actions) cancelTestOffTimer(action.deviceId);
    setDevices((current) =>
      current.map((device) => {
        const action = rule.actions.find((item) => item.deviceId === device.id);
        const attributes = action ? mergedActionAttributes(action) : null;
        return action
          ? {
              ...device,
              ...(typeof attributes?.isOn === "boolean" ? { isOn: attributes.isOn } : {}),
              ...(typeof attributes?.lightLevel === "number" ? { brightness: attributes.lightLevel } : {}),
              ...(typeof attributes?.colorTemperature === "number" ? { temperature: attributes.colorTemperature } : {}),
            }
          : device;
      }),
    );
    showToast(`“${rule.name}” test edildi`);
    if (mode === "bridge") {
      Promise.allSettled(
        rule.actions.map((action) =>
          sendLightAttributes(
            action.deviceId,
            mergedActionAttributes(action),
            action.transitionTime,
          ),
        ),
      ).then((results) => {
        const failures = results.filter((result) => result.status === "rejected").length;
        results.forEach((result, index) => {
          if (
            result.status === "fulfilled" ||
            mergedActionAttributes(rule.actions[index]).isOn === true
          ) {
            scheduleTestAutoOff(rule, rule.actions[index]);
          }
        });
        if (failures) {
          showToast(`${failures} cihaz test komutunu tamamlayamadı`);
          syncBridge().catch(() => setBridgeOnline(false));
        }
      });
    } else {
      for (const action of rule.actions) scheduleTestAutoOff(rule, action);
    }
  }

  function deleteRule(rule: AutomationRule) {
    setRules((current) => current.filter((item) => item.id !== rule.id));
    showToast("Kural silindi");
    if (mode === "bridge") {
      rulesRevisionRef.current += 1;
      pendingRuleWritesRef.current += 1;
      bridgeFetch(`/api/rules/${rule.id}`, { method: "DELETE" }).catch(() => {
        setRules((current) => current.some((item) => item.id === rule.id) ? current : [rule, ...current]);
        showToast("Kural köprüden silinemedi; listeye geri alındı");
      }).finally(() => { pendingRuleWritesRef.current -= 1; });
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
                window.localStorage.setItem("yuva-connection-mode", "demo");
                setMode("demo");
                setBridgeOnline(false);
                setDevices(initialDevices);
                rulesRevisionRef.current += 1;
                setRules(initialRules);
                setTimeline(initialTimeline);
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
              window.localStorage.setItem("yuva-connection-mode", "bridge");
              setConnectionModalOpen(false);
              showToast("DIRIGERA köprüsüne bağlanıldı");
            } catch (error) {
              setBridgeOnline(false);
              throw error;
            }
          }}
          onDemo={() => {
            window.localStorage.setItem("yuva-connection-mode", "demo");
            setMode("demo");
            setBridgeOnline(false);
            setDevices(initialDevices);
            rulesRevisionRef.current += 1;
            setRules(initialRules);
            setTimeline(initialTimeline);
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
          const TriggerIcon = rule.trigger.type === "motion" || rule.trigger.type === "occupancy" ? Footprints : rule.trigger.type === "button" ? MousePointerClick : Clock3;
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

type ActionEditorState = {
  deviceId: string;
  isOn?: boolean;
  passthroughAttributes?: Record<string, unknown>;
  brightnessEnabled: boolean;
  brightness: number;
  temperatureEnabled: boolean;
  temperature: number;
  transitionEnabled: boolean;
  transitionSeconds: number;
  autoOffEnabled: boolean;
  autoOffMinutes: number;
};

type DeviceStateEditor = DeviceStateCondition & { editorId: string };

function stateAttributesForDevice(device: SmartDevice | undefined): DeviceStateAttribute[] {
  if (!device) return ["isReachable"];
  const attributes: DeviceStateAttribute[] = ["isReachable"];
  if (device.type === "light") {
    if (device.isOn !== undefined) attributes.unshift("isOn");
    if (device.brightness !== undefined) attributes.push("lightLevel");
    if (device.temperature !== undefined) attributes.push("colorTemperature");
  } else if (device.type === "motion") {
    attributes.unshift("isDetected");
    if (device.battery !== undefined) attributes.push("batteryPercentage");
  } else if (device.battery !== undefined) {
    attributes.unshift("batteryPercentage");
  }
  return attributes;
}

function defaultStateValue(attribute: DeviceStateAttribute): boolean | number {
  if (numericStateAttributes.has(attribute)) return attribute === "colorTemperature" ? 2700 : 50;
  return true;
}

function stateValueLabels(attribute: DeviceStateAttribute) {
  if (attribute === "isOn") return ["Açık", "Kapalı"];
  if (attribute === "isDetected") return ["Algılandı", "Algılanmadı"];
  return ["Çevrimiçi", "Çevrimdışı"];
}

function OptionalSetting({ enabled, title, copy, onToggle, children }: { enabled: boolean; title: string; copy: string; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <section className={`optional-setting ${enabled ? "is-enabled" : ""}`}>
      <div className="optional-setting-head">
        <span><b>{title}</b><small>{copy}</small></span>
        <Switch checked={enabled} onChange={onToggle} label={`${title} seçeneği`} />
      </div>
      {enabled && <div className="optional-setting-body">{children}</div>}
    </section>
  );
}

function RuleBuilder({ devices, initialRule, onClose, onSave, onTest }: { devices: SmartDevice[]; initialRule: AutomationRule | null; onClose: () => void; onSave: (rule: AutomationRule) => Promise<void>; onTest: (rule: AutomationRule) => void }) {
  const sensors = devices.filter((device) => device.type === "motion");
  const buttons = devices.filter((device) => device.type === "button");
  const lights = devices.filter((device) => device.type === "light");
  const [generatedId] = useState(() => `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initialRule?.name || "");
  const [enabled, setEnabled] = useState(initialRule?.enabled ?? true);
  const [triggerType, setTriggerType] = useState<TriggerType>(initialRule?.trigger.type === "occupancy" ? "motion" : initialRule?.trigger.type || "motion");
  const [triggerDevice, setTriggerDevice] = useState(initialRule?.trigger.deviceId || sensors[0]?.id || "");
  const [motionDetected, setMotionDetected] = useState(initialRule?.trigger.isDetected ?? true);
  const [clickPattern, setClickPattern] = useState<ClickPattern>(initialRule?.trigger.clickPattern || "singlePress");
  const [triggerTime, setTriggerTime] = useState(initialRule?.trigger.time || "20:00");
  const existingDays = initialRule?.conditions.days?.length ? initialRule.conditions.days : initialRule?.trigger.days;
  const [daysEnabled, setDaysEnabled] = useState(Boolean(existingDays?.length));
  const [days, setDays] = useState(existingDays?.length ? existingDays : allWeekDays);
  const [timeWindowEnabled, setTimeWindowEnabled] = useState(Boolean(initialRule?.conditions.startTime && initialRule?.conditions.endTime));
  const [startTime, setStartTime] = useState(initialRule?.conditions.startTime || "18:00");
  const [endTime, setEndTime] = useState(initialRule?.conditions.endTime || "06:00");
  const initialStateConditions = initialRule?.conditions.deviceStates || [];
  const [deviceConditionsEnabled, setDeviceConditionsEnabled] = useState(initialStateConditions.length > 0);
  const [deviceConditions, setDeviceConditions] = useState<DeviceStateEditor[]>(
    initialStateConditions.map((condition, index) => ({ ...condition, editorId: `existing-${index}` })),
  );
  const [cooldownEnabled, setCooldownEnabled] = useState(Boolean(initialRule?.cooldownSeconds));
  const [cooldownMinutes, setCooldownMinutes] = useState(initialRule?.cooldownSeconds ? Math.max(1, Math.round(initialRule.cooldownSeconds / 60)) : 1);
  const firstActionAttributes = initialRule?.actions[0] ? mergedActionAttributes(initialRule.actions[0]) : {};
  const [bulkOn, setBulkOn] = useState(typeof firstActionAttributes.isOn === "boolean" ? firstActionAttributes.isOn : true);
  const [bulkBrightnessEnabled, setBulkBrightnessEnabled] = useState(typeof firstActionAttributes.lightLevel === "number");
  const [bulkBrightness, setBulkBrightness] = useState(typeof firstActionAttributes.lightLevel === "number" ? firstActionAttributes.lightLevel : 30);
  const [bulkTemperatureEnabled, setBulkTemperatureEnabled] = useState(typeof firstActionAttributes.colorTemperature === "number");
  const [bulkTemperature, setBulkTemperature] = useState(typeof firstActionAttributes.colorTemperature === "number" ? firstActionAttributes.colorTemperature : 2700);
  const [bulkTransitionEnabled, setBulkTransitionEnabled] = useState(initialRule?.actions[0]?.transitionTime !== undefined);
  const [bulkTransitionSeconds, setBulkTransitionSeconds] = useState(initialRule?.actions[0]?.transitionTime !== undefined ? initialRule.actions[0].transitionTime / 1000 : 1);
  const firstAutoOff = initialRule?.actions[0]?.offAfterSeconds ?? initialRule?.offAfterSeconds;
  const [bulkAutoOffEnabled, setBulkAutoOffEnabled] = useState(firstAutoOff !== undefined);
  const [bulkAutoOffMinutes, setBulkAutoOffMinutes] = useState(firstAutoOff ? Math.max(1, Math.round(firstAutoOff / 60)) : 2);
  const [actionEditors, setActionEditors] = useState<ActionEditorState[]>(
    (initialRule?.actions || []).map((action) => {
      const actionAutoOff = action.offAfterSeconds ?? initialRule?.offAfterSeconds;
      const attributes = mergedActionAttributes(action);
      const passthroughAttributes = Object.fromEntries(
        Object.entries(action.attributes || {}).filter(
          ([key]) => !["isOn", "lightLevel", "colorTemperature"].includes(key),
        ),
      );
      const actionIsOn = typeof attributes.isOn === "boolean" ? attributes.isOn : undefined;
      return {
        deviceId: action.deviceId,
        isOn: actionIsOn,
        ...(Object.keys(passthroughAttributes).length ? { passthroughAttributes } : {}),
        brightnessEnabled: typeof attributes.lightLevel === "number",
        brightness: typeof attributes.lightLevel === "number" ? attributes.lightLevel : 30,
        temperatureEnabled: typeof attributes.colorTemperature === "number",
        temperature: typeof attributes.colorTemperature === "number" ? attributes.colorTemperature : 2700,
        transitionEnabled: action.transitionTime !== undefined,
        transitionSeconds: action.transitionTime !== undefined ? action.transitionTime / 1000 : 1,
        autoOffEnabled: actionAutoOff !== undefined,
        autoOffMinutes: actionAutoOff ? Math.max(1, Math.round(actionAutoOff / 60)) : 2,
      };
    }),
  );

  const createBulkAction = (deviceId: string): ActionEditorState => {
    const device = lights.find((light) => light.id === deviceId);
    return {
      deviceId,
      isOn: bulkOn,
      brightnessEnabled: bulkOn && bulkBrightnessEnabled && device?.brightness !== undefined,
      brightness: bulkBrightness,
      temperatureEnabled: bulkOn && bulkTemperatureEnabled && device?.temperature !== undefined,
      temperature: bulkTemperature,
      transitionEnabled: bulkTransitionEnabled,
      transitionSeconds: bulkTransitionSeconds,
      autoOffEnabled: bulkOn && bulkAutoOffEnabled,
      autoOffMinutes: bulkAutoOffMinutes,
    };
  };

  function selectTriggerType(nextType: TriggerType) {
    setTriggerType(nextType);
    const options = nextType === "motion" ? sensors : nextType === "button" ? buttons : [];
    if (nextType !== "time" && !options.some((device) => device.id === triggerDevice)) {
      setTriggerDevice(options[0]?.id || "");
    }
  }

  function toggleDay(day: string) {
    setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  }

  function toggleActionDevice(deviceId: string) {
    setActionEditors((current) => {
      if (current.some((action) => action.deviceId === deviceId)) return current.filter((action) => action.deviceId !== deviceId);
      if (current.length >= 32) return current;
      return [...current, createBulkAction(deviceId)];
    });
  }

  function selectAllLights() {
    setActionEditors((current) => {
      const lightIds = new Set(lights.map((light) => light.id));
      const preserved = current.filter((action) => !lightIds.has(action.deviceId));
      const allLightsSelected = lights.length > 0 && lights.every((light) =>
        current.some((action) => action.deviceId === light.id),
      );
      if (allLightsSelected) return preserved;
      const selectedLights = lights
        .slice(0, Math.max(0, 32 - preserved.length))
        .map((light) => current.find((action) => action.deviceId === light.id) || createBulkAction(light.id));
      return [...preserved, ...selectedLights];
    });
  }

  function selectRoomLights(room: string) {
    const roomLights = lights.filter((light) => light.room === room);
    const roomIds = new Set(roomLights.map((light) => light.id));
    setActionEditors((current) => {
      const allSelected = roomLights.length > 0 && roomLights.every((light) => current.some((action) => action.deviceId === light.id));
      if (allSelected) return current.filter((action) => !roomIds.has(action.deviceId));
      const existingIds = new Set(current.map((action) => action.deviceId));
      const additions = roomLights.filter((light) => !existingIds.has(light.id)).map((light) => createBulkAction(light.id));
      return [...current, ...additions].slice(0, 32);
    });
  }

  function updateAction(deviceId: string, patch: Partial<ActionEditorState>) {
    setActionEditors((current) => current.map((action) => action.deviceId === deviceId ? { ...action, ...patch } : action));
  }

  function applyBulkSettings() {
    setActionEditors((current) => current.map((action) =>
      lights.some((light) => light.id === action.deviceId)
        ? { ...action, ...createBulkAction(action.deviceId) }
        : action,
    ));
  }

  function makeDeviceCondition(): DeviceStateEditor {
    const device = devices[0];
    const attribute = stateAttributesForDevice(device)[0];
    return {
      editorId: `condition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      deviceId: device?.id || "",
      attribute,
      operator: "equals",
      value: defaultStateValue(attribute),
    };
  }

  function toggleDeviceConditions() {
    setDeviceConditionsEnabled((current) => {
      if (!current && deviceConditions.length === 0) setDeviceConditions([makeDeviceCondition()]);
      return !current;
    });
  }

  function updateDeviceCondition(editorId: string, patch: Partial<DeviceStateCondition>) {
    setDeviceConditions((current) => current.map((condition) => condition.editorId === editorId ? { ...condition, ...patch } : condition));
  }

  function changeConditionDevice(condition: DeviceStateEditor, deviceId: string) {
    const device = devices.find((item) => item.id === deviceId);
    const attributes = stateAttributesForDevice(device);
    const attribute = attributes.includes(condition.attribute) ? condition.attribute : attributes[0];
    updateDeviceCondition(condition.editorId, {
      deviceId,
      attribute,
      operator: numericStateAttributes.has(attribute) ? "greaterThanOrEqual" : "equals",
      value: defaultStateValue(attribute),
    });
  }

  function changeConditionAttribute(condition: DeviceStateEditor, attribute: DeviceStateAttribute) {
    updateDeviceCondition(condition.editorId, {
      attribute,
      operator: numericStateAttributes.has(attribute) ? "greaterThanOrEqual" : "equals",
      value: defaultStateValue(attribute),
    });
  }

  const actions: AutomationAction[] = actionEditors.map((action) => ({
    deviceId: action.deviceId,
    ...(action.isOn !== undefined ? { isOn: action.isOn } : {}),
    ...(action.passthroughAttributes && Object.keys(action.passthroughAttributes).length
      ? { attributes: action.passthroughAttributes }
      : {}),
    ...(action.isOn !== false && action.brightnessEnabled ? { brightness: Math.round(action.brightness) } : {}),
    ...(action.isOn !== false && action.temperatureEnabled ? { temperature: Math.round(action.temperature) } : {}),
    ...(action.transitionEnabled ? { transitionTime: Math.round(action.transitionSeconds * 1000) } : {}),
    ...(action.isOn && action.autoOffEnabled ? { offAfterSeconds: Math.round(action.autoOffMinutes * 60) } : {}),
  }));

  const draft: AutomationRule = {
    id: initialRule?.id || generatedId,
    name: name.trim(),
    enabled,
    trigger: {
      type: triggerType,
      ...(triggerType !== "time" ? { deviceId: triggerDevice } : {}),
      ...(triggerType === "motion" ? { isDetected: motionDetected } : {}),
      ...(triggerType === "button" ? { clickPattern } : {}),
      ...(triggerType === "time" ? { time: triggerTime } : {}),
    },
    conditions: {
      ...(daysEnabled && days.length ? { days } : {}),
      ...(timeWindowEnabled ? { startTime, endTime } : {}),
      ...(deviceConditionsEnabled && deviceConditions.length
        ? { deviceStates: deviceConditions.map((condition) => ({ deviceId: condition.deviceId, attribute: condition.attribute, operator: condition.operator, value: condition.value })) }
        : {}),
    },
    actions,
    ...(cooldownEnabled ? { cooldownSeconds: Math.round(cooldownMinutes * 60) } : {}),
    lastRun: initialRule?.lastRun,
    runCount: initialRule?.runCount ?? 0,
  };

  function errorsForStep(targetStep: number) {
    const errors: string[] = [];
    if (targetStep === 1) {
      if (!name.trim()) errors.push("Kuralın ne yaptığını anlatan bir ad yazmalısın.");
      if (name.trim().length > 120) errors.push("Kural adı 120 karakterden kısa olmalı.");
    }
    if (targetStep === 2) {
      if (triggerType === "motion" && !sensors.some((device) => device.id === triggerDevice)) errors.push("Bir hareket sensörü seçmelisin.");
      if (triggerType === "button" && !buttons.some((device) => device.id === triggerDevice)) errors.push("Bir buton veya tuş seçmelisin.");
      if (triggerType === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(triggerTime)) errors.push("Geçerli bir çalışma saati seçmelisin.");
    }
    if (targetStep === 3) {
      if (daysEnabled && days.length === 0) errors.push("Gün filtresi açıkken en az bir gün seçmelisin.");
      if (timeWindowEnabled && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) errors.push("Saat aralığının başlangıç ve bitişini seçmelisin.");
      if (deviceConditionsEnabled && deviceConditions.length === 0) errors.push("Cihaz koşulları açıkken en az bir koşul eklemelisin.");
      if (deviceConditionsEnabled && deviceConditions.length > 32) errors.push("Bir kurala en fazla 32 cihaz durumu koşulu ekleyebilirsin.");
      if (deviceConditionsEnabled && deviceConditions.some((condition) => !devices.some((device) => device.id === condition.deviceId))) errors.push("Her cihaz koşulu için geçerli bir cihaz seçmelisin.");
      if (deviceConditionsEnabled && deviceConditions.some((condition) => {
        const device = devices.find((item) => item.id === condition.deviceId);
        return !stateAttributesForDevice(device).includes(condition.attribute);
      })) errors.push("Bir cihaz koşulunda, seçilen cihazın desteklemediği bir özellik var.");
      if (deviceConditionsEnabled && deviceConditions.some((condition) => {
        if (typeof condition.value !== "number" || !Number.isFinite(condition.value)) return numericStateAttributes.has(condition.attribute);
        if (condition.attribute === "colorTemperature") return condition.value < 1500 || condition.value > 6500;
        if (condition.attribute === "lightLevel" || condition.attribute === "batteryPercentage") return condition.value < 0 || condition.value > 100;
        return false;
      })) errors.push("Cihaz koşullarında parlaklık/pil 0–100, renk sıcaklığı 1500K–6500K arasında olmalı.");
      if (cooldownEnabled && (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0 || cooldownMinutes > 1440)) errors.push("Bekleme süresi 1–1440 dakika arasında olmalı.");
    }
    if (targetStep === 4) {
      if (actionEditors.length === 0) errors.push("Kuralın çalıştıracağı en az bir ışık seçmelisin.");
      if (actionEditors.length > 32) errors.push("Bir kurala en fazla 32 cihaz ekleyebilirsin.");
      if (actionEditors.some((action) => action.isOn !== false && action.brightnessEnabled && (!Number.isFinite(action.brightness) || action.brightness < 1 || action.brightness > 100))) errors.push("Parlaklık değerleri %1–%100 arasında olmalı.");
      if (actionEditors.some((action) => action.isOn !== false && action.temperatureEnabled && (!Number.isFinite(action.temperature) || action.temperature < 1500 || action.temperature > 6500))) errors.push("Renk sıcaklığı 1500K–6500K arasında olmalı.");
      if (actionEditors.some((action) => action.transitionEnabled && (!Number.isFinite(action.transitionSeconds) || action.transitionSeconds < 0 || action.transitionSeconds > 600))) errors.push("Geçiş süresi 0–600 saniye arasında olmalı.");
      if (actionEditors.some((action) => action.isOn && action.autoOffEnabled && (!Number.isFinite(action.autoOffMinutes) || action.autoOffMinutes <= 0 || action.autoOffMinutes > 1440))) errors.push("Otomatik kapanma süresi 1–1440 dakika arasında olmalı.");
    }
    return errors;
  }

  const allErrors = [1, 2, 3, 4].flatMap(errorsForStep);
  const currentErrors = step === 5 ? allErrors : errorsForStep(step);
  const progressSteps = ["Temel bilgiler", "Tetikleyici", "Koşullar", "Eylemler", "Kontrol"];
  const triggerSummary = triggerType === "motion"
    ? `${devices.find((device) => device.id === triggerDevice)?.name || "Sensör"} · ${motionDetected ? "hareket algılandı" : "hareket sona erdi"}`
    : triggerType === "button"
      ? `${devices.find((device) => device.id === triggerDevice)?.name || "Buton"} · ${clickPattern === "doublePress" ? "çift basış" : clickPattern === "longPress" ? "uzun basış" : "tek basış"}`
      : `Her uygun gün saat ${triggerTime}`;

  async function submitRule() {
    if (saving || allErrors.length) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="rule-builder-title">
      <button className="modal-scrim" aria-label="Kural oluşturucuyu kapat" onClick={onClose} />
      <div className="rule-builder-modal advanced">
        <header>
          <div><span>DETAYLI OTOMASYON</span><h2 id="rule-builder-title">{initialRule ? "Kuralı düzenle" : "Yeni bir kural oluştur"}</h2></div>
          <button type="button" aria-label="Kapat" onClick={onClose}><X size={20} /></button>
        </header>
        <nav className="builder-progress" aria-label="Kural oluşturma adımları">
          {progressSteps.map((label, index) => {
            const number = index + 1;
            return <button type="button" key={label} disabled={number > step} className={step === number ? "active" : step > number ? "done" : ""} onClick={() => number <= step && setStep(number)}><span>{step > number ? <Check size={14} /> : number}</span>{label}</button>;
          })}
        </nav>
        <div className="builder-body">
          <div className="builder-form">
            {step === 1 && <>
              <div className="builder-section-heading"><span className="soft-icon"><Pencil size={19} /></span><div><h3>Kuralın temel bilgileri</h3><p>Sonradan kolayca bulabileceğin açıklayıcı bir ad ver.</p></div></div>
              <label className={`field ${!name.trim() ? "has-error" : ""}`}><span>Kural adı <em>zorunlu</em></span><input autoFocus maxLength={121} value={name} placeholder="Örn. Çalışma odası butonuyla tüm ışıkları yönet" onChange={(event) => setName(event.target.value)} /></label>
              <div className="builder-choice-row"><span><b>Kural kaydedildiğinde</b><small>İstersen kuralı duraklatılmış olarak hazırlayabilirsin.</small></span><div className="segmented"><button type="button" className={enabled ? "selected" : ""} onClick={() => setEnabled(true)}>Etkin</button><button type="button" className={!enabled ? "selected" : ""} onClick={() => setEnabled(false)}>Duraklat</button></div></div>
            </>}

            {step === 2 && <>
              <div className="builder-section-heading"><span className="soft-icon"><Zap size={19} /></span><div><h3>Kuralı ne başlatacak?</h3><p>Bir tetikleyici seç; ayrıntıları seçmeden ilerleyemezsin.</p></div></div>
              <fieldset><legend>Tetikleyici türü</legend><div className="option-grid three">
                <button type="button" className={triggerType === "motion" ? "selected" : ""} onClick={() => selectTriggerType("motion")}><Footprints size={20} /><b>Hareket</b><small>Algılandığında veya sona erdiğinde</small></button>
                <button type="button" className={triggerType === "button" ? "selected" : ""} onClick={() => selectTriggerType("button")}><MousePointerClick size={20} /><b>Buton</b><small>Tek, çift veya uzun basış</small></button>
                <button type="button" className={triggerType === "time" ? "selected" : ""} onClick={() => selectTriggerType("time")}><Clock3 size={20} /><b>Saat</b><small>Belirli bir yerel saatte</small></button>
              </div></fieldset>
              {triggerType === "motion" && <>
                <label className="field"><span>Hareket sensörü <em>zorunlu</em></span><select value={triggerDevice} onChange={(event) => setTriggerDevice(event.target.value)}><option value="">Sensör seç</option>{sensors.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.room}</option>)}</select></label>
                <fieldset><legend>Hangi değişiklikte?</legend><div className="segmented"><button type="button" className={motionDetected ? "selected" : ""} onClick={() => setMotionDetected(true)}>Hareket algılandı</button><button type="button" className={!motionDetected ? "selected" : ""} onClick={() => setMotionDetected(false)}>Hareket sona erdi</button></div></fieldset>
              </>}
              {triggerType === "button" && <div className="two-column-fields">
                <label className="field"><span>Buton / tuş <em>zorunlu</em></span><select value={triggerDevice} onChange={(event) => setTriggerDevice(event.target.value)}><option value="">Buton seç</option>{buttons.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.room}</option>)}</select></label>
                <label className="field"><span>Basış şekli <em>zorunlu</em></span><select value={clickPattern} onChange={(event) => setClickPattern(event.target.value as ClickPattern)}><option value="singlePress">Tek basış</option><option value="doublePress">Çift basış</option><option value="longPress">Uzun basış</option></select></label>
              </div>}
              {triggerType === "time" && <label className="field"><span>Çalışma saati <em>zorunlu</em></span><input type="time" value={triggerTime} onChange={(event) => setTriggerTime(event.target.value)} /><small>Günleri bir sonraki adımda isteğe bağlı olarak sınırlandırabilirsin.</small></label>}
              {!sensors.length && triggerType === "motion" && <div className="builder-error"><Info size={17} /><span>DIRIGERA’da kullanılabilir bir hareket sensörü bulunamadı.</span></div>}
              {!buttons.length && triggerType === "button" && <div className="builder-error"><Info size={17} /><span>DIRIGERA’da kullanılabilir bir buton bulunamadı.</span></div>}
            </>}

            {step === 3 && <>
              <div className="builder-section-heading"><span className="soft-icon"><ListFilter size={19} /></span><div><h3>İsteğe bağlı koşullar</h3><p>Yalnızca açtığın koşullar kural JSON’una eklenir.</p></div></div>
              <div className="optional-settings-list">
                <OptionalSetting enabled={daysEnabled} title="Gün filtresi" copy="Kural yalnızca seçtiğin günlerde çalışsın." onToggle={() => { setDaysEnabled((current) => !current); if (!days.length) setDays(allWeekDays); }}>
                  <fieldset><legend>Geçerli günler <em>en az bir</em></legend><div className="day-picker">{allWeekDays.map((day) => <button type="button" key={day} className={days.includes(day) ? "selected" : ""} onClick={() => toggleDay(day)}>{weekDayLabels[day]}</button>)}</div></fieldset>
                </OptionalSetting>
                <OptionalSetting enabled={timeWindowEnabled} title="Saat aralığı" copy="Tetikleyici gelse bile yalnızca bu aralıkta çalışsın." onToggle={() => setTimeWindowEnabled((current) => !current)}>
                  <div className="time-pair"><label className="field"><span>Başlangıç</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><span>—</span><label className="field"><span>Bitiş</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>
                  <div className="condition-note"><Info size={17} /><p>Örn. 22:00–06:00 aralığı gece yarısından sonra ertesi güne devam eder.</p></div>
                </OptionalSetting>
                <OptionalSetting enabled={cooldownEnabled} title="Tekrar çalışma beklemesi" copy="Peş peşe gelen olaylarda aynı kuralın çok sık çalışmasını önle." onToggle={() => setCooldownEnabled((current) => !current)}>
                  <label className="field compact-number"><span>Bekleme süresi</span><div><input type="number" min="1" max="1440" value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Number(event.target.value))} /><em>dakika</em></div></label>
                </OptionalSetting>
                <OptionalSetting enabled={deviceConditionsEnabled} title="Cihaz durumu koşulları" copy="Tüm satırlar doğruysa eylemleri çalıştır." onToggle={toggleDeviceConditions}>
                  <div className="device-condition-list">
                    {deviceConditions.map((condition, index) => {
                      const device = devices.find((item) => item.id === condition.deviceId);
                      const attributes = stateAttributesForDevice(device);
                      const isNumeric = numericStateAttributes.has(condition.attribute);
                      const [trueLabel, falseLabel] = stateValueLabels(condition.attribute);
                      return <article className="device-condition-row" key={condition.editorId}>
                        <span className="condition-index">VE {index + 1}</span>
                        <label><span>Cihaz</span><select value={condition.deviceId} onChange={(event) => changeConditionDevice(condition, event.target.value)}><option value="">Cihaz seç</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.room}</option>)}</select></label>
                        <label><span>Özellik</span><select value={condition.attribute} onChange={(event) => changeConditionAttribute(condition, event.target.value as DeviceStateAttribute)}>{attributes.map((attribute) => <option key={attribute} value={attribute}>{stateAttributeLabels[attribute]}</option>)}</select></label>
                        <label><span>Karşılaştırma</span><select value={condition.operator} onChange={(event) => updateDeviceCondition(condition.editorId, { operator: event.target.value as DeviceStateOperator })}>{(isNumeric ? Object.keys(stateOperatorLabels) : ["equals", "notEquals"]).map((operator) => <option key={operator} value={operator}>{stateOperatorLabels[operator as DeviceStateOperator]}</option>)}</select></label>
                        <label><span>Değer</span>{isNumeric ? <input type="number" min={condition.attribute === "colorTemperature" ? 1500 : 0} max={condition.attribute === "colorTemperature" ? 6500 : 100} value={condition.value as number} onChange={(event) => updateDeviceCondition(condition.editorId, { value: Number(event.target.value) })} /> : <select value={String(condition.value)} onChange={(event) => updateDeviceCondition(condition.editorId, { value: event.target.value === "true" })}><option value="true">{trueLabel}</option><option value="false">{falseLabel}</option></select>}</label>
                        <button type="button" aria-label={`${index + 1}. koşulu sil`} onClick={() => setDeviceConditions((current) => current.filter((item) => item.editorId !== condition.editorId))}><Trash2 size={16} /></button>
                      </article>;
                    })}
                    <button type="button" className="add-condition-button" disabled={!devices.length || deviceConditions.length >= 32} onClick={() => setDeviceConditions((current) => [...current, makeDeviceCondition()])}><Plus size={16} /> Koşul ekle {deviceConditions.length > 0 ? `(${deviceConditions.length}/32)` : ""}</button>
                  </div>
                </OptionalSetting>
              </div>
            </>}

            {step === 4 && <>
              <div className="builder-section-heading"><span className="soft-icon"><Lightbulb size={19} /></span><div><h3>Bir veya daha fazla ışığı yönet</h3><p>Önce hedefleri seç, toplu ayarı uygula; gerekirse her ışığı ayrı özelleştir.</p></div></div>
              <section className="target-picker">
                <div className="target-picker-head"><span><b>Hedef cihazlar</b><small>{actionEditors.length} ışık seçili · en az bir seçim gerekli</small></span><button type="button" onClick={selectAllLights}>{actionEditors.length === lights.length && lights.length ? "Seçimi temizle" : "Tüm ışıkları seç"}</button></div>
                <div className="target-room-actions"><span>Odaya göre:</span>{Array.from(new Set(lights.map((light) => light.room))).map((room) => { const roomLights = lights.filter((light) => light.room === room); const roomSelected = roomLights.length > 0 && roomLights.every((light) => actionEditors.some((action) => action.deviceId === light.id)); return <button type="button" key={room} className={roomSelected ? "selected" : ""} onClick={() => selectRoomLights(room)}>{room} <small>{roomLights.length}</small></button>; })}</div>
                <div className="target-device-grid">{lights.map((light) => {
                  const selected = actionEditors.some((action) => action.deviceId === light.id);
                  return <button type="button" key={light.id} className={selected ? "selected" : ""} onClick={() => toggleActionDevice(light.id)}><span className="target-check">{selected && <Check size={14} />}</span><span><b>{light.name}</b><small>{light.room} · {light.online ? "çevrimiçi" : "çevrimdışı"}</small></span></button>;
                })}</div>
                {!lights.length && <div className="builder-empty"><Lightbulb size={20} /><span>Kontrol edilebilir bir ışık bulunamadı.</span></div>}
              </section>
              <section className="bulk-action-card">
                <div className="bulk-action-title"><span><b>Toplu eylem ayarı</b><small>Parlaklık ve sıcaklık yalnızca destekleyen ışıklara uygulanır; kartlarda ayrı ayrı değiştirebilirsin.</small></span><div className="segmented"><button type="button" className={bulkOn ? "selected" : ""} onClick={() => setBulkOn(true)}>Aç</button><button type="button" className={!bulkOn ? "selected" : ""} onClick={() => setBulkOn(false)}>Kapat</button></div></div>
                <div className="bulk-options">
                  <label className={!bulkOn ? "is-disabled" : ""}><input type="checkbox" checked={bulkOn && bulkBrightnessEnabled} disabled={!bulkOn} onChange={(event) => setBulkBrightnessEnabled(event.target.checked)} /><span>Parlaklık</span>{bulkOn && bulkBrightnessEnabled && <input type="number" min="1" max="100" value={bulkBrightness} onChange={(event) => setBulkBrightness(Number(event.target.value))} />}{bulkOn && bulkBrightnessEnabled && <em>%</em>}</label>
                  <label className={!bulkOn ? "is-disabled" : ""}><input type="checkbox" checked={bulkOn && bulkTemperatureEnabled} disabled={!bulkOn} onChange={(event) => setBulkTemperatureEnabled(event.target.checked)} /><span>Renk sıcaklığı</span>{bulkOn && bulkTemperatureEnabled && <input type="number" min="1500" max="6500" step="100" value={bulkTemperature} onChange={(event) => setBulkTemperature(Number(event.target.value))} />}{bulkOn && bulkTemperatureEnabled && <em>K</em>}</label>
                  <label><input type="checkbox" checked={bulkTransitionEnabled} onChange={(event) => setBulkTransitionEnabled(event.target.checked)} /><span>Yumuşak geçiş</span>{bulkTransitionEnabled && <input type="number" min="0" max="600" value={bulkTransitionSeconds} onChange={(event) => setBulkTransitionSeconds(Number(event.target.value))} />}{bulkTransitionEnabled && <em>sn</em>}</label>
                  <label className={!bulkOn ? "is-disabled" : ""}><input type="checkbox" checked={bulkOn && bulkAutoOffEnabled} disabled={!bulkOn} onChange={(event) => setBulkAutoOffEnabled(event.target.checked)} /><span>Otomatik kapat</span>{bulkOn && bulkAutoOffEnabled && <input type="number" min="1" max="1440" value={bulkAutoOffMinutes} onChange={(event) => setBulkAutoOffMinutes(Number(event.target.value))} />}{bulkOn && bulkAutoOffEnabled && <em>dk</em>}</label>
                </div>
                <button type="button" className="apply-bulk-button" disabled={!actionEditors.length} onClick={applyBulkSettings}><Sparkles size={16} /> Toplu ayarı {actionEditors.length || 0} cihaza uygula</button>
              </section>
              <div className="device-action-list">
                {actionEditors.map((action) => {
                  const device = devices.find((item) => item.id === action.deviceId);
                  return <article className="device-action-card" key={action.deviceId}>
                    <header><span className="device-type-icon light"><Lightbulb size={18} /></span><span><b>{device?.name || "Bilinmeyen ışık"}</b><small>{device?.room || "Odasız"} · bu cihaza özel ayarlar</small></span><button type="button" aria-label={`${device?.name || "Işık"} eylemini kaldır`} onClick={() => toggleActionDevice(action.deviceId)}><X size={16} /></button></header>
                    {!device && <p className="action-advanced-note">Bu hedef mevcut panel cihaz listesinde görünmüyor. Eylem birebir korunur; istersen kartı kaldırabilirsin.</p>}
                    <div className="device-action-mode segmented three"><button type="button" className={action.isOn === true ? "selected" : ""} onClick={() => updateAction(action.deviceId, { isOn: true })}>Aç</button><button type="button" className={action.isOn === false ? "selected" : ""} onClick={() => updateAction(action.deviceId, { isOn: false })}>Kapat</button><button type="button" className={action.isOn === undefined ? "selected" : ""} onClick={() => updateAction(action.deviceId, { isOn: undefined, autoOffEnabled: false })}>Durumu koru</button></div>
                    {action.passthroughAttributes && <p className="action-advanced-note">{Object.keys(action.passthroughAttributes).length} gelişmiş DIRIGERA özniteliği değiştirilmeden korunacak.</p>}
                    <div className="device-action-options">
                      {action.isOn !== false && (device?.brightness !== undefined || action.brightnessEnabled) && <OptionalSetting enabled={action.brightnessEnabled} title="Parlaklık" copy="Seçilmezse mevcut parlaklık korunur." onToggle={() => updateAction(action.deviceId, { brightnessEnabled: !action.brightnessEnabled })}><label className="range-field"><span><b>Parlaklık</b><em>%{action.brightness}</em></span><input type="range" min="1" max="100" value={action.brightness} onChange={(event) => updateAction(action.deviceId, { brightness: Number(event.target.value) })} style={{ "--range-progress": `${action.brightness}%` } as React.CSSProperties} /></label></OptionalSetting>}
                      {action.isOn !== false && (device?.temperature !== undefined || action.temperatureEnabled) && <OptionalSetting enabled={action.temperatureEnabled} title="Renk sıcaklığı" copy="Seçilmezse mevcut renk sıcaklığı korunur." onToggle={() => updateAction(action.deviceId, { temperatureEnabled: !action.temperatureEnabled })}><label className="range-field temperature"><span><b>Sıcaklık</b><em>{action.temperature}K</em></span><div><Moon size={15} /><input type="range" min="1500" max="6500" step="100" value={action.temperature} onChange={(event) => updateAction(action.deviceId, { temperature: Number(event.target.value) })} style={{ "--range-progress": `${((action.temperature - 1500) / 5000) * 100}%` } as React.CSSProperties} /><Sun size={15} /></div></label></OptionalSetting>}
                      <OptionalSetting enabled={action.transitionEnabled} title="Yumuşak geçiş" copy="Komutu aniden değil, seçilen sürede uygula." onToggle={() => updateAction(action.deviceId, { transitionEnabled: !action.transitionEnabled })}><label className="field compact-number"><span>Geçiş süresi</span><div><input type="number" min="0" max="600" value={action.transitionSeconds} onChange={(event) => updateAction(action.deviceId, { transitionSeconds: Number(event.target.value) })} /><em>saniye</em></div></label></OptionalSetting>
                      {action.isOn && <OptionalSetting enabled={action.autoOffEnabled} title="Otomatik kapat" copy="Bu ışığı açıldıktan sonra otomatik kapat." onToggle={() => updateAction(action.deviceId, { autoOffEnabled: !action.autoOffEnabled })}><label className="field compact-number"><span>Açık kalma süresi</span><div><input type="number" min="1" max="1440" value={action.autoOffMinutes} onChange={(event) => updateAction(action.deviceId, { autoOffMinutes: Number(event.target.value) })} /><em>dakika</em></div></label></OptionalSetting>}
                    </div>
                    {action.isOn === false && <p className="action-off-note">Kapatma eyleminde parlaklık, renk sıcaklığı ve otomatik kapanma gönderilmez. İstersen yalnızca geçiş süresi ekleyebilirsin.</p>}
                  </article>;
                })}
              </div>
            </>}

            {step === 5 && <>
              <div className="builder-section-heading"><span className="soft-icon"><ShieldCheck size={19} /></span><div><h3>Kaydetmeden önce kontrol et</h3><p>Yalnızca seçtiğin tetikleyici, koşul ve seçenekler köprüye gönderilecek.</p></div></div>
              <div className="review-stack">
                <section><span className="review-number">1</span><div><small>TETİKLEYİCİ</small><b>{triggerSummary}</b></div><button type="button" onClick={() => setStep(2)}>Düzenle</button></section>
                <section><span className="review-number">2</span><div><small>KOŞULLAR</small><b>{!daysEnabled && !timeWindowEnabled && !cooldownEnabled && !deviceConditionsEnabled ? "Ek koşul yok · her uygun tetiklemede çalışır" : [daysEnabled ? `${days.length} gün` : null, timeWindowEnabled ? `${startTime}–${endTime}` : null, deviceConditionsEnabled ? `${deviceConditions.length} cihaz durumu` : null, cooldownEnabled ? `${cooldownMinutes} dk bekleme` : null].filter(Boolean).join(" · ")}</b></div><button type="button" onClick={() => setStep(3)}>Düzenle</button></section>
                <section><span className="review-number">3</span><div><small>EYLEMLER</small><b>{actions.length} ışık yönetilecek</b><ul>{actions.map((action) => { const device = devices.find((item) => item.id === action.deviceId); return <li key={action.deviceId}>{device?.name || "Işık"}: {actionSettingsSummary(action)}</li>; })}</ul></div><button type="button" onClick={() => setStep(4)}>Düzenle</button></section>
              </div>
              <div className={`review-status ${allErrors.length ? "has-errors" : "is-ready"}`}>{allErrors.length ? <><Info size={18} /><div><b>Kural henüz kaydedilemiyor</b><p>{allErrors[0]}</p></div></> : <><Check size={18} /><div><b>Kural hazır</b><p>{enabled ? "Kaydettiğinde hemen etkinleşecek." : "Duraklatılmış olarak kaydedilecek."}</p></div></>}</div>
              <pre className="json-preview" aria-label="Kaydedilecek kural seçenekleri">{JSON.stringify(draft, null, 2)}</pre>
            </>}

            {currentErrors.length > 0 && step !== 5 && <div className="builder-error" role="alert"><Info size={17} /><div><b>Bu adımı tamamla</b><ul>{currentErrors.map((error) => <li key={error}>{error}</li>)}</ul></div></div>}
          </div>
          <aside className="rule-preview"><span className="preview-label">CANLI ÖZET</span><span className="preview-icon"><WandSparkles size={24} /></span><h3>{name.trim() || "İsimsiz kural"}</h3><p>{actionEditors.length ? describeRule(draft, devices) : `${triggerSummary}. Henüz bir eylem seçilmedi.`}</p><div className="preview-flow"><span><b>1</b>{triggerType === "motion" ? "Hareket" : triggerType === "button" ? "Buton" : triggerTime}</span><i /><span><b>2</b>{actionEditors.length ? `${actionEditors.length} cihaz` : "Eylem yok"}</span></div><button type="button" disabled={allErrors.length > 0 || saving} onClick={() => onTest(draft)}><Play size={16} /> Şimdi test et</button></aside>
        </div>
        <footer><button type="button" className="secondary-button" disabled={saving} onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Vazgeç" : <><ArrowLeft size={16} /> Geri</>}</button>{step < 5 ? <button type="button" className="primary-button" disabled={currentErrors.length > 0 || saving} onClick={() => setStep((current) => current + 1)}>Devam <ArrowRight size={16} /></button> : <button type="button" className="primary-button" onClick={submitRule} disabled={allErrors.length > 0 || saving}><Save size={16} /> {saving ? "Kaydediliyor…" : initialRule ? "Değişiklikleri kaydet" : "Kuralı kaydet"}</button>}</footer>
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
