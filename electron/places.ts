import {navigationPolicy} from './core-navigation-policy';
// Somewhere real, or nothing.
//
// Asked for a steakhouse in Perth, a 9B produced three confident, well-formed
// names — none of which exist here, two of them Melbourne restaurants — and
// then, told they were not on the map, said it had checked. Nothing had been
// checked. There is no looking-up inside a language model, only the shape of a
// plausible name, and a name is exactly the kind of thing it shapes best.
//
// So a question that asks for a real business or venue is looked up first,
// with the search that is already configured, and what comes back rides in
// beside the message. She still answers as herself; the names simply stop
// being hers to invent.

/** The sort of thing that has an address, and can therefore be got wrong. */
const KIND = /\b(restaurants?|steak\s?houses?|cafes?|caf[ée]s?|coffee shops?|bars?|pubs?|breweries|brewery|wineries|winery|bakeries|bakery|takeaways?|eateries|eatery|diners?|bistros?|pizzerias?|hotels?|motels?|gyms?|barbers?|hairdressers?|salons?|dentists?|mechanics?|garages?|shops?|stores?|supermarkets?|markets?|museums?|galleries|gallery|cinemas?|theatres?|theaters?|clubs?|venues?|parks?|beaches|playgrounds?|librar(y|ies)|butchers?|florists?|nurseries|nursery|places? to (eat|drink|go|stay)|places?|spots?|joints?)\b/i;

/** Asking for one, rather than mentioning one in passing. */
const ASKING = new RegExp([
  /\b(good|best|decent|nice|top|great|cheap|fancy|proper|favourite|favorite|recommended|worth)\b/,
  /\bwhere\s+(can|could|should|do|would|is|are|'s)\b/,
  /\b(recommend|recommendations?|suggest|suggestions?|know\s+(any|a|of any)|any ideas|ideas for)\b/,
].map(pattern => pattern.source).join('|'), 'i');

/** Wanting a thing that is only got somewhere: always a question about a place. */
const WHERE_TO_GET = /\bwhere\s+(can|could|should|do|would)\s+(i|we)\s+(get|buy|find|grab|eat|drink|go for|pick up)\b/i;

/** Talking about one they already have in mind is not asking for a name. */
const NOT_ASKING = /\b(place to (start|begin|look|learn|live)|in the first place|remind me|reminder|set (me )?a|put .* on (the|my) list|i (went|ate|was|am at|booked|bought)|we (went|ate|booked)|last night|yesterday)\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The search to run for a message asking after a real place, or nothing if it
 * is not that sort of message. `place` is the configured city, appended only
 * when they have not named one themselves — their choice wins over the setting.
 */
export function placeQuery(text: string, place: string): string | null {
 return navigationPolicy('placeQuery',[text,place]);
}

/**
 * What she is told, with the results. Deliberately absolute: a model given
 * real results alongside its own recollection will happily blend the two, and
 * a blend is indistinguishable from an invention by the time it reaches a map.
 */
export function groundedInstruction(results: string): string {
 return navigationPolicy('groundedInstruction',[results]);
}
