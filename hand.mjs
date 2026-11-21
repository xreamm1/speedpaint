// Shared by the planner, live canvas and recorder. Distances are in working pixels.
export const hand = { jitter: 1.15, pressure: 1, hatchDensity: 1 };
export function hash(i) {
  let n=Math.imul(i^(i>>>16),0x45d9f3b);
  n=Math.imul(n^(n>>>16),0x45d9f3b);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,seed) {
  const i=Math.floor(x),t=x-i,f=t*t*t*(t*(t*6-15)+10);
  const a=(2*hash(i+seed)-1)*t,b=(2*hash(i+1+seed)-1)*(t-1);
  return 2*(a+(b-a)*f);
}
export function paperSurface(ctx) {
  const {width,height}=ctx.canvas,im=ctx.createImageData(width,height);
  for(let i=0;i<width*height;i++){
    const grain=(hash(i+481)-.5)*13;
    for(const [k,base] of [238,231,218].entries()) im.data[4*i+k]=base+grain;
    im.data[4*i+3]=255;
  }
  ctx.putImageData(im,0,0);
}
let mask;
function nibMask(){
  if(mask)return mask;
  mask=new OffscreenCanvas(28,28);
  const g=mask.getContext('2d',{willReadFrequently:true}),im=g.createImageData(28,28);
  for(let i=0;i<784;i++){
    const x=(i%28-13.5)/13.5,y=(Math.floor(i/28)-13.5)/13.5,tooth=hash(i+352);
    const rim=Math.max(0,Math.min(1,(1-Math.hypot(x*(1+.08*y),y))*4));
    im.data[4*i+3]=255*rim*(tooth<.13?.05:.42+.56*tooth);
  }
  g.putImageData(im,0,0);return mask;
}
const nibs=new Map();
function nib(color) {
  if(nibs.has(color))return nibs.get(color);
  let canvas;
  if(nibs.size>=512){
    const oldest=nibs.keys().next().value;
    canvas=nibs.get(oldest);nibs.delete(oldest);
  }else canvas=new OffscreenCanvas(28,28);
  const g=canvas.getContext('2d',{willReadFrequently:true});
  g.globalCompositeOperation='copy';
  g.drawImage(nibMask(),0,0);
  g.globalCompositeOperation='source-in';g.fillStyle=color;g.fillRect(0,0,28,28);
  nibs.set(color,canvas);return canvas;
}
function spline(a,b,c,d,t){
  return b+.5*t*((c-a)+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
}
function paintRibbon(ctx,m,fraction){
  const pts=m.points,lengths=[0];
  for(let i=1;i<pts.length;i++)lengths.push(lengths[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const total=lengths.at(-1),left=[],right=[];
  for(let i=1;i<pts.length;i++){
    const a=pts[Math.max(0,i-2)],b=pts[i-1],c=pts[i],d=pts[Math.min(pts.length-1,i+1)];
    const len=lengths[i]-lengths[i-1];if(len<.001)continue;
    const end=Math.min(1,(fraction*total-lengths[i-1])/len);
    if(end<=0)break;
    const sharp=(a,b,c)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
      return (ux*vx+uy*vy)<.64*Math.hypot(ux,uy)*Math.hypot(vx,vy);
    };
    const curve=(axis,t)=>{
      if(m.ink && (sharp(a,b,c)||sharp(b,c,d)))return b[axis]+(c[axis]-b[axis])*t;
      return spline(a[axis],b[axis],c[axis],d[axis],t);
    };
    const steps=Math.max(2,Math.ceil(end*len/Math.max(1,m.width*.32)));
    for(let j=0;j<=steps;j++){
      const t=end*j/steps,u=(lengths[i-1]+len*t)/total;
      const x=curve(0,t),y=curve(1,t);
      const dx=curve(0,t+.01)-x,dy=curve(1,t+.01)-y;
      const pressure=m.ink
        ? .26+.29*Math.pow(Math.max(0,Math.sin(Math.PI*u)),.48)
        : m.baseBrush
          ? (.43+.06*Math.sin(Math.PI*u))*Math.min(1,.32+u*8,.38+(1-u)*7)
          : m.fineBrush
          ? .39*Math.min(1,u*7,(1-u)*5)
          : .03+.53*Math.pow(Math.max(0,Math.sin(Math.PI*u)),.65);
      const r=m.width*pressure/(Math.hypot(dx,dy)||1);
      left.push([x-dy*r,y+dx*r]);right.push([x+dy*r*.88,y-dx*r*.88]);
    }
  }
  if(left.length<2)return;
  let colour=m.color;
  if(m.shades){
    colour=ctx.createLinearGradient(...pts[0],...pts.at(-1));
    colour.addColorStop(0,m.shades[0]);
    colour.addColorStop(.5,m.shades[1]);
    colour.addColorStop(1,m.shades[2]);
  }
  ctx.fillStyle=colour;ctx.globalAlpha=m.opacity;ctx.beginPath();ctx.moveTo(...left[0]);
  for(const pt of left)ctx.lineTo(...pt);
  for(const pt of right.reverse())ctx.lineTo(...pt);
  ctx.closePath();ctx.fill();
}
export function drawHand(ctx,m,fraction=1) {
  if(fraction<=0)return;
  if(m.pigment){paintRibbon(ctx,m,fraction);return;}
  const pts=m.points,brush=nib(m.color),seed=m.seed;
  let length=0,previous;
  const durations=[];
  for(let i=1;i<pts.length;i++){
    const dx=pts[i][0]-pts[i-1][0],dy=pts[i][1]-pts[i-1][1],angle=Math.atan2(dy,dx);
    const turn=previous===undefined?0:Math.abs(Math.sin((angle-previous)/2));
    const duration=Math.hypot(dx,dy)*(1+.65*turn);
    durations.push(duration);length+=duration;previous=angle;
  }
  let elapsed=0;
  let distance=0,prevAngle;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[Math.max(0,i-1)],b=pts[i],c=pts[i+1],d=pts[Math.min(pts.length-1,i+2)];
    const dx=c[0]-b[0],dy=c[1]-b[1],len=Math.hypot(dx,dy);
    if(len<.001)continue;
    const heading=Math.atan2(dy,dx);
    const bend=prevAngle===undefined?0:Math.abs(Math.sin((heading-prevAngle)/2));
    const steps=Math.max(1,Math.ceil(len/Math.max(.48,m.width*.24)));
    for(let k=0;k<steps;k++){
      const t=(k+.5)/steps,along=distance+len*t,u=(elapsed+durations[i]*t)/length;
      // Slow through a turn, unload pigment at lift-off.
      const advance=u+.065*Math.sin(2*Math.PI*u);
      if(advance>fraction)return;
      const envelope=Math.pow(Math.max(0,Math.sin(Math.PI*u)),.48);
      const pressure=Math.min(1.35,hand.pressure*(.1+envelope*(.85+.32*bend+.12*noise(along/13,seed))));

      const x=spline(a[0],b[0],c[0],d[0],t);
      const y=spline(a[1],b[1],c[1],d[1],t);
      const diameter=Math.max(.3,m.width*pressure);
      ctx.globalAlpha=Math.min(1,m.opacity*pressure*(.9+.1*noise(along/2,seed+17)));
      ctx.drawImage(brush,x-diameter*.52,y-diameter*.48,diameter*1.04,diameter*.96);
    }
    distance+=len;elapsed+=durations[i];prevAngle=heading;
  }
}
export function prepareHand(mark,seed) {
  mark.seed=seed;
  mark.pace=.65+.8*hash(seed+83);
  if(mark.points.length===1){
    const [x,y]=mark.points[0],r=mark.width*.36;
    const angle=2*Math.PI*hash(seed+59),dx=r*Math.cos(angle),dy=r*Math.sin(angle);
    mark.points=[[x-dx,y-dy],[x,y],[x+.7*dx-.2*dy,y+.7*dy+.2*dx]];
  }
  return mark;
}
export function searchLines(line,seed) {
  const copies=line.points.length>=16?3:2;
  return Array.from({length:copies},(_,pass)=>{
    const points=line.points.map(([x,y],i)=>{
      const prev=line.points[Math.max(0,i-1)],next=line.points[Math.min(line.points.length-1,i+1)];
      const dx=next[0]-prev[0],dy=next[1]-prev[1],len=Math.hypot(dx,dy)||1;
      const slip=(i===0||i===line.points.length-1)?(hash(seed+pass*57+i)-.5)*line.width*3:0;
      const offset=pass===copies-1?0:line.width*(.5+noise(i/5,seed+pass))*hand.jitter*2;
      return [x+(slip*dx-offset*dy)/len,y+(slip*dy+offset*dx)/len];
    });
    return {...line,points,width:line.width*(pass===copies-1?1:.72),opacity:pass===copies-1?.52:.25};
  });
}
export function hatchShadows(w,h,unit,toneAt,colorAt) {
  const marks=[];
  if(hand.hatchDensity<=0)return marks;
  const step=Math.max(2.1,5.3*unit/Math.sqrt(hand.hatchDensity));
  for(let family=0;family<2;family++)for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
    const seed=Math.floor(y*w+x)+family*99991;
    const cx=x+step*hash(seed),cy=y+step*hash(seed+31),value=toneAt(cx,cy);
    if(value>(family?89:153)||hash(seed+15)>Math.min(1,(180-value)/110))continue;
    const slope=(px,py)=>Math.atan2(toneAt(px,py+step)-toneAt(px,py-step),toneAt(px+step,py)-toneAt(px-step,py)) + Math.PI/2;
    const patch=Math.floor(cx/(step*7))+911*Math.floor(cy/(step*7));
    const lean=(family?.94:-.18)+.65*(hash(patch+family*31)-.5)+1.15*(hash(seed+27)-.5);
    const stride=step*(.34+.43*hash(seed+91));
    let heading=slope(cx,cy)+lean;
    const points=[[cx,cy]],count=3+Math.floor(hash(seed+11)*6);
    for(let i=0;i<count;i++){
      const [px,py]=points.at(-1),target=slope(px,py)+lean+.32*noise(i*.48,seed);
      heading+=.17*Math.atan2(Math.sin(2*(target-heading)),Math.cos(2*(target-heading)));
      const nx=px+stride*Math.cos(heading),ny=py+stride*Math.sin(heading);
      if(nx<0||ny<0||nx>=w||ny>=h||Math.abs(toneAt(nx,ny)-value)>30)break;
      points.push([nx,ny]);
    }
    if(points.length>1)marks.push({points,width:Math.max(.72,unit*(.9+.7*hash(seed+9))),color:colorAt(cx,cy),opacity:.55});
  }
  return marks;
}
