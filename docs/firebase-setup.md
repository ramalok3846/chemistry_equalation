# Firebase 구글 로그인(Authentication) 연동 가이드 (선택 사항)

이 프로젝트의 기본 배포본에는 Firebase 로그인이 **포함되어 있지 않습니다.**
아래는 나중에 직접 추가하고 싶을 때 참고할 수 있는 안내입니다.

## 왜 기본으로 넣지 않았나요?

- 이 저장소는 **public**(공개) GitHub 저장소입니다.
- `firebaseConfig` 안의 `apiKey` 등은 클라이언트에 노출되는 것이 Firebase 설계상 정상이지만,
  실제로 로그인/DB 기능을 안전하게 쓰려면 **Firebase 콘솔의 보안 규칙(Security Rules)**과
  **승인된 도메인(Authorized domains)** 설정이 함께 되어 있어야 합니다.
- 이 설정 없이 코드만 공개 저장소에 올리면, 규칙에 따라 누구나 해당 프로젝트의
  Firestore/Realtime Database를 읽고 쓸 수 있는 등 의도치 않은 상황이 생길 수 있습니다.
- 그래서 "코드"와 "실제 활성화 여부"를 분리해서, 사용자가 준비된 후 직접 켤 수 있게 했습니다.

## 연동 방법

### 1. Firebase 콘솔에서 Google 로그인 활성화
1. [Firebase 콘솔](https://console.firebase.google.com/) → 해당 프로젝트(`pal-inte-db`) 선택
2. Authentication → Sign-in method → Google 활성화
3. Authentication → Settings → Authorized domains 에 실제 배포 도메인
   (예: `ramalok3846.github.io`) 추가

### 2. SDK 스크립트 추가

`index.html`의 `</body>` 직전에 아래와 같이 Firebase SDK를 추가합니다
(모듈 방식이 아니라 정적 HTML이므로 compat 버전을 사용하는 것이 가장 간단합니다):

```html
<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
<script src="firebase-config.js"></script>
<script src="firebase-auth.js"></script>
```

### 3. `firebase-config.js` 만들기 (이 파일은 .gitignore에 등록해서 커밋하지 않는 것을 권장)

```js
const firebaseConfig = {
  apiKey: "여기에_본인_API_KEY",
  authDomain: "pal-inte-db.firebaseapp.com",
  databaseURL: "https://pal-inte-db-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pal-inte-db",
  storageBucket: "pal-inte-db.firebasestorage.app",
  messagingSenderId: "411569829650",
  appId: "여기에_본인_APP_ID"
};
firebase.initializeApp(firebaseConfig);
```

### 4. `firebase-auth.js` (로그인 버튼 로직)

```js
const provider = new firebase.auth.GoogleAuthProvider();

function signInWithGoogle(){
  firebase.auth().signInWithPopup(provider)
    .then(result => {
      console.log("로그인 성공:", result.user.displayName);
      // 필요하면 여기서 UI 업데이트
    })
    .catch(err => console.error("로그인 실패:", err));
}

function signOutUser(){
  firebase.auth().signOut();
}

firebase.auth().onAuthStateChanged(user => {
  if(user){
    console.log("로그인된 사용자:", user.email);
  } else {
    console.log("로그아웃 상태");
  }
});
```

그리고 `index.html`에 로그인 버튼을 하나 추가하면 됩니다:
```html
<button onclick="signInWithGoogle()">Google로 로그인</button>
```

### 5. 공개 저장소에 올릴 때 주의사항

- `firebase-config.js`처럼 실제 키가 담긴 파일은 `.gitignore`에 추가하고,
  대신 `firebase-config.example.js` 같은 템플릿 파일만 커밋하는 것을 권장합니다.
- Firestore/Realtime Database를 함께 쓴다면, 반드시 보안 규칙에서
  `request.auth != null` 등으로 인증된 사용자만 접근 가능하도록 제한하세요.
- 이 시뮬레이터 자체는 로그인 없이도 완전히 동작하므로, 로그인은
  "사용자별 설정 저장" 같은 부가 기능이 필요할 때만 추가하는 것을 권장합니다.
