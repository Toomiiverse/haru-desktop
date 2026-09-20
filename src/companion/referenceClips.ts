import type { EmotionName } from '../types';

export type ReferenceClip={name:string;tag:EmotionName;duration:number;hold?:number;loop?:boolean;source:number;description:string;interpolation?:'linear';keys:{t:number;channels:Record<string,number>}[]};
type Channels=Record<string,number>;
// Sparse authoring keys carry their previous values forward. Runtime keys are complete.
const clip=(source:number,name:string,tag:EmotionName,duration:number,description:string,keys:[number,Channels][],hold?:number):ReferenceClip=>{
  const names=new Set(keys.flatMap(([,values])=>Object.keys(values)));
  let state=Object.fromEntries([...names].map(name=>[name,0]));
  return {source,name,tag,duration,description,hold,keys:keys.map(([t,values])=>({t,channels:state={...state,...values}}))};
};
const closed={'Eyes Sleep':0,'Eyes Smile2':1},browsHappy={'Eyebrows Happy_L':.22,'Eyebrows Happy_R':.22};
const sad={'Eyebrows Sad_L':.38,'Eyebrows Sad_R':.38};

// Independent acting curves retain their own timing: a lip beat must not stop an arm arc.
// Sample at the reference's 30 fps, then interpolate linearly in the running renderer.
function facepalmKeys():[number,Channels][] {
  const curves:Record<string,[number,number][]>= {
    stillness:[[0,.86]], rightArm:[[0,1]], secondary:[[0,1]],
    rightX:[[0,-.25],[.80,-.25],[.87,-.31],[.933,-.28],[1.03,-.21]],
    rightY:[[0,.16],[.80,.16],[.833,.30],[.90,.44],[.967,.53],[1.03,.57]],
    rightZ:[[0,.13],[.80,.13],[.867,.30],[.933,.34],[1.03,.28]],
    rightWristY:[[0,1.5708],[.80,1.5708],[.90,2.7],[1.03,3.14159]],
    rightWristZ:[[0,3.14159],[.80,3.14159],[.90,1.10],[1.03,.60]],
    rightCurl:[[0,.26],[.80,.26],[.933,.07]],
    rightContact:[[0,0],[1.0,0],[1.10,1]],
    rightContactX:[[0,-.13]],rightContactY:[[0,0]],rightContactZ:[[0,.165]],
    rightContactWristX:[[0,0]],rightContactWristY:[[0,3.14159]],rightContactWristZ:[[0,.60]],
    rightSplay:[[0,0],[.80,0],[.967,.80]],
    rightIndexCurl:[[0,.26],[.80,.26],[.967,.02]],
    rightMiddleCurl:[[0,.26],[.80,.26],[.967,.07]],
    rightRingCurl:[[0,.26],[.967,.14]],rightLittleCurl:[[0,.26],[.967,.26]],
    rightThumbCurl:[[0,.26],[.80,.26],[.967,.08]],
    rightPoleX:[[0,-.38],[.80,-.38],[1.03,-.46]],
    rightPoleY:[[0,-.08],[.80,-.08],[1.03,.28]],rightPoleZ:[[0,-.20],[.80,-.20],[1.03,.26]],
    rightShoulderLift:[[0,0],[.53,0],[.78,.16],[1.02,.37],[1.35,.42],[1.75,.31],[2.93,.32]],
    rightShoulderForward:[[0,0],[.53,0],[.82,.10],[1.18,.23],[1.48,.20],[1.85,.15],[2.93,.16]],
    leftShoulderLift:[[0,0],[.60,0],[.93,-.10],[1.35,-.13],[1.75,-.08],[2.93,-.09]],
    leftShoulderForward:[[0,0],[.62,0],[1.02,-.11],[1.38,-.15],[1.80,-.11],[2.93,-.11]],
    headX:[[0,-.015],[.60,-.03],[.80,-.067],[1.00,.040],[1.20,.18],[1.43,.274],[1.75,.25],[2.35,.264],[2.93,.262]],
    headY:[[0,.015],[.65,.025],[.80,.04],[.967,-.132],[1.07,-.25],[1.23,-.48],[1.43,-.66],[1.75,-.645],[2.45,-.654],[2.93,-.650]],
    headZ:[[0,.01],[.78,-.025],[1.03,.025],[1.43,.10],[1.75,.088],[2.93,.092]],
    weightX:[[0,0],[.53,0],[.72,-.040],[.95,-.093],[1.18,-.093],[1.6,-.085],[2.93,-.088]],
    weightY:[[0,0],[.53,0],[.73,-.021],[.95,-.018],[1.55,-.009],[2.93,-.009]],
    weightZ:[[0,0],[.53,0],[.78,.012],[1.2,.005],[1.6,0],[2.93,0]],
    hipYaw:[[0,0],[.53,0],[.90,.035],[1.5,.028],[2.93,.028]],
    hipRoll:[[0,0],[.55,0],[.95,-.037],[1.5,-.034],[2.93,-.034]],
    hipPitch:[[0,0],[.53,0],[.78,.013],[1.25,-.017],[1.65,-.011],[2.93,-.011]],
    turn:[[0,0],[.53,0],[.78,-.101],[.98,-.169],[1.42,-.196],[1.75,-.186],[2.93,-.189]],
    lean:[[0,0],[.53,0],[.76,.035],[1.15,.061],[1.48,.070],[1.85,.057],[2.93,.061]],
    sway:[[0,0],[.53,0],[.90,.085],[1.25,.081],[1.65,.068],[2.93,.070]],
    chestTurn:[[0,0],[.63,0],[1.03,-.066],[1.45,-.119],[1.8,-.106],[2.93,-.109]],
    chestLean:[[0,0],[.67,0],[1.04,.024],[1.44,.050],[1.8,.041],[2.93,.043]],
    chestSway:[[0,0],[.65,0],[.96,.014],[1.3,.027],[1.65,.016],[2.93,.019]],
    gazeX:[[0,0],[.85,0],[1.10,-.35],[1.53,-1.35],[2.93,-1.32]],
    gazeY:[[0,0],[1.05,0],[1.53,-.45]],
    'Eyes Sleep':[[0,.22],[.73,.18],[1.03,.58],[1.20,.66],[1.53,.55],[2.93,.55]],
    'Eyebrows Happy_L':[[0,.08],[.80,.16],[1.53,.18]],
    'Eyebrows Happy_R':[[0,.08],[.80,.16],[1.53,.18]],
    'Mouth Smile2':[[0,.12],[.50,.14],[.80,.27],[1.13,.22],[1.5,.30],[1.85,.26],[2.3,.28],[2.93,.29]],
    'vrc.v_aa':[[0,0],[.57,0],[.70,.055],[.80,0],[1.03,0],[1.13,.075],[1.27,.015],[1.37,.06],[1.53,0],[1.72,.025],[1.91,0],[2.10,.03],[2.30,0],[2.52,.065],[2.73,.015],[2.93,0]],
  };
  return actingKeys(curves,2.93);
}

