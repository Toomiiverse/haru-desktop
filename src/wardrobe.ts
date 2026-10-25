import type { ImageProfile, ImageCatalog, ImageLora } from '../electron/imageEditor';
import { readWardrobeContent, type WardrobeContentSettings } from '../electron/contentSafety';
export { guidanceMissing, recipeIssue } from '../electron/wardrobeSupport';

import { IMAGE_PROFILES } from '../electron/imageProfiles';
export { IMAGE_PROFILES };
export type { ImageProfile, ImageCatalog, ImageLora, WardrobeRequest, WardrobeResult, WardrobeAPI } from '../electron/imageEditor';
export { composeWardrobePrompt, explicitLabel, safetyLabel, type WardrobeContentSettings } from '../electron/contentSafety';

export const DEFAULT_MODEL_FILES: Record<ImageProfile, string> = {
  'waifu-v1-2': 'wd-v1-2-ema.safetensors',
  'waifu-v1-3': 'wd-v1-3-float16.safetensors',
  trinart: 'trinart2_step115000.safetensors',
  'wai-illustrious': 'waiIllustriousSDXL_v170.safetensors',
  'prefect-pony': 'prefectPonyXL_v6.safetensors',
  'pony-v6': 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  'pony-v7': 'pony-v7-base.safetensors',
  'nova-anime': 'novaAnimeXL_ilV190.safetensors',
  autismmix: 'autismmixSDXL_autismmixConfetti.safetensors',
  hassaku: 'hassakuXLIllustrious_v34.safetensors',
  'noob-eps': 'NoobAI-XL-v1.1.safetensors',
  'noob-vpred': 'NoobAI-XL-Vpred-v1.0.safetensors',
  illustrious: 'Illustrious-XL-v2.0.safetensors',
  'anima-base': 'anima-base-v1.0.safetensors',
  'anima-turbo': 'anima-turbo-v1.1.safetensors',
};
export const WARDROBE_SETTINGS_KEY = 'imageEditor.preferences';
export interface WardrobePreferences extends WardrobeContentSettings {
  endpoint: string;
  profile: ImageProfile;
  models: Partial<Record<ImageProfile, string>>;
  textEncoder: string;
  vae: string;
  ponyTextEncoder: string;
  ponyVae: string;
  loras: Partial<Record<ImageProfile, ImageLora[]>>;
  negative: string;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const filename = (value: unknown): string => typeof value === 'string' && value.trim() && value.length <= 512 && !/[\u0000-\u001f]/.test(value) ? value : '';
const strength = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -2 && value <= 2;

/** Saved settings are untrusted; keep only known fields and bounded, local choices. */
export function readWardrobePreferences(value: unknown): WardrobePreferences {
  const raw = record(value);
  const content = readWardrobeContent(raw);
  const result: WardrobePreferences = { endpoint: 'http://127.0.0.1:8188', profile: 'noob-eps', models: {}, textEncoder: filename(raw.textEncoder), vae: filename(raw.vae), ponyTextEncoder: filename(raw.ponyTextEncoder), ponyVae: filename(raw.ponyVae), loras: {}, negative: typeof raw.negative === 'string' && raw.negative.length <= 4000 ? raw.negative : 'low quality, blurry, text, watermark', ...content };
  if (typeof raw.endpoint === 'string' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/i.test(raw.endpoint)) {
    try { const url = new URL(raw.endpoint); if (url.port !== '0') result.endpoint = url.origin; } catch { /* Ignore invalid stored ports. */ }
  }
  if (typeof raw.profile === 'string' && Object.hasOwn(IMAGE_PROFILES, raw.profile)) result.profile = raw.profile as ImageProfile;
  for (const profile of Object.keys(IMAGE_PROFILES) as ImageProfile[]) {
    const model = filename(record(raw.models)[profile]);
    if (model) result.models[profile] = model;
    const saved = record(raw.loras)[profile];
    if (!Array.isArray(saved)) continue;
    const loras: ImageLora[] = [];
    for (const value of saved.slice(0, 4)) {
      const item = record(value), name = filename(item.name);
      if (!name || !strength(item.strengthModel) || (item.strengthClip !== undefined && !strength(item.strengthClip)) || loras.some(lora => lora.name === name)) continue;
      loras.push({ name, strengthModel: item.strengthModel, ...(['sdxl', 'sd1'].includes(IMAGE_PROFILES[profile].family) && item.strengthClip !== undefined ? { strengthClip: item.strengthClip as number } : {}) });
    }
    result.loras[profile] = loras;
  }
  return result;
}

/** Match official filenames in subfolders without guessing from unrelated model names. */
function installedFile(files: string[], chosen: string, fallback: string): string {
  if (chosen && files.includes(chosen)) return chosen;
  const basename = (name: string) => name.split(/[\\/]/).pop()!.toLowerCase();
  const matches = files.filter(name => basename(name) === basename(chosen || fallback));
  return matches.length === 1 ? matches[0] : chosen;
}
export function resolveWardrobeModels(preferences: WardrobePreferences, catalog: ImageCatalog): WardrobePreferences {
  const models = { ...preferences.models };
  for (const profile of Object.keys(IMAGE_PROFILES) as ImageProfile[]) {
    models[profile] = installedFile(profile.startsWith('anima-') ? catalog.diffusionModels : catalog.checkpoints, models[profile] || '', DEFAULT_MODEL_FILES[profile]);
  }
  return { ...preferences, models,
    textEncoder: installedFile(catalog.textEncoders, preferences.textEncoder, 'qwen_3_06b_base.safetensors'),
    vae: installedFile(catalog.vaes, preferences.vae, 'qwen_image_vae.safetensors'),
    ponyTextEncoder: installedFile(catalog.textEncoders, preferences.ponyTextEncoder, 'pony-v7-umt5.fp16.safetensors'),
    ponyVae: installedFile(catalog.vaes, preferences.ponyVae, 'pony-v7-vae.fp16.safetensors'),
  };
}
