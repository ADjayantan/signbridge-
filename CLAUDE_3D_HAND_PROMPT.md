# SignBridge — Master Project Guide & 3D Real Human Hand Specification (For Claude & Fable 5.2)

### 📍 Exact Project Locations & Live Status
- **Local Computer Project Root (Windows):** `F:\Downloads\signbridge`
- **Main 3D Hand Component File on Computer:** `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx`
- **20 Sign Symbols Logic File on Computer:** `F:\Downloads\signbridge\src\lib\handPoseShortcuts.js`
- **Main Studio Page File on Computer:** `F:\Downloads\signbridge\src\modes\TrainedSignMode.jsx`
- **3D Hand Mesh Asset on Computer:** `F:\Downloads\signbridge\public\models\hand.fbx`
- **Prompt Guide File on Computer:** `F:\Downloads\signbridge\CLAUDE_3D_HAND_PROMPT.md`
- **GitHub Repository URL:** `https://github.com/ADjayantan/signbridge-` (Branches: `main` and `codex/sign-speech-video`)
- **🟢 LIVE Running Web App URL:** `http://127.0.0.1:5174/#trained-sign` (Vite Dev/Preview Server is **LIVE** on Port `5174`)
- **🟢 LIVE Running Room/API Server URL:** `http://127.0.0.1:3001` (Node WebSocket & Room Server is **LIVE** on Port `3001`)

---

## 1. Ready-to-Copy Master Prompt for Claude (Includes Computer Path, GitHub & Live URLs)

```markdown
You are a Senior Three.js / WebGL Character Rigging Engineer and React Developer working on **SignBridge**, a real-time Sign Language to Text & Voice web application.

### Project Locations & Live Environment
- **Local Computer Path (Windows):** `F:\Downloads\signbridge`
- **Key Files on Disk:**
  - `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx` (3D Human Hand Stage & 20 Sign Animations)
  - `F:\Downloads\signbridge\src\lib\handPoseShortcuts.js` (20 Daily Conversation Signs & Landmark Detector)
  - `F:\Downloads\signbridge\src\modes\TrainedSignMode.jsx` (Main Camera + 3D Hand + Voice Studio UI)
  - `F:\Downloads\signbridge\public\models\hand.fbx` (3D Hand Asset)
  - `F:\Downloads\signbridge\src\styles.css` (Studio Theme & 3D Stage CSS)
- **GitHub Repository:** `https://github.com/ADjayantan/signbridge-` (active branches: `main`, `codex/sign-speech-video`)
- **Live Running Servers (Currently Active):**
  - Frontend Web Studio (LIVE): `http://127.0.0.1:5174/#trained-sign`
  - Backend Room Server (LIVE): `http://127.0.0.1:3001`

### Your Objective
Upgrade the 3D hand visualizer in `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx` so that:
1. **Photorealistic Real Human Hand Design:**
   - The 3D hand looks like a continuous, organic, anatomically realistic human hand, wrist, and forearm (smooth skin envelope across the metacarpal palm, webbed finger bases, realistic thumb thenar muscle pad, knuckle skin folds, fingernails with nail beds, and subsurface-like warm skin shading).
   - No detached robot cylinders, no chopped-off wrist, and no inside-out polygon flipping.
2. **Flawless 3D Interaction & Live Camera Mirroring:**
   - When the webcam is ON (`cameraOn === true`) and `liveHandsRef.current` provides 21 MediaPipe hand landmarks (`0..20`), the 3D hand must move and tilt in the **exact same direction** as the user's hand in the mirrored webcam preview (`screenX = 1 - lm.x`, `screenY = -lm.y`).
   - Moving the hand left in the mirrored webcam moves the 3D hand left (`-X`); moving right moves it right (`+X`); tilting left/right tilts the 3D hand in the same screen direction; curling any finger bends it forward (`+Z`, palmar side) and NEVER backwards through the dorsal side.
   - Clicking any of the **20 Daily Conversation Sign buttons** (even while the camera is running) must immediately lock and animate that exact 3D Sign Symbol on the stage.
   - Dragging the 3D stage with mouse/touch must smoothly rotate the hand 360° (`baseYaw`, `basePitch`) without snapping back to `0` when releasing the pointer.
