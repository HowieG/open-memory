/**
 * Curated emoji set for the identity portrait.
 *
 * Why curated, not free-form: an LLM left to emit any emoji produces a moving
 * target, and abstract keywords ("AI strategy consulting") collapse to a generic
 * dot. We constrain the model to THIS allowlist (passed in the prompt + validated
 * on the way back) and keep a deterministic keyword→emoji map so the offline
 * `stub` provider — and the tests/e2e built on it — produce a real portrait with
 * no network.
 *
 *   keyword ──mapKeywordToEmoji──► emoji ∈ CURATED_EMOJI  (else FALLBACK_EMOJI)
 */

export const FALLBACK_EMOJI = "✨";

/** Ordered keyword→emoji rules. First substring hit wins. Lowercased compare.
 *  Keep emojis here a subset of CURATED_EMOJI (asserted in tests). */
const KEYWORD_RULES: Array<[string[], string]> = [
  [["motorcycle", "motorbike", "moto "], "🏍️"],
  [["bike", "cycling", "bicycle"], "🚲"],
  [["car", "driving", "automotive", "engine"], "🚗"],
  [["run", "running", "marathon", "jog"], "🏃"],
  [["climb", "bouldering", "hiking", "hike", "mountain"], "🧗"],
  [["surf", "ocean", "beach", "sailing", "boat"], "🌊"],
  [["ski", "snowboard", "snow"], "🎿"],
  [["gym", "lifting", "workout", "fitness", "strength"], "🏋️"],
  [["yoga", "meditation", "mindfulness", "zen"], "🧘"],
  [["guitar", "music", "song", "band", "piano", "singing"], "🎸"],
  [["paint", "drawing", "art", "sketch", "illustration"], "🎨"],
  [["photo", "photography", "camera"], "📷"],
  [["write", "writing", "novel", "essay", "blog", "author"], "✍️"],
  [["read", "reading", "book", "literature"], "📚"],
  [["cook", "cooking", "recipe", "baking", "kitchen"], "🍳"],
  [["coffee", "espresso", "barista"], "☕"],
  [["wine", "beer", "whiskey", "cocktail", "brewing"], "🍷"],
  [["garden", "plant", "gardening", "succulent"], "🪴"],
  [["dog", "puppy"], "🐕"],
  [["cat", "kitten"], "🐈"],
  [["travel", "trip", "flight", "vacation", "backpacking"], "✈️"],
  [["code", "coding", "programming", "software", "developer", "engineer", "python", "javascript", "typescript", "rust", "react", "golang"], "💻"],
  [["ai", "machine learning", "llm", "model", "neural"], "🤖"],
  [["data", "analytics", "statistics", "dashboard"], "📊"],
  [["startup", "founder", "entrepreneur", "company", "business"], "🚀"],
  [["invest", "stock", "finance", "trading", "crypto", "money"], "📈"],
  [["consult", "strategy", "advisory"], "🧭"],
  [["design", "ux", "ui", "product design"], "🎯"],
  [["science", "research", "physics", "chemistry", "biology"], "🔬"],
  [["space", "astronomy", "rocket", "nasa"], "🛰️"],
  [["math", "mathematics", "algebra", "geometry"], "➗"],
  [["history", "philosophy", "politics"], "🏛️"],
  [["language", "spanish", "french", "japanese", "linguistics"], "🗣️"],
  [["health", "doctor", "medical", "therapy", "wellness"], "🩺"],
  [["family", "kids", "parenting", "children", "baby"], "👨‍👩‍👧"],
  [["home", "house", "renovation", "diy", "woodworking"], "🛠️"],
  [["game", "gaming", "video game", "chess", "board game"], "🎮"],
  [["film", "movie", "cinema", "tv", "series"], "🎬"],
  [["food", "restaurant", "foodie", "dining"], "🍜"],
  [["fashion", "style", "clothing", "sneaker"], "👟"],
  [["religion", "faith", "spiritual", "buddhism", "christian"], "🕊️"],
  [["nature", "wildlife", "bird", "camping", "outdoors"], "🏕️"],
  [["love", "relationship", "dating", "marriage"], "❤️"],
];

