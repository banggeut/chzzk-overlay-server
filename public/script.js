const channelId = "f00f6d46ecc6d735b96ecf376b9e5212";
const serverUrl = "https://chzzk-overlay-server.onrender.com";

const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");

// 시청자 수 갱신
async function fetchViewerCount() {
    try {
        const res = await fetch(`${serverUrl}/api/viewers?channelId=${channelId}`);
        const data = await res.json();
        viewerCountEl.textContent = data.viewers || 0;
    } catch (err) {
        console.error("Viewer fetch error:", err);
    }
}

// 채팅 연결
async function connectChat() {
    try {
        const ws = new WebSocket(`${serverUrl.replace("https", "wss")}/ws/chat/${channelId}`);

        ws.onopen = () => console.log("✅ 오버레이 WebSocket 연결됨");

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (!msg.message) return;

                const div = document.createElement("div");
                div.className = "chat-message";
                div.innerHTML = `<span class="nickname">${msg.nickname}:</span> ${msg.message}`;
                chatMessages.appendChild(div);

                if (chatMessages.children.length > 30)
                    chatMessages.removeChild(chatMessages.firstChild);
            } catch (e) {
                console.error("메시지 파싱 오류:", e);
            }
        };

        ws.onclose = () => {
            console.warn("⚠️ 연결 종료됨, 3초 후 재연결 시도...");
            setTimeout(connectChat, 3000);
        };

    } catch (err) {
        console.error("❌ 채팅 연결 실패:", err);
        setTimeout(connectChat, 3000);
    }
}

// 주기적 시청자 수 업데이트 + 채팅 연결 실행
fetchViewerCount();
setInterval(fetchViewerCount, 10000);
connectChat();
