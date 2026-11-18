import {paper,plan,stroke} from './paint.mjs';

const $ = id => document.getElementById(id);
const {canvas,file,surface,drop,source,filename,dimensions,progress,speed,brush,detail,start,pause,reset,status} =
  Object.fromEntries('canvas file surface drop source filename dimensions progress speed brush detail start pause reset status'.split(' ').map(id=>[id,$(id)]));
const download = $('export');
const phases = [...document.querySelectorAll('ol li')];
const ctx = canvas.getContext('2d',{alpha:false});
const reference = document.createElement('canvas');
const painted = document.createElement('canvas');
const ink = painted.getContext('2d',{alpha:false});
const limits = [0, .34, .62, 1];
const duration = 24000;
const formats = ['video/webm;codecs=vp8','video/webm','video/mp4'];
const mime = typeof MediaRecorder !== 'undefined' && canvas.captureStream &&
  formats.find(type=>MediaRecorder.isTypeSupported(type));
let ready = false, loading = false, running = false, exporting = false;
let time = 0, frame = 0, previous = 0, generation = 0;
let sequence = [], phase = 0, index = 0, photoName = 'speedpaint';

function controls() {
  const busy = loading || exporting;
  start.disabled = !ready || busy || running;
  pause.disabled = !running || exporting;
  reset.disabled = !ready || busy;
  download.disabled = !ready || busy || !mime;
  file.disabled = busy;
  brush.disabled = detail.disabled = exporting || running || time>0;
  speed.disabled = exporting;
  start.textContent = time>=duration ? 'Заново' : time>0 ? 'Продолжить' : 'Старт';
}
function wipe() {
  time = phase = index = 0;
  progress.value = 0;
  for (const item of phases) item.classList.remove('active');
  ink.fillStyle = paper;
  ink.fillRect(0,0,painted.width,painted.height);
  ctx.drawImage(painted,0,0);
}
async function load(image) {
  if (!image || exporting) return;
  const ticket = ++generation;
  const url = URL.createObjectURL(image);
  cancelAnimationFrame(frame);
  running = false;
  loading = true;
  controls();
  status.textContent = 'Открываю изображение…';
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    if (ticket!==generation) return;
    const ratio = Math.min(1, 960/Math.max(picture.naturalWidth,picture.naturalHeight));
    canvas.width = painted.width = reference.width = Math.max(1,Math.round(picture.naturalWidth*ratio));
    canvas.height = painted.height = reference.height = Math.max(1,Math.round(picture.naturalHeight*ratio));
    const ref = reference.getContext('2d');
    ref.fillStyle = paper;
    ref.fillRect(0,0,reference.width,reference.height);
    ref.drawImage(picture,0,0,reference.width,reference.height);
    filename.textContent = image.name;
    photoName = image.name.replace(/\.[^.]+$/, '') || 'speedpaint';
    source.hidden = canvas.hidden = false;
    drop.hidden = true;
    dimensions.textContent = canvas.width+' × '+canvas.height+' px';
    ready = true;
    wipe();
    status.textContent = 'Фото готово. Нажмите «Старт».';
  } catch {
    if (ticket===generation) status.textContent = 'Не удалось открыть фото. Выберите JPG, PNG или WEBP.';
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
surface.addEventListener('dragover',event=>{
  event.preventDefault();
  if (!exporting) surface.classList.add('over');
});
surface.addEventListener('dragleave',()=>surface.classList.remove('over'));
surface.addEventListener('drop',event=>{
  event.preventDefault();
  surface.classList.remove('over');
  load(event.dataTransfer.files[0]);
});
for (const slider of [speed,brush,detail]) {
  slider.addEventListener('input',()=>{
    const output = document.querySelector('output[for='+slider.id+']');
    output.value = slider===speed ? slider.value.replace('.',',')+'×' : slider.value+'%';
  });
}
function prepare() {
  sequence = plan(reference,+brush.value,+detail.value).map((marks,stage)=>{
    let end = 0;
    const timing = marks.map(mark=>{
      let length = 0;
      for (let i=1; i<mark.points.length; i++) {
        length += Math.hypot(mark.points[i][0]-mark.points[i-1][0],mark.points[i][1]-mark.points[i-1][1]);
      }
      const lift = stage===0 ? Math.min(15,Math.sqrt(mark.lift || 0)*.85) : 0;
      const begin = end+lift;
      end = begin+(5+Math.sqrt(length)*(stage===0?3:1))*(mark.pace || 1);
      return {begin,end};
    });
    return {marks,timing,end};
  });
  wipe();
}
function render(fraction) {
  while (phase<2 && fraction>=limits[phase+1]) {
    const {marks} = sequence[phase];
    while (index<marks.length) stroke(ink,marks[index++]);
    phase++;
    index = 0;
  }
  const {marks,timing,end} = sequence[phase];
  const value = end*(fraction-limits[phase])/(limits[phase+1]-limits[phase]);
  while (index<marks.length && (timing[index].end<=value || fraction===1)) stroke(ink,marks[index++]);
  ctx.drawImage(painted,0,0);
  if (index<marks.length) {
    const {begin,end: stop} = timing[index];
    const t = Math.max(0,(value-begin)/(stop-begin));
    const eased = t*t*(3-2*t);
    if (eased>0) stroke(ctx,marks[index],eased);
  }
  phases.forEach((item,i)=>item.classList.toggle('active',i===phase));
  progress.value = fraction;
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
  if (!time || time>=duration) prepare();
  status.textContent = 'Рисую…';
  play(()=>+speed.value);
});
pause.addEventListener('click',()=>{
  cancelAnimationFrame(frame);
  running = false;
  status.textContent = 'Пауза.';
  controls();
});
reset.addEventListener('click',()=>{
  cancelAnimationFrame(frame);
  running = false;
  wipe();
  status.textContent = 'Холст очищен.';
  controls();
});
download.addEventListener('click',()=>{
  cancelAnimationFrame(frame);
  running = false;
  let stream, recorder, hold;
  const chunks = [];
  function finish(message) {
    clearTimeout(hold);
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track=>track.stop());
    running = exporting = false;
    status.textContent = message;
    controls();
  }
  try {
    prepare();
    stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});
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
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = photoName+'-speedpaint.'+(type.includes('mp4')?'mp4':'webm');
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      finish('Видео готово. Проверьте загрузки браузера.');
    };
    recorder.start();
    const rate = +speed.value;
    exporting = true;
    status.textContent = 'Записываю видео с начала. Оставьте вкладку открытой.';
    play(()=>rate,()=>{ hold = setTimeout(()=>recorder.stop(),550); });
  } catch {
    finish('Запись видео недоступна в этом браузере.');
  }
});
if (!mime) download.title = 'Браузер не поддерживает запись видео с холста.';
controls();
