import { guidanceMissing, supportFile, SUPPORT_FILES } from './wardrobeSupport';
export { guidanceMissing, supportFile, SUPPORT_FILES } from './wardrobeSupport';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { composeWardrobePrompt, type WardrobeContentSettings } from './contentSafety';
import type { HaruAppearance, PoseReference, ImageSettings } from './imageLibrary';

import { IMAGE_PROFILES, type ImageProfile } from './imageProfiles';
export type { ImageProfile } from './imageProfiles';
/** Names are an inventory only; ComfyUI's loader list does not verify LoRA architecture. */
export interface ImageCatalog { checkpoints: string[]; diffusionModels: string[]; textEncoders: string[]; vaes: string[]; loras: string[]; nodes?: string[]; ipAdapters?: string[]; clipVision?: string[]; controlNets?: string[]; patches?: string[] }
export interface ImageLora { name: string; strengthModel: number; strengthClip?: number }
export interface WardrobeRequest {
  endpoint: string; profile: ImageProfile; model: string; textEncoder: string; vae: string;
  prompt: string; negative: string; width: number; height: number; steps: number; cfg: number;
  seed: number; strength: number; image?: string; mask?: string; loras?: ImageLora[];
  content?: WardrobeContentSettings;
}
export interface AvatarJobRequest extends Omit<WardrobeRequest, 'prompt' | 'image'> {
  operation: 'clothing' | 'scene'; appearanceRevision: string; outfit: string; pose: string; situation: string;
  sourceId?: string; selectionId?: string; poseId?: string;
  protectionMask?: string;
}
export interface ClothingSelection { id: string; mask: string; protected: string }
export interface WardrobeResult { image: string; seed: number; promptId: string; sourceId?: string; appearanceRevision?: string }
export interface WardrobeAPI {
  models(endpoint: string): Promise<ImageCatalog>;
  run(request: AvatarJobRequest): Promise<WardrobeResult>;
  save(image: string): Promise<string | null>;
  appearance(): Promise<HaruAppearance>;
  importAppearance(image: string, name: string, replace?: string): Promise<HaruAppearance>;
  updateAppearance(change: { primary?: string; notes?: string; remove?: string }): Promise<HaruAppearance>;
  onAppearanceChanged(callback: () => void): () => void;
  selectClothing(endpoint: string, revision: string, sourceId?: string): Promise<ClothingSelection>;
  poses(): Promise<PoseReference[]>;
  addPose(endpoint: string, image: string, name: string): Promise<PoseReference[]>;
  removePose(id: string): Promise<PoseReference[]>;
}
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export interface ImageGuidance { references: string[]; poseImage?: string }
interface UploadedGuidance { references: { file: string; width: number; height: number }[]; pose?: string; catalog: ImageCatalog }
const PROFILES = Object.keys(IMAGE_PROFILES);
const PNG_LIMIT = 12 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let running = false;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

export function imageEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/i.test(value)) {
    throw new Error('Use a local ComfyUI address, such as http://127.0.0.1:8188.');
  }
  const url = new URL(value);
  if (url.port === '0') throw new Error('ComfyUI needs a valid port.');
  return url.origin;
}

/** Bounded PNG framing/IHDR check; the IPC boundary also decodes with Electron. */
export function imagePng(value: unknown, width?: number, height?: number): Buffer {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,') || value.length > Math.ceil(PNG_LIMIT / 3) * 4 + 22) {
    throw new Error('Use a PNG image smaller than 12 MB.');
  }
  const encoded = value.slice(22);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid PNG data.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 57 || bytes.length > PNG_LIMIT || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG header.');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  if (w < 64 || h < 64 || w > 1536 || h > 1536 || w % 8 || h % 8 || w * h > 2359296 || (width !== undefined && w !== width) || (height !== undefined && h !== height)) throw new Error('PNG dimensions must match the working size (64–1536, multiples of 8).');
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw new Error('Use an 8-bit RGB or RGBA PNG.');
  let offset = 8, hasPixels = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) throw new Error('Truncated PNG.');
    hasPixels ||= kind === 'IDAT' && length > 0;
    offset += length + 12;
    if (kind === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!hasPixels || !ended) throw new Error('Incomplete PNG.');
  return bytes;
}

