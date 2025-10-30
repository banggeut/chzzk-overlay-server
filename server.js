import express from "express";
import fetch from "node-fetch";
import { Server } from "socket.io";
import { createServer } from "http";
import ioClient from "socket.io-client";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 10000;

// ✅ CHZZK API 환경 변수
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;

// ✅ 기본 라우트
app.get("/", (req, res) => {
  res.send("✅ CHZZK Overlay Server is Running");
});

// ✅ 세션 URL 생성 함수 (GET으로 수정됨)
async function createSession() {
  console.log("--- 채팅 연결 전체 프로세스 시작 ---");
  const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
    method: "GET", // ✅ 수정됨 (405 오류 해결)
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Client-Id": CLIENT_ID,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ 세션 생성 실패:", res.status, text);
    throw new Error("세션 생성 실패");
  }

  const result = await res.json();
  const sessionUrl = result?.content?.session?.serverUrl;

  if (!sessionUrl) throw new Error("세션 URL이 없습니다.");

  console.log("✅ 세션 URL 획득:", sessionUrl);
  return sessionUrl;
}

// ✅ 치지직 소켓 연결 함수
async function connectToChzzk() {
  try {
    const socketURL = await createSession();

    const socket = ioClient.connect(socketURL, {
      reconnection: true,
      forceNew: true,
      timeout: 3000,
      transports: ["websocket"],
    });

    // ✅ 연결 이벤트
    socket.on("connect", () => {
      console.log("✅ 소켓 연결 성공:", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("🔴 소켓 연결 종료");
    });

    // ✅ SYSTEM 이벤트 (공식 샘플 반영)
    socket.on("SYSTEM", async (data) => {
      console.log("🟢 SYSTEM 이벤트 수신:", data);

      if (data?.type === "connected" && data?.data?.sessionKey) {
        const sessionKey = data.data.sessionKey;
        console.log("🔑 세션 키 획득:", sessionKey);

        // ⚙️ 채팅 이벤트 구독 요청
        try {
          const res = await fetch(
            `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
              },
              body: JSON.stringify({
                channelId: CHANNEL_ID,
              }),
            }
          );

          const result = await res.json();
          if (res.ok) {
            console.log("✅ 채팅 이벤트 구독 요청 성공:", result);
          } else {
            console.error("❌ 채팅 이벤트 구독 실패:", result);
          }
        } catch (err) {
          console.error("⚠️ 채팅 이벤트 구독 중 오류:", err);
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

// ✅ 클라이언트 연결 로그
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔴 클라이언트 종료:", socket.id);
  });
});

// ✅ 서버 시작
server.listen(PORT, async () => {
  console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
  await connectToChzzk();
});
