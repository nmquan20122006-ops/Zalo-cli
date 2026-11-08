#!/usr/bin/env node
import { ZaloClient } from "../src/client.js";
import { startUI } from "../src/ui.js";
import { renameThread } from "../src/store.js";
import { syncRecent } from "../src/sync.js";

const [cmd = "listen", ...args] = process.argv.slice(2);
const isListen = cmd === "listen";
const needsListener = isListen || cmd === "sync";

const client = new ZaloClient();
// Chỉ mở listener (WebSocket) khi thật sự cần nghe tin nhắn.
// Nếu mở ở các lệnh one-shot, process sẽ không thoát sau khi in kết quả.
try {
  await client.connect({ listen: needsListener });
} catch (e) {
  console.error("Đăng nhập thất bại:", e.message);
  process.exit(1);
}

try {
  switch (cmd) {
    case "whoami":
      console.log(client.me);
      break;

    case "friends":
      for (const f of await client.friends()) {
        console.log(f.userId, f.zaloName || f.displayName);
      }
      break;

    case "groups":
      // client.groups() đã tự gọi getGroupInfo để lấy tên nhóm
      for (const g of await client.groups()) console.log(g.groupId, g.name);
      break;

    case "sync": {
      const { groups, saved } = await syncRecent(client, { log: (line) => console.log(line) });
      console.log(`Đồng bộ xong: ${groups.length} nhóm, ${saved} tin nhắn.`);
      break;
    }

    case "send": {
      // Tách cờ --group ra trước khi lấy threadId, tránh trường hợp
      // `send --group <id> ...` khiến threadId = "--group".
      const groupIdx = args.indexOf("--group");
      const isGroup = groupIdx !== -1;
      if (isGroup) args.splice(groupIdx, 1);

      const [threadId, ...rest] = args;
      const text = rest.join(" ");
      if (!threadId || !text) {
        console.error("Cách dùng: zalo send <threadId> [--group] <nội dung>");
        process.exitCode = 1;
        break;
      }
      await client.send(threadId, text, isGroup);
      console.log("Đã gửi");
      break;
    }

    case "listen": {
      // Nạp sẵn bạn bè / nhóm để /open biết tên và biết đâu là nhóm
      const directory = new Map();
      try {
        const [friends, groups] = await Promise.all([client.friends(), client.groups()]);
        for (const f of friends) {
          const name = f.zaloName || f.displayName;
          renameThread(f.userId, name);
          directory.set(f.userId, { name, isGroup: false });
        }
        for (const g of groups) {
          renameThread(g.groupId, g.name);
          directory.set(g.groupId, { name: g.name, isGroup: true });
        }
      } catch (e) {
        console.error("Không tải được danh bạ:", e.message);
      }

      console.log("Đang nghe tin nhắn... (Ctrl+C để thoát)");
      console.log("Gõ /help để xem trợ giúp, /sync để nạp hội thoại đã chat.");
      startUI(client, null, directory);
      break;
    }

    default:
      console.error(`Lệnh không hợp lệ: ${cmd}`);
      console.error("Các lệnh: whoami | friends | groups | send | sync | listen");
      process.exitCode = 1;
  }
} finally {
  // Lệnh listen cần listener sống tiếp, chỉ đóng ở các lệnh one-shot
  if (!isListen) client.close();
}