function actingKeys(curves:Record<string,[number,number][]>,duration:number):[number,Channels][] {
  const value=(keys:[number,number][],t:number)=> {
    const j=keys.findIndex(([time])=>time>t);
    if(j<0)return keys[keys.length-1][1];if(j===0)return keys[0][1];
    const a=keys[j-1],b=keys[j],span=b[0]-a[0],u=(t-a[0])/span;
    const tangent=(i:number)=> {
      if(i===0||i===keys.length-1)return 0;
      const p=keys[i-1],c=keys[i],n=keys[i+1],h0=c[0]-p[0],h1=n[0]-c[0];
      const d0=(c[1]-p[1])/h0,d1=(n[1]-c[1])/h1;
      return d0*d1<=0?0:3*(h0+h1)/((2*h1+h0)/d0+(h1+2*h0)/d1);
    };
    return (2*u**3-3*u*u+1)*a[1]+(u**3-2*u*u+u)*span*tangent(j-1)+(-2*u**3+3*u*u)*b[1]+(u**3-u*u)*span*tangent(j);
  };
  return Array.from({length:Math.ceil(duration*30)+1},(_,i)=>{
    const t=Math.min(i/30,duration),c=Object.fromEntries(Object.entries(curves).map(([name,keys])=>[name,value(keys,t)]));
    // The torso leads while she still addresses the viewer; preserve the authored
    // head direction rather than adding the torso's entire turn on top of it.
    c.headY=(c.headY??0)-((c.hipYaw??0)+(c.turn??0)+(c.chestTurn??0));
    c.headX=(c.headX??0)-((c.hipPitch??0)+(c.lean??0)+(c.chestLean??0));
    c.headZ=(c.headZ??0)-((c.hipRoll??0)+(c.sway??0)+(c.chestSway??0));
    return [t,c];
  });
}

