const channelId = "f00f6d46ecc6d735b96ecf376b9e5212";
const serverUrl = "https://chzzk-overlay-server.onrender.com";

const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");
const emptyHeartIcon = document.getElementById("emptyHeartIcon");

const maxChatMessages = 5;

// 시청자 수 실시간 갱신
async function fetchViewerCount() {
    try {
        const res = await fetch(`${serverUrl}/api/viewers?channelId=${channelId}`);
        const data = await res.json();
        viewerCountEl.textContent = `👁️ ${data.viewers || 0}`;
    } catch (err) {
        console.error("Viewer fetch error:", err);
    }
}

// 실시간 채팅 수신
async function connectChat() {
    const wsUrl = `${serverUrl.replace("https", "wss")}/ws/chat/${channelId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => console.log("✅ 치지직 오버레이 WebSocket 연결됨");

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (!msg.nickname || !msg.message) return;

            addChatMessage(msg.nickname, msg.message);
        } catch (e) {
            console.error("메시지 파싱 오류:", e);
        }
    };

    ws.onclose = () => {
        console.warn("⚠️ 연결 종료됨, 3초 후 재연결 시도...");
        setTimeout(connectChat, 3000);
    };
}

// 채팅 메시지 DOM 추가
function addChatMessage(username, text) {
    const messageItem = document.createElement('div');
    messageItem.classList.add('chat-message-item');
    messageItem.innerHTML = `
        <img src="default_profile.png" class="chat-profile-img" alt="Profile">
        <div class="chat-text-container">
            <span class="chat-username">${username}</span>
            <span class="chat-text">${text}</span>
        </div>
    `;
    chatMessages.appendChild(messageItem);

    createHeart();

    if (chatMessages.children.length > maxChatMessages) {
        const oldest = chatMessages.firstElementChild;
        oldest.classList.add('fade-out');
        oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 하트 생성 애니메이션 (원본 그대로)
function createHeart() {
    const rect = emptyHeartIcon.getBoundingClientRect();
    const heartIcon = document.createElement('img');
    heartIcon.src = 'heart_red.png';
    heartIcon.classList.add('heart-icon');
    document.body.appendChild(heartIcon);

    heartIcon.style.left = `${rect.left + rect.width / 2 - heartIcon.offsetWidth / 2}px`;
    heartIcon.style.bottom = `${window.innerHeight - rect.bottom}px`;

    heartIcon.addEventListener('animationend', () => heartIcon.remove());
}

// 하트 위치 보정
function adjustHeartContainerPosition() {
    const rect = emptyHeartIcon.getBoundingClientRect();
    const heartContainer = document.getElementById('heartContainer');
    heartContainer.style.bottom = `${window.innerHeight - rect.bottom}px`;
    heartContainer.style.right = `${window.innerWidth - rect.right}px`;
}

window.addEventListener('load', adjustHeartContainerPosition);
window.addEventListener('resize', adjustHeartContainerPosition);

// 초기 실행
fetchViewerCount();
setInterval(fetchViewerCount, 10000);
connectChat();
