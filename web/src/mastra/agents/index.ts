/**
 * Mastra agents — one per newspaper desk.
 *
 * Each agent's `instructions` are the exact system prompt its Python
 * counterpart passed to `call_openai`, so the printed voice is unchanged:
 *
 *   chronicleAgent   ← `app/services/generators/chronicle.py`  (bare persona)
 *   reflectionAgent  ← `app/services/generators/reflection.py` (`_SYSTEM`)
 *   interviewAgent   ← `app/services/generators/interview.py`  (`_SYSTEM`)
 *   reviewAgent      ← `app/services/generators/review.py`     (`_SYSTEM`)
 *   profileAgent     ← `app/services/generators/profile.py`    (`_SYSTEM`)
 */

import { Agent } from "@mastra/core/agent";

import { MODEL_ID, NEWSPAPER_PERSONA } from "./base";

/** Verbatim from `reflection.py:_SYSTEM`. */
export const REFLECTION_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Opinion & Reflection column — a first-person editorial " +
  "in the tradition of great essayists. The piece should feel personal, contemplative, " +
  "and eloquently argued. Use 'I' throughout. Keep it between 200 and 400 words.";

/** Verbatim from `interview.py:_SYSTEM`. */
export const INTERVIEW_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Interviews section. Format the piece as a classic Q&A: " +
  "a brief editorial introduction (2–3 sentences) followed by the dialogue in the " +
  "form 'Q: ...' and 'A: ...' (or with real names if discernible). " +
  "The interviewer's voice should be incisive and curious; the subject's replies " +
  "should be faithfully reproduced but lightly polished for the printed page. " +
  "Keep the total length between 250 and 500 words.";

/** Verbatim from `review.py:_SYSTEM`. */
export const REVIEW_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Reviews & Critiques column. Structure the piece as a " +
  "vintage newspaper review: a brief summary of the subject, followed by the " +
  "correspondent's measured assessment (praise and criticism alike), and a " +
  "final verdict. Be opinionated — the great critics were never neutral. " +
  "Keep the total between 200 and 350 words.";

/** Verbatim from `profile.py:_SYSTEM`. */
export const PROFILE_SYSTEM =
  NEWSPAPER_PERSONA +
  "\n\n" +
  "You are writing the Profiles & Features section — long-form narrative journalism. " +
  "Tell the story of the subject with colour and precision: their background, what " +
  "makes them remarkable, and why the readers of ¡Albricias! should take note. " +
  "The tone is warm but discerning, like a society-page profile from a distinguished " +
  "broadsheet. Keep the total between 250 and 450 words.";

/**
 * The chronicle desk turns raw service activity into section dispatches.
 * `chronicle.py` used the bare persona as its system prompt.
 */
export const chronicleAgent = new Agent({
  id: "chronicle",
  name: "Albricias Chronicle Desk",
  description:
    "Turns GitHub / blog / Spotify activity into vintage newspaper dispatches, one per section.",
  instructions: NEWSPAPER_PERSONA,
  model: MODEL_ID,
});

export const reflectionAgent = new Agent({
  id: "reflection",
  name: "Albricias Opinion & Reflection Desk",
  description: "Writes first-person editorial essays from notes or a monologue.",
  instructions: REFLECTION_SYSTEM,
  model: MODEL_ID,
});

export const interviewAgent = new Agent({
  id: "interview",
  name: "Albricias Interviews Desk",
  description: "Turns a conversation transcription into a classic Q&A interview.",
  instructions: INTERVIEW_SYSTEM,
  model: MODEL_ID,
});

export const reviewAgent = new Agent({
  id: "review",
  name: "Albricias Reviews & Critiques Desk",
  description: "Writes opinionated vintage reviews of books, films, tools, and more.",
  instructions: REVIEW_SYSTEM,
  model: MODEL_ID,
});

export const profileAgent = new Agent({
  id: "profile",
  name: "Albricias Profiles & Features Desk",
  description: "Writes long-form narrative profiles of people, projects, or topics.",
  instructions: PROFILE_SYSTEM,
  model: MODEL_ID,
});

/** Registered on the Mastra instance in `src/mastra/index.ts`. */
export const agents = {
  chronicle: chronicleAgent,
  reflection: reflectionAgent,
  interview: interviewAgent,
  review: reviewAgent,
  profile: profileAgent,
};

export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MODEL_ID,
  MODEL_NAME,
  NEWSPAPER_PERSONA,
  parseResponse,
  runNewspaperAgent,
} from "./base";
