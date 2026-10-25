import type { ImageCatalog, ImageProfile } from './imageEditor';
import { IMAGE_PROFILES } from './imageProfiles';

export const SUPPORT_FILES = { segmentation: 'sam3.1_multiplex_fp16.safetensors', sdxlReference: 'ip-adapter-plus_sdxl_vit-h.safetensors', vision: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors', sdxlPose: 'xinsir-openpose-sdxl.safetensors', animaReference: 'anima-ip-adapter.safetensors', animaPose: 'anima-lllite-pose-1.safetensors' };
export function supportFile(files: string[] | undefined, name: string): string {
  return files?.find(file => file.split(/[\\/]/).pop() === name) || name;
}
export function recipeIssue(profile: ImageProfile, operation: 'clothing' | 'scene'): string {
  if (IMAGE_PROFILES[profile].family === 'sd1') return 'This SD 1.x preset supports prompt creation and masked edits. Its reference and pose adapters are unavailable; use Anima Base for reference characters.';
  if (profile === 'pony-v7') return 'Pony V7 supports prompt-based creation and manual masked edits. Its reference and pose adapters are unavailable; use Anima Base for reference characters.';
  if (profile === 'anima-turbo') return 'Anima Turbo is unavailable: its reference guidance kept the old outfit during validation. Use Anima Base for clothing and scenes.';
  if (operation === 'scene' && !profile.startsWith('anima-')) return 'Pose & scene is unavailable for this preset: its reference adapter did not retain the saved character reliably in validation. Use Change clothes or an available Anima preset.';
  return '';
}
export function guidanceMissing(catalog: ImageCatalog, profile: ImageProfile, pose = false): string[] {
  if (IMAGE_PROFILES[profile].family === 'sd1') return ['SD 1.x reference adapter (not supported)'];
  if (profile === 'pony-v7') return ['Pony V7 reference adapter (not supported)'];
  const anima = profile.startsWith('anima-'), missing: string[] = [];
  const requireNode = (name: string) => { if (!catalog.nodes?.includes(name)) missing.push(name); };
  const requireFile = (files: string[] | undefined, name: string) => { if (!files?.includes(supportFile(files, name))) missing.push(name); };
  requireNode(anima ? 'AnimaIPAdapterApply' : 'IPAdapterAdvanced');
  requireNode(anima ? 'AnimaIPAdapterLoader' : 'IPAdapterModelLoader');
  requireFile(catalog.ipAdapters, anima ? SUPPORT_FILES.animaReference : SUPPORT_FILES.sdxlReference);
  if (!anima) requireFile(catalog.clipVision, SUPPORT_FILES.vision);
  if (pose) { requireNode(anima ? 'AnimaLLLiteApply' : 'ControlNetApplyAdvanced'); requireFile(anima ? catalog.patches : catalog.controlNets, anima ? SUPPORT_FILES.animaPose : SUPPORT_FILES.sdxlPose); }
  return missing;
}
