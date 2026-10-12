export const LOCATIONS = [
  { id: 'home', name: 'Your little home', label:'Your home', description: 'A quiet place to recharge and make your own.', owner:'player', indoors:true },
  { id: 'cafe', name: 'Sunbeam Café', label:'Café', description: 'Good coffee, familiar faces, and your next shift.', indoors:true },
  { id: 'studio', name: 'The Makers’ Studio', label:'Studio', description: 'Make something messy, beautiful, or both.', indoors:true },
  { id: 'park', name: 'Willow Park', label:'Park', description: 'Winding paths, a community garden, and room to breathe.', indoors:false },
  { id: 'library', name: 'Little Leaf Library', label:'Library', description: 'Big ideas live behind this little green door.', indoors:true },
  { id: 'market', name: 'Sunday Market', label:'Market', description: 'Fresh flowers, secondhand treasures, and neighborhood gossip.', indoors:true },
  ...[
    ['lina','Lina’s atelier house','Creative · An airy painting studio opens onto a quiet sleeping wing. Her coral-roofed house has a colorful flower garden.'],
    ['theo','Theo’s breakfast cottage','Outgoing · A generous kitchen and breakfast lounge take center stage in this warm, red-roofed cottage.'],
    ['maya','Maya’s garden cottage','Kind · A small green-roofed cottage with a leafy potting room, plant-lined living space, and peaceful sleeping nook.'],
    ['felix','Felix’s bookish townhouse','Curious · A blue-roofed townhouse organized around a private library, study desk, and a tucked-away bedroom.'],
    ['jules','Jules’s workshop house','Ambitious · A narrow red-roofed house with a busy fabrication room, organized stockroom, and a compact sleeping retreat.'],
    ['bea','Bea’s storybook bungalow','Thoughtful · A broad green roof shelters a reading parlor, keepsake room, warm tea corner, and a comfortable bedroom.'],
  ].map(([owner,name,description]) => ({id:`home-${owner}`,name,label:`${owner[0].toUpperCase()+owner.slice(1)}’s`,description,owner,indoors:true})),
];

export const homeFor = id => id === 'player' || id === 'haru' ? 'home' : `home-${id}`;
export function canAccess(characterId, locationId) {
  const place = LOCATIONS.find(location => location.id === locationId);
  return Boolean(place && (!place.owner || place.owner === characterId || characterId === 'haru' && locationId === 'home'));
}
// Version-1 saves used the player's home as every NPC's resting place. Only normalize after validation.
export function migrateHomes(state) {
  for (const npc of state.npcs) if (npc.location === 'home') npc.location = homeFor(npc.id);
  return state;
}

export const ACTIONS = [
  { id: 'work', label: 'Work a shift', description: 'Earn money and grow your career.', location: 'cafe', hours: 4, cost: 0, icon: 'briefcase' },
  { id: 'study', label: 'Learn something', description: '+8 skill · invest in your next chapter.', location: 'library', hours: 2, cost: 10, icon: 'book' },
  { id: 'rest', label: 'Take a breather', description: 'Restore energy in your own little sanctuary.', location: 'home', hours: 6, cost: 0, icon: 'moon' },
  { id: 'eat', label: 'Grab a bite', description: 'A warm meal and a little comfort.', location: 'cafe', hours: 1, cost: 14, icon: 'cup' },
  { id: 'exercise', label: 'Go for a walk', description: 'Fresh air is good for body and mind.', location: 'park', hours: 2, cost: 0, icon: 'leaf' },
  { id: 'create', label: 'Make something', description: '+5 skill · find your creative spark.', location: 'studio', hours: 2, cost: 12, icon: 'palette' },
  { id: 'socialize', label: 'Meet a neighbor', description: 'Build a friendship, one conversation at a time.', location: 'market', hours: 2, cost: 0, icon: 'heart' },
];

