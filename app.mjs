import {paper,plan,stroke,measure} from './paint.mjs?v=streaks';
import {finishPlan} from './finish.mjs?v=streaks';
import {restorePlan} from './restore.mjs?v=streaks';

const $ = id => document.getElementById(id);
const {canvas,file,surface,drop,source,filename,dimensions,progress,speed,brush,detail,start,reset,status,
  replace,choose,playback,downloads,clock} =
  Object.fromEntries('canvas file surface drop source filename dimensions progress speed brush detail start reset status replace choose playback downloads clock'.split(' ').map(id=>[id,$(id)]));
const download = $('export');
const savePng = $('save-png');
const demo = $('demo');
const demoVideos = [...demo.querySelectorAll('video')];
const pausedDemos = new Set();
let demoVisible=false;
const demoFold = $('demo-fold');
const chooseUpload = $('choose-upload');
const upload = $('upload');
const exact = $('exact');
const editor = $('editor');
const uploadStatus = $('upload-status');
const phases = [...document.querySelectorAll('ol li')];
const ctx = canvas.getContext('2d');
const reference = document.createElement('canvas');
const painted = document.createElement('canvas');
const ink = painted.getContext('2d',{alpha:false});
const restoreAt = .70;
let limits = [0, .20, .36, .72, 1];
const duration = 64000;
phases.forEach((item,i)=>item.style.setProperty('--stage',limits[i]*100+'%'));
const formats = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
const mime = typeof MediaRecorder !== 'undefined' && canvas.captureStream &&
  formats.find(type=>MediaRecorder.isTypeSupported(type));
let ready = false, loading = false, running = false, exporting = false;
let time = 0, frame = 0, previous = 0, generation = 0;
let sequence = [], phase = 0, index = 0, photoName = 'speedpaint';
let original, restoration, focus;

function controls() {
  const busy = loading || exporting;
  const complete = time>=duration;
  start.disabled = !ready || busy;
  reset.disabled = !ready || busy;
  download.disabled = !ready || busy || !mime || !complete;
  savePng.disabled = !ready || busy || !complete;
  downloads.hidden = !complete && !exporting;
  file.disabled = replace.disabled = choose.disabled = chooseUpload.disabled = busy;
  exact.disabled = busy || running || (time>0 && !complete);
  canvas.classList.toggle('can-pick',ready && !busy && !running && time===0);
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
function showFocus() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(original,0,0);
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
    choose.hidden = upload.hidden = true;
    document.body.classList.add('has-photo');
    document.querySelector('main').append(demo);
    for (const video of demoVideos) video.pause();
    dimensions.textContent = canvas.width+' × '+canvas.height+' px';
    ready = true;
    focus = null;
    wipe();
    showFocus();
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
chooseUpload.addEventListener('click',()=>file.click());
replace.addEventListener('click',()=>file.click());
canvas.addEventListener('click',event=>{
  if (!canvas.classList.contains('can-pick')) return;
  const box=canvas.getBoundingClientRect();
  const scale=Math.min(box.width/canvas.width,box.height/canvas.height);
  const x=(event.clientX-box.left-(box.width-canvas.width*scale)/2)/(canvas.width*scale);
  const y=(event.clientY-box.top-(box.height-canvas.height*scale)/2)/(canvas.height*scale);
  if(x<0 || x>1 || y<0 || y>1) return;
  focus=[x,y];
  showFocus();
  status.textContent='Точка старта выбрана. Нажмите «Старт».';
});
exact.addEventListener('change',()=>{if(time) reset.click();});
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
    else pausedDemos.delete(video);
    updateDemoPlayback();
  });
}
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
if (reduceMotion.matches) for (const video of demoVideos) pausedDemos.add(video);
function updateDemoPlayback() {
  const visible=demoVisible && !demo.classList.contains('is-collapsed') && !document.hidden;
  for(const video of demoVideos) {
    if(visible && !pausedDemos.has(video)) video.play().catch(()=>{});
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
    const begin=end+Math.min(20,Math.sqrt(gap)*.83);
    end=begin+(5+Math.sqrt(length)*(stage===0?3:1))*(mark.pace || 1);
    tail=mark.points.at(-1);
    return {begin,end};
  });
  return {marks,timing,end,tail};
}
function prepare() {
  sequence=[];
  limits=exact.checked ? [0,.20,.36,.62,restoreAt] : [0,.20,.36,.72,1];
  for (const [stage,marks] of plan(reference,+brush.value,+detail.value,focus).entries()) {
    sequence.push(schedule(marks,stage,sequence.at(-1)?.tail));
  }
  wipe();
}
function render(fraction) {
  if (restoration) {
    restoration(Math.min(1,(fraction-restoreAt)/(1-restoreAt)));
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
  const stopAt=limits[phase+1];
  const value = end*(Math.min(fraction,stopAt)-limits[phase])/(stopAt-limits[phase]);
  while (index<marks.length && (timing[index].end<=value+1e-7 || fraction>=stopAt)) stroke(ink,marks[index++]);
  ctx.drawImage(painted,0,0);
  if (exact.checked && fraction>=restoreAt) {
    const [x,y]=sequence[phase].tail || [reference.width*.5,reference.height*.5];
    restoration=restorePlan(ctx,original,[x*canvas.width/reference.width,y*canvas.height/reference.height]);
    restoration(Math.min(1,(fraction-restoreAt)/(1-restoreAt)));
    updateProgress(fraction);
    return;
  }
  const scaleX=canvas.width/reference.width, scaleY=canvas.height/reference.height;
  if (index<marks.length) {
    const {begin,end: stop} = timing[index];
    const t = Math.max(0,(value-begin)/(stop-begin));
    const eased = t*t*t*(10+t*(-15+6*t));
    if (eased>0) {
      ctx.save();
      ctx.scale(scaleX,scaleY);
      stroke(ctx,marks[index],eased);
      ctx.restore();
    }
  }
  phases.forEach((item,i)=>item.classList.toggle('active',i===Math.min(2,phase)));
  updateProgress(fraction);
}

// At normal speed, even a late frame must show the brush in contact before a stroke is completed.
function keepContactVisible(next,rate) {
  const stage=sequence[phase];
  const mark=stage?.timing[index];
  if (rate>1 || restoration || !mark) return next;
  const start=limits[phase]*duration;
  const span=(limits[phase+1]-limits[phase])*duration/stage.end;
  const contact=start+(mark.begin+(mark.end-mark.begin)*.5)*span;
  const end=start+mark.end*span;
  if(time<contact && next>contact) return contact;
  if(time<end && next>end) return end;
  return next;
}

function play(rate, done) {
  previous = 0;
  running = true;
  controls();
  function tick(now) {
    if (previous) {
      const speed=rate();
      time=keepContactVisible(Math.min(duration,time+Math.min(67,now-previous)*speed),speed);
    }
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
  showFocus();
  status.textContent = 'Можно выбрать точку старта или начать рисунок.';
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
    stream = canvas.captureStream(60);
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
