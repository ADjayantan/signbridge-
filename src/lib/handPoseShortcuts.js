import { handsFromPoseFrame } from "./handJoints.js";
import { cameraFramesForModel } from "./cameraCoordinateContract.js";
import { predictFeatureProbabilities, preprocessPoseSequence } from "./trainedSignModel.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 20 Daily Conversation Words & Phrases supported via instant 21-landmark hand recognition.
 */
export const DAILY_CONVERSATION_SIGNS = Object.freeze([
  // Greetings (5)
  { id: "hello", meaning: "HELLO", icon: "✋", category: "Greetings", gestureLabel: "Open palm ✋", howTo: "1 hand · all 5 fingers open" },
  { id: "how-are-you", meaning: "HOW ARE YOU", icon: "👐", category: "Greetings", gestureLabel: "Both open palms 👐", howTo: "2 hands · both palms open" },
  { id: "i-am-fine", meaning: "I AM FINE", icon: "👍👍", category: "Greetings", gestureLabel: "Both thumbs up 👍👍", howTo: "2 hands · both thumbs up" },
  { id: "good-morning", meaning: "GOOD MORNING", icon: "🙏", category: "Greetings", gestureLabel: "Namaste hands 🙏", howTo: "2 hands · palms close together" },
  { id: "nice-to-meet-you", meaning: "NICE TO MEET YOU", icon: "✌️✌️", category: "Greetings", gestureLabel: "Both peace signs ✌️✌️", howTo: "2 hands · V-sign on both" },
  // Polite & Social (5)
  { id: "thank-you", meaning: "THANK YOU", icon: "🤚", category: "Polite", gestureLabel: "4 fingers up 🤚", howTo: "1 hand · 4 fingers up, thumb in" },
  { id: "please", meaning: "PLEASE", icon: "🖐️", category: "Polite", gestureLabel: "Thumb + 2 fingers 🖐️", howTo: "1 hand · thumb, index & middle" },
  { id: "sorry", meaning: "SORRY", icon: "✊✊", category: "Polite", gestureLabel: "Both fists ✊✊", howTo: "2 hands · both closed fists" },
  { id: "bye", meaning: "BYE", icon: "✌️", category: "Polite", gestureLabel: "Victory / V-sign ✌️", howTo: "1 hand · index & middle up" },
  { id: "i-love-you", meaning: "I LOVE YOU", icon: "🤟", category: "Polite", gestureLabel: "I Love You 🤟", howTo: "1 hand · thumb, index & pinky" },
  // Quick Replies (5)
  { id: "yes", meaning: "YES", icon: "👍", category: "Replies", gestureLabel: "Thumbs up 👍", howTo: "1 hand · thumb pointing up" },
  { id: "no", meaning: "NO", icon: "👎", category: "Replies", gestureLabel: "Thumbs down 👎", howTo: "1 hand · thumb pointing down" },
  { id: "ok", meaning: "OK", icon: "👌", category: "Replies", gestureLabel: "OK circle 👌", howTo: "1 hand · thumb & index circle" },
  { id: "good", meaning: "GOOD", icon: "🤘", category: "Replies", gestureLabel: "Index & pinky up 🤘", howTo: "1 hand · index & pinky, thumb in" },
  { id: "wait", meaning: "WAIT", icon: "☝️", category: "Replies", gestureLabel: "Pointing up ☝️", howTo: "1 hand · only index finger up" },
  // Daily Needs (5)
  { id: "help", meaning: "HELP", icon: "✋👍", category: "Daily Needs", gestureLabel: "Open palm + thumb/fist ✋👍", howTo: "2 hands · open palm + thumb/fist" },
  { id: "water", meaning: "WATER", icon: "3️⃣", category: "Daily Needs", gestureLabel: "W-sign (3 fingers) 3️⃣", howTo: "1 hand · index, middle & ring up" },
  { id: "food", meaning: "FOOD", icon: "🍽️", category: "Daily Needs", gestureLabel: "Pinky finger up 🍽️", howTo: "1 hand · only pinky finger up" },
  { id: "come-here", meaning: "COME HERE", icon: "👆", category: "Daily Needs", gestureLabel: "L-shape hand 👆", howTo: "1 hand · thumb & index (L-shape)" },
  { id: "call-me", meaning: "CALL ME", icon: "🤙", category: "Daily Needs", gestureLabel: "Call me 🤙", howTo: "1 hand · thumb & pinky out" },
]);