function warmSmileKeys():[number,Channels][] {
  return actingKeys({
    stillness:[[0,.65]], secondary:[[0,1]],
    rightArm:[[0,0],[.90,0],[1.02,1]],
    rightX:[[0,-.335],[.90,-.335],[1.04,-.38],[1.16,-.28],[1.32,-.17],[1.48,-.16],[4.16,-.16]],
    rightY:[[0,-.12],[.90,-.12],[1.04,.10],[1.16,.29],[1.32,.40],[1.48,.39],[4.16,.39]],
    rightZ:[[0,.055],[.90,.055],[1.05,.29],[1.17,.36],[1.32,.33],[1.48,.32],[4.16,.32]],
    rightWristX:[[0,0],[1.1,0],[1.42,.05]],
    rightWristY:[[0,1.5708],[.95,1.5708],[1.18,1.30],[1.42,1.65]],
    rightWristZ:[[0,3.14159],[.95,3.14159],[1.18,.20],[1.42,-.15]],
    rightCurl:[[0,.20],[1.04,.20],[1.20,.13],[1.42,.45]],
    rightIndexCurl:[[0,.20],[1.20,.08],[1.42,.38]],
    rightMiddleCurl:[[0,.20],[1.20,.12],[1.42,.47]],
    rightRingCurl:[[0,.20],[1.20,.17],[1.42,.55]],
    rightLittleCurl:[[0,.20],[1.20,.22],[1.42,.62]],
    rightThumbCurl:[[0,.20],[1.20,.10],[1.42,.38]],
    rightSplay:[[0,0],[1.08,0],[1.23,.45],[1.50,.20]],
    rightPoleX:[[0,-.48],[.90,-.48],[1.16,-.40],[1.42,-.36]],rightPoleY:[[0,-.08],[.95,-.08],[1.30,.02]],rightPoleZ:[[0,.12],[1.25,.22]],
    rightShoulderLift:[[0,0],[.86,0],[1.12,.20],[1.35,.29],[1.62,.11],[1.94,.22],[2.25,.135],[2.60,.185],[3.02,.15],[3.50,.17],[4.16,.16]],
    rightShoulderForward:[[0,0],[.90,0],[1.20,.12],[1.58,.05],[1.94,.085],[2.35,.060],[2.85,.074],[4.16,.067]],
    leftShoulderLift:[[0,0],[.93,0],[1.25,.090],[1.58,-.015],[1.91,.05],[2.25,.004],[2.60,.033],[3.02,.012],[3.50,.023],[4.16,.018]],
    leftShoulderForward:[[0,0],[.90,0],[1.28,-.05],[1.68,-.035],[4.16,-.035]],
    headX:[[0,0],[.85,0],[1.14,-.10],[1.48,-.040],[1.80,-.077],[2.13,-.046],[2.48,-.066],[2.90,-.051],[3.40,-.061],[4.16,-.055]],
    headY:[[0,0],[.90,0],[1.27,.025],[1.60,.020],[4.16,.020]],
    headZ:[[0,0],[.94,0],[1.30,-.095],[1.63,-.079],[2.35,-.083],[4.16,-.081]],
    weightX:[[0,0],[.88,0],[1.30,.028],[1.68,.019],[2.05,.024],[2.50,.020],[4.16,.021]],
    // A knee compression drives the lift, followed by progressively smaller rebounds.
    weightY:[[0,0],[.80,0],[.96,-.025],[1.23,-.002],[1.53,-.018],[1.85,-.003],[2.18,-.012],[2.53,-.004],[2.92,-.009],[3.34,-.004],[3.78,-.007],[4.16,-.005]],
    hipYaw:[[0,0],[.90,0],[1.30,-.012],[1.70,-.009],[4.16,-.009]],
    turn:[[0,0],[.87,0],[1.22,.072],[1.50,.084],[1.85,.073],[4.16,.075]],
    lean:[[0,0],[.87,0],[1.19,-.056],[1.54,-.019],[1.88,-.044],[2.22,-.025],[2.60,-.038],[3.04,-.028],[3.52,-.034],[4.16,-.031]],
    sway:[[0,0],[.91,0],[1.30,-.025],[1.75,-.018],[4.16,-.018]],
    chestTurn:[[0,0],[.92,0],[1.32,.026],[1.72,.018],[4.16,.019]],
    chestLean:[[0,0],[.88,0],[1.27,-.043],[1.62,-.013],[1.96,-.033],[2.31,-.018],[2.69,-.028],[3.13,-.021],[3.62,-.025],[4.16,-.023]],
    chestSway:[[0,0],[.98,0],[1.32,-.016],[1.70,-.010],[4.16,-.011]],
    'Eyes Sleep':[[0,.03],[.96,0],[1.08,.12],[1.20,0]],
    'Eyes Smile':[[0,0],[1.00,0],[1.08,.58],[1.17,1],[4.16,1]],
    'Mouth Smile3':[[0,.06],[.92,.06],[1.08,.40],[1.23,.56],[1.55,.50],[2.5,.53],[4.16,.52]],
    'Eyebrows Happy_L':[[0,0],[.95,0],[1.16,.18],[1.55,.15],[4.16,.15]],
    'Eyebrows Happy_R':[[0,0],[.95,0],[1.16,.18],[1.55,.15],[4.16,.15]],
  },4.16);
}

