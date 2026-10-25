import { useRef, useState } from 'react';
import { HARU_EMOTIONS } from '../electron/emotions';
import { BodyAvatarCanvas } from './components/BodyAvatarCanvas';
import type { SvgAvatarHandle } from './components/SvgAvatarCanvas';
import type { MouthReading } from './companion/mouth';

/**
 * Her whole figure on a page of its own (?view=body): every face to choose from, the gestures to press, and a
 * spoken line faked for the mouth. The page exposes window.haruPreview the way the old expression studio did, so a
 * check script can drive it from outside.
 */
// A line, faked: open vowels, a rounded one, a front one, a hiss, a gap; one shape every 120 ms.
const LINE: MouthReading[] = [
  { open: .9, weight: 1, bands: { low: .6, mid: .3, high: .1 } },
  { open: .8, weight: 1, bands: { low: .7, mid: .08, high: .05 } },
  { open: .95, weight: 1, bands: { low: .25, mid: .65, high: .1 } },
  { open: .5, weight: 1, bands: { low: .3, mid: .3, high: .4 } },
  { open: .02, weight: 1 },
  { open: .7, weight: 1, bands: { low: .5, mid: .4, high: .1 } },
];
const GESTURES = ['nod', 'shake', 'wave', 'point', 'peace', 'fist'];

declare global {
  interface Window { haruPreview?: { ready: boolean; choose(name: string): void; play(name: string): void } }
}

export function BodyPreview() {
  const handle = useRef<SvgAvatarHandle | null>(null);
  const talking = useRef(false);
  const [emotion, setEmotion] = useState('neutral');
  const [talk, setTalk] = useState(false);
  talking.current = talk;
  const choose = (name: string) => { setEmotion(name); handle.current?.expression(name); };
  const play = (name: string) => handle.current?.play(name);
  return (
    <div className="body-preview">
      <div className="body-stage">
        <BodyAvatarCanvas
          read={() => ({ mouth: talking.current ? LINE[Math.floor(performance.now() / 120) % LINE.length] : { open: 0, weight: 0 } })}
          onReady={h => { handle.current = h; window.haruPreview = h ? { ready: true, choose, play } : undefined; }}
        />
      </div>
      <div className="body-controls">
        <select value={emotion} onChange={e => choose(e.target.value)}>
          {HARU_EMOTIONS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        {GESTURES.map(name => <button key={name} type="button" onClick={() => play(name)}>{name}</button>)}
        <label><input type="checkbox" checked={talk} onChange={e => setTalk(e.target.checked)} /> talk</label>
      </div>
    </div>
  );
}
