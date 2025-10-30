import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 치지직 환경변수
const CHZZK_CHANNEL_ID = "f00f6d46ecc6d735b96ecf376b9e5212";
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ CLIENT_ID 또는 CLIENT_SECRET이 설정되지 않았습니다.");
  process.exit(1);
}

// ✅ Express 기본 라우트
app.get("/", (req, res) => res.send("✅ Chzzk Overlay Server Running!"));

// ✅ 서버 실행
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

// ✅ 치지직 실시간 채팅 연결 함수
async function connectChzzkChat() {
  console.log("🔗 치지직 WebSocket 연결 시도...");

  try {
    // 1️⃣ 세션 인증 요청 (GET 방식)
    const authRes = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth/client", {
      method: "GET",
      headers: {
        "Client-Id": CLIENT_ID,
        "Client-Secret": CLIENT_SECRET,
        "Content-Type": "application/json",
      },
    });

    if (!authRes.ok) {
      console.error("❌ 세션 생성 실패:", authRes.status, await authRes.text());
      setTimeout(connectChzzkChat, 5000);
      return;
    }

    const authData = await authRes.json();
    const { sessionKey, serverUrl } = authData.content;
    console.log("✅ 세션 인증 성공:", sessionKey);

    // 2️⃣ 채팅 구독 요청 (POST)
    const subRes = await fetch(`https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`, {
      method: "POST",
      headers: {
        "Client-Id": CLIENT_ID,
        "Client-Secret": CLIENT_SECRET,
        "Content-Type": "application/json",
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
