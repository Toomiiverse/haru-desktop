import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMLookAtBoneApplier, type VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { SmugSequence } from '../companion/smug';
import { ReferenceSequence } from '../companion/referenceSequence';
import { referenceClip, referenceFaceChannels, referenceChannel } from '../companion/referenceClips';
import { ReferencePose } from '../companion/referencePose';
import { ReferenceSecondaryMotion } from '../companion/referenceSecondaryMotion';
import { ReferenceBodyMotion } from '../companion/referenceBodyMotion';
import { FaceDriver } from '../companion/face';
import type { MouthReading } from '../companion/mouth';
import type { Gaze } from '../companion/behaviour';
import { avatarClipEntries } from '../companion/avatar';
import { performancePack, facialClip } from '../companion/performances';
import { bindWardrobe } from '../companion/vrmWardrobe';
import { bindWatch } from '../companion/watch';
import { PerchPose } from '../companion/perchPose';
import { FallPose, fallReaction } from '../companion/fallPose';
import { ArmSmear } from '../companion/armSmear';
import { DesktopPose, desktopGaze } from '../companion/desktopPose';
import { DesktopOcclusion } from '../companion/desktopOcclusion';
import type { DesktopScene } from '../../electron/desktopAwareness';
import { jumpFrame, fallFrame, type PerchJump, type PerchFall } from '../../electron/perching';
import { EarAnimator, type EarFeeling } from '../companion/ears';

export type VRMHandle = {
  vrm: VRM;
  expressions: string[];
  expression(name: string | null): void;
  play(name: string): void;
  hitTest(x:number,y:number): boolean;
};
interface Props {
  source: string;
  className?: string;
  onError(message: string): void;
  onReady(handle: VRMHandle | null): void;
  onFit(width: number): void;
  onPlacement?(metrics:{seat:number;feet:number;head:number;halfWidth:number;reduced:boolean}):void;
  read(): { mouth: MouthReading; gaze: Gaze; wardrobe?: Record<string, number>; ears?: EarFeeling; seated?:boolean; jump?:PerchJump|null; fall?:PerchFall|null; walking?:number; walkingSpeed?:number; desktop?:DesktopScene|null };
}

