/**
 * Nitro Manager — Mua Nitro 3-day bằng Orbs
 *
 * Discord API flow (CHÍNH XÁC, đã test thành công 02/11/2026):
 * 1. GET /v9/users/@me/virtual-currency/balance → check orbs (≥1400)
 * 2. POST /v9/billing/orders → tạo order (status:1 pending)
 * 3. POST /v9/billing/orders/{order_id}/sign → submit (status:2 completed, trừ orbs, cấp Nitro)
 *
 * SKU 3-day đã confirm: 1333912750274904064 (1400 orbs, payment_gateway:8)
 * Currency: "discord_orb" (string)
 * Không cần purchase_token/load_id như endpoint v10/store/skus/{sku}/purchase (đó là endpoint SAI)
 */

import { discordFetch, getVirtualCurrencyBalance } from "./discord";

// ──────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────

const NITRO_3DAY_SKU_ID = "1333912750274904064"; // Discord Nitro 3-day Credit
const NITRO_3DAY_ORB_PRICE = 1400;
const MIN_ORBS_REQUIRED = NITRO_3DAY_ORB_PRICE; // Cần đúng 1400 orbs
const DISCORD_API_V9 = "https://discord.com/api/v9";

// ──────────────────────────────────────────────────
// Global State (per-token purchase lock — tránh double click)
// ──────────────────────────────────────────────────

declare global {
  var nitroPurchaseInProgress: Set<string> | undefined;
}

function getInProgressSet(): Set<string> {
  if (!globalThis.nitroPurchaseInProgress) {
    globalThis.nitroPurchaseInProgress = new Set();
  }
  return globalThis.nitroPurchaseInProgress;
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Random delay nhỏ giữa 2 bước create order + sign (anti-spam, như Discord client thật)
function randomSmallDelay(): Promise<void> {
  const delay = Math.floor(Math.random() * 1500) + 800; // 0.8s - 2.3s
  return sleep(delay);
}

// ──────────────────────────────────────────────────
// V9 billing orders API
// ──────────────────────────────────────────────────

interface V9OrderResponse {
  id: string;
  status: number; // 1=pending, 2=completed, 3=failed
  order_line_items?: Array<{ id: string; sku_id: string; quantity: number; purchase_type: number }>;
  billing_facet?: {
    payment_gateway: number;
    invoice_preview?: {
      total: number;
      currency: string;
    };
  };
  unsatisfied_constraints?: Array<{ name: string; reason_code: number }>;
  error?: string | null;
}

/**
 * Lấy headers cho V9 API (giống Discord client thật)
 */
async function buildV9Headers(token: string, tokenId: string): Promise<HeadersInit> {
  const superProps = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: "1.0.1147",
    os_version: "10.0.19045",
    os_arch: "x64",
    system_locale: "vi-VN",
    browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.1147 Chrome/126.0.6478.234 Electron/31.2.0 Safari/537.36",
    browser_version: "31.2.0",
    client_build_number: 310834,
    native_build_number: 50504,
    client_event_source: null,
    design_id: null,
  };

  const contextProps = {
    location: "Store Page",
    location_guild_id: null,
    location_channel_id: null,
    location_channel_type: null,
  };

  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.1147 Chrome/126.0.6478.234 Electron/31.2.0 Safari/537.36",
    "X-Super-Properties": btoa(JSON.stringify(superProps)),
    "X-Discord-Locale": "vi",
    "X-Context-Properties": btoa(JSON.stringify(contextProps)),
  };
}

/**
 * Bước 1: Tạo order pending
 * Body chính xác đã test thành công.
 */
