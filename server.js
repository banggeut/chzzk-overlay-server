// 기존 import 그대로 유지
import express from "express";
import fetch from "node-fetch";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import ioClient from "socket.io-client";
import { promises as fs } from 'fs'; // ⭐ 파일 시스템 모듈 추가 ⭐

const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;
let ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.CHZZK_REFRESH_TOKEN;
const PORT = process.env.PORT || 10000;
let tokenExpired = false;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID || "";

let chzzkSocket = null;
let chatSubscribed = false;
let tokenRefreshInterval = null; // 토큰 자동 갱신 interval

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.json());
app.set('trust proxy', 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ⭐ [추가] 토큰 저장 파일 경로 설정 ⭐
const TOKENS_FILE_PATH = path.join(__dirname, "chzzk_tokens.json");

app.get("/", (req, res) => {
  if (tokenExpired || !REFRESH_TOKEN) res.sendFile(path.join(__dirname, "public", "expired.html"));
  else res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 이모티콘 평탄화: 다양한 구조를 code -> url 맵으로 변환
function normalizeEmojis(raw) {
  if (!raw) return {};
  const map = {};
  try {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const code = item?.code || item?.key || item?.name;
        const url = item?.url || item?.imageUrl || item?.src || item?.images?.small || item?.images?.default;
        if (code && typeof url === 'string') map[code] = url;
      }
    } else if (typeof raw === 'object') {
      for (const code of Object.keys(raw)) {
        const v = raw[code];
        let url;
        if (typeof v === 'string') {
          url = /^https?:\/\//.test(v) ? v : undefined;
        } else {
          url = v?.url || v?.imageUrl || v?.src;
        }
        if (!url && v && typeof v === 'object') {
          for (const k of Object.keys(v)) {
            if (typeof v[k] === 'string' && /^https?:\/\//.test(v[k])) { url = v[k]; break; }
          }
        }
        if (typeof url === 'string') map[code] = url;
      }
    }
  } catch {}
  return map;
}

// ✅ 로그인 URL 동적 생성 라우트
let lastState = "";
app.get("/login", (req, res) => {
  const xfProto = req.get('x-forwarded-proto');
  const protocol = xfProto ? xfProto.split(',')[0].trim() : (req.protocol || 'https');
  const host = req.get("host");
  const redirectUri = `${protocol}://${host}/api/chzzk/auth/callback`;
  lastState = Math.random().toString(36).slice(2);
  // 쿠키로도 보관 (인스턴스/탭 변화 대비)
  res.setHeader('Set-Cookie', `oauth_state=${lastState}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  const scope = 'chat openid profile email';
  const authUrl = `https://chzzk.naver.com/account-interlock?clientId=${encodeURIComponent(CLIENT_ID)}&redirectUri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(lastState)}&scope=${encodeURIComponent(scope)}`;
  if (!CLIENT_ID) {
    console.error("/login 호출: CLIENT_ID 미설정");
    return res.status(500).send("CLIENT_ID 미설정");
  }
  console.log("/login 호출 → CHZZK 리다이렉트", { redirectUri });
  res.redirect(authUrl);
});

// ⭐ [새로 추가] 토큰을 파일에 저장하는 함수 ⭐
async function saveTokens() {
    try {
        const tokens = JSON.stringify({ ACCESS_TOKEN, REFRESH_TOKEN }, null, 2);
        await fs.writeFile(TOKENS_FILE_PATH, tokens);
        console.log("💾 토큰 파일 저장 성공");
    } catch (err) {
        console.error("❌ 토큰 파일 저장 실패:", err);
    }
}

// ⭐ [새로 추가] 파일에서 토큰을 불러오는 함수 ⭐
async function loadTokens() {
    try {
        const data = await fs.readFile(TOKENS_FILE_PATH, 'utf-8');
        const tokens = JSON.parse(data);
        if (tokens.ACCESS_TOKEN && tokens.REFRESH_TOKEN) {
            ACCESS_TOKEN = tokens.ACCESS_TOKEN;
            REFRESH_TOKEN = tokens.REFRESH_TOKEN;
            console.log("📁 파일에서 토큰 로드 성공");
            return true;
        }
    } catch (err) {
        console.log("🤷‍♂️ 토큰 파일이 없거나 읽기 실패. 환경 변수 사용 시도.");
        return false;
    }
}

// ✅ 토큰 자동 갱신 시작 (15분마다)
function startAutoTokenRefresh() {
    // 기존 interval 정리
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
    }
    
    // 새로 시작 (15분 = 900,000ms)
    tokenRefreshInterval = setInterval(async () => {
        if (REFRESH_TOKEN) {
            console.log("⏰ 자동 토큰 갱신 시간 도래");
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                // 갱신 성공 시 연결 재확인
                if (!chzzkSocket || !chzzkSocket.connected) {
                    console.log("🔄 연결 끊김 감지, 재연결 시도...");
                    setTimeout(startChatConnection, 2000);
                }
            } else {
                // 갱신 실패 시 재시도 (5분 후)
                console.log("⏰ 토큰 갱신 실패, 5분 후 재시도 예약...");
                setTimeout(async () => {
                    if (REFRESH_TOKEN) {
                        await refreshAccessToken();
                    }
                }, 5 * 60 * 1000);
            }
        }
    }, 15 * 60 * 1000); // 15분
    
    console.log("⏰ 자동 토큰 갱신 시작 (15분마다)");
}

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
      await saveTokens(); // ⭐ 갱신 성공 시 파일에 저장 ⭐
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
    console.log("📡 세션 생성 요청 시작");
    const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Client-Id": CLIENT_ID,
      },
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
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

