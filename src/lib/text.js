// Text helpers for speech output. Pure functions, unit-tested in tests/text.test.js.

/** Removes markdown, links and emoji so a speech synthesizer reads clean sentences. */
export function stripForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    // Emoji, including skin tones, flags and joined sequences. A lone zero-width joiner is kept:
    // Malayalam and Hindi text use it inside words.
    .replace(
      /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Emoji_Modifier}|️|⃣|‍(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*|\p{Emoji_Modifier}/gu,
      "",
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// End of a sentence: . ! ? or the Devanagari danda, plus closing quotes/brackets, followed by whitespace.
// Waiting for the whitespace avoids cutting "3.5" while the stream is still arriving.
const SENTENCE_END = /[.!?।॥]+["'”’)\]]*(?=\s)|\n+/;

function nextCut(buffer, maxChars) {
  const match = SENTENCE_END.exec(buffer);
  if (match) return match.index + match[0].length;
  if (buffer.length <= maxChars) return -1;
  // A long sentence with no end yet: cut at a comma, else at a space, so speech can start.
  const window = buffer.slice(0, maxChars);
  const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
  if (comma > maxChars * 0.4) return comma + 1;
  const space = window.lastIndexOf(" ");
  return space > 0 ? space : maxChars;
}

/**
 * Splits streamed text into speakable sentences.
 * push() as text arrives; flush() at the end to emit the remainder.
 */
export function createSentenceChunker(onSentence, { maxChars = 200 } = {}) {
  let buffer = "";
  const emit = (piece) => {
    const sentence = piece.trim();
    if (sentence) onSentence(sentence);
  };
  return {
    push(text) {
      buffer += text;
      let cut;
      while ((cut = nextCut(buffer, maxChars)) > 0) {
        emit(buffer.slice(0, cut));
        buffer = buffer.slice(cut);
      }
    },
    flush() {
      emit(buffer);
      buffer = "";
    },
  };
}
