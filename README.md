# Avatar Service

Independent Three.js + VRM avatar runtime for AI agent frontends.

## MVP

- Load a local `.vrm` file from the browser.
- Render the model with camera, lighting, orbit controls, and resize handling.
- Dispatch `avatar_state` events from the debug UI.
- React to `idle`, `listening`, `thinking`, `speaking`, and `error`.
- Provide a typed event contract that can be reused by Dify, WebSocket, HTTP, or a future Unity runtime.
- Accept `window.postMessage({ type: "avatar_state", phase: "speaking" }, "*")` as a first integration path.

## Event Contract

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

## Run

```bash
npm install
npm run dev
```

Then open the Vite URL, usually `http://127.0.0.1:5173/`.

For agent or automation checks, use the detached helper so the command exits after a bounded readiness check:

```bash
npm run dev:detached
npm run dev:status
npm run dev:stop
```

The detached helper starts at port `5173` and automatically tries the next available port if that port is already occupied.

## Build

```bash
npm run build
```

## Browser Integration Example

```js
window.postMessage(
  {
    type: "avatar_state",
    phase: "speaking",
    emotion: "happy",
    text: "Hello from an external agent.",
    timestamp: Date.now()
  },
  "*"
);
```
