"use client";

import { useAppStore, type QuestData } from "@/lib/store";
import { GUILD_INVITE_URL, REQUIRED_GUILD_ID } from "@/lib/guildConfig";
import { buildDiscordHeaders } from "@/lib/deviceIdentity";
import { enrollQuestBrowser } from "@/lib/questActions";
import { Button } from "@/components/ui/button";
import { MotionSection } from "@/components/discord/MotionSection";
import {
  Trophy, Video,
  Gamepad2, ExternalLink, ListFilter,
  Zap, Loader2, ShieldCheck, Users,
  EyeOff, Lock,
} from "lucide-react";
import { useEffect, useState, useRef, useCallback, memo, useSyncExternalStore } from "react";
import { motion } from "framer-motion";

/* ─── Reuse helpers from Dashboard ─── */
const STATUS_COLORS = {
  available: "#8A8F98",
  enrolled: "#8A8F98",
  running: "#F5B544",
  completed: "#3DD68C",
  unclaimed: "#38BDF8",
  claimed: "#3DD68C",
  expired: "#F6606F",
  failed: "#F6606F",
} as const;

const FILTER_COLORS = {
  all: "#E4E6EB",
  video: "#F5B544",
  game: "#5BC0EB",
} as const;

const TYPE_COLORS = {
  video: "#F5B544",
  game: "#5BC0EB",
  activity: "#3DD68C",
  stream: "#E879F9",
  achievement: "#F5B544",
} as const;

function getStatusColor(status: string, isClaimed?: boolean): string {
  if (status === "completed" && !isClaimed) return STATUS_COLORS.unclaimed;
  if (status === "completed" && isClaimed) return STATUS_COLORS.claimed;
  return (STATUS_COLORS as Record<string, string>)[status] ?? "#8A8F98";
}

function getQuestTypeLabel(type: string) {
  switch (type) {
    case "WATCH_VIDEO": return "Video";
    case "WATCH_VIDEO_ON_MOBILE": return "Video";
    case "PLAY_ON_DESKTOP": return "Game";
    case "PLAY_ON_XBOX": return "Game";
    case "PLAY_ON_PLAYSTATION": return "Game";
    case "PLAY_ACTIVITY": return "Activity";
    case "STREAM_ON_DESKTOP": return "Stream";
    case "ACHIEVEMENT_IN_ACTIVITY": return "Achievement";
    case "UNKNOWN": return "Khác";
    default: return "Khác";
  }
}

function getQuestTypeColor(type: string): string {
  if (type.startsWith("WATCH_VIDEO")) return TYPE_COLORS.video;
  if (type === "STREAM_ON_DESKTOP") return TYPE_COLORS.stream;
  if (type === "PLAY_ACTIVITY") return TYPE_COLORS.activity;
  if (type === "ACHIEVEMENT_IN_ACTIVITY") return TYPE_COLORS.achievement;
  return TYPE_COLORS.game;
}

function isVideoType(type: string) {
  return type === "WATCH_VIDEO" || type === "WATCH_VIDEO_ON_MOBILE" || type === "STREAM_ON_DESKTOP";
}

/* ─── Country code aliases: UK ↔ GB là cùng 1 quốc gia ─── */
const CC_ALIASES: Record<string, string> = { UK: "GB" };

/* ─── Region code → Flag emoji via Unicode regional indicator ─── */
function countryCodeToFlag(code: string): string {
  const c = CC_ALIASES[code.toUpperCase()] || code.toUpperCase();
  if (!c || c.length !== 2) return "🏳️";
  const base = 0x1F1E6 - 65;
  const c1 = c.charCodeAt(0);
  const c2 = c.charCodeAt(1);
  if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return "🏳️";
  return String.fromCodePoint(c1 + base) + String.fromCodePoint(c2 + base);
}

/* ─── Country code → full name (ISO 3166-1) ─── */
const COUNTRY_NAMES: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AD: "Andorra", AO: "Angola",
  AG: "Antigua and Barbuda", AR: "Argentina", AM: "Armenia", AU: "Australia",
  AT: "Austria", AZ: "Azerbaijan", BS: "Bahamas", BH: "Bahrain", BD: "Bangladesh",
  BB: "Barbados", BY: "Belarus", BE: "Belgium", BZ: "Belize", BJ: "Benin",
  BT: "Bhutan", BO: "Bolivia", BA: "Bosnia and Herzegovina", BW: "Botswana",
  BR: "Brazil", BN: "Brunei", BG: "Bulgaria", BF: "Burkina Faso", BI: "Burundi",
  KH: "Cambodia", CM: "Cameroon", CA: "Canada", CV: "Cape Verde", CF: "Central African Republic",
  TD: "Chad", CL: "Chile", CN: "China", CO: "Colombia", KM: "Comoros",
  CG: "Congo", CD: "Congo (DRC)", CR: "Costa Rica", CI: "Côte d'Ivoire", HR: "Croatia",
  CU: "Cuba", CY: "Cyprus", CZ: "Czech Republic", DK: "Denmark", DJ: "Djibouti",
  DM: "Dominica", DO: "Dominican Republic", EC: "Ecuador", EG: "Egypt", SV: "El Salvador",
  GQ: "Equatorial Guinea", ER: "Eritrea", EE: "Estonia", SZ: "Eswatini", ET: "Ethiopia",
  FJ: "Fiji", FI: "Finland", FR: "France", GA: "Gabon", GM: "Gambia",
  GE: "Georgia", DE: "Germany", GH: "Ghana", GR: "Greece", GD: "Grenada",
  GT: "Guatemala", GN: "Guinea", GW: "Guinea-Bissau", GY: "Guyana", HT: "Haiti",
  HN: "Honduras", HU: "Hungary", IS: "Iceland", IN: "India", ID: "Indonesia",
  IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel", IT: "Italy",
  JM: "Jamaica", JP: "Japan", JO: "Jordan", KZ: "Kazakhstan", KE: "Kenya",
  KI: "Kiribati", KP: "North Korea", KR: "South Korea", KW: "Kuwait", KG: "Kyrgyzstan",
  LA: "Laos", LV: "Latvia", LB: "Lebanon", LS: "Lesotho", LR: "Liberia",
  LY: "Libya", LI: "Liechtenstein", LT: "Lithuania", LU: "Luxembourg", MG: "Madagascar",
  MW: "Malawi", MY: "Malaysia", MV: "Maldives", ML: "Mali", MT: "Malta",
  MH: "Marshall Islands", MR: "Mauritania", MU: "Mauritius", MX: "Mexico",
  FM: "Micronesia", MD: "Moldova", MC: "Monaco", MN: "Mongolia", ME: "Montenegro",
  MA: "Morocco", MZ: "Mozambique", MM: "Myanmar", NA: "Namibia", NR: "Nauru",
  NP: "Nepal", NL: "Netherlands", NZ: "New Zealand", NI: "Nicaragua", NE: "Niger",
  NG: "Nigeria", MK: "North Macedonia", NO: "Norway", OM: "Oman", PK: "Pakistan",
  PW: "Palau", PS: "Palestine", PA: "Panama", PG: "Papua New Guinea", PY: "Paraguay",
  PE: "Peru", PH: "Philippines", PL: "Poland", PT: "Portugal", QA: "Qatar",
  RO: "Romania", RU: "Russia", RW: "Rwanda", KN: "Saint Kitts and Nevis",
  LC: "Saint Lucia", VC: "Saint Vincent and the Grenadines", WS: "Samoa",
  SM: "San Marino", ST: "São Tomé and Príncipe", SA: "Saudi Arabia", SN: "Senegal",
  RS: "Serbia", SC: "Seychelles", SL: "Sierra Leone", SG: "Singapore", SK: "Slovakia",
  SI: "Slovenia", SB: "Solomon Islands", SO: "Somalia", ZA: "South Africa",
  SS: "South Sudan", ES: "Spain", LK: "Sri Lanka", SD: "Sudan", SR: "Suriname",
  SE: "Sweden", CH: "Switzerland", SY: "Syria", TW: "Taiwan", TJ: "Tajikistan",
  TZ: "Tanzania", TH: "Thailand", TL: "Timor-Leste", TG: "Togo", TO: "Tonga",
  TT: "Trinidad and Tobago", TN: "Tunisia", TR: "Turkey", TM: "Turkmenistan",
  TV: "Tuvalu", UG: "Uganda", UA: "Ukraine", AE: "United Arab Emirates",
  GB: "United Kingdom", UK: "United Kingdom", US: "United States", UY: "Uruguay",
  UZ: "Uzbekistan", VU: "Vanuatu", VA: "Vatican City", VE: "Venezuela",
  VN: "Vietnam", YE: "Yemen", ZM: "Zambia", ZW: "Zimbabwe",
  HK: "Hong Kong", MO: "Macau", PR: "Puerto Rico", GU: "Guam",
  AW: "Aruba", BM: "Bermuda", KY: "Cayman Islands", FO: "Faroe Islands",
  GL: "Greenland", GG: "Guernsey", IM: "Isle of Man", JE: "Jersey",
  PM: "Saint Pierre and Miquelon",
  SX: "Sint Maarten", TC: "Turks and Caicos Islands", VG: "British Virgin Islands",
  VI: "U.S. Virgin Islands",
};

function getCountryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