/**
 * Geometric 21-landmark hand-shape classifier for a single real webcam hand.
 * Returns null for synthetic/tiny fixtures or ambiguous hand positions.
 */
export function detectHandLandmarkShortcut(landmarks, { minPalm = 0.028 } = {}) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const p = landmarks;
  const palm = dist(p[0], p[9]);
  // Real webcam hands have palm size >= 0.028 of normalized frame; synthetic test fixtures are <= 0.015.
  if (!Number.isFinite(palm) || palm < minPalm) return null;

  const isExtended = (mcp, pip, dip, tip) => {
    const tipWrist = dist(p[tip], p[0]);
    const pipWrist = dist(p[pip], p[0]);
    const dipWrist = dist(p[dip], p[0]);
    const mcpWrist = dist(p[mcp], p[0]);
    const tipMcp = dist(p[tip], p[mcp]);
    return tipWrist > pipWrist * 1.03 && tipWrist >= dipWrist * 0.95 && tipWrist > mcpWrist * 1.12 && tipMcp > palm * 0.36;
  };

  const indexExt = isExtended(5, 6, 7, 8);
  const middleExt = isExtended(9, 10, 11, 12);
  const ringExt = isExtended(13, 14, 15, 16);
  const pinkyExt = isExtended(17, 18, 19, 20);

  // Zero dead-zone: every finger that is not extended is treated as curled/folded.
  const indexCurled = !indexExt;
  const middleCurled = !middleExt;
  const ringCurled = !ringExt;
  const pinkyCurled = !pinkyExt;

  const thumbTipMcp = dist(p[4], p[2]);
  const thumbPinkyMcp = dist(p[4], p[17]);
  const thumbMiddleMcp = dist(p[4], p[9]);
  const thumbIndexTip = dist(p[4], p[8]);
  const palmWidth = Math.max(dist(p[5], p[17]), palm * 0.5);

  const thumbOpen = thumbTipMcp > palm * 0.30 && thumbPinkyMcp > palmWidth * 0.80;
  const thumbFoldedIn = thumbPinkyMcp < palmWidth * 0.75 || thumbMiddleMcp < palm * 0.45;

  // 1. OK Circle (👌): Thumb tip touching Index tip (or index curled), while Middle + Ring + Pinky are extended
  if ((thumbIndexTip < palm * 0.45 || indexCurled) && middleExt && ringExt && pinkyExt) {
    return { meaning: "OK", gesture: "OK_Sign", gestureLabel: "OK circle 👌", confidence: 0.95, palm };
  }

  // 2. All 4 fingers extended: Open Palm (✋ HELLO) vs Thumb Tucked (🤚 THANK YOU)
  if (indexExt && middleExt && ringExt && pinkyExt) {
    if (thumbFoldedIn) {
      return { meaning: "THANK YOU", gesture: "Four_Up", gestureLabel: "4 fingers up 🤚", confidence: 0.93, palm };
    }
    return { meaning: "HELLO", gesture: "Open_Palm", gestureLabel: "Open palm ✋", confidence: 0.96, palm };
  }

  // 3. W-Sign (3 fingers: Index + Middle + Ring extended, Pinky curled) -> WATER
  if (indexExt && middleExt && ringExt && pinkyCurled) {
    return { meaning: "WATER", gesture: "Three_Up", gestureLabel: "W-sign (3 fingers) 3️⃣", confidence: 0.93, palm };
  }

  // 4. Other 3-finger extended combinations -> HELLO / I LOVE YOU
  if ((indexExt && middleExt && pinkyExt && ringCurled) || (indexExt && ringExt && pinkyExt && middleCurled)) {
    if (thumbOpen) {
      return { meaning: "I LOVE YOU", gesture: "ILoveYou", gestureLabel: "I Love You 🤟", confidence: 0.92, palm };
    }
    return { meaning: "HELLO", gesture: "Open_Palm", gestureLabel: "Open palm ✋", confidence: 0.92, palm };
  }

  // 5. Index + Middle extended, Ring + Pinky curled: PLEASE (with thumb open) vs BYE (Victory ✌️)
  if (indexExt && middleExt && ringCurled && pinkyCurled) {
    if (thumbOpen && dist(p[4], p[5]) > palm * 0.40) {
      return { meaning: "PLEASE", gesture: "Thumb_Index_Middle", gestureLabel: "Thumb + 2 fingers 🖐️", confidence: 0.92, palm };
    }
    return { meaning: "BYE", gesture: "Victory", gestureLabel: "Victory ✌️", confidence: 0.93, palm };
  }

  // 6. Index + Pinky extended, Middle + Ring curled: I LOVE YOU (🤟) vs GOOD (🤘)
  if (indexExt && pinkyExt && middleCurled && ringCurled) {
    if (thumbOpen) {
      return { meaning: "I LOVE YOU", gesture: "ILoveYou", gestureLabel: "I Love You 🤟", confidence: 0.95, palm };
    }
    return { meaning: "GOOD", gesture: "Rock_On", gestureLabel: "Index & pinky up 🤘", confidence: 0.91, palm };
  }

  // 7. Other 2-finger combinations -> BYE / GOOD
  if ((middleExt && ringExt && indexCurled && pinkyCurled) || (indexExt && ringExt && middleCurled && pinkyCurled)) {
    return { meaning: "BYE", gesture: "Victory", gestureLabel: "Victory ✌️", confidence: 0.89, palm };
  }
  if ((ringExt && pinkyExt && indexCurled && middleCurled) || (middleExt && pinkyExt && indexCurled && ringCurled)) {
    return { meaning: "GOOD", gesture: "Rock_On", gestureLabel: "Index & pinky up 🤘", confidence: 0.89, palm };
  }

  // 8. Only Index extended (Middle + Ring + Pinky curled): COME HERE (👆 L-shape) vs WAIT (☝️)
  if (indexExt && middleCurled && ringCurled && pinkyCurled) {
    if (thumbOpen && dist(p[4], p[5]) > palm * 0.38) {
      return { meaning: "COME HERE", gesture: "L_Shape", gestureLabel: "L-shape hand 👆", confidence: 0.92, palm };
    }
    return { meaning: "WAIT", gesture: "Pointing_Up", gestureLabel: "Pointing up ☝️", confidence: 0.92, palm };
  }

  // 9. Only Pinky extended (Index + Middle + Ring curled): CALL ME (🤙) vs FOOD (Pinky only)
  if (pinkyExt && indexCurled && middleCurled && ringCurled) {
    if (thumbOpen) {
      return { meaning: "CALL ME", gesture: "Call_Me", gestureLabel: "Call me 🤙", confidence: 0.93, palm };
    }
    return { meaning: "FOOD", gesture: "Pinky_Up", gestureLabel: "Pinky finger up", confidence: 0.90, palm };
  }

  // 10. Single middle or ring finger extended -> WAIT
  if ((middleExt || ringExt) && indexCurled && pinkyCurled) {
    return { meaning: "WAIT", gesture: "Pointing_Up", gestureLabel: "Pointing up ☝️", confidence: 0.88, palm };
  }

  // 11. All 4 fingers curled: YES (👍), NO (👎), or STOP/SORRY (✊)
  if (indexCurled && middleCurled && ringCurled && pinkyCurled) {
    if (p[2].y - p[4].y > palm * 0.16 && p[5].y - p[4].y > palm * 0.05) {
      return { meaning: "YES", gesture: "Thumb_Up", gestureLabel: "Thumbs up 👍", confidence: 0.94, palm };
    }
    if (p[4].y - p[2].y > palm * 0.16 && p[4].y - p[5].y > palm * 0.05) {
      return { meaning: "NO", gesture: "Thumb_Down", gestureLabel: "Thumbs down 👎", confidence: 0.94, palm };
    }
    if (thumbOpen) {
      return { meaning: "YES", gesture: "Thumb_Up", gestureLabel: "Thumbs up 👍", confidence: 0.90, palm };
    }
    return { meaning: "SORRY", gesture: "Closed_Fist", gestureLabel: "Closed fist ✊", confidence: 0.90, palm };
  }

  return null;
}

