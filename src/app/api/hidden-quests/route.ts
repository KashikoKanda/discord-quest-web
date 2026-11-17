import { NextResponse } from "next/server";

interface ApiQuestConfig {
  id: string;
  config: {
    id: string;
    config_version: number;
    starts_at: string;
    expires_at: string;
    features: number[];
    application?: {
      link: string;
      id: string;
      name: string;
    };
    assets: {
      hero: string;
      hero_video: string | null;
      quest_bar_hero: string;
      quest_bar_hero_video: string | null;
      game_tile: string;
      logotype: string;
    };
    colors: {
      primary: string;
      secondary: string;
    };
    messages: {
      quest_name: string;
      game_title: string;
      game_publisher: string;
    };
    task_config: {
      type: number;
      join_operator: "and" | "or";
      tasks: Record<string, {
        event_name: string;
        target: number;
        external_ids: string[];
      }>;
    };
    task_config_v2?: {
      type: number;
      join_operator: "and" | "or";
      tasks: Record<string, {
        event_name: string;
        target: number;
        external_ids: string[];
        applications?: Array<{ id: string }>;
        application_id?: string;
      }>;
    };
    rewards_config: {
      assignment_method: number;
      rewards: Array<{
        type: number;
        sku_id: string;
        asset: string;
        asset_video: string | null;
        messages: {
          name: string;
          name_with_article: string;
        };
        approximate_count: number | null;
        redemption_link: string | null;
        orb_quantity?: number | null;
      }>;
      rewards_expire_at: string;
      platforms: number[];
    };
    share_policy?: string;
  };
}

function getQuestType(quest: ApiQuestConfig): string {
  // Try task_config_v2 first (same format as main Discord API)
  const taskConfigV2 = (quest.config as Record<string, unknown>)?.task_config_v2 as ApiQuestConfig["config"]["task_config"] | undefined;
  if (taskConfigV2?.tasks) {
    const knownTypes = [
      "WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE",
      "PLAY_ON_DESKTOP", "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION",
      "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "ACHIEVEMENT_IN_ACTIVITY",
    ];
    const taskMapV2 = taskConfigV2.tasks;
    for (const t of knownTypes) {
      if (taskMapV2[t] != null) return t;
    }
    // Fallback: return first key from v2
    const v2Names = Object.keys(taskMapV2);
    if (v2Names.length > 0) return v2Names[0];
  }

  // Fallback to task_config (v1)
  const taskConfig = quest.config?.task_config;
  if (taskConfig?.tasks) {
    const taskNames = Object.keys(taskConfig.tasks);
    if (taskNames.length > 0) return taskNames[0];
  }

  return "UNKNOWN";
}

function getTargetLabel(type: string, targetSeconds: number): string {
  const minutes = Math.ceil(targetSeconds / 60);
  if (type.startsWith("WATCH_VIDEO") || type === "STREAM_ON_DESKTOP") return `${minutes} phút stream`;
  if (type.startsWith("PLAY_")) return `${minutes} phút chơi`;
  return `${minutes} phút`;
}

export const maxDuration = 30; // Allow up to 30 seconds for API calls

