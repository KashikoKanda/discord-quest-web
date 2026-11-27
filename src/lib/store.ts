import { create } from "zustand";

export interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string;
  discriminator: string;
  avatar: string | null;
  email?: string;
  phone?: string;
  mfa_enabled: boolean;
  flags: number;
  premium_type: number;
  locale: string;
  verified: boolean;
  banner?: string | null;
  accent_color?: number | null;
  avatar_decoration?: unknown;
  orbs?: number;
  store_country?: string | null;
}

export interface QuestData {
  id: string;
  name: string;
  description: string;
  type: string;
  status: "available" | "enrolled" | "running" | "completed" | "unclaimed" | "expired" | "failed";
  progress: number;
  expiresAt?: string;
  enrolledAt?: string;
  completedAt?: string;
  reward: string;
  rewardIconUrl?: string;
  bannerUrl?: string;
  applicationId?: string | null;
  applicationName?: string;
  applicationIconUrl?: string;
  target: number;
  targetLabel: string;
  gameTitle: string;
  gamePublisher: string;
  primaryColor: string;
  secondaryColor: string;
  heroAsset: string;
  gameTileAsset: string;
  logotypeAsset: string;
  logotypeLight: string;
  isEnrolled: boolean;
  isClaimed: boolean;
  orbsReward: number | null;
  regions?: string[];        // Region codes from /api/regions (e.g. ["US","BR","JP"])
  isGlobal?: boolean | null; // true=global, false=regional, null=unknown (no data)
  replacementId?: string;    // If this quest replaces another quest ID
  showAgeGate?: boolean;     // true = 18+ age-restricted quest
  hasRegionData?: boolean;   // Whether region data was found from API
  questIds?: string[];       // All quest IDs merged into this card (for regional variants)
}

export interface LogEntry {
  id: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  timestamp: number;
}

interface AppState {
  // Auth - single token per session
  isLoggedIn: boolean;
  token: string | null;
  profile: DiscordProfile | null;
  workerStatus: "idle" | "running" | "error";
  quests: QuestData[];
  orbsBalance: number;
  excludedQuestIds: string[];  // Quest IDs excluded by Discord (e.g. 18+ restricted)

  // Auto-claim control
  autoClaimEnabled: boolean;
  isVerified: boolean;

  // Auto-quest loop control (separate from auto-claim).
  // When true, client calls /api/quests/auto-loop to enable server-side
  // background loop that re-checks Discord every 60s and runs any
  // not-completed quest automatically.
  autoQuestEnabled: boolean;
  // Multi-quest mode: true = làm tất cả quest (tuần tự), false = chỉ 1 quest/lần (an toàn hơn)
  multiQuestEnabled: boolean;
  // Auto-Nitro: tự động mua Nitro 3-day bằng orbs khi đủ balance
  autoNitroEnabled: boolean;

  // Guild membership check
  isGuildMember: boolean;
  guildCheckLoading: boolean;
  guildCheckedOnce: boolean; // true after first guild check completes (prevents showing locked state before check)
  guildName: string | null;
  guildIcon: string | null;

  // Session ID — single login enforcement (1 token = 1 browser)
  sessionId: string | null;
  // Session check status — true while verifying session with server (prevents Dashboard flash)
  sessionChecking: boolean;

  // UI
  page: "login" | "dashboard" | "settings" | "hidden" | "extension";
  sidebarOpen: boolean;

  // Logs
  logs: LogEntry[];

  // Actions
  login: (token: string, profile: DiscordProfile) => void;
  logout: () => void;
  setWorkerStatus: (status: AppState["workerStatus"]) => void;
  setQuests: (quests: QuestData[], orbsBalance?: number, excludedQuestIds?: string[]) => void;
  updateQuestProgress: (questId: string, progress: number, status?: string) => void;
  setPage: (page: AppState["page"]) => void;
  setSidebarOpen: (open: boolean) => void;
  setAutoClaimEnabled: (enabled: boolean) => void;
  setAutoQuestEnabled: (enabled: boolean) => void;
  setAutoNitroEnabled: (enabled: boolean) => void;
  setMultiQuestEnabled: (enabled: boolean) => void;
  hideQuestBanners: boolean;
  setHideQuestBanners: (v: boolean) => void;
  setGuildMember: (isMember: boolean, guildName?: string | null, guildIcon?: string | null) => void;
  setGuildCheckLoading: (loading: boolean) => void;
  addLog: (log: Omit<LogEntry, "id">) => void;
  resetState: () => void;
  restoreSession: () => Promise<void>;
}