/** Extra emoji the model may choose beyond the keyword-rule set — broad coverage
 *  across hobbies, work, places, food, animals, and life so an identity signal
 *  rarely falls back to ✨. Tasteful subset (no faces/flags that read oddly). */
const EXTRA_EMOJI: string[] = [
  // sport & outdoors
  "⚽", "🏀", "🎾", "🏈", "⚾", "🥊", "🏆", "🎣", "🛹", "🏄", "🚴", "🏊", "⛷️", "🏂", "🤿", "🥾", "⛺", "🎯", "🏇", "🧘‍♂️",
  // music & creative
  "🎹", "🥁", "🎺", "🎷", "🎻", "🎤", "🎧", "🎮", "🎲", "♟️", "🃏", "🎭", "🎟️", "🖌️", "🪕", "📝", "🖊️",
  // tech & work
  "📱", "⌨️", "🖥️", "🧠", "🔧", "⚙️", "🔭", "🧪", "🧬", "💡", "📡", "🛰️", "💸", "🏦", "💳", "📉", "⚖️", "🧮", "🔐",
  // places & travel
  "🌍", "🗺️", "🚆", "🛳️", "🏔️", "🏝️", "🏜️", "🌋", "🗽", "🏰", "⛩️", "🕌", "⛪", "🎡", "🚀", "🏙️", "🛶",
  // food & drink
  "🍷", "🍺", "🥃", "🍣", "🍕", "🍔", "🌮", "🥗", "🍰", "🧁", "🥐", "🍫", "🌶️", "🧀", "🍎", "🫖", "🍵",
  // animals & nature
  "🐦", "🦋", "🐢", "🐠", "🦊", "🐻", "🐼", "🦁", "🐧", "🐙", "🦕", "🌲", "🌵", "🍄", "🌸", "🔥", "🌙", "⭐", "🌊", "🪸",
  // life & body
  "❤️", "🧗", "🕺", "💃", "🎓", "🏡", "🔑", "👟", "🎒", "🧳", "🪙", "🩹", "🦷", "💪", "🧴", "🧵",
];

/** The allowlist the model may choose from (and we validate against). */
export const CURATED_EMOJI: string[] = [
  ...new Set([...KEYWORD_RULES.map(([, e]) => e), ...EXTRA_EMOJI]),
  FALLBACK_EMOJI,
];

const ALLOWED = new Set(CURATED_EMOJI);

export function isAllowedEmoji(emoji: string): boolean {
  return ALLOWED.has(emoji);
}

/** Deterministic keyword→emoji, matched on WHOLE WORDS (not substrings — so
 *  "identifi*cat*ion" never matches "cat", "r*ai*n" never matches "ai"). Used by
 *  the offline stub and as a last-resort fallback. Multi-word needles match as a
 *  phrase. */
export function mapKeywordToEmoji(keyword: string): string {
  const k = keyword.toLowerCase();
  const words = new Set(k.split(/[^a-z0-9+#]+/).filter(Boolean));
  for (const [needles, emoji] of KEYWORD_RULES) {
    for (const n of needles) {
      if (n.includes(" ") ? k.includes(n) : words.has(n)) return emoji;
    }
  }
  return FALLBACK_EMOJI;
}

/** Coerce a model-supplied emoji to the curated set: trust it if it's in the
 *  allowlist (the model picked it for THIS keyword), otherwise fall back to the
 *  neutral ✨ — never to an accidental word-match, which reads as random. */
export function coerceEmoji(emoji: string | undefined, _keyword?: string): string {
  return emoji && isAllowedEmoji(emoji) ? emoji : FALLBACK_EMOJI;
}
