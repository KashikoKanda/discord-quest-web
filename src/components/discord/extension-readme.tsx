Tài liệu kỹ thuật cho dev: extension hoàn thành Discord Quests bằng cách gọi lại đúng các API nội bộ mà Discord client dùng. Không mô phỏng người dùng, không hack server - chỉ "báo tiến độ" thay người dùng.

----------------------------------------------------------------
1. KIẾN TRÚC 3 TẦNG
----------------------------------------------------------------
- quest-code.js: Engine, chạy trong page context. Chui vào webpack của Discord, đọc store, gọi API quest.
- content.js: Điều phối + UI. Nhận update tiến độ, forward request cross-origin sang background.
- background.js: Service worker. Fetch cross-origin + rewrite header (Referer/Origin) qua declarativeNetRequest.
- rules.json + user-agent-override.js: Giả User-Agent của Discord desktop app (Electron) cho mọi request tới discord.com. Một số quest chỉ tính tiến độ khi client báo là "desktop app".
- manifest.json: Khai báo quyền + content script chỉ chạy trên discord.com/quest-home.

----------------------------------------------------------------
2. LẤY DATA QUEST TỪ NỘI BỘ DISCORD (WEBPACK)
----------------------------------------------------------------
- Kỹ thuật: đẩy 1 chunk rỗng vào window.webpackChunkdiscord_app để móc webpackRequire ra ngoài (push [[Symbol()], {}, r => r] rồi pop).
- findModule() quét webpackRequire.c tìm 2 module:
  + QuestsStore: filter m.__proto__?.getQuest -> chứa mọi quest của user trong .quests.values()
  + API client: filter m.Bo?.get || m.tn?.get -> client HTTP nội bộ, tự gắn token auth nên mọi api.post() đều hợp lệ như request chính chủ.
- Danh sách quest = lọc: chưa hoàn thành (userStatus.completedAt null), chưa hết hạn (config.expiresAt), có task hỗ trợ trong config.taskConfig(.V2).tasks.

----------------------------------------------------------------
3. AUTO-ENROLL (QUEST CHƯA THAM GIA)
----------------------------------------------------------------
- Quest chưa enroll (kể cả quest video mới) vẫn hiện trong panel. Trước khi chạy, tự động tham gia:

  POST /quests/<quest_id>/enroll
  { "location": 11, "is_targeted": false, "metadata_raw": null }

- enrolledAt từ response là mốc thời gian cho giới hạn tiến độ video (mục 4.1).
- Enroll thất bại (quest không khả dụng cho account) thì quest giữ nguyên 0% trong danh sách, bỏ qua im lặng.

----------------------------------------------------------------
4. CƠ CHẾ TỪNG LOẠI QUEST
----------------------------------------------------------------

4.1. Quest video - WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE

- Vòng lặp báo tiến độ xem video, mỗi lần gọi:

  POST /quests/<quest_id>/video-progress
  { "timestamp": <số giây đã xem> }

- speed = 6: mỗi tick tự cộng 6 giây xem ảo.
- interval 6s: tick mỗi 6 giây thực, xem ảo nhanh gấp 6x.
- maxFuture 10: không cho timestamp vượt quá thời gian thực kể từ lúc enroll quá 10 giây, cụ thể maxAllowed = (Date.now() - enrolledAt) / 1000 + 10.
- timestamp cộng random jitter để không tròn số từng đợt.
- Tiến độ thật đọc lại từ response: res.body.progress[taskType].value (Discord tự tính).
- Hoàn tất khi res.body.completed_at != null. Hết vòng mà chưa xong thì gửi 1 lần cuối với timestamp = secondsNeeded.

4.2. Quest chơi game - PLAY_ON_DESKTOP / XBOX / PLAYSTATION

- Không cần mở game, gửi heartbeat như đang chơi:

  POST /quests/<quest_id>/heartbeat
  { "application_id": <app_id>, "terminal": false }

- interval 15s (Discord chấp nhận heartbeat 15 giây/lần).
- application_id lấy từ task.applications[0].id / task.applicationId / config.application.id / config.contentId.
- Chạy xong gửi heartbeat cuối terminal: true để đóng phiên.
- Tiến độ tăng theo số heartbeat hợp lệ.

4.3. Quest hoạt động - PLAY_ACTIVITY

- Giống 4.2 nhưng body heartbeat dùng stream_key thay vì application_id:

  { "stream_key": "call:1:1", "terminal": false }

4.4. Quest thành tựu - ACHIEVEMENT_IN_ACTIVITY

- 4 bước, mô phỏng chơi activity rồi đẩy thành tựu.
- Bước 1: OAuth2 authorize app của quest -> parse "code" từ body.location

  POST /oauth2/authorize?response_type=code&client_id=<app_id>&scope=identify+applications.commands+applications.entitlements
  body: { permissions: "0", authorize: true, integration_type: 1, location_context: {...} }

- Bước 2: Lấy proxy ticket -> POST /applications/<app_id>/proxy-tickets trả về ticket.
- Bước 3: Đổi token với Discord Says (activity platform) -> gửi code bước 1, kèm header X-Discord-Quest-ID, nhận token:

  POST https://<app_id>.discordsays.com/.proxy/acf/authorize
  body: { code: <code bước 1> }

- Bước 4: Đẩy tiến độ, kèm header X-Discord-Quest-ID + X-Auth-Token:

  POST https://<app_id>.discordsays.com/.proxy/acf/quest/progress
  body: { progress: <target> }

----------------------------------------------------------------
5. BRIDGE CROSS-ORIGIN (BACKGROUND.JS)
----------------------------------------------------------------
- <app_id>.discordsays.com là origin khác, và page không set được Referer/Origin/UA (forbidden headers), nên request này đi vòng: quest-code.js gửi window.postMessage (DS_FETCH) -> content.js chuyển chrome.runtime.sendMessage -> background.js dùng declarativeNetRequest.updateDynamicRules (set Referer, remove Origin cho đúng 1 request) rồi fetch, trả kết quả ngược về từng tầng.
- Rule động được xóa ngay sau mỗi request.
- Timeout 30s mỗi request, map requestId để ghép response đúng caller.

----------------------------------------------------------------
6. CHẠY SONG SONG + CHỐNG TREO
----------------------------------------------------------------
- Mọi quest chạy cùng lúc bằng Promise.allSettled, 1 quest lỗi không kéo cả đám.
- Mỗi vòng lặp (video/heartbeat) có failCount: 5 lỗi liên tiếp thì tự return bỏ quest đó im lặng, không treo vòng quét.
- Lỗi đơn lẻ chỉ sleep 3-5s rồi retry.

----------------------------------------------------------------
7. GIAO TIẾP ENGINE VÀ UI
----------------------------------------------------------------
- Qua window.postMessage, prefix DISCORD_QUEST_COMPLETER.
- QUEST_LIST: engine gửi UI, toàn bộ quest lúc bắt đầu (id, name, progress, target, kind video/game).
- QUEST_UPDATE: engine gửi UI, tiến độ realtime từng quest.
- QUEST_ALL_DONE: engine gửi UI, hết vòng quét.
- DS_FETCH / DS_FETCH_RESULT: hai chiều, bridge cross-origin sang background và kết quả trả về.

----------------------------------------------------------------
Extension mang tính chất học tập / cá nhân. Bạn tự chịu trách nhiệm khi sử dụng.
