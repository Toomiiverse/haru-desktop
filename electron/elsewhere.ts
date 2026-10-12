// Explicit public-art/code inventory, always served after Haru's existing sign-in gate.
export const ELSEWHERE_FILES = new Map<string,[string,string]>([
  ['/elsewhere',['index-work.html','text/html; charset=utf-8']],
  ['/world',['index-work.html','text/html; charset=utf-8']],
  ...['work-client.mjs','engine.mjs','world.mjs','work-map.mjs'].map(name => [`/elsewhere/${name}`,[name,'text/javascript; charset=utf-8']] as [string,[string,string]]),
  ['/elsewhere/work.css',['work.css','text/css; charset=utf-8']],
  ['/elsewhere/style.css',['style.css','text/css; charset=utf-8']],
  ...['serene-village','townspeople','interiors','room-builder'].map(id => [`/assets/world/${id}.png`,[`assets/world/${id}.png`,'image/png']] as [string,[string,string]]),
  ...['lina','theo','maya','felix','jules','bea','player'].flatMap(id => [
    [`/assets/portraits/${id}-v2.png`,[`assets/portraits/${id}-v2.png`,'image/png']],
    [`/assets/fullbody/${id}-v1.png`,[`assets/fullbody/${id}-v1.png`,'image/png']],
    ...(id === 'player' ? [] : [[`/assets/dialogue/${id}-poses-v1.png`,[`assets/dialogue/${id}-poses-v1.png`,'image/png']]]),
  ] as [string,[string,string]][]),
  ...['world','portraits','fullbody'].map(id => [`/assets/${id}/README.md`,[`assets/${id}/README.md`,'text/plain; charset=utf-8']] as [string,[string,string]]),
]);