// ✅ 채팅 구독 (채널 ID 필수 포함)
async function subscribeChatEvent(sessionKey) {
  try {
    console.log("📨 구독 요청 보냄:", { sessionKey, channelId: CHANNEL_ID });

    const res = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${encodeURIComponent(sessionKey)}&channelId=${encodeURIComponent(CHANNEL_ID)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
      }
    );

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log("📨 구독 응답:", data);

    if (data && data.code === 200) {
      console.log(`✅ 채팅 이벤트 구독 요청 성공 (${CHANNEL_ID})`);
    } else {
      console.error("❌ 채팅 이벤트 구독 실패:", data);
    }
  } catch (err) {
    console.error("❌ 채팅 구독 요청 오류:", err);
  }
}

// ✅ 치지직 소켓 연결 (Socket.IO v2.x 호환되도록 수정)
function connectChzzkSocketIO(sessionURL) {
  console.log("🔗 치지직 소켓 연결 시도...");
  const [baseUrl, query] = sessionURL.split("?");
  const authToken = new URLSearchParams(query).get("auth");

  if (chzzkSocket) chzzkSocket.disconnect();

  const socket = ioClient(baseUrl, {
    transports: ["websocket"],
    reconnection: false, 
    forceNew: true, 
    timeout: 5000,
    query: { auth: authToken },
  });
  chzzkSocket = socket;

  socket.on("connect", () => console.log("✅ 소켓 연결 성공:", socket.id));

  // ✅ SYSTEM 이벤트 처리 (문자열 페이로드 대비)
  socket.on("SYSTEM", (data) => {
    let systemData = data;
    if (typeof systemData === 'string') {
      try { systemData = JSON.parse(systemData); } catch { console.warn("SYSTEM 페이로드 파싱 실패", systemData); }
    }
    console.log("🟢 SYSTEM 이벤트 수신:", typeof systemData === 'object' ? JSON.stringify(systemData) : systemData);

    // connected 이벤트 처리: 세션 키 수신 후 1초 뒤 구독 요청
    if (systemData && systemData.type === "connected" && systemData.data && systemData.data.sessionKey) {
      const sessionKey = systemData.data.sessionKey;
      console.log("🔑 세션키 수신됨:", sessionKey);
      console.log("⏳ 1초 후 채팅 구독 시도...");
      setTimeout(() => {
        chatSubscribed = false;
        subscribeChatEvent(sessionKey);
        // 5초 내에 subscribed 확인이 없으면 재시도
        setTimeout(() => {
          if (!chatSubscribed) {
            console.warn("⏱️ 구독 확인 없음 → 재시도");
            subscribeChatEvent(sessionKey);
          }
        }, 5000);
      }, 1000);
    }

    // subscribed 이벤트 처리 (구독 완료 확인용)
    if (systemData && systemData.type === "subscribed" && systemData.data && systemData.data.eventType === "CHAT") {
      console.log(`✅ CHAT 이벤트 구독 확인 완료 (채널: ${systemData.data.channelId})`);
      chatSubscribed = true;
    }
  });

  // ✅ CHAT 이벤트 수신
  socket.on("CHAT", (data) => {
    try {
      let chatData = data;
      if (typeof chatData === 'string') {
        try { chatData = JSON.parse(chatData); } catch { console.warn("CHAT 페이로드 파싱 실패", chatData); }
      }
      const nickname = chatData.profile?.nickname || "익명";
      const message = chatData.content || chatData.msg || ""; 
      const emojis = normalizeEmojis(chatData.emojis);
      const badges = chatData.profile?.badges || [];

      // 💬 오버레이 클라이언트로 전송 (이벤트 이름: chatMessage)
      io.emit("chatMessage", { nickname, message, emojis });
      console.log("💬", nickname + ":", message);
      // 디버깅: 이모지 구조 로깅 (없을 경우 원본 페이로드 일부 출력)
      if (!chatData.emojis || Object.keys(emojis).length === 0) {
        try {
          const hasToken = /\{:[^}]+:\}/.test(message);
          if (hasToken) {
            console.log("🧩 이모지 원본 구조:", JSON.stringify(chatData.emojis));
            console.log("🧩 CHAT 원본 일부:", JSON.stringify({
              content: chatData.content,
              msg: chatData.msg,
              extra: chatData.extra,
            }));
          }
        } catch {}
      }

      if (Object.keys(emojis).length > 0) console.log("🧩 이모지:", emojis);
      if (badges.length > 0) console.log("🎖️ 뱃지:", badges);
    } catch (err) {
      console.error("❌ 채팅 파싱 오류:", err);
    }
  });

  // 모든 이벤트 로깅(이름 파악용) - v2에서는 onAny 미지원
  if (typeof socket.onAny === 'function') {
    socket.onAny((event, payload) => {
      if (event !== 'SYSTEM' && event !== 'CHAT') {
        console.log("🔔 기타 이벤트:", event, typeof payload === 'object' ? JSON.stringify(payload) : payload);
      }
    });
  } else {
    console.log("ℹ️ socket.io-client v2: onAny 미지원, 기본 이벤트만 로깅합니다");
  }

  socket.on("connect_error", (err) => {
    console.error("❌ 소켓 연결 오류:", err.message || err);
    if (err.message && (err.message.includes("401") || err.message.includes("INVALID_TOKEN"))) {
      chzzkSocket.disconnect();
      console.log("토큰 오류 발생. 토큰 갱신 후 재연결 시도...");
      if (REFRESH_TOKEN) {
        refreshAccessToken().then((refreshed) => {
          if (refreshed) {
            setTimeout(startChatConnection, 2000);
          } else {
            setTimeout(startChatConnection, 5000);
          }
        });
      } else {
        setTimeout(startChatConnection, 5000);
      }
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ 소켓 종료:", reason);
    if (reason !== "io client disconnect") {
      // 예상치 못한 연결 끊김 시 토큰 확인 후 재연결
      if (REFRESH_TOKEN && (reason === "transport close" || reason === "ping timeout")) {
        console.log("🔄 연결 끊김, 토큰 확인 후 재연결 시도...");
        refreshAccessToken().then((refreshed) => {
          setTimeout(startChatConnection, refreshed ? 2000 : 5000);
        });
      } else {
        console.log("5초 후 연결 재시도...");
        setTimeout(startChatConnection, 5000);
      }
    }
  });

  socket.connect();
}

