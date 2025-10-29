# Chzzk Overlay WebSocket Server
치지직 실시간 채팅을 받아 WebSocket으로 오버레이에 전달하는 서버입니다.

## 🚀 배포 방법
1. 이 프로젝트를 GitHub에 업로드합니다.
2. [Vercel](https://vercel.com)에서 새 프로젝트로 연결합니다.
3. 아래 환경변수를 추가하세요:
   - CHZZK_CHANNEL_ID
   - CLIENT_ID
   - CLIENT_SECRET
4. 배포 후 오버레이의 script.js에 다음을 입력:
   ```js
   const YOUR_BACKEND_WEBSOCKET_URL = "wss://your-vercel-app-name.vercel.app";
   ```
5. OBS에서 index.html을 브라우저 소스로 추가하세요.
