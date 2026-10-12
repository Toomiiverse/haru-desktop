/** Fixed before measurement; baseline and candidate use these exact turns. */
export const visibleReplyCases = [
  ['greeting', 'Hey Haru!'], ['greeting', 'Good morning Haru.'], ['greeting', 'Hello there.'],
  ['thanks', 'Thanks!'], ['thanks', 'Thank you.'], ['thanks', 'Thanks a lot.'],
  ['feeling', "I'm feeling tired today."], ['feeling', "I've had a rough day."],
  ['feeling', 'I feel really lonely tonight.'], ['feeling', "I'm excited!"],
  ['feeling', "I'm bored."], ['feeling', 'I need a hug.'],
  ['observation', 'This coffee tastes really good.'], ['observation', "It's a lovely evening here."],
  ['observation', "I'm taking a break."], ['observation', 'I had a nice walk.'], ['observation', 'Work today was hectic.'],
  ['preference', 'I prefer quiet conversation without unasked advice.'], ['preference', 'Please keep your replies brief.'],
  ['preference', "Please don't use pet names."], ['preference', 'I enjoy lively conversations.'],
  ['play', 'Tell me a joke.'], ['play', 'Tell me a silly joke.'], ['play', 'Tell me a dark joke.'],
  ['play', 'Roast me!'], ['play', 'Surprise me!'],
  ['correction', "I'm excited, not angry."], ['correction', 'Actually, I prefer shorter replies now.'],
  ['tone', 'Speak softer.'], ['tone', 'Please be less formal.'],
] as const;
