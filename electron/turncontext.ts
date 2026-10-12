import type { SearchResult } from './search';
import type { Picture } from './browserctl';

/** State owned by one reply, including all of its tool rounds and retries.
 * Concurrent desk, phone and call replies must never change one another's
 * permissions or consume one another's tool results. */
export function createTurnContext({ hands = false, web = false, choices = false }: {
  hands?: boolean;
  web?: boolean;
  choices?: boolean;
} = {}) {
  let allowed = hands && !web;
  let pageRead = false;
  let pendingChoices: string[] = [];
  let restart = false;
  let searchQuery = '';
  let searchResults: SearchResult[] = [];
  let pictures: Picture[] = [];

  return {
    handsAllowed: () => allowed,
    onWeb: () => web,
    offeringChoices: () => choices && !web,
    pageWasRead: () => pageRead,
    // Once outside text enters this reply, its machine permission cannot be
    // restored. A new message gets a new context instead.
    markPageRead: () => { pageRead = true; allowed = false; },
    withdrawHands: () => { allowed = false; },
    setPendingChoices: (value: unknown[]) => {
      pendingChoices = value.filter((choice): choice is string => typeof choice === 'string');
    },
    pendingChoices: () => [...pendingChoices],
    requestRestart: () => { restart = true; },
    restartRequested: () => restart,
    rememberSearch: (query: string, results: SearchResult[]) => {
      searchQuery = query;
      searchResults = results.map(result => ({ ...result }));
    },
    lastSearchQuery: () => searchQuery,
    lastResults: () => searchResults.map(result => ({ ...result })),
    // Pictures a tool took during a round — a screenshot of a page — waiting to
    // be put in front of the model after that round's answers (toolloop.ts).
    addPicture: (picture: Picture) => { pictures.push(picture); },
    takePictures: () => { const taken = pictures; pictures = []; return taken; },
  };
}

export type TurnContext = ReturnType<typeof createTurnContext>;
