// 기존 import 그대로 유지
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
const CHANNEL_ID = "72540e0952096b201da89e667b70398b"; // ✅ 테스트용 채널 ID (본인 채널로 교체 필요)

let chzzkSocket = null;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  if (tokenExpired) res.sendFile(path.join(__dirname, "public", "expired.html"));
  else res.sendFile(path.join(__dirname, "public", "index.html"));
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
  if (tokenExpired || !ACCESS_TOKEN) {
    console.log("❌ 토큰 만료 또는 없음. 세션 생성 건너뛰기.");
    return null;
  }
  try {
    const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Client-Id": CLIENT_ID,
      },
    });

    const data = await res.json();
    if (data.code === 200 && data?.content?.url) {
      console.log("✅ 세션 URL 획득:", data.content.url);
      return data.content.url;
    } else {
      console.log("❌ 세션 생성 실패:", data);
      if (data.code === 401 || data.code === 403) tokenExpired = true;
      return null;
    }
  } catch (err) {
    console.error("❌ 세션 생성 오류:", err);
  }
  return null;
}

// ✅ 채팅 구독 (쿼리 파라미터 방식)
async function subscribeChatEvent(sessionKey) {
  try {
    console.log("📨 구독 요청 보냄:", { sessionKey });

    const res = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await res.json();
    console.log("📨 구독 응답 전체:", data);

    if (data.code === 200) {
      console.log(`✅ 채팅 이벤트 구독 요청 성공 (${CHANNEL_ID})`);
    } else {
      console.error("❌ 채팅 이벤트 구독 실패:", data);
    }
  } catch (err) {
    console.error("❌ 채팅 구독 요청 오류:", err);
  }
}

// ✅ 치지직 소켓 연결
function connectChzzkSocketIO(sessionURL) {
  console.log("🔗 치지직 소켓 연결 시도...");
  const [baseUrl, query] = sessionURL.split("?");
  const authToken = new URLSearchParams(query).get("auth");

  if (chzzkSocket) chzzkSocket.disconnect();

  const socket = ioClient(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
    query: { auth: authToken },
  });
  chzzkSocket = socket;

  socket.on("connect", () => console.log("✅ 소켓 연결 성공:", socket.id));

  // ✅ SYSTEM 이벤트 처리 (connected / subscribed 분리)
  socket.on("SYSTEM", (data) => {
    console.log("🟢 SYSTEM 이벤트 수신:", data);

    // connected 이벤트 처리
    if (data?.type === "connected" && data?.data?.sessionKey) {
      const sessionKey = data.data.sessionKey;
      console.log("🔑 세션키 수신됨:", sessionKey);
      console.log("⏳ 1초 후 채팅 구독 시도...");
      setTimeout(() => {
        subscribeChatEvent(sessionKey);
      }, 1000);
    }

    // subscribed 이벤트 처리 (구독 완료 확인용)
    if (data?.type === "subscribed" && data?.data?.eventType === "CHAT") {
      console.log(`✅ CHAT 이벤트 구독 확인 완료 (채널: ${data.data.channelId})`);
    }
  });

  // ✅ CHAT 이벤트 수신
  socket.on("CHAT", (data) => {
    try {
      const nickname = data.profile?.nickname || "익명";
      const message = data.content || data.msg || "";
      const emojis = data.emojis || {};
      const badges = data.profile?.badges || [];

      // 💬 오버레이로 전송 (이벤트 이름: chatMessage)
      io.emit("chatMessage", { nickname, message });
      console.log("💬", nickname + ":", message);

      // 🏷️ 추가 정보 (콘솔 디버깅용)
      if (Object.keys(emojis).length > 0) console.log("🧩 이모지:", emojis);
      if (badges.length > 0) console.log("🎖️ 뱃지:", badges);
    } catch (err) {
      console.error("❌ 채팅 파싱 오류:", err);
    }
  });

  socket.on("connect_error", (err) => {
    console.error("❌ 소켓 오류:", err.message);
    if (err.message.includes("401") || err.message.includes("INVALID_TOKEN")) {
      chzzkSocket.disconnect();
      setTimeout(startChatConnection, 5000);
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ 소켓 종료:", reason);
    if (reason !== "io client disconnect") {
      console.log("5초 후 연결 재시도...");
      setTimeout(startChatConnection, 5000);
    }
  });
}

