import {createNumberPainting} from './numbers.mjs';
import {paperSurface} from './hand.mjs';
import {paper,stroke,measure,position} from './paint.mjs?v=form-strokes';

const $ = id => document.getElementById(id);
const {canvas,surface,drop,source,filename,dimensions,progress,speed,start,reset,status,
  replace,playback,downloads,clock} =
  Object.fromEntries('canvas surface drop source filename dimensions progress speed start reset status replace playback downloads clock'.split(' ').map(id=>[id,$(id)]));
const download = $('export');
const savePng = $('save-png');
const demo = $('demo');
const demoVideos = [...demo.querySelectorAll('video')];
const pausedDemos = new Set();
let demoVisible=false;
const demoFold = $('demo-fold');
const pickers = document.querySelectorAll('.file-picker input');
const upload = $('upload');
const editor = $('editor');
const processing = $('processing');
const processingStep = $('processing-step');
const processingProgress = $('processing-progress');
const compact = matchMedia('(pointer: coarse)');
const uploadStatus = $('upload-status');
const phases = [...document.querySelectorAll('.timeline li')];
const currentStage = $('current-stage');
let displayedStage = -1;
const ctx = canvas.getContext('2d');
const reference = document.createElement('canvas');
const painted = document.createElement('canvas');
const ink = painted.getContext('2d',{alpha:false,willReadFrequently:true});
const lineLayer=document.createElement('canvas');
const lineCtx=lineLayer.getContext('2d');
const roughPreview=document.createElement('canvas');
const roughPreviewCtx=roughPreview.getContext('2d');
const roughLayer=document.createElement('canvas');
const roughCtx=roughLayer.getContext('2d');
const videoDuration=$('video-duration');
const stageWeights = [.39,.33,.28];
let limits = [0,.39,.72,1];
const speedpaintMode=$('mode-speedpaint');
const numberMode=$('mode-numbers');
const numberWorkspace=$('number-workspace');
const numbers=createNumberPainting(numberWorkspace);
let paintingNumbers=false;
function selectMode(showNumbers){
  if(showNumbers && !numbers.ready)numbers.load(reference);
  paintingNumbers=showNumbers;
  numberWorkspace.hidden=!showNumbers;
  surface.hidden=playback.hidden=showNumbers;
  speedpaintMode.setAttribute('aria-pressed',String(!showNumbers));
  numberMode.setAttribute('aria-pressed',String(showNumbers));
}
speedpaintMode.addEventListener('click',()=>selectMode(false));
numberMode.addEventListener('click',()=>selectMode(true));
const duration = 64000;
phases.forEach((item,i)=>item.style.setProperty('--stage',limits[i]*100+'%'));
const formats = ['video/webm;codecs=vp8','video/mp4','video/webm'];
const mime = typeof MediaRecorder !== 'undefined' && canvas.captureStream &&
  formats.find(type=>MediaRecorder.isTypeSupported(type));
let ready = false, loading = false, running = false, exporting = false;
let time = 0, frame = 0, previous = 0, generation = 0;
let sequence = [], phase = 0, index = 0, photoName = 'speedpaint';
let focus, prepared, recordFrame, preparation;

