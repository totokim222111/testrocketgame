import * as T from 'three';
import { loadDefinition } from './loader';
import { kinds, posedArm, type RigDefinition as Manifest } from './format';
import { eyeFrame, mouthFrame } from './pose';
import type { Pose } from './pose';

function geometry(def: Manifest) {
  const position: number[] = [],
    uv: number[] = [],
    tile: number[] = [],
    part: number[] = [],
    indices: number[] = [];
  const [width, height] = def.canvas,
    [aw, ah] = def.size;
  for (const layer of def.layers) {
    const [x, y, w, h] = layer.rect,
      [tx, ty, tw, th] = layer.tile,
      [cols, rows] = layer.grid;
    const first = position.length / 3,
      kind = kinds.indexOf(layer.name);
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const u = i / cols,
          v = j / rows;
        position.push((x + w * u - width / 2) / height, 0.5 - (y + h * v) / height, 0);
        uv.push(u, v);
        tile.push((tx + 0.5) / aw, (ty + 0.5) / ah, (tw - 1) / aw, (th - 1) / ah);
        part.push(kind, layer.depth[j * (cols + 1) + i] / 255, layer.stride / aw, layer.frames - 1);
        if (i < cols && j < rows) {
          const a = first + j * (cols + 1) + i,
            b = a + cols + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
  }
  const g = new T.BufferGeometry();
  for (const [name, array, size] of [
    ['position', position, 3],
    ['uv', uv, 2],
    ['tile', tile, 4],
    ['part', part, 4],
  ] as const)
    g.setAttribute(name, new T.Float32BufferAttribute(array, size));
  g.setIndex(indices);
  return g;
}

const vertex = `
attribute vec4 tile;
attribute vec4 part;
uniform vec4 head,body,eyes,features,hair,hand,framing;
uniform float eyeTile,continuous;
uniform bool bustFramed;
uniform vec4 extra,handRect,armCrop,armJoint;
varying vec2 patchUV,windowPos;
varying vec4 region;
varying float kind,alpha;
mat2 rotate2(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}
void main(){
  kind=part.x; region=tile; patchUV=uv; alpha=1.;
  vec2 q=position.xy;
  float x=q.x, y=q.y, turn=head.x/15.;
  float yaw=radians(head.x), pitch=radians(head.y);
  vec2 hinge=vec2(0.,-.119), face=q-hinge;
  float relief=part.y-.24;
  float side=smoothstep(.065,.23,abs(x));
  float farSide=max(0.,turn*sign(x));

  // The nose follows its depth arc; the cheek turning out of sight narrows.
  face.x=x*(cos(yaw)-.17*farSide*side)+sin(yaw)*relief*.39;
  face.y=face.y*cos(pitch)+sin(pitch)*relief*.31;
  bool hairPart=kind==1. || kind==3. || kind==4.;
  if(hairPart){
    // The pin sits on the rigid upper skull. Extending the cheek's depth
    // gradient across that plane used to collapse its star at positive yaw.
    float cap=smoothstep(.12,.22,y);
    float rim=smoothstep(.14,.29,abs(x));
    face.x=mix(face.x,x*cos(yaw)+.024*turn,max(cap,rim*.88));
    face.y=mix(face.y,(y-hinge.y)*cos(pitch)+.027*sin(pitch),max(cap,rim*.88));
  }
  face.y+=.012*turn*x/.375*side;
  face.x+=sign(x)*features.w*.011*exp(-pow((y-.041)/.06,2.))*smoothstep(.054,.15,abs(x));
  face=rotate2(radians(head.z))*face;
  float headWeight=1.;
  if(kind==0.)headWeight=0.;
  if(kind==12.)headWeight=smoothstep(-.118,-.050,y);
  q=mix(q,face+hinge,headWeight);

  if(hairPart){
    // Locks over the far ear advance across the cheek; the rear bob trails.
    // Use a continuous field across the two cuts in the front hair.
    float tips=side*(1.-smoothstep(.13,.42,y));
    // Pin the hair root over the earlobe. Only the free lengths slide past it.
    float earRoot=smoothstep(.027,.10,length(vec2(abs(x)-.147,(y-.039)*1.15)));
    tips*=earRoot;
    float travel=kind==1.?-.004*turn:-(.004+.005*farSide)*turn;
    q.x+=travel*tips;
    q.y+=(.006*turn*sign(x)-.003*abs(turn))*tips;
    float swing=mix(hair.x*(1.-smoothstep(.09,.31,y))*.007,hair.y*.024,tips);
    if(kind==1.)swing=hair.z*.022;
    q.x+=swing;
    q.y+=abs(swing)*.18;
  }
  if(kind==0.)q.x*=1.+.22*(1.-smoothstep(-.46,-.18,y));
  if(continuous>.5){
    // A shared field along cuts keeps long hair, fin roots and temples registered.
    float faceWeight=smoothstep(-.24,-.025,y);
    vec2 turned=rotate2(radians(head.z))*vec2(
      x*cos(yaw)+sin(yaw)*relief*.34,
      (y-hinge.y)*cos(pitch)+sin(pitch)*relief*.27)+hinge;
    q=mix(position.xy,turned,faceWeight);
    float sideWeight=smoothstep(.134,.255,abs(x));
    float tips=1.-smoothstep(-.24,.32,y);
    q.x+=sideWeight*tips*(hair.y*.014+hair.z*.011)+hair.x*.003*smoothstep(.10,.33,y);
    q.x+=sign(x)*features.w*.018*exp(-pow((y-.043)/.056,2.))*smoothstep(.06,.16,abs(x));
    q.y+=extra.y*.044*sideWeight*exp(-pow((y+.23)/.13,2.));
  }
  if(kind==10. && armCrop.z>0.){
    q=armCrop.xy+vec2(uv.x,-uv.y)*armCrop.zw;
    q=armJoint.xy+rotate2(armJoint.z)*(q-armJoint.xy);
    q.y-=(1.-armJoint.w)*.78;
    x=q.x; y=q.y;
    alpha=smoothstep(0.,.12,armJoint.w);
    region.x+=part.z*hand.w;
  }else if(kind==10.){
    // Upper arm at the jacket seam, elbow below the chest. A positive wrist
    // rotation opens the gesture away from the face. Both follow the ribcage.
    vec2 shoulder=vec2(-.223,-.158);
    if(bustFramed)shoulder=continuous>.5?vec2(-.175,-.061):vec2(-.223,-.096);
    vec2 elbow=shoulder+vec2(-.015,-.277);
    q=elbow+rotate2(.056+hand.y*.135)*vec2((uv.x-.5)*.207,(1.-uv.y)*.401);
    q.y-=(1.-hand.x)*.52;
    alpha=smoothstep(.025,.13,hand.x);
    region.x+=part.z*min(hand.w,part.w);
    if(extra.w>0. && handRect.z>0. && part.w>=3.){
      vec2 wrist=handRect.xy+vec2(handRect.z*.54,0.);
      bool turnsWrist=bustFramed || part.w>=4.;
      q=wrist+rotate2(turnsWrist?hand.y*.075:0.)*(vec2(uv.x-.54,1.-uv.y)*handRect.zw);
      q.y-=(1.-extra.w)*(bustFramed?.30:.46);
      alpha=bustFramed?smoothstep(.08,.62,extra.w):smoothstep(.06,.5,extra.w);
      region.x=tile.x+part.z*min(part.w,hand.y<-.15?4.:3.);
    }
  }
  q=vec2(0.,-.48)+rotate2(body.x*.055)*(q-vec2(0.,-.48));
  q.y+=body.y*.009*(1.+y)+body.z*.044;
  q.x+=body.y*.004*x;
  // Lean toward or away from the camera about the upper chest.
  q=vec2(0.,-.20)+(q-vec2(0.,-.20))*(1.+body.w*.14);
  q.y-=body.w*.026;

  if(kind==5. || kind==6.){
    float selectedEye=kind==5. && extra.x>.5 ? 0. : eyeTile;
    region.x+=part.z*min(selectedEye,part.w);
    float squeeze=continuous<.5 && eyeTile==1.?.79+.24*clamp(eyes.x/.64,0.,1.):1.;
    q.y+=(.50-uv.y)*(squeeze-1.)*.082*sin(uv.x*3.14159);
  }
  if(kind==7.)region.x+=part.z*min(features.x,part.w);
  if(kind==8.)region.x+=part.z*min(features.y,part.w);
  if(kind==9.)alpha=features.z;
  if(kind==3. && eyeTile==4.)region.x+=part.z*min(part.w,1.);

  q=q*framing.x+vec2(0.,framing.y);
  q.y-=framing.w*(.035*max(body.z,0.)+.065*max(body.w,0.));
  if(kind==11.){
    vec2 corner=vec2(framing.z-.068,.416);
    q=corner+vec2(uv.x-.5,.5-uv.y)*vec2(.116,.139)*(.68+hand.z*.32);
    alpha=hand.z;
  }
  windowPos=q;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(q,0.,1.);
}`;
const fragment = `
uniform sampler2D art;
uniform float artGain;
uniform vec4 eyes,framing;
uniform vec2 bustRange;
uniform bool bustFramed;
uniform float eyeTile,continuous;
varying vec2 patchUV,windowPos;
varying vec4 region;
varying float kind,alpha;
void main(){
  vec2 edge=abs(windowPos)-vec2(framing.z-.027,.50-.027);
  if(length(max(edge,vec2(0.)))+min(max(edge.x,edge.y),0.)>.027 || alpha<.006)discard;
  vec2 p=patchUV;
  if(kind>4.5 && kind<6.5 && (eyeTile==1. || eyeTile==2. || eyeTile==4. || eyeTile==5.)){
    // Warp within the sclera. Both lash corners and the upper lid remain anchored.
    float cx=kind<5.5?.64:.35;
    float cy=eyeTile==1.?.73:eyeTile==4.?.55:.62;
    float weight=exp(-pow((p.x-cx)/.245,4.)-pow((p.y-cy)/.19,4.));
    p-=vec2(eyes.z*.065,-eyes.w*.054)*weight;
  }
  // Keep the minification footprint inside its own atlas tile at headset size.
  vec2 inset=continuous>.5?min(vec2(.24),fwidth(p)*1.35):vec2(0.);
  vec2 coords=region.xy+clamp(p,inset,1.-inset)*region.zw;
  vec4 c=texture2D(art,coords);
  if(kind==1. || kind==3. || kind==4.)c.a=smoothstep(.36,.63,c.a);
  if(kind==0. && framing.w<.5){
    c.a*=smoothstep(0.,.040,min(p.x,1.-p.x))*smoothstep(0.,.042,framing.z-abs(windowPos.x));
  }
  // Fade inside the mask; the jacket continues underneath it during a jump.
  float bottom=smoothstep(bustRange.x,bustRange.y,windowPos.y);
  float shade=mix(.16,1.,smoothstep(-.50,-.331,windowPos.y));
  if(bustFramed)shade=kind==10.?1.:mix(.45,1.,bottom);
  c.rgb*=mix(1.,shade,framing.w);
  c.a*=alpha*bottom;
  if(c.a<.01)discard;
  gl_FragColor=c;
  #include <colorspace_fragment>
  gl_FragColor.rgb*=artGain;
}`;

// Instances sharing the same URL lease immutable geometry and texture.
async function loadRig(url: string) {
  const def = await loadDefinition(url);
  const tex = await new T.TextureLoader().loadAsync(new URL(def.atlas, url).href);
  if (tex.image.naturalWidth !== def.size[0] || tex.image.naturalHeight !== def.size[1]) {
    tex.dispose();
    throw new Error('Invalid atlas dimensions');
  }
  tex.flipY = false;
  tex.colorSpace = T.SRGBColorSpace;
  tex.name = 'rig2d:atlas';
  try {
    return { geometry: geometry(def), texture: tex, def };
  } catch (error) {
    tex.dispose();
    throw error;
  }
}
const cache = new Map<string, { asset: ReturnType<typeof loadRig>; users: number }>();
function acquireRig(url: string) {
  let entry = cache.get(url);
  if (!entry) {
    const asset = loadRig(url);
    entry = { asset, users: 0 };
    cache.set(url, entry);
    void asset.catch(() => {
      if (cache.get(url)?.asset === asset) cache.delete(url);
    });
  }
  entry.users++;
  const lease = entry;
  return {
    asset: lease.asset,
    release() {
      if (--lease.users) return;
      if (cache.get(url) === lease) cache.delete(url);
      void lease.asset.then(
        (r) => {
          r.geometry.dispose();
          r.texture.dispose();
        },
        () => {},
      );
    },
  };
}
export class Portrait {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private uniforms;
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';

  definition?: Manifest;
  error?: unknown;
  private disposed = false;
  private lease;
  private mouthFrames = 0;
  constructor(url: string | URL) {
    this.lease = acquireRig(new URL(url, document.baseURI).href);
    const vec = () => ({ value: new T.Vector4() });
    this.uniforms = {
      art: { value: null as T.Texture | null },
      artGain: { value: 1 },
      eyeTile: { value: 2 },
      continuous: { value: 0 },
      extra: vec(),
      handRect: vec(),
      armCrop: vec(),
      armJoint: vec(),
      head: vec(),
      body: vec(),
      eyes: vec(),
      features: vec(),
      hair: vec(),
      hand: vec(),
      framing: { value: new T.Vector4(0.96, 0, 0.375, 0) },
      bustRange: { value: new T.Vector2(-0.502, -0.423) },
      bustFramed: { value: false },
    };
    const material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      forceSinglePass: true,
    });
    this.mesh = new T.Mesh(new T.BufferGeometry(), material);
    this.mesh.name = 'rig2d:portrait';
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.ready = this.load().catch((error) => {
      this.error = error;
      this.status = 'fallback';
    });
  }
  private async load() {
    const asset = await this.lease.asset;
    if (this.disposed) return;
    this.mesh.geometry.dispose();
    this.mesh.geometry = asset.geometry;
    this.definition = asset.def;
    this.uniforms.art.value = asset.texture;
    this.uniforms.continuous.value = Number(!!asset.def.continuous);
    this.uniforms.bustFramed.value = !!asset.def.bustFade;
    this.mouthFrames = asset.def.layers.find((l) => l.name === 'mouth')?.frames ?? 0;
    this.updateBustRange();
    if (asset.def.handRect) {
      const [x, y, w, h] = asset.def.handRect,
        [width, height] = asset.def.canvas;
      this.uniforms.handRect.value.set(
        (x - width / 2) / height,
        0.5 - (y + h) / height,
        w / height,
        h / height,
      );
    }
    this.status = 'ready';
    this.mesh.visible = true;
  }
  setFraming(scale: number, y: number, halfWidth: number, vignette = false) {
    this.uniforms.framing.value.set(scale, y, halfWidth, Number(vignette));
    this.updateBustRange();
  }
  private updateBustRange() {
    const fade = this.definition?.bustFade;
    if (!fade || !this.definition) return;
    const { x: scale, y: offset } = this.uniforms.framing.value;
    const height = this.definition.canvas[1];
    const bottom = Math.max(-0.502, (0.5 - fade[1] / height) * scale + offset);
    const top = Math.max(bottom + 0.10, (0.5 - fade[0] / height) * scale + offset);
    this.uniforms.bustRange.value.set(bottom, top);
  }
  setBrightness(gain: number) {
    this.uniforms.artGain.value = gain;
  }
  apply(p: Pose) {
    const u = this.uniforms;
    u.head.value.set(p.yaw, p.pitch, p.roll, 0);
    u.body.value.set(p.lean, p.breath, p.bounce, p.forward);
    u.eyes.value.set(p.eye, p.happy, p.gazeX, p.gazeY);
    u.eyeTile.value = eyeFrame(p);
    u.extra.value.set(p.wink, p.shrug, p.specialLip, p.specialHand);
    u.features.value.set(
      Math.round(p.brow),
      mouthFrame(p, this.mouthFrames),
      p.blush,
      p.cheek,
    );
    u.hair.value.set(p.fringe, p.locks, p.rear, 0);
    u.hand.value.set(p.wave, p.wrist, p.sparkle, Math.round(p.gesture));
    const def = this.definition;
    const arm = def && posedArm(def, p);
    if (arm && def) {
      const [cw, ch] = def.canvas;
      const [x, y, w, h] = arm.rect;
      u.armCrop.value.set((x - cw / 2) / ch, .5 - y / ch, w / ch, h / ch);
      u.armJoint.value.set((arm.elbow[0] - cw / 2) / ch, .5 - arm.elbow[1] / ch, arm.angle, arm.lift);
      u.hand.value.w = arm.index;
    }
  }
  get triangles() {
    return (this.mesh.geometry.index?.count ?? 0) / 3;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    if (this.status !== 'ready') this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.lease.release();
  }
}
