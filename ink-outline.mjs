import {smoothMask} from './paint.mjs?v=form-strokes';

export function fineInk(photo,w,h,unit,photographic,coloured=false){
  // A narrow mark is darker on both sides. A boundary of a filled shadow
  // only has this contrast on one side and belongs to the broad sketch.
  const light=new Float32Array(w*h),ridge=new Uint8Array(w*h),strength=new Float32Array(w*h);
  for(let i=0;i<light.length;i++)light[i]=.299*photo[i*4]+.587*photo[i*4+1]+.114*photo[i*4+2];
  const soft=light.slice();
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    soft[i]=light[i]*.68+(light[i-1]+light[i+1]+light[i-w]+light[i+w])*.08;
  }
  const opponent=(i,c)=>1.5*photo[i*4+c]-.5*(photo[i*4]+photo[i*4+1]+photo[i*4+2]);
  const reach=Math.max(3,Math.round(4.8*unit));
  const taps=[Math.max(2,Math.round(reach*.6)),reach];
  const offsets=taps.flatMap(r=>[r,r*w,r*(w+1),r*(w-1)]);
  for(let y=reach;y<h-reach;y++)for(let x=reach;x<w-reach;x++){
    const i=y*w+x,l=soft[i];
    let contrast=0;
    if(coloured){
      if(l<107)continue;
      for(let c=0;c<3;c++){
        const value=opponent(i,c);
        if(Math.abs(value)<19)continue;
        const sign=Math.sign(value);
        for(const d of offsets){
          const a=(value-opponent(i-d,c))*sign,b=(value-opponent(i+d,c))*sign;
          if(Math.abs(photo[i*4+c]-photo[(i-d)*4+c])+Math.abs(photo[i*4+c]-photo[(i+d)*4+c])<18)continue;
          contrast=Math.max(contrast,Math.min(a,b));
        }
      }
    }else{
      if(l>=140)continue;
      for(const d of offsets)contrast=Math.max(contrast,Math.min(soft[i-d],soft[i+d])-l);
    }
    if(contrast>31)ridge[i]=1;
    if(contrast>9)strength[i]=contrast;
  }
  const clockwise=[-w,1-w,1,1+w,w,w-1,-1,-w-1],components=[];
  if(coloured){
    let seeds=[];
    for(let i=0;i<ridge.length;i++)if(ridge[i])seeds.push(i);
    // Extend established accents into neighbouring pixels of the same
    // pigment so a small drop in contrast cannot cut a continuous rim.
    for(let pass=0;pass<4&&seeds.length;pass++){
      const next=[];
      for(const i of seeds)for(const d of clockwise){
        const j=i+d;
        if(ridge[j]||light[j]<107)continue;
        if(j%w<reach||j%w>=w-reach||j<reach*w||j>=w*(h-reach))continue;
        const difference=[0,1,2].reduce((sum,c)=>sum+Math.abs(photo[i*4+c]-photo[j*4+c]),0);
        if(difference>(strength[j]?36:11))continue;
        if(!strength[j]&&!([0,1,2].some(c=>Math.abs(opponent(j,c))>22)))continue;
        strength[j]||=9;
        ridge[j]=1;next.push(j);
      }
      seeds=next;
    }
  }
  for(let i=0;i<ridge.length;i++){
    if(ridge[i]!==1)continue;
    const group=[i];ridge[i]=2;
    let score=0;
    for(const j of group){
      score+=strength[j];
      for(const d of clockwise)if(ridge[j+d]===1){ridge[j+d]=2;group.push(j+d);}
    }
    if(group.length>=Math.max(6,(coloured?12:9)*unit**2)){
      components.push({group,score:score/Math.sqrt(group.length)});
    }
  }
  components.sort((a,b)=>b.score-a.score);
  const selected=components.slice(0,coloured?65:photographic?125:180);
  if(!selected.length)return [];
  const cells=selected.flatMap(({group})=>group);
  const material={path:smoothMask(cells,w,1,.32).path,sx:1,sy:1};
  const skeleton=new Uint8Array(w*h);
  for(const i of cells)skeleton[i]=1;
  // Thin the mask without breaking junctions or closing the counters of letters.
  for(let changed=true;changed;){
    changed=false;
    for(const pass of [0,1]){
      const removals=[];
      for(const i of cells){
        if(!skeleton[i])continue;
        const neighbours=clockwise.map(offset=>skeleton[i+offset]);
        const count=neighbours.reduce((sum,n)=>sum+n,0);
        if(count<2||count>6)continue;
        let transitions=0;
        for(let k=0;k<8;k++)if(!neighbours[k]&&neighbours[(k+1)%8])transitions++;
        if(transitions!==1)continue;
        const [n,,e,,s,,west]=neighbours;
        if(pass===0 ? n*e*s||e*s*west : n*e*west||n*s*west)continue;
        removals.push(i);
      }
      for(const i of removals)skeleton[i]=0;
      changed||=removals.length>0;
    }
  }
  const marks=[];
  const toPoint=i=>[i%w+.5,Math.floor(i/w)+.5];
  const width=Math.max(3,reach*1.85);
  for(const {group,score} of selected){
    const links=new Map();
    for(const i of group){
      if(!skeleton[i])continue;
      links.set(i,clockwise.map((d,k)=>[i+d,k]).filter(([j,k])=>skeleton[j]&&
        (!(k%2)||!skeleton[i+clockwise[k-1]]&&!skeleton[i+clockwise[(k+1)%8]]))
        .map(([j])=>j));
    }
    const visited=new Set();
    const edge=(a,b)=>Math.min(a,b)*skeleton.length+Math.max(a,b);
    const starts=[...links.keys()].sort((a,b)=>Number(links.get(b).length===1)-Number(links.get(a).length===1));
    for(const i of starts)for(const j of links.get(i)){
      if(visited.has(edge(i,j)))continue;
      const run=[i,j];visited.add(edge(i,j));
      let previous=i,last=j;
      while(run.length<160 && last!==i){
        const [px,py]=toPoint(previous),[x,y]=toPoint(last);
        let next=-1,best=-Infinity;
        for(const k of links.get(last)||[]){
          if(visited.has(edge(last,k)))continue;
          const [kx,ky]=toPoint(k);
          const align=((kx-x)*(x-px)+(ky-y)*(y-py))/Math.hypot(kx-x,ky-y);
          if(align>best){best=align;next=k;}
        }
        if(next<0)break;
        visited.add(edge(last,next));run.push(next);
        previous=last;last=next;
      }
      if(run.length<3)continue;
      const points=run.filter((_,index)=>index%2===0||index===run.length-1).map(toPoint);
      const weight=j=>coloured?strength[j]:1;
      const total=run.reduce((sum,j)=>sum+weight(j),0);
      const color=[0,1,2].map(c=>Math.round(run.reduce((sum,j)=>sum+photo[j*4+c]*weight(j),0)/total));
      marks.push({points,material,color:'rgb('+color.join(',')+')',width,pigment:true,ink:true,
        opacity:.96,priority:Math.min(65,12+score/15),preciseInk:true});
    }
  }
  return marks;
}
