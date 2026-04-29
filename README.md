# Avatar Service

AIエージェントのフロントエンドに組み込むための、独立した Three.js + VRM アバターランタイムです。

## MVP

- ブラウザからローカルの `.vrm` ファイルを読み込む。
- `?model=/models/default.vrm` のようなURLパラメータでVRMを自動読み込みする。
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
  posture?: {
    preset?:
      | "auto"
      | "neutral"
      | "attentive"
      | "thinking"
      | "speaking"
      | "bow"
      | "lean_forward"
      | "lean_back"
      | "look_left"
      | "look_right"
      | "nod"
      | "shake"
      | string;
    intensity?: number;
    head?: { pitch?: number; yaw?: number; roll?: number };
    neck?: { pitch?: number; yaw?: number; roll?: number };
    chest?: { pitch?: number; yaw?: number; roll?: number };
    spine?: { pitch?: number; yaw?: number; roll?: number };
    leftUpperArm?: { pitch?: number; yaw?: number; roll?: number };
    rightUpperArm?: { pitch?: number; yaw?: number; roll?: number };
    leftLowerArm?: { pitch?: number; yaw?: number; roll?: number };
    rightLowerArm?: { pitch?: number; yaw?: number; roll?: number };
    leftHand?: { pitch?: number; yaw?: number; roll?: number };
    rightHand?: { pitch?: number; yaw?: number; roll?: number };
    source?: string;
    timestamp?: number;
  };
  speech?: {
    state?: "idle" | "preparing" | "speaking" | "completed" | "error" | string;
    volume?: number;
    rms?: number;
    viseme?: string;
    phoneme?: string;
    source?: string;
    timestamp?: number;
  };
  text?: string;
  timestamp?: number;
};
```

## 起動

```bash
npm install
npm run dev
```

起動後、Viteが表示するURLをブラウザで開きます。通常は `http://127.0.0.1:5173/` です。`npm run dev` は `scripts/dev-server.mjs` を経由し、strict portで起動します。指定portが使用中の場合、別portへ自動退避せずエラー終了します。

Codexや自動確認で使う場合は、一定時間内にreadiness checkを終えてコマンドが戻るdetached helperを使えます。

```bash
npm run dev:detached
npm run dev:status
npm run dev:health
npm run dev:stop
```

`dev:stop` はruntime status fileに記録されたPIDだけを停止します。runtime status fileの既定値は `.dev-server.json` です。統合スクリプトなどから引数付きで呼ぶ場合は、npmの引数転送差異を避けるため `node` で直接呼び出してください。

```bash
node scripts/dev-server.mjs start --port 5173 --runtime-status-file C:\tmp\avatar-runtime-status.json
node scripts/dev-server.mjs health --runtime-status-file C:\tmp\avatar-runtime-status.json
node scripts/dev-server.mjs stop --runtime-status-file C:\tmp\avatar-runtime-status.json
```

runtime status fileには `module`、`pid`、`parent_pid`、`started_at`、`host`、`port`、`health_url`、`shutdown_command`、`command_line`、`state` が書かれます。正常停止時は削除せず `state: "stopped"` に更新します。

## モデル配置

検証用VRMは `public/models/` に配置します。たとえば `public/models/default.vrm` を置くと、次のURLで自動読み込みできます。

```text
http://127.0.0.1:5173/?model=/models/default.vrm
```

背景色は `background` または `bg` パラメータで指定できます。

```text
http://127.0.0.1:5173/?model=/models/default.vrm&background=%23f3f4f1
```

カメラと表示サイズはUIのViewセクション、またはURLパラメータで調整できます。

```text
http://127.0.0.1:5173/?model=/models/default.vrm&projection=orthographic&ortho_width=2.0&avatar_height=1.7&light_height=1.25
```

利用できる主なパラメータ:

- `projection`: `perspective` または `orthographic`
- `camera_distance`: カメラと注視点の距離
- `camera_fov`: perspective時のFOV
- `ortho_width`: orthographic時の画面幅
- `avatar_height`: VRMを表示する高さ
- `light_height`: ライトが当たる高さ

`.vrm/` はローカル検証用、`public/models/*.vrm` は配信用検証モデル用として `.gitignore` しています。ライセンスが明確なVRMだけを必要に応じて明示的に追加してください。

## ビルド

```bash
npm run build
```

dev serverラッパーのsmoke test:

```bash
npm run test:dev-server
```

## ブラウザ連携例

```js
window.postMessage(
  {
    type: "avatar_state",
    phase: "speaking",
    emotion: "happy",
    posture: {
      preset: "speaking",
      intensity: 0.5
    },
    text: "外部エージェントからの発話です。",
    timestamp: Date.now()
  },
  "*"
);
```

背景色は `avatar_config` messageでも変更できます。

```js
window.postMessage(
  {
    type: "avatar_config",
    background: "#0f172a",
    projection: "orthographic",
    ortho_width: 2.0,
    avatar_height: 1.7,
    light_height: 1.25
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

`tts.state` の `speaking`、`completed`、`error` はTTS優先で解決されます。将来の音量同期やviseme連携に備えて、`speech.volume`、`speech.rms`、`speech.viseme`、`speech.phoneme` を任意フィールドとして受け取れます。

姿勢制御は `posture.preset` と `posture.head/chest/...` の任意回転で指定できます。現在のThree.js runtimeではphaseごとの自然な姿勢に対して追加合成されます。腕はVRMのTポーズをそのまま表示しないよう、モデル読み込み時に上腕の向きから休止姿勢を推定して下げます。個別制御が必要な場合は `leftUpperArm`、`rightUpperArm`、`leftLowerArm`、`rightLowerArm`、`leftHand`、`rightHand` に `pitch/yaw/roll` をラジアンで指定できます。Unityなど別runtimeでは同じ `posture` cue を独自に解釈できます。
