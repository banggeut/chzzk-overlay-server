const channelId = "f00f6d46ecc6d735b96ecf376b9e5212";
const serverUrl = "https://chzzk-overlay-server.onrender.com"; // Render URL로 유지

const chatMessages = document.getElementById("chatMessages");
const viewerCountEl = document.getElementById("viewerCount");

// 시청자 수: REST API 호출 방식 유지
async function fetchViewerCount() {
    try {
        const res = await fetch(`${serverUrl}/api/viewers?channelId=${channelId}`);
        const data = await res.json();
        // data.viewers가 없다면 0으로 표시
        viewerCountEl.textContent = data.viewers || 0; 
    } catch (err) {
        console.error("Viewer fetch error:", err);
    }
}

// 🚩 Socket.IO 클라이언트 연결 함수로 변경
function connectChat() {
    // Socket.IO는 서버 주소만으로 연결합니다.
    const socket = io(serverUrl); 

    socket.on('connect', () => {
        console.log("✅ 오버레이 서버에 Socket.IO 연결됨!");
    });

    // 🚩 서버에서 io.emit('chat', { nickname, message })로 보낸 데이터를 받습니다.
    socket.on('chat', (msg) => { 
        try {
            // msg는 이미 서버에서 파싱된 { nickname, message } 객체입니다.
            const div = document.createElement("div");
            div.className = "chat-message";
            
            // server.js의 nickname과 message에 맞춰 데이터를 사용합니다.
            div.textContent = `${msg.nickname}: ${msg.message}`; 
            
            chatMessages.appendChild(div);
            // 자동 스크롤
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        } catch (err) {
            console.error("메시지 처리 오류:", err);
        }
    });

    socket.on('disconnect', (reason) => {
        console.warn(`⚠️ Socket.IO 연결 종료됨: ${reason}`);
        // Socket.IO는 기본적으로 자동 재연결을 시도합니다.
    });

    socket.on('connect_error', (err) => {
        console.error("❌ Socket.IO 연결 오류:", err);
    });
}

// 시청자 수 갱신 시작
fetchViewerCount();
setInterval(fetchViewerCount, 10000);

// 채팅 연결 시작
connectChat();