export function imageRequest(value: unknown): WardrobeRequest {
  const raw = object(value);
  const keys = ['endpoint', 'profile', 'model', 'textEncoder', 'vae', 'prompt', 'negative', 'width', 'height', 'steps', 'cfg', 'seed', 'strength', 'image', 'mask', 'loras', 'content'];
  if (Object.keys(raw).some(key => !keys.includes(key)) || !PROFILES.includes(raw.profile as string)) throw new Error('Invalid image request or model profile.');
  const request: WardrobeRequest = {
    endpoint: imageEndpoint(raw.endpoint), profile: raw.profile as ImageProfile,
    model: text(raw.model, 'model', 512), textEncoder: text(raw.textEncoder, 'text encoder', 512, true), vae: text(raw.vae, 'VAE', 512, true),
    prompt: text(raw.prompt, 'prompt', 4000), negative: text(raw.negative, 'negative prompt', 4000, true),
    width: number(raw.width, 'width', 64, 1536, true), height: number(raw.height, 'height', 64, 1536, true),
    steps: number(raw.steps, 'steps', 1, 60, true), cfg: number(raw.cfg, 'guidance', 1, 15),
    seed: number(raw.seed, 'seed', 0, Number.MAX_SAFE_INTEGER, true), strength: number(raw.strength, 'strength', 0.1, 0.85),
  };
  if (request.width % 8 || request.height % 8 || request.width * request.height > 2359296) throw new Error('Use dimensions divisible by 8, up to 1536×1536.');
  if (raw.loras !== undefined) {
    if (!Array.isArray(raw.loras) || raw.loras.length > 4) throw new Error('Choose up to four LoRAs.');
    const names = new Set<string>();
    request.loras = Array.from(raw.loras, value => {
      const item = object(value);
      if (Object.keys(item).some(key => !['name', 'strengthModel', 'strengthClip'].includes(key))) throw new Error('Invalid LoRA option.');
      const lora: ImageLora = { name: text(item.name, 'LoRA name', 512), strengthModel: number(item.strengthModel, 'LoRA model strength', -2, 2) };
      if (item.strengthClip !== undefined) lora.strengthClip = number(item.strengthClip, 'LoRA text strength', -2, 2);
      if (!['sdxl', 'sd1'].includes(IMAGE_PROFILES[request.profile].family) && lora.strengthClip !== undefined && lora.strengthClip !== 0) throw new Error('Anima and Pony V7 LoRAs modify the diffusion model only; omit text strength.');
      if (names.has(lora.name)) throw new Error('Choose each LoRA only once.');
      names.add(lora.name);
      return lora;
    });
  }
  if (raw.content !== undefined) request.content = imageContent(raw.content);
  if ((raw.image !== undefined) !== (raw.mask !== undefined)) throw new Error('Editing needs both the source image and mask.');
  if (raw.image !== undefined) {
    imagePng(raw.image, request.width, request.height);
    imagePng(raw.mask, request.width, request.height);
    request.image = raw.image as string; request.mask = raw.mask as string;
  }
  return request;
}

function imageContent(value: unknown): WardrobeContentSettings {
  const raw = object(value);
  if (Object.keys(raw).some(key => !['adult', 'explicit', 'safety'].includes(key))) throw new Error('Invalid advanced image settings.');
  if (typeof raw.adult !== 'boolean') throw new Error('Invalid adult content setting.');
  return {
    adult: raw.adult,
    explicit: number(raw.explicit, 'explicit mode', 0, 100, true),
    safety: number(raw.safety, 'safety rails', 0, 100, true),
  };
}

