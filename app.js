// app.js
// 화학적 평형 3D 시뮬레이터 메인 로직

(function(){
"use strict";

// ============ 반응식 정의 ============
const REACTIONS = {
  no2_n2o4: {
    label: "2NO₂ ⇌ N₂O₄",
    eqLabel: "2NO₂ ⇌ N₂O₄",
    exothermic: true, // 정반응 발열
    species: [
      {id:"NO2", name:"NO₂", side:"reactant", coef:2, color:0xb74fd8, initial:60},
      {id:"N2O4", name:"N₂O₄", side:"product", coef:1, color:0x5fc9e8, initial:20}
    ],
    kcBase: 4.5, // 298K 기준
    kcTempSensitivity: 0.012 // 온도 상승시 Kc 감소 (발열반응 특성)
  },
  n2_h2_nh3: {
    label: "N₂ + 3H₂ ⇌ 2NH₃",
    eqLabel: "N₂ + 3H₂ ⇌ 2NH₃",
    exothermic: true,
    species: [
      {id:"N2", name:"N₂", side:"reactant", coef:1, color:0x6fa8ff, initial:30},
      {id:"H2", name:"H₂", side:"reactant", coef:3, color:0xe8e05f, initial:60},
      {id:"NH3", name:"NH₃", side:"product", coef:2, color:0x8affc1, initial:15}
    ],
    kcBase: 3.2,
    kcTempSensitivity: 0.015
  },
  co_h2o_co2_h2: {
    label: "CO + H₂O ⇌ CO₂ + H₂",
    eqLabel: "CO + H₂O ⇌ CO₂ + H₂",
    exothermic: true,
    species: [
      {id:"CO", name:"CO", side:"reactant", coef:1, color:0xd88a4f, initial:40},
      {id:"H2O", name:"H₂O", side:"reactant", coef:1, color:0x5fc9e8, initial:40},
      {id:"CO2", name:"CO₂", side:"product", coef:1, color:0xb74fd8, initial:20},
      {id:"H2", name:"H₂", side:"product", coef:1, color:0xe8e05f, initial:20}
    ],
    kcBase: 1.4,
    kcTempSensitivity: 0.006
  }
};

// ============ 전역 상태 ============
const State = {
  reactionKey: "no2_n2o4",
  reaction: null, // resolved object (may include custom)
  customSpecies: [], // for custom builder staging
  temperature: 298,
  volumeScale: 1.0,   // 1.0 = 100%
  simSpeed: 1.0,
  playing: true,
  soundOn: true,
  autoRotate: true,
  particles: [],      // {mesh, speciesId, vel}
  counts: {},         // speciesId -> count
  boxSize: 10,
  recorder: null,
  recordedChunks: [],
  isRecording: false,
  graphHistory: [],   // {t, counts:{...}}
  simTime: 0,
  audioCtx: null
};

// ============ THREE.js 기본 셋업 ============
let scene, camera, renderer, container;
let boxMesh, boxEdges;
let clock3d = new THREE.Clock();

function initThree(){
  container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a0f2e, 0.012);

  camera = new THREE.PerspectiveCamera(55, container.clientWidth/container.clientHeight, 0.1, 1000);
  camera.position.set(16, 12, 20);
  camera.lookAt(0,0,0);

  renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0x1a0f2e, 0);
  container.appendChild(renderer.domElement);

  // Lighting - purple ambient theme
  const ambient = new THREE.AmbientLight(0x9b6dff, 0.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xe6d6ff, 0.8);
  dir.position.set(10,20,10);
  scene.add(dir);
  const point = new THREE.PointLight(0xb18aff, 1.2, 60);
  point.position.set(0,10,0);
  scene.add(point);
  const point2 = new THREE.PointLight(0xd4b8ff, 0.6, 40);
  point2.position.set(-10,-5,-10);
  scene.add(point2);

  buildBox();

  window.addEventListener('resize', onResize);
  setupMouseControls();
  animate();
}