3. **All 20 Daily Conversation Sign Symbols Must Be Anatomically Accurate:**
   - Every 1-hand and 2-hand sign (`HELLO`, `HOW ARE YOU`, `I AM FINE`, `GOOD MORNING`, `NICE TO MEET YOU`, `THANK YOU`, `PLEASE`, `SORRY`, `BYE`, `I LOVE YOU`, `YES`, `NO`, `OK`, `GOOD`, `WAIT`, `HELP`, `WATER`, `FOOD`, `COME HERE`, `CALL ME`) must have crystal-clear finger poses and natural gesture motion.

### Strict Constraints
- Edit the files directly inside `F:\Downloads\signbridge`.
- Preserve all component props of `InteractiveSign3D` and keep `export function get3DPoseForSign(meaning)` exported from `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx`.
- Do not break the existing dark emerald & gold UI theme (`F:\Downloads\signbridge\src\styles.css`).
- Verify your changes with `npm run build` and `node --test tests/handPoseShortcuts.test.js` in `F:\Downloads\signbridge`, and verify live at `http://127.0.0.1:5174/#trained-sign`.
```

---

## 2. Ready-to-Copy Prompt for Fable 5.2 (Real 3D Hand Asset & Motion Designer)

```markdown
Project Name: SignBridge (Sign Language to Text & Voice Studio)
Local Project Path: F:\Downloads\signbridge
Target Component: F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx
GitHub Repo: https://github.com/ADjayantan/signbridge-
Live App URL: http://127.0.0.1:5174/#trained-sign

Task: Design and rig a photorealistic 3D Human Hand + Wrist + Forearm character asset for our real-time WebGL / Three.js Sign Language translator:

1. **Mesh & Topology:**
   - Seamless, organic human right hand (mirrored on X for left hand) with full wrist and lower forearm sleeve cuff.
   - Sculpted palmar anatomy: curved metacarpal arch, fleshy thenar eminence (thumb base), hypothenar pad, interdigital skin webbing between finger bases, subtle knuckle creases, and realistic fingernail plates on the dorsal side (`-Z`).
2. **Skeleton & Bone Hierarchy (21 Landmarks / 16 Bones):**
   - `Wrist` (root at `0, -0.42, 0`)
   - `Thumb_CMC` -> `Thumb_MCP` -> `Thumb_IP` -> `Thumb_Tip` (mounted at radial base `-0.34, -0.18, +0.06`)
   - `Index_MCP` -> `Index_PIP` -> `Index_DIP` -> `Index_Tip`
   - `Middle_MCP` -> `Middle_PIP` -> `Middle_DIP` -> `Middle_Tip`
   - `Ring_MCP` -> `Ring_PIP` -> `Ring_DIP` -> `Ring_Tip`
   - `Pinky_MCP` -> `Pinky_PIP` -> `Pinky_DIP` -> `Pinky_Tip`
3. **Coordinate Convention:**
   - Rest Pose (Open Palm `HELLO`): Palm faces forward (`+Z`) toward the camera, fingers point straight up (`+Y`), fingernails face `-Z`, right-hand thumb is on the `-X` (left) side.
   - Positive `rotation.x` on any finger bone curls the phalanx forward (`+Z`) into the palm.
4. **Materials & Lighting:**
   - PBR Subsurface-style human skin (`color: #e0a382`, `roughness: 0.42`, `clearcoat: 0.14`, `sheenColor: #ffc6ad`), semi-gloss keratin fingernails (`#f4cfc0`), and dark emerald studio cuff (`#112620` with `#45e3b0` trim) lit by a 3-point warm key + cool fill + rim studio setup.
