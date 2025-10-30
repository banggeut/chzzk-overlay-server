import express from "express";
import { Server } from "socket.io";
import fetch from "node-fetch";
import http from "http";
import WebSocket from "ws";
import ioClient from "socket.io-client";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==============================
// 기본 설정
// ==============================
const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

let lastChatAt = 0;
let lastSystemSessionKey = null;
const DEBUG_CHZZK = true;

// ==============================
// Access Token 갱신 로직
// ==============================
async function refreshAccessToken() {
    console.log("🔄 Access Token 갱신 시도 중...");
    try {
        const res = await fetch("https://openapi.chzzk.naver.com/auth/v1/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grantType: "refresh_token",
                clientId: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                refreshToken: REFRESH_TOKEN,
            }),
        });

        const data = await res.json();
        if (data.accessToken) {
            ACCESS_TOKEN = data.accessToken;
            REFRESH_TOKEN = data.refreshToken;
            console.log("✅ Access Token 갱신 완료:", ACCESS_TOKEN);
        } else {
            console.error("❌ Access Token 갱신 실패:", data);
        }
    } catch (err) {
        console.error("❌ Access Token 갱신 실패:", err);
    }
}

// ==============================
// 세션 생성 (유저 기반)
// ==============================
async function createChzzkSession() {
    console.log("🔗 치지직 WebSocket 연결 시도...");
    try {
        const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/auth", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
            },
        });

        const data = await res.json();
        if (data.content?.url) {
            console.log("✅ 세션 URL 획득:", data.content.url);
            connectChzzkSocketIO(data.content.url);
        } else {
            console.error("❌ 세션 생성 실패:", data);
            setTimeout(createChzzkSession, 5000);
        }
    } catch (err) {
        console.error("❌ 세션 생성 오류:", err);
        setTimeout(createChzzkSession, 5000);
    }
}

// ==============================
// 채팅 구독
// ==============================
async function subscribeChatEvent(sessionKey) {
    try {
        const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sessionKey }), // ⚠️ 문서 기준: sessionKey만
        });

        const raw = await res.text();
        console.log("📡 구독 응답 원문:", raw);

        let data;
        try { data = JSON.parse(raw); } catch { data = { code: res.status, message: "non-json" }; }

        if (data.code === 200) console.log("✅ 채팅 이벤트 구독 성공");
        else console.error("❌ 채팅 이벤트 구독 실패:", data);
    } catch (err) {
        console.error("❌ 채팅 구독 오류:", err);
    }
}

// ==============================
// CHZZK WebSocket 연결 (Socket.IO 2.x 방식)
// ==============================
function connectChzzkSocketIO(sessionURL) {
    console.log("--- 채팅 연결 전체 프로세스 시작 ---");

    const socket = ioClient(sessionURL, {
        transports: ["websocket"],
        reconnection: false,
        timeout: 5000,
    });

    // [ADD] 모든 이벤트 로깅
    if (DEBUG_CHZZK && typeof socket.onAny === "function") {
        socket.onAny((event, payload) => {
            try {
                const text = typeof payload === "string" ? payload : JSON.stringify(payload);
                console.log(`[CHZZK EVT] ${event}:`, (text.length > 800 ? text.slice(0, 800) + " ...[trunc]" : text));
            } catch {
                console.log(`[CHZZK EVT] ${event} (payload not serializable)`);
            }
        });
    }

    // [SYSTEM 이벤트]
    socket.on("SYSTEM", (data) => {
        console.log("🟢 SYSTEM 이벤트 수신:", data);
        if (data?.data?.sessionKey) lastSystemSessionKey = data.data.sessionKey;

        // 5초 후에도 CHAT 미수신 시 재구독 시도
        setTimeout(() => {
            if (!lastChatAt && lastSystemSessionKey) {
                console.warn("⏳ CHAT 미수신 -> 재구독 시도");
                subscribeChatEvent(lastSystemSessionKey);
            }
        }, 5000);
    });

    // [CHAT 이벤트]
    socket.on("CHAT", (data) => {
        try {
            lastChatAt = Date.now();

            let nickname = data?.profile?.nickname || data?.user?.nickname || "익명";
            let message = data?.content || data?.message || "";

            if (!message && data?.bdy?.chatMessage) {
                try {
                    const legacy = JSON.parse(data.bdy.chatMessage);
                    nickname = legacy?.profile?.nickname || nickname;
                    message = legacy?.msg || legacy?.message || message;
                } catch {}
            }

            if (!message) {
                console.warn("⚠️ CHAT 수신했으나 message 없음. payload=", data);
                return;
            }

            console.log("💬", nickname + ":", message);

            io.emit("chatMessage", { nickname, message });
            io.emit("chat", { nickname, message });

        } catch (err) {
            console.error("❌ CHAT 파싱 오류:", err, "payload=", data);
        }
    });

    // [연결 완료]
    socket.on("connect", () => console.log("✅ 소켓 연결 성공:", socket.id));
    socket.on("disconnect", () => console.warn("⚠️ 소켓 연결 종료됨. 재시도 예정."));
}

// ==============================
// 시청자 수 API (테스트용)
// ==============================
app.get("/api/viewers", async (req, res) => {
    const { channelId } = req.query;
    try {
        const r = await fetch(`https://openapi.chzzk.naver.com/open/v1/channels/${channelId}/live-status`, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
            },
        });
        const d = await r.json();
        res.json({ viewers: d.content?.liveStatus?.watchingCount || 0 });
    } catch (err) {
        console.error("❌ Viewer fetch error:", err);
        res.json({ viewers: 0 });
    }
});

// ==============================
// 구독 상태 진단 API
// ==============================
app.get("/debug/subscriptions", async (_req, res) => {
    try {
        const r = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Client-Id": CLIENT_ID,
            },
        });
        const t = await r.text();
        console.log("🔍 세션 목록 원문:", t);
        res.type("json").send(t);
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

// ==============================
// CHAT 미수신 감시 (20초 조용하면 재구독)
// ==============================
setInterval(() => {
    if (!lastSystemSessionKey) return;
    const silentFor = Date.now() - (lastChatAt || 0);
    if (silentFor > 20000) {
        console.warn(`⏳ ${Math.round(silentFor / 1000)}초 동안 CHAT 미수신 -> 재구독 시도`);
        subscribeChatEvent(lastSystemSessionKey);
    }
}, 5000);

// ==============================
// 서버 시작
// ==============================
server.listen(PORT, () => {
    console.log(`✅ 서버 실행 중: 포트 ${PORT}`);
    createChzzkSession();
});