function buildBox(){
  if(boxMesh) scene.remove(boxMesh);
  if(boxEdges) scene.remove(boxEdges);
  const size = State.boxSize * Math.cbrt(State.volumeScale);
  const geo = new THREE.BoxGeometry(size,size,size);
  const mat = new THREE.MeshPhysicalMaterial({
    color:0x9b6dff, transparent:true, opacity:0.06,
    roughness:0.1, metalness:0.1, side:THREE.DoubleSide
  });
  boxMesh = new THREE.Mesh(geo, mat);
  scene.add(boxMesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({color:0xd4b8ff, transparent:true, opacity:0.5});
  boxEdges = new THREE.LineSegments(edgeGeo, edgeMat);
  scene.add(boxEdges);
  State._currentBoxSize = size;
}

// ---- Simple orbit-style mouse controls (no external dep) ----
let isDragging=false, prevX=0, prevY=0, camAngleX=0.5, camAngleY=0.6, camDist=26;
function setupMouseControls(){
  const dom = renderer.domElement;
  dom.addEventListener('mousedown', e=>{
    if(e.target !== dom) return;
    isDragging=true; prevX=e.clientX; prevY=e.clientY;
  });
  window.addEventListener('mouseup', ()=>isDragging=false);
  window.addEventListener('mousemove', e=>{
    if(!isDragging) return;
    const dx = e.clientX-prevX, dy = e.clientY-prevY;
    prevX=e.clientX; prevY=e.clientY;
    camAngleY -= dx*0.006;
    camAngleX = Math.max(-1.3, Math.min(1.3, camAngleX - dy*0.006));
    State.autoRotate = false;
    document.getElementById('auto-rotate').checked = false;
  });
  dom.addEventListener('wheel', e=>{
    e.preventDefault();
    camDist = Math.max(8, Math.min(70, camDist + e.deltaY*0.02));
  }, {passive:false});

  // touch
  let touchStartDist=null;
  dom.addEventListener('touchstart', e=>{
    if(e.touches.length===1){ isDragging=true; prevX=e.touches[0].clientX; prevY=e.touches[0].clientY; }
    else if(e.touches.length===2){ touchStartDist=dist2(e.touches[0],e.touches[1]); }
  });
  dom.addEventListener('touchmove', e=>{
    if(e.touches.length===1 && isDragging){
      const dx=e.touches[0].clientX-prevX, dy=e.touches[0].clientY-prevY;
      prevX=e.touches[0].clientX; prevY=e.touches[0].clientY;
      camAngleY -= dx*0.008; camAngleX=Math.max(-1.3,Math.min(1.3,camAngleX-dy*0.008));
      State.autoRotate=false;
    } else if(e.touches.length===2 && touchStartDist){
      const d = dist2(e.touches[0],e.touches[1]);
      camDist = Math.max(8, Math.min(70, camDist - (d-touchStartDist)*0.05));
      touchStartDist = d;
    }
  }, {passive:true});
  dom.addEventListener('touchend', ()=>{isDragging=false; touchStartDist=null;});
}
function dist2(a,b){ return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); }

function updateCamera(dt){
  if(State.autoRotate) camAngleY += dt*0.12;
  camera.position.x = camDist*Math.cos(camAngleX)*Math.sin(camAngleY);
  camera.position.y = camDist*Math.sin(camAngleX);
  camera.position.z = camDist*Math.cos(camAngleX)*Math.cos(camAngleY);
  camera.lookAt(0,0,0);
}

function onResize(){
  camera.aspect = container.clientWidth/container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

// ============ 입자(분자) 관리 ============
function speciesGeometry(id){
  // 분자량 느낌으로 다른 형태 사용 (정성적)
  return new THREE.SphereGeometry(0.42, 16, 16);
}

function clearParticles(){
  State.particles.forEach(p=>scene.remove(p.mesh));
  State.particles = [];
}

function spawnParticle(speciesDef){
  const size = State._currentBoxSize || State.boxSize;
  const geo = speciesGeometry(speciesDef.id);
  const mat = new THREE.MeshPhysicalMaterial({
    color: speciesDef.color, emissive: speciesDef.color, emissiveIntensity:0.35,
    roughness:0.3, metalness:0.2, clearcoat:0.5
  });
  const mesh = new THREE.Mesh(geo, mat);
  const half = size/2 - 0.5;
  mesh.position.set(
    (Math.random()*2-1)*half,
    (Math.random()*2-1)*half,
    (Math.random()*2-1)*half
  );
  scene.add(mesh);
  const speed = 2.2;
  const vel = new THREE.Vector3(
    (Math.random()*2-1)*speed,
    (Math.random()*2-1)*speed,
    (Math.random()*2-1)*speed
  );
  const p = {mesh, speciesId: speciesDef.id, vel, radius:0.42};
  State.particles.push(p);
  return p;
}

function removeRandomParticle(speciesId){
  const idx = State.particles.findIndex(p=>p.speciesId===speciesId);
  if(idx>=0){
    scene.remove(State.particles[idx].mesh);
    State.particles.splice(idx,1);
    return true;
  }
  return false;
}

function initParticlesFromReaction(){
  clearParticles();
  const r = State.reaction;
  r.species.forEach(sp=>{
    State.counts[sp.id] = 0;
    for(let i=0;i<sp.initial;i++){
      spawnParticle(sp);
      State.counts[sp.id]++;
    }
  });
  updateParticleCountUI();
}

// ============ 물리 시뮬레이션(단순화된 브라운 운동 + 반응 전환) ============
function stepPhysics(dt){
  const size = State._currentBoxSize || State.boxSize;
  const half = size/2 - 0.45;
  const speedFactor = 1 + (State.temperature-298)/298; // 온도 높을수록 빠름

  State.particles.forEach(p=>{
    p.mesh.position.addScaledVector(p.vel, dt*speedFactor);
    ['x','y','z'].forEach(axis=>{
      if(p.mesh.position[axis] > half){ p.mesh.position[axis]=half; p.vel[axis]*=-1; }
      if(p.mesh.position[axis] < -half){ p.mesh.position[axis]=-half; p.vel[axis]*=-1; }
    });
    p.mesh.rotation.x += dt*0.6; p.mesh.rotation.y += dt*0.4;
  });

  // 충돌 감지 (단순 O(n^2), 입자 수 적당히 제한)
  const n = State.particles.length;
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const a = State.particles[i], b = State.particles[j];
      if(!a || !b) continue;
      const d = a.mesh.position.distanceTo(b.mesh.position);
      if(d < (a.radius+b.radius)*1.3){
        // 충돌 반발
        const normal = new THREE.Vector3().subVectors(a.mesh.position, b.mesh.position).normalize();
        a.vel.reflect(normal); b.vel.reflect(normal.clone().negate());
        playCollisionSound(0.15);
        attemptReaction(a,b);
      }
    }
  }
}

