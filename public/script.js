// ✅ 서버 주소 (배포/로컬 모두 자동 인식)
const serverUrl = window.location.origin;

// HTML 요소 연결
const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");
const heartContainer = document.getElementById("heartContainer"); // 추가: 하트 컨테이너 연결

// ✅ Socket.IO로 서버와 연결
const socket = io(serverUrl, {
    transports: ["websocket"]
});

// 서버 연결 성공 시
socket.on("connect", () => {
    console.log("🟢 오버레이 서버 연결됨:", socket.id);
});

// 실시간 시청자 수 업데이트
socket.on("viewerCount", (data) => {
    viewerCountEl.textContent = `👁️ ${data}`;
});

// [수정 완료] 실시간 채팅 메시지 수신 이벤트 이름을 'chatMessage'로 변경 (server.js와 일치)
socket.on("chatMessage", (msg) => {
    // server.js에서 보내는 데이터 구조에 맞게 'content'가 아닌 'message'를 사용합니다.
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

    createHeart(); // 채팅 수신 시 하트 생성

    // 오래된 채팅 자동 제거 (최대 5개 유지)
    if (chatMessages.children.length > 5) {
        const oldest = chatMessages.firstElementChild;
        oldest.classList.add('fade-out');
        oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
    }

    // 스크롤을 맨 아래로 이동 (가장 최근 메시지 표시)
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ❤️ 채팅 효과 (Instagram Live 스타일 복구)
function createHeart() {
    const heartContainer = document.getElementById('heartContainer');
    if (!heartContainer) return;

    const heart = document.createElement('img');
    heart.className = 'heart-icon'; // style.css에서 정의한 애니메이션 클래스 사용
    
    // ⭐ 하트 이미지 리스트 (존재하는 파일만 사용) ⭐
    const heartImages = ['heart_red.png'];
    const randomImage = heartImages[Math.floor(Math.random() * heartImages.length)];
    
    // 주의: 이 파일들도 OBS에서 보이려면 웹 접근 가능한 URL이어야 합니다.
    heart.src = randomImage; 

    // 하트 컨테이너 내에서 애니메이션 시작
    heartContainer.appendChild(heart); 

    // style.css의 @keyframes heartRise에 따라 3초 후 DOM에서 제거
    setTimeout(() => {
        heart.remove();
    }, 3000); // 애니메이션 시간 (3s)과 일치
}