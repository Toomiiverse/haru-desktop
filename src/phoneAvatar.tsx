// The phone runs the desktop SVG renderer, with its artwork and styles bundled.
import { createRoot } from 'react-dom/client';
import { SvgAvatarCanvas, type SvgAvatarHandle } from './components/SvgAvatarCanvas';
import { adaptEmotion } from '../electron/emotions';
import stylesheet from './svgAvatar.css?inline';

const host = document.getElementById('stage');
if (host) {
  const previous = (window as any).haruAvatar;
  let resting = adaptEmotion(previous?.state?.().resting);
  previous?.stop?.();
  const style = document.createElement('style');
  style.textContent = stylesheet;
  document.head.appendChild(style);
  const frame = document.createElement('div');
  Object.assign(frame.style, { position: 'relative', width: 'var(--avatar-size)', height: 'var(--avatar-size)', flex: '0 0 auto' });
  host.replaceChildren(frame);
  const root = createRoot(frame);
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
      poke: (name: string) => {
        const hit: Record<string, [string, number]> = { exclaim: ['angry', 2000], burst: ['surprised', 1600], orbit: ['excited', 1600], comet: ['surprised', 1600], play: ['happy', 1600] };
        if (!Object.hasOwn(hit, name)) return;
        clearTimeout(settle); avatar.expression(hit[name][0]); settle = setTimeout(() => avatar.expression(resting), hit[name][1]);
      },
      state: () => ({ resting }),
      stop: () => { clearTimeout(settle); root.unmount(); },
    };
  };
  const loadFace = async (name: string) => {
    const response = await fetch('/emotions/' + name + '.svg?v=HARU_AVATAR_REVISION');
    if (!response.ok) throw Error('Haru face ' + response.status);
    return response.text();
  };
  root.render(<SvgAvatarCanvas onReady={onReady} loadFace={loadFace} onError={message => console.warn('[Haru avatar]', message)} onFit={() => {}} />);
}
