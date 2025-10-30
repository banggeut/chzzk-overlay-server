import express from "express";
import fetch from "node-fetch";
import { Server } from "socket.io";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
let ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.CHZZK_REFRESH_TOKEN;
const PORT = process.env.PORT || 10000;
let tokenExpired = false;

const app = express();
const server = createServer(app);
const io = new Server(server);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  if (tokenExpired) {
    res.sendFile(path.join(__dirname, "public", "expired.html"));
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

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
      tokenExpired = false;
      console.log("✅ Access Token 갱신 완료:", ACCESS_TOKEN.slice(0, 15) + "...");
      return true;
    } else {
      console.log("❌ Access Token 갱신 실패:", data);
      tokenExpired = true;
      return false;
    }
  } catch (err) {
    console.error("❌ Access Token 갱신 오류:", err);
    tokenExpired = true;
    return false;
  }
}

setInterval(refreshAccessToken, 1000 * 60 * 60 * 20);

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
      return data.content.url;
    } else {
      console.log("❌ 세션 생성 실패:", data);
    }
  } catch (err) {
    console.error("❌ 세션 생성 오류:", err);
  }
  return null;
}

async function connectChzzkSocket() {
  console.log("🔗 치지직 WebSocket 연결 시도...");
  const sessionURL = await createSession();

  if (!sessionURL) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      console.log("🔁 토큰 갱신 후 세션 재시도...");
      return connectChzzkSocket();
    } else {
      console.error("❌ 토큰 갱신 실패 — 새 인증 필요");
      tokenExpired = true;
      return;
    }
  }

  if (!sessionURL.includes("?auth=")) {
    console.error("❌ 세션 URL에 auth 토큰 없음");
    const refreshed = await refreshAccessToken();
    if (refreshed) return connectChzzkSocket();
    tokenExpired = true;
    return;
  }

  console.log("✅ 세션 URL 획득:", sessionURL);
  const ws = new WebSocket(sessionURL, { rejectUnauthorized: false });

  ws.on("open", () => console.log("✅ 치지직 소켓 연결 완료"));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data?.bdy?.chatMessage) {
        const chat = JSON.parse(data.bdy.chatMessage);
        const nickname = chat.profile?.nickname || "익명";
        const message = chat.msg || "";
        io.emit("chat", { nickname, message });
        console.log("💬", nickname + ":", message);
      }
    } catch (err) {
      console.error("메시지 파싱 오류:", err);
    }
  });

  ws.on("error", async (err) => {
    console.error("❌ 소켓 오류:", err.message);
    if (String(err).includes("401") || String(err).includes("INVALID_TOKEN")) {
      console.log("🔄 Access Token 재갱신 시도...");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        console.log("✅ 토큰 갱신 성공 — 재연결 중...");
        return connectChzzkSocket();
      } else {
        console.error("❌ 토큰 재갱신 실패. 새 로그인 필요.");
        tokenExpired = true;
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`⚠️ 소켓 연결 종료 (${code}): ${reason}`);
    console.log("⏳ 5초 후 재연결 시도...");
    setTimeout(connectChzzkSocket, 5000);
  });
}

connectChzzkSocket();

io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => console.log("🔴 클라이언트 종료:", socket.id));
});

app.get("/api/viewers", async (req, res) => {
  const { channelId } = req.query;
  try {
    const response = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/channels/${channelId}/viewers`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    const data = await response.json();
    res.json({ viewers: data?.content?.viewers || 0 });
  } catch {
    res.status(500).json({ error: "Viewer fetch failed" });
  }
});

server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
});
