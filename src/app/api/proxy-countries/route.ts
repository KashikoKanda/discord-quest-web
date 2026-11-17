import { NextResponse } from "next/server";
import { fetchProxyList } from "@/lib/proxyList";

/**
 * GET /api/proxy-countries
 *
 * Returns list of available proxy countries from the GitHub proxy pool.
 * Frontend uses this to render the Proxy Selector dropdown.
 *
 * Response: { countries: [{ code, label, flag, count }] }
 */
const COUNTRY_INFO: Record<string, { label: string; flag: string }> = {
  US: { label: "United States", flag: "🇺🇸" },
  GB: { label: "United Kingdom", flag: "🇬🇧" },
  CA: { label: "Canada", flag: "🇨🇦" },
  JP: { label: "Japan", flag: "🇯🇵" },
  SG: { label: "Singapore", flag: "🇸🇬" },
  DE: { label: "Germany", flag: "🇩🇪" },
  FR: { label: "France", flag: "🇫🇷" },
  AU: { label: "Australia", flag: "🇦🇺" },
  KR: { label: "South Korea", flag: "🇰🇷" },
  IT: { label: "Italy", flag: "🇮🇹" },
  ES: { label: "Spain", flag: "🇪🇸" },
  NL: { label: "Netherlands", flag: "🇳🇱" },
  SE: { label: "Sweden", flag: "🇸🇪" },
  FI: { label: "Finland", flag: "🇫🇮" },
  DK: { label: "Denmark", flag: "🇩🇰" },
  NO: { label: "Norway", flag: "🇳🇴" },
  AT: { label: "Austria", flag: "🇦🇹" },
  BE: { label: "Belgium", flag: "🇧🇪" },
  CH: { label: "Switzerland", flag: "🇨🇭" },
  IE: { label: "Ireland", flag: "🇮🇪" },
  PL: { label: "Poland", flag: "🇵🇱" },
  BR: { label: "Brazil", flag: "🇧🇷" },
  MX: { label: "Mexico", flag: "🇲🇽" },
  AR: { label: "Argentina", flag: "🇦🇷" },
  CL: { label: "Chile", flag: "🇨🇱" },
  IN: { label: "India", flag: "🇮🇳" },
  ID: { label: "Indonesia", flag: "🇮🇩" },
  TH: { label: "Thailand", flag: "🇹🇭" },
  VN: { label: "Vietnam", flag: "🇻🇳" },
  PH: { label: "Philippines", flag: "🇵🇭" },
  MY: { label: "Malaysia", flag: "🇲🇾" },
  HK: { label: "Hong Kong", flag: "🇭🇰" },
  TW: { label: "Taiwan", flag: "🇹🇼" },
  SA: { label: "Saudi Arabia", flag: "🇸🇦" },
  AE: { label: "UAE", flag: "🇦🇪" },
  ZA: { label: "South Africa", flag: "🇿🇦" },
  TR: { label: "Turkey", flag: "🇹🇷" },
  IL: { label: "Israel", flag: "🇮🇱" },
  EG: { label: "Egypt", flag: "🇪🇬" },
};

export async function GET() {
  try {
    const proxies = await fetchProxyList();
    const countryCounts = new Map<string, number>();
    for (const p of proxies) {
      if (p.countryCode) {
        const cc = p.countryCode.toUpperCase();
        countryCounts.set(cc, (countryCounts.get(cc) || 0) + 1);
      }
    }

    const countries = Array.from(countryCounts.entries())
      .map(([code, count]) => ({
        code,
        label: COUNTRY_INFO[code]?.label || code,
        flag: COUNTRY_INFO[code]?.flag || "🏳️",
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      countries,
      total: proxies.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}