let lastReactionCheck = 0;
function attemptReaction(a,b){
  const now = performance.now();
  // 반응 확률 계산: 평형에서 멀수록 반응 진행 확률 up (Q vs Kc 기반)
  const {Q, Kc} = computeQandKc();
  const r = State.reaction;

  // 임의 두 입자가 충돌했을 때, 반응물끼리 충돌하면 정반응 후보, 생성물끼리 충돌하면 역반응 후보
  const aIsReactant = isReactant(a.speciesId), bIsReactant = isReactant(b.speciesId);
  const aIsProduct = isProduct(a.speciesId), bIsProduct = isProduct(b.speciesId);

  let direction = null;
  if(aIsReactant && bIsReactant) direction = "forward";
  else if(aIsProduct && bIsProduct) direction = "backward";
  else return; // 반응물-생성물 혼합 충돌은 스킵 (단순화)

  let prob;
  if(direction==="forward"){
    prob = Q < Kc ? 0.55 : 0.05;
  } else {
    prob = Q > Kc ? 0.55 : 0.05;
  }
  prob *= 0.35; // 전체적인 반응 빈도 조절

  if(Math.random() < prob){
    doReactionStep(direction);
    playReactionSound();
  }
}

function isReactant(id){ return State.reaction.species.some(s=>s.side==='reactant' && s.id===id); }
function isProduct(id){ return State.reaction.species.some(s=>s.side==='product' && s.id===id); }

function doReactionStep(direction){
  const r = State.reaction;
  const reactants = r.species.filter(s=>s.side==='reactant');
  const products = r.species.filter(s=>s.side==='product');

  if(direction==="forward"){
    // 반응물 coef만큼 제거, 생성물 coef만큼 추가 (스케일 다운: 최소 단위로)
    const canConsume = reactants.every(s=>(State.counts[s.id]||0) >= 1);
    if(!canConsume) return;
    reactants.forEach(s=>{ if(removeRandomParticle(s.id)) State.counts[s.id]--; });
    // 생성물 중 하나 추가 (비율 유지 위해 랜덤 하나 선택, coef 가중)
    const totalCoef = products.reduce((a,s)=>a+s.coef,0);
    let rnd = Math.random()*totalCoef;
    for(const s of products){ rnd -= s.coef; if(rnd<=0){ spawnParticle(s); State.counts[s.id]++; break; } }
  } else {
    const canConsume = products.every(s=>(State.counts[s.id]||0) >= 1);
    if(!canConsume) return;
    products.forEach(s=>{ if(removeRandomParticle(s.id)) State.counts[s.id]--; });
    const totalCoef = reactants.reduce((a,s)=>a+s.coef,0);
    let rnd = Math.random()*totalCoef;
    for(const s of reactants){ rnd -= s.coef; if(rnd<=0){ spawnParticle(s); State.counts[s.id]++; break; } }
  }
  updateParticleCountUI();
}

