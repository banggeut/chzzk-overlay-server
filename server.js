import express from "express";
import fetch from "node-fetch";
import { Server } from "socket.io";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

// -------------------------------
// 환경 변수 설정
// -------------------------------
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
let ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.CHZZK_REFRESH_TOKEN;
const PORT = process.env.PORT || 10000;

// -------------------------------
// Express 초기화
// -------------------------------
const app = express();
const server = createServer(app);
const io = new Server(server);
app.use(express.json());

// 정적 파일 서빙
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -------------------------------
// Access Token 갱신
// -------------------------------
async function refreshAccessToken() {
  console.log("🔄 Access Token 갱신 시도 중...");
  try {
    const res = await fetch("https://openapi.chzzk.naver.com/auth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "refresh_token",
        refreshToken: REFRESH_TOKEN,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
    });

    const data = await res.json();
    if (data?.content?.accessToken) {
      ACCESS_TOKEN = data.content.accessToken;
      REFRESH_TOKEN = data.content.refreshToken;
      console.log("✅ Access Token 갱신 완료:", ACCESS_TOKEN.slice(0, 15) + "...");
      return true;
    } else {
      console.log("❌ Access Token 갱신 실패:", data);
      return false;
    }
  } catch (err) {
    console.error("❌ Access Token 갱신 중 오류:", err);
    return false;
  }
}

// 20시간마다 갱신 시도
setInterval(refreshAccessToken, 1000 * 60 * 60 * 20);

// -------------------------------
// 치지직 세션 생성
// -------------------------------
async function createSession() {
  try {
    const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth/client", {
      method: "GET",
      headers: {
        "Client-Id": CLIENT_ID,
        "Client-Secret": CLIENT_SECRET,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    if (data?.content?.url) {
      console.log("✅ 세션 URL 획득:", data.content.url);
      return data.content.url;
    } else {
      console.log("❌ 세션 생성 실패:", data);
    }
  } catch (err) {
    console.error("❌ 세션 생성 중 오류:", err);
  }
  return null;
}

// -------------------------------
// 치지직 WebSocket 연결
// -------------------------------
async function connectChzzkSocket() {
  console.log("🔗 치지직 WebSocket 연결 시도...");
  const sessionURL = await createSession();
  if (!sessionURL) return;

  const ws = new WebSocket(sessionURL, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => {
    console.log("✅ 소켓 연결 완료");
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data?.bdy?.chatMessage) {
        const chat = JSON.parse(data.bdy.chatMessage);
        const nickname = chat.profile?.nickname || "익명";
        const message = chat.msg || "";
        io.emit("chat", { nickname, message });
        console.log("💬", nickname + ":", message);
      }
    } catch (err) {
      console.error("메시지 처리 오류:", err);
    }
  });

  ws.on("close", () => {
    console.log("⚠️ 소켓 연결 종료됨, 5초 후 재시도...");
    setTimeout(connectChzzkSocket, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ 소켓 오류:", err);
  });
}

connectChzzkSocket();

// -------------------------------
// WebSocket (오버레이 클라이언트)
// -------------------------------
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결됨:", socket.id);
  socket.on("disconnect", () => console.log("🔴 클라이언트 연결 종료:", socket.id));
});

// -------------------------------
// API 엔드포인트 (시청자 수)
// -------------------------------
app.get("/api/viewers", async (req, res) => {
  const { channelId } = req.query;
  try {
    const response = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/channels/${channelId}/viewers`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    const data = await response.json();
    res.json({ viewers: data?.content?.viewers || 0 });
  } catch (err) {
    res.status(500).json({ error: "Viewer fetch failed" });
  }
});

// -------------------------------
// 서버 시작
// -------------------------------
server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
});
