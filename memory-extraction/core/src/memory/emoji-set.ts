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
  [["code", "coding", "programming", "software", "developer", "engineer"], "💻"],
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

/** The allowlist the model may choose from (and we validate against). */
export const CURATED_EMOJI: string[] = [
  ...new Set(KEYWORD_RULES.map(([, e]) => e)),
  FALLBACK_EMOJI,
];

const ALLOWED = new Set(CURATED_EMOJI);

export function isAllowedEmoji(emoji: string): boolean {
  return ALLOWED.has(emoji);
}

/** Deterministic keyword→emoji. Used by the stub provider and as the fallback
 *  when a model returns an emoji outside the curated set. */
export function mapKeywordToEmoji(keyword: string): string {
  const k = keyword.toLowerCase();
  for (const [needles, emoji] of KEYWORD_RULES) {
    if (needles.some((n) => k.includes(n))) return emoji;
  }
  return FALLBACK_EMOJI;
}

/** Coerce a model-supplied emoji to the curated set: keep it if allowed,
 *  otherwise derive one from the keyword. Never returns an off-set emoji. */
export function coerceEmoji(emoji: string | undefined, keyword: string): string {
  if (emoji && isAllowedEmoji(emoji)) return emoji;
  return mapKeywordToEmoji(keyword);
}
