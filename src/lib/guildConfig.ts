/**
 * Guild Configuration
 *
 * Cấu hình guild Discord dùng cho tính năng Quest ẩn.
 * Hardcoded trực tiếp trong dự án thay vì dùng .env.
 */

// ID của guild Discord yêu cầu — user phải là thành viên để xem Quest ẩn
export const REQUIRED_GUILD_ID = "1503409916482814003";

// Mã mời Discord (phần sau discord.gg/) — dùng để fetch guild info từ public API
export const GUILD_INVITE_CODE = "7ERYA9ArWH";

// Link mời đầy đủ — dùng trong UI
export const GUILD_INVITE_URL = `https://discord.gg/${GUILD_INVITE_CODE}`;
