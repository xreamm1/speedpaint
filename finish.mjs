// Use the remaining error to place accents. Each mark mixes a local pigment.
export function finishPlan(ctx, reference, detail) {
  const {width,height}=reference;
  const actual=ctx.getImageData(0,0,width,height).data;
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
          const gx=luma(at(x+2,y))-luma(at(x-2,y));
          const gy=luma(at(x,y+2))-luma(at(x,y-2));
          const edge=Math.hypot(gx,gy);
          const score=error*Math.min(1,edge/40);
          if(score>13 && (!pick || score>pick.score)) pick={x,y,gx,gy,score};
        }
      }
      if(pick) candidates.push(pick);
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const marks=[];
  const cap=22+Math.round(detail*.72);
  for(const {x,y,gx,gy,score} of candidates) {
    if(marks.length>=cap) break;
    if(marks.some(({points})=>Math.hypot(points[1][0]-x,points[1][1]-y)<stride*.85)) continue;
    const angle=Math.atan2(gy,gx)+Math.PI/2;
    const length=stride*(.24+.34*Math.abs(Math.sin(x*4.7+y*8.6)));
    const dx=Math.cos(angle)*length, dy=Math.sin(angle)*length;
    const cx=x-gx/Math.hypot(gx,gy)*1.2, cy=y-gy/Math.hypot(gx,gy)*1.2;
    const channels=[0,0,0];
    for(let j=-2;j<=2;j++) {
      const p=at(cx+Math.cos(angle)*j,cy+Math.sin(angle)*j);
      for(let k=0;k<3;k++) channels[k]+=source[p+k];
    }
    marks.push({points:[[x-dx,y-dy],[x,y],[x+dx-dy*.20,y+dy+dx*.20]],
      color:'rgb('+channels.map(c=>Math.round(c/5)).join(',')+')',
      width:Math.max(.9,stride*.20),opacity:Math.min(.67,.33+score/230),pressure:.52});
  }
  const ordered=[];
  let tip=marks[0]?.points[0];
  while(marks.length) {
    let nearest=0, best=Infinity, reverse=false;
    for(let i=0;i<marks.length;i++) {
      const {points}=marks[i];
      const start=Math.hypot(points[0][0]-tip[0],points[0][1]-tip[1]);
      const end=Math.hypot(points[2][0]-tip[0],points[2][1]-tip[1]);
      if(Math.min(start,end)<best) { nearest=i;best=Math.min(start,end);reverse=end<start; }
    }
    const [mark]=marks.splice(nearest,1);
    if(reverse) mark.points.reverse();
    mark.lift=best;
    ordered.push(mark);
    tip=mark.points[2];
  }
  return ordered;
}