// ponytail: one authored vignette per resident; add quest flags only when stories need persistent chapters.
export const STORIES = {
  lina: {
    title: 'The colours between us',
    cutscene: {
      title: 'A window still unpainted', location: 'studio',
      alt: 'Lina pauses at her easel with a paintbrush, turning from a painting of Willowbrook in her sunlit studio.',
      beats: [
        {narration:true,text:'Lina shows you the moment behind the sketch: a brush hovering over an unfinished window, waiting for a reason to let the light in.'},
        {text:'I kept painting the buildings exactly right. But the part I wanted to keep was how it felt when somebody opened the door.'},
      ],
    },
    narration: 'A loose sketch slips from Lina’s notebook. Beneath the ink, the familiar neighborhood looks almost enchanted.',
    opening: 'You weren’t supposed to see that yet! It’s for the art show. I can draw every window in town… but I still can’t decide what this place means to me.',
    choices: [
      {label:'Maybe home is the people in it.',reply:'The people… yes. Not perfect buildings. The light Theo leaves on, Maya’s muddy hands… and you, stopping to look. I think I know what to draw now.',affinity:3},
      {label:'Show me your favourite sketch.',reply:'This one. The library at dusk. All those ordinary windows, and every one hiding a different story. Yours should be in here too.',affinity:2},
      {label:'It feels a little too dramatic.',reply:'Oh. I suppose I did get carried away. I’ll keep working on it… but I’d rather paint what I feel than make it look like a postcard.',affinity:-2},
    ],
  },
  theo: {
    title: 'One light left on',
    cutscene: {
      title: 'The last warm seat', location: 'cafe',
      alt: 'Theo sets a steaming cup beside an empty window seat in the warmly lit café, with the evening street outside.',
      beats: [
        {narration:true,text:'In the Sunbeam Theo imagines, the street has turned blue and the kettle is still warm. A ribbon-tied key rests beside one last empty chair.'},
        {text:'No grand opening. No perfect speech. Just a cup on the table and enough light for somebody to find their way in.'},
      ],
    },
    narration: 'Theo turns a small brass key between his fingers. The café’s crimson ribbon is tied around its ring.',
    opening: 'I’ve been thinking about keeping Sunbeam open late. Somewhere to go when you aren’t quite ready to be alone. Too sentimental for a business plan?',
    choices: [
      {label:'Save a seat for me.',reply:'The window seat, then. No reservation needed. Funny… this idea felt enormous a minute ago. Now it just feels like putting the kettle on for a friend.',affinity:3},
      {label:'What would your first evening be like?',reply:'Quiet music. Something warm. Maybe Lina drawing in a corner and Felix arguing with a book. A place where nobody has to earn their welcome.',affinity:2},
      {label:'You can’t look after everyone.',reply:'I know. I’m learning where the line is. But keeping one light on? I think I can manage that much.',affinity:-1},
    ],
  },
  maya: {
    title: 'Where moonflowers grow',
    cutscene: {
      title: 'The hour of moonflowers', location: 'park',
      alt: 'Maya kneels in the twilight garden, gently supporting a white moonflower with a seed packet in her other hand.',
      beats: [
        {narration:true,text:'Maya pictures the garden after dusk. One white moonflower opens beside the path, bright as a little lantern for anyone coming home late.'},
        {text:'I want someone to stop here after a hard day and think: oh, something was waiting for me. Even if it is only a flower.'},
      ],
    },
    narration: 'Maya opens her palm. A paper packet of seeds rests there, marked with a tiny silver crescent.',
    opening: 'Moonflowers. They wait until evening to open. I want a whole corner of the community garden full of them. Something beautiful for the people who missed the daylight.',
    choices: [
      {label:'Every garden needs a little magic.',reply:'Exactly! Not the grand, impossible kind. Just something alive, waiting for you at the end of a difficult day. You understand what I’m trying to grow.',affinity:3},
      {label:'Why did you choose these flowers?',reply:'I used to think blooming late meant you’d fallen behind. These flowers reminded me that some things are simply waiting for their own hour.',affinity:2},
      {label:'Wouldn’t vegetables be more useful?',reply:'We’ll grow those too. But useful doesn’t always mean something you can put on a plate. Sometimes it means having a reason to come outside.',affinity:-1},
    ],
  },
  felix: {
    title: 'A note in the margins',
    cutscene: {
      title: 'Between the pages', location: 'library',
      alt: 'Felix lifts a wing-sealed note from an open book at a library table beneath a warm reading lamp.',
      beats: [
        {narration:true,text:'Felix recalls the discovery: a folded note slipping from an old book into the warm circle of a reading lamp. For a moment, the whole library seemed to hold its breath.'},
        {text:'Someone trusted these pages with a tiny piece of their life. I would like our first meeting to make room for stories like that.'},
      ],
    },
    narration: 'A folded note peeks from Felix’s book. Its ink has faded, but a small wing-shaped seal is still visible.',
    opening: 'Listen to this: “Meet me where the last bell echoes.” Someone left it in a book years ago. I was choosing our first book-club read, and now I’m caught up in someone else’s story.',
    choices: [
      {label:'Then let’s give the story an audience.',reply:'Read it aloud at the first meeting? I like that. We could each invent an ending. Maybe that’s how a book club starts: one mystery, and people willing to listen.',affinity:3},
      {label:'Do you think they ever met?',reply:'I hope so. There’s no second note, but that isn’t proof of a sad ending. Sometimes the rest of a story happens outside the pages.',affinity:2},
      {label:'It’s probably just an old bookmark.',reply:'Possibly. Though I’d argue that the most ordinary objects make the best doorways. I’ll keep wondering, if you don’t mind.',affinity:-1},
    ],
  },
  jules: {
    title: 'A thread of crimson',
    cutscene: {
      title: 'Made in my own name', location: 'market',
      alt: 'Jules displays a handmade crimson ribbon with a two-wing crest across their sunlit craft stall.',
      beats: [
        {narration:true,text:'Jules imagines the stall on its first morning: scissors put away, the awning lifted, and a crimson ribbon stretched between hands that are trying not to shake.'},
        {text:'I could hide every uneven stitch. Or I could let people see that a person made this. I am trying to be brave enough for the second one.'},
      ],
    },
    narration: 'Jules catches a red ribbon before it escapes on the breeze. A half-finished crest is stitched into its edge.',
    opening: 'First collection for my own stall. A little academy elegance, a little midnight mischief. Be honest: does this look like someone who knows what they’re doing?',
    choices: [
      {label:'It looks unmistakably like you.',reply:'That… is better than looking expensive. I’ve spent so long trying to look established that I nearly forgot why I wanted a stall of my own.',affinity:3},
      {label:'Tell me about the crest.',reply:'Two wings, pointing in different directions. A reminder that you can belong somewhere and still want to leave the nest. I stitched the first version on my kitchen floor.',affinity:2},
      {label:'You might be trying too hard.',reply:'Maybe. But I’d rather make something with a point of view than disappear into the crowd. I’ll keep refining it.',affinity:-2},
    ],
  },
  bea: {
    title: 'After the last bell',
    cutscene: {
      title: 'A page left open', location: 'park',
      alt: 'Bea sits beneath cherry blossoms, lifting a petal from the open notebook on her lap and looking up with patient warmth.',
      beats: [
        {narration:true,text:'Bea remembers a quiet afternoon on the park bench. A petal landed on a blank notebook page, where she had once planned to write a very sensible list of answers.'},
        {text:'I left it blank. After all those years of teaching, I am learning that a question can be a kindness too.'},
      ],
    },
    narration: 'Bea brushes a fallen petal from an old notebook. Gold lettering on the cover has almost worn away.',
    opening: 'I used to ask my students what they wanted to become. Now I wonder if the better question was: who makes you feel most like yourself? What would you have said?',
    choices: [
      {label:'Someone who listens, like you.',reply:'Then perhaps I did learn something in all those years. Thank you. Listening doesn’t look like much, but it can change the direction of an entire life.',affinity:3},
      {label:'I’m still figuring that out.',reply:'Good. There is no bell that rings when you’re supposed to have all the answers. Leave a little room in your life to surprise yourself.',affinity:2},
      {label:'I’d rather work it out on my own.',reply:'Of course. Advice should be an open door, not a hand on your shoulder. I’ll be here if you ever want a second opinion.',affinity:0},
    ],
  },
};

