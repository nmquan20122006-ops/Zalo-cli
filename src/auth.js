// src/auth.js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import qrcode from "qrcode-terminal";
import { Zalo, LoginQRCallbackEventType } from "zca-js";

const DIR = path.join(os.homedir(), ".config", "zalo-cli");
const CRED = path.join(DIR, "credentials.json");
const QR_PATH = path.join(DIR, "qr.png");

// Mở ảnh QR bằng trình xem ảnh mặc định của hệ điều hành.
// Không mở được (máy không có GUI, WSL...) thì bỏ qua, đường dẫn vẫn được in ra.
function openFile(file) {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // không có trình mở ảnh, người dùng tự mở theo đường dẫn
  }
}

export async function login({ force = false } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  // ZALO_DEBUG=1 để xem log chi tiết quá trình đăng nhập của zca-js
  const zalo = new Zalo({ logging: process.env.ZALO_DEBUG === "1" });

  // 1. Có cookie cũ thì dùng luôn, khỏi quét QR
  if (!force && fs.existsSync(CRED)) {
    try {
      const cred = JSON.parse(fs.readFileSync(CRED, "utf8"));
      return await zalo.login(cred);          // { cookie, imei, userAgent }
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.error("File credentials.json bị hỏng, quét QR lại...");
      } else {
        console.error("Cookie hết hạn hoặc lỗi đăng nhập, quét QR lại...");
        console.error(`  (${e.message})`);
      }
    }
  }

  // 2. Login QR
  const api = await zalo.loginQR({ qrPath: QR_PATH }, (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        console.clear?.();
        console.log("Quét QR bằng app Zalo: Cá nhân → Quét mã QR.");
        console.log("Terminal hiển thị méo/không quét được thì mở ảnh QR bên dưới.\n");
        qrcode.generate(event.data.code, { small: true });

        // zca-js KHÔNG tự lưu ảnh khi có callback → phải gọi saveToFile.
        event.actions
          .saveToFile(QR_PATH)
          .then(() => {
            try { fs.chmodSync(QR_PATH, 0o600); } catch {}
            console.log(`\nẢnh QR: ${QR_PATH}`);
            openFile(QR_PATH);
          })
          .catch((e) => console.error("Không lưu được ảnh QR:", e.message));
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        console.error("QR hết hạn, đang lấy mã mới...");
        event.actions.retry();
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        console.log(`Đã quét bởi ${event.data.display_name}. Bấm XÁC NHẬN trên điện thoại...`);
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        console.error("Bạn đã từ chối đăng nhập.");
        event.actions.abort();
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        break; // xử lý bên dưới
    }
  });

  // 3. Lưu credential — đây là "mật khẩu" của bạn
  const ctx = api.getContext();
  const cred = {
    cookie: ctx.cookie.toJSON()?.cookies ?? [],
    imei: ctx.imei,
    userAgent: ctx.userAgent,
  };
  fs.writeFileSync(CRED, JSON.stringify(cred, null, 2), { mode: 0o600 });
  fs.chmodSync(CRED, 0o600);
  fs.rmSync(QR_PATH, { force: true }); // QR đã dùng xong, không cần giữ

  const me = await api.fetchAccountInfo();
  const name = me.profile.displayName || me.profile.zaloName || me.profile.username;
  console.log(`Đăng nhập: ${name} (uid ${api.getOwnId()})`);
  return api;
}