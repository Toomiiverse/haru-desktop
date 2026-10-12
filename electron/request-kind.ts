/** Recall asks for existing information; timed reminders still require an action receipt. */
export function recallRequest(text:string):boolean {
  return /\bremind me (?:of|what|which|who|how|where|why)\b/i.test(text)
    && !/\b(?:tomorrow|tonight|later|next (?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in (?:\d+|a|an|one|two|three|four|five|ten) (?:seconds?|minutes?|hours?|days?|weeks?)|at (?:\d+(?::\d+)?(?:\s*(?:am|pm))?|noon|midnight)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+))\b/i.test(text);
}
