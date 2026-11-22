import { NextRequest, NextResponse } from "next/server";
import {
  fetchDiscordQuests,
  getVirtualCurrencyBalance,
  getQuestType,
  getVideoSecondsNeeded,
  getPlayDurationNeeded,
  getApplicationId,
  isQuestCompleted,
  isQuestExpired,
  isQuestClaimed,
  getQuestMessages,
  getQuestColors,
  getQuestAssets,
  getOrbsReward,
  calculateQuestProgress,
  isTokenExpiredResponse,
} from "@/lib/discord";
import { QuestWorker } from "@/lib/questWorker";
import { checkDiscordToken, tokenIdOf } from "@/lib/tokenCheck";

function getQuestTypeLabel(type: string): string {
  switch (type) {
    case "WATCH_VIDEO": return "Xem Video";
    case "WATCH_VIDEO_ON_MOBILE": return "Xem Video (Mobile)";
    case "PLAY_ON_DESKTOP": return "Chơi Game (Desktop)";
    case "PLAY_ON_XBOX": return "Chơi Game (Xbox)";
    case "PLAY_ON_PLAYSTATION": return "Chơi Game (PlayStation)";
    case "PLAY_ACTIVITY": return "Activity";
    case "STREAM_ON_DESKTOP": return "Stream";
    case "ACHIEVEMENT_IN_ACTIVITY": return "Achievement";
    default: return type;
  }
}

export async function POST(request: NextRequest) {
  // khai báo ngoài try để catch còn dùng được token khi kiểm tra 401
  let token = "";
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token : "";
    const { isVerified, autoClaim } = body;

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const tokenId = tokenIdOf(token);
    const tokenVerified = isVerified ?? false;
    const tokenAutoClaim = autoClaim ?? true;
    QuestWorker.registerToken(tokenId, token, tokenVerified, tokenAutoClaim);

    const { quests, excludedQuests } = await fetchDiscordQuests(token);
    const workerProgress = QuestWorker.getAllQuestProgress(tokenId);

    const formatted = quests.map((q: Record<string, unknown>) => {
      const questType = getQuestType(q);
      const completed = isQuestCompleted(q);
      const expired = isQuestExpired(q);
      const claimed = isQuestClaimed(q);
      const enrolled = !!(q.user_status as Record<string, unknown>)?.enrolled_at;

      const messages = getQuestMessages(q);
      const colors = getQuestColors(q);
      const assets = getQuestAssets(q);
      const appId = getApplicationId(q);

      const config = q.config as Record<string, unknown> | undefined;
      const application = config?.application as Record<string, unknown> | undefined;
      const appName = (application?.name as string) || messages.gameTitle || "";
      const appIconHash = application?.icon as string | undefined;
      const appIconUrl = appId && appIconHash
        ? `https://cdn.discordapp.com/app-icons/${appId}/${appIconHash}.png?size=128`
        : undefined;

      let progressValue = calculateQuestProgress(q);
      const workerProg = workerProgress.get(q.id as string);
      if (workerProg && workerProg.status === "running") {
        progressValue = workerProg.progress;
      }

      // Banner URL - via proxy cache for fast loading
      const bannerUrl = assets.hero
        ? `/api/quests/banner?questId=${encodeURIComponent(q.id as string)}&hero=${encodeURIComponent(assets.hero)}`
        : undefined;

      const rewardsConfig = config?.rewards_config as Record<string, unknown> | undefined;
      const rewards = rewardsConfig?.rewards as Array<Record<string, unknown>> | undefined;
      const rewardMessages = rewards?.[0]?.messages as Record<string, string> | undefined;
      const rewardName = rewardMessages?.name || rewardMessages?.name_with_article || "Unknown";
      const rewardIconUrl = rewards?.[0]?.icon_url as string | undefined;
      const orbsReward = getOrbsReward(q);

      const isVideoType = questType.startsWith("WATCH_VIDEO") || questType === "STREAM_ON_DESKTOP";
      const target = isVideoType ? getVideoSecondsNeeded(q) : getPlayDurationNeeded(q);
      const targetLabel = "";

      return {
        id: q.id,
        name: messages.questName,
        description: (q as Record<string, unknown>).description as string || getQuestTypeLabel(questType),
        type: questType,
        status: expired && completed && !claimed
          ? "unclaimed"        // Expired but completed → still need to claim reward
          : expired
          ? "expired"          // Expired and not completed
          : completed
          ? "completed"
          : workerProg?.status === "running"
          ? "running"
          : enrolled
          ? "enrolled"
          : "available",
        progress: progressValue,
        expiresAt: config?.expires_at as string | undefined,
        enrolledAt: (q.user_status as Record<string, unknown>)?.enrolled_at as string | undefined,
        completedAt: (q.user_status as Record<string, unknown>)?.completed_at as string | undefined,
        reward: rewardName,
        rewardIconUrl,
        bannerUrl,
        applicationId: appId,
        applicationName: appName,
        applicationIconUrl: appIconUrl,
        target,
        targetLabel,
        gameTitle: messages.gameTitle || appName,
        gamePublisher: messages.gamePublisher,
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
        heroAsset: assets.hero,
        gameTileAsset: assets.gameTile,
        logotypeAsset: assets.logotype,
        logotypeLight: assets.logotypeLight,
        isEnrolled: enrolled,
        isClaimed: claimed,
        orbsReward,
        _tokenId: tokenId,
      };
    });

    // Fetch orbs balance from Discord
    const orbsBalance = await getVirtualCurrencyBalance(token, tokenId);

    // Extract excluded quest IDs (quests hidden by Discord, e.g. 18+ restricted)
    const excludedQuestIds = excludedQuests.map((q: Record<string, unknown>) => q.id as string).filter(Boolean);

    return NextResponse.json({
      success: true,
      quests: formatted,
      tokenId,
      orbsBalance,
      excludedQuestIds,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // 401 từ một request qua proxy CHƯA chứng minh token chết: IP proxy có thể
    // bị gắn cờ. Xác nhận trực tiếp với Discord trước khi báo token hết hạn —
    // trước đây chỗ này làm web tự logout và báo "token bị thu hồi" oan.
    if (msg.includes("401")) {
      const verdict = await checkDiscordToken(token).catch(() => null);
      if (verdict?.kind === "user") {
        return NextResponse.json(
          { error: "Proxy tạm thời bị Discord từ chối, thử lại sau ít giây.", proxyError: true },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Token hết hạn", tokenExpired: true }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
