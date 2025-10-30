import express from "express";
import fetch from "node-fetch";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import ioClient from "socket.io-client";

const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
let ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.CHZZK_REFRESH_TOKEN;
const PORT = process.env.PORT || 10000;
let tokenExpired = false;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.json());

// 경로 설정
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

// ✅ 인증 콜백 (Access Token 발급)
app.get("/api/chzzk/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("인증 코드가 없습니다.");

  console.log("🔑 인증 코드 수신:", code);

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

    if (tokenData?.content?.accessToken) {
      console.log("✅ Access Token 발급 성공:", tokenData.content.accessToken);
      console.log("🔁 Refresh Token:", tokenData.content.refreshToken);

      res.send(`
        <html>
          <head><meta charset="utf-8" /></head>
          <body style="font-family:sans-serif; text-align:center; margin-top:50px;">
            <h2>✅ 치지직 Access Token 발급 완료!</h2>
            <p><strong>Access Token:</strong> ${tokenData.content.accessToken}</p>
            <p><strong>Refresh Token:</strong> ${tokenData.content.refreshToken}</p>
            <p>Render 환경변수에 추가하고 배포하면 됩니다.</p>
          </body>
        </html>
      `);
    } else {
      console.log("❌ Access Token 발급 실패:", tokenData);
      res.status(403).send(tokenData);
    }
  } catch (err) {
    console.error("❌ 토큰 발급 중 오류:", err);
    res.status(500).send("서버 오류 발생");
  }
});

// ✅ Access Token 갱신
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
      console.log("✅ Access Token 갱신 완료:", ACCESS_TOKEN.slice(0, 20) + "...");
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

// ✅ 세션 생성
async function createSession() {
  try {
    const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
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
    console.error("❌ 세션 생성 오류:", err);
  }
  return null;
}

// ✅ 치지직 소켓 연결 (v2 호환)
function connectChzzkSocketIO(sessionURL) {
  console.log("🔗 치지직 소켓 연결 시도...");
  const [baseUrl, query] = sessionURL.split("?");
  const authToken = new URLSearchParams(query).get("auth");

  const socket = ioClient(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
    query: { auth: authToken },
  });

  socket.on("connect", () => console.log("✅ 소켓 연결 성공:", socket.id));
  socket.on("SYSTEM", (data) => console.log("🟢 시스템 이벤트:", data));

  socket.on("CHAT", (data) => {
    try {
      const chat = JSON.parse(data.bdy.chatMessage);
      const nickname = chat.profile?.nickname || "익명";
      const message = chat.msg || "";
      io.emit("chat", { nickname, message });
      console.log("💬", nickname + ":", message);
    } catch (err) {
      console.error("❌ 채팅 파싱 오류:", err);
    }
  });

  socket.on("connect_error", async (err) => {
    console.error("❌ 소켓 오류:", err.message);
    if (err.message.includes("401") || err.message.includes("INVALID_TOKEN")) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const newSessionURL = await createSession();
        if (newSessionURL) connectChzzkSocketIO(newSessionURL);
      } else tokenExpired = true;
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ 소켓 종료:", reason);
    setTimeout(async () => {
      const newSessionURL = await createSession();
      if (newSessionURL) connectChzzkSocketIO(newSessionURL);
    }, 5000);
  });
}

// ✅ 초기 연결
(async () => {
  const sessionURL = await createSession();
  if (sessionURL) connectChzzkSocketIO(sessionURL);
  else {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newSessionURL = await createSession();
      if (newSessionURL) connectChzzkSocketIO(newSessionURL);
    } else tokenExpired = true;
  }
})();

// ✅ 시청자 수 API
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

// ✅ 오버레이 클라이언트
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => console.log("🔴 클라이언트 종료:", socket.id));
});

// ✅ 서버 시작
httpServer.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
});