function computeQandKc(){
  const r = State.reaction;
  const size = State._currentBoxSize || State.boxSize;
  const volumeL = Math.pow(size,3)/50; // 임의 스케일링 (정성적)
  const reactants = r.species.filter(s=>s.side==='reactant');
  const products = r.species.filter(s=>s.side==='product');

  function conc(s){ return Math.max((State.counts[s.id]||0)/volumeL, 1e-6); }

  let num=1, den=1;
  products.forEach(s=>{ num *= Math.pow(conc(s), s.coef); });
  reactants.forEach(s=>{ den *= Math.pow(conc(s), s.coef); });
  const Q = num/den;

  // Kc: 온도가 오르면 발열반응은 Kc 감소 (반응이 역방향으로 유리)
  const dT = State.temperature - 298;
  const Kc = Math.max(r.kcBase * Math.exp(-r.kcTempSensitivity*dT), 0.01);

  return {Q, Kc};
}

// ============ UI: 입자 수 표시 ============
function updateParticleCountUI(){
  const wrap = document.getElementById('particle-counts');
  wrap.innerHTML = '';
  State.reaction.species.forEach(sp=>{
    const div = document.createElement('div');
    div.className = 'particle-count-box';
    const hexColor = '#'+sp.color.toString(16).padStart(6,'0');
    div.innerHTML = `<span><span class="dot" style="background:${hexColor};color:${hexColor};"></span><span class="name">${sp.name}</span></span><span class="count">${State.counts[sp.id]||0}</span>`;
    wrap.appendChild(div);
  });

  // Q/Kc display
  const {Q,Kc} = computeQandKc();
  document.getElementById('q-value').textContent = Q.toFixed(3);
  document.getElementById('kc-target-display').textContent = Kc.toFixed(3);
  const keqBox = document.getElementById('keq-display');
  keqBox.classList.toggle('shifting', Math.abs(Q-Kc)/Kc > 0.15);

  buildSpeciesSliders();
}

function buildSpeciesSliders(){
  const wrap = document.getElementById('species-sliders');
  // Only rebuild structure if species changed
  const key = State.reaction.species.map(s=>s.id).join(',');
  if(wrap.dataset.key === key){
    // just update values without wiping focus
    State.reaction.species.forEach(sp=>{
      const inp = wrap.querySelector(`input[data-sp="${sp.id}"]`);
      const lbl = wrap.querySelector(`span[data-sp-val="${sp.id}"]`);
      if(inp && document.activeElement!==inp) inp.value = State.counts[sp.id]||0;
      if(lbl) lbl.textContent = State.counts[sp.id]||0;
    });
    return;
  }
  wrap.dataset.key = key;
  wrap.innerHTML = '';
  State.reaction.species.forEach(sp=>{
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `<div class="slabel"><span>${sp.name}</span><span class="val" data-sp-val="${sp.id}">${State.counts[sp.id]||0}</span></div>
      <input type="range" min="0" max="150" value="${State.counts[sp.id]||0}" data-sp="${sp.id}">`;
    wrap.appendChild(row);
    row.querySelector('input').addEventListener('input', e=>{
      setSpeciesCount(sp.id, parseInt(e.target.value));
    });
  });
}

function setSpeciesCount(speciesId, target){
  const current = State.counts[speciesId]||0;
  const diff = target-current;
  const sp = State.reaction.species.find(s=>s.id===speciesId);
  if(diff>0){ for(let i=0;i<diff;i++){ spawnParticle(sp); } }
  else { for(let i=0;i<-diff;i++){ removeRandomParticle(speciesId); } }
  State.counts[speciesId] = target;
  updateParticleCountUI();
}

function addSpeciesAmount(speciesId, amount){
  const target = Math.max(0, (State.counts[speciesId]||0) + amount);
  setSpeciesCount(speciesId, target);
}

// ============ 반응식 전환 ============
function setReaction(key, customDef){
  State.reactionKey = key;
  State.reaction = customDef || JSON.parse(JSON.stringify(REACTIONS[key]));
  document.getElementById('eq-label').textContent = State.reaction.eqLabel;
  document.getElementById('reaction-select').value = (key==='custom'?'custom':key);
  initParticlesFromReaction();
  resetGraph();
}

// ============ 온도 / 부피 ============
function setTemperature(val){
  State.temperature = Math.max(150, Math.min(600, val));
  document.getElementById('temp-slider').value = State.temperature;
  document.getElementById('temp-val').textContent = Math.round(State.temperature)+' K';
  updateParticleCountUI();
}
function setVolumeScale(scale){
  State.volumeScale = Math.max(0.3, Math.min(3.0, scale));
  document.getElementById('vol-slider').value = Math.round(State.volumeScale*100);
  document.getElementById('vol-val').textContent = State.volumeScale.toFixed(2)+'x';
  buildBox();
  updateParticleCountUI();
}