// Activity-specific openings are local authored dialogue; cutscenes are currently disabled.
export const ACTIVITY_DIALOGUE = [
  {id:'lina-studio',npcId:'lina',location:'studio',action:'Working on a painting',
    opening:'Oh, hello! I am working on the art-show painting. This window keeps coming out too perfect; I want it to look lived in.'},
  {id:'lina-park',npcId:'lina',location:'park',action:'Painting by the pond',
    opening:'You caught me painting the pond! Every time I mix the right green, the light changes. Would you keep me company while I chase it?'},
  {id:'theo-cafe',npcId:'theo',location:'cafe',action:'Hosting the café crowd',
    opening:'Perfect timing! I am looking after the café crowd. There is a warm cup coming up, and I have kept the window seat clear.'},
  {id:'maya-park',npcId:'maya',location:'park',action:'Tending the garden',
    opening:'Watch your step—new seedlings! I am tending the garden. These little moonflowers need patience more than anything I can pour from a watering can.'},
  {id:'felix-library',npcId:'felix',location:'library',action:'Planning the book club',
    opening:'I am choosing our next book-club read. I meant to compare opening chapters, but this mysterious note has rather stolen the discussion.'},
  {id:'jules-market',npcId:'jules',location:'market',action:'Building a market stall',
    opening:'Mind the ribbon! I am putting my stall together. I have rearranged this display three times, and it is finally beginning to feel like mine.'},
  {id:'bea-park',npcId:'bea',location:'park',action:'Offering a little guidance',
    opening:'Come sit a moment. I am jotting down a little advice, though I keep crossing out anything that sounds too certain. What is on your mind?'},
];

const GREETINGS = {
  lina:{walk:'I am on my way to {place}. Keep talking—I am trying to remember the colors of these rooftops.',home:'You caught me taking a quiet break at home. Even my sketchbooks are closed for once. Well… almost all of them.',eat:'I am having a bite before I pick up my brushes again. The colors on this plate are giving me ideas.',social:'I came looking for company. My paintings do not talk back, and I have spent quite enough time arguing with them today.',idle:'I am taking in the view for a moment. There is a painting hiding in this ordinary little day.',followup:'I notice different things when someone stops to look with me. What caught your eye today?'},
  theo:{walk:'Heading to {place}! I promised myself I would stop making plans long enough to enjoy the walk. How is your day going?',home:'A quiet moment in my own breakfast nook. I am resting, which apparently means resisting the urge to put another kettle on.',eat:'Finally sitting down for a bite myself! Looking after everyone else is easier when I remember lunch.',social:'I came out to find a few friendly faces. Even a café owner likes being the guest sometimes.',idle:'I am enjoying a little pause between things. It is nice to say hello without a stack of cups in my hands.',followup:'Tell me what has been happening with you. No rush—I am listening.'},
  maya:{walk:'I am walking over to {place}. I keep stopping to check the plants along the path. Occupational hazard, I suppose.',home:'I am resting at home with the plants. They are very good at reminding me that being still is not the same as doing nothing.',eat:'A little food for the gardener this time. I remembered to water everything before feeding myself again.',social:'I wanted some company, so here I am. A garden can be wonderfully quiet, but sometimes I want a voice beside mine.',idle:'I am taking a small breather and watching things grow. There is always something new if you slow down enough.',followup:'How are you growing into life here? There is no timetable you have to keep.'},
  felix:{walk:'On my way to {place}. I put the book away so I would stop nearly walking into things. A conversation seems safer.',home:'I am having a quiet rest at home. That stack of books is not work; it is a rather ambitious bedside arrangement.',eat:'I am having a bite, with the book firmly closed. The librarian is attempting a lunch break without footnotes.',social:'I came looking for someone to talk to. I have had an excellent argument with a book, but it offered no rebuttal.',idle:'I am letting my thoughts wander for a moment. It is remarkable how many questions an uneventful morning can produce.',followup:'What has made you curious lately? I would love to hear your version of the story.'},
  jules:{walk:'I am heading to {place}. If I say the next three tasks aloud, would you remind me that walking is not a planning meeting?',home:'Taking a break at home. The workshop is staying closed for a bit, even if that unfinished piece keeps calling my name.',eat:'A proper food break. I am trying to build a business, not prove I can live on determination alone.',social:'I came out to find some company. I need to talk about something that is not stock counts or display shelves.',idle:'I am catching my breath and letting the next idea find me. Trying, at least. I am not very practiced at standing still.',followup:'What would you make if you did not have to get it perfect on the first try?'},
  bea:{walk:'I am making my way to {place}. Slowly, because I rather like the journey. You are welcome to walk a little of it with me.',home:'A restful moment at home, with tea and a familiar chair. Retirement has taught me to stop apologizing for these little pauses.',eat:'I am enjoying a bite. I used to rush lunch between lessons; now I try to give a meal the attention it deserves.',social:'I came looking for a little conversation. Having time to listen is one of the nicest parts of this chapter of my life.',idle:'I am enjoying a quiet moment. Not every blank page needs filling straight away, you know.',followup:'Tell me something about your day—not the impressive version, just the one that felt like yours.'},
};

export function encounterFor(npc, setting, travelling = false) {
  const voice = GREETINGS[npc.id];
  const arrived = !travelling && npc.location === setting.location && Boolean(LOCATIONS.find(p => p.id === setting.location)?.indoors) === setting.inside;
  const activityLine = arrived ? ACTIVITY_DIALOGUE.find(s => s.npcId === npc.id && s.location === setting.location && s.action === npc.action) : undefined;
  const kind = travelling ? 'walk' : arrived && npc.location === homeFor(npc.id) ? 'home' : arrived && npc.action === 'Having a bite' ? 'eat' : arrived && (npc.action === 'Looking for company' || npc.action.startsWith('Spending time with ')) ? 'social' : 'idle';
  const destination = LOCATIONS.find(p => p.id === npc.location)?.name || 'my next stop';
  const opening = activityLine?.opening || voice[kind].replace('{place}',destination);
  return {activity:travelling ? `Walking to ${destination}` : arrived ? npc.action : 'Taking a moment outdoors',
    lines:[{text:opening,expression:'neutral',speaker:npc.name},{text:voice.followup,expression:'happy',speaker:npc.name}]};
}