/* ─── Country code → flag accent color (primary color from each flag) ─── */
const COUNTRY_COLORS: Record<string, string> = {
  AF: "#009900", AL: "#E41E20", DZ: "#006233", AD: "#0032A0", AO: "#CC0000",
  AG: "#0072C6", AR: "#74ACDF", AM: "#F90004", AU: "#00008B", AT: "#ED2939",
  AZ: "#0092BC", BS: "#00778B", BH: "#CE1126", BD: "#006A4E", BB: "#00267F",
  BY: "#CF101A", BE: "#ED2939", BZ: "#003F87", BJ: "#008751", BT: "#FF6D00",
  BO: "#D52B1E", BA: "#002395", BW: "#75AADB", BR: "#009739", BN: "#F7E017",
  BG: "#009B3A", BF: "#EF2B2D", BI: "#E7211A", KH: "#032EA1", CM: "#006633",
  CA: "#FF0000", CV: "#003893", CF: "#002266", TD: "#002266", CL: "#D52B1E",
  CN: "#DE2910", CO: "#FCD116", KM: "#009530", CG: "#009530", CD: "#007FFF",
  CR: "#002B7F", CI: "#F77F00", HR: "#0D5EAF", CU: "#002A8F", CY: "#D57800",
  CZ: "#11457E", DK: "#C8102E", DJ: "#00CC00", DM: "#006B3F", DO: "#002D62",
  EC: "#FFD100", EG: "#C8102E", SV: "#0F47AF", GQ: "#0072C6", ER: "#33B8CC",
  EE: "#0072CE", SZ: "#000000", ET: "#009B3A", FJ: "#68BFE5", FI: "#003580",
  FR: "#002395", GA: "#009E60", GM: "#EF3340", GE: "#FF0000", DE: "#DD0000",
  GH: "#006B3F", GR: "#0D5EAF", GD: "#CE1126", GT: "#4997D0", GN: "#CE1126",
  GW: "#CE1126", GY: "#009E49", HT: "#00209F", HN: "#0073CF", HU: "#CE2939",
  IS: "#003897", IN: "#FF9933", ID: "#FF0000", IR: "#239F40", IQ: "#CE1126",
  IE: "#169B62", IL: "#0038B8", IT: "#008C45", JM: "#009B3A", JP: "#BC002D",
  JO: "#000000", KZ: "#00AFCA", KE: "#BB0000", KI: "#CE1126", KP: "#024FA2",
  KR: "#003478", KW: "#007A3D", KG: "#FF0000", LA: "#CE1126", LV: "#9E3039",
  LB: "#EE161F", LS: "#00189E", LR: "#002768", LY: "#E70013", LI: "#002B7F",
  LT: "#C1272D", LU: "#00A1DE", MG: "#007E3A", MW: "#CE1126", MY: "#CC0001",
  MV: "#D21034", ML: "#14B53A", MT: "#CF1318", MH: "#003F87", MR: "#006233",
  MU: "#EE2737", MX: "#006341", FM: "#003893", MD: "#003DA5", MC: "#CF142B",
  MN: "#C4272F", ME: "#D4AF37", MA: "#C1272D", MZ: "#009639", MM: "#FECB00",
  NA: "#003580", NR: "#002266", NP: "#DC143C", NL: "#AE1C28", NZ: "#00247D",
  NI: "#0067C6", NE: "#E05206", NG: "#008751", MK: "#D20000", NO: "#BA0C2F",
  OM: "#DB161B", PK: "#01411C", PW: "#4AADD6", PS: "#000000", PA: "#005293",
  PG: "#BB0000", PY: "#D52B1E", PE: "#D91023", PH: "#0038A8", PL: "#DC143C",
  PT: "#006600", QA: "#8D1B3D", RO: "#002B7F", RU: "#0039A6", RW: "#20603F",
  KN: "#009E49", LC: "#006B3F", VC: "#002266", WS: "#CE1126", SM: "#019444",
  ST: "#009444", SA: "#006C35", SN: "#00853F", RS: "#C6363C", SC: "#D6282E",
  SL: "#0072C6", SG: "#EF3340", SK: "#0D5EAF", SI: "#003DA5", SB: "#0051BA",
  SO: "#4189DD", ZA: "#007749", SS: "#000000", ES: "#AA151B", LK: "#FFBE29",
  SD: "#D21034", SR: "#0067C6", SE: "#004B87", CH: "#FF0000", SY: "#CE1126",
  TW: "#000099", TJ: "#C1272D", TZ: "#00A3DD", TH: "#A51931", TL: "#DA291C",
  TG: "#006A4E", TO: "#C10000", TT: "#DA1A27", TN: "#E70013", TR: "#E30A17",
  TM: "#008B45", TV: "#0096DC", UG: "#000000", UA: "#005BBB", AE: "#009639",
  GB: "#012169", UK: "#012169", US: "#B22234", UY: "#0038A8", UZ: "#0099B9",
  VU: "#009739", VA: "#FDDF00", VE: "#CF142B", VN: "#DA251D", YE: "#CE1126",
  ZM: "#009739", ZW: "#DE2010", HK: "#DE2910", MO: "#009739", PR: "#ED0000",
  GU: "#002266", AW: "#3399CC", BM: "#DC241F", KY: "#003893", FO: "#005EB8",
  GL: "#D00C33", GG: "#E81830", IM: "#E81830", JE: "#DF5C39",
  PM: "#005EB8", SX: "#DC143C", TC: "#002266", VG: "#005EB8", VI: "#003893",
};

function getCountryColor(code: string): string {
  return COUNTRY_COLORS[code.toUpperCase()] || "#8A8F98";
}

/* ─── Region info helper ─── */
function getQuestRegionInfo(quest: QuestData): { type: "global" | "regional" | "unknown"; regions: string[] } {
  const regions = quest.regions || [];
  const isGlobal = quest.isGlobal;
  const hasRegionData = quest.hasRegionData;

  // No region data available from API at all → unknown
  if (isGlobal === null && !hasRegionData) {
    return { type: "unknown", regions: [] };
  }

  // Confirmed global quest (from API)
  if (isGlobal === true) return { type: "global", regions: [] };

  // Regional quest with specific regions
  if (regions.length > 0) return { type: "regional", regions };

  // isGlobal=false but no regions → still treat as regional with unknown specifics
  if (isGlobal === false) return { type: "regional", regions: [] };

  // Fallback: has region data but unclear type
  return { type: "unknown", regions: [] };
}

