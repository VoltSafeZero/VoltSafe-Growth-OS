export interface IntentModifier {
  id: string;
  label: string;
  category: string;
  instruction: string;
}

export const INTENT_MODIFIERS: IntentModifier[] = [
  {
    id: "advance_decision",
    label: "Advance Decision",
    category: "Strategic Intent",
    instruction: "Move the recipient toward a clear decision or next step without sounding aggressive.",
  },
  {
    id: "reduce_friction",
    label: "Reduce Friction",
    category: "Strategic Intent",
    instruction: "Make the next step feel easy, specific, and low commitment.",
  },
  {
    id: "create_urgency",
    label: "Create Urgency",
    category: "Strategic Intent",
    instruction: "Highlight timing, risk of delay, or opportunity cost without fake pressure or hype.",
  },
  {
    id: "build_trust",
    label: "Build Trust",
    category: "Relationship Intent",
    instruction: "Prioritize credibility, transparency, proof, and confidence without overexplaining.",
  },
  {
    id: "executive_level",
    label: "Executive-Level",
    category: "Leadership Intent",
    instruction: "Keep the message concise, strategic, outcome-focused, and respectful of the recipient's time.",
  },
  {
    id: "founder_to_founder",
    label: "Founder-to-Founder",
    category: "Leadership Intent",
    instruction: "Make the email candid, practical, entrepreneurial, and human without becoming casual or sloppy.",
  },
  {
    id: "emphasize_roi",
    label: "Emphasize ROI",
    category: "Persuasion Intent",
    instruction: "Connect the message to measurable business value, savings, revenue, efficiency, or risk reduction.",
  },
  {
    id: "emphasize_risk",
    label: "Emphasize Risk",
    category: "Persuasion Intent",
    instruction: "Clearly explain the downside of inaction or current-state risk without fearmongering.",
  },
  {
    id: "concise",
    label: "Concise",
    category: "Communication Style",
    instruction: "Make the email shorter, tighter, and easier to scan while preserving necessary context.",
  },
  {
    id: "ask_for_meeting",
    label: "Ask For Meeting",
    category: "Follow-Up Intent",
    instruction: "End with a clear, simple meeting request or scheduling next step.",
  },
];

export const INTENT_MODIFIER_MAP = new Map<string, IntentModifier>(
  INTENT_MODIFIERS.map(m => [m.id, m])
);

export const MAX_INTENT_MODIFIERS = 5;

export function resolveIntentModifiers(ids: string[]): IntentModifier[] {
  return ids
    .slice(0, MAX_INTENT_MODIFIERS)
    .map(id => INTENT_MODIFIER_MAP.get(id))
    .filter((m): m is IntentModifier => m !== undefined);
}

export function buildIntentModifierPromptBlock(modifiers: IntentModifier[]): string {
  if (!modifiers.length) return "";
  return [
    `=== INTENT MODIFIERS — apply these on top of the voice profile; do not override it ===`,
    ...modifiers.map(m => `- ${m.label}: ${m.instruction}`),
    `IMPORTANT: These modifiers steer intent only. The saved voice profile remains the primary writing style.`,
  ].join("\n");
}

export type IntentModifierCategory = string;

export function groupModifiersByCategory(
  modifiers: IntentModifier[]
): Record<string, IntentModifier[]> {
  return modifiers.reduce<Record<string, IntentModifier[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});
}
