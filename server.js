import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const CHZZK_CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;
const CLIENT_ID = process.env.CHZZK_CLIENT_ID;
const CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET;

if (!CHZZK_CHANNEL_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

const server = app.listen(PORT, () => console.log(`✅ 서버 실행 중: 포트 ${PORT}`));
const wss = new WebSocketServer({ server });
let overlayClients = [];

wss.on("connection", (ws) => {
  overlayClients.push(ws);
  console.log("🎥 오버레이 클라이언트 연결됨");
  ws.on("close", () => overlayClients = overlayClients.filter(c => c !== ws));
});

async function connectChzzkChat() {
  console.log("🔗 치지직 WebSocket 연결 시도...");
  try {
    const session = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
      },
      body: JSON.stringify({
        channelId: CHZZK_CHANNEL_ID,
        events: ["chat", "viewer_count"]
      })
    }).then(res => res.json());

    const { sessionKey, serverUrl } = session.content;
    console.log("✅ 세션 발급 성공:", sessionKey);
    const chatSocket = new WebSocket(`${serverUrl}?sessionKey=${sessionKey}`);

    chatSocket.on("open", () => console.log("✅ 치지직 실시간 채팅 연결 완료"));

    chatSocket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "chat") broadcast({ type: "chat", payload: { userName: data.content.userNickname, message: data.content.message } });
        else if (data.type === "viewer_count") broadcast({ type: "viewer_count", payload: { count: data.content.viewCount } });
      } catch (err) { console.error("데이터 파싱 오류:", err); }
    });

    chatSocket.on("close", () => { console.warn("⚠️ 닫힘. 5초 후 재연결"); setTimeout(connectChzzkChat, 5000); });
    chatSocket.on("error", (err) => { console.error("❌ WebSocket 오류:", err); chatSocket.close(); });

  } catch (e) {
    console.error("❌ 치지직 연결 실패:", e);
    setTimeout(connectChzzkChat, 5000);
  }
}

function broadcast(obj) {
  const str = JSON.stringify(obj);
  overlayClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  });
}

connectChzzkChat();
