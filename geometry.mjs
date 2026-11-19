import {smoothMask} from './paint.mjs?v=ribbon';

function axis(cells,width) {
  const skeleton=new Set(cells);
  const offsets=[-width,1-width,1,width+1,width,width-1,-1,-width-1];
  let changed=true;
  while (changed) {
    changed=false;
    for (let pass=0;pass<2;pass++) {
      const remove=[];
      for (const i of skeleton) {
        const n=offsets.map(delta=>Number(skeleton.has(i+delta)));
        const neighbors=n.reduce((sum,value)=>sum+value,0);
        if (neighbors<2 || neighbors>6) continue;
        if (n.filter((value,j)=>!value && n[(j+1)%8]).length!==1) continue;
        if (pass ? n[0]*n[2]*n[6] || n[0]*n[4]*n[6] : n[0]*n[2]*n[4] || n[2]*n[4]*n[6]) continue;
        remove.push(i);
      }
      for (const i of remove) skeleton.delete(i);
      changed ||= remove.length>0;
    }
  }
  function walk(start) {
    const queue=[start], previous=new Map([[start,null]]);
    for (const i of queue) for (const delta of offsets) {
      const next=i+delta;
      if (skeleton.has(next) && !previous.has(next)) {
        previous.set(next,i);
        queue.push(next);
      }
    }
    return {last:queue.at(-1),previous};
  }
  const start=skeleton.values().next().value;
  const {last,previous}=walk(walk(start).last);
  const path=[];
  for (let i=last;i!=null;i=previous.get(i)) path.push(i);
  return path;
}

export function whiteRibbons({width,height,data}, {requireTurquoise=true}={}) {
  const white=new Uint8Array(width*height);
  for (let y=1;y<height-1;y++) for (let x=1;x<width-1;x++) {
    const i=y*width+x, p=i*4;
    white[i]=Number(Math.min(data[p],data[p+1],data[p+2])>205);
  }
  const marks=[];
  for (let seed=0;seed<white.length;seed++) {
    if (!white[seed]) continue;
    const cells=[seed];
    white[seed]=0;
    for (const i of cells) for (const next of [i-1,i+1,i-width,i+width]) {
      if (white[next]) {
        white[next]=0;
        cells.push(next);
      }
    }
    if (cells.length<8 || requireTurquoise && cells.length>Math.min(2500,width*height*.12)) continue;
    const region=new Set(cells);
    let boundary=0,turquoise=0;
    for (const i of cells) for (const next of [i-1,i+1,i-width,i+width]) {
      if (region.has(next)) continue;
      boundary++;
      const p=next*4;
      if (data[p+1]-data[p]>19 && data[p+2]-data[p]>15) turquoise++;
    }
    if (requireTurquoise && turquoise<boundary*.43) continue;
    const path=axis(cells,width);
    if (!path.length) continue;
    const points=path.map(i=>[i%width+.5,Math.floor(i/width)+.5]);
    const radii=path.map(i=>{
      for (let r=1;r<12;r++) {
        for (let k=-r;k<=r;k++) {
          if (!region.has(i-r*width+k) || !region.has(i+r*width+k) ||
              !region.has(i+k*width-r) || !region.has(i+k*width+r)) return r+.4;
        }
      }
      return 12;
    });
    const channels=[0,1,2].map(channel=>{
      const values=cells.map(i=>data[i*4+channel]).sort((a,b)=>a-b);
      return values[Math.floor(values.length/2)];
    });
    marks.push({ribbon:true,clip:smoothMask(cells,width,1,.22),points,radii,
      color:'rgb('+channels.join(',')+')',width:2,opacity:1,pace:1.4});
  }
  return marks;
}
export function ribbonGround(source, ribbon) {
  const {width,height,data}=source;
  const x=Math.max(1,Math.floor(Math.min(...ribbon.points.map(point=>point[0])))-18);
  const y=Math.max(1,Math.floor(Math.min(...ribbon.points.map(point=>point[1])))-18);
  const right=Math.min(width-1,Math.ceil(Math.max(...ribbon.points.map(point=>point[0])))+18);
  const bottom=Math.min(height-1,Math.ceil(Math.max(...ribbon.points.map(point=>point[1])))+18);
  const w=right-x,h=bottom-y;
  const cells=[],samples=[];
  for (let py=y;py<bottom;py++) for (let px=x;px<right;px++) {
    const i=(py*width+px)*4;
    const [r,g,b]=data.subarray(i,i+3);
    if (g-r<=19 || b-r<=15 || g<102) continue;
    cells.push(py*width+px);
    samples.push([px-x+.5,py-y+.5,r,g,b]);
  }
  if (samples.length<w*h*.28) return null;
  const sum=samples.reduce((total,row)=>total.map((value,i)=>value+row[i]),[0,0,0,0,0]);
  const mean=sum.map(value=>value/samples.length);
  let xx=0,yy=0,xy=0;
  const xc=[0,0,0],yc=[0,0,0];
  for (const row of samples) {
    const dx=row[0]-mean[0],dy=row[1]-mean[1];
    xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;
    for (let k=0;k<3;k++) {
      xc[k]+=dx*(row[k+2]-mean[k+2]);
      yc[k]+=dy*(row[k+2]-mean[k+2]);
    }
  }
  const determinant=xx*yy-xy*xy;
  if (determinant<=0) return null;
  const planes=xc.map((value,k)=>{
    const dx=(value*yy-yc[k]*xy)/determinant;
    const dy=(yc[k]*xx-value*xy)/determinant;
    return [mean[k+2]-dx*mean[0]-dy*mean[1],dx,dy];
  });
  return {ground:{x,y,w,h,planes},clip:smoothMask(cells,width,1,.22),
    points:[[x,y+h/2],[right,y+h/2]],color:ribbon.color,width:h,opacity:1};
}
