import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { imagePng } from './imageEditor';

export interface ImageReference { id: string; name: string; image: string; error?: string }
export interface HaruAppearance { revision: string; primary: string; notes: string; references: ImageReference[] }
export interface PoseReference extends ImageReference { skeleton: string }
interface LibraryData { version: 1; revision: string; primary: string; notes: string; references: { id: string; name: string }[]; poses: { id: string; name: string }[] }
export interface ImageSettings { get(key: string): unknown; set(key: string, value: unknown): void }
const KEY = 'imageEditor.library';
const ID = /^[a-f0-9-]{36}$/;

/** Files belong to Haru; callers only receive IDs, never writable paths. */
export class ImageLibrary {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private settings: ImageSettings) {}
  private metadata(): LibraryData {
    const saved = this.settings.get(KEY);
    if (saved === undefined || saved === null) return { version: 1, revision: 'empty', primary: '', notes: '', references: [], poses: [] };
    const data = structuredClone(saved) as LibraryData;
    if (data.version !== 1 || typeof data.revision !== 'string' || typeof data.primary !== 'string' || typeof data.notes !== 'string' || data.notes.length > 2000 || !Array.isArray(data.references) || data.references.length > 4 || !Array.isArray(data.poses) || data.poses.length > 24 || [...data.references, ...data.poses].some(x => !x || !ID.test(x.id) || typeof x.name !== 'string' || x.name.length > 120) || new Set([...data.references, ...data.poses].map(x => x.id)).size !== data.references.length + data.poses.length || (data.references.length > 0 && !data.references.some(x => x.id === data.primary)) || (!data.references.length && data.primary)) throw Error('Saved appearance could not be read. Your files were left unchanged.');
    return data;
  }
  private file(id: string, skeleton = false) {
    if (!ID.test(id)) throw Error('Invalid saved image ID.');
    return path.join(this.root, `${id}${skeleton ? '-pose' : ''}.png`);
  }
  private async image(id: string, skeleton = false): Promise<string> {
    const image = `data:image/png;base64,${(await readFile(this.file(id, skeleton))).toString('base64')}`;
    imagePng(image); return image;
  }
  private async put(id: string, image: string, skeleton = false) {
    const bytes = imagePng(image), file = this.file(id, skeleton), temporary = `${file}.tmp`;
    await mkdir(this.root, { recursive: true });
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, file);
  }
  private change<T>(action: () => Promise<T>): Promise<T> {
    const job = this.writes.then(action); this.writes = job.catch(() => undefined); return job;
  }
  async appearance(): Promise<HaruAppearance> {
    await this.writes;
    const d = this.metadata();
    return { revision: d.revision, primary: d.primary, notes: d.notes, references: await Promise.all(d.references.map(async ref => {
      try { return { ...ref, image: await this.image(ref.id) }; }
      catch { return { ...ref, image: '', error: 'This saved image cannot be read. Replace it or remove it.' }; }
    })) };
  }
  async poses(): Promise<PoseReference[]> {
    await this.writes;
    return Promise.all(this.metadata().poses.map(async ref => {
      try { return { ...ref, image: await this.image(ref.id), skeleton: await this.image(ref.id, true) }; }
      catch { return { ...ref, image: '', skeleton: '', error: 'This saved pose cannot be read. Remove it and upload it again.' }; }
    }));
  }
  async import(image: string, name: string, replace?: string): Promise<HaruAppearance> {
    await this.change(async () => {
      const d = this.metadata();
      if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Error('Use an image name of 1–120 characters.');
      if (replace && !d.references.some(x => x.id === replace)) throw Error('That reference no longer exists.');
      if (!replace && d.references.length >= 4) throw Error('Use one main image and up to three extra views.');
      const id = randomUUID(); await this.put(id, image);
      const ref = { id, name: name.trim() };
      d.references = replace ? d.references.map(x => x.id === replace ? ref : x) : [...d.references, ref];
      if (!d.primary || d.primary === replace) d.primary = id;
      d.revision = randomUUID();
      try { this.settings.set(KEY, d); } catch (error) { await unlink(this.file(id)).catch(() => undefined); throw error; }
      // Metadata switches only after the replacement file is safely written.
      if (replace) await unlink(this.file(replace)).catch(() => undefined);
    });
    return this.appearance();
  }
  async update(value: { primary?: string; notes?: string; remove?: string }): Promise<HaruAppearance> {
    await this.change(async () => {
      if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['primary', 'notes', 'remove'].includes(k))) throw Error('Invalid appearance change.');
      const d = this.metadata();
      if (value.primary !== undefined) {
        if (!d.references.some(x => x.id === value.primary)) throw Error('Choose a saved reference.');
        d.primary = value.primary;
      }
      if (value.notes !== undefined) {
        if (typeof value.notes !== 'string' || value.notes.length > 2000) throw Error('Appearance notes must be shorter than 2,000 characters.');
        d.notes = value.notes;
      }
      if (value.remove !== undefined) {
        if (!d.references.some(x => x.id === value.remove)) throw Error('That reference no longer exists.');
        d.references = d.references.filter(x => x.id !== value.remove);
        if (d.primary === value.remove) d.primary = d.references[0]?.id || '';
      }
      d.revision = randomUUID(); this.settings.set(KEY, d);
      if (value.remove) await unlink(this.file(value.remove)).catch(() => undefined);
    });
    return this.appearance();
  }
  async addPose(image: string, skeleton: string, name: string): Promise<PoseReference[]> {
    await this.change(async () => {
      const d = this.metadata();
      if (d.poses.length >= 24) throw Error('Remove a saved pose before adding another (24 maximum).');
      if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Error('Give this pose a name of 1–120 characters.');
      const id = randomUUID();
      try {
        await this.put(id, image); await this.put(id, skeleton, true);
        d.poses.push({ id, name: name.trim() }); this.settings.set(KEY, d);
      } catch (error) {
        await Promise.all([unlink(this.file(id)), unlink(this.file(id, true))].map(x => x.catch(() => undefined)));
        throw error;
      }
    });
    return this.poses();
  }
  async removePose(id: string): Promise<PoseReference[]> {
    await this.change(async () => {
      const d = this.metadata();
      if (!d.poses.some(x => x.id === id)) throw Error('That pose no longer exists.');
      d.poses = d.poses.filter(x => x.id !== id); this.settings.set(KEY, d);
      await Promise.all([unlink(this.file(id)), unlink(this.file(id, true))].map(x => x.catch(() => undefined)));
    });
    return this.poses();
  }
}
