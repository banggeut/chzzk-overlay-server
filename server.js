// ✅ 채팅 구독 추가 (공식 문서 기반으로 수정됨)
async function subscribeChatEvent(sessionKey) {
  try {
    const res = await fetch("https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json",
      },
      // ✅ 공식 문서에 따르면 channelId는 body에 포함하지 않음
      body: JSON.stringify({ sessionKey }),
    });

    const text = await res.text();
    console.log("📡 구독 응답 원문:", text);

    const data = JSON.parse(text);
    if (data.code === 200) {
      console.log(`✅ 채팅 이벤트 구독 성공 (세션키: ${sessionKey})`);
    } else {
      console.error("❌ 채팅 이벤트 구독 실패:", data);
    }
  } catch (err) {
    console.error("❌ 채팅 구독 요청 오류:", err);
  }
}

// ✅ 치지직 소켓 연결 (CHAT 이벤트 파싱 수정됨)
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

  socket.on("SYSTEM", (data) => {
    console.log("🟢 시스템 이벤트:", data);
    // ✅ 세션키가 감지되면 자동으로 채팅 구독 시도
    if (data?.data?.sessionKey) subscribeChatEvent(data.data.sessionKey);
  });

  // ✅ 공식 문서 기준: CHAT 이벤트의 본문 구조 반영
  socket.on("CHAT", (data) => {
    try {
      // CHZZK 공식 문서 구조: { content, profile: { nickname }, ... }
      const nickname = data.profile?.nickname || "익명";
      const message = data.content || "";

      io.emit("chat", { nickname, message });
      console.log("💬", nickname + ":", message);
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
