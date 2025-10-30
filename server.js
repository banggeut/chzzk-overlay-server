import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 고정된 채널 ID
const CHZZK_CHANNEL_ID = "f00f6d46ecc6d735b96ecf376b9e5212";
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ CLIENT_ID 또는 CLIENT_SECRET이 설정되지 않았습니다.");
  process.exit(1);
}

app.get("/", (req, res) => res.send("✅ Chzzk Overlay Server Running!"));

// ✅ Express 서버 시작
const server = app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
});

// ✅ 오버레이용 WebSocket 서버
const wss = new WebSocketServer({ server });
let overlayClients = [];

wss.on("connection", (ws) => {
  overlayClients.push(ws);
  console.log("🎥 오버레이 클라이언트 연결됨");

  ws.on("close", () => {
    overlayClients = overlayClients.filter(c => c !== ws);
  });
});

// ✅ 치지직 API 연결 로직
async function connectChzzkChat() {
  console.log("🔗 치지직 WebSocket 연결 시도...");

  try {
    // 1️⃣ 세션 생성
    const sessionRes = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
      },
      body: JSON.stringify({}),
    });

    if (!sessionRes.ok) {
      console.error("❌ 세션 생성 실패:", sessionRes.status, await sessionRes.text());
      setTimeout(connectChzzkChat, 5000);
      return;
    }

    const sessionData = await sessionRes.json();
    const { sessionKey, serverUrl } = sessionData.content;
    console.log("✅ 세션 생성 성공:", sessionKey);

    // 2️⃣ 채팅 구독
    const subRes = await fetch(`https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
      },
      body: JSON.stringify({
        channelId: CHZZK_CHANNEL_ID,
      }),
    });

    if (!subRes.ok) {
      console.error("❌ 채팅 구독 실패:", subRes.status, await subRes.text());
      setTimeout(connectChzzkChat, 5000);
      return;
    }

    console.log("✅ 채팅 구독 성공, WebSocket 연결 중...");

    // 3️⃣ WebSocket 연결
    const chatSocket = new WebSocket(`${serverUrl}?sessionKey=${sessionKey}`);

    chatSocket.on("open", () => console.log("✅ 치지직 실시간 채팅 연결 완료"));

    chatSocket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        if (data.type === "chat") {
          broadcast({
            type: "chat",
            payload: {
              userName: data.content.userNickname,
              message: data.content.message,
            },
          });
        } else if (data.type === "viewer_count") {
          broadcast({
            type: "viewer_count",
            payload: { count: data.content.viewCount },
          });
        }
      } catch (err) {
        console.error("⚠️ 데이터 파싱 오류:", err);
      }
    });

    chatSocket.on("close", () => {
      console.warn("⚠️ WebSocket 닫힘. 5초 후 재연결 시도");
      setTimeout(connectChzzkChat, 5000);
    });

    chatSocket.on("error", (err) => {
      console.error("❌ WebSocket 오류:", err);
      chatSocket.close();
    });

  } catch (e) {
    console.error("❌ 치지직 연결 실패:", e);
    setTimeout(connectChzzkChat, 5000);
  }
}

// ✅ 오버레이에 브로드캐스트
function broadcast(obj) {
  const str = JSON.stringify(obj);
  overlayClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  });
}

// ✅ 시작
connectChzzkChat();
