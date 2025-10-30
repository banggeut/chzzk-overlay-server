import express from "express";
import fetch from "node-fetch";
import { WebSocketServer } from "ws";
import ioClient from "socket.io-client/dist/socket.io.js"; // v2 호환 import

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 환경 변수
const CLIENT_ID = process.env.CHZZK_CLIENT_ID || "ef64115b-8119-43ba-9e9c-81d9106f93ae";
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN; // 로그인 후 발급받은 토큰 저장
const CHANNEL_ID = "f00f6d46ecc6d735b96ecf376b9e5212";

if (!CLIENT_SECRET) console.warn("⚠️ CLIENT_SECRET이 설정되지 않았습니다.");
if (!ACCESS_TOKEN) console.warn("⚠️ CHZZK_ACCESS_TOKEN이 설정되지 않았습니다.");

// ✅ 서버 시작
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
    overlayClients = overlayClients.filter((c) => c !== ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  overlayClients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ✅ Access Token 발급 콜백
app.get("/api/chzzk/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.send("❌ code 파라미터가 없습니다.");

  try {
    const tokenRes = await fetch("https://openapi.chzzk.naver.com/auth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code,
        state,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.accessToken) {
      console.log("✅ Access Token 발급 성공:", tokenData.accessToken);
      console.log("🔁 Refresh Token:", tokenData.refreshToken);

      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>✅ Access Token 발급 성공!</h2>
            <p>콘솔에 Access Token이 출력되었습니다.</p>
            <p>Render 환경변수에 <code>CHZZK_ACCESS_TOKEN</code>으로 등록해주세요.</p>
          </body>
        </html>
      `);
    } else {
      console.error("❌ 발급 실패:", tokenData);
      return res.status(400).send(`<h3>❌ Access Token 발급 실패</h3><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
    }
  } catch (err) {
    console.error("❌ Access Token 발급 오류:", err);
    return res.status(500).send("❌ Access Token 발급 실패");
  }
});

// ✅ 치지직 세션 연결 및 채팅 구독
async function connectChzzkChat() {
  console.log("🔗 치지직 WebSocket 연결 시도...");

  try {
    // 1️⃣ 세션 생성 (Access Token 인증)
    const authRes = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!authRes.ok) {
      console.error("❌ 세션 생성 실패:", await authRes.text());
      setTimeout(connectChzzkChat, 10000);
      return;
    }

    const authData = await authRes.json();
    const socketUrl = authData?.content?.url;
    if (!socketUrl) {
      console.error("❌ 세션 URL 누락:", authData);
      setTimeout(connectChzzkChat, 10000);
      return;
    }

    console.log("✅ 세션 URL 획득:", socketUrl);

    // 2️⃣ Socket.IO 연결
    const socket = ioClient(socketUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
      forceNew: true,
    });

    socket.on("connect", () => {
      console.log("✅ 소켓 연결 완료");
    });

    socket.on("SYSTEM", async (data) => {
      if (!data?.sessionKey) return;
      console.log("✅ 세션키 수신:", data.sessionKey);

      // 3️⃣ 채팅 구독 요청 (Access Token 인증)
      const subRes = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionKey: data.sessionKey,
          channelId: CHANNEL_ID,
        }),
      });

      if (!subRes.ok) {
        console.error("❌ 채팅 구독 실패:", await subRes.text());
        return;
      }

      console.log("✅ 채팅 구독 성공!");
    });

    // 4️⃣ CHAT 이벤트 수신
    socket.on("CHAT", (msg) => {
      if (msg?.profile?.nickname && msg?.message) {
        console.log(`${msg.profile.nickname}: ${msg.message}`);
        broadcast({
          type: "chat",
          payload: {
            nickname: msg.profile.nickname,
            message: msg.message,
          },
        });
      }
    });

    socket.on("disconnect", () => {
      console.warn("⚠️ 소켓 연결 종료됨. 재시도 중...");
      setTimeout(connectChzzkChat, 10000);
    });

    socket.on("connect_error", (err) => {
      console.error("❌ 소켓 연결 오류:", err.message);
      setTimeout(connectChzzkChat, 10000);
    });
  } catch (err) {
    console.error("❌ 연결 오류:", err);
    setTimeout(connectChzzkChat, 10000);
  }
}

connectChzzkChat();
