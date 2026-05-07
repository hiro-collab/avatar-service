# Avatar Service

Three.js と VRM を使う standalone avatar runtime です。`sword-voice-agent` では、イベントを受けて avatar state を表示する切り分け用ランタイムとして扱います。

## Responsibility

- ローカル `.vrm` model の表示。
- URL parameter による model 読み込み。
- `avatar_state` event contract の受信。
- `idle`, `listening`, `thinking`, `speaking`, `error` などの状態反映。
- Vite dev server の runtime status file 出力。

Avatar Service は STT、Dify、TTS 合成、gesture 推論を担当しません。

## Start

```powershell
cd <workspace>\avatar-service
npm install
npm run dev
```

通常 URL:

```text
http://127.0.0.1:5173/
```

`npm run dev` は `scripts/dev-server.mjs` を経由し、strict port で起動します。指定 port が使用中の場合は別 port へ逃げずにエラー終了します。

Integration scripts から扱う場合:

```powershell
node scripts/dev-server.mjs start --port 5173 --runtime-status-file C:\tmp\avatar-runtime-status.json
node scripts/dev-server.mjs health --runtime-status-file C:\tmp\avatar-runtime-status.json
node scripts/dev-server.mjs stop --runtime-status-file C:\tmp\avatar-runtime-status.json
```

## Model URL

```text
http://127.0.0.1:5173/?model=/models/default.vrm
```

Model files are placed under `public/models/`.

Useful parameters:

| Parameter | Purpose |
|---|---|
| `model` | VRM model URL |
| `background` | background color |
| `projection` | `perspective` or `orthographic` |
| `camera_distance` | perspective camera distance |
| `camera_fov` | perspective field of view |
| `ortho_width` | orthographic width |
| `avatar_height` | avatar display height |
| `light_height` | light height |

## Event Contract

Browser message example:

```js
window.postMessage(
  {
    type: "avatar_state",
    phase: "speaking",
    text: "こんにちは"
  },
  "*"
)
```

`type: "avatar_state"` is the event discriminator. Consumers should ignore unknown optional fields.

## SSE Integration

`sword-voice-agent` events can be read through the `events` parameter:

```text
http://127.0.0.1:5173/?events=http://127.0.0.1:8790/api/events
```

If a token is required, use the on-screen token input or `events_token`.

SSE events are converted to `avatar_state` by `SwordVoiceAgentAdapter`. `postMessage` remains supported.

## Runtime Status

The runtime status file records module, PID, parent PID, start time, host, port, health URL, shutdown command, command line, and state. On stop it is updated to `state: "stopped"` rather than deleted.

## Build

```powershell
npm run build
```