export function replyExpression(text) {
  // ponytail: local tone cues only; no additional paid call or model-controlled game actions.
  if (/\b(sorry|worried|worry|difficult|sad|uncertain|unsure|hurt|upset|afraid|angry)\b/i.test(text)) return 'thoughtful';
  if (/\b(wow|surprised|surprising|unexpected|unbelievable|amazing)\b/i.test(text)) return 'surprised';
  return 'happy';
}

const NPCS = [
  ['lina', 'Lina Park', 'she/her', 'Illustrator', 'Creative', 'Hold a neighborhood art show', '#D5A05C', 'studio'],
  ['theo', 'Theo Brooks', 'he/him', 'Café owner', 'Outgoing', 'Make the café a place for everyone', '#7FA99C', 'cafe'],
  ['maya', 'Maya Reed', 'she/her', 'Gardener', 'Kind', 'Grow a community garden', '#C98877', 'park'],
  ['felix', 'Felix Chen', 'he/him', 'Librarian', 'Curious', 'Start a neighborhood book club', '#A99ABD', 'library'],
  ['jules', 'Jules Rivera', 'they/them', 'Market maker', 'Ambitious', 'Open an independent market stall', '#7997AA', 'market'],
  ['bea', 'Bea Williams', 'she/her', 'Retired teacher', 'Thoughtful', 'Help someone find their next chapter', '#B8A062', 'park'],
];
const NEEDS = ['health', 'happiness', 'energy', 'hunger', 'social'];
const EFFECTS = [...NEEDS, 'money', 'skill', 'affinity'];
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));
const result = (ok, message) => ({ ok, message });
const blocked = state => state.ended ? 'This life is complete. Start a new story to play again.' : state.activeEvent ? 'Choose how to respond to your life event first.' : '';
const random = state => ((state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function journal(state, text, type = 'action') {
  state.journal.unshift({ day: state.day, age: state.age, text, type });
  state.journal.length = Math.min(state.journal.length, 80);
}

function remember(state, npc, text) {
  npc.memories.unshift({ day: state.day, text });
  npc.memories.length = Math.min(npc.memories.length, 8);
}

function applyEffects(state, effects, npc = null) {
  for (const key of NEEDS) state.player[key] = clamp(state.player[key] + (effects[key] || 0));
  state.player.skill = clamp(state.player.skill + (effects.skill || 0));
  state.money = clamp(state.money + (effects.money || 0), 0, 10000000);
  if (npc && effects.affinity) npc.affinity = clamp(npc.affinity + effects.affinity);
}

function event(id, kicker, title, description, choices, npcId) {
  return { id, kicker, title, description, choices: choices.map(([label, description, effects]) => ({ label, description, effects })), ...(npcId ? { npcId } : {}) };
}

function nextEvent(state, birthday = false) {
  if (birthday) {
    if (state.age >= 65) return event('golden-years', `AGE ${state.age} · A NEW CHAPTER`, 'Time is yours again.', 'Your pension covers a simple life. What deserves more of your time?', [
      ['Pass it on', 'Share what you know. +12 social, +8 happiness.', { social: 12, happiness: 8 }],
      ['Explore slowly', 'Take a restorative trip. −$180, +12 health, +15 happiness.', { money: -180, health: 12, happiness: 15 }],
      ['Enjoy the everyday', 'Quiet routines can be a lovely life. +12 energy, +6 happiness.', { energy: 12, happiness: 6 }],
    ]);
    if (state.age >= 40) return event('midlife', `AGE ${state.age} · A NEW CHAPTER`, 'What matters now?', 'Another birthday brings a chance to rethink the shape of your days.', [
      ['Invest in yourself', 'Take a course. −$160, +12 skill.', { money: -160, skill: 12, happiness: 5 }],
      ['Make time for people', 'Relationships need tending. +16 social, +8 happiness.', { social: 16, happiness: 8 }],
      ['Find a gentler pace', 'Look after your health. +12 health, +14 energy.', { health: 12, energy: 14 }],
    ]);
    return event('birthday', `AGE ${state.age} · A NEW CHAPTER`, 'A wish for the year ahead.', 'The candles are out. The next chapter is still unwritten.', [
      ['Grow my career', 'Set aside money for a course. −$120, +10 skill.', { money: -120, skill: 10 }],
      ['Find my people', 'Make more room for connection. +16 social, +10 happiness.', { social: 16, happiness: 10 }],
      ['Look after myself', 'Choose a healthier rhythm. +10 health, +16 energy.', { health: 10, energy: 16 }],
    ]);
  }
  const friend = [...state.npcs].sort((a, b) => b.affinity - a.affinity)[0];
  const events = [
    () => event('open-mic', 'A LITTLE COURAGE', 'Your name on the list?', 'Sunbeam Café is hosting an open-mic night. Theo thinks you should give it a go.', [
      ['Take the stage', 'A brave little leap. +6 skill, +12 happiness, −8 energy.', { skill: 6, happiness: 12, energy: -8 }],
      ['Cheer from the crowd', 'Sometimes showing up is enough. +12 social, +5 happiness.', { social: 12, happiness: 5 }],
    ], 'theo'),
    () => event('side-project', 'AN UNEXPECTED OPPORTUNITY', 'A little side hustle.', 'A market stall is looking for someone to design its signs. The brief is vague, but the pay is real.', [
      ['Take the commission', '+$140, +4 skill. It will take some energy.', { money: 140, skill: 4, energy: -20 }],
      ['Keep the weekend free', '+14 energy, +6 happiness.', { energy: 14, happiness: 6 }],
    ], 'jules'),
    () => event('friend-in-need', 'THE PEOPLE AROUND YOU', `${friend.name.split(' ')[0]} could use a friend.`, `${friend.name} has had a difficult week. A small gesture could mean a lot.`, [
      ['Listen over coffee', '−$18, +12 friendship, +10 social.', { money: -18, affinity: 12, social: 10 }],
      ['Go for a free walk', '+8 friendship, +6 health.', { affinity: 8, health: 6, energy: -5 }],
      ['Say you need some space', 'Protect your energy. +12 energy, −4 friendship.', { energy: 12, affinity: -4 }],
    ], friend.id),
    () => event('garden', 'PUTTING DOWN ROOTS', 'Something worth growing.', 'Maya is making room for a few new garden beds in Willow Park. Your neighborhood could use a hand.', [
      ['Help plant the beds', '+10 friendship, +10 health, −12 energy.', { affinity: 10, health: 10, energy: -12 }],
      ['Buy the seedlings', '−$45, +8 friendship, +12 happiness.', { money: -45, affinity: 8, happiness: 12 }],
      ['Stop by another day', 'Keep your plans for today. +5 energy.', { energy: 5 }],
    ], 'maya'),
    () => event('repair', 'A BUMP IN THE ROAD', 'The kitchen tap is dripping.', 'A tiny household problem is becoming harder to ignore. How will you handle it?', [
      ['Call a professional', '−$95. A quick fix and peace of mind. +5 happiness.', { money: -95, happiness: 5 }],
      ['Learn to fix it', '+8 skill, −15 energy. The library has a repair guide.', { skill: 8, energy: -15 }],
    ]),
    () => event('book-club', 'A NEW CONNECTION', 'One book, many stories.', 'Felix is starting a reading circle. You do not have to finish the book to have something to say.', [
      ['Join the circle', '+5 skill, +12 social, +8 friendship.', { skill: 5, social: 12, affinity: 8 }],
      ['Read on my own', '+8 skill, +5 happiness.', { skill: 8, happiness: 5 }],
    ], 'felix'),
    () => friend.affinity >= 45 ? event('closer', 'A RELATIONSHIP CROSSROADS', 'More than familiar faces.', `${friend.name} asks if you would like to spend more time together, just the two of you.`, [
      ['Plan a proper date', '−$40, +16 connection, +15 happiness.', { money: -40, affinity: 16, happiness: 15 }],
      ['Keep our friendship', '+8 connection, +10 social.', { affinity: 8, social: 10 }],
      ['Take a little space', '−6 connection, +8 energy.', { affinity: -6, energy: 8 }],
    ], friend.id) : event('exhibition', 'A SMALL INVITATION', 'See the world a little differently.', 'Lina has hung her newest paintings in the studio. There is one empty wall for work by her neighbors.', [
      ['Make something for the wall', '−$20, +7 skill, +10 happiness.', { money: -20, skill: 7, happiness: 10 }],
      ['Visit and encourage her', '+8 friendship, +12 social.', { affinity: 8, social: 12 }],
    ], 'lina'),
  ];
  return events[Math.floor(random(state) * events.length)]();
}

export function createGame(name = 'Alex Morgan', aspiration = 'A little of everything') {
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Alex Morgan';
  const state = {
    version: 1, seed: 829431, day: 1, hour: 9, age: 22, money: 1280,
    player: { name: cleanName, aspiration: typeof aspiration === 'string' && aspiration.trim() ? aspiration.trim().slice(0, 80) : 'A little of everything', career: 'Café assistant', skill: 18, workShifts: 0, location: 'home', health: 86, happiness: 78, energy: 82, hunger: 70, social: 66 },
    npcs: NPCS.map(([id, npcName, pronouns, career, trait, goal, color, location], index) => ({ id, name: npcName, pronouns, career, trait, goal, color, location, action: 'Enjoying the morning', thought: `A new day. One step closer to my goal: ${goal.toLowerCase()}.`, energy: 65 + index * 4, hunger: 52 + index * 5, social: 40 + index * 7, affinity: index === 1 ? 26 : 12, goalProgress: index * 8, relationships: {}, memories: [{ day: 1, text: `${cleanName} moved into the neighborhood today.` }] })),
    journal: [], activeEvent: null, actionsTaken: 0, homeLevel: 0, ended: false,
  };
  state.activeEvent = event('welcome', 'YOUR STORY STARTS HERE', 'A new place. A new possibility.', 'The last box is unpacked. Sunlight spills across the floor of your little home. What will you make room for first?', [
    ['Find my people', 'A hello can change everything. +12 social, +6 happiness.', { social: 12, happiness: 6 }],
    ['Build something of my own', 'Give your ambition a little room. +8 skill.', { skill: 8 }],
    ['Take it one day at a time', 'There is no rush to become yourself. +10 energy, +6 health.', { energy: 10, health: 6 }],
  ]);
  journal(state, `At 22, ${cleanName} moved to Elsewhere with $1,280 and a fresh start.`, 'milestone');
  return state;
}

function progressCareer(state) {
  if (state.age >= 65) return;
  const { skill, workShifts } = state.player;
  const next = skill >= 85 && workShifts >= 14 ? 'Community entrepreneur' : skill >= 60 && workShifts >= 8 ? 'Café manager' : skill >= 35 && workShifts >= 3 ? 'Café shift lead' : 'Café assistant';
  if (state.player.career !== next) {
    state.player.career = next;
    journal(state, `A new chapter at work: you became a ${next.toLowerCase()}. Your shifts now pay more.`, 'milestone');
  }
}

function npcHour(state, companion = null) {
  for (const npc of state.npcs) {
    npc.energy = clamp(npc.energy - 4);
    npc.hunger = clamp(npc.hunger - 5);
    npc.social = clamp(npc.social - 3);
    if (npc === companion) {
      npc.action = `Spending time with ${state.player.name.split(' ')[0]}`;
      continue;
    }
    const preferred = NPCS.find(row => row[0] === npc.id)[7];
    // ponytail: six residents use a small utility score; add planning only if multi-step goals become gameplay.
    const candidates = [
      { location: homeFor(npc.id), action: 'Resting at home', score: (100 - npc.energy) * 1.25 + (state.hour >= 22 || state.hour < 7 ? 40 : 0), effects: { energy: 26 }, thought: 'I need a little quiet before I can give more of myself.' },
      { location: 'cafe', action: 'Having a bite', score: (100 - npc.hunger) * 1.25, effects: { hunger: 30 }, thought: 'First, something to eat. Big plans can wait a moment.' },
      { location: 'market', action: 'Looking for company', score: (100 - npc.social) * (npc.trait === 'Outgoing' ? 1.3 : 1.05), effects: { social: 18 }, thought: 'I could really use a friendly face today.' },
      { location: preferred, action: ({ studio: 'Working on a painting', cafe: 'Hosting the café crowd', park: npc.id === 'bea' ? 'Offering a little guidance' : 'Tending the garden', library: 'Planning the book club', market: 'Building a market stall' })[preferred], score: 43 + (npc.trait === 'Ambitious' ? 14 : 0) + random(state) * 16, effects: { energy: -3, social: 3 }, thought: `A little progress today: ${npc.goal.toLowerCase()}.`, goal: true },
    ];
    if (npc.id === 'lina' && state.hour >= 8 && state.hour < 19) candidates.push({location:'park',action:'Painting by the pond',score:43+random(state)*16,effects:{energy:-3,social:3},thought:'The pond keeps changing color. I want to catch a little of that light.',goal:true});
    const selected = candidates.filter(option => canAccess(npc.id,option.location)).reduce((best, option) => option.score > best.score ? option : best);
    npc.location = selected.location;
    npc.action = selected.action;
    npc.thought = selected.thought;
    for (const [key, delta] of Object.entries(selected.effects)) npc[key] = clamp(npc[key] + delta);
    if (selected.goal) {
      npc.goalProgress += 12;
      if (npc.goalProgress >= 100) {
        npc.goalProgress = 0;
        const text = `Reached a personal milestone: ${npc.goal.toLowerCase()}.`;
        remember(state, npc, text);
        journal(state, `${npc.name}: ${text}`, 'world');
        npc.goal = npc.goal.startsWith('Share') ? NPCS.find(row => row[0] === npc.id)[5] : `Share ${npc.career.toLowerCase()} skills with the neighborhood`;
        npc.thought = 'That little dream became real. Now I want to share it.';
      }
    }
  }
  const paired = new Set(companion ? [companion.id] : []);
  for (const npc of state.npcs) {
    if (LOCATIONS.find(place => place.id === npc.location)?.owner || paired.has(npc.id)) continue;
    const other = state.npcs.find(candidate => candidate.id !== npc.id && candidate.location === npc.location && !paired.has(candidate.id));
    if (!other) continue;
    paired.add(npc.id); paired.add(other.id);
    for (const [a, b] of [[npc, other], [other, npc]]) {
      a.relationships[b.id] = clamp((a.relationships[b.id] || 0) + 4);
      a.social = clamp(a.social + 9);
      a.thought = `Talking with ${b.name.split(' ')[0]} made this day a little better.`;
      const text = `Shared a good conversation with ${b.name} at ${LOCATIONS.find(place => place.id === a.location).name}.`;
      if (!a.memories.some(memory => memory.day === state.day && memory.text === text)) remember(state, a, text);
    }
  }
}

function tick(state, hours, companion = null, spectator = false) {
  for (let index = 0; index < hours; index++) {
    state.hour = (state.hour + 1) % 24;
    if (state.hour === 0) {
      state.day++;
      if (!spectator) {
        const paid = Math.min(state.money, 18);
        state.money -= paid;
        if (paid < 18) {
          state.player.happiness = clamp(state.player.happiness - 5);
          journal(state, 'Daily basics cost $18. With little money left, a community pantry covered the gap.', 'event');
        }
      }
    }
    if (!spectator) {
      state.player.energy = clamp(state.player.energy - 2);
      state.player.hunger = clamp(state.player.hunger - 3);
      state.player.social = clamp(state.player.social - 1);
      if (state.player.hunger < 12 || state.player.energy < 10) state.player.health = clamp(state.player.health - 1);
      if (state.player.social < 12) state.player.happiness = clamp(state.player.happiness - 1);
    }
    npcHour(state, companion);
  }
}

export function advanceWorld(state, hours = 1, { spectator = false } = {}) {
  const reason = spectator ? '' : blocked(state);
  if (reason) return result(false, reason);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) return result(false, 'Advance between 1 and 24 whole hours.');
  tick(state, hours, null, spectator);
  return result(true, `${hours === 1 ? 'An hour passes' : `${hours} hours pass`}. Your neighbors follow their own plans.`);
}

export function act(state, actionId, npcId) {
  const reason = blocked(state);
  if (reason) return result(false, reason);
  const action = ACTIONS.find(item => item.id === actionId);
  if (!action) return result(false, 'That activity is not available.');
  const neighbor = npcId === undefined ? state.npcs.find(npc => npc.location === action.location) || state.npcs[state.actionsTaken % state.npcs.length] : state.npcs.find(npc => npc.id === npcId);
  if (npcId !== undefined && !neighbor) return result(false, 'That neighbor is not in town.');
  if (state.money < action.cost) return result(false, `You need $${action.cost} for this activity.`);
  if (actionId === 'work' && state.player.energy < 18) return result(false, 'You need at least 18 energy to work a shift. Rest first.');
  state.money -= action.cost;
  state.player.location = actionId === 'socialize' && npcId !== undefined
    ? canAccess('player',neighbor.location) && canAccess(neighbor.id,neighbor.location) ? neighbor.location : 'park'
    : action.location;
  if (actionId === 'socialize') neighbor.location = state.player.location;
  tick(state, action.hours, actionId === 'socialize' ? neighbor : null);
  const effects = {
    work: { money: state.age >= 65 ? 65 : 64 + state.player.skill + Math.min(60, state.player.workShifts * 3), energy: -10, happiness: -3, skill: 2 },
    study: { skill: 8, energy: -6, happiness: 3 },
    rest: { energy: 70 + state.homeLevel * 7, health: 4, happiness: 3 + state.homeLevel * 2 },
    eat: { hunger: 44, energy: 6, happiness: 5 },
    exercise: { health: 12, happiness: 9, energy: -6 },
    create: { skill: 5, happiness: 16, energy: -5 },
    socialize: { social: 32, happiness: 12, affinity: 8 },
  }[actionId];
  applyEffects(state, effects, neighbor);
  if (actionId === 'work') { state.player.workShifts++; progressCareer(state); }
  const meetingPlace = LOCATIONS.find(location => location.id === state.player.location).name;
  const message = actionId === 'work' ? `You worked a shift and earned $${effects.money}.` : actionId === 'socialize' ? `You spent time with ${neighbor.name} at ${meetingPlace}. Your connection grew a little stronger.` : `${action.label}: a little time well spent.`;
  if (actionId === 'socialize') {
    neighbor.social = clamp(neighbor.social + 24);
    neighbor.thought = `I am glad ${state.player.name.split(' ')[0]} made time for me.`;
    remember(state, neighbor, `${state.player.name} spent time with me at ${meetingPlace}. It felt good to be remembered.`);
  }
  journal(state, message, actionId === 'socialize' ? 'social' : 'action');
  state.actionsTaken++;
  if (state.actionsTaken % 3 === 0) state.activeEvent = nextEvent(state);
  return result(true, message);
}

export function chooseEvent(state, index) {
  if (state.ended) return result(false, 'This life is complete. Start a new story to play again.');
  const choice = Number.isInteger(index) && state.activeEvent?.choices[index];
  if (!choice) return result(false, 'Choose one of the available responses.');
  if (state.money + (choice.effects.money || 0) < 0) return result(false, 'You do not have enough money for that choice. Another path is available.');
  const neighbor = state.npcs.find(npc => npc.id === state.activeEvent.npcId);
  applyEffects(state, choice.effects, neighbor);
  const message = `${state.activeEvent.title} You chose: ${choice.label.toLowerCase()}.`;
  if (neighbor) {
    remember(state, neighbor, `${state.player.name} chose to ${choice.label.toLowerCase()} when ${state.activeEvent.title.toLowerCase()}`);
    neighbor.thought = `I will remember that ${state.player.name.split(' ')[0]} chose to ${choice.label.toLowerCase()}.`;
  }
  journal(state, message, 'event');
  state.activeEvent = null;
  progressCareer(state);
  return result(true, message);
}

export function ageUp(state) {
  const reason = blocked(state);
  if (reason) return result(false, reason);
  const income = state.age >= 65 ? 7800 : 10800 + state.player.skill * 95 + Math.min(state.player.workShifts, 30) * 100;
  const expenses = 9600 + state.homeLevel * 240;
  const shortfall = Math.max(0, expenses - state.money - income);
  applyEffects(state, { money: income - expenses, health: state.age >= 65 ? -3 : state.age >= 40 ? -1 : 0, happiness: shortfall ? -8 : 3 });
  state.age++;
  state.day += 365;
  state.hour = 9;
  state.player.energy = Math.max(45, state.player.energy);
  state.player.hunger = Math.max(45, state.player.hunger);
  for (const npc of state.npcs) {
    npc.affinity = clamp(npc.affinity - 3);
    remember(state, npc, `Another year in Elsewhere. ${state.player.name} turned ${state.age}.`);
  }
  for (let hour = 0; hour < 12; hour++) npcHour(state);
  if (state.age === 65) { state.player.career = 'Retired · occasional café shifts'; journal(state, 'You retired from full-time work. A pension now supports your everyday life.', 'milestone'); }
  const balance = income - expenses;
  const message = `You turned ${state.age}. A year of ${state.age > 65 ? 'pension income' : 'work'} brought in $${income.toLocaleString('en-US')}; living costs were $${expenses.toLocaleString('en-US')} (${balance >= 0 ? '+' : '−'}$${Math.abs(balance).toLocaleString('en-US')} net).`;
  journal(state, message, 'milestone');
  if (state.age >= 95 || state.player.health === 0) {
    state.ended = true;
    state.activeEvent = null;
    journal(state, `At ${state.age}, your story in Elsewhere came to a close. The friendships, small kindnesses, and choices you made are your legacy.`, 'milestone');
  } else state.activeEvent = nextEvent(state, true);
  return result(true, message);
}

export function chat(state, npcId, message) {
  if (state.ended) return result(false, 'This life is complete. Start a new story to play again.');
  const npc = state.npcs.find(neighbor => neighbor.id === npcId);
  if (!npc) return result(false, 'That neighbor is not in town.');
  if (typeof message !== 'string' || !message.trim() || message.length > 280) return result(false, 'Write a message between 1 and 280 characters.');
  const input = message.trim().toLowerCase();
  const name = state.player.name.split(' ')[0];
  let response;
  let affinity = 2;
  const storyChoice = STORIES[npc.id]?.choices.find(choice => choice.label.toLowerCase() === input);
  if (storyChoice) { response = storyChoice.reply; affinity = storyChoice.affinity; }
  else if (/\b(goal|dream|plan|ambition|working on)\b/.test(input)) response = `My goal? ${npc.goal}. I am about ${npc.goalProgress}% into this next step. ${npc.trait === 'Ambitious' ? 'I like having something to work toward.' : 'A little progress is enough for today.'}`;
  else if (/\b(remember|memory|memories|past)\b/.test(input)) response = `I remember this: ${(npc.memories.find(memory => !memory.text.includes(' said: ')) || npc.memories[0])?.text || 'We are only just getting to know each other.'}`;
  else if (/\b(how are you|feeling|feel|doing|need)\b/.test(input)) response = npc.energy < 35 ? 'Honestly, I am tired. I will probably head home soon.' : npc.hunger < 35 ? 'A little hungry! A bite at Sunbeam is calling my name.' : npc.social < 35 ? 'I have been craving some company. It is good to see you.' : `I am doing well, ${name}. ${npc.thought}`;
  else if (/\b(hate|stupid|idiot|boring|shut up)\b/.test(input)) { response = 'That hurt. I would like a little space, please.'; affinity = -7; }
  else if (/\b(love|date|crush|romance)\b/.test(input)) { response = npc.affinity >= 55 ? `I feel close to you too, ${name}. I would like to see where this goes.` : 'I would like to get to know you better first. Spend some time with me?'; affinity = npc.affinity >= 55 ? 4 : 1; }
  else if (/\b(thanks|thank you|kind|lovely|great|beautiful|appreciate)\b/.test(input)) response = `That means a lot, ${name}. Little kindnesses make this place feel like home.`;
  else if (/\b(hi|hey|hello|morning|afternoon|evening)\b/.test(input)) response = `Hey, ${name}! ${npc.affinity >= 45 ? 'Seeing you always makes my day. ' : ''}${npc.thought}`;
  else if (/\b(job|work|career)\b/.test(input)) response = `I am a ${npc.career.toLowerCase()}. ${npc.trait === 'Creative' ? 'The best part is making something that did not exist before.' : `It gives me a way to ${npc.goal.toLowerCase()}.`}`;
  else { response = 'I am not sure how to respond to that yet. Ask me about my day, my work, my goals, or something I remember.'; affinity = 0; }
  // Presets stay local. Optional AI replies use the server and cannot award simulation effects.
  const memory = `${state.player.name} said: “${message.trim()}”`;
  const repeated = npc.memories.some(item => item.day === state.day && item.text === memory);
  if (!repeated && (affinity !== 0 || storyChoice)) {
    npc.affinity = clamp(npc.affinity + affinity);
    npc.social = clamp(npc.social + 4);
    state.player.social = clamp(state.player.social + 3);
    remember(state, npc, memory);
  }
  if (affinity !== 0) npc.thought = affinity < 0 ? `I need some space from ${name} after that conversation.` : `It was good to talk with ${name}. There is always something to learn about a neighbor.`;
  return result(true, response);
}

export function furnish(state) {
  const reason = blocked(state);
  if (reason) return result(false, reason);
  if (state.homeLevel >= 3) return result(false, 'Your home is fully furnished. Enjoy your little sanctuary.');
  const cost = 350 * (state.homeLevel + 1);
  if (state.money < cost) return result(false, `This home upgrade costs $${cost}.`);
  state.money -= cost;
  state.homeLevel++;
  state.player.location = 'home';
  applyEffects(state, { happiness: 12 });
  const message = ['You added plants and a reading corner. Resting at home is a little more restorative.', 'A comfortable sofa and warm lighting make your home feel like you.', 'Your little home now has a creative corner, good company, and room to grow.'][state.homeLevel - 1];
  journal(state, message, 'milestone');
  return result(true, message);
}

export function validSave(state) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min = 0, max = 100) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
  const string = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max;
  const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const location = value => LOCATIONS.some(place => place.id === value);
  if (!object(state) || state.version !== 1 || !integer(state.seed, 0, 4294967295) || !integer(state.day, 1, 1000000) || !integer(state.hour, 0, 23) || !integer(state.age, 22, 95) || !number(state.money, 0, 10000000) || !integer(state.actionsTaken, 0, 10000000) || !integer(state.homeLevel, 0, 3) || typeof state.ended !== 'boolean') return false;
  const player = state.player;
  if (!object(player) || !string(player.name, 40) || !string(player.aspiration, 80) || !string(player.career, 80) || !canAccess('player',player.location) || !number(player.skill) || !integer(player.workShifts, 0, 10000000) || !NEEDS.every(key => number(player[key])) || (player.color !== undefined && !color(player.color))) return false;
  if (!Array.isArray(state.npcs) || state.npcs.length !== NPCS.length || new Set(state.npcs.map(npc => npc?.id)).size !== NPCS.length) return false;
  for (const npc of state.npcs) {
    if (npc?.location !== 'home' && !canAccess(npc?.id,npc?.location)) return false;
    if (!object(npc) || !NPCS.some(row => row[0] === npc.id) || !['name', 'pronouns', 'career', 'trait', 'goal', 'action', 'thought'].every(key => string(npc[key], key === 'thought' ? 1000 : key === 'career' ? 80 : 150)) || !color(npc.color) || !location(npc.location) || !['energy', 'hunger', 'social', 'affinity', 'goalProgress'].every(key => number(npc[key]))) return false;
    if (!object(npc.relationships) || Object.keys(npc.relationships).length > 5 || !Object.entries(npc.relationships).every(([id, value]) => id !== npc.id && NPCS.some(row => row[0] === id) && number(value))) return false;
    if (!Array.isArray(npc.memories) || npc.memories.length > 8 || !npc.memories.every(memory => object(memory) && integer(memory.day, 1, state.day) && string(memory.text, 1000))) return false;
  }
  if (!Array.isArray(state.journal) || state.journal.length > 80 || !state.journal.every(entry => object(entry) && integer(entry.day, 1, state.day) && integer(entry.age, 22, state.age) && string(entry.text, 1500) && ['action', 'social', 'world', 'event', 'milestone', 'system'].includes(entry.type))) return false;
  if (state.activeEvent !== null) {
    const current = state.activeEvent;
    if (!object(current) || !['id', 'kicker', 'title', 'description'].every(key => string(current[key], key === 'description' ? 1000 : 250)) || (current.npcId !== undefined && !NPCS.some(row => row[0] === current.npcId)) || !Array.isArray(current.choices) || current.choices.length < 2 || current.choices.length > 4) return false;
    if (!current.choices.every(choice => object(choice) && string(choice.label, 100) && string(choice.description, 500) && object(choice.effects) && Object.entries(choice.effects).every(([key, value]) => EFFECTS.includes(key) && number(value, key === 'money' ? -10000 : -100, key === 'money' ? 10000 : 100)))) return false;
    if (!current.choices.some(choice => state.money + (choice.effects.money || 0) >= 0)) return false;
  }
  if ((state.ended && state.activeEvent !== null) || (state.age === 95 && !state.ended)) return false;
  return true;
}