// Exact split loaders: https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_anima_base_v1.json
// Preserve source in latents, then preserve unmasked pixels: https://github.com/Comfy-Org/ComfyUI/discussions/639
export function buildImageWorkflow(request: WardrobeRequest, uploaded?: { image: string; mask: string }, guidance?: UploadedGuidance): Graph {
  const preset = IMAGE_PROFILES[request.profile], anima = preset.family === 'anima', ponyV7 = preset.family === 'auraflow';
  if (preset.family === 'sd1' && guidance) throw Error('SD 1.x does not support the installed reference adapters. Use Anima Base for reference characters.');
  if (ponyV7 && guidance) throw Error('Pony V7 does not support the installed reference adapters. Use Anima Base for reference characters.');
  const graph: Graph = anima ? {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: request.model, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: request.textEncoder, type: 'stable_diffusion', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: request.vae } },
  } : { '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: request.model } } };
  if (ponyV7) {
    graph['2'] = { class_type: 'CLIPLoader', inputs: { clip_name: request.textEncoder, type: 'stable_diffusion', device: 'default' } };
    graph['3'] = { class_type: 'VAELoader', inputs: { vae_name: request.vae } };
  }
  let model: [string, number] = ['1', 0], clip: [string, number] = anima || ponyV7 ? ['2', 0] : ['1', 1];
  const vae = anima || ponyV7 ? ['3', 0] : ['1', 2];
  // Stock schemas: https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py (LoraLoader / LoraLoaderModelOnly).
  for (const [index, lora] of (request.loras ?? []).entries()) {
    const strengthClip = anima || ponyV7 ? 0 : lora.strengthClip ?? lora.strengthModel;
    if (lora.strengthModel === 0 && strengthClip === 0) continue;
    const id = String(30 + index);
    graph[id] = { class_type: anima || ponyV7 ? 'LoraLoaderModelOnly' : 'LoraLoader', inputs: {
      model, lora_name: lora.name, strength_model: lora.strengthModel,
      ...(anima || ponyV7 ? {} : { clip, strength_clip: strengthClip }),
    } };
    model = [id, 0];
    if (!anima && !ponyV7) clip = [id, 1];
  }
  if (request.profile === 'noob-vpred') {
    graph['4'] = { class_type: 'ModelSamplingDiscrete', inputs: { model, sampling: 'v_prediction', zsnr: true } };
    model = ['4', 0];
  }
  const ponyV6 = ['pony-v6', 'prefect-pony', 'autismmix'].includes(request.profile);
  if (ponyV6) {
    graph['40'] = { class_type: 'CLIPSetLastLayer', inputs: { clip, stop_at_clip_layer: -2 } };
    clip = ['40', 0];
  } else if (ponyV7) {
    graph['40'] = { class_type: 'T5TokenizerOptions', inputs: { clip, min_padding: 768, min_length: 768 } };
    clip = ['40', 0];
  }
  const spoken = composeWardrobePrompt(request);
  if (ponyV6 && !/\bscore_[0-9]/.test(spoken.prompt)) spoken.prompt = `score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, ${spoken.prompt}`;
  graph['5'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: spoken.prompt } };
  graph['6'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: spoken.negative } };
  let positive: [string, number] = ['5', 0], negative: [string, number] = ['6', 0];
  if (guidance) {
    if (!guidance.references.length) throw Error('A saved Haru appearance is required.');
    let images: [string, number] = ['102', 0];
    for (const [index, ref] of guidance.references.entries()) {
      const id = 100 + index * 4, scale = 512 / Math.max(ref.width, ref.height);
      const width = Math.max(1, Math.round(ref.width * scale)), height = Math.max(1, Math.round(ref.height * scale));
      graph[id] = { class_type: 'LoadImage', inputs: { image: ref.file } };
      graph[id + 1] = { class_type: 'ImageScale', inputs: { image: [String(id), 0], upscale_method: 'lanczos', width, height, crop: 'disabled' } };
      graph[id + 2] = { class_type: 'ImagePadForOutpaint', inputs: { image: [String(id + 1), 0], left: Math.floor((512 - width) / 2), right: Math.ceil((512 - width) / 2), top: Math.floor((512 - height) / 2), bottom: Math.ceil((512 - height) / 2), feathering: 0 } };
      if (index) { graph[id + 3] = { class_type: 'ImageBatch', inputs: { image1: images, image2: [String(id + 2), 0] } }; images = [String(id + 3), 0]; }
    }
    const c = guidance.catalog;
    if (anima) {
      graph['120'] = { class_type: 'AnimaIPAdapterLoader', inputs: { ip_adapter_name: supportFile(c.ipAdapters, SUPPORT_FILES.animaReference), auto_download: false } };
      graph['122'] = { class_type: 'AnimaIPAdapterApply', inputs: { model, ip_adapter: ['120', 0], ref_image: images, strength: request.image ? 1 : 0.75, ref_image_size: 512, siglip_layer: -1, ip_cfg_scale: 4, ip_cfg_separate: request.cfg === 1, gray_null: false, use_lora: true } };
    } else {
      graph['120'] = { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: supportFile(c.ipAdapters, SUPPORT_FILES.sdxlReference) } };
      graph['121'] = { class_type: 'CLIPVisionLoader', inputs: { clip_name: supportFile(c.clipVision, SUPPORT_FILES.vision) } };
      graph['122'] = { class_type: 'IPAdapterAdvanced', inputs: { model, ipadapter: ['120', 0], image: images, clip_vision: ['121', 0], weight: request.image ? 0.15 : 0.3, weight_type: 'linear', combine_embeds: 'average', start_at: 0, end_at: 0.7, embeds_scaling: 'V only' } };
    }
    model = ['122', 0];
    if (guidance.pose) {
      graph['123'] = { class_type: 'LoadImage', inputs: { image: guidance.pose } };
      graph['124'] = { class_type: 'ImageScale', inputs: { image: ['123', 0], upscale_method: 'bilinear', width: request.width, height: request.height, crop: 'disabled' } };
      if (anima) {
        graph['125'] = { class_type: 'ModelPatchLoader', inputs: { name: supportFile(c.patches, SUPPORT_FILES.animaPose) } };
        graph['126'] = { class_type: 'AnimaLLLiteApply', inputs: { model, model_patch: ['125', 0], image: ['124', 0], strength: 0.65, start_percent: 0, end_percent: 0.8 } };
        model = ['126', 0];
      } else {
        graph['125'] = { class_type: 'ControlNetLoader', inputs: { control_net_name: supportFile(c.controlNets, SUPPORT_FILES.sdxlPose) } };
        graph['126'] = { class_type: 'ControlNetApplyAdvanced', inputs: { positive, negative, control_net: ['125', 0], image: ['124', 0], strength: 0.65, start_percent: 0, end_percent: 0.8, vae } };
        positive = ['126', 0]; negative = ['126', 1];
      }
    }
  }
  if (request.image) {
    if (!uploaded) throw new Error('Source image and mask must be uploaded before editing.');
    graph['7'] = { class_type: 'LoadImage', inputs: { image: uploaded.image } };
    graph['8'] = { class_type: 'LoadImage', inputs: { image: uploaded.mask } };
    // Opaque masks have no alpha mask; extract red from their RGB pixels.
    graph['9'] = { class_type: 'ImageToMask', inputs: { image: ['8', 0], channel: 'red' } };
    graph['10'] = guidance ? { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['7', 0], vae, mask: ['9', 0], grow_mask_by: 0 } } : { class_type: 'VAEEncode', inputs: { pixels: ['7', 0], vae } };
    if (anima && guidance) {
      graph['15'] = { class_type: 'EmptyImage', inputs: { width: request.width, height: request.height, batch_size: 1, color: 8421504 } };
      graph['16'] = { class_type: 'ImageCompositeMasked', inputs: { destination: ['7', 0], source: ['15', 0], mask: ['9', 0], x: 0, y: 0, resize_source: false } };
      graph['10'] = { class_type: 'VAEEncodeTiled', inputs: { pixels: ['16', 0], vae, tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } };
    }
    graph['11'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['10', 0], mask: ['9', 0] } };
  } else graph['11'] = { class_type: 'EmptyLatentImage', inputs: { width: request.width, height: request.height, batch_size: 1 } };
  graph['12'] = { class_type: 'KSampler', inputs: {
    model, positive, negative, latent_image: ['11', 0],
    seed: request.seed, steps: request.steps, cfg: request.cfg,
    sampler_name: preset.sampler, scheduler: preset.scheduler,
    denoise: request.image ? request.strength : 1,
  } };
  graph['13'] = { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae } };
  if (anima && guidance) graph['13'] = { class_type: 'VAEDecodeTiled', inputs: { samples: ['12', 0], vae, tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } };
  if (request.image) graph['14'] = { class_type: 'ImageCompositeMasked', inputs: { destination: ['7', 0], source: ['13', 0], mask: ['9', 0], x: 0, y: 0, resize_source: false } };
  graph['20'] = { class_type: 'SaveImage', inputs: { images: [request.image ? '14' : '13', 0], filename_prefix: 'Haru/image' } };
  return graph;
}

