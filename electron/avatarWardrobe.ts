import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ImageLibrary, type ImageSettings, type HaruAppearance } from './imageLibrary';
import { recipeIssue } from './wardrobeSupport';
import { imageEndpoint, imagePng, imageRequest, imageModels, runImageJob, upload, executeImageGraph, outputImage, withImageEngine, supportFile, SUPPORT_FILES, type AvatarJobRequest, type Graph, type ClothingSelection, type WardrobeAPI } from './imageEditor';

export function clothingGraph(file: string, checkpoint: string): Graph {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'LoadImage', inputs: { image: file } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'clothes:8, scarf, belt, shoes:2, socks:2' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'hair:2, face, bare skin:6, hands:2' } },
    '5': { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], conditioning: ['3', 0], threshold: 0.5, refine_iterations: 2, individual_masks: false } },
    '6': { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], conditioning: ['4', 0], threshold: 0.5, refine_iterations: 2, individual_masks: false } },
    '10': { class_type: 'GrowMask', inputs: { mask: ['5', 0], expand: 4, tapered_corners: true } },
    '7': { class_type: 'MaskComposite', inputs: { destination: ['10', 0], source: ['6', 0], x: 0, y: 0, operation: 'subtract' } },
    '8': { class_type: 'MaskToImage', inputs: { mask: ['7', 0] } },
    '9': { class_type: 'MaskToImage', inputs: { mask: ['6', 0] } },
    '20': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'Haru/selection' } },
    '21': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'Haru/protected' } },
  };
}
export function characterGraph(file: string, checkpoint: string): Graph {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'LoadImage', inputs: { image: file } },
    // SAM3 otherwise keeps only one detection. Union every detected person, including face and hair.
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'person:100' } },
    // Decoder refinement added background specks on the validated anime portrait; use the detector silhouette.
    '5': { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], conditioning: ['3', 0], threshold: 0.5, refine_iterations: 0, individual_masks: false } },
    '8': { class_type: 'MaskToImage', inputs: { mask: ['5', 0] } },
    '20': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'CharacterStudio/characters' } },
  };
}
export async function detectCharacters(address: unknown, image: unknown, decoded: (image: unknown, mask?: boolean) => Buffer): Promise<string> {
  const endpoint = imageEndpoint(address), bytes = decoded(image);
  return withImageEngine(async () => {
    const catalog = await imageModels(endpoint), checkpoint = supportFile(catalog.checkpoints, SUPPORT_FILES.segmentation);
    if (!catalog.nodes?.includes('SAM3_Detect') || !catalog.checkpoints.includes(checkpoint)) throw Error('Automatic character detection needs SAM3 support installed and an image engine restart. You can use Brush fine tuning meanwhile.');
    const { outputs } = await executeImageGraph(endpoint, characterGraph(await upload(endpoint, bytes), checkpoint));
    const mask = await outputImage(endpoint, outputs, '20');
    imagePng(mask, bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    const { nativeImage } = require('electron') as typeof import('electron');
    const pixels = nativeImage.createFromBuffer(decoded(mask, true)).toBitmap();
    if (!pixels.some((value, index) => index % 4 === 0 && value > 0)) throw Error('No characters were detected. Choose a clearer image or use Brush fine tuning to select the character.');
    return mask;
  });
}
export function poseGraph(file: string, width: number, height: number): Graph {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: file } },
    '2': { class_type: 'DWPreprocessor', inputs: { image: ['1', 0], detect_hand: 'enable', detect_body: 'enable', detect_face: 'disable', resolution: 768, bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384.onnx', scale_stick_for_xinsr_cn: 'enable' } },
    '3': { class_type: 'ImageScale', inputs: { image: ['2', 0], upscale_method: 'bilinear', width, height, crop: 'disabled' } },
    '20': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'Haru/pose' } },
  };
}
export function validatePoseOutput(output: unknown): void {
  const values = (output as { openpose_json?: unknown })?.openpose_json;
  if (!Array.isArray(values) || typeof values[0] !== 'string') throw Error('No pose was returned. Choose a clear picture of one person.');
  const frames = JSON.parse(values[0]) as { people?: { pose_keypoints_2d?: number[] }[] }[];
  if (!Array.isArray(frames) || frames.length !== 1 || frames[0].people?.length !== 1) throw Error('Use a reference with exactly one clearly visible person.');
  const keys = frames[0].people[0].pose_keypoints_2d;
  if (!Array.isArray(keys) || keys.filter((v, i) => i % 3 === 2 && Number.isFinite(v) && v > 0.2).length < 8) throw Error('The pose is unclear. Use a reference with the body and limbs visible.');
}
export function subtractProtection(mask: Uint8Array, protection: Uint8Array): number {
  if (mask.length !== protection.length || mask.length % 4) throw Error('Selection dimensions do not match.');
  let changed = 0;
  for (let i = 0; i < mask.length; i += 4) {
    const value = Math.max(0, mask[i] - protection[i]);
    mask[i] = mask[i + 1] = mask[i + 2] = value; mask[i + 3] = 255;
    if (value) changed++;
  }
  return changed;
}
export function avatarPrompt(appearance: HaruAppearance, operation: string, outfit: string, pose: string, situation: string, anima = false): string {
  const parts = ['solo', outfit.trim(), appearance.notes, operation === 'clothing' ? '' : [pose, situation].filter(Boolean).join(', '), 'anime illustration'];
  if (anima && operation === 'clothing') parts.push('same pose, same composition, same background');
  const prompt = parts.filter(Boolean).join(', ');
  if (prompt.length > 4000) throw Error('The combined character details, description, tags and scenario exceed 4,000 characters. Shorten one of these fields.');
  return prompt;
}

