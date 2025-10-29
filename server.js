import express from "express";
import fetch from "node-fetch";
import WebSocket from "ws";

const app = express();
const PORT = process.env.PORT || 3000;

// 🟢 치지직 액세스 토큰 & 채널 ID 환경변수에서 불러오기
const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;

let sessionKey = null;
let ws = null;

// 🔹 치지직 채팅 세션 생성
async function createSession() {
  const response = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`치지직 세션 생성 실패: ${response.status} - ${text}`);
  }

  const data = await response.json();
  sessionKey = data.content.session.sessionKey;
  console.log("✅ 세션 생성 완료:", sessionKey);
}

// 🔹 이벤트 구독 (POST 필수)
async function subscribeChat() {
  const response = await fetch(
    `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
    {
      method: "POST", // ✅ 중요: 405 오류 방지
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`치지직 구독 실패: ${response.status} - ${text}`);
  }

  console.log("✅ 채팅 이벤트 구독 완료");
}

// 🔹 이벤트 구독 해제
async function unsubscribeChat() {
  const response = await fetch(
    `https://openapi.chzzk.naver.com/open/v1/sessions/events/unsubscribe/chat?sessionKey=${sessionKey}`,
    {
      method: "POST", // ✅ 반드시 POST
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.warn(`⚠️ 구독 해제 실패: ${response.status} - ${text}`);
  } else {
    console.log("🟡 구독 해제 완료");
  }
}

// 🔹 치지직 WebSocket 연결
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

// 서버 시작 시 자동 연결
connectChzzkChat();

// Express 서버
app.get("/", (req, res) => {
  res.send("치지직 채팅 연결 서버 작동 중 💬");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// 종료 시 구독 해제
process.on("SIGINT", async () => {
  console.log("🛑 서버 종료 중... 구독 해제 중...");
  await unsubscribeChat();
  process.exit();
});
