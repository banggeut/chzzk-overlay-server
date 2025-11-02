// ✅ 서버 주소 (배포/로컬 모두 자동 인식)
const serverUrl = window.location.origin;

// HTML 요소 연결
const chatMessages = document.getElementById("chatMessages");
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
// (시청자 수 기능 제거)

// [수정 완료] 실시간 채팅 메시지 수신 이벤트 이름을 'chatMessage'로 변경 (server.js와 일치)
socket.on("chatMessage", (msg) => {
    try { console.log("🧩 client emojis:", msg && msg.emojis); } catch {}
    addChatMessage(msg.nickname, renderMessageWithEmojis(msg.message, msg.emojis)); 
});

// 에러 및 연결 종료 처리
socket.on("disconnect", () => {
    console.log("🔴 서버 연결 끊김, 재연결 시도 중...");
});

// ✅ 채팅 메시지 DOM에 추가
function addChatMessage(username, html) {
    const profiles = [
        'default_profile.png',
        'default_profile2.png',
        'default_profile3.png',
        'default_profile4.png'
    ];
    const profileSrc = profiles[Math.floor(Math.random() * profiles.length)];
    const messageItem = document.createElement('div');
    messageItem.classList.add('chat-message-item');
    messageItem.innerHTML = `
        <img src="${profileSrc}" class="chat-profile-img" alt="Profile">
        <div class="chat-text-container">
            <span class="chat-username">${username}</span>
            <span class="chat-text">${html}</span>
        </div>
    `;
    chatMessages.appendChild(messageItem);

    createHeart(); // 채팅 수신 시 하트 생성

    // 오래된 채팅 자동 제거 (최대 5개 유지)
    while (chatMessages.children.length > 5) {
        const oldest = chatMessages.firstElementChild;
        oldest.classList.add('fade-out');
        oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
    }

    // 스크롤을 맨 아래로 이동 (가장 최근 메시지 표시)
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 이모지 렌더링: {:code:} 형태 토큰을 이미지로 치환
function renderMessageWithEmojis(text, emojis) {
    if (!text) return "";
    // 기본 이스케이프
    let safe = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const fallbackMap = { d_4: 'https://ssl.pstatic.net/static/nng/glive/icon/cha04.png' };
    const emojiMap = (emojis && typeof emojis === 'object' && Object.keys(emojis).length > 0) ? emojis : fallbackMap;
    try {
        for (const code in emojiMap) {
            if (!Object.prototype.hasOwnProperty.call(emojiMap, code)) continue;
            const info = emojiMap[code];
            const url = (typeof info === 'string') ? info : ((info && (info.url || info.imageUrl || info.src)) || null);
            if (!url) continue;
            // 토큰 형태 정확 매칭: {:code:} 와 :code:
            const tokens = [`{:${code}:}`, `:${code}:`];
            for (const token of tokens) {
                const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                safe = safe.replace(new RegExp(escaped, 'g'), `<img src="${url}" class="emoji" alt="${code}">`);
            }
        }
    } catch {}
    return safe;
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

    // 애니메이션 자연스러움 향상: 약간의 좌우 오프셋/회전/시간 랜덤화
    const offsetPx = Math.floor((Math.random() - 0.5) * 16); // -8px ~ +8px
    heart.style.marginLeft = `${offsetPx}px`;
    const deg = (Math.random() - 0.5) * 12; // -6deg ~ +6deg
    heart.style.transform += ` rotate(${deg}deg)`;
    const duration = 2.7 + Math.random() * 0.6; // 2.7s ~ 3.3s
    heart.style.setProperty('--dur', `${duration}s`);

    // 하트 컨테이너 내에서 애니메이션 시작
    heartContainer.appendChild(heart);

    // 애니메이션 종료 후 제거
    setTimeout(() => {
        heart.remove();
    }, duration * 1000);
}