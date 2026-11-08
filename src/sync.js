import { saveMessage, renameThread } from "./store.js";

// Đồng bộ lịch sử các hội thoại đã chat vào DB.
// - Nhóm: lấy lịch sử qua HTTP (getGroupChatHistory)
// - Chat riêng: xin "old messages" qua WebSocket rồi lưu
// Client phải đang chạy listener (connect({ listen: true })).
export async function syncRecent(client, { groupCount = 30, waitMs = 5000, log = () => {} } = {}) {
  let saved = 0;

  const groups = await client.groups();
  const groupName = new Map(groups.map((g) => [g.groupId, g.name]));
  for (const g of groups) renameThread(g.groupId, g.name);

  const friends = await client.friends();
  const friendName = new Map(friends.map((f) => [f.userId, f.zaloName || f.displayName]));
  for (const [id, name] of friendName) renameThread(id, name);

  const nameOf = (m) => (m.isGroup ? groupName.get(m.threadId) : friendName.get(m.threadId));

  // 1) Lịch sử nhóm
  for (const g of groups) {
    try {
      const msgs = await client.groupHistory(g.groupId, groupCount);
      for (const m of msgs) if (saveMessage({ ...m, threadName: g.name })) saved++;
      log(`${g.name}: ${msgs.length} tin`);
    } catch (e) {
      log(`${g.name}: lỗi - ${e.message}`);
    }
  }

  // 2) Tin nhắn gần đây của chat riêng + nhóm qua WebSocket
  const recent = await client.recentMessages({ waitMs });
  for (const m of recent) if (saveMessage({ ...m, threadName: nameOf(m) })) saved++;
  log(`Tin nhắn gần đây (riêng + nhóm): ${recent.length} tin`);

  return { groups, friends, saved };
}