async function responseBytes(url: string, init: RequestInit = {}, limit = 16 * 1024 * 1024): Promise<Buffer> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) limit = Math.min(limit, 64 * 1024);
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('ComfyUI response is too large.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('ComfyUI returned an empty response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) throw new Error('ComfyUI response is too large.');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks, length);
  if (!response.ok) {
    let detail = '', rejected = false;
    try {
      const body = object(JSON.parse(bytes.toString('utf8')));
      detail = JSON.stringify({ error: body.error, node_errors: body.node_errors }).slice(0, 1200);
      rejected = response.status === 400 && init.method === 'POST' && new URL(url).pathname === '/prompt' && !body.prompt_id && Boolean(body.error || (body.node_errors && Object.keys(object(body.node_errors)).length));
    } catch { /* Non-JSON errors still report their HTTP status. */ }
    throw new Error(`ComfyUI returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`, { cause: rejected ? 'invalid-prompt' : undefined });
  }
  return bytes;
}
async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  return object(JSON.parse((await responseBytes(url, init)).toString('utf8')));
}
export async function imageModels(endpoint: unknown): Promise<ImageCatalog> {
  const info = await json(`${imageEndpoint(endpoint)}/object_info`);
  function choices(node: string, input: string): string[] {
    if (!info[node]) return [];
    const definition = object(object(object(info[node]).input).required)[input];
    if (!Array.isArray(definition) || !Array.isArray(definition[0]) || definition[0].some(item => typeof item !== 'string')) throw new Error(`ComfyUI returned invalid ${node} choices.`);
    return [...new Set(definition[0] as string[])].sort();
  }
  return { checkpoints: choices('CheckpointLoaderSimple', 'ckpt_name'), diffusionModels: choices('UNETLoader', 'unet_name'), textEncoders: choices('CLIPLoader', 'clip_name'), vaes: choices('VAELoader', 'vae_name'), loras: [...new Set([...choices('LoraLoader', 'lora_name'), ...choices('LoraLoaderModelOnly', 'lora_name')])].sort(), nodes: Object.keys(info), ipAdapters: [...new Set([...choices('IPAdapterModelLoader', 'ipadapter_file'), ...choices('AnimaIPAdapterLoader', 'ip_adapter_name')])], clipVision: choices('CLIPVisionLoader', 'clip_name'), controlNets: choices('ControlNetLoader', 'control_net_name'), patches: choices('ModelPatchLoader', 'name') };
}
function relativeFile(value: Record<string, unknown>): { filename: string; subfolder: string } {
  const filename = text(value.filename ?? value.name, 'ComfyUI filename', 512);
  const subfolder = text(value.subfolder ?? '', 'ComfyUI subfolder', 512, true);
  if (/[\\/]/.test(filename) || !filename.toLowerCase().endsWith('.png') || /(^[\\/]|:|(?:^|[\\/])\.\.(?:[\\/]|$))/.test(subfolder)) throw new Error('ComfyUI returned an invalid image path.');
  return { filename, subfolder };
}
export async function upload(endpoint: string, bytes: Buffer): Promise<string> {
  const form = new FormData();
  form.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), `haru-${randomUUID()}.png`);
  form.set('type', 'input'); form.set('overwrite', 'false');
  const result = await json(`${endpoint}/upload/image`, { method: 'POST', body: form });
  if (result.type !== 'input') throw new Error('ComfyUI did not store the uploaded image as an input.');
  const file = relativeFile(result);
  return file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
}