function proudKeys():[number,Channels][] {
  return actingKeys({
    stillness:[[0,.70]],secondary:[[0,1]],
    rightArm:[[0,1]],leftArm:[[0,0],[2.08,0],[2.28,1]],
    rightX:[[0,-.23],[2.08,-.23],[2.35,-.28],[2.84,-.26]],
    rightY:[[0,.12],[2.08,.12],[2.37,.07],[2.84,.035]],
    rightZ:[[0,.23],[2.08,.23],[2.37,.27],[2.84,.23]],
    rightWristY:[[0,3.14159],[2.08,3.14159],[2.80,2.40]],rightWristZ:[[0,2.49],[2.08,2.49],[2.80,3.14159]],
    rightCurl:[[0,.18]],rightIndexCurl:[[0,.12]],rightMiddleCurl:[[0,.16]],rightRingCurl:[[0,.20]],rightLittleCurl:[[0,.25]],rightThumbCurl:[[0,.20]],rightSplay:[[0,.22]],
    rightPoleX:[[0,-.45],[2.08,-.45],[2.80,-.38]],
    rightPoleY:[[0,-.02],[2.08,-.02],[2.80,-.10]],rightPoleZ:[[0,.15],[2.08,.15],[2.80,.20]],
    leftX:[[0,.335],[2.08,.335],[2.15,.40],[2.23,.35],[2.42,.25]],
    leftY:[[0,-.12],[2.08,-.12],[2.15,-.03],[2.23,.10],[2.42,.18]],
    leftZ:[[0,.055],[2.08,.055],[2.15,.10],[2.23,.18],[2.42,.17]],
    leftWristY:[[0,-1.5708]],leftWristZ:[[0,3.14159]],
    leftCurl:[[0,.18]],leftIndexCurl:[[0,.12]],leftMiddleCurl:[[0,.16]],leftRingCurl:[[0,.20]],leftLittleCurl:[[0,.25]],leftThumbCurl:[[0,.20]],leftSplay:[[0,.22]],
    leftPoleX:[[0,.42],[2.08,.42],[2.42,.40]],leftPoleY:[[0,-.10],[2.08,-.10],[2.42,-.20]],leftPoleZ:[[0,.12],[2.08,.12],[2.42,.14]],
    rightShoulderLift:[[0,.035],[1.97,.035],[2.35,-.045],[2.70,.008],[3.05,-.025],[3.44,-.006],[3.90,-.017],[5.70,-.012]],
    rightShoulderForward:[[0,.015],[2.01,.015],[2.42,.10],[2.80,.058],[3.20,.078],[3.70,.065],[5.70,.069]],
    leftShoulderLift:[[0,0],[2.02,0],[2.43,.09],[2.77,.018],[3.12,.065],[3.49,.029],[3.89,.053],[4.32,.034],[4.80,.044],[5.70,.039]],
    leftShoulderForward:[[0,0],[2.03,0],[2.42,-.14],[2.82,-.085],[3.23,-.115],[3.73,-.096],[5.70,-.102]],
    headX:[[0,-.008],[1.98,-.008],[2.39,-.13],[2.76,-.053],[3.13,-.101],[3.51,-.061],[3.93,-.084],[4.39,-.065],[4.91,-.076],[5.70,-.070]],
    headY:[[0,0],[2.04,0],[2.44,-.15],[2.86,-.105],[3.30,-.132],[3.84,-.115],[5.70,-.122]],
    headZ:[[0,.008],[2.06,.008],[2.47,.12],[2.86,.064],[3.26,.097],[3.72,.075],[4.26,.087],[5.70,.081]],
    weightX:[[0,0],[1.95,0],[2.09,-.012],[2.45,.048],[2.84,.034],[3.22,.044],[3.65,.037],[4.15,.041],[5.70,.039]],
    // Planted knee compression, chest lift and staggered rebounds keep this proud arrival buoyant.
    weightY:[[0,0],[2.02,0],[2.17,-.029],[2.45,-.002],[2.76,-.024],[3.10,-.004],[3.45,-.016],[3.82,-.005],[4.23,-.011],[4.67,-.005],[5.12,-.008],[5.70,-.006]],
    hipYaw:[[0,0],[2.02,0],[2.45,.022],[2.89,.009],[3.37,.015],[5.70,.012]],
    hipRoll:[[0,0],[2.04,0],[2.48,.018],[2.93,.010],[3.48,.014],[5.70,.012]],
    turn:[[0,0],[2.01,0],[2.43,-.18],[2.83,-.115],[3.23,-.157],[3.66,-.130],[4.15,-.145],[5.70,-.139]],
    lean:[[0,0],[1.98,0],[2.37,-.065],[2.74,-.018],[3.09,-.053],[3.46,-.027],[3.87,-.042],[4.34,-.030],[4.88,-.037],[5.70,-.034]],
    sway:[[0,0],[2.04,0],[2.47,.045],[2.88,.022],[3.31,.036],[3.78,.028],[5.70,.031]],
    chestTurn:[[0,0],[2.06,0],[2.50,-.082],[2.91,-.045],[3.33,-.068],[3.83,-.053],[5.70,-.059]],
    chestLean:[[0,0],[2.02,0],[2.45,-.056],[2.82,-.017],[3.18,-.043],[3.56,-.024],[3.98,-.034],[4.44,-.027],[5.70,-.030]],
    chestSway:[[0,0],[2.10,0],[2.51,.025],[2.96,.012],[3.43,.021],[3.95,.015],[5.70,.017]],
    'Eyes Sleep':[[0,.18],[2.13,.18],[2.19,.32],[2.25,0]],
    'Eyes Angry':[[0,.10],[2.05,.10],[2.20,0]],
    'Eyes Smile':[[0,0],[2.13,0],[2.19,.45],[2.25,1],[5.70,1]],
    'Mouth Flat':[[0,.08],[2.04,.08],[2.22,0]],
    'Mouth Smile3':[[0,.035],[2.04,.035],[2.25,.37],[2.49,.46],[2.88,.38],[3.40,.43],[5.70,.41]],
    'Eyebrows Happy_L':[[0,0],[2.06,0],[2.29,.17],[2.80,.13],[5.70,.14]],
    'Eyebrows Happy_R':[[0,0],[2.06,0],[2.29,.17],[2.80,.13],[5.70,.14]],
  },5.70);
}

