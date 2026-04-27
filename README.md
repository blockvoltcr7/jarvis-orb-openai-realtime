# JARVIS Orb AI Assistant

A futuristic, holographic AI orb voice assistant — a centered 3D presence that listens, thinks, calls tools, and speaks back. Powered by the **OpenAI Realtime API** over WebRTC.

## Tech Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS** for layout & glassmorphism
- **React Three Fiber + Drei + Three.js** for the 3D orb
- **Web Audio API** for mic-level analysis & orb reactivity
- **OpenAI Realtime API** (model: `gpt-realtime`, endpoint: `/v1/realtime/calls`) over WebRTC
- **Function calling** with a small registry of demo tools

## Setup

```bash
npm install
cp .env.local.example .env.local
# Add OPENAI_API_KEY to .env.local — required.
npm run dev
```

Open http://localhost:3000 and click **Start Conversation**.

## Environment Variables

| Var                    | Where           | Purpose                                                          |
| ---------------------- | --------------- | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`       | **server only** | Mints ephemeral Realtime client tokens via `/api/realtime-session` |
| `NEXT_PUBLIC_APP_NAME` | client          | App title in the header                                          |

`OPENAI_API_KEY` never reaches the browser. The browser fetches a short-lived `client_secret` from `/api/realtime-session` and uses that for the WebRTC handshake against `https://api.openai.com/v1/realtime/calls`.

## Architecture

### Voice Provider Abstraction

`lib/voice/types.ts` defines `VoiceProvider`. The canonical implementation is `OpenAIRealtimeProvider`. Adding a different provider (Vapi, ElevenLabs) is a matter of implementing the same interface and pointing `useVoiceAssistant` at it.

### Realtime Lifecycle

1. `POST /api/realtime-session` → server calls `POST /v1/realtime/client_secrets` with `OPENAI_API_KEY` and returns the ephemeral key.
2. Browser opens an `RTCPeerConnection`, attaches the mic, creates the `oai-events` data channel.
3. SDP offer is POSTed to `https://api.openai.com/v1/realtime/calls?model=gpt-realtime` with `Authorization: Bearer <ephemeralKey>`. The SDP answer is set as remote description.
4. On data-channel `open`, we send `session.update` with system instructions and the tool registry.
5. Inbound events drive the UI:
   - `input_audio_buffer.speech_started/stopped` → status changes
   - `conversation.item.input_audio_transcription.completed` → user transcript
   - `response.audio_transcript.delta` → streamed assistant transcript
   - `response.done` → if `response.output[]` contains `function_call` items, we execute them
6. Tool result is posted back via `conversation.item.create` (type `function_call_output`), then `response.create` lets the model continue.

### Tools

`lib/voice/tools.ts` is the single source of truth. Each tool has a `name`, `description`, JSON-Schema `parameters`, and a `handler`. Demo tools shipped:

- `get_time` — current date/time, optional IANA timezone
- `add_task` — append a task to localStorage
- `list_tasks` — read them back
- `clear_tasks` — wipe the list
- `random_number` — random int between min/max

To add a tool: add an entry to the `tools` array in `lib/voice/tools.ts`. It will automatically appear in the model's session, the side panel registry tab, and the tool execution path.

### Tools Side Panel

`components/assistant/ToolsPanel.tsx` shows two tabs:
- **Calls** — live list of every tool call with status (running/success/error), args, result, and elapsed ms
- **Registry** — every tool registered with the model, including its parameters

### Orb Visual System

The center canvas supports multiple persisted orb variants. Use the small variant button in the top-right corner of the orb area to cycle styles. The selected variant is saved in `localStorage` under `jarvis.orbVariant`.

Current variants:

- **Classic** — original glowing sphere with energy rings, particles, and hologram glow.
- **Particle** — GPGPU flow-field particle sphere with cursor repulsion.
- **Plasma** — contained plasma core with lightning arcs, corona particles, and containment rings.
- **Neural** — floating node constellation with pulsing signal lines.
- **Iris** — non-human aperture/lens core that replaced the old particle face variant.
- **Aurora** — layered aurora curtain particles with audio bloom.
- **Crystal** — iridescent torus-knot crystal with faceted lattice overlays.
- **Wave** — audio-reactive harmonic wave sphere.

Each scene receives the same props from `app/page.tsx`: `audioLevelRef`, `status`, and the active persona accent color. Status drives palette, motion intensity, and audio response.

## Important Files

- `app/page.tsx` — main UI assembly (3-column layout: tools | orb | transcript)
- `app/api/realtime-session/route.ts` — server-side ephemeral token mint
- `components/orb/OrbScene.tsx` — classic orb scene composition
- `components/orb/{ParticleOrbScene,PlasmaCoreScene,NeuralConstellationScene,IrisCoreScene,AuroraScene,HoloCrystalScene,WaveSphereScene}.tsx` — alternate orb variants
- `components/orb/{AiOrb,EnergyRings,ParticleField,HologramGlow,FlowFieldParticles}.tsx` — shared orb primitives and particle helpers
- `components/assistant/{StatusBadge,TranscriptPanel,ToolsPanel,AssistantControls}.tsx`
- `hooks/useVoiceAssistant.ts` — provider lifecycle, transcript + tool-call state
- `lib/voice/openaiRealtimeProvider.ts` — WebRTC + Realtime data channel
- `lib/voice/tools.ts` — tool registry

## Try It

After starting a session, try saying:
- *"What time is it in Tokyo?"* → triggers `get_time({ timezone: "Asia/Tokyo" })`
- *"Add a task: review the quarterly plan."* → triggers `add_task`
- *"What's on my list?"* → triggers `list_tasks`
- *"Give me a random number between 1 and 100."* → triggers `random_number`

The side panel will show the tool call streaming, its arguments, the returned result, and execution time.

## Security Notes

- `OPENAI_API_KEY` is server-only.
- Browser receives only an ephemeral `client_secret` good for one session.
- No audio is persisted; transcripts and tool calls live only in React state (and `localStorage` for the demo task list).

## Future Improvements

- Tool UI cards (rich rendering per tool type)
- Confirmation gating for destructive tools
- Server-side tools (calendar, email, search) via `/api/tools/*` proxies
- Persistent transcript
- Wake-word detection
- Vercel deployment

## Scripts

```bash
npm run dev     # local dev
npm run build   # production build
npm run start   # serve production build
npm run lint    # next lint
```
