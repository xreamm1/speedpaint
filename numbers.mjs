import {smoothMask} from './paint.mjs?v=form-strokes';

const cell=7;

function template(source){
  const scale=360/Math.max(source.width,source.height);
  const w=Math.max(1,Math.round(source.width*scale));
  const h=Math.max(1,Math.round(source.height*scale));
  const n=w*h;
  const thumb=new OffscreenCanvas(w,h).getContext('2d');
  thumb.drawImage(source,0,0,w,h);
  const pixels=thumb.getImageData(0,0,w,h).data;
  const rgb=i=>[pixels[4*i],pixels[4*i+1],pixels[4*i+2]];
  const error=(i,c)=>(pixels[4*i]-c[0])**2+(pixels[4*i+1]-c[1])**2+(pixels[4*i+2]-c[2])**2;
  const palette=[rgb(Math.floor(n/2))],nearest=new Float32Array(n).fill(Infinity);
  while(palette.length<48){
    let far=0;
    for(let i=0;i<n;i++){
      nearest[i]=Math.min(nearest[i],error(i,palette.at(-1)));
      if(nearest[i]>nearest[far])far=i;
    }
    if(nearest[far]<64)break;
    palette.push(rgb(far));
  }
  const map=new Uint8Array(n);
  for(let round=0;round<10;round++){
    const sums=palette.map(()=>[0,0,0,0]);
    for(let i=0;i<n;i++){
      let best=0;
      for(let j=1;j<palette.length;j++)if(error(i,palette[j])<error(i,palette[best]))best=j;
      map[i]=best;
      for(let k=0;k<3;k++)sums[best][k]+=pixels[4*i+k];
      sums[best][3]++;
    }
    if(round<9)for(const [i,s] of sums.entries()){
      if(s[3])palette[i]=s.slice(0,3).map(v=>Math.round(v/s[3]));
    }
  }
  const around=i=>[i>=w?i-w:-1,i<n-w?i+w:-1,i%w?i-1:-1,i%w<w-1?i+1:-1];
  function groups(visit){
    const seen=new Uint8Array(n);
    for(let i=0;i<n;i++){
      if(seen[i])continue;
      const group=[i],color=map[i];seen[i]=1;
      for(const j of group)for(const k of around(j)){
        if(k>=0&&!seen[k]&&map[k]===color){seen[k]=1;group.push(k);}
      }
      visit(group,color);
    }
  }
  for(let pass=0;pass<4;pass++){
    const components=[],owner=new Int32Array(n);
    groups((group,color)=>{
      for(const i of group)owner[i]=components.length;
      components.push({group,color});
    });
    for(const {group,color} of components){
      if(group.length>=36)continue;
      const borders=new Map();
      for(const i of group)for(const j of around(i)){
        if(j>=0&&map[j]!==color&&components[owner[j]].group.length>group.length){
          borders.set(owner[j],(borders.get(owner[j])||0)+1);
        }
      }
      let best=color,highest=0;
      for(const [id,count] of borders){
        const other=components[id].color;
        const distance=Math.hypot(...palette[other].map((value,k)=>value-palette[color][k]));
        if(group.length>=4&&distance>32)continue;
        const score=count/(1+distance/32);
        if(score>highest){highest=score;best=other;}
      }
      for(const i of group)map[i]=best;
    }
  }
  const used=[...new Set(map)].sort((a,b)=>a-b);
  for(let i=0;i<n;i++)map[i]=used.indexOf(map[i]);
  const paths=used.map(()=>new Path2D()),guide=new OffscreenCanvas(w*cell,h*cell);
  const g=guide.getContext('2d');
  const depth=new Uint16Array(n),queue=[];
  for(let i=0;i<n;i++){
    if(around(i).some(j=>j<0||map[j]!==map[i])){depth[i]=1;queue.push(i);}
  }
  for(const i of queue)for(const j of around(i)){
    if(j>=0&&!depth[j]){depth[j]=depth[i]+1;queue.push(j);}
  }
  g.strokeStyle='#758096';g.lineWidth=1.15;
  groups((group,color)=>{
    const shape=new Path2D(smoothMask(group,w,cell,.36).path);
    paths[color].addPath(shape);
    g.stroke(shape);
  });
  // The curves on opposite sides of a border are simplified independently.
  // Assign any uncovered samples back to their original colour so all passes
  // together cover the complete sheet, including its outer corners.
  const coverage=new OffscreenCanvas(w*3,h*3);
  const cover=coverage.getContext('2d');
  cover.scale(3/cell,3/cell);
  for(const path of paths)cover.fill(path,'evenodd');
  const covered=cover.getImageData(0,0,coverage.width,coverage.height).data;
  const seams=used.map(()=>new Path2D());
  const sample=cell/3;
  for(let y=0;y<coverage.height;y++)for(let x=0;x<coverage.width;x++){
    if(covered[4*(y*coverage.width+x)+3]>=245)continue;
    seams[map[Math.floor(y/3)*w+Math.floor(x/3)]].rect(x*sample,y*sample,sample,sample);
  }
  const labels=[];
  groups((group,color)=>{
    const cx=group.reduce((s,i)=>s+i%w,0)/group.length;
    const cy=group.reduce((s,i)=>s+Math.floor(i/w),0)/group.length;
    const score=i=>3*depth[i]-.1*Math.hypot(i%w-cx,Math.floor(i/w)-cy);
    const i=group.reduce((best,i)=>score(i)>score(best)?i:best);
    labels.push({x:(i%w+.5)*cell,y:(Math.floor(i/w)+.5)*cell,number:color+1});
  });
  // Keep dark, narrow marks such as eyelids and lettering as line art.
  // Resampling before detection suppresses the source's halftone dots.
  const lineScale=460/Math.max(source.width,source.height);
  const lw=Math.max(1,Math.round(source.width*lineScale));
  const lh=Math.max(1,Math.round(source.height*lineScale));
  const lineArt=new OffscreenCanvas(lw,lh);
  const lineCtx=lineArt.getContext('2d');
  lineCtx.imageSmoothingQuality='high';
  lineCtx.drawImage(source,0,0,lw,lh);
  const original=lineCtx.getImageData(0,0,lw,lh).data;
  const tone=new Float32Array(lw*lh);
  for(let i=0;i<tone.length;i++)tone[i]=.299*original[4*i]+.587*original[4*i+1]+.114*original[4*i+2];
  const strokes=lineCtx.createImageData(lw,lh);
  for(let y=3;y<lh-3;y++)for(let x=3;x<lw-3;x++){
    const i=y*lw+x,v=tone[i];
    const left=tone[i-3],right=tone[i+3],top=tone[i-3*lw],bottom=tone[i+3*lw];
    const surround=Math.max(Math.min(left,right),Math.min(top,bottom));
    const contrast=surround-v;
    if(v>98||contrast<18)continue;
    strokes.data[4*i]=39;strokes.data[4*i+1]=24;strokes.data[4*i+2]=29;
    strokes.data[4*i+3]=Math.min(220,(contrast-18)*4,(102-v)*7);
  }
  lineCtx.putImageData(strokes,0,0);
  return {guide,lineArt,labels,paths,seams,colors:used.map(i=>palette[i])};
}