function cheekIdleKeys():[number,Channels][] {
  const duration=5.6,curves:Record<string,[number,number][]>= {
    stillness:[[0,.75]],secondary:[[0,1]],rightArm:[[0,1]],rightContact:[[0,1]],
    rightX:[[0,-.16]],rightY:[[0,.43]],rightZ:[[0,.24]],rightWristY:[[0,2.7]],rightWristZ:[[0,.55]],
    rightContactX:[[0,-.155],[.6,-.155],[1.6,-.165],[2.1,-.165],[3.8,-.155],[5.6,-.155]],
    rightContactY:[[0,-.15],[.6,-.15],[1.6,-.14],[2.1,-.14],[3.8,-.15],[5.6,-.15]],
    rightContactZ:[[0,.15],[.6,.15],[1.6,.16],[2.1,.16],[3.8,.15],[5.6,.15]],
    rightContactWristX:[[0,0]],rightContactWristY:[[0,2.7]],rightContactWristZ:[[0,.55]],
    rightPoleX:[[0,-.35]],rightPoleY:[[0,.03]],rightPoleZ:[[0,.30]],
    rightCurl:[[0,.45]],rightPoint:[[0,0]],rightSplay:[[0,.35]],
    rightIndexCurl:[[0,.35],[.6,.35],[1.6,.28],[2.1,.28],[3.8,.35],[5.6,.35]],
    rightMiddleCurl:[[0,.48],[.6,.48],[1.6,.42],[2.1,.42],[3.8,.48],[5.6,.48]],
    rightRingCurl:[[0,.56]],rightLittleCurl:[[0,.64]],
    rightThumbCurl:[[0,.28],[.6,.28],[1.6,.24],[2.1,.24],[3.8,.28],[5.6,.28]],
    rightShoulderLift:[[0,.025],[1.0,.065],[1.9,.033],[2.8,.075],[3.8,.018],[4.6,.049],[5.6,.025]],
    rightShoulderForward:[[0,.025],[1.3,.055],[2.2,.033],[2.9,.048],[4.0,.010],[4.7,.032],[5.6,.025]],
    leftShoulderLift:[[0,-.010],[1.15,.028],[2.0,-.006],[2.95,.036],[4.0,-.024],[4.65,.014],[5.6,-.010]],
    leftShoulderForward:[[0,-.010],[1.35,-.028],[2.3,-.012],[2.95,-.038],[4.0,.009],[4.65,-.015],[5.6,-.010]],
    headX:[[0,.012],[1.35,-.025],[2.25,.005],[2.85,-.017],[3.75,.034],[4.65,.016],[5.6,.012]],
    headY:[[0,-.025],[1.1,.015],[1.9,-.005],[2.8,.055],[3.6,-.025],[4.45,-.060],[5.6,-.025]],
    headZ:[[0,.255],[1.4,.335],[2.75,.260],[3.8,.285],[4.7,.300],[5.6,.255]],
    weightX:[[0,-.010],[1.1,.015],[1.9,.006],[2.8,.035],[3.75,-.007],[4.55,-.028],[5.6,-.010]],
    weightY:[[0,-.014],[1.35,-.002],[2.15,-.017],[2.85,-.006],[3.65,-.028],[4.45,-.009],[5.0,-.020],[5.6,-.014]],
    hipYaw:[[0,0],[1.25,.014],[2.05,.006],[2.9,.023],[4.15,-.020],[4.8,-.011],[5.6,0]],
    hipRoll:[[0,-.003],[1.2,.009],[2.0,.002],[2.8,.015],[4.3,-.014],[4.85,-.007],[5.6,-.003]],
    turn:[[0,-.012],[1.15,.030],[1.95,.012],[2.8,.050],[3.85,-.026],[4.55,-.039],[5.6,-.012]],
    lean:[[0,.008],[1.45,-.036],[2.2,-.006],[2.9,-.026],[3.85,.025],[4.55,-.012],[5.6,.008]],
    sway:[[0,-.012],[1.2,.014],[2.0,.002],[2.8,.027],[3.9,-.014],[4.65,-.025],[5.6,-.012]],
    chestTurn:[[0,.006],[1.3,.024],[2.1,.010],[2.95,.034],[4.0,-.016],[4.6,.002],[5.6,.006]],
    chestLean:[[0,.003],[1.6,-.026],[2.3,-.004],[3.0,-.020],[3.95,.018],[4.65,-.017],[5.6,.003]],
    chestSway:[[0,.003],[1.3,.013],[2.05,.005],[2.9,.020],[4.0,-.006],[4.65,.010],[5.6,.003]],
    'Eyes Sleep':[[0,.09],[3.2,.09],[3.3,.28],[3.4,1],[3.5,.18],[3.6,.09],[5.6,.09]],
    'Mouth Smile3':[[0,.14],[1.4,.19],[2.8,.16],[4.25,.13],[5.6,.14]],
    'Eyebrows Happy_L':[[0,.04]],'Eyebrows Happy_R':[[0,.04]],
  };
  // Neighbours from the adjoining cycle preserve the same tangent at both ends.
  const periodic=Object.fromEntries(Object.entries(curves).map(([name,keys])=> {
    if(keys.length===1)return [name,keys];
    const before=keys.at(-2)!,after=keys[1];
    return [name,[[before[0]-duration,before[1]],...keys,[after[0]+duration,after[1]]] as [number,number][]];
  }));
  return actingKeys(periodic,duration);
}