function videoContentSize() {
  const scale = Math.min(1,(compact.matches ? 720 : 1280)/Math.max(canvas.width,canvas.height));
  return [Math.max(1,Math.round(canvas.width*scale)),Math.max(1,Math.round(canvas.height*scale))];
}
function videoSize() {
  // Align the encoder surface so that captureStream does not rescale and crop odd-sized frames.
  return videoContentSize().map(value=>Math.ceil(value/4)*4);
}
function controls() {
  const busy = loading || exporting;
  numberMode.disabled = busy || running || !ready;
  playback.classList.toggle('preview',!time && !running && !exporting);
  const complete = time>=duration;
  start.disabled = !ready || busy;
  reset.disabled = !ready || busy;
  download.disabled = !ready || busy || !mime || !complete;
  savePng.disabled = !ready || busy || !complete;
  downloads.hidden = !complete && !exporting;
  for(const picker of pickers)picker.disabled=exporting;
  speed.disabled = videoDuration.disabled = exporting;
  start.textContent = running && !exporting ? 'Пауза' : complete ? 'Заново' : time>0 ? 'Продолжить' : 'Старт';
  start.classList.toggle('primary',!complete && !exporting);
}
function updateProgress(fraction) {
  if(exporting) download.textContent='Записываю видео · '+Math.round(fraction*100)+'%';
  const format=ms=>{
    const seconds=Math.floor(ms/1000);
    return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  };
  let activeStage = Math.min(phases.length-1,phase);
  while (activeStage>0 && phases[activeStage].hidden) activeStage--;
  if (activeStage!==displayedStage) {
    const previousStage = phases[displayedStage];
    previousStage?.classList.remove('active');
    previousStage?.removeAttribute('aria-current');
    const item = phases[activeStage];
    item.classList.add('active');
    item.setAttribute('aria-current','step');
    currentStage.textContent = item.hidden ? '' : item.textContent;
    displayedStage = activeStage;
  }
  progress.value=fraction;
  clock.textContent=format(time)+' / '+format(duration);
}
function wipe() {
  time = phase = index = 0;
  updateProgress(0);
  roughLayer.width=roughPreview.width=lineLayer.width=canvas.width;
  roughLayer.height=roughPreview.height=lineLayer.height=canvas.height;
  paperSurface(ink);
  ctx.drawImage(painted,0,0);
}
function showFocus() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(reference,0,0);
  if (!focus) return;
  const radius=Math.max(8,Math.max(canvas.width,canvas.height)*.015);
  ctx.beginPath();
  ctx.arc(focus[0]*canvas.width,focus[1]*canvas.height,radius,0,Math.PI*2);
  ctx.lineWidth=Math.max(2,radius*.16);
  ctx.strokeStyle='#f05b93';
  ctx.stroke();
}
async function load(image) {
  if (!image || exporting) return;
  const ticket = ++generation;
  preparation?.abort();
  processing.hidden = true;
  const url = URL.createObjectURL(image);
  cancelAnimationFrame(frame);
  running = false;
  loading = true;
  controls();
  uploadStatus.textContent = status.textContent = 'Открываю '+image.name+'…';
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    if (ticket!==generation) return;
    const ratio = Math.min(1, (compact.matches ? 800 : 960)/Math.max(picture.naturalWidth,picture.naturalHeight));
    canvas.width = painted.width = Math.max(1,Math.round(picture.naturalWidth*ratio));
    canvas.height = painted.height = Math.max(1,Math.round(picture.naturalHeight*ratio));
    ctx.imageSmoothingQuality = 'high';
    reference.width = canvas.width;
    reference.height = canvas.height;
    ink.setTransform(canvas.width/reference.width,0,0,canvas.height/reference.height,0,0);
    const ref = reference.getContext('2d');
    ref.fillStyle = 'white';
    ref.fillRect(0,0,reference.width,reference.height);
    ref.drawImage(picture,0,0,reference.width,reference.height);
    prepared=null;
    limits=[0,.39,.72,1];
    phases.forEach((item,i)=>{
      item.hidden=false;
      item.style.setProperty('--stage',limits[i]*100+'%');
    });
    sequence=[];
    filename.textContent = image.name;
    photoName = image.name.replace(/\.[^.]+$/, '') || 'speedpaint';
    source.hidden = canvas.hidden = replace.hidden = playback.hidden = false;
    editor.hidden = false;
    upload.hidden = true;
    document.body.classList.add('has-photo');
    document.querySelector('main').append(demo);
    for (const video of demoVideos) video.pause();
    if (mime) download.textContent = 'Скачать ' + (mime.includes('mp4') ? 'MP4' : 'WebM') + ' · ' + videoSize().join(' × ');
    savePng.textContent = 'Рисунок в PNG · ' + canvas.width + ' × ' + canvas.height;
    dimensions.textContent = picture.naturalWidth+' × '+picture.naturalHeight+' px';
    ready = true;
    numbers.reset();
    selectMode(paintingNumbers);
    focus = null;
    wipe();
    showFocus();
    status.textContent = 'Фото готово. Нажмите «Старт».';
    uploadStatus.textContent = 'Фото загружено. Редактор ниже.';
    editor.scrollIntoView({block:'start'});
  } catch {
    if (ticket===generation) uploadStatus.textContent = status.textContent = 'Не удалось открыть фото «'+image.name+'». Выберите JPG, PNG или WebP.';
  } finally {
    URL.revokeObjectURL(url);
    if (ticket===generation) {
      loading = false;
      controls();
    }
  }
}
for(const picker of pickers)picker.addEventListener('change',()=>{
  const image=picker.files[0];
  picker.value='';
  if(image)load(image);
});
for (const video of demoVideos) {
  const card=video.closest('figure');
  const button=card.querySelector('button');
  const caption=card.querySelector('figcaption').textContent;
  function sync() {
    button.textContent=video.paused?'▶':'Ⅱ';
    button.setAttribute('aria-label',(video.paused?'Воспроизвести: ':'Приостановить: ')+caption);
  }
  video.addEventListener('play',sync);
  video.addEventListener('pause',sync);
  video.addEventListener('ended',sync);
  button.addEventListener('click',()=>{
    if (!video.paused) pausedDemos.add(video);
    else {pausedDemos.delete(video); video.dataset.manual='true';}
    updateDemoPlayback();
  });
}
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
if (reduceMotion.matches) for (const video of demoVideos) pausedDemos.add(video);
function updateDemoPlayback() {
  const visible=demoVisible && !demo.classList.contains('is-collapsed') && !document.hidden;
  for(const [index,video] of demoVideos.entries()) {
    if(visible && video.dataset.manual && !pausedDemos.has(video)) video.play().catch(()=>{});
    else video.pause();
  }
}
let scrollFrame=0;
// Match the pinned showcase transition used on EdiTool.
function paintShowcase() {
  scrollFrame=0;
  if (demo.hidden || demo.classList.contains('is-collapsed')) return;
  const {top,height}=demo.getBoundingClientRect();
  const progress=reduceMotion.matches || !height ? 0 : Math.min(1,Math.max(0,-top/height));
  const fade=Math.min(1,progress/.8);
  demo.style.setProperty('--showcase-scale',String(1+.1*progress));
  demo.style.setProperty('--showcase-fade-start',`${-100*fade}%`);
  demo.style.setProperty('--showcase-fade-mid',`${70-170*fade}%`);
  demo.style.setProperty('--showcase-fade-end',`${100-80*fade}%`);
  demo.style.setProperty('--showcase-blur',`${Math.max(0,fade-.5)*100}px`);
}
function scheduleShowcase() {
  if (!scrollFrame && !demo.hidden) scrollFrame=requestAnimationFrame(paintShowcase);
}
addEventListener('scroll',scheduleShowcase,{passive:true});
addEventListener('resize',scheduleShowcase,{passive:true});
reduceMotion.addEventListener('change',scheduleShowcase);
demoFold.addEventListener('click',()=>{
  const collapsed=demo.classList.toggle('is-collapsed');
  demoFold.setAttribute('aria-expanded',String(!collapsed));
  demoFold.textContent=collapsed?'Развернуть видео':'Свернуть видео';
  updateDemoPlayback();
  scheduleShowcase();
});
new IntersectionObserver(([entry])=>{
  demoVisible=entry.isIntersecting;
  updateDemoPlayback();
}).observe(demo);
document.addEventListener('visibilitychange',updateDemoPlayback);
scheduleShowcase();
for(const zone of [surface,drop]) {
  zone.addEventListener('dragover',event=>{
    event.preventDefault();
    if (!exporting) zone.classList.add('over');
  });
  zone.addEventListener('dragleave',()=>zone.classList.remove('over'));
  zone.addEventListener('drop',event=>{
    event.preventDefault();
    zone.classList.remove('over');
    load(event.dataTransfer.files[0]);
  });
}
for (const slider of [speed]) {
  slider.addEventListener('input',()=>{
    const output = document.querySelector('output[for='+slider.id+']');
    output.value = slider===speed ? slider.value.replace('.',',')+'×' : slider.value+'%';
  });
}
function schedule(marks,stage,tail) {
  let end = 0;
  let previousColor;
  const timing = marks.map(mark=>{
    const length=measure(mark);
    const gap=tail?Math.hypot(mark.points[0][0]-tail[0],mark.points[0][1]-tail[1]):0;
    const reload=previousColor!==undefined&&previousColor!==mark.color&&gap>mark.width*1.4;
    const begin=end+Math.min(15,Math.sqrt(gap)*.48)+(reload?4:0);
    end=begin+(2+length/(stage===0?3.2:5)+Math.sqrt(mark.width))*(mark.pace || 1);
    tail=mark.points.at(-1);previousColor=mark.color;
    return {begin,end};
  });
  if(stage===1 && marks.length){
    const changes=marks.reduce((n,mark,i)=>n+Number(i>0&&mark.startsMixture&&marks[i-1].color!==mark.color),0);
    const pause=changes?end*.19/changes:0;
    let delay=0;
    timing.forEach((slot,i)=>{
      if(i>0&&marks[i].startsMixture&&marks[i-1].color!==marks[i].color)delay+=pause;
      slot.begin+=delay;slot.end+=delay;
    });
    end+=delay;
  }
  let roughEnd=0;
  const firstInk=stage===0?marks.findIndex(mark=>!mark.rough):0;
  if(firstInk>0){
    const split=timing[firstInk].begin;
    roughEnd=end*.28;
    const map=t=>t<=split?t/split*roughEnd:roughEnd+(t-split)/(end-split)*(end-roughEnd);
    for(const slot of timing){slot.begin=map(slot.begin);slot.end=map(slot.end);}
  }
  return {marks,timing,end,tail};
}
async function buildPainting() {
  if (prepared) return;
  loading = true;
  controls();
  processingStep.textContent = 'Анализирую изображение…';
  processingProgress.value = 3;
  processing.hidden = false;
  surface.scrollIntoView({block:'nearest'});
  const job = new AbortController();
  preparation = job;
  let worker;
  try {
    const bitmap = await createImageBitmap(reference);
    if (job.signal.aborted) {
      bitmap.close();
      return;
    }
    worker = new Worker(new URL('./universal.mjs?v=form-strokes',import.meta.url),{type:'module'});
    const result = await new Promise((resolve,reject)=>{
      job.signal.addEventListener('abort',()=>reject(new DOMException('Replaced','AbortError')),{once:true});
      worker.onerror = event=>{event.preventDefault(); reject(new Error(event.message));};
      worker.onmessage = ({data})=>{
        if (job.signal.aborted) return;
        if (data.error) reject(new Error(data.error));
        else if (data.stages) resolve(data);
        else {
          processingStep.textContent = data.label;
          processingProgress.value = data.value;
        }
      };
      worker.postMessage({bitmap},[bitmap]);
    });
    if (job.signal.aborted) return;
    let tail;
    const sequence=result.stages.map((marks,i)=>{
      const stage=schedule(marks,i,tail);
      tail=stage.tail;
      return stage;
    });
    const weights=sequence.map((s,i)=>s.marks.length
      ? (result.weights||stageWeights)[i] : 0);
    const total=weights.reduce((a,b)=>a+b,0);
    const boundaries=[0];
    for(const weight of weights) boundaries.push(boundaries.at(-1)+weight/(total||1));
    boundaries[boundaries.length-1]=1;
    prepared={sequence,limits:boundaries};
  } finally {
    worker?.terminate();
    if (!job.signal.aborted) {
      preparation=null;
      processing.hidden = true;
      loading=false;
      controls();
    }
  }
}
function prepare() {
  sequence=prepared.sequence;
  limits=prepared.limits;
  phases.forEach((item,i)=>{
    item.hidden=!sequence[i].marks.length;
    item.style.setProperty('--stage',limits[i]*100+'%');
  });
  wipe();
}
function eraseDraft(target,mark,fraction=1){
  target.save();
  target.globalCompositeOperation='destination-out';
  stroke(target,mark,fraction);
  target.restore();
}
function commitMark(mark){
  if(mark.erase)eraseDraft(roughCtx,mark);
  else if(mark.rough)stroke(roughCtx,mark);
  else if(mark.finishInk || (phase===0&&!mark.underPaint))stroke(lineCtx,mark);
  else stroke(ink,mark);
}
function render(fraction) {
  while (phase<sequence.length-1 && fraction>=limits[phase+1]) {
    const {marks} = sequence[phase];
    while (index<marks.length) commitMark(marks[index++]);
    phase++;
    index = 0;
  }
  const {marks,timing,end} = sequence[phase];
  const stopAt=limits[phase+1];
  const value = end*(Math.min(fraction,stopAt)-limits[phase])/(stopAt-limits[phase] || 1);
  while (index<marks.length && (timing[index].end<=value+1e-7 || fraction>=stopAt)) commitMark(marks[index++]);
  ctx.drawImage(painted,0,0);
  const slot=timing[index];
  const mark=marks[index];
  const partial=slot && value>slot.begin && slot.end>value
    ? (value-slot.begin)/(slot.end-slot.begin) : 0;
  if(phase===0){
    if(partial && mark.erase){
      roughPreviewCtx.clearRect(0,0,canvas.width,canvas.height);
      roughPreviewCtx.drawImage(roughLayer,0,0);
      eraseDraft(roughPreviewCtx,mark,partial);
      ctx.drawImage(roughPreview,0,0);
    }else ctx.drawImage(roughLayer,0,0);
  }
  if(phase>0 && partial && !mark.finishInk)stroke(ctx,mark,partial);
  ctx.drawImage(lineLayer,0,0);
  if(partial && !mark.erase && (phase===0||mark.finishInk))stroke(ctx,mark,partial);
  if(!exporting && slot && mark.points.length>1 && fraction<1){
    const last=marks[index-1]?.points.at(-1) ?? sequence[phase-1]?.tail;
    const start=mark.points[0];
    const [from,to,t]=partial
      ? (()=>{const p=position(mark,partial),i=Math.min(mark.points.length-2,Math.floor(p));
        return [mark.points[i],mark.points[i+1],p-i];})()
      : [last??start,start,Math.max(0,Math.min(1,(value-(timing[index-1]?.end??0))/(slot.begin-(timing[index-1]?.end??0)||1)))];
    const x=from[0]+(to[0]-from[0])*t,y=from[1]+(to[1]-from[1])*t;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x,y,mark.erase?4:2.7,0,Math.PI*2);
    ctx.lineWidth=1.25;
    ctx.strokeStyle='#fff';
    ctx.fillStyle='#37302d';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  updateProgress(fraction);
}

