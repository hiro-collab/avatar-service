# Avatar Service

AIエージェントのフロントエンドに組み込むための、独立した Three.js + VRM アバターランタイムです。

## MVP

- ブラウザからローカルの `.vrm` ファイルを読み込む。
- カメラ、ライト、OrbitControls、リサイズ対応付きでVRMモデルを描画する。
- デバッグUIから `avatar_state` イベントをdispatchする。
- `idle`、`listening`、`thinking`、`speaking`、`error` の各状態に反応する。
- Dify、WebSocket、HTTP、将来のUnity版ランタイムでも再利用できる型付きイベント契約を提供する。
- 最初の外部連携経路として `window.postMessage({ type: "avatar_state", phase: "speaking" }, "*")` を受け付ける。

## イベント契約

```ts
type AvatarPhase = "idle" | "listening" | "thinking" | "speaking" | "error";
type AvatarEmotion = "neutral" | "happy" | "serious" | "surprised" | "troubled";

type AvatarStateEvent = {
  type: "avatar_state";
  turn_id?: string;
  phase: AvatarPhase;
  emotion?: AvatarEmotion;
  gesture?: "sword_sign" | "none" | string;
  text?: string;
  timestamp?: number;
};
```

## 起動

```bash
npm install
npm run dev
```

起動後、Viteが表示するURLをブラウザで開きます。通常は `http://127.0.0.1:5173/` です。

Codexや自動確認で使う場合は、一定時間内にreadiness checkを終えてコマンドが戻るdetached helperを使えます。

```bash
npm run dev:detached
npm run dev:status
npm run dev:stop
```

detached helperは `5173` から起動を試し、ポートが埋まっている場合は次の空きポートを自動で使います。

## ビルド

```bash
npm run build
```

## ブラウザ連携例

```js
window.postMessage(
  {
    type: "avatar_state",
    phase: "speaking",
    emotion: "happy",
    text: "外部エージェントからの発話です。",
    timestamp: Date.now()
  },
  "*"
);
```

## SSE連携

`sword-voice-agent` の `/api/events` を直接購読する場合は、起動URLに `events` パラメータを付けます。

```text
http://127.0.0.1:5173/?events=http://127.0.0.1:8790/api/events
```

認証が必要な場合は画面のToken欄に入力します。URLから渡す場合は `events_token` も利用できます。

```text
http://127.0.0.1:5173/?events=http://127.0.0.1:8790/api/events&events_token=YOUR_TOKEN
```

SSEイベントは `SwordVoiceAgentAdapter` で `avatar_state` に変換されます。`postMessage` 連携は引き続き利用できます。

ブラウザから別ポートのSSEを直接読む場合、接続先サーバー側でCORS許可が必要です。
