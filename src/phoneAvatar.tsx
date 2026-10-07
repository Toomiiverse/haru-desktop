// The phone runs the desktop SVG renderer, with its artwork and styles bundled.
import { createRoot } from 'react-dom/client';
import { SvgAvatarCanvas, type SvgAvatarHandle } from './components/SvgAvatarCanvas';
import { adaptEmotion } from '../electron/emotions';
import { createPhoneSpeech } from './companion/phoneSpeech';
// The page's classic script owns this shared speech Audio element.
declare const player: HTMLAudioElement | undefined;
import stylesheet from './svgAvatar.css?inline';

const host = document.getElementById('stage');
if (host) {
  const speech = createPhoneSpeech(typeof player === 'undefined' ? null : player);
  const previous = (window as any).haruAvatar;
  let resting = adaptEmotion(previous?.state?.().resting);
  previous?.stop?.();
  const style = document.createElement('style');
  style.textContent = stylesheet;
  document.head.appendChild(style);
  const frame = document.createElement('div');
  Object.assign(frame.style, { position: 'relative', width: '100%', height: 'clamp(200px, 30vh, 280px)', flex: '0 0 auto' });
  host.replaceChildren(frame);
  const root = createRoot(frame);
  host.setAttribute('role', 'button'); host.setAttribute('tabindex', '0');
  host.setAttribute('aria-label', 'Haru: tap to react or interrupt speech');
  const onKey = (event: KeyboardEvent) => {
    if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); host.click(); }
  };
  host.addEventListener('keydown', onKey);
  let settle: ReturnType<typeof setTimeout> | undefined;
  const onReady = (avatar: SvgAvatarHandle | null) => {
    if (!avatar) return;
    const express = (name: string | null) => { clearTimeout(settle); resting = adaptEmotion(name); avatar.expression(resting); };
    avatar.expression(resting);
    (window as any).haruAvatar = {
      version: 'HARU_AVATAR_REVISION', express,
      think: () => { clearTimeout(settle); avatar.expression('thinking'); settle = setTimeout(() => avatar.expression(resting), 20000); },
      notify: () => { clearTimeout(settle); avatar.expression(resting); avatar.notify(); },
      attend: (why: string, ms?: number) => avatar.attend(why, ms),
      play: (name: string) => avatar.play(name), symbol: (name: string | null) => avatar.symbol(name),
      tap: () => avatar.tap(),
      poke: (name: string) => {
        if (['exclaim', 'burst', 'orbit', 'comet', 'play'].includes(name)) avatar.tap();
      },
      state: () => ({ resting }),
      stop: () => { clearTimeout(settle); host.removeEventListener('keydown', onKey); speech.dispose(); root.unmount(); },
    };
  };
  const loadFace = async (name: string) => {
    const response = await fetch('/emotions/' + name + '.svg?v=HARU_AVATAR_REVISION');
    if (!response.ok) throw Error('Haru face ' + response.status);
    return response.text();
  };
  root.render(<SvgAvatarCanvas roam read={() => ({ mouth: speech.read() })} onReady={onReady} loadFace={loadFace} onError={message => console.warn('[Haru avatar]', message)} onFit={() => {}} />);
}
