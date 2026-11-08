import { EventEmitter } from "node:events";
import { ThreadType } from "zca-js";
import { login } from "./auth.js";

export class ZaloClient extends EventEmitter {
  #api; #me;

  // listen = false dùng cho các lệnh one-shot (whoami, send, ...) để
  // không mở WebSocket làm process bị treo sau khi in kết quả.
  async connect({ listen = true } = {}) {
    this.#api = await login();
    this.#me = this.#api.getOwnId();

    if (listen) {
      this.#api.listener.on("message", (msg) => {
        this.emit("message", this.#normalize(msg));
      });
      // Tin nhắn cũ (bị lỡ khi offline) do server phát lại khi kết nối
      this.#api.listener.on("old_messages", (msgs) => {
        this.emit("old-messages", msgs.map((m) => this.#normalize(m)));
      });
      this.#api.listener.on("connected", () => {
        this.emit("connected");
        // Mỗi lần kết nối (kể cả reconnect), xin lại tin nhắn lỡ trong 2 tuần
        this.#api.listener.requestOldMessages(ThreadType.User);
        this.#api.listener.requestOldMessages(ThreadType.Group);
      });
      this.#api.listener.on("closed", (code, reason) => this.emit("closed", code, reason));

      this.#api.listener.start({ retryOnClose: true });
    }
  }

  close() {
    this.#api?.listener?.stop();
  }

  #normalize(m) {
    return {
      id: m.data.msgId,
      threadId: m.threadId,
      isGroup: m.type === ThreadType.Group,
      isSelf: m.isSelf,
      fromId: m.data.uidFrom,
      fromName: m.data.dName || (m.isSelf ? "tôi" : m.data.uidFrom),
      ts: Number(m.data.ts),
      kind: m.data.msgType,
      text: typeof m.data.content === "string" ? m.data.content : "",
      raw: m,
    };
  }

  // sendMessage cần quote đúng cấu trúc SendMessageQuote, không phải
  // nguyên object Message của zca-js.
  #toQuote(m) {
    const d = m.raw ? m.raw.data : m.data;
    return {
      content: d.content,
      msgType: d.msgType,
      propertyExt: d.propertyExt,
      uidFrom: d.uidFrom,
      msgId: d.msgId,
      cliMsgId: d.cliMsgId,
      ts: d.ts,
      ttl: d.ttl,
    };
  }

  async send(threadId, text, isGroup = false, quote) {
    return this.#api.sendMessage(
      { msg: text, quote: quote ? this.#toQuote(quote) : undefined },
      threadId,
      isGroup ? ThreadType.Group : ThreadType.User,
    );
  }

  async friends() { return this.#api.getAllFriends(); }

  // Lịch sử tin nhắn của một nhóm (HTTP API có sẵn của zca-js)
  async groupHistory(groupId, count = 30) {
    const res = await this.#api.getGroupChatHistory(groupId, count);
    return (res.groupMsgs ?? []).map((m) => this.#normalize(m));
  }

  // Xin server gửi tin nhắn gần đây của chat riêng + nhóm qua WebSocket.
  // Chỉ dùng được sau khi listener đã start().
  async recentMessages({ waitMs = 5000 } = {}) {
    const collected = [];
    let remaining = 2; // chờ 2 phản hồi: 510 (user) và 511 (group)
    let resolveDone;
    let finished = false;
    let timer;

    const done = new Promise((resolve) => { resolveDone = resolve; });
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveDone();
    };

    const onOld = (msgs) => {
      for (const m of msgs) collected.push(this.#normalize(m));
      if (--remaining <= 0) finish();
    };

    this.#api.listener.on("old_messages", onOld);
    timer = setTimeout(finish, waitMs);

    try {
      this.#api.listener.requestOldMessages(ThreadType.User);
      this.#api.listener.requestOldMessages(ThreadType.Group);
      await done;
    } finally {
      clearTimeout(timer);
      this.#api.listener.off("old_messages", onOld);
    }

    return collected;
  }

  // getAllGroups() chỉ trả về { version, gridVerMap } (id -> version),
  // nên phải gọi thêm getGroupInfo để lấy tên nhóm.
  async groups() {
    const { gridVerMap } = await this.#api.getAllGroups();
    const ids = Object.keys(gridVerMap ?? {});
    if (!ids.length) return [];

    const { gridInfoMap } = await this.#api.getGroupInfo(ids);
    return ids.map((id) => ({
      groupId: id,
      name: gridInfoMap?.[id]?.name || id,
    }));
  }

  get me() { return this.#me; }
}
