import {paper,plan,stroke,measure,position} from './paint.mjs?v=native-details';
import {finishPlan} from './finish.mjs?v=native-details';
import {restorePlan} from './restore.mjs';

const $ = id => document.getElementById(id);
const {canvas,file,surface,drop,source,filename,dimensions,progress,speed,brush,detail,start,reset,status,
  replace,choose,playback,downloads,clock} =
  Object.fromEntries('canvas file surface drop source filename dimensions progress speed brush detail start reset status replace choose playback downloads clock'.split(' ').map(id=>[id,$(id)]));
const download = $('export');
const savePng = $('save-png');
const demo = $('demo');
const demoVideo = $('demo-video');
const demoVideos = [...demo.querySelectorAll('video')];
const demoToggle = $('demo-toggle');
const demoFold = $('demo-fold');
const uploadLink = $('upload-link');
const editor = $('editor');
const uploadStatus = $('upload-status');
const phases = [...document.querySelectorAll('ol li')];
const ctx = canvas.getContext('2d');
const reference = document.createElement('canvas');
const painted = document.createElement('canvas');
const ink = painted.getContext('2d',{alpha:false});
const restoreAt = .70;
const limits = [0, .12, .28, .61, restoreAt];
const duration = 64000;
phases.forEach((item,i)=>item.style.setProperty('--stage',limits[i]*100+'%'));
const formats = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
const mime = typeof MediaRecorder !== 'undefined' && canvas.captureStream &&
  formats.find(type=>MediaRecorder.isTypeSupported(type));
let ready = false, loading = false, running = false, exporting = false;
let time = 0, frame = 0, previous = 0, generation = 0;
let sequence = [], phase = 0, index = 0, photoName = 'speedpaint';
let original, restoration;