async function createNitroOrder(token: string, tokenId: string): Promise<{ ok: boolean; order?: V9OrderResponse; error?: string }> {
  try {
    const headers = await buildV9Headers(token, tokenId);
    const body = {
      order_line_items: [
        {
          sku_id: NITRO_3DAY_SKU_ID,
          quantity: 1,
          purchase_type: 1,
        },
      ],
      billing_facet: {
        payment_gateway: 8, // Virtual Currency (orbs)
        currency: "discord_orb",
      },
      gifting_facet: { is_gift: false },
      location_facet: {},
      subscription_facet: {},
    };

    const res = await fetch(`${DISCORD_API_V9}/billing/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data: V9OrderResponse;
    try { data = JSON.parse(text); } catch { data = { id: "", status: 0, error: text }; }

    if (!res.ok) {
      // Discord có thể trả 200 với unsatisfied_constraints nếu balance không đủ
      if (res.status === 200 && data.unsatisfied_constraints && data.unsatisfied_constraints.length > 0) {
        const constraint = data.unsatisfied_constraints[0];
        if (constraint.name === "virtual_currency.sufficient_orb_balance") {
          return { ok: false, error: `Không đủ Orbs (cần ${NITRO_3DAY_ORB_PRICE} orbs)` };
        }
        return { ok: false, error: `Constraint: ${constraint.name}` };
      }
      return { ok: false, error: `Tạo order thất bại (${res.status}): ${text.slice(0, 200)}` };
    }

    // 200 nhưng có constraint → cũng fail
    if (data.unsatisfied_constraints && data.unsatisfied_constraints.length > 0) {
      const constraint = data.unsatisfied_constraints[0];
      if (constraint.name === "virtual_currency.sufficient_orb_balance") {
        return { ok: false, error: `Không đủ Orbs (cần ${NITRO_3DAY_ORB_PRICE} orbs)` };
      }
      return { ok: false, error: `Constraint: ${constraint.name}` };
    }

    if (!data.id) {
      return { ok: false, error: "Order ID rỗng" };
    }

    return { ok: true, order: data };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Bước 2: Sign order → submit → trừ orbs → cấp Nitro
 */
async function signOrder(token: string, tokenId: string, orderId: string): Promise<{ ok: boolean; order?: V9OrderResponse; error?: string }> {
  try {
    const headers = await buildV9Headers(token, tokenId);
    const res = await fetch(`${DISCORD_API_V9}/billing/orders/${orderId}/sign`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    const text = await res.text();
    let data: V9OrderResponse;
    try { data = JSON.parse(text); } catch { data = { id: orderId, status: 0, error: text }; }

    if (!res.ok) {
      // 400 với constraint → thiếu orbs (đã check nhưng vẫn báo)
      if (data.unsatisfied_constraints && data.unsatisfied_constraints.length > 0) {
        const constraint = data.unsatisfied_constraints[0];
        if (constraint.name === "virtual_currency.sufficient_orb_balance") {
          return { ok: false, error: `Không đủ Orbs (cần ${NITRO_3DAY_ORB_PRICE} orbs)` };
        }
        return { ok: false, error: `Constraint: ${constraint.name}` };
      }
      return { ok: false, error: `Sign order thất bại (${res.status}): ${text.slice(0, 200)}` };
    }

    if (data.status !== 2) {
      return { ok: false, error: `Order status không phải completed (status=${data.status})` };
    }

    return { ok: true, order: data };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────
// Core API
// ──────────────────────────────────────────────────

export async function autoPurchaseNitro(
  tokenId: string,
  token: string
): Promise<{ success: boolean; message: string; orbsBalance?: number }> {
  const inProgress = getInProgressSet();
  if (inProgress.has(tokenId)) {
    return { success: false, message: "Đang mua Nitro, vui lòng chờ..." };
  }

  inProgress.add(tokenId);
  try {
    console.log(`[NitroManager] Bắt đầu flow mua Nitro cho ${tokenId.slice(0, 12)}...`);

    // Bước 1: Check orbs balance
    console.log(`[NitroManager] Check orbs balance...`);
    const balance = await getVirtualCurrencyBalance(token, tokenId);
    console.log(`[NitroManager] Balance: ${balance} orbs`);

    if (balance < NITRO_3DAY_ORB_PRICE) {
      return {
        success: false,
        message: `Không đủ Orbs (${balance}/${NITRO_3DAY_ORB_PRICE})`,
        orbsBalance: balance,
      };
    }

    // Bước 2: Tạo order pending
    console.log(`[NitroManager] Tạo order cho SKU ${NITRO_3DAY_SKU_ID}...`);
    const createRes = await createNitroOrder(token, tokenId);
    if (!createRes.ok || !createRes.order) {
      console.error(`[NitroManager] Tạo order thất bại:`, createRes.error);
      return {
        success: false,
        message: createRes.error || "Tạo order thất bại",
        orbsBalance: balance,
      };
    }

    const orderId = createRes.order.id;
    console.log(`[NitroManager] ✅ Order created: ${orderId} (status=${createRes.order.status})`);

    // Random delay nhỏ giữa create và sign (như Discord client)
    await randomSmallDelay();

    // Bước 3: Sign order → submit
    console.log(`[NitroManager] Sign order ${orderId}...`);
    const signRes = await signOrder(token, tokenId, orderId);
    if (!signRes.ok) {
      console.error(`[NitroManager] Sign order thất bại:`, signRes.error);
      return {
        success: false,
        message: signRes.error || "Sign order thất bại",
        orbsBalance: balance,
      };
    }

    console.log(`[NitroManager] ✅ Order signed: status=${signRes.order?.status}`);

    // Bước 4: Verify balance mới (trừ orbs)
    let newBalance = balance - NITRO_3DAY_ORB_PRICE;
    try {
      const freshBal = await getVirtualCurrencyBalance(token, tokenId);
      if (typeof freshBal === "number") newBalance = freshBal;
    } catch { /* ignore */ }

    console.log(`[NitroManager] ✅✅ Mua Nitro thành công cho ${tokenId.slice(0, 12)}...`);

    return {
      success: true,
      message: `Đã mua Nitro 3-day thành công! Order #${orderId}`,
      orbsBalance: newBalance,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi: ${msg}` };
  } finally {
    inProgress.delete(tokenId);
  }
}

export function getNitroStatus(tokenId: string): {
  inProgress: boolean;
} {
  return {
    inProgress: getInProgressSet().has(tokenId),
  };
}

export const NITRO_CONFIG = {
  skuId: NITRO_3DAY_SKU_ID,
  orbPrice: NITRO_3DAY_ORB_PRICE,
  minOrbs: MIN_ORBS_REQUIRED,
};