// Avatar primitive: the existing loading label and parent error/empty states apply.
// Pointer controls stay on CompanionWindow's existing hitbox and dialogue.
export function VRMCanvas({ source, className = '', onError, onReady, onFit, onPlacement, read }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const callbacks = useRef({ onError, onReady, onFit, onPlacement, read });
  callbacks.current = { onError, onReady, onFit, onPlacement, read };
  useEffect(() => {
    let disposed = false, frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let vrm: VRM | undefined;
    let armSmear: ArmSmear | undefined;
    let desktopOcclusion: DesktopOcclusion | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let faceMixer: THREE.AnimationMixer | undefined;
    let observer: ResizeObserver | undefined;
    let wardrobe: Awaited<ReturnType<typeof bindWardrobe>> | undefined;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let reportedReduced=motion.matches;
    setLoading(true);
    async function start() {
      const container = host.current;
      if (!container) return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor(0, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      desktopOcclusion = new DesktopOcclusion(scene);
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(1, 2, 3); scene.add(key);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      const loaded = await loader.loadAsync(source);
      const avatar: VRM | undefined = loaded.userData.vrm;
      if (!avatar) { VRMUtils.deepDispose(loaded.scene); throw Error('This file has no VRM avatar rig.'); }
      if (disposed) { VRMUtils.deepDispose(avatar.scene); return; }
      vrm = avatar;
      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.combineSkeletons(vrm.scene);
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse(object => { object.frustumCulled = false; });
      scene.add(vrm.scene);
      const outfitResponse = await fetch(new URL('wardrobe.json', source));
      if (outfitResponse.ok) {
        wardrobe = await bindWardrobe(await outfitResponse.json(), loaded);
        if (disposed) { wardrobe.dispose(); return; }
        wardrobe.apply(callbacks.current.read().wardrobe);
      } else if (outfitResponse.status !== 404) throw Error('Could not load the avatar wardrobe.');
      const watch = await bindWatch(loaded);
      watch?.update();
      // A safe resting fallback for VRMs without an animation pack.
      vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, -1.08);
      vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, 1.08);
      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const foot = vrm.humanoid.getNormalizedBoneNode('leftFoot');
      if (!head || !foot) throw Error('The avatar is missing its head or foot mapping.');
      const headY = head.getWorldPosition(new THREE.Vector3()).y;
      const footY = foot.getWorldPosition(new THREE.Vector3()).y;
      const bounds = new THREE.Box3().setFromObject(vrm!.scene, true);
      const floorY = Number.isFinite(bounds.min.y) ? bounds.min.y : footY;
      const height = Math.max(.1, bounds.max.y - floorY, (headY - footY) * 1.16);
      const perchPose=new PerchPose(vrm);
      const fallPose=new FallPose(vrm);
      const desktopPose=new DesktopPose(vrm);
      const standingJumpBones=Object.values(vrm.humanoid.normalizedHumanBones).map(bone=>bone.node);
      armSmear=new ArmSmear(vrm);
      const hipY=vrm.humanoid.getNormalizedBoneNode('hips')!.getWorldPosition(new THREE.Vector3()).y;
      // Measure the seated garment/body underside, rather than putting the edge
      // through the hip joint. Keep hair, tail and dangling straps out of contact.
      perchPose.update(true,0,true);vrm.update(0);vrm.scene.updateMatrixWorld(true);
      const hipPoint=vrm.humanoid.getRawBoneNode('hips')!.getWorldPosition(new THREE.Vector3());
      const supportBones=new Set((['hips','leftUpperLeg','rightUpperLeg'] as const).map(name=>vrm!.humanoid.getRawBoneNode(name)));
      let seatY=hipY-height*.075;
      vrm.scene.traverse(object=>{
        const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
        for(let n:THREE.Object3D|null=mesh;n;n=n.parent)if(!n.visible)return;
        const joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
        if(!joints||!weights)return;
        mesh.skeleton.update();const point=new THREE.Vector3();
        for(let i=0;i<joints.count;i++) {
          let support=0;for(let k=0;k<4;k++)if(supportBones.has(mesh.skeleton.bones[joints.getComponent(i,k)]))support+=weights.getComponent(i,k);
          if(support<.5)continue;
          mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
          if(Math.abs(point.x-hipPoint.x)<height*.16 && point.z<hipPoint.z+height*.025 && point.y>hipY-height*.22)seatY=Math.min(seatY,point.y);
        }
      });
      // Let the soft seat fabric settle closer to the window's top border.
      seatY+=height*.02;
      perchPose.restore();perchPose.update(false,0,true);vrm.update(0);
      function fit() {
        if (!renderer || !container) return;
        const width = Math.max(1, container.clientWidth), pixels = Math.max(1, container.clientHeight);
        const aspect = width / pixels;
        const span = Math.max(height / .86, height * .72 / aspect);
        camera.left = -span * aspect / 2; camera.right = -camera.left;
        camera.top = span / 2; camera.bottom = -camera.top;
        const middle = floorY + span / 2 - height * .035;
        camera.position.set(0, middle, height * 3);
        camera.lookAt(0, middle, 0); camera.updateProjectionMatrix();
        renderer.setSize(width, pixels);
        const drawn = Math.min(width, height * .46 / span * pixels);
        document.documentElement.style.setProperty('--haru-width', Math.round(drawn) + 'px');
        callbacks.current.onFit(drawn);
        const fraction=(y:number)=>(1-new THREE.Vector3(0,y,0).project(camera).y)/2;
        reportedReduced=motion.matches;
        callbacks.current.onPlacement?.({seat:fraction(seatY),feet:fraction(floorY),head:fraction(bounds.max.y),halfWidth:.19,reduced:motion.matches});
      }
      fit(); observer = new ResizeObserver(fit); observer.observe(container);
      mixer = new THREE.AnimationMixer(vrm.scene);
      faceMixer = new THREE.AnimationMixer(vrm.scene);
      const clips: Record<string, THREE.AnimationClip> = {};
      const manifestResponse = await fetch(new URL('clips.json', source));
      if (manifestResponse.ok) {
        const entries = avatarClipEntries(await manifestResponse.json());
        const clipLoader = new GLTFLoader();
        clipLoader.register(parser => new VRMAnimationLoaderPlugin(parser));
        for (const [name, relative] of entries) {
          if (disposed) return;
          const asset = await clipLoader.loadAsync(new URL(relative, source).href);
          const animation = asset.userData.vrmAnimations?.[0];
          if (!animation) throw Error('Animation ' + name + ' has no humanoid animation.');
          const clip = createVRMAnimationClip(animation, vrm);
          if (!clip.tracks.length) throw Error('Animation ' + name + ' did not bind to the avatar.');
          clip.name = name; clips[name] = clip;
        }
      } else if (manifestResponse.status !== 404) {
        throw Error('Could not load the avatar animation pack (' + manifestResponse.status + ').');
      }
      if (disposed) return;
      const faces: Record<string, THREE.AnimationClip> = {};
      const faceBindings: { binding:THREE.PropertyBinding & {getValue(buffer:Float32Array,offset:number):void;setValue(buffer:Float32Array,offset:number):void}; neutral:Float32Array; quaternion:boolean; morph:boolean }[] = [];
      const faceSamplers = new Map<THREE.AnimationAction, THREE.Interpolant[]>();
      const events: Record<string, string> = {};
      const labels: Record<string, string> = {};
      const loopingClips = new Set<string>();
      const mouthChannels: {mesh:THREE.Mesh;index:number}[] = [];
      const performances = await fetch(new URL('performances.json',source));
      if (performances.ok) {
        const pack = performancePack(await performances.json());
        const clipLoader = new GLTFLoader(); clipLoader.register(parser=>new VRMAnimationLoaderPlugin(parser));
        for (const entry of pack.clips) {
          if (disposed) return;
          const asset = await clipLoader.loadAsync(new URL(entry.body,source).href);
          const animation = asset.userData.vrmAnimations?.[0];
          if (!animation) throw Error('Preset '+entry.label+' has no body animation.');
          const body = createVRMAnimationClip(animation,vrm);
          if (!body.tracks.length) throw Error('Preset '+entry.label+' did not bind to the avatar.');
          const response = await fetch(new URL(entry.face,source));
          if (!response.ok) throw Error('Could not load the face for '+entry.label+'.');
          const face = await facialClip(await response.json(),loaded,body.duration);
          const name = 'fbx-'+entry.id; body.name=name; clips[name]=body; faces[name]=face.clip;
          labels[entry.label]=name; labels['FBX '+entry.label]=name;
          if (entry.loop) loopingClips.add(name);
          if(!faceBindings.length) for(const track of face.clip.tracks) {
            const binding=THREE.PropertyBinding.create(vrm.scene,track.name) as (typeof faceBindings)[number]['binding'];
            const neutral=new Float32Array(track.getValueSize());binding.getValue(neutral,0);
            faceBindings.push({binding,neutral,quaternion:track.ValueTypeName==='quaternion',morph:track.name.includes('morphTargetInfluences')});
          }
          if (!mouthChannels.length) mouthChannels.push(...face.mouth);
        }
        for(const [event,id] of Object.entries(pack.events)) events[event]='fbx-'+id;
      } else if(performances.status!==404) throw Error('Could not load the preset performances.');
      if (disposed) return;
      // The existing app gaze already combines pointer, screen-watching and
      // attention signals. Let the resting avatar respond to that same target.
      if(Object.keys(events).length && vrm.lookAt?.applier instanceof VRMLookAtBoneApplier) {
        const a=vrm.lookAt.applier;
        for(const map of [a.rangeMapHorizontalInner,a.rangeMapHorizontalOuter]) {map.inputMaxValue=30;map.outputScale=12;}
        for(const map of [a.rangeMapVerticalDown,a.rangeMapVerticalUp]) {map.inputMaxValue=30;map.outputScale=8;}
      }
      const attention={x:0,y:0},eyeAttention={x:0,y:0};
      const attentionBones=([['neck',.25],['head',.75]] as const).flatMap(([name,weight])=>{
        const bone=vrm!.humanoid.getNormalizedBoneNode(name);
        return bone?[{bone,weight,base:bone.quaternion.clone(),rest:bone.quaternion.clone()}]:[];
      });
      const eyes=[] as {bone:THREE.Object3D;base:THREE.Quaternion;followers:THREE.Object3D[]}[];
      for(const [name,followers] of [['leftEye',['DEF-Eye.L.002','DEF-Eye_Shine03','DEF-Eye_Shine04']],['rightEye',['DEF-Eye_Shine01','DEF-Eye_Shine02']]] as const) {
        const bone=vrm.humanoid.getRawBoneNode(name);if(!bone)continue;
        // This source rig keeps iris highlights as siblings of the eye bones.
        const nodes:THREE.Object3D[]=[];
        for(const label of followers) {
          const index=loaded.parser.json.nodes?.findIndex((n:{name?:string})=>n.name===label)??-1;
          if(index>=0) {const node=await loaded.parser.getDependency('node',index);if(node.parent===bone.parent)nodes.push(node);}
        }
        eyes.push({bone,base:bone.quaternion.clone(),followers:nodes});
      }
      const earNodes: { bone: THREE.Object3D; side: number }[] = [];
      for (const [name, side] of [['Ear.L', 1], ['Ear.R', -1]] as const) {
        const index = loaded.parser.json.nodes?.findIndex((node: { name?: string }) => node.name === name) ?? -1;
        if (index >= 0) earNodes.push({ bone: await loaded.parser.getDependency('node', index), side });
      }
      vrm.scene.updateMatrixWorld(true);
      const ears = new EarAnimator(earNodes);
      const neutralEars: EarFeeling = { emotion: 'neutral', strength: 0, listening: false, sleepiness: 0 };
      const eyeDelta=new THREE.Quaternion();
      const attentionRotation=new THREE.Quaternion(),attentionEuler=new THREE.Euler(0,0,0,'YXZ'),attentionTarget=new THREE.Vector3();
      const resting = events.neutral ?? (clips.neutral ? 'neutral' : clips.settle ? 'settle' : '');
      loopingClips.add(resting);
      let current: THREE.AnimationAction | undefined;
      let currentFace: THREE.AnimationAction | undefined;

      const smug=new SmugSequence();
      const reference=new ReferenceSequence();
      const referencePose=new ReferencePose(vrm,wardrobe?.hands);
      const referenceSecondary=new ReferenceSecondaryMotion(vrm);
      const referenceBody=new ReferenceBodyMotion();
      const hasReferences=referenceFaceChannels.every(name=>!!vrm!.expressionManager?.getExpression(referenceChannel(name)));
      const hasSmugSequence=!!vrm.expressionManager?.getExpression('Wolfram Smug.parted.mouth');
      let manualFace = false;
      let lastAutomaticAt = -Infinity;
      const lastAutomaticClip = new Map<string,number>();
      const active = new Set<THREE.AnimationAction>();
      let blend: { elapsed:number; duration:number; weights:Map<THREE.AnimationAction,number> } | undefined;
      const driver = new FaceDriver({ has: name => !!vrm?.expressionManager?.getExpression(name) });
      function play(requested: string) {
        const idleRequest=['glance','tilt','fidget','yawn','sigh','settle','doze','stretch','think'].includes(requested);
        if(Object.keys(events).length && idleRequest && (!events[requested] || (current && current.getClip().name!==resting))) return;
        const name = labels[requested] ?? events[requested] ?? requested;
        if (!mixer || !clips[name]) return;
        const next = mixer.clipAction(clips[name]);
        if (next === current) return;
        const now=performance.now();
        if(name!==resting && !labels[requested] && !requested.startsWith('fbx-')) {
          if(now-lastAutomaticAt<20000 || now-(lastAutomaticClip.get(name)??-Infinity)<60000) {
            if(vrm?.expressionManager?.getExpression(requested)) {manualFace=true;driver.show(requested,{yaw:0,pitch:0},now);}
            return;
          }
          lastAutomaticAt=now;lastAutomaticClip.set(name,now);
        }
        const nextFace = faces[name] ? faceMixer!.clipAction(faces[name]) : undefined;
        const first=active.size===0;
        const weights = new Map([...active].map(action=>[action,action.getEffectiveWeight()]));
        for(const action of [next,nextFace]) if(action) {
          // Keep the breathing phase running under a gesture. Reactivating an
          // outgoing action also preserves its sampled pose during interruptions.
          if(!active.has(action)) {
            action.reset().setEffectiveWeight(first ? 1 : 0).setEffectiveTimeScale(1);
            action.setLoop(loopingClips.has(name)?THREE.LoopRepeat:THREE.LoopOnce,loopingClips.has(name)?Infinity:1);
            action.clampWhenFinished=true;action.play();active.add(action);
          }
          weights.set(action,weights.get(action)??(first?1:0));
        }
        if(nextFace && !faceSamplers.has(nextFace)) faceSamplers.set(nextFace,nextFace.getClip().tracks.map(t=>t.InterpolantFactoryMethodLinear()));
        current=next;currentFace=nextFace;manualFace=false;smug.clear(now,motion.matches);reference.clear(now,motion.matches);driver.show(null,{yaw:0,pitch:0},now);
        // A decisive arrival and a slower recovery: ease the blend itself,
        // retaining the imported performance's anticipation and facial timing.
        blend=first?undefined:{elapsed:0,duration:name===resting?.7:Math.min(.28,clips[name].duration*.35),weights};
      }
      play(resting); mixer.update(0);
      for(const {bone,base} of attentionBones) base.copy(bone.quaternion);
      vrm.update(0);
      const handle: VRMHandle = {
        vrm,
        expressions: Object.keys(vrm.expressionManager?.expressionMap ?? {}).filter(name => !name.startsWith('FBX ') && !labels[name] && !/\.(eyes|brows|mouth)$/.test(name)),
        expression: name => {
          const now=performance.now();
          if(name && hasReferences && referenceClip(name)){driver.show(null,{yaw:0,pitch:0},now);smug.clear(now,motion.matches);reference.start(name,now,motion.matches);return;}
          reference.clear(now,motion.matches);
          if(name==='Wolfram Smug' && hasSmugSequence){driver.show(null,{yaw:0,pitch:0},now);smug.start(now,motion.matches);return;}
          smug.clear(now,motion.matches);
          if(name && (labels[name] || events[name]))play(name);
          else {manualFace=manualFace || !!name;driver.show(name,{yaw:0,pitch:0},now);}
        },
        play,
        hitTest(x,y) {
          const w=container!.clientWidth,h=container!.clientHeight;
          if(desktopOcclusion?.contains(x,y,w,h))return false;
          const project=(name:Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0])=>{
            const node=vrm!.humanoid.getNormalizedBoneNode(name);if(!node)return null;
            const p=node.getWorldPosition(new THREE.Vector3()).project(camera);return {x:(p.x+1)*w/2,y:(1-p.y)*h/2};
          };
          const segments=[['head','head',.085],['neck','hips',.09],['leftUpperArm','leftHand',.068],['rightUpperArm','rightHand',.068],['hips','leftLowerLeg',.075],['hips','rightLowerLeg',.075],['leftLowerLeg','leftFoot',.068],['rightLowerLeg','rightFoot',.068]] as const;
          return segments.some(([from,to,radius])=>{
            const a=project(from),b=project(to);if(!a||!b)return false;
            const dx=b.x-a.x,dy=b.y-a.y,t=THREE.MathUtils.clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
            return Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<height*radius/(camera.top-camera.bottom)*h;
          });
        },
      };
      callbacks.current.onReady(handle);
      container.dataset.avatarReady = 'true';
      container.dataset.boundTracks = String(Object.values(clips).reduce((sum, clip) => sum + clip.tracks.length, 0));
      console.info('[avatar] VRM loaded; ' + Object.keys(clips).length + ' body clips, ' + container.dataset.boundTracks + ' tracks, ' + handle.expressions.length + ' expressions');
      setLoading(false);
      let previous = performance.now(), blinkAt = previous + 3100;
      function tick(now: number) {
        if (disposed || !vrm || !renderer || !mixer) return;
        frame = requestAnimationFrame(tick);
        if (now - previous < 1000 / 30 - .5) return;
        const delta = Math.min(.1, (now - previous) / 1000); previous = now;
        // Electron can defer media-query events in an unfocused transparent window.
        // The running frame loop keeps native travel and body motion in agreement.
        if(reportedReduced!==motion.matches)fit();
        const step=motion.matches?0:delta;
        if(current && !loopingClips.has(current.getClip().name) && current.time>=current.getClip().duration) play(resting);
        if(blend) {
          blend.elapsed+=step;
          const u=Math.min(1,blend.elapsed/blend.duration);
          const eased=u*u*u*(10+u*(-15+6*u));
          for(const action of active) action.setEffectiveWeight(THREE.MathUtils.lerp(blend.weights.get(action)??0,action===current||action===currentFace?1:0,eased));
          if(u===1) {
            for(const action of active) if(action!==current && action!==currentFace && action.getClip()!==clips[resting] && action.getClip()!==faces[resting]) {action.stop();active.delete(action);}
            blend=undefined;
          }
        }
        // Remove last frame's offset before the mixer evaluates: constant
        // authored channels must not accumulate procedural neck rotation.
        referenceSecondary.restore();
        fallPose.restore();
        desktopPose.restore();
        referencePose.restore();
        perchPose.restore();
        for(const {bone,base} of attentionBones) bone.quaternion.copy(base);
        ears.restore();
        wardrobe?.restore();
        mixer.update(step);
        const inputs = callbacks.current.read();
        const fall=inputs.fall && !inputs.seated && !inputs.jump?fallFrame(inputs.fall,Date.now(),motion.matches):null;
        const fallWeight=fallReaction(fall);
        const attentionWeight=motion.matches?0:(clips[resting]?mixer.clipAction(clips[resting]).getEffectiveWeight():1);
        const gaze=desktopGaze(inputs.desktop,inputs.gaze,inputs.mouth.weight<.05 && !inputs.ears?.listening && !fall && !inputs.jump);
        const gx=Number.isFinite(gaze.x)?THREE.MathUtils.clamp(gaze.x,-1,1):0;
        const gy=Number.isFinite(gaze.y)?THREE.MathUtils.clamp(gaze.y,-1,1):0;
        for(const [value,rate] of [[attention,4.5],[eyeAttention,14]] as const) {
          value.x=THREE.MathUtils.damp(value.x,gx,rate,step);value.y=THREE.MathUtils.damp(value.y,gy,rate,step);
        }
        const smugFrame=smug.update(now,motion.matches);
        const refFrame=reference.update(now,motion.matches),ref=refFrame.channels;
        const total=smugFrame.weight+refFrame.weight,faceWeight=1-(1-Math.min(1,total))*(1-fallWeight),smugGain=(1-fallWeight)/Math.max(1,total),refGain=refFrame.weight*(1-fallWeight)/Math.max(1,total);
        const refMotion=motion.matches?0:refGain;
        const body=referenceBody.update({weight:refGain,channels:ref},delta,motion.matches);
        const gazeWeight=attentionWeight*(1-.85*faceWeight);
        for(const {bone,base,rest,weight} of attentionBones) {
          base.copy(bone.quaternion);
          bone.quaternion.slerp(rest,THREE.MathUtils.clamp(body.channels.stillness??0,0,1)*body.weight);
          attentionEuler.set((-attention.y*.12*gazeWeight+smugFrame.pitch*smugGain+(body.channels.headX??0)*body.weight)*weight,(attention.x*.22*gazeWeight+smugFrame.yaw*smugGain+(body.channels.headY??0)*body.weight)*weight,(smugFrame.roll*smugGain+(body.channels.headZ??0)*body.weight)*weight);
          bone.quaternion.multiply(attentionRotation.setFromEuler(attentionEuler));
        }
        const out = driver.update(motion.matches ? now+1000 : now);
        // Retain the face layer until its outgoing channels have finished fading.
        if(manualFace && driver.current===null && Object.values(out.weights).every(weight=>weight===0))manualFace=false;
        const performing = [...faceSamplers].some(([action])=>active.has(action)&&action.getEffectiveWeight()>0);
        const manager = vrm.expressionManager;
        manager?.resetValues();
        const speaking = Math.max(0, Math.min(1, inputs.mouth.weight));
        for (const [name, weight] of Object.entries(manualFace ? out.weights : {})) {
          // A speech viseme takes ownership of mouth channels only.
          manager?.setValue(name, weight * (1-faceWeight) * (name.endsWith('.mouth') ? 1 - speaking : 1));
        }
        if(hasSmugSequence) {
          manager?.setValue('Wolfram Smug.eyes',smugFrame.eyes*smugGain);
          manager?.setValue('Wolfram Smug.mouth',smugFrame.smile*smugGain*(1-speaking));
          manager?.setValue('Wolfram Smug.parted.mouth',smugFrame.parted*smugGain*(1-speaking));
        }
        if(hasReferences)for(const name of referenceFaceChannels){const channel=referenceChannel(name);manager?.setValue(channel,(ref[name]??0)*refGain*(channel.endsWith('.mouth')?1-speaking:1));}
        const blinkTime = now - blinkAt;
        const blink = motion.matches ? 0 : blinkTime < 0 ? 0 : blinkTime < 66 ? .5 : blinkTime < 133 ? 1 : blinkTime < 200 ? .5 : 0;
        if (blinkTime > 230) blinkAt = now + 3000 + Math.random() * 2200;
        manager?.setValue('blink', Math.max(blink, out.blink)*(1-faceWeight));
        manager?.setValue('aa', inputs.mouth.open * speaking);
        if(fallWeight){
          const eyes=referenceChannel('Eyes Surprised');
          if(manager?.getExpression(eyes)){
            manager.setValue(eyes,(manager.getValue(eyes)??0)+.78*fallWeight);
            manager.setValue('oh',.28*fallWeight*(1-speaking));
          }else manager?.setValue('surprised',fallWeight*(1-speaking));
        }
        wardrobe?.applyPose(inputs.wardrobe, delta, motion.matches);
        const jump=inputs.jump?jumpFrame(inputs.jump,Date.now(),motion.matches):null;
        // Top-edge visits share the jump, then unfold into a standing peek.
        // Capture native standing channels before the temporary seated jump rig.
        const jumpRelease=!inputs.seated && jump && (jump.phase==='land' || jump.phase==='seated')?Math.min(1,jump.progress):0;
        const jumpHome=jumpRelease?{weight:jumpRelease*jumpRelease*(3-2*jumpRelease),hip:vrm.humanoid.getNormalizedBoneNode('hips')!.position.clone(),rotations:standingJumpBones.map(bone=>bone.quaternion.clone())}:null;
        perchPose.update(inputs.seated===true || !!jump,delta,motion.matches,jump,Math.max(ref.leftArm??0,ref.rightArm??0)*refMotion);
        referencePose.update({weight:refGain,channels:ref},inputs.seated===true,fall?.phase==='fall' || !!jump && jump.phase!=='seated' && jump.phase!=='land',motion.matches,body);
        if(jumpHome){standingJumpBones.forEach((bone,i)=>bone.quaternion.slerp(jumpHome.rotations[i],jumpHome.weight));vrm.humanoid.getNormalizedBoneNode('hips')!.position.lerp(jumpHome.hip,jumpHome.weight);}
        const walkSpeed=Number.isFinite(inputs.walkingSpeed)?inputs.walkingSpeed!*(camera.top-camera.bottom)/(camera.zoom*Math.max(1,container!.clientHeight)):undefined;
        desktopPose.update(inputs.walking??0,inputs.desktop,inputs.seated===true || !!inputs.jump || !!fall && fall.phase!=='done',delta,Date.now(),motion.matches,walkSpeed);
        fallPose.update(fall,motion.matches);
        vrm.update(delta);
        // Native brows, eye aim and morphs are evaluated after the VRM face layer.
        // Both mixers receive the same delta, so the face follows the original FBX timing.
        const speechValues = speaking>0 ? mouthChannels.map(({mesh,index})=>mesh.morphTargetInfluences![index]) : [];
        const faceBase = faceBindings.map(({binding,neutral,morph})=>{const v=neutral.slice();if(morph)binding.getValue(v,0);return v;});
        faceMixer?.update(step);
        // The VRM expression manager writes every frame. Reapply held facial samples too;
        // AnimationMixer normally skips constant values, which otherwise loses a held grin.
        const liveFaces=[...faceSamplers].filter(([a])=>a.isScheduled()&&a.getEffectiveWeight()>0);
        if(liveFaces.length) faceBindings.forEach(({binding,neutral,quaternion,morph},i)=>{
          if(morph && (manualFace || faceWeight>0)){binding.setValue(faceBase[i],0);return;}
          const total=liveFaces.reduce((sum,[a])=>sum+a.getEffectiveWeight(),0);
          const value=neutral.slice();
          if(morph) value.set(faceBase[i]);
          let used=Math.max(0,1-total);
          if(!quaternion) for(let j=0;j<value.length;j++) value[j]*=used;
          for(const [action,samplers] of liveFaces) {
            const sample=samplers[i].evaluate(action.time),weight=action.getEffectiveWeight();
            if(quaternion) value.set(new THREE.Quaternion().fromArray(value).slerp(new THREE.Quaternion().fromArray(sample),weight/(used+weight)).toArray());
            else for(let j=0;j<value.length;j++) value[j]+=sample[j]*weight;
            used+=weight;
          }
          binding.setValue(value,0);
        });
        // Native performance gaze fades into the environment gaze with the
        // body's rest weight. Eye response leads the smaller neck/head follow.
        if(vrm.lookAt && attentionWeight>0) {
          for(const {bone,base} of eyes) base.copy(bone.quaternion);
          head!.getWorldPosition(attentionTarget);
          attentionTarget.x+=eyeAttention.x*1.4*(1-.85*faceWeight)+(ref.gazeX??0)*refMotion;attentionTarget.y+=eyeAttention.y*.8*(1-.85*faceWeight)+(ref.gazeY??0)*refMotion;attentionTarget.z+=2;
          vrm.lookAt.lookAt(attentionTarget);vrm.lookAt.update(step);
          for(const {bone,base,followers} of eyes) {
            eyeDelta.copy(base).invert();
            bone.quaternion.copy(base.slerp(bone.quaternion,attentionWeight));
            eyeDelta.premultiply(bone.quaternion);
            for(const node of followers) {
              node.position.sub(bone.position).applyQuaternion(eyeDelta).add(bone.position);
              node.quaternion.premultiply(eyeDelta);
            }
          }
        }
        container!.dataset.perching=String(inputs.seated===true && (!jump || jump.phase==='seated' || jump.phase==='land'));
        container!.dataset.perchPhase=jump?.phase ?? (inputs.seated?'seated':'standing');
        container!.dataset.fallPhase=fall?.phase??'none';
        container!.dataset.fallWeight=String(fallWeight);
        container!.dataset.walkWeight=String(desktopPose.walkWeight);
        container!.dataset.walkFacing=String(inputs.walking??0);
        container!.dataset.peekWeight=String(desktopPose.peekWeight);
        container!.dataset.peekEdge=desktopPose.peekEdge;
        container!.dataset.attentionWeight=String(attentionWeight);
        container!.dataset.clip = current?.getClip().name ?? '';
        container!.dataset.animationFrame = String(Math.round((current?.time??0)*30)+1);
        container!.dataset.faceFrame = String(Math.round((currentFace?.time??0)*30)+1);
        container!.dataset.referenceClip=reference.currentName??'';
        container!.dataset.referenceWeight=String(refGain);
        if (performing && speaking>0) mouthChannels.forEach(({mesh,index},i)=>{
          mesh.morphTargetInfluences![index]=THREE.MathUtils.lerp(mesh.morphTargetInfluences![index],speechValues[i],speaking);
        });
        ears.update(fallWeight?{...neutralEars,emotion:'surprised',strength:fallWeight}:inputs.ears ?? neutralEars, now / 1000, delta, motion.matches);
        wardrobe?.apply(inputs.wardrobe);
        perchPose.applyTorso();
        fallPose.applySecondary(delta,motion.matches);
        referencePose.applyClothing();
        referenceSecondary.update({weight:Math.max(refGain,referenceBody.activity,perchPose.secondaryWeight,fallWeight,fallPose.activity,desktopPose.activity),channels:{...ref,secondary:1,airflow:fall?.phase==='fall'?fallWeight*(.2+.8*fall.progress):0}},delta,motion.matches);
        watch?.update();
        armSmear?.update(fall?.phase==='land' && fallPose.activity>0,delta,motion.matches);
        desktopOcclusion?.update(inputs.desktop,camera);
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(tick);
    }
    void start().catch(error => { if (!disposed) callbacks.current.onError(error instanceof Error ? error.message : 'Could not load the 3D avatar.'); });
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect();
      callbacks.current.onReady(null); mixer?.stopAllAction(); faceMixer?.stopAllAction();
      armSmear?.dispose();
      desktopOcclusion?.dispose();
      if (vrm) { mixer?.uncacheRoot(vrm.scene); faceMixer?.uncacheRoot(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
      wardrobe?.dispose();
      renderer?.dispose(); renderer?.domElement.remove();
    };
  }, [source]);
  return <div className={'live2d-canvas-host ' + className} ref={host} aria-label="3D companion avatar" aria-busy={loading}>
    {loading && <small role="status">Loading avatar…</small>}
  </div>;
}