// ✅ 전체 연결
async function startChatConnection() {
  console.log("--- 채팅 연결 전체 프로세스 시작 ---");

  // ⭐ [수정] 파일에서 토큰 로드 시도 ⭐
  if (!ACCESS_TOKEN && !REFRESH_TOKEN) {
      await loadTokens();
  }
  
  if (!ACCESS_TOKEN || tokenExpired) {
    if (REFRESH_TOKEN) {
      const refreshed = await refreshAccessToken();
      // ⭐ 갱신 성공 시 이미 saveTokens()를 호출했으므로 파일 저장은 여기서 할 필요 없음 ⭐
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
  if (sessionURL) {
    connectChzzkSocketIO(sessionURL);
    startAutoTokenRefresh(); // 자동 갱신 시작
  } else {
    // 세션 생성 실패 시 토큰 갱신 먼저 시도
    if (REFRESH_TOKEN && !tokenExpired) {
      console.log("🔄 세션 생성 실패, 토큰 갱신 후 재시도...");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        setTimeout(startChatConnection, 2000);
      } else {
        console.log("❌ 토큰 갱신 실패. 5초 후 재시도...");
        setTimeout(startChatConnection, 5000);
      }
    } else {
      console.log("❌ 세션 생성 실패. 5초 후 재시도...");
      setTimeout(startChatConnection, 5000);
    }
  }
}


// (시청자 수 기능 제거)

// ✅ 인증 콜백
app.get("/api/chzzk/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("인증 코드가 없습니다.");
  // 쿠키에서 state도 읽어서 검증
  const cookieHeader = req.headers.cookie || '';
  const cookieState = (cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/) || [])[1];
  if (!state || (state !== lastState && state !== cookieState)) {
    console.error("state 검증 실패", { state, lastState, cookieState });
    return res.status(400).send("state 검증 실패");
  }

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

    const tokenText = await tokenRes.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch { tokenData = { raw: tokenText }; }

    if (tokenData?.content?.accessToken) {
      console.log("✅ Access Token 발급 성공:", tokenData.content.accessToken);
      console.log("🔁 Refresh Token:", tokenData.content.refreshToken);
      ACCESS_TOKEN = tokenData.content.accessToken;
      REFRESH_TOKEN = tokenData.content.refreshToken;
      tokenExpired = false;
      
      // ⭐ [수정 반영] 토큰 발급 후 파일 저장 및 연결 시작 ⭐
      await saveTokens();
      startChatConnection();

      res.send(`
        <html><head><meta charset="utf-8"/></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:50px;">
          <h2>✅ 치지직 Access Token 발급 완료!</h2>
          <p>이 창을 닫고 OBS 오버레이를 새로고침하세요.</p>
          <p>⚠️ Access Token 발급 시 scope에 <strong>chat openid profile email</strong> 포함 필수</p>
        </body></html>
      `);
    } else {
      console.log("❌ Access Token 발급 실패:", tokenData);
      res.status(403).send(`<pre>${typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData, null, 2)}</pre>`);
    }
  } catch (err) {
    console.error("❌ 토큰 발급 오류:", err);
    res.status(500).send("서버 오류 발생");
  }
});

// ✅ 초기 연결 시작 (파일 로드 시도 후 시작)
(async () => {
  await startChatConnection();
})();

// ✅ 오버레이 클라이언트 연결
io.on("connection", (socket) => {
  console.log("🟢 오버레이 클라이언트 연결:", socket.id);
  socket.on("disconnect", () => console.log("🔴 클라이언트 종료:", socket.id));
});

// ✅ 서버 시작
httpServer.listen(PORT, () => console.log(`✅ 서버 실행 중: 포트 ${PORT}`));