// ============ 그래프 ============
const graphCanvas = document.getElementById('graph-canvas');
const gctx = graphCanvas.getContext('2d');
function resetGraph(){ State.graphHistory = []; State.simTime = 0; drawGraph(); }
function pushGraphSample(){
  State.graphHistory.push({t:State.simTime, counts:Object.assign({}, State.counts)});
  if(State.graphHistory.length>200) State.graphHistory.shift();
  drawGraph();
}
function drawGraph(){
  const w = graphCanvas.width, h = graphCanvas.height;
  gctx.clearRect(0,0,w,h);
  gctx.fillStyle = 'rgba(0,0,0,0.15)';
  gctx.fillRect(0,0,w,h);
  if(State.graphHistory.length<2) return;
  const species = State.reaction.species;
  let maxVal = 10;
  State.graphHistory.forEach(pt=>species.forEach(s=>{ maxVal = Math.max(maxVal, pt.counts[s.id]||0); }));
  const tMin = State.graphHistory[0].t, tMax = State.graphHistory[State.graphHistory.length-1].t || 1;
  species.forEach(sp=>{
    gctx.beginPath();
    gctx.strokeStyle = '#'+sp.color.toString(16).padStart(6,'0');
    gctx.lineWidth = 2;
    State.graphHistory.forEach((pt,i)=>{
      const x = ((pt.t-tMin)/(tMax-tMin||1))*w;
      const y = h - ((pt.counts[sp.id]||0)/maxVal)*h*0.9 - 4;
      if(i===0) gctx.moveTo(x,y); else gctx.lineTo(x,y);
    });
    gctx.stroke();
  });
}

// ============ 오디오 (충돌/반응 효과음, WebAudio 합성 - 외부 파일 불필요) ============
function ensureAudio(){
  if(!State.audioCtx){
    try{ State.audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){}
  }
  return State.audioCtx;
}
let lastCollisionSoundTime=0;
function playCollisionSound(vol){
  if(!State.soundOn) return;
  const now = performance.now();
  if(now-lastCollisionSoundTime < 60) return; // throttle
  lastCollisionSoundTime = now;
  const ctx = ensureAudio(); if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 300+Math.random()*200;
  gain.gain.setValueAtTime((vol||0.1), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.08);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime+0.09);
}
function playReactionSound(){
  if(!State.soundOn) return;
  const ctx = ensureAudio(); if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime+0.25);
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.28);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime+0.3);
}

// ============ 스크린샷 / 녹화 ============
function takeScreenshot(){
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `chemistry-equilibrium-${Date.now()}.png`;
  a.click();
  toast('📷 PNG 캡처 완료');
}
function saveGraphPng(){
  const url = graphCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `equilibrium-graph-${Date.now()}.png`;
  a.click();
  toast('📈 그래프 PNG 저장 완료');
}
function toggleRecording(){
  if(!State.isRecording){
    try{
      const stream = renderer.domElement.captureStream(30);
      let mimeType = 'video/webm;codecs=vp9';
      if(!MediaRecorder.isTypeSupported(mimeType)) mimeType='video/webm';
      State.recorder = new MediaRecorder(stream, {mimeType});
      State.recordedChunks = [];
      State.recorder.ondataavailable = e=>{ if(e.data.size>0) State.recordedChunks.push(e.data); };
      State.recorder.onstop = ()=>{
        const blob = new Blob(State.recordedChunks, {type:'video/webm'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        // 파일 확장자는 mp4로 요청받았으나 브라우저 네이티브 녹화는 webm 컨테이너 사용됨 (재생 호환 안내는 사용법 문서 참고)
        a.href = url; a.download = `chemistry-equilibrium-${Date.now()}.webm`;
        a.click();
        toast('🎬 녹화 파일 저장 완료 (webm)');
      };
      State.recorder.start();
      State.isRecording = true;
      document.getElementById('rec-indicator').classList.add('show');
      document.getElementById('btn-record').classList.add('active');
      document.getElementById('btn-record').textContent = '⏹ 녹화 종료';
    }catch(e){
      toast('⚠ 이 브라우저는 화면 녹화를 지원하지 않습니다.');
    }
  } else {
    State.recorder && State.recorder.stop();
    State.isRecording = false;
    document.getElementById('rec-indicator').classList.remove('show');
    document.getElementById('btn-record').classList.remove('active');
    document.getElementById('btn-record').textContent = '⏺ 녹화(MP4)';
  }
}

// ============ Toast ============
function toast(msg){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), 2600);
}