// ✅ 전체 연결
async function startChatConnection() {
  console.log("--- 채팅 연결 전체 프로세스 시작 ---");
  if (!ACCESS_TOKEN || tokenExpired) {
    if (REFRESH_TOKEN) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        console.log("❌ Access Token 갱신 실패. 수동 인증 필요.");
        return;
      }
    } else {
      console.log("❌ ACCESS_TOKEN/REFRESH_TOKEN 없음. 수동 인증 필요.");
      tokenExpired = true;
      return;
    }
  }

  const sessionURL = await createSession();
  if (sessionURL) connectChzzkSocketIO(sessionURL);
  else {
    console.log("❌ 세션 생성 실패. 5초 후 재시도...");
    setTimeout(startChatConnection, 5000);
  }
}


// ⭐ [추가됨] 시청자 수 가져오기 및 클라이언트에게 전송
async function getViewerCount() {
    try {
        // 치지직 API를 사용하여 시청자 수를 조회
        const res = await fetch(`https://openapi.chzzk.naver.com/open/v1/channels/${CHANNEL_ID}/live-status`, {
            headers: {
                "Client-Id": CLIENT_ID,
            },
        });
        const data = await res.json();
        
        if (data.code === 200 && data.content?.status === "OPEN" && data.content.liveViewerCount !== undefined) {
            const count = data.content.liveViewerCount;
            console.log(`👁️ 시청자 수: ${count}`);
            // 모든 연결된 오버레이 클라이언트에게 시청자 수 전송
            io.emit("viewerCount", count); 
            return count;
        } else {
            // 방송 중이 아닐 경우
            io.emit("viewerCount", 0);
            return 0;
        }
    } catch (err) {
        console.error("❌ 시청자 수 조회 오류:", err);
        io.emit("viewerCount", 0);
        return 0;
    }
}

// ⭐ [추가됨] 시청자 수 주기적으로 업데이트
async function startViewerCountUpdate() {
    await getViewerCount(); // 서버 시작 시 즉시 1회 실행
    // 30초마다 시청자 수 업데이트
    setInterval(getViewerCount, 30000); 
}

// ✅ 인증 콜백
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
      ACCESS_TOKEN = tokenData.content.accessToken;
      REFRESH_TOKEN = tokenData.content.refreshToken;
      tokenExpired = false;
      
      // 토큰 발급 후 채팅 및 시청자 수 업데이트 시작
      startChatConnection();
      startViewerCountUpdate();

      res.send(`
        <html><head><meta charset="utf-8"/></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:50px;">
          <h2>✅ 치지직 Access Token 발급 완료!</h2>
          <p><strong>Access Token:</strong> ${tokenData.content.accessToken}</p>
          <p><strong>Refresh Token:</strong> ${tokenData.content.refreshToken}</p>
          <p>Render 환경변수에 추가하고 배포하면 됩니다.</p>
          <p>⚠️ Access Token 발급 시 scope에 <strong>chat openid profile email</strong> 포함 필수</p>
        </body></html>
      `);
    } else {
      console.log("❌ Access Token 발급 실패:", tokenData);
      res.status(403).send(tokenData);
    }
  } catch (err) {
    console.error("❌ 토큰 발급 오류:", err);
    res.status(500).send("서버 오류 발생");
  }
});

// ✅ 초기 연결 시작 (채팅 및 시청자 수 업데이트)
(async () => {
  await startChatConnection();
  await startViewerCountUpdate(); // 추가됨
})();

// ✅ 오버레이 클라이언트 연결
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => console.log("🔴 클라이언트 종료:", socket.id));
});

// ✅ 서버 시작
httpServer.listen(PORT, () => console.log(`✅ 서버 실행 중: 포트 ${PORT}`));