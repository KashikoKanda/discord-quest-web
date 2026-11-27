"use client";

/**
 * Chống mò thông tin qua DevTools ở mức UI:
 *  - Chặn F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S và menu chuột phải.
 *  - Phát hiện cửa sổ DevTools đang mở (chênh lệch outer/inner) → phủ màn hình
 *    mờ, che toàn bộ dữ liệu phiên cho tới khi đóng.
 *
 * Không thể "khoá" DevTools thật (người dùng luôn mở được bằng menu trình
 * duyệt), nên lớp này chỉ để chống tò mò và chống copy nhanh dữ liệu trên màn
 * hình. Bảo vệ thật nằm ở server: rate limit, CSP, không lộ key.
 */
import { useEffect, useState } from "react";

export default function DevGuard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const blocked =
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["i", "j", "c", "k"].includes(k)) ||
        (e.metaKey && e.altKey && ["i", "j", "c"].includes(k)) ||
        (e.ctrlKey && !e.shiftKey && ["u", "s"].includes(k));
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const noCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", noCtx, true);

    const timer = window.setInterval(() => {
      const wGap = Math.abs(window.outerWidth - window.innerWidth);
      const hGap = Math.abs(window.outerHeight - window.innerHeight);
      setOpen(wGap > 180 || hGap > 240);
    }, 1200);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", noCtx, true);
      window.clearInterval(timer);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-[#07070c]/97 px-6 text-center backdrop-blur-xl">
      <div className="max-w-sm">
        <p className="text-[17px] font-semibold text-white">Đóng DevTools để tiếp tục</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/50">
          Trang này chứa dữ liệu phiên. Vui lòng đóng bảng nhà phát triển rồi tải lại.
        </p>
      </div>
    </div>
  );
}
