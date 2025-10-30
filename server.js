import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import ioClient from "socket.io-client";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 치지직 환경 변수
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

// ✅ 치지직 연결 함수
async function connectChzzkChat() {
  console.log("🔗 치지직 WebSocket 연결 시도...");

  try {
    // 1️⃣ 세션 생성 (Client 인증)
    const authRes = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth/client", {
      method: "GET",
      headers: {
        "Client-Id": CLIENT_ID,
        "Client-Secret": CLIENT_SECRET,
      },
    });

    if (!authRes.ok) {
      console.error("❌ 세션 생성 실패:", authRes.status, await authRes.text());
      setTimeout(connectChzzkChat, 5000);
      return;
    }

    const authData = await authRes.json();
    const socketUrl = authData.content.url;
    console.log("✅ 세션 URL 획득:", socketUrl);

    // 2️⃣ Socket.IO로 연결
    const socket = ioClient(socketUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 3000,
      forceNew: true,
    });

    socket.on("connect", () => console.log("✅ 치지직 소켓 연결 완료"));

    socket.on("connect_error", (err) => {
      console.error("❌ 소켓 연결 오류:", err);
      setTimeout(connectChzzkChat, 5000);
    });

    // 3️⃣ SYSTEM 이벤트에서 sessionKey 수신 → 구독 요청
    socket.on("SYSTEM", async (systemData) => {
      if (!systemData.sessionKey) return;
      const sessionKey = systemData.sessionKey;
      console.log("✅ 세션키 수신:", sessionKey);

      // 4️⃣ 채팅 구독 요청
      const subRes = await fetch(
        `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
        {
          method: "POST",
          headers: {
            "Client-Id": CLIENT_ID,
            "Client-Secret": CLIENT_SECRET,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channelId: CHZZK_CHANNEL_ID }),
        }
      );

      if (!subRes.ok) {
        console.error("❌ 채팅 구독 실패:", subRes.status, await subRes.text());
        setTimeout(connectChzzkChat, 5000);
        return;
      }

      console.log("✅ 채팅 구독 성공");
    });

    // 5️⃣ 채팅 이벤트 수신
    socket.on("CHAT", (chat) => {
      if (!chat?.profile?.nickname || !chat?.message) return;

      broadcast({
        type: "chat",
        payload: {
          userName: chat.profile.nickname,
          message: chat.message,
        },
      });
    });

    // 6️⃣ 연결 종료 시 재연결 시도
    socket.on("disconnect", () => {
      console.warn("⚠️ 소켓 연결 종료됨. 5초 후 재연결 시도");
      setTimeout(connectChzzkChat, 5000);
    });

  } catch (err) {
    console.error("❌ 치지직 연결 실패:", err);
    setTimeout(connectChzzkChat, 5000);
  }
}

// ✅ 오버레이 클라이언트로 브로드캐스트
function broadcast(obj) {
  const str = JSON.stringify(obj);
  overlayClients.forEach(client => {
    if (client.readyState === 1) client.send(str);
  });
}

// ✅ 시작
connectChzzkChat();