function play(rate, done) {
  previous = 0;
  running = true;
  controls();
  if (sequence.every(stage=>!stage.marks.length)) time=duration;
  function tick(now) {
    if (previous) {
      const speed=rate();
      time=Math.min(duration,time+(exporting?now-previous:Math.min(67,now-previous))*speed);
    }
    previous = now;
    render(time/duration);
    recordFrame?.(now);
    if (time<duration) {
      frame = requestAnimationFrame(tick);
    } else {
      running = false;
      status.textContent = exporting ? 'Завершаю запись…' : 'Рисунок готов.';
      controls();
      done?.();
    }
  }
  frame = requestAnimationFrame(tick);
}
start.addEventListener('click',async()=>{
  if (loading || exporting) return;
  if (running) {
    cancelAnimationFrame(frame);
    running = false;
    status.textContent = 'Пауза.';
    controls();
    return;
  }
  if (!time || time>=duration) {
    const ticket=generation;
    try {
      await buildPainting();
      if (ticket!==generation) return;
      prepare();
    } catch (error) {
      if (ticket!==generation) return;
      console.error(error);
      status.textContent = 'Не удалось подготовить рисунок. Попробуйте ещё раз.';
      return;
    }
  }
  status.textContent = 'Рисую…';
  play(()=>+speed.value);
});
reset.addEventListener('click',()=>{
  cancelAnimationFrame(frame);
  running = false;
  wipe();
  showFocus();
  status.textContent = 'Фото готово. Нажмите «Старт».';
  controls();
});
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
savePng.addEventListener('click',()=>{
  const name = photoName+'-final.png';
  canvas.toBlob(blob=>{
    if (blob) save(blob,name);
    else status.textContent = 'Не удалось сохранить PNG.';
  },'image/png');
});
download.addEventListener('click',()=>{
  if(!videoDuration.reportValidity())return;
  const seconds=videoDuration.valueAsNumber;
  const holdMs=400;
  cancelAnimationFrame(frame);
  running = false;
  let stream, recorder, hold, still;
  const chunks = [];
  const videoCanvas = document.createElement('canvas');
  function finish(message) {
    clearTimeout(hold);
    clearInterval(still);
    cancelAnimationFrame(frame);
    recordFrame = null;
    stream?.getTracks().forEach(track=>track.stop());
    videoCanvas.width = videoCanvas.height = 1;
    running = exporting = false;
    download.textContent='Скачать '+(mime?.includes('mp4')?'MP4':'WebM')+' · '+videoSize().join(' × ');
    status.textContent = message;
    controls();
  }
  try {
    prepare();
    const fps = compact.matches ? 24 : 30;
    [videoCanvas.width,videoCanvas.height] = videoSize();
    const videoContext = videoCanvas.getContext('2d',{alpha:false});
    const [contentWidth,contentHeight]=videoContentSize();
    const left=Math.floor((videoCanvas.width-contentWidth)/2);
    const top=Math.floor((videoCanvas.height-contentHeight)/2);
    videoContext.fillStyle=paper;
    videoContext.fillRect(0,0,videoCanvas.width,videoCanvas.height);
    const copyFrame=()=>videoContext.drawImage(canvas,left,top,contentWidth,contentHeight);
    let lastFrame = -Infinity;
    recordFrame = now=>{
      if (now-lastFrame < 1000/fps-1) return;
      lastFrame = now;
      copyFrame();
    };
    copyFrame();
    stream = videoCanvas.captureStream(fps);
    const videoBitsPerSecond = compact.matches ? 1800000 : 4200000;
    recorder = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond});
    recorder.ondataavailable = event=>{ if (event.data.size) chunks.push(event.data); };
    recorder.onerror = ()=>finish('Не удалось записать видео.');
    recorder.onstop = ()=>{
      if (!exporting) return;
      const type = recorder.mimeType || mime;
      const blob = new Blob(chunks,{type});
      if (!blob.size) {
        finish('Не удалось записать видео.');
        return;
      }
      save(blob,photoName+'-speedpaint.'+(type.includes('mp4')?'mp4':'webm'));
      finish('Видео готово. Проверьте загрузки браузера.');
    };
    recorder.start(1000);
    const rate = duration/(seconds*1000-holdMs);
    exporting = true;
    status.textContent = 'Записываю видео с начала. Оставьте вкладку открытой.';
    play(()=>rate,()=>{
      // Keep feeding a cursor-free canvas while the encoder drains its last frames.
      const [track]=stream.getVideoTracks();
      const showFinal=()=>{
        copyFrame();
        track.requestFrame?.();
      };
      showFinal();
      still=setInterval(showFinal,1000/fps);
      hold=setTimeout(()=>recorder.stop(),holdMs);
    });
  } catch {
    finish('Запись видео недоступна в этом браузере.');
  }
});
if (!mime) download.title = 'Браузер не поддерживает запись видео с холста.';
controls();
