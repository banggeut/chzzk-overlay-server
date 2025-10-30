const channelId = "f00f6d46ecc6d735b96ecf376b9e5212";
const serverUrl = "https://chzzk-overlay-server.onrender.com";

const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");

async function fetchViewerCount() {
    try {
        const res = await fetch(`${serverUrl}/api/viewers?channelId=${channelId}`);
        const data = await res.json();
        viewerCountEl.textContent = data.viewers || 0;
    } catch (err) {
        console.error("Viewer fetch error:", err);
    }
}

async function connectChat() {
    // 명시적으로 wss:// 형태의 WebSocket 주소 지정
    const wsUrl = `wss://chzzk-overlay-server.onrender.com/ws/chat/${channelId}`;
    console.log("🔗 WebSocket 연결 시도:", wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("✅ 오버레이 서버에 연결됨!");
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            const div = document.createElement("div");
            div.className = "chat-message";
            div.textContent = `${msg.nickname}: ${msg.message}`;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight; // 자동 스크롤
        } catch (err) {
            console.error("메시지 파싱 오류:", err);
        }
    };

    ws.onclose = (e) => {
        console.warn("⚠️ WebSocket 연결 종료됨, 3초 후 재연결:", e.reason);
        setTimeout(connectChat, 3000);
    };

    ws.onerror = (err) => {
        console.error("❌ WebSocket 오류:", err);
        ws.close();
    };
}

fetchViewerCount();
setInterval(fetchViewerCount, 10000);
connectChat();
