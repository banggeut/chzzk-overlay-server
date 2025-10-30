import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import ioClient from "socket.io-client";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 환경 변수
const CHZZK_CHANNEL_ID = "f00f6d46ecc6d735b96ecf376b9e5212";
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ CLIENT_ID 또는 CLIENT_SECRET이 설정되지 않았습니다.");
  process.exit(1);
}

// ✅ Express 서버
app.get("/", (req, res) => res.send("✅ Chzzk Overlay Server Running!"));
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

// ✅ 공용 broadcast 함수
function broadcast(obj) {
  const str = JSON.stringify(obj);
  overlayClients.forEach(client => {
    if (client.readyState === 1) client.send(str);
  });
}

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

    // 실패 시 로그 출력
    if (!authRes.ok) {
      const errMsg = await authRes.text();
      console.error(`❌ 세션 생성 실패: ${authRes.status} ${errMsg}`);
      // 401, 403 등도 포함해서 일정시간 후 재시도
      setTimeout(connectChzzkChat, 10000);
      return;
    }

    // 2️⃣ URL 추출
    const authData = await authRes.json();
    if (!authData?.content?.url) {
      console.error("❌ 세션 URL 누락됨:", authData);
      setTimeout(connectChzzkChat, 10000);
      return;
    }

    const socketUrl = authData.content.url;
    console.log("✅ 세션 URL 획득:", socketUrl);

    // 3️⃣ Socket.IO 연결
    const socket = ioClient(socketUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
      forceNew: true,
    });

    socket.on("connect", () => {
      console.log("✅ 치지직 소켓 연결 완료");
    });

    socket.on("connect_error", (err) => {
      console.error("❌ 소켓 연결 오류:", err.message);
      setTimeout(connectChzzkChat, 10000);
    });

    // 4️⃣ SYSTEM 이벤트 수신 → sessionKey 획득
    socket.on("SYSTEM", async (data) => {
      if (!data?.sessionKey) return;
      const sessionKey = data.sessionKey;
      console.log("✅ 세션키 수신:", sessionKey);

      // 5️⃣ 채팅 이벤트 구독
      try {
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
          const errMsg = await subRes.text();
          console.error("❌ 채팅 구독 실패:", subRes.status, errMsg);
          setTimeout(connectChzzkChat, 10000);
          return;
        }

        console.log("✅ 채팅 구독 성공");

      } catch (err) {
        console.error("❌ 구독 요청 오류:", err);
        setTimeout(connectChzzkChat, 10000);
      }
    });

    // 6️⃣ 채팅 이벤트 처리
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

    // 7️⃣ 연결 종료 시 재시도
    socket.on("disconnect", (reason) => {
      console.warn("⚠️ 소켓 연결 종료됨:", reason);
      setTimeout(connectChzzkChat, 10000);
    });

  } catch (err) {
    console.error("❌ 치지직 연결 실패:", err);
    setTimeout(connectChzzkChat, 10000);
  }
}

// ✅ 시작
connectChzzkChat();
