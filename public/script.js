// ✅ 실제 치지직 채널 ID 입력
const channelId = "72540e0952096b201da89e667b70398b";

// ✅ 배포된 서버 주소
const serverUrl = "https://chzzk-overlay-server.onrender.com";

// HTML 요소 연결
const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");

// ✅ Socket.IO로 서버와 연결
const socket = io(serverUrl, {
    transports: ["websocket"]
});

// 서버 연결 성공 시
socket.on("connect", () => {
    console.log("🟢 오버레이 서버 연결됨:", socket.id);
    // 서버로 현재 채널 구독 요청
    socket.emit("joinChannel", { channelId });
});

// 실시간 시청자 수 업데이트
socket.on("viewerCount", (data) => {
    viewerCountEl.textContent = `👁️ ${data}`;
});

// 실시간 채팅 메시지 수신
socket.on("chatMessage", (msg) => {
    addChatMessage(msg.nickname, msg.message);
});

// 에러 및 연결 종료 처리
socket.on("disconnect", () => {
    console.log("🔴 서버 연결 끊김, 재연결 시도 중...");
});

// ✅ 채팅 메시지 DOM에 추가
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

    // 오래된 채팅 자동 제거 (최대 5개 유지)
    if (chatMessages.children.length > 5) {
        const oldest = chatMessages.firstElementChild;
        oldest.classList.add('fade-out');
        oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ❤️ 채팅 효과 (기존 디자인 유지)
function createHeart() {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.textContent = '❤';
    document.body.appendChild(heart);

    const startX = Math.random() * window.innerWidth;
    heart.style.left = `${startX}px`;

    const animation = heart.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-200px)', opacity: 0 }
    ], {
        duration: 1500,
        easing: 'ease-out'
    });

    animation.onfinish = () => heart.remove();
}
