import express from "express";
import fetch from "node-fetch";
import WebSocket from "ws";

const app = express();
const PORT = process.env.PORT || 3000;

const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;

let sessionKey = null;
let ws = null;

async function createSession() {
  const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channelId: CHANNEL_ID,
      connectType: "CHAT",
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`세션 생성 실패: ${res.status} - ${text}`);

  const data = JSON.parse(text);
  sessionKey = data.content.session.sessionKey;
  console.log("✅ 세션 생성 완료:", sessionKey);
}

async function subscribeChat() {
  const res = await fetch(
    `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
    {
      method: "PUT", // ✅ 이제 POST가 아니라 PUT이야!
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  const text = await res.text();
  if (!res.ok) throw new Error(`이벤트 구독 실패: ${res.status} - ${text}`);
  console.log("✅ 채팅 이벤트 구독 완료");
}

async function unsubscribeChat() {
  const res = await fetch(
    `https://openapi.chzzk.naver.com/open/v1/sessions/events/unsubscribe/chat?sessionKey=${sessionKey}`,
    {
      method: "PUT", // ✅ 구독 해제도 PUT
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  const text = await res.text();
  if (!res.ok) console.warn(`⚠️ 구독 해제 실패: ${res.status} - ${text}`);
  else console.log("🟡 구독 해제 완료");
}

async function connectChzzkChat() {
  try {
    console.log("🔗 치지직 WebSocket 연결 시도...");

    if (!sessionKey) {
      await createSession();
      await subscribeChat();
    }

    ws = new WebSocket(`wss://openapi.chzzk.naver.com/open/v1/sessions?sessionKey=${sessionKey}`);

    ws.on("open", () => console.log("✅ WebSocket 연결 성공"));
    ws.on("message", (msg) => console.log("💬 수신:", msg.toString()));
    ws.on("close", () => console.log("❌ WebSocket 연결 종료"));
    ws.on("error", (err) => console.error("⚠️ WebSocket 오류:", err));

  } catch (err) {
    console.error("❌ 치지직 연결 실패:", err);
  }
}

app.get("/", (req, res) => {
  res.send("치지직 채팅 서버 작동 중 💬");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  connectChzzkChat();
});

process.on("SIGINT", async () => {
  console.log("🛑 서버 종료 중... 구독 해제 중...");
  await unsubscribeChat();
  process.exit();
});