```

---

## 3. Exact File Map on Local Computer (`F:\Downloads\signbridge`)

| Local Computer Path | Relative Repo Path | Role in the Project |
| :--- | :--- | :--- |
| `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx` | `src/components/InteractiveSign3D.jsx` | **Core 3D Hand Component.** Renders the Three.js WebGL stage, articulated 1-hand/2-hand human rig, 3 skin themes (`Real Skin`, `Cyber Holo`, `Sculpt Gold`), 360° orbit drag controls, 3D Sentence Player bar, and all 20 sign symbol animations. |
| `F:\Downloads\signbridge\src\lib\handPoseShortcuts.js` | `src/lib/handPoseShortcuts.js` | **20 Daily Signs Vocabulary & Recognition Engine.** Defines `DAILY_CONVERSATION_SIGNS`, `smoothHandLandmarks`, `detectHandLandmarkShortcut`, `detectPoseFrameShortcut`, `detectPoseSequenceShortcut`, and `parseSentenceToSignSteps`. |
| `F:\Downloads\signbridge\src\modes\TrainedSignMode.jsx` | `src/modes/TrainedSignMode.jsx` | **Main Studio Workspace UI.** Connects the left-column camera & MediaPipe tracking loop (`usePoseTracking` + `loadGestureRecognizer` neural booster), right-column `InteractiveSign3D` + 20 Daily Signs grid, and bottom-row Text/Voice composer. |
| `F:\Downloads\signbridge\src\hooks\usePoseTracking.js` | `src/hooks/usePoseTracking.js` | Runs MediaPipe Holistic tracking at ~24 FPS (`42ms` interval in live mode, `125ms` in test mode). |
| `F:\Downloads\signbridge\src\lib\gestureRecognizer.js` | `src/lib/gestureRecognizer.js` | Loads MediaPipe `GestureRecognizer` (`gesture_recognizer.task`) on GPU/CPU for fast 21-joint hand landmarks + neural gesture labels (`Thumb_Up`, `Thumb_Down`, `Open_Palm`, `Closed_Fist`, `Victory`, `ILoveYou`, `Pointing_Up`). |
| `F:\Downloads\signbridge\public\models\hand.fbx` | `public/models/hand.fbx` | Static FBX hand mesh asset in `public/models/`. |
| `F:\Downloads\signbridge\src\styles.css` | `src/styles.css` | Complete styling for the studio workspace, `.sign3d-stage`, `.sign3d-viewport`, `.sign3d-sequence-bar`, and `.workspace-daily-grid`. |
| `F:\Downloads\signbridge\tests\handPoseShortcuts.test.js` | `tests/handPoseShortcuts.test.js` | Automated test suite for all 20 signs, sentence parser, and landmark smoothing. |

---

## 4. Component Props & Export Contract (`InteractiveSign3D.jsx`)

Any update to `F:\Downloads\signbridge\src\components\InteractiveSign3D.jsx` **must preserve** these exact exports and props so `F:\Downloads\signbridge\src\modes\TrainedSignMode.jsx` works without errors:

```jsx
// Named export required:
export function get3DPoseForSign(meaning = "HELLO") { ... }