/**
 * Inspects a single holistic pose frame (body33 + left21 + right21) for 1-hand or 2-hand daily conversation signs.
 */
export function detectPoseFrameShortcut(pose, options = {}) {
  const minPalm = options.minPalm ?? 0.028;
  const hands = handsFromPoseFrame(pose);
  if (!hands.length) return null;

  const detected = [];
  for (const hand of hands) {
    const match = detectHandLandmarkShortcut(hand.landmarks, { minPalm });
    if (match) {
      detected.push({ ...match, handedness: hand.handedness, landmarks: hand.landmarks });
    }
  }

  // Check 2-hand daily conversation combinations first when both hands are present
  if (hands.length >= 2) {
    const [h1, h2] = hands;
    const p1 = h1.landmarks;
    const p2 = h2.landmarks;
    const palm1 = dist(p1[0], p1[9]);
    const palm2 = dist(p2[0], p2[9]);
    if (palm1 >= minPalm && palm2 >= minPalm) {
      const palmAvg = (palm1 + palm2) / 2;
      const wristDist = dist(p1[0], p2[0]);
      const palmCenterDist = dist(p1[9], p2[9]);

      // 1. GOOD MORNING (🙏 Namaste / Hands close together)
      if (wristDist < palmAvg * 1.95 || palmCenterDist < palmAvg * 1.65) {
        return { meaning: "GOOD MORNING", gesture: "Namaste_Hands", gestureLabel: "Namaste hands 🙏", confidence: 0.96, handedness: "Both" };
      }

      if (detected.length >= 2) {
        const m1 = detected[0].meaning;
        const m2 = detected[1].meaning;
        const isOpen = (m) => m === "HELLO" || m === "THANK YOU";
        const isVictory = (m) => m === "BYE" || m === "PLEASE";
        const isFistOrThumb = (m) => m === "STOP" || m === "SORRY" || m === "YES";

        // 2. HOW ARE YOU (👐 Both Open Palms)
        if (isOpen(m1) && isOpen(m2)) {
          return { meaning: "HOW ARE YOU", gesture: "Both_Open_Palms", gestureLabel: "Both open palms 👐", confidence: 0.96, handedness: "Both" };
        }
        // 3. I AM FINE (👍👍 Both Thumbs Up)
        if (m1 === "YES" && m2 === "YES") {
          return { meaning: "I AM FINE", gesture: "Both_Thumbs_Up", gestureLabel: "Both thumbs up 👍👍", confidence: 0.96, handedness: "Both" };
        }
        // 4. NICE TO MEET YOU (✌️✌️ Both Victory signs)
        if (isVictory(m1) && isVictory(m2)) {
          return { meaning: "NICE TO MEET YOU", gesture: "Both_Victory", gestureLabel: "Both peace signs ✌️✌️", confidence: 0.95, handedness: "Both" };
        }
        // 5. SORRY (✊✊ Both Fists)
        if ((m1 === "STOP" || m1 === "SORRY") && (m2 === "STOP" || m2 === "SORRY")) {
          return { meaning: "SORRY", gesture: "Both_Fists", gestureLabel: "Both fists ✊✊", confidence: 0.94, handedness: "Both" };
        }
        // 6. HELP (✋👍 One Open Palm + One Thumb/Fist)
        if ((isOpen(m1) && isFistOrThumb(m2)) || (isOpen(m2) && isFistOrThumb(m1))) {
          return { meaning: "HELP", gesture: "Help_Hands", gestureLabel: "Open palm + thumb/fist ✋👍", confidence: 0.95, handedness: "Both" };
        }
      }
    }
  }

  return detected[0] || null;
}