export function createAvatarWardrobe(library: ImageLibrary, decoded: (image: unknown, mask?: boolean) => Buffer, onChanged: () => void, getAppearance: () => Promise<HaruAppearance> = () => library.appearance()): Omit<WardrobeAPI, 'models' | 'save' | 'onAppearanceChanged'> {
  const results = new Map<string, { revision: string; image: string }>();
  const selections = new Map<string, ClothingSelection & { revision: string; source: string }>();
  const fingerprint = (image: string) => createHash('sha256').update(image).digest('hex');
  const notify = () => { selections.clear(); results.clear(); onChanged(); };
  async function snapshot(revision: string) {
    const appearance = await getAppearance();
    if (!appearance.primary || !appearance.references.length) throw Error('Add a saved character appearance first.');
    if (appearance.revision !== revision) throw Error('The appearance has changed. Reopen the wardrobe to load it.');
    const unreadable = appearance.references.find(ref => !ref.image);
    if (unreadable) throw Error(`Replace or remove “${unreadable.name}” in appearance settings; its saved image cannot be read.`);
    return appearance;
  }
  function source(appearance: HaruAppearance, id?: string): string {
    if (!id || id === appearance.primary) return appearance.references.find(ref => ref.id === appearance.primary)!.image;
    const previous = results.get(id);
    if (!previous || previous.revision !== appearance.revision) throw Error('This working picture is no longer available. Return to the saved appearance.');
    return previous.image;
  }
  return {
  appearance: getAppearance,
  importAppearance: async (image, name, replace) => { decoded(image); const result = await library.import(image, name, replace); notify(); return result; },
  updateAppearance: async change => { const result = await library.update(change); notify(); return result; },
  poses: () => library.poses(),
  removePose: id => library.removePose(id),
  addPose: (address, image, name) => withImageEngine(async () => {
    const endpoint = imageEndpoint(address), bytes = decoded(image);
    const catalog = await imageModels(endpoint);
    if (!catalog.nodes?.includes('DWPreprocessor')) throw Error('Pose detection needs wardrobe support setup and an engine restart.');
    const graph = poseGraph(await upload(endpoint, bytes), bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    const { outputs } = await executeImageGraph(endpoint, graph);
    validatePoseOutput(outputs['2']);
    const skeleton = await outputImage(endpoint, outputs, '20'); decoded(skeleton);
    return library.addPose(image, skeleton, name);
  }),
  selectClothing: (address, revision, sourceId) => withImageEngine(async () => {
    const endpoint = imageEndpoint(address), appearance = await snapshot(revision), image = source(appearance, sourceId);
    const catalog = await imageModels(endpoint), checkpoint = supportFile(catalog.checkpoints, SUPPORT_FILES.segmentation);
    if (!catalog.nodes?.includes('SAM3_Detect') || !catalog.checkpoints.includes(checkpoint)) throw Error('Automatic selection needs wardrobe support setup. You can still paint the clothes manually.');
    const { outputs } = await executeImageGraph(endpoint, clothingGraph(await upload(endpoint, decoded(image)), checkpoint));
    const mask = await outputImage(endpoint, outputs, '20'), protectedImage = await outputImage(endpoint, outputs, '21');
    const bytes = imagePng(image); imagePng(mask, bytes.readUInt32BE(16), bytes.readUInt32BE(20)); imagePng(protectedImage, bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    decoded(mask, true); decoded(protectedImage, true);
    const selection = { id: randomUUID(), mask, protected: protectedImage };
    if (selections.size >= 4) selections.delete(selections.keys().next().value!);
    selections.set(selection.id, { ...selection, revision, source: fingerprint(image) });
    return selection;
  }),
  run: async value => {
    if (!value || typeof value !== 'object' || !['clothing', 'scene'].includes(value.operation)) throw Error('Choose Change clothes or Pose & scene.');
    const { operation, appearanceRevision, outfit, pose, situation, sourceId, selectionId, poseId, protectionMask, ...options } = value;
    for (const description of [outfit, pose, situation]) if (typeof description !== 'string' || description.length > 2000) throw Error('Outfit, pose and situation must each be shorter than 2,000 characters.');
    if (!outfit.trim() && (operation === 'clothing' || (!pose.trim() && !situation.trim() && !poseId))) throw Error('Describe an outfit, pose or situation first.');
    if ('image' in options || 'prompt' in options) throw Error('The wardrobe always uses the saved character appearance.');
    const appearance = await snapshot(appearanceRevision);
    const image = operation === 'clothing' ? source(appearance, sourceId) : undefined;
    let mask = options.mask;
    if (image) {
      const { nativeImage } = require('electron') as typeof import('electron');
      const bytes = imagePng(image), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      imagePng(mask, width, height); const bitmap = nativeImage.createFromBuffer(decoded(mask, true));
      const selection = selectionId ? selections.get(selectionId) : undefined;
      if (selectionId && (!selection || selection.revision !== appearanceRevision || selection.source !== fingerprint(image))) throw Error('The clothing selection is stale. Select the clothes again.');
      const keep = protectionMask || selection?.protected;
      const pixels = bitmap.toBitmap();
      let changed: number;
      if (keep) { imagePng(keep, width, height); changed = subtractProtection(pixels, nativeImage.createFromBuffer(decoded(keep, true)).toBitmap()); }
      else changed = pixels.filter((pixel, i) => i % 4 === 0 && pixel > 0).length;
      if (!changed) throw Error('Select some clothes outside the protected features first.');
      mask = nativeImage.createFromBitmap(pixels, { width, height }).toDataURL();
      options.width = width; options.height = height;
    } else if (mask || selectionId || protectionMask) throw Error('Pose & scene does not use a clothing mask.');
    let poseImage: string | undefined;
    if (poseId && operation === 'scene') {
      const ref = (await library.poses()).find(p => p.id === poseId);
      if (!ref) throw Error('Choose an available saved pose.');
      if (!ref.skeleton) throw Error('This saved pose cannot be read. Remove it and upload it again.');
      poseImage = ref.skeleton;
    }
    const request = imageRequest({ ...options, mask, image, prompt: avatarPrompt(appearance, operation, outfit, pose, situation, typeof options.profile === 'string' && options.profile.startsWith('anima-')) });
    const issue = recipeIssue(request.profile, operation);
    if (issue) throw Error(issue);
    const result = await runImageJob(request, { references: [appearance.references.find(ref => ref.id === appearance.primary)!, ...appearance.references.filter(ref => ref.id !== appearance.primary)].map(ref => ref.image), poseImage });
    decoded(result.image);
    const id = randomUUID(); if (results.size >= 4) results.delete(results.keys().next().value!);
    results.set(id, { revision: appearanceRevision, image: result.image });
    return { ...result, sourceId: id, appearanceRevision };
  },
  };
}

export function registerAvatarWardrobe(settings: ImageSettings, decoded: (image: unknown, mask?: boolean) => Buffer): void {
  const { ipcMain, app, BrowserWindow } = require('electron') as typeof import('electron');
  const wardrobe = createAvatarWardrobe(new ImageLibrary(path.join(app.getPath('userData'), 'appearance'), settings), decoded, () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('imageEditor:appearanceChanged');
  });
  ipcMain.handle('imageEditor:appearance', () => wardrobe.appearance());
  ipcMain.handle('imageEditor:importAppearance', (_e, image: string, name: string, replace?: string) => wardrobe.importAppearance(image, name, replace));
  ipcMain.handle('imageEditor:updateAppearance', (_e, change: { primary?: string; notes?: string; remove?: string }) => wardrobe.updateAppearance(change));
  ipcMain.handle('imageEditor:poses', () => wardrobe.poses());
  ipcMain.handle('imageEditor:removePose', (_e, id: string) => wardrobe.removePose(id));
  ipcMain.handle('imageEditor:addPose', (_e, address: string, image: string, name: string) => wardrobe.addPose(address, image, name));
  ipcMain.handle('imageEditor:selectClothing', (_e, address: string, revision: string, sourceId?: string) => wardrobe.selectClothing(address, revision, sourceId));
  ipcMain.handle('imageEditor:run', (_e, request: AvatarJobRequest) => wardrobe.run(request));
}