// Default component export required:
export default function InteractiveSign3D({
  activeMeaning = "HELLO",       // Currently recognized or selected sign meaning (e.g. "YES", "HELLO")
  holdingMeaning = "",           // Sign currently being held on camera during the 230ms lock-on window
  recognized = false,            // Boolean: true when a sign is actively recognized
  liveHandsRef = null,           // React ref: liveHandsRef.current = [{ side: "Left"|"Right", landmarks: Array(21) }]
  cameraOn = false,              // Boolean: whether the user's webcam is currently active
  onSelectSign = null,           // Callback: (signItem) => void when user clicks one of the 20 sign chips
  sentencePlan = null,           // Output of parseSentenceToSignSteps(text) for the 3D Sentence Player
  sentencePlayToken = 0,         // Incremented counter that triggers sentence playback from step 0
  onCloseSentencePlayer = null,  // Callback to close the 3D Sentence Player bar
})
```

---

## 5. Coordinate System & Live Webcam Mirroring Math

1. **Mirrored Video Element:** In `TrainedSignMode.jsx`, `<video className="mirror">` uses CSS `transform: scaleX(-1)`.
2. **Raw MediaPipe Coordinates (`lm[0..20]`):**
   - `lm.x` is `0.0` on the left of the raw camera sensor, which appears on the **RIGHT** side of the user's mirrored screen!
   - `lm.x` is `1.0` on the right of the raw camera sensor, which appears on the **LEFT** side of the user's mirrored screen!
   - True screen-space coordinates matching what the user sees in the webcam preview:
     - `screenX = 1 - lm.x` (`0` = left edge, `0.5` = center, `1` = right edge)
     - `screenY = -lm.y` (`0` = top edge, `-1` = bottom edge)
3. **Three.js World Space:**
   - `+X` = Right on screen (`(1 - lm.x) - 0.5 = 0.5 - lm.x`)
   - `+Y` = Up on screen (`0.52 - lm.y`)
   - `+Z` = Forward toward the camera/viewer (palmar side of the hand)
   - `-Z` = Dorsal side (back of the hand, where fingernails sit)
4. **Anatomical Forward Kinematics (FK):**
   - Compute each finger's curl scalar `curl ∈ [0, 1]` from 3D bone-chain straightness (`d3(mcp, tip) / (d3(mcp, pip) + d3(pip, dip) + d3(dip, tip))`) combined with wrist-distance ratio (`d2(tip, wrist) / d2(pip, wrist)`).
   - Apply positive `rotation.x` on `mcpPivot` (`curl * 1.42`), `pipPivot` (`curl * 1.68`), and `dipPivot` (`curl * 1.12`) so fingers **only** bend anatomically toward the palm (`+Z`).
   - Compute wrist roll `rollZ` from the screen-space vector `Wrist (0) -> Middle_MCP (9)`:
     ```js
     const dxScreen = (1 - p[9].x) - (1 - p[0].x);
     const dyScreen = -(p[9].y - p[0].y);
     const wristTilt = Math.max(-0.65, Math.min(0.65, Math.atan2(dxScreen, Math.max(0.05, dyScreen)) * 0.7));
     const rollZ = -wristTilt;
     ```

---

## 6. Complete Specification of All 20 Daily Conversation Sign Symbols

| # | Sign Meaning | Icon | Hands | Thumb Posture | Index | Middle | Ring | Pinky | Hand Orientation & 3D Animation |
| :- | :--- | :-: | :-: | :--- | :-: | :-: | :-: | :-: | :--- |
| 1 | **`HELLO`** | ✋ | 1 | `open` (abducted ~35°) | `0` (up) | `0` (up) | `0` (up) | `0` (up) | Upright open palm facing viewer (`+Z`), gentle side-to-side wave (`anim: "wave"`). |
| 2 | **`HOW ARE YOU`** | 👐 | 2 | `open` (both hands) | `0` | `0` | `0` | `0` | Both open palms side-by-side (`x = ±0.88`), welcoming inward turn (`anim: "welcome"`). |
| 3 | **`I AM FINE`** | 👍👍 | 2 | `up` (extended 70° radial) | `1` (fist) | `1` (fist) | `1` (fist) | `1` (fist) | Both hands rolled (`rollZ = ∓1.15 rad`) so both thumbs point **straight UP (`+Y`)** (`anim: "nod"`). |
| 4 | **`GOOD MORNING`** | 🙏 | 2 | `tucked` | `0` | `0` | `0` | `0` | **Namaste / Vanakkam:** Two flat hands angled together at center (`x = ±0.46`, `yaw = ±0.42`, `roll = ∓0.16`, `anim: "bow"`). |
| 5 | **`NICE TO MEET YOU`** | ✌️✌️ | 2 | `tucked` | `0` (V) | `0` (V) | `1` | `1` | Both hands showing V / Peace sign (`splay = 0.13`) moving slightly toward each other (`anim: "meet"`). |
| 6 | **`THANK YOU`** | 🤚 | 1 | `tucked` across palm | `0` | `0` | `0` | `0` | 4 fingers straight & together (`splay = 0.01`), hand nods forward from chin toward viewer (`anim: "forwardNod"`). |
| 7 | **`PLEASE`** | 🖐️ | 1 | `wide` (abducted 75°) | `0` | `0` | `1` | `1` | Thumb + Index + Middle extended, Ring + Pinky curled, circular chest rub motion (`anim: "circle"`). |
| 8 | **`SORRY`** | ✊✊ | 2 | `fist` (wrapped over fingers) | `1` | `1` | `1` | `1` | Both hands in tight closed fists (`x = ±0.76`) moving in a comforting circle (`anim: "circle"`). |
| 9 | **`BYE`** | ✌️ | 1 | `tucked` | `0` (V) | `0` (V) | `1` | `1` | Single-hand Victory / Peace V-sign (`splay = 0.15`) waving side-to-side (`anim: "wave"`). |
| 10 | **`I LOVE YOU`** | 🤟 | 1 | `wide` (abducted 75°) | `0` (up) | `1` (curled) | `1` (curled) | `0` (up) | Classic ASL ILY sign: Thumb + Index + Pinky extended, Middle + Ring curled (`anim: "pulse"`). |
| 11 | **`YES`** | 👍 | 1 | `up` (extended 70° radial) | `1` | `1` | `1` | `1` | **Thumbs Up:** Hand rolled `-66°` (`rollZ = -1.15`) so thumb points **straight UP (`+Y`)** and 4 curled fingers stack horizontally (`anim: "nod"`). |
| 12 | **`NO`** | 👎 | 1 | `up` (extended 70° radial) | `1` | `1` | `1` | `1` | **Thumbs Down:** Hand rolled `+112°` (`rollZ = +1.95`) so thumb points **straight DOWN (`-Y`)** (`anim: "shake"`). |
| 13 | **`OK`** | 👌 | 1 | `pinch` (curves to Index tip) | `0.68` (O-curve) | `0` (up) | `0` (up) | `0` (up) | **Precision O-Pinch:** Thumb tip meets Index tip at `(-0.33, +0.27, +0.51)` forming a round circle; Middle/Ring/Pinky fanned up (`anim: "pulse"`). |
| 14 | **`GOOD`** | 🤘 | 1 | `tucked` across palm | `0` (up) | `1` | `1` | `0` (up) | Rock-on / Horns sign: Index + Pinky straight up, Thumb tucked across curled Middle + Ring (`anim: "nod"`). |
| 15 | **`WAIT`** | ☝️ | 1 | `tucked` | `0` (up) | `1` | `1` | `1` | Index finger pointing straight up (`+Y`), all other fingers curled (`anim: "idle"`). |
| 16 | **`HELP`** | ✋👍 | 2 | Left `open`, Right `up` | L:`0` R:`1` | L:`0` R:`1` | L:`0` R:`1` | L:`0` R:`1` | Left open palm + Right thumbs-up fist lifting upward together (`anim: "lift"`). |
| 17 | **`WATER`** | 3️⃣ | 1 | `tucked` | `0` (up) | `0` (up) | `0` (up) | `1` (curled) | **W-Sign:** Index + Middle + Ring extended and spread (`splay = 0.11`), Pinky curled, Thumb tucked (`anim: "forwardNod"`). |
| 18 | **`FOOD`** | 🍽️ | 1 | `tucked` | `1` | `1` | `1` | `0` (up) | Pinky extended straight up, Index/Middle/Ring curled, nodding toward mouth (`anim: "forwardNod"`). |
| 19 | **`COME HERE`** | 👆 | 1 | `wide` (abducted 75°) | `0` (beckon) | `1` | `1` | `1` | **L-Shape:** Thumb wide + Index up with animated beckoning curl (`anim: "beckon"`). |
| 20 | **`CALL ME`** | 🤙 | 1 | `wide` (abducted 75°) | `1` | `1` | `1` | `0` (up) | **Shaka / Phone Hand:** Thumb wide + Pinky up, Index/Middle/Ring curled, tilted `-0.28 rad` rocking near ear (`anim: "callRock"`). |

---

## 7. Build, Test & Git Commands (Run in `F:\Downloads\signbridge`)

```powershell
# 1. Switch to local project folder on computer
Set-Location 'F:\Downloads\signbridge'

# 2. Build production bundle
npm run build

# 3. Run unit tests
node --test tests/handPoseShortcuts.test.js tests/poseGraphFeatures.test.js

# 4. Push updates to GitHub (https://github.com/ADjayantan/signbridge-)
git add -A
git commit -m "feat(3d-hand): upgrade photorealistic 3D hand rig and 20 sign symbols"
git push origin main
git push origin HEAD:codex/sign-speech-video
```
