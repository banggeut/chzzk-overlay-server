import express from "express";
import fetch from "node-fetch";
import { Server } from "socket.io";
import { createServer } from "http";
import ioClient from "socket.io-client";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

// ⚙️ 환경 변수 설정
const CLIENT_ID = process.env.CHZZK_CLIENT_ID || "ef64115b-8119-43ba-9e9c-81d9106f93ae";
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;

// ✅ 기본 페이지
app.get("/", (req, res) => {
  res.send("✅ CHZZK Overlay Server is Running");
});

// ✅ Access Token 발급 콜백
app.get("/api/chzzk/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("❌ 인증 코드가 없습니다.");

  try {
    const tokenRes = await fetch("https://openapi.chzzk.naver.com/open/v1/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": CLIENT_ID,
        "Client-Secret": CLIENT_SECRET,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://chzzk-overlay-server.onrender.com/api/chzzk/auth/callback",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    const result = await tokenRes.json();
    console.log("✅ Access Token 발급 성공:", result);

    res.send(`
      <h2>✅ Access Token 발급 완료!</h2>
      <p><b>Access Token:</b> ${result.accessToken || result.access_token}</p>
      <p><b>Refresh Token:</b> ${result.refreshToken || result.refresh_token}</p>
      <p>이 값을 Render 환경변수에 등록하세요.<br>
      CHZZK_ACCESS_TOKEN, CHZZK_REFRESH_TOKEN 으로 추가한 후 다시 배포하세요.</p>
    `);
  } catch (err) {
    console.error("❌ Access Token 교환 실패:", err);
    res.status(500).send("Access Token 발급 중 오류가 발생했습니다.");
  }
});

// ✅ 세션 생성 함수 (수정 완료)
async function createSession() {
  console.log("--- 채팅 연결 전체 프로세스 시작 ---");

  const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Client-Id": CLIENT_ID,
      "Client-Secret": CLIENT_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channelId: CHANNEL_ID, // ✅ 필수로 추가됨
    }),
  });

  const result = await res.json();
  console.log("🧩 세션 생성 응답:", JSON.stringify(result, null, 2));

  const sessionUrl = result?.content?.session?.serverUrl;
  if (!sessionUrl) {
    console.error("❌ 세션 URL 없음 — 응답 원문:", result);
    throw new Error("세션 URL이 없습니다.");
  }

  console.log("✅ 세션 URL 획득:", sessionUrl);
  return sessionUrl;
}

// ✅ 치지직 소켓 연결
async function connectToChzzk() {
  try {
    const socketURL = await createSession();

    console.log("🔗 치지직 소켓 연결 시도...");
    const socket = ioClient.connect(socketURL, {
      reconnection: true,
      forceNew: true,
      timeout: 3000,
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("✅ 소켓 연결 성공:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("⚠️ 소켓 종료:", reason);
    });

    // ✅ SYSTEM 이벤트 수신
    socket.on("SYSTEM", async (data) => {
      console.log("🟢 SYSTEM 이벤트 수신:", data);

      if (data?.type === "connected" && data?.data?.sessionKey) {
        const sessionKey = data.data.sessionKey;
        console.log("🔑 세션 키 획득:", sessionKey);

        // ✅ CHAT 이벤트 구독 요청
        try {
          const res = await fetch(
            `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
                "Client-Secret": CLIENT_SECRET,
              },
              body: JSON.stringify({
                channelId: CHANNEL_ID,
              }),
            }
          );

          const result = await res.json();
          if (res.ok) {
            console.log("✅ 채팅 이벤트 구독 성공:", result);
          } else {
            console.error("❌ 채팅 이벤트 구독 실패:", result);
          }
        } catch (err) {
          console.error("⚠️ 채팅 이벤트 구독 오류:", err);
        }
      }
    });

    // ✅ CHAT 이벤트 수신
    socket.on("CHAT", (data) => {
      console.log("💬 CHAT 이벤트 수신:", data);
      io.emit("chat", {
        nickname: data.profile?.nickname || "익명",
        content: data.content || "",
        badges: data.profile?.badges || [],
        emojis: data.emojis || {},
        messageTime: data.messageTime,
      });
    });

    // ✅ DONATION 이벤트 수신
    socket.on("DONATION", (data) => {
      console.log("🎁 DONATION 이벤트 수신:", data);
      io.emit("donation", data);
    });
  } catch (err) {
    console.error("❌ 소켓 연결 실패:", err);
  }
}

// ✅ 오버레이 클라이언트 연결 로그
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔴 클라이언트 종료:", socket.id);
  });
});

// ✅ 서버 시작
server.listen(PORT, async () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
  if (ACCESS_TOKEN) {
    await connectToChzzk();
  } else {
    console.log("⚠️ Access Token이 설정되어 있지 않습니다. 먼저 /api/chzzk/auth/callback 경로로 로그인하세요.");
  }
});