export const referenceClips:ReferenceClip[]=[
  {...clip(1,'Curious · Cheek rest','curious',5.60,'A continuous thoughtful idle: a bent finger traces the lower cheek as body weight, shoulders and chest rise and settle, with floating hair and clothing and a soft blink.',cheekIdleKeys(),4.2),loop:true,interpolation:'linear' as const},
  clip(2,'Excited · Thumbs up','happy',1.74,'Open-handed excitement gathers inward, then bursts into a high thumbs-up and closed-eye grin.',[
    [0,{'Eyes Surprised':.25,'Mouth Smile Open2':.22,...browsHappy,rightArm:1,leftArm:1,rightX:-.40,rightY:.66,rightZ:.30,leftX:.40,leftY:.66,leftZ:.30,rightCurl:0,leftCurl:0,headX:-.025}],
    [.40,{'Mouth Smile Open2':.34,headZ:.04}],
    [.7,{'Eyes Surprised':0,'Eyes Sleep':.7,'Mouth Smile Open2':.14,leftX:.26,leftY:.51,leftZ:.39,rightX:-.26,rightY:.51,rightZ:.39,leftCurl:.45,rightCurl:.45,lean:.07,headX:.08}],
    [.90,{'Eyes Sleep':1,'Mouth Smile Open2':.25,leftX:.32,leftY:.75,leftZ:.32,rightX:-.41,rightY:.35,rightZ:.29,leftCurl:1,leftThumb:1,lean:-.015,headX:-.055,headZ:-.10}],
    [1.15,{...closed,leftX:.40,leftY:.98,leftZ:.22,rightX:-.49,rightY:.20,rightZ:.21,rightCurl:.18,rightWristZ:3.14159,headX:-.08,headZ:-.13,'Mouth Smile Open2':0,'Mouth Smile2':.48}],
    [1.74,{headX:-.06,headZ:-.10,'Mouth Smile2':.42}],
  ]),
  clip(3,'Confident · Hip pose','determined',3.10,'Relaxed half-lids and a conversational smile settle into a one-hand-on-hip pose.',[
    [0,{'Eyes Sleep':.32,'Mouth Smile2':.28,'Mouth EndUp_R':.06,leftX:.25,leftY:.16,leftZ:.13,leftCurl:.26,leftWristY:-1.5708,leftWristZ:3.14159,headX:-.03,headZ:.045}],
    [.28,{leftArm:.3,'Mouth Smile2':.22}], [.40,{'Eyes Sleep':1}],
    [.62,{'Eyes Sleep':.30,leftArm:.8,headY:.035,'vrc.v_aa':.035}],
    [.80,{leftArm:1,headX:-.055,headZ:.055,turn:.035,'vrc.v_aa':0}],
    [1.35,{'Mouth Smile2':.18,'vrc.v_aa':.045,headZ:.025}],
    [1.8,{'Mouth Smile2':.30,'vrc.v_aa':0,headX:-.02}],
    [2.4,{headY:-.025,headZ:.045,'vrc.v_aa':.025}],
    [3.1,{headX:-.03,headY:.005,'vrc.v_aa':0,'Mouth Smile2':.26}],
  ]),
  // The visor hides the eyes; Haru's narrowed lids are an adaptation of the amused acting.
  {...clip(4,'Amused · Facepalm','embarrassed',2.93,'A pronounced weight shift and rising right shoulder lead the hand to her brow as the opposite shoulder settles back; hair, jacket and laces follow the movement.',facepalmKeys(),2.3),interpolation:'linear' as const},
  {...clip(5,'Delighted · Warm smile','affectionate',4.16,'A quick happy eye-smile and chin lift accompany a loose hand rising beside the collarbone; a buoyant shoulder lift and body bounce settle through soft rebounds with floating hair and clothing.',warmSmileKeys(),2.30),interpolation:'linear' as const},
  {...clip(6,'Proud · Hands on hips','smug',5.70,'A composed right-hand hip rest shifts into a proud closed-eye smile: the left hand plants at the waist, the right relaxes lower, and a chest lift and body bounce settle with floating hair and clothing.',proudKeys(),3.80),interpolation:'linear' as const},
  clip(7,'Relaxed · Stroll','neutral',5.60,'An easy walking rhythm, opposing arm swings and a calm forward gaze.',[
    [0,{'Eyes Sleep':.10,'Mouth Smile2':.08,gait:.65,stride:0,headX:.015}],
    [1.10,{stride:Math.PI*2}], [2.20,{stride:Math.PI*4}], [3.30,{stride:Math.PI*6}],
    [4.40,{stride:Math.PI*8}], [5.20,{stride:Math.PI*9.45,gait:.65}],
    [5.60,{stride:Math.PI*10,gait:0}],
  ],1.38),
  clip(8,'Apologetic · Fidget','worried',3.33,'A brief blink and a worried look lead into small clasping hand movements near the chest.',[
    [0,{...sad,'Mouth Troubled':.18,'Eyes Surprised':.10,leftX:.27,leftY:.28,leftZ:.34,rightX:-.24,rightY:.22,rightZ:.35,leftCurl:.40,rightCurl:.4}],
    [1.10,{headX:.03}], [1.25,{'Eyes Sleep':1,leftArm:.35}],
    [1.42,{'Eyes Sleep':0,leftArm:.8,leftX:.14,leftY:.36,leftZ:.41,headX:.055,headZ:.02}],
    [1.65,{leftArm:1,rightArm:1,rightX:-.11,rightY:.31,rightZ:.51,leftX:.11,leftY:.38,leftZ:.40,rightCurl:.55,leftCurl:.6,headX:.06}],
    [2.0,{rightX:-.10,rightY:.33,leftY:.36,headY:-.035}],
    [2.35,{rightX:-.12,rightY:.31,leftY:.39,headY:.02}],
    [2.75,{rightX:-.10,rightY:.33,leftY:.37,headY:-.025}],
    [3.33,{rightX:-.11,rightY:.32,leftY:.37,headY:-.01}],
  ]),
  clip(9,'Cheerful · Bouncy steps','happy',5.40,'Light, buoyant steps with a contented closed-eye smile and a playful sway.',[
    [0,{'Eyes Smile2':.90,'Mouth Smile2':.28,...browsHappy,gait:1,bounce:1,stride:0,headZ:.025}],
    [.90,{stride:Math.PI*2,headZ:-.03}], [1.80,{stride:Math.PI*4,headZ:.03}],
    [2.70,{stride:Math.PI*6,headZ:-.03}], [3.60,{stride:Math.PI*8,headZ:.03}],
    [4.50,{stride:Math.PI*10,headZ:-.03}], [5.0,{stride:Math.PI*11.1}],
    [5.4,{stride:Math.PI*12,gait:0,bounce:0,headZ:0}],
  ],1.12),
  clip(10,'Curious · Peace and cheer','curious',6.47,'A questioning sideways glance turns into a peace sign, then a small two-fist cheer.',[
    [0,{'Eyes Sleep':.18,'Mouth Smile2':.12,rightArm:1,rightX:-.35,rightY:.58,rightZ:.30,rightCurl:.85,rightPeace:1,leftX:.35,leftY:.55,leftZ:.32,leftCurl:.90,headZ:.045}],
    [.35,{rightArm:0,headZ:0}],
    [.8,{headY:-.06,'Eyebrows Up_L':.30,'Eyebrows Sad_R':.18,'Mouth Smile2':0,'Mouth Confusion':.12}],
    [1.15,{headX:.03,headY:-.16,headZ:.09,gazeX:-.35}],
    [1.8,{headY:-.40,headZ:.04,gazeX:-1.0,turn:-.05}],
    [2.35,{headY:-.88,headX:.035,headZ:.01,gazeX:-2.7,turn:-.15}],
    [2.85,{headY:-.84}],
    [3.35,{headY:-.12,headX:0,headZ:.045,gazeX:0,turn:-.025,rightArm:.6,'Mouth Confusion':0,'Eyebrows Up_L':.08,'Eyebrows Sad_R':0,'Mouth Smile2':.25}],
    [3.7,{rightArm:1,headY:0,headZ:.07,turn:0}],
    [4.7,{headZ:.09,'Mouth Smile2':.32}],
    [5.25,{'Eyes Sleep':.5,rightPeace:.45,rightCurl:.95,rightY:.56}],
    [5.65,{...closed,rightPeace:0,leftArm:.45,'Mouth Smile2':.35,headX:.045,rightX:-.31,leftX:.31}],
    [6.1,{leftArm:1,rightY:.46,leftY:.46,'Mouth Smile Open2':.18,lean:.025,headX:.055}],
    [6.47,{rightY:.44,leftY:.44,'Mouth Smile Open2':.12,lean:0,headX:.035}],
  ]),
];
export const referenceClip=(name:string|null|undefined)=>referenceClips.find(clip=>clip.name===name);
export const referenceFaceChannels=[...new Set(referenceClips.flatMap(clip=>clip.keys.flatMap(key=>Object.keys(key.channels).filter(name=>/^[A-Z]|^vrc\./.test(name)))))];
export const referenceChannel=(name:string)=>`Haru Ref ${name}.${/Mouth|vrc\./.test(name)?'mouth':/Eyebrows/.test(name)?'brows':'eyes'}`;
