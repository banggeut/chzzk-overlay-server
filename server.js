const app = express();
const PORT = process.env.PORT || 3000;

// 🟢 치지직 액세스 토큰 & 채널 ID 환경변수에서 불러오기
const ACCESS_TOKEN = process.env.CHZZK_ACCESS_TOKEN;
const CHANNEL_ID = process.env.CHZZK_CHANNEL_ID;

let sessionKey = null;
let ws = null;

// 🔹 치지직 채팅 세션 생성
async function createSession() {
  const response = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
  const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions", {
method: "POST",
headers: {
"Authorization": `Bearer ${ACCESS_TOKEN}`,
@@ -26,59 +24,48 @@ async function createSession() {
}),
});

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`치지직 세션 생성 실패: ${response.status} - ${text}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`세션 생성 실패: ${res.status} - ${text}`);

  const data = await response.json();
  const data = JSON.parse(text);
sessionKey = data.content.session.sessionKey;
console.log("✅ 세션 생성 완료:", sessionKey);
}

// 🔹 이벤트 구독 (POST 필수)
async function subscribeChat() {
  const response = await fetch(
  const res = await fetch(
`https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat?sessionKey=${sessionKey}`,
{
      method: "POST", // ✅ 중요: 405 오류 방지
      method: "PUT", // ✅ 이제 POST가 아니라 PUT이야!
headers: {
"Authorization": `Bearer ${ACCESS_TOKEN}`,
"Content-Type": "application/json",
},
}
);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`치지직 구독 실패: ${response.status} - ${text}`);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`이벤트 구독 실패: ${res.status} - ${text}`);
console.log("✅ 채팅 이벤트 구독 완료");
}

// 🔹 이벤트 구독 해제
async function unsubscribeChat() {
  const response = await fetch(
  const res = await fetch(
`https://openapi.chzzk.naver.com/open/v1/sessions/events/unsubscribe/chat?sessionKey=${sessionKey}`,
{
      method: "POST", // ✅ 반드시 POST
      method: "PUT", // ✅ 구독 해제도 PUT
headers: {
"Authorization": `Bearer ${ACCESS_TOKEN}`,
"Content-Type": "application/json",
},
}
);

  if (!response.ok) {
    const text = await response.text();
    console.warn(`⚠️ 구독 해제 실패: ${response.status} - ${text}`);
  } else {
    console.log("🟡 구독 해제 완료");
  }
  const text = await res.text();
  if (!res.ok) console.warn(`⚠️ 구독 해제 실패: ${res.status} - ${text}`);
  else console.log("🟡 구독 해제 완료");
}

// 🔹 치지직 WebSocket 연결
async function connectChzzkChat() {
try {
console.log("🔗 치지직 WebSocket 연결 시도...");
@@ -100,19 +87,15 @@ async function connectChzzkChat() {
}
}

// 서버 시작 시 자동 연결
connectChzzkChat();

// Express 서버
app.get("/", (req, res) => {
  res.send("치지직 채팅 연결 서버 작동 중 💬");
  res.send("치지직 채팅 서버 작동 중 💬");
});

app.listen(PORT, () => {
console.log(`🚀 Server running on port ${PORT}`);
  connectChzzkChat();
});

// 종료 시 구독 해제
process.on("SIGINT", async () => {
console.log("🛑 서버 종료 중... 구독 해제 중...");
await unsubscribeChat();