// ============ 실시간 시계 (드래그 가능) ============
function initClock(){
  const clockEl = document.getElementById('clock');
  const textEl = document.getElementById('clock-text');
  function fmt(){
    const d = new Date();
    const y=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
    let h = d.getHours();
    const ampm = h<12 ? '오전' : '오후';
    let h12 = h%12; if(h12===0) h12=12;
    const mi = String(d.getMinutes()).padStart(2,'0'), se = String(d.getSeconds()).padStart(2,'0');
    textEl.innerHTML = `${y}년 ${mo}월 ${da}일<br>${ampm} ${String(h12).padStart(2,'0')}시 ${mi}분 ${se}초`;
  }
  fmt();
  setInterval(fmt, 1000);

  // Drag logic, clamped to viewport, no overflow
  let dragging=false, offX=0, offY=0;
  clockEl.addEventListener('mousedown', e=>{
    dragging=true;
    const rect = clockEl.getBoundingClientRect();
    offX = e.clientX-rect.left; offY = e.clientY-rect.top;
    clockEl.style.left = rect.left+'px';
    clockEl.style.top = rect.top+'px';
    clockEl.style.right='auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e=>{
    if(!dragging) return;
    let x = e.clientX-offX, y = e.clientY-offY;
    const maxX = window.innerWidth - clockEl.offsetWidth - 4;
    const maxY = window.innerHeight - clockEl.offsetHeight - 4;
    x = Math.max(4, Math.min(maxX, x));
    y = Math.max(4, Math.min(maxY, y));
    clockEl.style.left = x+'px'; clockEl.style.top = y+'px';
  });
  window.addEventListener('mouseup', ()=>dragging=false);

  // touch support
  clockEl.addEventListener('touchstart', e=>{
    dragging=true;
    const rect = clockEl.getBoundingClientRect();
    const t = e.touches[0];
    offX = t.clientX-rect.left; offY = t.clientY-rect.top;
    clockEl.style.left = rect.left+'px'; clockEl.style.top = rect.top+'px'; clockEl.style.right='auto';
  }, {passive:true});
  window.addEventListener('touchmove', e=>{
    if(!dragging) return;
    const t = e.touches[0];
    let x = t.clientX-offX, y = t.clientY-offY;
    const maxX = window.innerWidth - clockEl.offsetWidth - 4;
    const maxY = window.innerHeight - clockEl.offsetHeight - 4;
    x = Math.max(4, Math.min(maxX, x));
    y = Math.max(4, Math.min(maxY, y));
    clockEl.style.left = x+'px'; clockEl.style.top = y+'px';
  }, {passive:true});
  window.addEventListener('touchend', ()=>dragging=false);

  // re-clamp on resize so it never goes off-screen
  window.addEventListener('resize', ()=>{
    const rect = clockEl.getBoundingClientRect();
    const maxX = window.innerWidth - clockEl.offsetWidth - 4;
    const maxY = window.innerHeight - clockEl.offsetHeight - 4;
    let x = Math.min(rect.left, maxX), y = Math.min(rect.top, maxY);
    if(clockEl.style.left){ clockEl.style.left = Math.max(4,x)+'px'; clockEl.style.top = Math.max(4,y)+'px'; }
  });
}