function formatExpires(dateStr?: string) {
  if (!dateStr) return { text: "", color: "#8A8F98", expired: false };
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return { text: "Hết hạn", color: "#F6606F", expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return { text: `Còn ${days} ngày`, color: "#3DD68C", expired: false };
  if (hours > 0) return { text: `Còn ${hours} giờ`, color: "#F5B544", expired: false };
  return { text: `Còn ${mins} phút`, color: "#F5B544", expired: false };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || !hex.startsWith("#")) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

/* ─── Filter type ─── */
type QuestFilter = "all" | "video" | "game";

/* ─── Filter Tab (icon only, no label) ─── */
function FilterTab({ active, color, onClick, icon }: { active: boolean; color: string; onClick: () => void; icon: React.ReactNode }) {
  const rgb = hexToRgb(color);
  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150"
      style={{
        backgroundColor: active ? (rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)` : "rgba(255,255,255,0.1)") : "transparent",
        color: active ? color : "#8A8F98",
      }}
    >
      {icon}
    </button>
  );
}

/* ─── Region Flag Badge (expandable, contained inside card) ─── */
function RegionFlagBadge({ quest }: { quest: QuestData }) {
  const [expanded, setExpanded] = useState(false);
  const regionInfo = getQuestRegionInfo(quest);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("touchstart", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [expanded]);

  if (regionInfo.type === "unknown") {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-bold border cursor-default" title="Không rõ khu vực"
        style={{ backgroundColor: "rgba(10,11,14,0.75)", borderColor: "rgba(255,255,255,0.10)", color: "#8A8F98" }}>
        ???
      </div>
    );
  }

  if (regionInfo.type === "global") {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-bold border cursor-default" title="Khả dụng toàn cầu"
        style={{ backgroundColor: "rgba(10,11,14,0.75)", borderColor: "rgba(255,255,255,0.12)", color: "#E4E6EB" }}>
        GLOBAL
      </div>
    );
  }

  if (regionInfo.regions.length === 0) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-bold border cursor-default" title="Quest khu vực"
        style={{ backgroundColor: "rgba(10,11,14,0.75)", borderColor: "rgba(255,255,255,0.10)", color: "#8A8F98" }}>
        REGION
      </div>
    );
  }

  const regions = regionInfo.regions;

  if (regions.length === 1) {
    return (
      <div className="flex items-center px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-bold border cursor-default" title={getCountryName(regions[0])}
        style={{ backgroundColor: "rgba(10,11,14,0.75)", borderColor: "rgba(255,255,255,0.12)", color: "#E4E6EB" }}>
        {regions[0]}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-0.5 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-bold border cursor-pointer hover:border-white/30 transition-colors"
        style={{ backgroundColor: "rgba(10,11,14,0.65)", borderColor: expanded ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)", color: "#E4E6EB" }}
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
        <span className="leading-none">{regions[0]}</span>
        <svg className={`w-3 h-3 text-white/50 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div className="absolute top-full right-0 mt-1 z-50 max-h-[160px] overflow-y-auto rounded-lg border py-0.5 scrollbar-hide animate-scale-in"
          style={{ backgroundColor: "rgba(10,11,14,0.96)", borderColor: "rgba(255,255,255,0.12)", boxShadow: "0 8px 24px rgba(0,0,0,0.55)" }}
          onClick={(e) => e.stopPropagation()}>
          {regions.map((r) => (
            <div key={r} className="flex items-center gap-2 px-1.5 py-0.5 hover:bg-white/[0.06] transition-colors whitespace-nowrap">
              <span className="text-[10px] font-bold text-white/80 shrink-0 w-5 text-center">{r}</span>
              <span className="text-white/50 text-[10px]">{getCountryName(r)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Full Slot Button — hiện khi hết lượt ─── */
function FullSlotButton() {
  return (
    <div className="w-full relative rounded-lg sm:rounded-xl overflow-hidden cursor-not-allowed">
      <div className="absolute inset-0 bg-gradient-to-r from-[#F5B544]/8 via-[#F5B544]/4 to-[#F5B544]/8" />
      <div className="absolute inset-0 rounded-lg sm:rounded-xl border border-[#F5B544]/20" />
      <div className="relative flex items-center justify-center gap-2 py-2 sm:py-2.5">
        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#F5B544]/10 flex items-center justify-center">
          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#F5B544] animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </div>
        <p className="text-xs sm:text-sm font-bold text-[#F5B544]">
          Quay lại sau
        </p>
      </div>
    </div>
  );
}

/* ─── Quest Card 16:9 with Enroll Button ─── */
type ProxyAvailStatus = "available" | "full" | "no_proxy" | "unknown";

const QuestCard16x9 = memo(function QuestCard16x9({
  quest,
  onEnroll,
  enrollLoading,
  enrollResult,
  proxyAvail,
  cooldownSecs,
  ageRestricted,
}: {
  quest: QuestData;
  onEnroll: (quest: QuestData) => void;
  enrollLoading: string | null;
  enrollResult: Record<string, { success: boolean; message: string }>;
  proxyAvail: ProxyAvailStatus;
  cooldownSecs: number;
  ageRestricted?: boolean;
}) {
  const statusColor = getStatusColor(quest.status, quest.isClaimed);
  const statusRgb = hexToRgb(statusColor);
  const isGame = !isVideoType(quest.type);
  const expiry = formatExpires(quest.expiresAt);

  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const bannerUrl = quest.bannerUrl;

  const questName = quest.name || "Quest";
  const gameTitle = quest.gameTitle || null;
  const typeColor = getQuestTypeColor(quest.type);

  const isLoading = enrollLoading === quest.id;
  const result = enrollResult[quest.id];
  const regionInfo = getQuestRegionInfo(quest);
  const inCooldown = cooldownSecs > 0 && !isLoading;

  // Determine country code for enrollment display (luôn lấy quốc gia đầu tiên)
  // Fallback: unknown/global → random 1 trong 2: US hoặc GB (UK)
  const proxyCountry = regionInfo.type === "regional" && regionInfo.regions.length > 0
    ? regionInfo.regions[0]
    : (Math.random() < 0.5 ? "US" : "GB");

  return (
    <div
      className="group surface relative rounded-xl overflow-hidden transition-[border-color] duration-200 hover:border-white/[0.14]"
      style={{
        borderColor: result?.success
          ? "rgba(61, 214, 140, 0.5)"
          : result && !result.success
          ? "rgba(246, 96, 111, 0.4)"
          : statusRgb
          ? `rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.4)`
          : "rgba(148, 155, 164, 0.4)",
        contain: 'layout style paint',
        height: '100%',
      }}
    >
      {/* 16:9 Banner Area */}
      <div className="relative aspect-video w-full bg-[#11131A]">
        {/* Placeholder gradient */}
        <div
          className="absolute inset-0"
          style={{
            background: statusRgb
              ? `linear-gradient(135deg, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.4) 0%, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.15) 50%, #1a1d24 100%)`
              : "linear-gradient(135deg, rgba(148, 155, 164, 0.4) 0%, rgba(148, 155, 164, 0.15) 50%, #1a1d24 100%)",
          }}
        />
        {/* Inner clip layer for images only */}
        <div className="absolute inset-0 overflow-hidden">
          {bannerUrl && !imgError ? (
            <img
              src={bannerUrl}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover object-[80%_50%] transition-opacity duration-500 ease-out ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              onError={() => setImgError(true)}
              onLoad={() => setImgLoaded(true)}
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          ) : null}
          {(!bannerUrl || imgError) && (
            <div
              className="w-full h-full absolute inset-0"
              style={{
                background: statusRgb
                  ? `linear-gradient(135deg, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.3) 0%, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.1) 40%, #11131A 100%)`
                  : "linear-gradient(135deg, rgba(148, 155, 164, 0.3) 0%, rgba(148, 155, 164, 0.1) 40%, #11131A 100%)",
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center opacity-20">
                <div style={{ color: statusColor }}>
                  {isGame ? <Gamepad2 className="w-10 h-10" /> : <Video className="w-10 h-10" />}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0B0E] via-transparent to-transparent pointer-events-none" />

        {/* Logotype — quest title logo from Discord CDN */}
        {quest.logotypeLight && (
          <div className="absolute bottom-1.5 left-1.5 sm:bottom-2 sm:left-2 z-10 max-w-[70%]">
            <img
              src={quest.logotypeLight.includes('/')
                ? `https://cdn.discordapp.com/${quest.logotypeLight}`
                : `https://cdn.discordapp.com/quests/${quest.id}/assets/${quest.logotypeLight}.png`}
              alt=""
              className="relative max-h-9 sm:max-h-10 lg:max-h-12 w-auto object-contain"
              style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.8)) drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
            />
          </div>
        )}

        {/* Type Badge - top left */}
        <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-10">
          <div className="flex items-center gap-1 px-2 py-0.5 sm:px-2 sm:py-1 rounded-md text-[10px] sm:text-[10px] lg:text-[11px] font-bold bg-black/60  text-white border border-white/10">
            {isGame ? <Gamepad2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" style={{ color: typeColor }} /> : <Video className="w-2.5 h-2.5 sm:w-3 sm:h-3" style={{ color: typeColor }} />}
            <span style={{ color: typeColor }}>{getQuestTypeLabel(quest.type)}</span>
          </div>
        </div>

        {/* 18+ Badge - below type badge, left side */}
        {quest.showAgeGate && (
          <div className="absolute top-[2rem] sm:top-[2.2rem] left-1.5 sm:left-2 z-10">
            <div
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold  border"
              title="Nội dung 18+"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.55)",
                borderColor: "rgba(246, 96, 111, 0.3)",
                color: "#F6606F",
              }}
            >
              18+
            </div>
          </div>
        )}

        {/* Result overlay - centered on banner */}
        {result && !result.success && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none bg-black/50 ">
            <span className="text-sm sm:text-base font-extrabold text-[#F6606F]" style={{ textShadow: "0 0 8px rgba(246, 96, 111,0.5), 0 1px 2px rgba(0,0,0,0.9)" }}>Không thể nhận</span>
            {result.message && !result.message.includes("thất bại") && (
              <span className="text-[10px] sm:text-xs text-[#F6606F]/70 mt-1 max-w-[80%] text-center leading-tight line-clamp-2" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>{result.message}</span>
            )}
          </div>
        )}
        {result && result.success && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-black/60 ">
            <span className="text-sm sm:text-base font-extrabold text-[#3DD68C]" style={{ textShadow: "0 0 10px rgba(61, 214, 140,0.6), 0 1px 3px rgba(0,0,0,0.9)" }}>Đã nhận</span>
          </div>
        )}

        {/* Small link button - bottom right of banner */}
        <a
          href={`https://discord.com/quests/${quest.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-1 right-1 sm:bottom-1.5 sm:right-1.5 lg:bottom-2 lg:right-2 z-10 w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 rounded-lg bg-black/70 flex items-center justify-center text-white/60 hover:text-white hover:bg-black/80 transition-colors"
          title="Mở trên Discord"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
        </a>
      </div>

      {/* Region Flag Badge - top right of card, outside banner to allow dropdown overflow */}
      <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 z-30">
        <RegionFlagBadge quest={quest} />
      </div>

      {/* Info Section — Aurora canvas */}
      <div className="bg-[#0A0B0E] p-2 sm:p-2.5 lg:p-3 flex flex-col gap-1.5 min-h-[100px] sm:min-h-[115px] lg:min-h-[125px]">
        {/* Quest Name */}
        <h4 className="text-xs sm:text-sm lg:text-base font-bold text-white leading-tight line-clamp-1" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {questName}
        </h4>
        {/* Game Title */}
        <p className="text-[10px] sm:text-[11px] lg:text-xs text-[#8A8F98] leading-tight line-clamp-1">
          {gameTitle || "\u2014"}
        </p>

        {/* Reward name */}
        {quest.reward && quest.reward !== "Unknown" && (
          <p className="text-[10px] sm:text-[11px] lg:text-xs leading-tight line-clamp-1 flex items-center gap-1">
            <span className="text-[#E879F9] font-medium">{quest.reward}</span>
          </p>
        )}

        {/* Time row */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-[10px] sm:text-[10px] lg:text-[11px] shrink-0" style={{ color: expiry.color || "#8A8F98" }}>
            {expiry.text}
          </span>
        </div>

        {/* Grand Enroll Button — full width, matching Dashboard action button style */}
        {result?.success ? (
          <div className="w-full relative rounded-lg sm:rounded-xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-[#3DD68C]/10 via-[#3DD68C]/5 to-[#3DD68C]/10" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl border border-[#3DD68C]/25" />
            <div className="relative flex items-center justify-center gap-2 py-2 sm:py-2.5">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#3DD68C]/15 flex items-center justify-center">
                <ShieldCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#3DD68C]" />
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#3DD68C]">Đã nhận quest</p>
            </div>
          </div>
        ) : proxyAvail === "no_proxy" ? (
          /* Khu vực chưa hỗ trợ - không đề cập proxy */
          <div className="w-full relative rounded-lg sm:rounded-xl overflow-hidden cursor-not-allowed">
            <div className="absolute inset-0 bg-gradient-to-r from-[#8A8F98]/8 via-[#8A8F98]/4 to-[#8A8F98]/8" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl border border-[#8A8F98]/15" />
            <div className="relative flex items-center justify-center gap-2 py-2 sm:py-2.5">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#8A8F98]/10 flex items-center justify-center">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#8A8F98]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#8A8F98]">Không khả dụng</p>
            </div>
          </div>
        ) : proxyAvail === "full" ? (
          /* Hết lượt */
          <FullSlotButton />
        ) : inCooldown ? (
          /* Cooldown 45s sau khi nhận quest */
          <div className="w-full relative rounded-lg sm:rounded-xl overflow-hidden cursor-not-allowed">
            <div className="absolute inset-0 bg-gradient-to-r from-[#5E6AD2]/6 via-[#5E6AD2]/3 to-[#5E6AD2]/6" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl border border-[#5E6AD2]/12" />
            <div className="relative flex items-center justify-center gap-2 py-2 sm:py-2.5">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#5E6AD2]/10 flex items-center justify-center">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#5E6AD2]/70 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#5E6AD2]/70">
                Chờ {cooldownSecs}s
              </p>
            </div>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnroll(quest);
            }}
            disabled={!!enrollLoading}
            className="w-full relative group rounded-lg sm:rounded-xl overflow-hidden disabled:cursor-not-allowed"
            title={isLoading ? "Đang nhận..." : "Nhận Quest Ẩn"}
          >
            {/* Animated gradient background */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#5E6AD2]/10 via-[#E879F9]/8 to-[#5E6AD2]/10 group-hover:from-[#5E6AD2]/20 group-hover:via-[#E879F9]/15 group-hover:to-[#5E6AD2]/20 transition-colors duration-300" />
            {/* Light streak sweep */}
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            {/* Border */}
            <div className="absolute inset-0 rounded-lg sm:rounded-xl border border-[#5E6AD2]/20 group-hover:border-[#5E6AD2]/40 transition-colors duration-300" />
            {/* Content */}
            <div className="relative flex items-center justify-center gap-2 py-2 sm:py-2.5">
              <div className="relative">
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-[#5E6AD2]/20 to-[#E879F9]/15 group-hover:from-[#5E6AD2]/30 group-hover:to-[#E879F9]/25 transition-colors duration-300 flex items-center justify-center">
                  {isLoading ? (
                    <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-[#5E6AD2]" />
                  ) : (
                    <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#5E6AD2]" fill="currentColor" />
                  )}
                </div>
              </div>
              <p className="text-xs sm:text-sm font-bold text-white group-hover:text-[#5E6AD2] transition-colors duration-300">
                {isLoading ? "Đang nhận..." : "Nhận Quest Ẩn"}
              </p>
              {/* Arrow hint */}
              <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-white/[0.05] group-hover:bg-white/[0.1] flex items-center justify-center transition-all ml-1">
                <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#8A8F98] group-hover:text-white group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>
          </button>
        )}

      </div>
    </div>
  );
});
/* ─── Proxy list stats from server ─── */
interface ProxyStats {
  total: number;
  countries: string[];
  lastFetch: string;
}

export default function HiddenQuests() {
  const { setSidebarOpen, quests: dashboardQuests, token, isVerified, isGuildMember, guildCheckLoading, guildCheckedOnce, guildName, guildIcon, addLog, setGuildMember, setGuildCheckLoading, excludedQuestIds } = useAppStore();
  // true ngay từ lần render đầu cho tới khi kiểm tra guild xong: chặn việc lóe
  // thẻ "Chỉ dành cho thành viên" trong lúc chờ Discord trả lời.
  const [checking, setChecking] = useState(true);
  const [quests, setQuests] = useState<QuestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");
  const [hide18Plus, setHide18Plus] = useState(false);
  const [enrollLoading, setEnrollLoading] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<Record<string, { success: boolean; message: string }>>({});
  const [enrollCooldown, setEnrollCooldown] = useState(0); // đếm ngược 30s sau mỗi lần nhận
  const cooldownRef = useRef<NodeJS.Timeout | null>(null);
  const COOLDOWN_STORAGE_KEY = "hiddenQuestCooldownEndsAt";
  const initialDone = useRef(false);
  const [proxyStats, setProxyStats] = useState<ProxyStats | null>(null);
  const [proxyRefreshing, setProxyRefreshing] = useState(false);
  const [proxyAvailability, setProxyAvailability] = useState<Record<string, ProxyAvailStatus>>({});

  // Bidirectional map: quest ID → all related IDs (parent ↔ replacement ↔ variants)
  // Built from discordquest.com region data so Dashboard quests (which lack replacementId)
  // can still be cross-referenced with hidden quests
  const [relatedIdMap, setRelatedIdMap] = useState<Map<string, Set<string>>>(new Map());

  // Quest IDs already in user's token (from Dashboard)
  // Include ALL related IDs: primary id, replacementId, questIds, AND cross-referenced IDs from relatedIdMap
  const dashboardQuestIds = new Set<string>();
  for (const q of dashboardQuests) {
    dashboardQuestIds.add(q.id);
    if (q.replacementId) dashboardQuestIds.add(q.replacementId);
    if (q.questIds) {
      for (const qid of q.questIds) dashboardQuestIds.add(qid);
    }
    // Also add all cross-referenced IDs from region data
    const related = relatedIdMap.get(q.id);
    if (related) {
      for (const rid of related) dashboardQuestIds.add(rid);
    }
  }

  // Ensure Dashboard quests are loaded so we can filter correctly
  // Returns the set of dashboard quest IDs for immediate use (no re-render lag)
  const ensureDashboardLoaded = useCallback(async (): Promise<Set<string>> => {
    const existingIds = new Set<string>();
    for (const q of dashboardQuests) {
      existingIds.add(q.id);
      if (q.replacementId) existingIds.add(q.replacementId);
      if (q.questIds) for (const qid of q.questIds) existingIds.add(qid);
      const related = relatedIdMap.get(q.id);
      if (related) for (const rid of related) existingIds.add(rid);
    }
    if (existingIds.size > 0) return existingIds; // Already loaded
    if (!token) return existingIds; // No token, can't fetch
    try {
      // Trình duyệt tự tải danh sách quest rồi gửi kèm: server chỉ định dạng,
      // KHÔNG gọi Discord bằng token nữa (đó là thứ làm revoke khi mở quest ẩn).
      let clientQuests: unknown = null;
      try {
        const raw = await fetch("https://discord.com/api/v9/quests/@me", {
          headers: buildDiscordHeaders(token),
          cache: "no-store",
        });
        if (raw.ok) clientQuests = await raw.json();
      } catch { /* để server tải hộ */ }
      const res = await fetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, isVerified, autoClaim: isVerified, clientQuests }),
      });
      const data = await res.json();
      if (data.success && data.quests) {
        // Update store so dashboardQuestIds picks up the IDs
        const { setQuests } = useAppStore.getState();
        setQuests(data.quests, data.orbsBalance, data.excludedQuestIds);
        // Return immediately usable set (include all related IDs)
        const ids = new Set<string>();
        for (const q of data.quests as QuestData[]) {
          ids.add(q.id);
          if (q.replacementId) ids.add(q.replacementId);
          if (q.questIds) for (const qid of q.questIds) ids.add(qid);
          const related = relatedIdMap.get(q.id);
          if (related) for (const rid of related) ids.add(rid);
        }
        return ids;
      }
    } catch {
      // Silent fail - hidden quests will just show everything
    }
    return existingIds;
  }, [token, isVerified, dashboardQuests.length, relatedIdMap]);

  const fetchHiddenQuests = useCallback(async (dashboardIds?: Set<string>) => {
    setLoading(true);
    setError("");
    try {
      // Fetch directly from discordquest.com API (CORS enabled) to avoid server memory issues
      const [questsRes, regionsRes] = await Promise.all([
        fetch("https://api.discordquest.com/api/quests", { headers: { "Accept": "application/json" } }),
        fetch("https://api.discordquest.com/api/regions", { headers: { "Accept": "application/json" } }),
      ]);

      if (!questsRes.ok) throw new Error("Quests API lỗi");

      const allQuests = await questsRes.json();
      const regionsData = regionsRes.ok ? await regionsRes.json() : { quests: [] };

      // Build region maps (same logic as server route)
      const regionMap = new Map<string, { isGlobal: boolean; regions: string[]; replacementId?: string; showAgeGate?: boolean }>();
      const reverseRegionMap = new Map<string, { regions: string[]; isGlobal: boolean; showAgeGate: boolean }>();

      // Build bidirectional related ID map for cross-referencing Dashboard ↔ Hidden quests
      // Key: quest ID → Value: Set of ALL related IDs (parent, replacement, variants)
      const newRelatedIdMap = new Map<string, Set<string>>();

      for (const rq of regionsData.quests || []) {
        const info = {
          isGlobal: rq.is_global ?? false,
          regions: Array.isArray(rq.regions)
            ? (rq.regions as string[]).filter((r: string) => r !== "")
            : Array.isArray((rq.regions as Record<string, string[]>)?.include)
              ? ((rq.regions as Record<string, string[]>).include || []).filter((r: string) => r !== "")
              : [],
          replacementId: rq.replacement_id || undefined,
          showAgeGate: rq.show_age_gate === true,
        };
        regionMap.set(rq.id, info);

        // Build bidirectional relationships
        if (rq.replacement_id) {
          // Parent quest (rq.id) → has replacement (rq.replacement_id)
          // So both IDs are related to each other
          const parentId = rq.id;
          const replacementId = rq.replacement_id;

          // Add replacementId to parent's related set
          if (!newRelatedIdMap.has(parentId)) newRelatedIdMap.set(parentId, new Set());
          newRelatedIdMap.get(parentId)!.add(replacementId);

          // Add parentId to replacement's related set
          if (!newRelatedIdMap.has(replacementId)) newRelatedIdMap.set(replacementId, new Set());
          newRelatedIdMap.get(replacementId)!.add(parentId);

          const existing = reverseRegionMap.get(rq.replacement_id);
          if (existing) {
            const merged = [...new Set([...existing.regions, ...info.regions])];
            reverseRegionMap.set(rq.replacement_id, {
              regions: merged,
              isGlobal: existing.isGlobal && info.isGlobal,
              showAgeGate: existing.showAgeGate || info.showAgeGate,
            });
          } else {
            reverseRegionMap.set(rq.replacement_id, {
              regions: [...info.regions],
              isGlobal: info.isGlobal,
              showAgeGate: info.showAgeGate,
            });
          }
        }
      }

      // Save related ID map to state so dashboardQuestIds can use it for filtering
      setRelatedIdMap(newRelatedIdMap);

      // Quest names to hide from the list
      const HIDDEN_QUEST_NAMES = ["[TEST] Cloud", "Tiered Rewards V2", "Sky Runners V2"];

      // Filter active quests and map to QuestData format
      const now = Date.now();
      const mapped: QuestData[] = allQuests
        .filter((q: any) => {
          if (!q.config?.expires_at) return false;
          // Hide specific quests by name
          const questName = q.config?.messages?.quest_name || "";
          if (HIDDEN_QUEST_NAMES.includes(questName)) return false;
          try { return new Date(q.config.expires_at).getTime() > now; } catch { return false; }
        })
        .map((q: any) => {
          const regionInfo = regionMap.get(q.id);
          const reverseInfo = !regionInfo ? reverseRegionMap.get(q.id) : null;
          const reward = q.config?.rewards_config?.rewards?.[0];
          const heroAsset = q.config?.assets?.hero || "";

          let finalRegions: string[];
          let finalIsGlobal: boolean | null;
          let showAgeGate: boolean;

          if (regionInfo) {
            finalRegions = regionInfo.regions || [];
            finalIsGlobal = regionInfo.isGlobal;
            showAgeGate = regionInfo.showAgeGate === true;
          } else if (reverseInfo) {
            finalRegions = reverseInfo.regions || [];
            finalIsGlobal = reverseInfo.isGlobal;
            showAgeGate = reverseInfo.showAgeGate;
          } else {
            finalRegions = [];
            finalIsGlobal = null;
            showAgeGate = false;
          }

          // Determine quest type
          const taskConfigV2 = q.config?.task_config_v2;
          const taskConfig = q.config?.task_config;
          const knownTypes = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "ACHIEVEMENT_IN_ACTIVITY"];
          let questType = "UNKNOWN";
          if (taskConfigV2?.tasks) {
            for (const t of knownTypes) { if (taskConfigV2.tasks[t] != null) { questType = t; break; } }
            if (questType === "UNKNOWN") { const keys = Object.keys(taskConfigV2.tasks); if (keys.length > 0) questType = keys[0]; }
          } else if (taskConfig?.tasks) {
            const keys = Object.keys(taskConfig.tasks); if (keys.length > 0) questType = keys[0];
          }

          // Get target seconds
          const allTasks = { ...(taskConfigV2?.tasks || {}), ...(taskConfig?.tasks || {}) };
          const firstTaskKey = Object.keys(allTasks)[0];
          const targetSeconds = firstTaskKey ? allTasks[firstTaskKey]?.target || 0 : 0;
          const minutes = Math.ceil(targetSeconds / 60);
          let targetLabel = `${minutes} phút`;
          if (questType.startsWith("WATCH_VIDEO") || questType === "STREAM_ON_DESKTOP") targetLabel = `${minutes} phút stream`;
          else if (questType.startsWith("PLAY_")) targetLabel = `${minutes} phút chơi`;

          return {
            id: q.id,
            name: q.config?.messages?.quest_name || "Unknown Quest",
            description: "",
            type: questType,
            status: "available" as const,
            progress: 0,
            expiresAt: q.config?.expires_at,
            reward: reward?.messages?.name || "Unknown",
            rewardIconUrl: reward?.asset ? `https://cdn.discordapp.com/quests/${q.id}/${reward.asset}` : undefined,
            bannerUrl: heroAsset ? `/api/quests/banner?questId=${encodeURIComponent(q.id)}&hero=${encodeURIComponent(heroAsset)}` : undefined,
            applicationId: q.config?.application?.id || null,
            applicationName: q.config?.application?.name || undefined,
            target: targetSeconds,
            targetLabel,
            gameTitle: q.config?.messages?.game_title || q.config?.application?.name || "",
            gamePublisher: q.config?.messages?.game_publisher || "",
            primaryColor: q.config?.colors?.primary || "#5E6AD2",
            secondaryColor: q.config?.colors?.secondary || "#5E6AD2",
            heroAsset: q.config?.assets?.hero || "",
            gameTileAsset: q.config?.assets?.game_tile || "",
            logotypeAsset: q.config?.assets?.logotype || "",
            logotypeLight: q.config?.assets?.logotype_light || q.config?.assets?.logotype || "",
            isEnrolled: false,
            isClaimed: false,
            orbsReward: reward?.orb_quantity || null,
            regions: finalRegions,
            isGlobal: finalIsGlobal,
            replacementId: regionInfo?.replacementId,
            showAgeGate,
            hasRegionData: regionInfo != null || reverseInfo != null,
            questIds: [q.id, ...(regionInfo?.replacementId ? [regionInfo.replacementId] : [])],
          };
        });

      setQuests(mapped);
      // Fetch proxy availability right after getting quests
      fetchProxyAvailability(mapped);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối";
      setError(msg);
    }
    setLoading(false);
  }, []);

  // Fetch proxy stats from server
  const fetchProxyStats = useCallback(async (refresh = false) => {
    setProxyRefreshing(true);
    try {
      const url = `/api/proxy-list?stats=true${refresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setProxyStats({
            total: data.total,
            countries: data.countries || [],
            lastFetch: data.lastFetch,
          });
        }
      }
    } catch {
      // Silent
    }
    setProxyRefreshing(false);
  }, []);

  // Fetch proxy availability for all unique countries in quest list
  const fetchProxyAvailability = useCallback(async (questList: QuestData[]) => {
    if (questList.length === 0) return;

    // Collect unique country codes from quests (chỉ lấy quốc gia đầu tiên mỗi quest)
    const countries = new Set<string>();
    for (const q of questList) {
      const ri = getQuestRegionInfo(q);
      if (ri.type === "regional" && ri.regions.length > 0) {
        countries.add(ri.regions[0]); // Chỉ lấy quốc gia đầu tiên
      } else {
        // global + unknown → random 1 trong 2: US hoặc GB (UK)
        countries.add(Math.random() < 0.5 ? "US" : "GB");
      }
    }

    if (countries.size === 0) return;

    try {
      const tokenId = token ? `t_${token.slice(0, 16)}` : "";
      const res = await fetch(`/api/proxy-list/availability?countries=${[...countries].join(",")}&tokenId=${encodeURIComponent(tokenId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.availability) {
          const mapped: Record<string, ProxyAvailStatus> = {};
          for (const [cc, info] of Object.entries(data.availability as Record<string, { status: string }>)) {
            mapped[cc] = info.status as ProxyAvailStatus;
          }
          setProxyAvailability(mapped);
        }
      }
    } catch {
      // Silent
    }
  }, [token]);

  /** Get proxy availability status for a specific quest (luôn dùng region đầu tiên) */
  const getProxyAvailForQuest = useCallback((quest: QuestData): ProxyAvailStatus => {
    const ri = getQuestRegionInfo(quest);
    // Luôn lấy quốc gia đầu tiên (nhiều quốc gia → chỉ quan tâm cái đầu)
    // Fallback: unknown/global → random 1 trong 2: US hoặc GB (UK)
    const cc = ri.type === "regional" && ri.regions.length > 0
      ? ri.regions[0]
      : (Math.random() < 0.5 ? "US" : "GB");
    return proxyAvailability[cc] || "unknown";
  }, [proxyAvailability]);

  // Fetch guild info from /api/guild/info if we don't have it yet
  // This works even for non-members (uses server cache + public endpoints)
  const guildInfoFetched = useRef(false);
  useEffect(() => {
    if (guildInfoFetched.current) return;
    if (!guildIcon && !guildName) {
      guildInfoFetched.current = true;
      // KHÔNG gửi token lên server nữa: tên/icon guild đã có từ bước kiểm tra
      // thành viên chạy trong trình duyệt (users/@me/guilds).
      const url = "/api/guild/info";
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && (data.guildName || data.guildIcon)) {
            // Update store with guild info (don't change isMember status)
            const currentMember = useAppStore.getState().isGuildMember;
            setGuildMember(currentMember, data.guildName || null, data.guildIcon || null);
          }
        })
        .catch(() => { /* silent */ });
    }
  }, [guildIcon, guildName, token, setGuildMember]);

  // Re-check guild membership when entering Hidden Quests page
  // This ensures the lock state is accurate even if user left the guild
  useEffect(() => {
    if (!token) return;
    setGuildCheckLoading(true);
    // Kiểm tra membership NGAY TRONG TRÌNH DUYỆT bằng IP thật của máy.
    // Dùng /users/@me/guilds: một request duy nhất, trả luôn id + tên + icon,
    // nên vừa chính xác hơn /guilds/<id> (endpoint đó trả 403 cả khi chỉ thiếu
    // quyền, gây chặn oan) vừa hết nháy vì không phải chờ 2 bước.
    (async () => {
      let decided = false;
      try {
        const r = await fetch("https://discord.com/api/v9/users/@me/guilds", {
          headers: { Authorization: token },
          cache: "no-store",
        });
        if (r.ok) {
          const list = await r.json().catch(() => null);
          if (Array.isArray(list)) {
            const hit = list.find((g: { id?: string }) => g?.id === REQUIRED_GUILD_ID) as
              | { id: string; name?: string; icon?: string | null }
              | undefined;
            if (hit) {
              const icon = hit.icon
                ? `https://cdn.discordapp.com/icons/${REQUIRED_GUILD_ID}/${hit.icon}.png?size=128`
                : null;
              setGuildMember(true, hit.name || null, icon);
            } else {
              setGuildMember(false, null, null);
            }
            decided = true;
          }
        }
      } catch {
        /* trình duyệt bị chặn → thử các đường sau */
      }
      if (!decided) {
        try {
          const g = await fetch(
            `https://discord.com/api/v9/guilds/${REQUIRED_GUILD_ID}?with_counts=true`,
            { headers: { Authorization: token }, cache: "no-store" },
          );
          if (g.status === 200) {
            const info = await g.json().catch(() => null);
            const icon = info?.icon
              ? `https://cdn.discordapp.com/icons/${REQUIRED_GUILD_ID}/${info.icon}.png?size=128`
              : null;
            setGuildMember(true, info?.name || null, icon);
            decided = true;
          } else if (g.status === 403 || g.status === 404) {
            setGuildMember(false, null, null);
            decided = true;
          }
        } catch {
          /* im lặng */
        }
      }
      // KHÔNG còn fallback qua /api/auth/guild-check: endpoint đó để server gọi
      // Discord bằng token từ proxy, tạo cảnh "cùng token hai client" và Discord
      // thu hồi ngay khi mở trang quest ẩn. Không xác định được thì giữ nguyên.
      // Không xác định được thì GIỮ NGUYÊN trạng thái cũ, tránh nháy khoá oan.
      setGuildCheckLoading(false);
      setChecking(false);
    })();
  }, [token, setGuildMember, setGuildCheckLoading]);

  useEffect(() => {
    if (!initialDone.current) {
      initialDone.current = true;
      ensureDashboardLoaded().then((ids) => fetchHiddenQuests(ids));
      fetchProxyStats();
    }
  }, [ensureDashboardLoaded, fetchHiddenQuests, fetchProxyStats]);

  // Auto-refresh proxy availability every 30 seconds
  useEffect(() => {
    if (quests.length === 0) return;
    const interval = setInterval(() => {
      fetchProxyAvailability(quests);
    }, 30_000);
    return () => clearInterval(interval);
  }, [quests, fetchProxyAvailability]);

  // Resume cooldown khi component mount lại (sau khi đổi trang và quay lại)
  useEffect(() => {
    try {
      const endsAtStr = sessionStorage.getItem(COOLDOWN_STORAGE_KEY);
      if (!endsAtStr) return;
      const endsAt = parseInt(endsAtStr, 10);
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining > 0) {
        setEnrollCooldown(remaining);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
          setEnrollCooldown((prev) => {
            if (prev <= 1) {
              if (cooldownRef.current) { clearInterval(cooldownRef.current); cooldownRef.current = null; }
              sessionStorage.removeItem(COOLDOWN_STORAGE_KEY);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        // Cooldown đã hết khi user ở trang khác → xoá luôn
        sessionStorage.removeItem(COOLDOWN_STORAGE_KEY);
      }
    } catch { /* sessionStorage không khả dụng */ }

    // Cleanup khi unmount
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, []);

  // Handle enrolling in a hidden quest
  const handleEnroll = useCallback(async (quest: QuestData) => {
    if (!token) {
      setEnrollResult((prev) => ({
        ...prev,
        [quest.id]: { success: false, message: "Chưa đăng nhập" },
      }));
      return;
    }

    if (!isVerified) {
      setEnrollResult((prev) => ({
        ...prev,
        [quest.id]: {
          success: false,
          message: "Token chưa xác minh không thể nhận quest",
        },
      }));
      return;
    }

    // Determine country codes to try for enrollment (luôn lấy quốc gia đầu tiên)
    // Unknown/global → random 1 trong 2: US hoặc GB (UK)
    const regionInfo = getQuestRegionInfo(quest);
    const countryCodes = regionInfo.type === "regional" && regionInfo.regions.length > 0
      ? [regionInfo.regions[0]]
      : [Math.random() < 0.5 ? "US" : "GB"];

    setEnrollLoading(quest.id);
    setEnrollResult((prev) => {
      const next = { ...prev };
      delete next[quest.id];
      return next;
    });

    // Try each country code in order until one succeeds
    let data: any = null;
    let lastRes: Response | null = null;
    let lastCountryCode = countryCodes[0];
    for (const cc of countryCodes) {
      lastCountryCode = cc;
      try {
        // Nhận quest NGAY TRONG TRÌNH DUYỆT: request đi từ IP mạng nhà, không
        // qua server/proxy. countryCode không còn tác dụng vì IP do máy quyết.
        const res = await enrollQuestBrowser(token, quest.id, {
          isMobile: quest.type === "WATCH_VIDEO_ON_MOBILE",
          questData: quest,
        });
        data = { success: res.success, message: res.message };
        lastRes = null;
        if (data.success) break;
        break; // chỉ thử một lần, IP nhà cố định
        // If proxy error (no_proxy or full), try next country
        if (data.proxyError === "full" || data.proxyError === "no_proxy") {
          setProxyAvailability((prev) => ({
            ...prev,
            [cc]: data.proxyError as ProxyAvailStatus,
          }));
          continue;
        }
        // Other errors (account/token/404) — stop trying
        break;
      } catch {
        continue;
      }
    }

    // lastRes không còn dùng (enroll chạy trong trình duyệt, không qua route
    // server) — chỉ cần kiểm tra data.
    if (!data) {
      setEnrollResult((prev) => ({
        ...prev,
        [quest.id]: { success: false, message: "Lỗi kết nối" },
      }));
      return;
    }

    const countryCode = lastCountryCode;

    if (data.success) {
      setEnrollResult((prev) => ({
        ...prev,
        [quest.id]: { success: true, message: data.message || "Đã nhận quest thành công" },
      }));
      addLog({
        level: "success",
        message: `Đã nhận quest ẩn "${quest.name}"`,
        timestamp: Date.now(),
      });
      // Hiện "Đã nhận" trên banner 0.5s rồi reload quest ẩn
      setTimeout(() => {
        ensureDashboardLoaded().then((ids) => fetchHiddenQuests(ids));
      }, 500);
    } else {
      // Phân loại lỗi theo discordCode để hiển thị message có ý nghĩa
      const isAccountIneligible = data.discordCode === 403 || data.discordCode === 50001 || data.discordCode === 50000;
      const isTokenError = data.discordCode === 40001 || data.discordCode === 401;
      const is404 = data.discordCode === 260008 || (data.error && (
        data.error.includes("260008") || data.error.includes("404") ||
        data.error.toLowerCase().includes("unknown quest") ||
        data.error.toLowerCase().includes("inconnue")
      ));

      if (isAccountIneligible || isTokenError) {
        // Lỗi tài khoản/token — không thử variant vì kết quả sẽ giống nhau
        setEnrollResult((prev) => ({
          ...prev,
          [quest.id]: { success: false, message: data.error || (isTokenError ? "Token không hợp lệ" : "Tài khoản không đủ điều kiện nhận quest này") },
        }));
        addLog({
          level: "error",
          message: `Nhận quest ẩn "${quest.name}" thất bại: ${data.error || "Lỗi tài khoản"}`,
          timestamp: Date.now(),
        });
      } else if (is404) {
        // 404 "Unknown Quest" → thử enroll variant khác cùng tên
        const sameNameQuests = quests.filter(q => q.name === quest.name && q.id !== quest.id);
        let enrolled = false;
        for (const altQuest of sameNameQuests) {
          const altRegionInfo = getQuestRegionInfo(altQuest);
          const altCountryCodes = altRegionInfo.type === "regional" && altRegionInfo.regions.length > 0
            ? [altRegionInfo.regions[0]]
            : [Math.random() < 0.5 ? "US" : "GB"];

          for (const altCc of altCountryCodes) {
            try {
              const altRes = await enrollQuestBrowser(token, altQuest.id, {
                isMobile: altQuest.type === "WATCH_VIDEO_ON_MOBILE",
                questData: altQuest,
              });
              const altData = { success: altRes.success, message: altRes.message };
              if (altData.success) {
                setEnrollResult((prev) => ({
                  ...prev,
                  [quest.id]: { success: true, message: `Đã nhận qua variant ${altQuest.id.slice(-6)}` },
                }));
                addLog({
                  level: "success",
                  message: `Đã nhận quest ẩn "${quest.name}" qua variant ${altQuest.id.slice(-6)}`,
                  timestamp: Date.now(),
                });
                setTimeout(() => {
                  ensureDashboardLoaded().then((ids) => fetchHiddenQuests(ids));
                }, 500);
                enrolled = true;
                break;
              }
              // proxy error → try next country
              if (altData.proxyError === "full" || altData.proxyError === "no_proxy") continue;
              // other error → stop this variant
              break;
            } catch { /* tiếp tục thử variant khác */ }
          }
          if (enrolled) break;
        }
        if (!enrolled) {
          setEnrollResult((prev) => ({
            ...prev,
            [quest.id]: { success: false, message: data.error || "Quest không thể nhận — tất cả variant đều lỗi" },
          }));
          addLog({
            level: "error",
            message: `Không thể tìm thấy quest "${quest.name}" — ${data.error || "không có variant hợp lệ"}`,
            timestamp: Date.now(),
          });
        }
      } else {
        // Lỗi khác — hiển thị message từ server
        setEnrollResult((prev) => ({
          ...prev,
          [quest.id]: { success: false, message: data.error || data.message || "Nhận quest thất bại" },
        }));
        addLog({
          level: "error",
          message: `Nhận quest ẩn "${quest.name}" thất bại: ${data.error || data.message || "Lỗi không xác định"}`,
          timestamp: Date.now(),
        });
      }
    }

    setEnrollLoading(null);

    // Bắt đầu cooldown 30s — tất cả nút hiện "Chờ Xs"
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setEnrollCooldown(30);
    try {
      sessionStorage.setItem(COOLDOWN_STORAGE_KEY, String(Date.now() + 30_000));
    } catch { /* sessionStorage không khả dụng */ }
    cooldownRef.current = setInterval(() => {
      setEnrollCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) { clearInterval(cooldownRef.current); cooldownRef.current = null; }
          try { sessionStorage.removeItem(COOLDOWN_STORAGE_KEY); } catch {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [token, isVerified, addLog]);

  // Filter: hide quests already in user's token (Dashboard), then apply type + 18+ filter
  const filterFn = (q: QuestData) => {
    // Check primary ID and all related IDs (replacementId, questIds) for regional variants
    if (dashboardQuestIds.has(q.id)) return false;
    if (q.replacementId && dashboardQuestIds.has(q.replacementId)) return false;
    if (q.questIds && q.questIds.some(id => dashboardQuestIds.has(id))) return false;
    if (hide18Plus && q.showAgeGate) return false;
    if (questFilter === "video") return isVideoType(q.type);
    if (questFilter === "game") return !isVideoType(q.type);
    return true;
  };

  // Helper: check if a quest is already on Dashboard (by any ID)
  const isOnDashboard = (q: QuestData) =>
    dashboardQuestIds.has(q.id) ||
    (q.replacementId != null && dashboardQuestIds.has(q.replacementId)) ||
    (q.questIds != null && q.questIds.some(id => dashboardQuestIds.has(id)));

  // Count hidden quests by filter (excluding Dashboard quests)
  const hiddenOnly = quests.filter(q => !isOnDashboard(q));
  const videoCount = hiddenOnly.filter(q => isVideoType(q.type)).length;
  const gameCount = hiddenOnly.filter(q => !isVideoType(q.type)).length;

  // Detect: tài khoản không thể nhận quest 18+
  // Discord đưa quest 18+ vào excluded_quests khi tài khoản chưa đủ tuổi
  const excludedSet = new Set(excludedQuestIds);
  const has18PlusRestriction = quests.some(q =>
    excludedSet.has(q.id) && q.isGlobal && q.showAgeGate
  );

  // Sort: 18+ quests xuống cuối cho tài khoản bị giới hạn
  const filteredQuests = quests.filter(filterFn).sort((a, b) => {
    if (has18PlusRestriction) {
      if (a.showAgeGate && !b.showAgeGate) return 1;
      if (!a.showAgeGate && b.showAgeGate) return -1;
    }
    return 0;
  });

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full relative bg-[#0A0B0E]">
      {/* ═══ Top Bar ═══ */}
      <header className="h-12 lg:h-14 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/[0.06] bg-[#0A0B0E]/80 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-display text-base lg:text-lg text-white tracking-[-0.01em]">Quest ẩn</h1>
            <span className="hidden sm:inline text-[11px] font-mono text-white/30">/hidden-quests</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {proxyStats && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              <span className="dot dot-success" style={{ width: 6, height: 6 }} />
              <span className="text-[11px] font-mono text-white/60">{proxyStats.total} proxy</span>
            </div>
          )}
        </div>
      </header>

      {/* ═══ Scrollable area ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide relative">

        {(checking || guildCheckLoading || !guildCheckedOnce || (!isGuildMember && token)) && token ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-20 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-[45vw] h-[45vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(94,106,210,0.18) 0%, transparent 60%)", animation: "aurora-drift-1 8s ease-in-out infinite alternate" }} />
              <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(232,121,249,0.12) 0%, transparent 60%)", animation: "aurora-drift-2 10s ease-in-out infinite alternate" }} />
            </div>
            <div className="relative surface rounded-2xl p-8 sm:p-10 max-w-md w-full flex flex-col items-center" style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(94,106,210,0.1)", transition: "box-shadow 0.6s ease" }}>
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6">
                <div className="absolute -inset-1.5 rounded-2xl gpu-layer" style={{ background: "conic-gradient(from 0deg, #5865F2, #7B8CFF, #5BD6FF, #5CF0AE, #FF8DFB, #5865F2)", animation: "gradient-rotate 4s linear infinite", mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", padding: "2.5px", opacity: 0.9 }} />
                <div className="absolute inset-0 rounded-2xl gpu-layer" style={{ background: "radial-gradient(circle, rgba(88,101,242,0.5) 0%, transparent 70%)", animation: "icon-glow 2s ease-in-out infinite" }} />
                <div className="relative w-full h-full rounded-2xl flex items-center justify-center bg-gradient-to-br from-[#15171D] to-[#11131A] border border-white/[0.08] overflow-hidden">
                  {guildIcon ? <img src={guildIcon} alt="" className="w-full h-full object-cover rounded-2xl" /> : <Users className="w-9 h-9 sm:w-10 sm:h-10 text-[#7B8CFF]" />}
                  {(checking || guildCheckLoading || !guildCheckedOnce) && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                      <div className="absolute -inset-full" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%)", backgroundSize: "200% 100%", animation: "shimmer-sweep 2s linear infinite" }} />
                    </div>
                  )}
                  {!guildCheckLoading && guildCheckedOnce && !isGuildMember && (
                    <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} className="absolute -bottom-1 -right-1 w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center border-2 border-[#0A0B0E]" style={{ background: "linear-gradient(135deg, #F6606F 0%, #C73E50 100%)", boxShadow: "0 4px 12px rgba(246,96,111,0.4)" }}>
                      <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    </motion.div>
                  )}
                </div>
              </div>
              <motion.div key={(checking || guildCheckLoading || !guildCheckedOnce) ? "loading-text" : "locked-text"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col items-center">
                {(checking || guildCheckLoading || !guildCheckedOnce) ? (
                  <>
                    <p className="text-[14px] sm:text-[15px] text-white font-semibold tracking-tight">Đang kiểm tra tư cách thành viên</p>
                    <p className="text-[11px] text-white/40 mt-1.5 font-mono">Guild membership verification</p>
                    <div className="w-32 h-0.5 mt-4 rounded-full overflow-hidden bg-white/[0.06]">
                      <div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, transparent, #5865F2, #7B8CFF, #5865F2, transparent)", backgroundSize: "200% 100%", animation: "progress-sweep 1.5s ease-in-out infinite" }} />
                    </div>
                  </>
                ) : !isGuildMember ? (
                  <>
                    <h3 className="text-display text-xl sm:text-2xl text-white mb-1.5 tracking-tight">Chỉ dành cho thành viên</h3>
                    {guildName && <p className="text-sm font-semibold text-[#5865F2] mb-5 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{guildName}</p>}
                    <a href={GUILD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="group relative inline-flex items-center gap-2 px-5 py-3 rounded-xl btn-sweep font-semibold text-sm transition-all hover:shadow-lg hover:shadow-[#5865F2]/30 w-full justify-center" style={{ background: "linear-gradient(135deg, #5865F2 0%, #4752C4 100%)", color: "#fff", boxShadow: "0 8px 24px rgba(88, 101, 242, 0.35)" }}>
                      <Users className="w-4 h-4" />Tham gia nhóm Discord<svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </a>
                    <p className="text-[10px] text-white/30 mt-3 font-mono">Sau khi tham gia, tải lại trang này</p>
                  </>
                ) : null}
              </motion.div>
            </div>
          </div>
        ) : (
        <>
        {/* Loading shimmer overlay */}
        {loading && quests.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-30 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 shimmer-bar" />
          </div>
        )}

        {/* ═══ Info Banner — Premium aurora surface ═══ */}
        <MotionSection className="px-3 sm:px-4 lg:px-6 pt-3 pb-2">
          <div className="relative surface rounded-xl sm:rounded-2xl overflow-hidden">
            {/* Multi-layer aurora background */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(88,101,242,0.12) 0%, rgba(232,121,249,0.06) 50%, rgba(61,214,140,0.04) 100%)" }} />
            <div className="absolute inset-0 opacity-50" style={{ background: "radial-gradient(ellipse at top left, rgba(88,101,242,0.15) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(232,121,249,0.10) 0%, transparent 50%)" }} />
            {/* Top shimmer line */}
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(88,101,242,0.6), rgba(232,121,249,0.5), transparent)" }} />
            {/* Bottom subtle line */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />

            <div className="relative px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="min-w-0">
                {/* Title row — premium icon + gradient text + animated HIDDEN badge */}
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0" style={{
                    background: "linear-gradient(135deg, #5865F2 0%, #E879F9 100%)",
                    boxShadow: "0 4px 12px rgba(88,101,242,0.35)",
                  }}>
                    <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                    <div className="absolute inset-0 rounded-lg pointer-events-none overflow-hidden">
                      <div className="absolute -inset-full" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.2) 50%, transparent 65%)", backgroundSize: "200% 100%", animation: "shimmer-sweep 3s linear infinite" }} />
                    </div>
                  </div>
                  <p className="text-sm sm:text-base font-bold text-gradient-aurora tracking-tight">Quest ẩn từ Discord</p>
                  <span className="relative px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold bg-[#5865F2]/15 text-[#7B8CFF] border border-[#5865F2]/25 overflow-hidden">
                    <span className="absolute inset-0 pointer-events-none">
                      <span className="absolute -inset-full" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.15) 50%, transparent 65%)", backgroundSize: "200% 100%", animation: "shimmer-sweep 2.5s linear infinite" }} />
                    </span>
                    <span className="relative">HIDDEN</span>
                  </span>
                </div>

                {/* Info pills — clean chip style */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <span className="dot dot-warning" style={{ width: 5, height: 5 }} />
                    <span className="text-[10px] sm:text-[11px] text-white/60 font-medium">Một số quest sẽ không thể nhận do điều kiện tài khoản</span>
                  </span>
                  <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#F6606F]/8 border border-[#F6606F]/15">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-[#F6606F]/20 text-[#F6606F] border border-[#F6606F]/25 leading-none">18+</span>
                    <span className="text-[10px] sm:text-[11px] text-[#F6606F]/80 font-medium">Chỉ cho tài khoản 18+</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </MotionSection>

        {/* ═══ Stats Bar — 3 surface mini cards ═══ */}
        {!loading && quests.length > 0 && (
          <MotionSection className="px-3 sm:px-4 lg:px-6 pb-1.5" delay={0.08}>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {/* Total quests */}
              <div className="surface glass-hover rounded-lg sm:rounded-xl p-2.5 sm:p-3 flex items-center gap-2">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center shrink-0 bg-[#F5B544]/15 border border-[#F5B544]/25 text-[#F5B544]">
                  <Trophy className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="text-display text-base sm:text-lg text-white leading-none tabular-nums">{hiddenOnly.length}</span>
                    <span className="text-[10px] sm:text-[11px] text-white/40 hidden sm:inline">quest</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-white/40 font-mono uppercase tracking-wider hidden sm:block">Tổng</p>
                </div>
              </div>
              {/* Video count */}
              <div className="surface glass-hover rounded-lg sm:rounded-xl p-2.5 sm:p-3 flex items-center gap-2">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center shrink-0 bg-[#F5B544]/15 border border-[#F5B544]/25 text-[#F5B544]">
                  <Video className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="text-display text-base sm:text-lg text-white leading-none tabular-nums">{videoCount}</span>
                    <span className="text-[10px] sm:text-[11px] text-white/40 hidden sm:inline">video</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-white/40 font-mono uppercase tracking-wider hidden sm:block">Video</p>
                </div>
              </div>
              {/* Game count */}
              <div className="surface glass-hover rounded-lg sm:rounded-xl p-2.5 sm:p-3 flex items-center gap-2">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center shrink-0 bg-[#5BC0EB]/15 border border-[#5BC0EB]/25 text-[#5BC0EB]">
                  <Gamepad2 className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="text-display text-base sm:text-lg text-white leading-none tabular-nums">{gameCount}</span>
                    <span className="text-[10px] sm:text-[11px] text-white/40 hidden sm:inline">game</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-white/40 font-mono uppercase tracking-wider hidden sm:block">Game</p>
                </div>
              </div>
            </div>
          </MotionSection>
        )}

        {/* ═══ Quest Section Header + Filter ═══ */}
        <MotionSection className="flex items-center justify-between px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 pb-2" delay={0.1}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm lg:text-base font-semibold text-white flex items-center gap-1.5 sm:gap-2">
                <div className="w-5 h-5 rounded-md bg-[#F5B544]/15 border border-[#F5B544]/25 flex items-center justify-center">
                  <Trophy className="w-3 h-3 text-[#F5B544]" />
                </div>
                Quest khả dụng
              </h3>
              <span className="text-white/40 font-normal text-[10px] sm:text-[11px] lg:text-xs bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded-md font-mono">{filteredQuests.length}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 px-1 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <FilterTab active={questFilter === "all"} color={FILTER_COLORS.all} onClick={() => setQuestFilter("all")} icon={<ListFilter className="w-3.5 h-3.5" />} />
            <FilterTab active={questFilter === "video"} color={FILTER_COLORS.video} onClick={() => setQuestFilter("video")} icon={<Video className="w-3.5 h-3.5" />} />
            <FilterTab active={questFilter === "game"} color={FILTER_COLORS.game} onClick={() => setQuestFilter("game")} icon={<Gamepad2 className="w-3.5 h-3.5" />} />
            {/* 18+ toggle */}
            <button
              onClick={() => setHide18Plus(v => !v)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold transition-colors border cursor-pointer select-none ml-0.5"
              style={{
                backgroundColor: hide18Plus ? "rgba(246,96,111,0.06)" : "rgba(246,96,111,0.15)",
                borderColor: hide18Plus ? "rgba(246,96,111,0.15)" : "rgba(246,96,111,0.35)",
                color: hide18Plus ? "rgba(246,96,111,0.5)" : "#F6606F",
              }}
              title={hide18Plus ? "Hiện quest 18+" : "Ẩn quest 18+"}
            >
              18+
            </button>
          </div>
        </MotionSection>

        {/* ═══ Quest Grid ═══ */}
        <MotionSection className="px-3 sm:px-4 lg:px-6 pb-4 sm:pb-6" delay={0.12}>
          {loading && quests.length === 0 ? (
            /* Skeleton shimmer cards - Aurora surface */
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3 lg:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="surface rounded-xl overflow-hidden animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                  {/* Banner skeleton */}
                  <div className="aspect-video w-full bg-[#11131A] relative overflow-hidden">
                    <div className="absolute inset-0 shimmer-bar" style={{ animationDelay: `${i * 80}ms` }} />
                    {/* Fake badge skeleton */}
                    <div className="absolute top-2 left-2 w-12 h-4 rounded-md bg-white/[0.06]" />
                    <div className="absolute top-2 right-2 w-8 h-4 rounded-md bg-white/[0.06]" />
                  </div>
                  {/* Info skeleton */}
                  <div className="bg-[#0A0B0E] p-2 sm:p-2.5 lg:p-3 flex flex-col gap-1.5">
                    <div className="h-3 w-3/4 rounded bg-white/[0.06] relative overflow-hidden">
                      <div className="absolute inset-0 shimmer-bar" style={{ animationDelay: `${i * 80 + 100}ms` }} />
                    </div>
                    <div className="h-2.5 w-1/2 rounded bg-white/[0.04]" />
                    <div className="h-2 w-2/3 rounded bg-white/[0.03]" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="surface rounded-xl sm:rounded-2xl py-8 sm:py-16 flex flex-col items-center animate-fade-up" style={{ borderColor: "rgba(246, 96, 111, 0.25)" }}>
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-[#F6606F]/10 border border-[#F6606F]/20 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-[#F6606F]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <p className="text-[#F6606F] text-xs sm:text-base font-medium mb-1">{error}</p>
              <p className="text-[9px] sm:text-xs text-white/40 mb-3">Không thể tải danh sách quest ẩn</p>
              <Button variant="ghost" size="sm" onClick={() => fetchHiddenQuests()} className="text-white/60 hover:text-white text-xs">
                Thử lại
              </Button>
            </div>
          ) : filteredQuests.length === 0 ? (
            <div className="surface rounded-xl sm:rounded-2xl py-10 sm:py-16 flex flex-col items-center animate-fade-up">
              <div className="relative mb-4">
                <div className="w-14 h-14 sm:w-18 sm:h-18 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                  <EyeOff className="w-7 h-7 sm:w-9 sm:h-9 text-white/25" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#11131A] border border-white/[0.08] flex items-center justify-center">
                  <span className="text-[8px]">🔍</span>
                </div>
              </div>
              <p className="text-white/60 text-xs sm:text-sm font-medium mb-0.5">Không có quest ẩn nào</p>
              <p className="text-[9px] sm:text-[11px] text-white/40">Tất cả quest đã có trong tài khoản hoặc không khả dụng</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3 lg:gap-4">
              {filteredQuests.map((q, idx) => (
                <div
                  key={q.id}
                  className="quest-enter opacity-0"
                  style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                >
                  <QuestCard16x9
                    quest={q}
                    onEnroll={handleEnroll}
                    enrollLoading={enrollLoading}
                    enrollResult={enrollResult}
                    proxyAvail={getProxyAvailForQuest(q)}
                    cooldownSecs={enrollCooldown}
                  />
                </div>
              ))}
            </div>
          )}
        </MotionSection>
        </>
        )}
      </div>
    </div>
  );
}