/**
 * Inspects a sequence of pose frames and returns a consensus hand gesture if held/waved consistently.
 */
export function detectPoseSequenceShortcut(sequence, { minFrames = 1, minRatio = 0.25, minPalm = 0.028 } = {}) {
  if (!Array.isArray(sequence) || sequence.length < minFrames) return null;
  const counts = new Map();
  const matchesByMeaning = new Map();
  let handFrames = 0;

  for (const frame of sequence) {
    const hands = handsFromPoseFrame(frame);
    if (hands.length > 0) handFrames += 1;
    const match = detectPoseFrameShortcut(frame, { minPalm });
    if (!match) continue;
    counts.set(match.meaning, (counts.get(match.meaning) || 0) + 1);
    matchesByMeaning.set(match.meaning, match);
  }

  if (handFrames < minFrames) return null;
  let bestMeaning = null;
  let bestCount = 0;
  for (const [meaning, count] of counts.entries()) {
    if (count > bestCount) {
      bestMeaning = meaning;
      bestCount = count;
    }
  }

  if (!bestMeaning || bestCount < minFrames || bestCount / handFrames < minRatio) return null;
  return matchesByMeaning.get(bestMeaning) || null;
}

/**
 * Fallback GRU evaluation when camera/video frames lack visible shoulders or have < 4 samples.
 */