function controls() {
  const busy = loading || exporting;
  const complete = time>=duration;
  start.disabled = !ready || busy;
  reset.disabled = !ready || busy;
  download.disabled = !ready || busy || !mime || !complete;
  savePng.disabled = !ready || busy || !complete;
  downloads.hidden = !complete && !exporting;
  file.disabled = replace.disabled = choose.disabled = busy;
  brush.disabled = detail.disabled = exporting || running || time>0;
  speed.disabled = exporting;
  start.textContent = running && !exporting ? 'Пауза' : complete ? 'Заново' : time>0 ? 'Продолжить' : 'Старт';
  start.classList.toggle('primary',!complete && !exporting);
}
function updateProgress(fraction) {
  const format=ms=>{
    const seconds=Math.floor(ms/1000);
    return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  };
  progress.value=fraction;
  clock.textContent=format(time)+' / '+format(duration);
}
function wipe() {
  time = phase = index = 0;
  restoration = null;
  updateProgress(0);
  for (const item of phases) item.classList.remove('active');
  ink.fillStyle = paper;
  ink.fillRect(0,0,reference.width,reference.height);
  ctx.drawImage(painted,0,0);
}
function nib(point,opacity=1) {
  if (!point) return;
  ctx.globalAlpha=opacity;
  ctx.beginPath();
  ctx.arc(...point,Math.max(2,Math.min(8,Math.max(canvas.width,canvas.height)/240)),0,Math.PI*2);
  ctx.lineWidth=1.5;
  ctx.strokeStyle='#f9f3ed';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(...point,1.35,0,Math.PI*2);
  ctx.fillStyle='#383039';
  ctx.fill();
  ctx.globalAlpha=1;
}
async function load(image) {
  if (!image || exporting) return;
  const ticket = ++generation;
  const url = URL.createObjectURL(image);
  cancelAnimationFrame(frame);
  running = false;
  loading = true;
  controls();
  uploadStatus.textContent = status.textContent = 'Открываю изображение…';
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    if (ticket!==generation) return;
    const ratio = Math.min(1, 1280/Math.max(picture.naturalWidth,picture.naturalHeight));
    canvas.width = painted.width = picture.naturalWidth;
    canvas.height = painted.height = picture.naturalHeight;
    ctx.imageSmoothingQuality = 'high';
    reference.width = Math.max(1,Math.round(canvas.width*ratio));
    reference.height = Math.max(1,Math.round(canvas.height*ratio));
    ink.setTransform(canvas.width/reference.width,0,0,canvas.height/reference.height,0,0);
    const ref = reference.getContext('2d');
    ref.fillStyle = paper;
    ref.fillRect(0,0,reference.width,reference.height);
    ref.drawImage(picture,0,0,reference.width,reference.height);
    original=picture;
    filename.textContent = image.name;
    photoName = image.name.replace(/\.[^.]+$/, '') || 'speedpaint';
    source.hidden = canvas.hidden = replace.hidden = playback.hidden = false;
    editor.hidden = false;
    uploadLink.hidden = true;
    document.body.classList.add('has-photo');
    dimensions.textContent = canvas.width+' × '+canvas.height+' px';
    ready = true;
    wipe();
    status.textContent = 'Фото готово. Нажмите «Старт».';
    uploadStatus.textContent = 'Фото загружено. Редактор ниже.';
    editor.scrollIntoView({block:'start'});
  } catch {
    if (ticket===generation) uploadStatus.textContent = status.textContent = 'Не удалось открыть фото. Выберите JPG, PNG или WEBP.';
  } finally {
    URL.revokeObjectURL(url);
    if (ticket===generation) {
      loading = false;
      file.value = '';
      controls();
    }
  }
}
file.addEventListener('change',()=>load(file.files[0]));
choose.addEventListener('click',()=>file.click());
replace.addEventListener('click',()=>file.click());
function syncDemoButton() {
  demoToggle.textContent=demoVideo.paused?'▶':'Ⅱ';
  demoToggle.setAttribute('aria-label',demoVideo.paused?'Воспроизвести пример':'Приостановить пример');
}
demoVideo.addEventListener('play',syncDemoButton);
demoVideo.addEventListener('pause',syncDemoButton);
let demoVisible=false;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let demoWantsPlayback=!reduceMotion.matches && !navigator.connection?.saveData;
let scrollFrame=0;
// Match the pinned showcase transition used on EdiTool.
function paintShowcase() {
  scrollFrame=0;
  if (demo.hidden || demoVideo.hidden) return;
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
function updateDemoPlayback() {
  if (demoWantsPlayback && demoVisible && !demoVideo.hidden && !demo.hidden) {
    for(const video of demoVideos) video.play().catch(syncDemoButton);
  } else {
    for(const video of demoVideos) video.pause();
  }
}
demoToggle.addEventListener('click',()=>{
  demoWantsPlayback=demoVideo.paused;
  updateDemoPlayback();
});
demoFold.addEventListener('click',()=>{
  const collapsed=demo.classList.toggle('is-collapsed');
  demoVideo.hidden=demoToggle.hidden=collapsed;
  demoFold.setAttribute('aria-expanded',String(!collapsed));
  demoFold.textContent=collapsed?'Развернуть видео':'Свернуть видео';
  updateDemoPlayback();
  scheduleShowcase();
});
new IntersectionObserver(([entry])=>{
  demoVisible=entry.isIntersecting;
  updateDemoPlayback();
}).observe(demo);
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
for (const slider of [speed,brush,detail]) {
  slider.addEventListener('input',()=>{
    const output = document.querySelector('output[for='+slider.id+']');
    output.value = slider===speed ? slider.value.replace('.',',')+'×' : slider.value+'%';
  });
}
function schedule(marks,stage,tail) {
  let end = 0;
  const timing = marks.map(mark=>{
    const length=measure(mark);
    const from=tail;
    const gap=from?Math.hypot(mark.points[0][0]-from[0],mark.points[0][1]-from[1]):0;
    const depart=end;
    const begin=end+Math.min(20,Math.sqrt(gap)*.83);
    end=begin+(5+Math.sqrt(length)*(stage===0?3:1))*(mark.pace || 1);
    tail=mark.points.at(-1);
    return {begin,end,depart,from,gap};
  });
  return {marks,timing,end,tail};
}
function prepare() {
  sequence=[];
  for (const [stage,marks] of plan(reference,+brush.value,+detail.value).entries()) {
    sequence.push(schedule(marks,stage,sequence.at(-1)?.tail));
  }
  wipe();
}
function render(fraction) {
  if (restoration) {
    nib(restoration(Math.min(1,(fraction-restoreAt)/(1-restoreAt))));
    updateProgress(fraction);
    return;
  }
  while (phase<3 && fraction>=limits[phase+1]) {
    const {marks} = sequence[phase];
    while (index<marks.length) stroke(ink,marks[index++]);
    phase++;
    index = 0;
    if (phase===3) sequence.push(schedule(finishPlan(ink,reference,+detail.value),phase,sequence[2].tail));
  }
  const {marks,timing,end} = sequence[phase];
  const value = end*(Math.min(fraction,restoreAt)-limits[phase])/(limits[phase+1]-limits[phase]);
  while (index<marks.length && (timing[index].end<=value || fraction>=restoreAt)) stroke(ink,marks[index++]);
  ctx.drawImage(painted,0,0);
  if (fraction>=restoreAt) {
    const [x,y]=sequence[phase].tail || [reference.width*.5,reference.height*.5];
    restoration=restorePlan(ctx,original,[x*canvas.width/reference.width,y*canvas.height/reference.height]);
    nib(restoration(Math.min(1,(fraction-restoreAt)/(1-restoreAt))));
    updateProgress(fraction);
    return;
  }
  const scaleX=canvas.width/reference.width, scaleY=canvas.height/reference.height;
  if (index<marks.length) {
    const {begin,end: stop,depart,from,gap} = timing[index];
    const t = Math.max(0,(value-begin)/(stop-begin));
    const eased = t*t*t*(10+t*(-15+6*t));
    const points=marks[index].points;
    const along=position(marks[index],eased);
    const a=points[Math.floor(along)], b=points[Math.ceil(along)];
    const u=along-Math.floor(along);
    const tip=[(a[0]+(b[0]-a[0])*u)*scaleX,(a[1]+(b[1]-a[1])*u)*scaleY];
    let opacity=1;
    if (eased>0) {
      ctx.save();
      ctx.scale(scaleX,scaleY);
      stroke(ctx,marks[index],eased,phase<2?1:Math.min(1,t*3)**1.4);
      ctx.restore();
    } else if (value<begin && from && begin>depart) {
      const t=(value-depart)/(begin-depart);
      const lift=t*t*(3-2*t);
      tip[0]=from[0]*scaleX+(tip[0]-from[0]*scaleX)*lift;
      tip[1]=from[1]*scaleY+(tip[1]-from[1]*scaleY)*lift;
      if (gap>Math.max(reference.width,reference.height)*.14) opacity=1-.7*Math.sin(Math.PI*t);
    }
    nib(tip,opacity);
  }
  phases.forEach((item,i)=>item.classList.toggle('active',i===Math.min(2,phase)));
  updateProgress(fraction);
}

function play(rate, done) {
  previous = 0;
  running = true;
  controls();
  function tick(now) {
    if (previous) time = Math.min(duration,time+Math.min(67,now-previous)*rate());
    previous = now;
    render(time/duration);
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
start.addEventListener('click',()=>{
  if (running) {
    cancelAnimationFrame(frame);
    running = false;
    status.textContent = 'Пауза.';
    controls();
    return;
  }
  if (!time || time>=duration) prepare();
  status.textContent = 'Рисую…';
  play(()=>+speed.value);
});
reset.addEventListener('click',()=>{
  cancelAnimationFrame(frame);
  running = false;
  wipe();
  status.textContent = 'Холст очищен.';
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
  cancelAnimationFrame(frame);
  running = false;
  let stream, recorder, hold, still;
  const chunks = [];
  function finish(message) {
    clearTimeout(hold);
    clearInterval(still);
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track=>track.stop());
    running = exporting = false;
    status.textContent = message;
    controls();
  }
  try {
    prepare();
    stream = canvas.captureStream(30);
    const videoBitsPerSecond = Math.max(5000000,Math.min(80000000,Math.round(canvas.width*canvas.height*10)));
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
    recorder.start();
    const rate = +speed.value;
    exporting = true;
    status.textContent = 'Записываю видео с начала. Оставьте вкладку открытой.';
    play(()=>rate,()=>{
      // Keep feeding a cursor-free canvas while the encoder drains its last frames.
      const [track]=stream.getVideoTracks();
      const showFinal=()=>{
        ctx.save();
        ctx.globalCompositeOperation='copy';
        ctx.drawImage(canvas,0,0);
        ctx.restore();
        track.requestFrame?.();
      };
      showFinal();
      still=setInterval(showFinal,1000/30);
      hold=setTimeout(()=>recorder.stop(),700);
    });
  } catch {
    finish('Запись видео недоступна в этом браузере.');
  }
});
if (!mime) download.title = 'Браузер не поддерживает запись видео с холста.';
controls();