export async function GET() {
  try {
    // AbortController for timeout protection
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    // Fetch quests and regions in parallel
    const [questsRes, regionsRes] = await Promise.all([
      fetch("https://api.discordquest.com/api/quests", {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      }),
      fetch("https://api.discordquest.com/api/regions", {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      }),
    ]);

    clearTimeout(timeout);

    if (!questsRes.ok) {
      return NextResponse.json({ success: false, error: `Quests API returned ${questsRes.status}` }, { status: 502 });
    }

    // Parse the full quests JSON and immediately filter to only active quests
    // to reduce memory pressure (1.5MB → ~50KB of active quests)
    const allQuests: ApiQuestConfig[] = await questsRes.json();
    const now = Date.now();

    // Quest names to hide from the list
    const HIDDEN_QUEST_NAMES = ["[TEST] Cloud", "Tiered Rewards V2", "Sky Runners V2"];

    // Pre-filter: only keep non-expired quests, discard the rest to free memory
    const quests = allQuests.filter((q) => {
      if (!q.config?.expires_at) return false;
      // Hide specific quests by name
      const questName = q.config?.messages?.quest_name || "";
      if (HIDDEN_QUEST_NAMES.includes(questName)) return false;
      try {
        return new Date(q.config.expires_at).getTime() > now;
      } catch { return false; }
    });

    // Free memory from the large allQuests array ASAP
    if ((global as { gc?: () => void }).gc) (global as { gc?: () => void }).gc!();

    // Build region lookup map: questId → { isGlobal, regions, excludedRegions, replacementId, showAgeGate }
    // Also build reverse map: replacement_id → aggregated region info from all variants
    const regionMap = new Map<string, { isGlobal: boolean; regions: string[]; excludedRegions: string[]; replacementId?: string; showAgeGate?: boolean }>();
    const reverseRegionMap = new Map<string, { regions: string[]; excludedRegions: string[]; isGlobal: boolean; showAgeGate: boolean }>();
    if (regionsRes.ok) {
      try {
        const regionsData = await regionsRes.json();
        const regionQuests = regionsData?.quests || [];
        for (const rq of regionQuests) {
          // Parse regions: support both old array format and new {include, exclude} object format
          // Old format: regions = ["US", "CA", "UK"]
          // New format: regions = { include: ["US"], exclude: ["CA"] }
          let includedRegions: string[] = [];
          let excludedRegions: string[] = [];
          if (Array.isArray(rq.regions)) {
            includedRegions = (rq.regions as string[]).filter((r: string) => r !== "");
          } else if (rq.regions && typeof rq.regions === "object") {
            const reg = rq.regions as Record<string, string[]>;
            if (Array.isArray(reg.include)) {
              includedRegions = reg.include.filter((r: string) => r !== "");
            }
            if (Array.isArray(reg.exclude)) {
              excludedRegions = reg.exclude.filter((r: string) => r !== "");
            }
          }

          const info = {
            isGlobal: rq.is_global ?? false,
            regions: includedRegions,
            excludedRegions,
            replacementId: rq.replacement_id || undefined,
            showAgeGate: rq.show_age_gate === true,
          };
          regionMap.set(rq.id, info);

          // Build reverse map: if this quest replaces another, aggregate regions
          const replacementId = rq.replacement_id;
          if (replacementId) {
            // Merge regions and excluded regions from all variants
            const existing = reverseRegionMap.get(replacementId);
            if (existing) {
              const mergedRegions = [...new Set([...existing.regions, ...includedRegions])];
              const mergedExcluded = [...new Set([...existing.excludedRegions, ...excludedRegions])];
              reverseRegionMap.set(replacementId, {
                regions: mergedRegions,
                excludedRegions: mergedExcluded,
                isGlobal: existing.isGlobal && info.isGlobal,
                showAgeGate: existing.showAgeGate || info.showAgeGate,
              });
            } else {
              reverseRegionMap.set(replacementId, {
                regions: [...includedRegions],
                excludedRegions: [...excludedRegions],
                isGlobal: info.isGlobal,
                showAgeGate: info.showAgeGate,
              });
            }
          }
        }
      } catch { /* regions data is optional, don't fail */ }
    }

    // Build applicationId → region info map (for quests without direct region data)
    // If a quest has no region entry but another quest of the same game (applicationId) does, inherit it
    const appRegionMap = new Map<string, { regions: string[]; excludedRegions: string[]; isGlobal: boolean; showAgeGate: boolean }>();
    for (const q of quests) {
      const appId = q.config?.application?.id;
      if (!appId) continue;
      const regionInfo = regionMap.get(q.id);
      if (regionInfo) {
        const existing = appRegionMap.get(appId);
        if (existing) {
          // Merge: prefer more specific data
          const mergedRegions = [...new Set([...existing.regions, ...regionInfo.regions])];
          const mergedExcluded = [...new Set([...existing.excludedRegions, ...regionInfo.excludedRegions])];
          appRegionMap.set(appId, {
            regions: mergedRegions,
            excludedRegions: mergedExcluded,
            isGlobal: existing.isGlobal && regionInfo.isGlobal,
            showAgeGate: Boolean(existing.showAgeGate) || Boolean(regionInfo.showAgeGate),
          });
        } else {
          appRegionMap.set(appId, {
            regions: [...regionInfo.regions],
            excludedRegions: [...regionInfo.excludedRegions],
            isGlobal: regionInfo.isGlobal,
            showAgeGate: regionInfo.showAgeGate === true,
          });
        }
      }
    }

    const mapped = quests.map((q) => {
      const questType = getQuestType(q);

      // Extract target from task_config_v2 first, then fallback to task_config
      const taskConfigV2 = (q.config as Record<string, unknown>)?.task_config_v2 as ApiQuestConfig["config"]["task_config"] | undefined;
      const v2Tasks = taskConfigV2?.tasks || {};
      const v1Tasks = q.config?.task_config?.tasks || {};
      const allTasks = { ...v2Tasks, ...v1Tasks };
      const allTaskNames = Object.keys(allTasks);
      const firstTask = allTaskNames.length > 0 ? allTasks[allTaskNames[0]] : null;
      const targetSeconds = firstTask?.target || 0;

      const reward = q.config?.rewards_config?.rewards?.[0];
      const heroAsset = q.config?.assets?.hero || "";
      const bannerUrl = heroAsset ? `/api/quests/banner?questId=${encodeURIComponent(q.id)}&hero=${encodeURIComponent(heroAsset)}` : undefined;

      const regionInfo = regionMap.get(q.id);
      const reverseInfo = !regionInfo ? reverseRegionMap.get(q.id) : null;
      const appId = q.config?.application?.id || null;

      // Get region data: direct match → reverse match (by replacement_id) → same game (applicationId) → unknown
      let finalRegions: string[];
      let finalExcludedRegions: string[];
      let finalIsGlobal: boolean | null;
      let showAgeGate: boolean;
      let hasRegionData: boolean;

      if (regionInfo) {
        // Direct match in /api/regions
        finalRegions = regionInfo.regions || [];
        finalExcludedRegions = regionInfo.excludedRegions || [];
        finalIsGlobal = regionInfo.isGlobal;
        showAgeGate = regionInfo.showAgeGate === true;
        hasRegionData = true;
      } else if (reverseInfo) {
        // Found via reverse lookup (this quest is a replacement target)
        finalRegions = reverseInfo.regions || [];
        finalExcludedRegions = reverseInfo.excludedRegions || [];
        finalIsGlobal = reverseInfo.isGlobal;
        showAgeGate = reverseInfo.showAgeGate;
        hasRegionData = true;
      } else if (appId && appRegionMap.has(appId)) {
        // Found via same game (applicationId) — inherit region from quest variant
        const appInfo = appRegionMap.get(appId)!;
        finalRegions = appInfo.regions;
        finalExcludedRegions = appInfo.excludedRegions;
        finalIsGlobal = appInfo.isGlobal;
        showAgeGate = appInfo.showAgeGate;
        hasRegionData = true;
      } else {
        // No region data available from API — treat as unknown
        finalRegions = [];
        finalExcludedRegions = [];
        finalIsGlobal = null;
        showAgeGate = false;
        hasRegionData = false;
      }

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
        bannerUrl,
        applicationId: appId,
        applicationName: q.config?.application?.name || undefined,
        target: targetSeconds,
        targetLabel: getTargetLabel(questType, targetSeconds),
        gameTitle: q.config?.messages?.game_title || q.config?.application?.name || "",
        gamePublisher: q.config?.messages?.game_publisher || "",
        primaryColor: q.config?.colors?.primary || "#5865F2",
        secondaryColor: q.config?.colors?.secondary || "#5865F2",
        heroAsset: q.config?.assets?.hero || "",
        gameTileAsset: q.config?.assets?.game_tile || "",
        logotypeAsset: q.config?.assets?.logotype || "",
        logotypeLight: (q.config?.assets as Record<string, unknown> | undefined)?.logotype_light as string || "",
        isEnrolled: false,
        isClaimed: false,
        orbsReward: reward?.orb_quantity || null,
        regions: finalRegions,
        excludedRegions: finalExcludedRegions,
        isGlobal: finalIsGlobal,
        replacementId: regionInfo?.replacementId,
        showAgeGate,
        hasRegionData, // Whether we found region info from API (direct, reverse, or same-game lookup)
        questIds: [q.id, ...(regionInfo?.replacementId ? [regionInfo.replacementId] : [])], // Include replacement ID for dashboard filtering
      };
    });

    return NextResponse.json({ success: true, quests: mapped, total: mapped.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Lỗi kết nối API";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
