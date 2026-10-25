import { useEffect, useState } from 'react';
import { ImagePlus, UserRound } from 'lucide-react';
import type { HaruAppearance } from '../electron/imageLibrary';
import { wardrobeImage } from './wardrobeImages';

export function AppearanceSettings({ className = '' }: { className?: string }) {
  const [appearance, setAppearance] = useState<HaruAppearance | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let mounted = true;
    if (!window.haru?.imageEditor) { setError('Open Haru desktop to save her appearance.'); return; }
    void window.haru!.imageEditor.appearance().then(value => { if (mounted) { setAppearance(value); setNotes(value.notes); } }).catch(error => { if (mounted) setError(String(error)); });
    return () => { mounted = false; };
  }, []);
  async function change(action: () => Promise<HaruAppearance>) {
    setBusy(true); setError(''); setStatus('');
    try { const saved = await action(); setAppearance(saved); setNotes(saved.notes); setStatus('Haru’s appearance is saved. The wardrobe will use it automatically.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save the appearance.'); }
    finally { setBusy(false); }
  }
  async function upload(file?: File, replace?: string) {
    if (!file) return;
    await change(async () => window.haru!.imageEditor.importAppearance((await wardrobeImage(file)).image, file.name.slice(0, 120), replace));
  }
  return <div className={`appearance-settings ${className}`} aria-busy={busy}>
    <p>Her 2D anime appearance is the reference for every wardrobe picture. Add a clear main picture, then optional face, side or full-body views of the same Haru. Her floating icon is separate.</p>
    {!appearance && !error ? <div className="appearance-loading" role="status">Loading Haru’s appearance…</div> : !appearance?.references.length && <div className="appearance-empty"><UserRound size={28}/><h3>Add Haru’s appearance</h3><p>Choose the character artwork you want the wardrobe to preserve.</p></div>}
    <div className="appearance-grid">{appearance?.references.map(ref => <figure key={ref.id}>
      {ref.image ? <img src={ref.image} alt={`${ref.id === appearance.primary ? 'Main' : 'Extra'} appearance reference: ${ref.name}`}/> : <p role="alert">{ref.error}</p>}
      <figcaption>{ref.id === appearance.primary ? 'Main avatar' : 'Extra view'} · {ref.name}</figcaption>
      <div className="appearance-actions">
        <button disabled={busy || ref.id === appearance.primary} onClick={() => void change(() => window.haru!.imageEditor.updateAppearance({ primary: ref.id }))}>Use as main</button>
        <label className="wardrobe-import">Replace<input aria-label={`Replace ${ref.name}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { void upload(e.target.files?.[0], ref.id); e.target.value = ''; }}/></label>
        <button disabled={busy} onClick={() => void change(() => window.haru!.imageEditor.updateAppearance({ remove: ref.id }))}>Remove</button>
      </div>
    </figure>)}</div>
    <label className="wardrobe-import"><ImagePlus size={16}/>{appearance?.references.length ? 'Add an extra view' : 'Upload main avatar'}<input aria-label="Upload Haru appearance reference" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !appearance || appearance.references.length >= 4} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/></label>
    <small>PNG, JPG or WebP · up to four images · local working copies up to 1024 px</small>
    <label className="wardrobe-field">Distinguishing features (optional)<textarea value={notes} maxLength={2000} rows={3} disabled={busy || !appearance} onChange={e => setNotes(e.target.value)} placeholder="Her hairstyle, eye colour, skin tone, proportions and any signature details…"/></label>
    <button disabled={busy || !appearance || notes === appearance.notes} onClick={() => void change(() => window.haru!.imageEditor.updateAppearance({ notes }))}>Save appearance notes</button>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