export function createNumberPainting(workspace){
  const canvas=workspace.querySelector('canvas'),ctx=canvas.getContext('2d');
  const palette=workspace.querySelector('#number-palette');
  const brush=workspace.querySelector('#number-brush');
  const fullBrush=workspace.querySelector('#number-full-brush');
  function setFullBrush(active){
    fullBrush.setAttribute('aria-pressed',String(active));
  }
  fullBrush.addEventListener('click',()=>setFullBrush(fullBrush.getAttribute('aria-pressed')!=='true'));
  brush.addEventListener('input',()=>setFullBrush(false));
  const undo=workspace.querySelector('#number-undo');
  const photo=workspace.querySelector('#number-photo');
  const paint=new OffscreenCanvas(1,1),ink=paint.getContext('2d',{willReadFrequently:true});
  let sheet,sourcePhoto,showPhoto=false,selected=0,pointer=null,previous,history;
  photo.addEventListener('click',()=>{
    if(!sheet||pointer!==null)return;
    showPhoto=!showPhoto;
    photo.setAttribute('aria-pressed',String(showPhoto));
    photo.textContent=showPhoto?'Вернуться к раскраске':'Показать оригинал';
    canvas.classList.toggle('showing-photo',showPhoto);
    render();
  });
  function render(updateLabels=false){
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(showPhoto){
      ctx.drawImage(sourcePhoto,0,0,canvas.width,canvas.height);
      return;
    }
    ctx.drawImage(paint,0,0);
    if(updateLabels){
      for(const label of sheet.labels){
        label.colored=Boolean(ink.getImageData(label.x,label.y,1,1).data[3]);
      }
    }
    if(sheet.labels.some(label=>!label.colored))ctx.drawImage(sheet.guide,0,0);
    ctx.drawImage(sheet.lineArt,0,0,canvas.width,canvas.height);
    ctx.font='bold 25px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#24324b';
    for(const label of sheet.labels){
      if(!label.colored)ctx.fillText(String(label.number),label.x,label.y);
    }
  }
  function draw(event){
    const bounds=canvas.getBoundingClientRect();
    const x=(event.clientX-bounds.left)*canvas.width/bounds.width;
    const y=(event.clientY-bounds.top)*canvas.height/bounds.height;

    ink.fillStyle=ink.strokeStyle='rgb('+sheet.colors[selected].join(',')+')';
    ink.lineWidth=fullBrush.getAttribute('aria-pressed')==='true'
      ? 2*Math.hypot(canvas.width,canvas.height)
      : Number(brush.value)*cell;
    ink.lineCap='round';
    const stroke=new Path2D();
    if(previous){stroke.moveTo(...previous);stroke.lineTo(x,y);}
    else stroke.arc(x,y,ink.lineWidth/2,0,2*Math.PI);
    for(const path of [sheet.seams[selected],sheet.paths[selected]]){
      ink.save();
      ink.clip(path,'evenodd');
      if(previous)ink.stroke(stroke);else ink.fill(stroke);
      ink.restore();
    }
    previous=[x,y];render();
  }
  canvas.addEventListener('dragstart',event=>event.preventDefault());
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('pointerdown',event=>{
    if(!sheet||showPhoto||pointer!==null||event.button!==0)return;
    event.preventDefault();
    pointer=event.pointerId;previous=null;
    history=ink.getImageData(0,0,paint.width,paint.height);undo.disabled=false;
    canvas.setPointerCapture(pointer);draw(event);
  });
  canvas.addEventListener('pointermove',event=>{if(pointer===event.pointerId)draw(event);});
  for(const type of ['pointerup','pointercancel','lostpointercapture']){
    canvas.addEventListener(type,event=>{if(pointer===event.pointerId){pointer=null;render(true);}});
  }
  undo.addEventListener('click',()=>{
    if(!history||pointer!==null)return;
    ink.putImageData(history,0,0);history=null;undo.disabled=true;render(true);
  });
  return {
    get ready(){return Boolean(sheet);},
    reset(){sheet=null;history=null;pointer=null;undo.disabled=true;},
    load(source){
      sheet=template(source);sourcePhoto=source;selected=0;showPhoto=false;
      photo.setAttribute('aria-pressed','false');
      photo.textContent='Показать оригинал';
      canvas.classList.remove('showing-photo');
      canvas.width=paint.width=sheet.guide.width;canvas.height=paint.height=sheet.guide.height;
      palette.replaceChildren(...sheet.colors.map(([r,g,b],i)=>{
        const button=document.createElement('button');
        button.type='button';button.textContent=String(i+1);
        button.setAttribute('aria-label','Цвет '+(i+1));
        button.setAttribute('aria-pressed',String(i===0));
        button.style.backgroundColor='rgb('+[r,g,b].join(',')+')';
        button.style.color=r*.299+g*.587+b*.114>145?'#111':'#fff';
        button.addEventListener('click',()=>{
          palette.children[selected].setAttribute('aria-pressed','false');
          selected=i;button.setAttribute('aria-pressed','true');
        });
        return button;
      }));
      render();
    }
  };
}