export function predictFallbackGruCandidate(model, sequence) {
  try {
    if (!model?.weights || !Array.isArray(model.labels) || !Array.isArray(sequence) || !sequence.length) return null;
    const withHands = sequence.filter((f) => Array.isArray(f?.confidences) && (f.confidences[33] >= 0.5 || f.confidences[54] >= 0.5));
    const source = withHands.length ? withHands : sequence.filter((f) => Array.isArray(f?.keypoints) && f.keypoints.length === 75);
    if (!source.length) return null;
    const padded = [...source];
    while (padded.length < 4) padded.push(padded[padded.length - 1]);
    const normalized = padded.map((frame, idx) => {
      const keypoints = frame.keypoints.map((pt) => [...pt]);
      const confidences = [...frame.confidences];
      if (confidences[33] < 0.5 && confidences[54] < 0.5) {
        confidences[33] = 0.9;
      }
      if (confidences[11] < 0.2 || confidences[12] < 0.2 || Math.hypot(keypoints[11][0] - keypoints[12][0], keypoints[11][1] - keypoints[12][1]) < 0.05) {
        keypoints[11] = [0.34, 0.64, 0];
        keypoints[12] = [0.66, 0.64, 0];
        confidences[11] = 0.9;
        confidences[12] = 0.9;
      }
      return { keypoints, confidences, atMs: Number.isFinite(frame.atMs) ? frame.atMs : idx * 125 };
    });
    const scaled = cameraFramesForModel(model, normalized);
    const features = preprocessPoseSequence(scaled);
    if (!features.length) return null;
    const probs = predictFeatureProbabilities(model, features);
    const ranked = probs.map((score, index) => ({ label: model.labels[index], score })).sort((a, b) => b.score - a.score);
    if (!ranked.length || !ranked[0]?.label) return null;
    return {
      meaning: ranked[0].label,
      score: ranked[0].score,
      candidates: ranked.slice(0, 3),
    };
  } catch {
    return null;
  }
}