// Use localStorage so token persists across tab closes (like reload)
// Token clears only on explicit logout
const storage = typeof window !== "undefined" ? localStorage : null;

export const useAppStore = create<AppState>((set, get) => ({
  isLoggedIn: false,
  token: null,
  profile: null,
  workerStatus: "idle",
  quests: [],
  orbsBalance: 0,
  excludedQuestIds: [],
  autoClaimEnabled: true,
  isVerified: false,
  autoQuestEnabled: false,
  multiQuestEnabled: false,
  autoNitroEnabled: false,
  hideQuestBanners: false,
  isGuildMember: false,
  guildCheckLoading: false,
  guildCheckedOnce: false,
  guildName: null,
  guildIcon: null,
  sessionId: null,
  sessionChecking: false,
  page: "login",
  sidebarOpen: false,
  logs: [],

  login: (token, profile) => {
    const verified = profile.verified === true;
    const autoClaim = verified;
    const persistedAutoQuest = storage ? storage.getItem("dq_auto_quest") === "true" : false;
    const autoQuest = verified && persistedAutoQuest;
    const persistedMultiQuest = storage ? storage.getItem("dq_multi_quest") === "true" : false;
    const persistedAutoNitro = storage ? storage.getItem("dq_auto_nitro") === "true" : false;
    const persistedHideBanners = storage ? storage.getItem("dq_hide_banners") === "true" : false;
    // Restore or generate sessionId (persisted per browser)
    let sid = storage ? storage.getItem("dq_session_id") : null;
    if (!sid) {
      sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      if (storage) storage.setItem("dq_session_id", sid);
    }
    // Lưu token vào localStorage CỦA CHÍNH TRÌNH DUYỆT OWNER (không gửi đi đâu
    // khác ngoài server mình, qua HTTPS). Render gói free không gắn được đĩa nên
    // mỗi lần deploy DB bị xoá sạch; giữ token ở trình duyệt giúp trang tự đăng
    // nhập lại thay vì bắt owner dán token lại.
    if (storage) {
      storage.setItem("dq_token", token);
      try { storage.setItem("dq_profile", JSON.stringify(profile)); } catch {}
    }
    set({
      isLoggedIn: true,
      token,
      profile,
      workerStatus: "idle",
      quests: [],
      isVerified: verified,
      autoClaimEnabled: autoClaim,
      autoQuestEnabled: autoQuest,
      multiQuestEnabled: persistedMultiQuest,
      autoNitroEnabled: persistedAutoNitro,
      hideQuestBanners: persistedHideBanners,
      sessionId: sid,
      isGuildMember: false,
      guildCheckLoading: true,
      guildCheckedOnce: false,
      page: "dashboard",
    });
    if (storage) {
      storage.setItem("dq_token", token);
      storage.setItem("dq_profile", JSON.stringify(profile));
      storage.setItem("dq_autoClaim", String(autoClaim));
      storage.setItem("dq_verified", String(verified));
      storage.setItem("dq_last_check", String(Date.now()));
      storage.setItem("dq_auto_quest", String(autoQuest));
    }
  },

  logout: () => {
    if (storage) { storage.removeItem("dq_token"); storage.removeItem("dq_profile"); }
    // Release server-side resources (proxy SIDs, QuestWorker, Session) before clearing state
    const currentToken = get().token;
    const currentSid = get().sessionId;
    if (currentToken) {
      const tokenId = `t_${currentToken.slice(0, 16)}`;
      // Send logout signal to session manager (removes session immediately)
      if (currentSid) {
        fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logout", tokenId, sessionId: currentSid }),
        }).catch(() => { /* Don't block logout on network errors */ });
      }
      fetch("/api/auth/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, immediate: true }),
      }).catch(() => { /* Don't block logout on network errors */ });
    }

    if (storage) {
      storage.removeItem("dq_token");
      storage.removeItem("dq_profile");
      storage.removeItem("dq_autoClaim");
      storage.removeItem("dq_verified");
      storage.removeItem("dq_last_check");
      storage.removeItem("dq_guild_member");
      storage.removeItem("dq_guild_name");
      storage.removeItem("dq_guild_icon");
      // Note: dq_session_id is KEPT so same browser can re-login without conflict
    }
    set({
      isLoggedIn: false,
      token: null,
      profile: null,
      workerStatus: "idle",
      quests: [],
      orbsBalance: 0,
      excludedQuestIds: [],
      isVerified: false,
      autoClaimEnabled: true,
      autoQuestEnabled: false,
      multiQuestEnabled: false,
      autoNitroEnabled: false,
      isGuildMember: false,
      guildCheckLoading: false,
      guildCheckedOnce: false,
      guildName: null,
      guildIcon: null,
      page: "login",
      sidebarOpen: false,
      logs: [],
    });
  },

  setWorkerStatus: (status) => set({ workerStatus: status }),

  setQuests: (quests, orbsBalance, excludedQuestIds) => set({ quests, ...(orbsBalance !== undefined ? { orbsBalance } : {}), ...(excludedQuestIds !== undefined ? { excludedQuestIds } : {}) }),

  updateQuestProgress: (questId, progress, status) => {
    set((state) => ({
      quests: state.quests.map((q) =>
        q.id === questId
          ? { ...q, progress, ...(status ? { status: status as QuestData["status"] } : {}) }
          : q
      ),
    }));
  },

  setPage: (page) => set({ page }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setAutoClaimEnabled: (enabled) => {
    const { isVerified } = get();
    if (enabled && !isVerified) return;
    set({ autoClaimEnabled: enabled });
    if (storage) {
      storage.setItem("dq_autoClaim", String(enabled));
    }
  },

  setAutoQuestEnabled: (enabled) => {
    set({ autoQuestEnabled: enabled });
    if (storage) {
      storage.setItem("dq_auto_quest", String(enabled));
    }
  },

  setAutoNitroEnabled: (enabled) => {
    set({ autoNitroEnabled: enabled });
    if (storage) {
      storage.setItem("dq_auto_nitro", String(enabled));
    }
  },

  setMultiQuestEnabled: (enabled) => {
    set({ multiQuestEnabled: enabled });
    if (storage) {
      storage.setItem("dq_multi_quest", String(enabled));
    }
  },

  // Tắt banner quest để khỏi tải ảnh bìa thừa (chỉ ảnh hưởng hiển thị).
  setHideQuestBanners: (v) => {
    set({ hideQuestBanners: v });
    if (storage) storage.setItem("dq_hide_banners", String(v));
  },

  setGuildMember: (isMember, guildName, guildIcon) => {
    set({
      isGuildMember: isMember,
      ...(guildName !== undefined ? { guildName } : {}),
      ...(guildIcon !== undefined ? { guildIcon } : {}),
    });
    // Only persist guild name/icon (for UI display), NOT isGuildMember
    // Membership must be re-verified from API on every page load to prevent stale state
    if (storage) {
      if (guildName !== undefined) storage.setItem("dq_guild_name", guildName || "");
      if (guildIcon !== undefined) storage.setItem("dq_guild_icon", guildIcon || "");
      // Nhớ kết quả đã xác nhận để lần vào sau hiện đúng ngay, không lóe thẻ
      // khoá trong lúc chờ kiểm tra lại (vẫn kiểm lại mỗi phiên).
      if (isMember === true) storage.setItem("dq_guild_member", "true");
      else if (isMember === false) storage.removeItem("dq_guild_member");
    }
  },

  setGuildCheckLoading: (loading) => set({ guildCheckLoading: loading, ...(loading ? {} : { guildCheckedOnce: true }) }),

  addLog: (log) => {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      logs: [{ ...log, id }, ...state.logs].slice(0, 200),
    }));
  },

  resetState: () => {
    set({
      workerStatus: "idle",
      quests: [],
      orbsBalance: 0,
      excludedQuestIds: [],
      logs: [],
      page: "dashboard",
    });
  },

  restoreSession: async () => {
    if (!storage) return;
    try {
      const token = storage.getItem("dq_token");
      const profileRaw = storage.getItem("dq_profile");
      const autoClaimRaw = storage.getItem("dq_autoClaim");
      const autoQuestRaw = storage.getItem("dq_auto_quest");
      const multiQuestRaw = storage.getItem("dq_multi_quest");
      const autoNitroRaw = storage.getItem("dq_auto_nitro");
      const verifiedRaw = storage.getItem("dq_verified");
      const guildMemberRaw = storage.getItem("dq_guild_member");
      const guildNameRaw = storage.getItem("dq_guild_name");
      const guildIconRaw = storage.getItem("dq_guild_icon");
      const sid = storage.getItem("dq_session_id");
      if (token && profileRaw) {
        // ─── Verify session with server BEFORE entering Dashboard ───
        // Tránh IP bị Discord nhận diện khi session đã bị evict
        const tokenId = `t_${token.slice(0, 16)}`;
        set({ sessionChecking: true });

        // KHÔNG gọi /api/auth/login ở đây nữa. Trước đây mỗi lần khôi phục phiên
        // lại POST login không kèm clientVerified → rơi vào đường login QUA PROXY
        // của server, tạo request thứ hai mang cùng token từ IP/identity khác.
        // Log Render 23:27:00 ghi đúng "[Auth Login] Người dùng login từ VN ·
        // pool có: VN" rồi proxy trả 401 ngay sau khi trình duyệt vừa đăng nhập.

        try {
          const checkRes = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: sid ? "heartbeat" : "register",
              tokenId,
              sessionId: sid,
            }),
          });

          if (!checkRes.ok && checkRes.status === 409) {
            // 409 Conflict → token đã login ở browser khác → logout thật
            console.log("[restoreSession] Session 409 — token logged in elsewhere");
            storage.removeItem("dq_token");
            storage.removeItem("dq_profile");
            storage.removeItem("dq_autoClaim");
            storage.removeItem("dq_verified");
            storage.removeItem("dq_last_check");
            storage.removeItem("dq_guild_member");
            storage.removeItem("dq_guild_name");
            storage.removeItem("dq_guild_icon");
            set({ sessionChecking: false, isLoggedIn: false, token: null, profile: null, page: "login" });
            return;
          }

          // 401 (session_not_found) — server có thể restart → register lại
          // Các status khác (500, network error) → vẫn vào Dashboard, không logout
          if (checkRes.status === 401 && sid) {
            // Session bị evict do server restart → thử register lại với sid cũ
            const regRes = await fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "register", tokenId, sessionId: sid }),
            });
            if (!regRes.ok) {
              // Register fail (409 = login elsewhere) → logout
              storage.removeItem("dq_token");
              storage.removeItem("dq_profile");
              storage.removeItem("dq_autoClaim");
              storage.removeItem("dq_verified");
              storage.removeItem("dq_last_check");
              storage.removeItem("dq_guild_member");
              storage.removeItem("dq_guild_name");
              storage.removeItem("dq_guild_icon");
              set({ sessionChecking: false, isLoggedIn: false, token: null, profile: null, page: "login" });
              return;
            }
          }

          const data = await checkRes.json().catch(() => ({}));
          if (data.sessionId && data.sessionId !== sid) {
            storage.setItem("dq_session_id", data.sessionId);
          }
        } catch {
          // Network error — vẫn vào Dashboard (không logout)
          // Heartbeat sẽ retry sau 5s, nếu thật sự evict thì mới logout
          console.warn("[restoreSession] Network error — entering Dashboard without session check");
        }

        const profile = JSON.parse(profileRaw) as DiscordProfile;
        const verified = verifiedRaw === "true" || profile.verified === true;
        const autoClaim = verified ? (autoClaimRaw !== "false") : false;
        const autoQuestPref = autoQuestRaw === "true" && verified;
        const multiQuestPref = multiQuestRaw === "true";
        const autoNitroPref = autoNitroRaw === "true";
        const guildName = guildNameRaw || null;
        const guildIcon = guildIconRaw || null;
        const restoredSid = storage.getItem("dq_session_id");
        set({
          isLoggedIn: true,
          token,
          profile,
          workerStatus: "idle",
          quests: [],
          isVerified: verified,
          autoClaimEnabled: autoClaim,
          autoQuestEnabled: autoQuestPref,
          multiQuestEnabled: multiQuestPref,
          autoNitroEnabled: autoNitroPref,
          hideQuestBanners: storage.getItem("dq_hide_banners") === "true",
          sessionId: restoredSid,
          sessionChecking: false,
          // Dùng kết quả đã xác nhận trước đó (nếu có) để không lóe thẻ khoá;
          // mỗi phiên vẫn kiểm tra lại ngầm.
          isGuildMember: guildMemberRaw === "true",
          guildCheckLoading: true,
          guildCheckedOnce: false,
          guildName,
          guildIcon,
          page: "dashboard",
        });
      }
    } catch { /* ignore */ }
  },

}));
