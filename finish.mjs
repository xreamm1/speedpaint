// Use the remaining error to place accents. Each mark mixes a local pigment.
export function finishPlan(ctx, reference, detail, mode, areas, prioritizeFocus, zone, photographic) {
  const {regions,labels,cols,step} = areas;
  const {width,height}=reference;
  let sample=ctx;
  if(ctx.canvas.width!==width || ctx.canvas.height!==height) {
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    sample=canvas.getContext('2d');
    sample.imageSmoothingQuality='high';
    sample.drawImage(ctx.canvas,0,0,width,height);
  }
  const actual=sample.getImageData(0,0,width,height).data;
  const source=reference.getContext('2d').getImageData(0,0,width,height).data;
  const at=(x,y)=>4*(Math.max(0,Math.min(width-1,Math.round(x)))+
    width*Math.max(0,Math.min(height-1,Math.round(y))));
  const luma=i=>.30*source[i]+.59*source[i+1]+.11*source[i+2];
  const stride=Math.max(4,Math.round(Math.max(width,height)/(zone && mode!=='hair' ? 155 : 63)));
  const [zx,zy,rx,ry] = zone || [0,0,1,1];
  const candidates=[];
  for(let top=0;top<height;top+=stride) {
    for(let left=0;left<width;left+=stride) {
      let pick;
      for(let y=top+1;y<Math.min(top+stride,height-1);y+=2) {
        for(let x=left+1;x<Math.min(left+stride,width-1);x+=2) {
          if (zone && ((x-zx)/rx)**2+((y-zy)/ry)**2>1) continue;
          const i=at(x,y);
          const error=(Math.abs(source[i]-actual[i])+Math.abs(source[i+1]-actual[i+1])+
            Math.abs(source[i+2]-actual[i+2]))/3;
          const nearby=[luma(at(x+2,y)),luma(at(x-2,y)),luma(at(x,y+2)),luma(at(x,y-2))];
          const light=luma(i), center=light-nearby.reduce((sum,n)=>sum+n,0)/4;
          const gx=nearby[0]-nearby[1], gy=nearby[2]-nearby[3];
          const edge=Math.hypot(gx,gy);
          const dot=Math.abs(center)>26 && edge<Math.abs(center)*1.8;
          const highlight=light>190 && light>(.30*actual[i]+.59*actual[i+1]+.11*actual[i+2])+14;
          const actualLight=.30*actual[i]+.59*actual[i+1]+.11*actual[i+2];
          if (mode==='edge' && (edge<16 || light>=actualLight)) continue;
          if (mode==='shadow' && (dot || edge>=32 || light>=actualLight || error<13)) continue;
          if ((mode==='light' || mode==='hair') && (dot || light<=actualLight)) continue;
          if (mode==='texture' && !dot && !highlight) continue;
          const score=error*Math.min(1,Math.max(mode==='shadow'?.65:0,Math.max(edge,Math.abs(center))/38))*(highlight?1.35:1);
          if(score>13 && (!pick || score>pick.score)) pick={x,y,gx,gy,score,dot,highlight,broad:mode==='shadow'};
        }
      }
      if(pick) candidates.push(pick);
    }
  }
  for (const pick of candidates) {
    pick.area=labels[Math.floor(pick.y/step)*cols+Math.floor(pick.x/step)];
    if (photographic && !zone && regions[pick.area-1]?.background) pick.score*=.75;
  }
  candidates.sort((a,b)=>(prioritizeFocus ? Number(b.area===1)-Number(a.area===1) : 0) || b.score-a.score);
  const marks=[];
  const cap=64+Math.round(detail*1.15);
  const centerOf=({points})=>points[Math.floor(points.length/2)];
  for(const {x,y,gx,gy,score,dot,highlight,broad,area} of candidates) {
    if(marks.length>=cap) break;
    if(marks.some(mark=>{const [px,py]=centerOf(mark);return Math.hypot(px-x,py-y)<stride*.75;})) continue;
    const angle=broad ? -.55+.35*Math.sin(x*.039+y*.026) : Math.atan2(gy,gx)+Math.PI/2;
    const length=stride*(mode==='hair'?1.85:broad?1.10:dot?.30:.24+(highlight?.62:.34)*Math.abs(Math.sin(x*4.7+y*8.6)));
    const dx=Math.cos(angle)*length, dy=Math.sin(angle)*length;
    const normal=Math.max(1,Math.hypot(gx,gy));
    const shift=dot?0:highlight?.8:-1;
    const cx=x+gx/normal*shift, cy=y+gy/normal*shift;
    const channels=[0,0,0];
    const sampleCount=dot?0:2;
    for(let j=-sampleCount;j<=sampleCount;j++) {
      const p=at(cx+Math.cos(angle)*j,cy+Math.sin(angle)*j);
      for(let k=0;k<3;k++) channels[k]+=source[p+k];
    }
    let points=[[x-dx,y-dy],[x,y],[x+dx-dy*.20,y+dy+dx*.20]];
    if (mode==='hair') {
      function follow(direction) {
        let px=x, py=y, heading=angle+(direction<0 ? Math.PI : 0);
        const trail=[];
        for (let i=0;i<5;i++) {
          const sx=luma(at(px+2,py))-luma(at(px-2,py));
          const sy=luma(at(px,py+2))-luma(at(px,py-2));
          if (Math.hypot(sx,sy)>9) {
            const turn=Math.atan2(sy,sx)+Math.PI/2-heading;
            heading+=.27*Math.atan2(Math.sin(2*turn),Math.cos(2*turn));
          }
          px+=Math.cos(heading)*length/5;
          py+=Math.sin(heading)*length/5;
          if (px<0 || py<0 || px>=width || py>=height) break;
          trail.push([px,py]);
        }
        return trail;
      }
      points=[...follow(-1).reverse(),[x,y],...follow(1)];
      if (points.length<2) continue;
    }
    marks.push({area,zone,clip:regions[area-1]?.clip,points,
      color:'rgb('+channels.map(c=>Math.round(c/(2*sampleCount+1))).join(',')+')',
      width:Math.max(.72,stride*(broad?.52:dot?.09:.18)),opacity:Math.min(highlight?.86:.70,.36+score/225),pressure:.52});
  }
  const ordered=[];
  let tip=marks[0]?.points[0];
  while(marks.length) {
    let nearest=0, best=Infinity, reverse=false;
    for(let i=0;i<marks.length;i++) {
      const {points}=marks[i];
      const start=Math.hypot(points[0][0]-tip[0],points[0][1]-tip[1]);
      const [endX,endY]=points.at(-1);
      const end=Math.hypot(endX-tip[0],endY-tip[1]);
      if(Math.min(start,end)<best) { nearest=i;best=Math.min(start,end);reverse=end<start; }
    }
    const [mark]=marks.splice(nearest,1);
    if(reverse) mark.points.reverse();
    mark.lift=best;
    ordered.push(mark);
    tip=mark.points.at(-1);
  }
  const layers=[];
  for(let i=0;i<ordered.length;i+=8) {
    const area=ordered.slice(i,i+8);
    layers.push(...area.map(mark=>({...mark,opacity:mark.opacity*.40,width:mark.width*1.12})));
    layers.push(...area.map(mark=>({...mark,opacity:mark.opacity*.60/(1-mark.opacity*.40)})));
  }
  return layers;
}
