import * as THREE from 'three';

import { VRButton } from 'three/addons/webxr/VRButton.js';

const logBox = document.createElement('pre');
logBox.style.cssText = 'position:fixed;top:0;left:0;color:#0f0;font-size:14px;z-index:10;margin:0';
document.body.appendChild(logBox);
function log(msg) { logBox.textContent += msg + '\n'; };
log('main.js caricato - versione 9');

let photoFiles = [];
let currentIndex = 0;

const picker = document.createElement('input');
picker.type = 'file';
picker.accept = '.jpg,.jpeg,.png';
picker.multiple = true;
picker.style.cssText = 'position:fixed;top:60px;left:0;z-index:10;color:#fff';
document.body.appendChild(picker);
picker.addEventListener('change', () => {
  photoFiles = Array.from(picker.files);
  photoFlags = photoFiles.map(() => fishBox.checked);
  currentIndex = 0;
  log('foto scelte: ' + photoFiles.length);
  loadPhoto(0);
});

const fishBox = document.createElement('input');
fishBox.type = 'checkbox';
fishBox.style.cssText = 'position:fixed;top:60px;right:60px;z-index:10;transform:scale(2.5)';
document.body.appendChild(fishBox);
const fishLabel = document.createElement('span');
fishLabel.textContent = 'fisheye';
fishLabel.style.cssText = 'position:fixed;top:60px;right:0;z-index:10;color:#fff;font-size:18px';
document.body.appendChild(fishLabel);
let photoFlags = [];


const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(2);
renderer.xr.setFoveation(0);
document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'layers'] }));


camera.position.set(0, 1.6, 3);





let photoBitmap, photoW = 0, photoH = 0;
let photoFisheye = false;
async function loadPhoto(i) {
  let bmp = await createImageBitmap(photoFiles[i], { imageOrientation: 'flipY' });
  const s = Math.min(1, 8192 / Math.max(bmp.width, bmp.height));
  if (s < 1) {
    const r = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
    bmp.close();
    bmp = r;
  }
  const old = photoBitmap;
  photoBitmap = bmp;
  photoW = bmp.width;
  photoH = bmp.height;
  if (old) old.close();
  photoFisheye = photoFlags[i];
  if (photoFisheye) {
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    if (fisheyeMat.uniforms.map.value) fisheyeMat.uniforms.map.value.dispose();
    fisheyeMat.uniforms.map.value = tex;
    fisheyeMat.uniforms.aspect.value = photoW / photoH;
  }
  fisheyeSphere.visible = false;
  log(photoFiles[i].name + ': ' + photoW + 'x' + photoH + (photoFisheye ? ' (FISHEYE)' : ''));
}


let photoLayer, builtFor = null, building = false;
async function buildLayer() {
  const session = renderer.xr.getSession();
  const glBinding = renderer.xr.getBinding();
  const refSpace = await session.requestReferenceSpace('local-floor');
  const k = 6 / Math.max(photoW, photoH);
  const old = photoLayer;
  photoLayer = glBinding.createQuadLayer({
    space: refSpace,
    width: photoW * k, height: photoH * k,
    viewPixelWidth: photoW, viewPixelHeight: photoH,
    isStatic: true, layout: 'mono',
    transform: new XRRigidTransform(photoPos)
  });
  const others = Array.from(session.renderState.layers).filter(l => l !== old);
  session.updateRenderState({ layers: [photoLayer, ...others] });
  if (old) old.destroy();
  photoDrawn = false;
}


let layerRequested = false;
let photoDrawn = false;
const photoPos = { x: 0, y: 1.6, z: -6 };

const prevPressed = {};

function changePhoto(d) {
  if (photoFiles.length < 2) return;
  currentIndex = (currentIndex + d + photoFiles.length) % photoFiles.length;
  log('foto ' + (currentIndex + 1) + '/' + photoFiles.length);
  loadPhoto(currentIndex).catch(e => log('ERRORE foto: ' + e));
}


const fisheyeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    map: { value: null },
    thetaMax: { value: 95 * Math.PI / 180 },
    aspect: { value: 1.5 }
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform float thetaMax;
    uniform float aspect;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float theta = acos(clamp(-d.z, -1.0, 1.0));
      float l = length(d.xy);
      vec2 dir = l > 1e-6 ? d.xy / l : vec2(0.0);
      float halfDiag = 0.5 * sqrt(aspect * aspect + 1.0);
      vec2 p = dir * (theta / thetaMax) * halfDiag;
      vec2 uv = vec2(0.5 + p.x / aspect, 0.5 + p.y);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
      gl_FragColor = vec4(texture2D(map, uv).rgb, 1.0);
      #include <colorspace_fragment>
    }`
});
const fisheyeSphere = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 64), fisheyeMat);
fisheyeSphere.position.set(0, 1.6, 0);
fisheyeSphere.visible = false;
scene.add(fisheyeSphere);



async function buildEquirectLayer() {
  const session = renderer.xr.getSession();
  const glBinding = renderer.xr.getBinding();
  const refSpace = await session.requestReferenceSpace('local-floor');
  const old = photoLayer;
  const deg = Math.PI / 180;
  photoLayer = glBinding.createEquirectLayer({
    space: refSpace,
    viewPixelWidth: 6144, viewPixelHeight: 3427,
    isStatic: true, layout: 'mono',
    radius: 0,
    centralHorizontalAngle: 2 * Math.PI,
    upperVerticalAngle: Math.PI / 2,
    lowerVerticalAngle: -Math.PI / 2,
    transform: new XRRigidTransform({ x: 0, y: 1.6, z: 0 })
  });
  const others = Array.from(session.renderState.layers).filter(l => l !== old);
  session.updateRenderState({ layers: [photoLayer, ...others] });
  if (old) old.destroy();
  photoDrawn = false;
}




function fisheyeToEquirect(bmp, W, H, azSpan, elUp, elLow) {
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  const compile = (type, src) => {
    const s = g.createShader(type);
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s));
    return s;
  };
  const prog = g.createProgram();
  g.attachShader(prog, compile(g.VERTEX_SHADER, `#version 300 es
    in vec2 p;
    out vec2 uv;
    void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
  g.attachShader(prog, compile(g.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D map;
    uniform float thetaMax, aspect, azSpan, elUp, elLow;
    in vec2 uv;
    out vec4 outColor;
    void main() {
      float a = (uv.x - 0.5) * azSpan;
      float e = mix(elLow, elUp, uv.y);
      vec3 d = vec3(sin(a) * cos(e), sin(e), -cos(a) * cos(e));
      float theta = acos(clamp(-d.z, -1.0, 1.0));
      float l = length(d.xy);
      vec2 dir = l > 1e-6 ? d.xy / l : vec2(0.0);
      float halfDiag = 0.5 * sqrt(aspect * aspect + 1.0);
      vec2 q = dir * (theta / thetaMax) * halfDiag;
      vec2 s = vec2(0.5 + q.x / aspect, 0.5 + q.y);
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      outColor = vec4(texture(map, s).rgb, 1.0);
    }`));
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog));
  g.useProgram(prog);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, 'p');
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, bmp);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.uniform1i(g.getUniformLocation(prog, 'map'), 0);
  g.uniform1f(g.getUniformLocation(prog, 'thetaMax'), 95 * Math.PI / 180);
  g.uniform1f(g.getUniformLocation(prog, 'aspect'), bmp.width / bmp.height);
  g.uniform1f(g.getUniformLocation(prog, 'azSpan'), azSpan);
  g.uniform1f(g.getUniformLocation(prog, 'elUp'), elUp);
  g.uniform1f(g.getUniformLocation(prog, 'elLow'), elLow);
  g.viewport(0, 0, W, H);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return canvas;
}





function animate(time, frame) {
  if (renderer.xr.isPresenting && photoBitmap && photoBitmap !== builtFor && !building) {
    building = true;
    builtFor = photoBitmap;
    (photoFisheye ? buildEquirectLayer() : buildLayer())
      .catch(e => log('ERRORE layer: ' + e))
      .finally(() => { building = false; });
  }

  if (photoLayer && photoBitmap && frame && !photoDrawn) {
    photoDrawn = true;
    try {
      const gl = renderer.getContext();
      const sub = renderer.xr.getBinding().getSubImage(photoLayer, frame);
      gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      const c = new OffscreenCanvas(6144, 3427);
      const g2 = c.getContext('2d');
      g2.drawImage(photoBitmap, 0, 0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 6144, 3427, gl.RGBA, gl.UNSIGNED_BYTE, c);
      log('texture ' + sub.colorTextureWidth + 'x' + sub.colorTextureHeight + ' errore GL ' + gl.getError());
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      log('foto disegnata');
    } catch (e) { log('ERRORE disegno: ' + e); }
  }

  const xrSession = renderer.xr.getSession();
  if (xrSession) {
    for (const src of xrSession.inputSources) {
      if (src.handedness === 'right' && src.gamepad) {
        const dz = src.gamepad.axes[3];
        if (Math.abs(dz) > 0.15) photoPos.z -= dz * 0.03;
        if (src.gamepad.buttons[4] && src.gamepad.buttons[4].pressed) {
          photoPos.x = 0;
          photoPos.y = 1.6;
          photoPos.z = -6;
        }
      }

      if (src.handedness === 'left' && src.gamepad) {
        const dx = src.gamepad.axes[2];
        const dy = src.gamepad.axes[3];
        if (Math.abs(dx) > 0.15) photoPos.x -= dx * 0.03;
        if (Math.abs(dy) > 0.15) photoPos.y += dy * 0.03;

      }

      if (src.gamepad) {
        const b = src.gamepad.buttons[5];
        const down = !!(b && b.pressed);
        if (down && !prevPressed[src.handedness]) changePhoto(src.handedness === 'right' ? 1 : -1);
        prevPressed[src.handedness] = down;
      }

    }
  }


  if (photoLayer) {
    photoLayer.transform = new XRRigidTransform(photoPos);
  }

  renderer.render(scene, camera);
}



renderer.setAnimationLoop(animate);