export async function runImageJob(value: unknown, guidance?: ImageGuidance): Promise<WardrobeResult> {
  const request = imageRequest(value);
  return withImageEngine(async () => {
    const catalog = await imageModels(request.endpoint), anima = request.profile.startsWith('anima-');
    if (!(anima ? catalog.diffusionModels : catalog.checkpoints).includes(request.model) || ((anima || request.profile === 'pony-v7') && (!catalog.textEncoders.includes(request.textEncoder) || !catalog.vaes.includes(request.vae)))) throw new Error('The selected model files are no longer available. Refresh the model list.');
    if (request.loras?.some(lora => !catalog.loras.includes(lora.name))) throw new Error('A selected LoRA is no longer available. Refresh the model list.');
    if (guidance) {
      const missing = guidanceMissing(catalog, request.profile, !!guidance.poseImage);
      if (missing.length) throw Error(`Appearance/pose support is missing: ${missing.join(', ')}. Run wardrobe support setup and restart the engine.`);
    }
    const uploaded = request.image ? { image: await upload(request.endpoint, imagePng(request.image)), mask: await upload(request.endpoint, imagePng(request.mask)) } : undefined;
    const refs: UploadedGuidance['references'] = [];
    for (const image of guidance?.references || []) { const bytes = imagePng(image); refs.push({ file: await upload(request.endpoint, bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }); }
    const pose = guidance?.poseImage ? await upload(request.endpoint, imagePng(guidance.poseImage)) : undefined;
    const prompt = buildImageWorkflow(request, uploaded, guidance ? { references: refs, pose, catalog } : undefined);
    const execution = await executeImageGraph(request.endpoint, prompt);
    try {
      const image = await outputImage(request.endpoint, execution.outputs, '20');
      imagePng(image, request.width, request.height);
      return { image, seed: request.seed, promptId: execution.promptId };
    } catch (error) { throw Error(`${error instanceof Error ? error.message : 'Invalid result'}. ComfyUI job: ${execution.promptId}.`); }
  });
}

// ponytail: one GPU job at a time; add a queue if concurrent callers become useful.
export async function withImageEngine<T>(action: () => Promise<T>): Promise<T> {
  if (running) throw new Error('Haru already has an image job running.');
  running = true;
  try { return await action(); } finally { running = false; }
}

export async function outputImage(endpoint: string, outputs: Record<string, unknown>, node: string): Promise<string> {
  const output = object(outputs[node]);
  if (!Array.isArray(output.images) || !output.images.length) throw Error('The job finished without a saved image.');
  const image = object(output.images[0]);
  if (image.type !== 'output') throw Error('ComfyUI returned an unexpected output type.');
  const query = new URLSearchParams({ ...relativeFile(image), type: 'output' });
  const bytes = await responseBytes(`${endpoint}/view?${query}`, {}, PNG_LIMIT);
  const data = `data:image/png;base64,${bytes.toString('base64')}`;
  imagePng(data); return data;
}

export async function executeImageGraph(endpoint: string, prompt: Graph): Promise<{ promptId: string; outputs: Record<string, unknown> }> {
  imageEndpoint(endpoint);
  let promptId: string | undefined, submitted = false;
  try {
    submitted = true;
    const queued = await json(`${endpoint}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: randomUUID() }) });
    if (typeof queued.prompt_id === 'string' && /^[\w-]{1,128}$/.test(queued.prompt_id)) promptId = queued.prompt_id;
    if (queued.error || (queued.node_errors && Object.keys(object(queued.node_errors)).length)) {
      if (!promptId) submitted = false;
      throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify({ error: queued.error, node_errors: queued.node_errors }).slice(0, 1200)}`);
    }
    if (!promptId) throw new Error('ComfyUI did not return a valid job ID.');
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const history = await json(`${endpoint}/history/${encodeURIComponent(promptId)}`);
      if (history[promptId]) {
        const entry = object(history[promptId]), status = entry.status ? object(entry.status) : {};
        const failure = Array.isArray(status.messages) && status.messages.find(message => Array.isArray(message) && ['execution_error', 'execution_interrupted'].includes(message[0]));
        if (failure || status.status_str === 'error') throw new Error(`Image execution failed: ${JSON.stringify(failure || status).slice(0, 800)}`);
        if (status.completed === true) {
          return { promptId, outputs: object(entry.outputs) };
        }
      }
      await delay(2000);
    }
    throw new Error('Stopped waiting after 15 minutes; the job may still be running in ComfyUI.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image job failed.';
    const rejected = error instanceof Error && error.cause === 'invalid-prompt';
    throw new Error(`${message}${promptId ? ` ComfyUI job: ${promptId}. Check that job before retrying.` : submitted && !rejected ? ' Submission may have reached ComfyUI; inspect its queue before retrying.' : ''}`);
  }
}