// ============ 커스텀 반응식 빌더 ============
function renderSpeciesList(){
  const wrap = document.getElementById('species-list');
  wrap.innerHTML = '';
  State.customSpecies.forEach((sp, idx)=>{
    const div = document.createElement('div');
    div.className = 'species-item';
    div.innerHTML = `<span class="sw" style="background:${sp.colorHex}"></span>
      <span class="nm">${sp.coef>1?sp.coef:''}${sp.id} (${sp.side==='reactant'?'반응물':'생성물'})</span>
      <button data-idx="${idx}">✕</button>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      State.customSpecies.splice(parseInt(btn.dataset.idx),1);
      renderSpeciesList();
    });
  });
}

function applyCustomReaction(){
  if(State.customSpecies.length<2){ toast('⚠ 반응물과 생성물을 각각 1개 이상 추가하세요.'); return; }
  const hasReactant = State.customSpecies.some(s=>s.side==='reactant');
  const hasProduct = State.customSpecies.some(s=>s.side==='product');
  if(!hasReactant || !hasProduct){ toast('⚠ 반응물과 생성물이 모두 필요합니다.'); return; }

  const reactantStr = State.customSpecies.filter(s=>s.side==='reactant').map(s=>(s.coef>1?s.coef:'')+s.id).join(' + ');
  const productStr = State.customSpecies.filter(s=>s.side==='product').map(s=>(s.coef>1?s.coef:'')+s.id).join(' + ');
  const customDef = {
    label: `${reactantStr} ⇌ ${productStr}`,
    eqLabel: `${reactantStr} ⇌ ${productStr}`,
    exothermic: true,
    species: State.customSpecies.map(s=>({id:s.id, name:s.id, side:s.side, coef:s.coef, color: parseInt(s.colorHex.replace('#','0x')), initial: 30})),
    kcBase: 2.0,
    kcTempSensitivity: 0.01
  };
  setReaction('custom', customDef);
  toast('✓ 커스텀 반응식 적용됨');
}

// ============ 도큐먼트 모달 ============
function openModal(html){
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('show'); }

// ============ AI 패널 ============
function aiAppendMsg(text, who){
  const log = document.getElementById('ai-log');
  const div = document.createElement('div');
  div.className = 'ai-msg '+who;
  div.innerHTML = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function findSpeciesByLooseName(name){
  const n = name.toUpperCase().replace(/[₀-₉]/g, d=>'0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(d)]);
  return State.reaction.species.find(s=> s.id.toUpperCase()===n || s.id.toUpperCase().replace(/[0-9]/g,'')===n.replace(/[0-9]/g,''));
}

function executeAICommand(cmd){
  const exec = {};
  switch(cmd.type){
    case "temp_set":
      setTemperature(cmd.value); exec.value = Math.round(State.temperature); break;
    case "temp_delta":
      setTemperature(State.temperature+cmd.delta); exec.delta=cmd.delta; exec.newValue=Math.round(State.temperature); break;
    case "vol_scale":
      setVolumeScale(State.volumeScale*cmd.factor); exec.factor=cmd.factor; exec.newValue=Math.round(State.volumeScale*100); break;
    case "vol_set_pct":
      setVolumeScale(cmd.value/100); exec.value=cmd.value; break;
    case "vol_reset":
      setVolumeScale(1.0); break;
    case "shift_forward":
      if(State.reaction.exothermic) setTemperature(State.temperature-40);
      setVolumeScale(State.volumeScale*0.75);
      break;
    case "shift_backward":
      if(State.reaction.exothermic) setTemperature(State.temperature+40);
      setVolumeScale(State.volumeScale*1.35);
      break;
    case "set_reaction":
      setReaction(cmd.key); exec.label = REACTIONS[cmd.key].label; break;
    case "species_add": {
      const sp = findSpeciesByLooseName(cmd.name);
      if(!sp){ return {type:"unknown_species", name:cmd.name}; }
      addSpeciesAmount(sp.id, cmd.amount);
      exec.name = sp.name; exec.amount = cmd.amount;
      break;
    }
    case "pause": setPlaying(false); break;
    case "play": setPlaying(true); break;
    case "reset_sim": setReaction(State.reactionKey==='custom'?'no2_n2o4':State.reactionKey); break;
    case "speed_scale":
      State.simSpeed = Math.max(0.1, Math.min(3, State.simSpeed*cmd.factor));
      document.getElementById('speed-slider').value = Math.round(State.simSpeed*100);
      document.getElementById('speed-val').textContent = State.simSpeed.toFixed(1)+'x';
      exec.newValue = Math.round(State.simSpeed*100);
      break;
    case "screenshot": takeScreenshot(); break;
    case "record_start": if(!State.isRecording) toggleRecording(); break;
    case "record_stop": if(State.isRecording) toggleRecording(); break;
    case "sound_off": State.soundOn=false; break;
    case "sound_on": State.soundOn=true; break;
  }
  return exec;
}

function handleAIInput(text){
  if(!text.trim()) return;
  aiAppendMsg(text, 'user');
  const cmd = AIParser.process(text);
  if(cmd.type === 'clarify'){
    aiAppendMsg(cmd.question, 'bot');
    return;
  }
  if(cmd.type === 'unknown'){
    aiAppendMsg("무엇을 도와드릴까요? 예를 들어 '온도를 400K로 올려줘', '부피를 절반으로 줄여줘', 'NO2를 20개 추가해줘', '정반응 쪽으로 이동시켜줘' 처럼 말씀해주시면 제가 컨트롤을 자동으로 조정해드릴게요.", 'bot');
    return;
  }
  const exec = executeAICommand(cmd);
  if(exec && exec.type === 'unknown_species'){
    aiAppendMsg(`"${exec.name}"라는 물질을 현재 반응식에서 찾을 수 없어요. 현재 반응식의 물질: ${State.reaction.species.map(s=>s.name).join(', ')} 중에서 말씀해주시겠어요?`, 'bot');
    return;
  }
  const desc = AIParser.describeAction(cmd, exec);
  aiAppendMsg(desc, 'bot');
}

// ============ 재생/일시정지 ============
function setPlaying(v){
  State.playing = v;
  const btn = document.getElementById('btn-play');
  btn.textContent = v ? '⏸ 일시정지' : '▶ 재생';
}

// ============ 애니메이션 루프 ============
let graphAccum = 0;
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock3d.getDelta(), 0.05);
  updateCamera(dt);
  if(State.playing){
    const simDt = dt*State.simSpeed;
    stepPhysics(simDt);
    State.simTime += simDt;
    graphAccum += simDt;
    if(graphAccum > 0.5){ graphAccum=0; pushGraphSample(); updateParticleCountUI(); }
  }
  renderer.render(scene, camera);
}

// ============ 이벤트 바인딩 ============
function bindUI(){
  document.getElementById('btn-docs-theory').addEventListener('click', ()=>openModal(THEORY_CONTENT_HTML));
  document.getElementById('btn-docs-usage').addEventListener('click', ()=>openModal(USAGE_CONTENT_HTML));
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e=>{ if(e.target.id==='modal-overlay') closeModal(); });

  document.getElementById('btn-screenshot').addEventListener('click', takeScreenshot);
  document.getElementById('btn-record').addEventListener('click', toggleRecording);
  document.getElementById('btn-graph-png').addEventListener('click', saveGraphPng);
  document.getElementById('btn-graph-reset').addEventListener('click', resetGraph);

  const soundBtn = document.getElementById('btn-sound');
  soundBtn.classList.add('active');
  soundBtn.addEventListener('click', ()=>{
    State.soundOn = !State.soundOn;
    soundBtn.classList.toggle('active', State.soundOn);
    soundBtn.textContent = State.soundOn ? '🔊 효과음' : '🔇 효과음 꺼짐';
  });

  document.getElementById('reaction-select').addEventListener('change', e=>{
    const v = e.target.value;
    document.getElementById('custom-section').style.display = (v==='custom') ? 'block' : 'none';
    if(v!=='custom') setReaction(v);
  });

  document.getElementById('custom-add').addEventListener('click', ()=>{
    const name = document.getElementById('custom-name').value.trim();
    if(!name){ toast('⚠ 이름을 입력하세요.'); return; }
    const color = document.getElementById('custom-color').value;
    const coef = parseInt(document.getElementById('custom-coef').value)||1;
    const side = document.getElementById('custom-side').value;
    State.customSpecies.push({id:name, colorHex:color, coef, side});
    renderSpeciesList();
    document.getElementById('custom-name').value='';
  });
  document.getElementById('custom-apply').addEventListener('click', applyCustomReaction);

  document.getElementById('temp-slider').addEventListener('input', e=>setTemperature(parseFloat(e.target.value)));
  document.querySelectorAll('[data-temp]').forEach(btn=>{
    btn.addEventListener('click', ()=>setTemperature(State.temperature+parseFloat(btn.dataset.temp)));
  });

  document.getElementById('vol-slider').addEventListener('input', e=>setVolumeScale(parseFloat(e.target.value)/100));
  document.getElementById('vol-half').addEventListener('click', ()=>setVolumeScale(State.volumeScale*0.5));
  document.getElementById('vol-double').addEventListener('click', ()=>setVolumeScale(State.volumeScale*2));
  document.getElementById('vol-reset').addEventListener('click', ()=>setVolumeScale(1.0));

  document.getElementById('btn-play').addEventListener('click', ()=>setPlaying(!State.playing));
  document.getElementById('btn-reset-sim').addEventListener('click', ()=>setReaction(State.reactionKey==='custom'?'no2_n2o4':State.reactionKey));
  document.getElementById('speed-slider').addEventListener('input', e=>{
    State.simSpeed = parseFloat(e.target.value)/100;
    document.getElementById('speed-val').textContent = State.simSpeed.toFixed(1)+'x';
  });
  document.getElementById('auto-rotate').addEventListener('change', e=>{ State.autoRotate = e.target.checked; });

  document.getElementById('ai-send').addEventListener('click', ()=>{
    const inp = document.getElementById('ai-input');
    handleAIInput(inp.value);
    inp.value='';
  });
  document.getElementById('ai-input').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ handleAIInput(e.target.value); e.target.value=''; }
  });

  // mobile panel toggle
  if(window.innerWidth <= 900){
    document.getElementById('btn-panel-toggle').style.display='inline-flex';
    document.getElementById('btn-panel-toggle').addEventListener('click', ()=>{
      document.getElementById('sidepanel').classList.toggle('open');
    });
  }
}

// ============ 초기화 ============
function init(){
  initThree();
  initClock();
  bindUI();
  setReaction('no2_n2o4');
  aiAppendMsg("안녕하세요! 온도, 부피, 입자 수 조정을 자연어로 요청해보세요. 예: '온도를 400K로 올려줘'", 'bot');
}

window.addEventListener('DOMContentLoaded', init);

})();
