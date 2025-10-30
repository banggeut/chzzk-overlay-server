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
    const ws = new WebSocket(`${serverUrl.replace("https", "wss")}/ws/chat/${channelId}`);

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const div = document.createElement("div");
        div.className = "chat-message";
        div.textContent = msg.nickname + ": " + msg.message;
        chatMessages.appendChild(div);
    };

    ws.onclose = () => {
        console.log("🔁 재연결 시도 중...");
        setTimeout(connectChat, 3000);
    };
}

fetchViewerCount();
setInterval(fetchViewerCount, 10000);
connectChat();