export function registerImageEditorIPC(settings: ImageSettings): void {
  // Lazy loading keeps workflow and local HTTP checks runnable with plain Node.
  const { ipcMain, dialog, nativeImage, app } = require('electron') as typeof import('electron');
  function decoded(value: unknown, mask = false): Buffer {
    const bytes = imagePng(value), image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty() || image.getSize().width !== bytes.readUInt32BE(16) || image.getSize().height !== bytes.readUInt32BE(20)) throw new Error('PNG could not be decoded.');
    const pixels = image.toBitmap();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] !== 255) throw new Error('Flatten transparency before editing.');
      if (mask && (pixels[offset] !== pixels[offset + 1] || pixels[offset] !== pixels[offset + 2])) throw new Error('Use a grayscale edit mask.');
    }
    return bytes;
  }
  ipcMain.handle('imageEditor:models', (_event, endpoint: unknown) => imageModels(endpoint));
  const { registerAvatarWardrobe } = require('./avatarWardrobe') as typeof import('./avatarWardrobe');
  registerAvatarWardrobe(settings, decoded);
  ipcMain.handle('imageEditor:save', async (_event, value: unknown) => {
    const bytes = decoded(value);
    const chosen = await dialog.showSaveDialog({ title: 'Save Haru image', defaultPath: path.join(app.getPath('pictures'), `Haru-${Date.now()}.png`), filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (chosen.canceled || !chosen.filePath) return null;
    if (path.extname(chosen.filePath).toLowerCase() !== '.png') throw new Error('Choose a .png filename.');
    await writeFile(chosen.filePath, bytes);
    return chosen.filePath;
  });
}
