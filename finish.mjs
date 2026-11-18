// Use the remaining error to place accents. Each mark mixes a local pigment.
export function finishPlan(ctx, reference, detail) {
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
  const stride=Math.max(4,Math.round(Math.max(width,height)/63));
  const candidates=[];
  for(let top=0;top<height;top+=stride) {
    for(let left=0;left<width;left+=stride) {
      let pick;
      for(let y=top+1;y<Math.min(top+stride,height-1);y+=2) {
        for(let x=left+1;x<Math.min(left+stride,width-1);x+=2) {
          const i=at(x,y);
          const error=(Math.abs(source[i]-actual[i])+Math.abs(source[i+1]-actual[i+1])+
            Math.abs(source[i+2]-actual[i+2]))/3;
          const nearby=[luma(at(x+2,y)),luma(at(x-2,y)),luma(at(x,y+2)),luma(at(x,y-2))];
          const light=luma(i), center=light-nearby.reduce((sum,n)=>sum+n,0)/4;
          const gx=nearby[0]-nearby[1], gy=nearby[2]-nearby[3];
          const edge=Math.hypot(gx,gy);
          const dot=Math.abs(center)>26 && edge<Math.abs(center)*1.8;
          const highlight=light>190 && light>(.30*actual[i]+.59*actual[i+1]+.11*actual[i+2])+14;
          const score=error*Math.min(1,Math.max(edge,Math.abs(center))/38)*(highlight?1.35:1);
          if(score>13 && (!pick || score>pick.score)) pick={x,y,gx,gy,score,dot,highlight};
        }
      }
      if(pick) candidates.push(pick);
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const marks=[];
  const cap=32+Math.round(detail*.92);
  const centerOf=({points})=>points[Math.floor(points.length/2)];
  for(const {x,y,gx,gy,score,dot,highlight} of candidates) {
    if(marks.length>=cap) break;
    if(marks.some(mark=>{const [px,py]=centerOf(mark);return Math.hypot(px-x,py-y)<stride*.75;})) continue;
    const angle=Math.atan2(gy,gx)+Math.PI/2;
    const length=stride*(.24+(highlight?.62:.34)*Math.abs(Math.sin(x*4.7+y*8.6)));
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
    marks.push({points:dot?[[x,y]]:[[x-dx,y-dy],[x,y],[x+dx-dy*.20,y+dy+dx*.20]],
      color:'rgb('+channels.map(c=>Math.round(c/(2*sampleCount+1))).join(',')+')',
      width:Math.max(.9,stride*(dot?.16:.18)),opacity:Math.min(highlight?.86:.70,.36+score/225),pressure:.52});
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
  return ordered;
}
