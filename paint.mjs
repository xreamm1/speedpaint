import {staffGroups} from './classify.mjs?v=adaptive';

export const paper = '#eee7da';

const clipPaths = new WeakMap();

function smoothMask(region,cols,step) {
  const cells=new Set(region);
  const stride=cols+1;
  const edges=new Map();
  function edge(from,to,direction) {
    if(!edges.has(from)) edges.set(from,[]);
    edges.get(from).push({to,direction});
  }
  for(const cell of region) {
    const x=cell%cols,y=Math.floor(cell/cols);
    const v=y*stride+x;
    if(!cells.has(cell-cols)) edge(v,v+1,0);
    if(x===cols-1 || !cells.has(cell+1)) edge(v+1,v+stride+1,1);
    if(!cells.has(cell+cols)) edge(v+stride+1,v+stride,2);
    if(x===0 || !cells.has(cell-1)) edge(v+stride,v,3);
  }
  function simplify(points) {
    const keep=new Uint8Array(points.length);
    keep[0]=keep[points.length-1]=1;
    const spans=[[0,points.length-1]];
    while(spans.length) {
      const [first,last]=spans.pop();
      const [x,y]=points[first], [endX,endY]=points[last];
      const dx=endX-x,dy=endY-y,length=dx*dx+dy*dy;
      let farthest=0,best=.77;
      for(let i=first+1;i<last;i++) {
        const px=points[i][0]-x,py=points[i][1]-y;
        const t=length?Math.max(0,Math.min(1,(px*dx+py*dy)/length)):0;
        const distance=(px-t*dx)**2+(py-t*dy)**2;
        if(distance>best) {best=distance;farthest=i;}
      }
      if(farthest) {
        keep[farthest]=1;
        spans.push([first,farthest],[farthest,last]);
      }
    }
    return points.slice(0,-1).filter((_,i)=>keep[i]);
  }
  const commands=[];
  const rank=[1,0,3,2];
  while(edges.size) {
    const start=edges.keys().next().value;
    let current=start,direction=edges.get(start)[0].direction;
    const contour=[];
    do {
      contour.push([current%stride,Math.floor(current/stride)]);
      const outgoing=edges.get(current);
      if(!outgoing) break;
      let selected=0;
      for(let i=1;i<outgoing.length;i++) {
        if(rank[(outgoing[i].direction-direction+4)%4]<rank[(outgoing[selected].direction-direction+4)%4]) selected=i;
      }
      const [next]=outgoing.splice(selected,1);
      if(!outgoing.length) edges.delete(current);
      current=next.to;
      direction=next.direction;
    } while(current!==start);
    if(current!==start || contour.length<4) continue;
    const simplified=contour.length>8?simplify([...contour,contour[0]]):contour;
    const points=simplified.length>=3?simplified:contour;
    const near=(a,b)=>{
      const t=Math.min(.42,1.15/Math.hypot(b[0]-a[0],b[1]-a[1]));
      return [step*(a[0]+(b[0]-a[0])*t),step*(a[1]+(b[1]-a[1])*t)];
    };
    commands.push('M',...near(points[0],points.at(-1)));
    for(let i=0;i<points.length;i++) {
      const [x,y]=points[i];
      if(i) commands.push('L',...near(points[i],points[i-1]));
      commands.push('Q',x*step,y*step,...near(points[i],points[(i+1)%points.length]));
    }
    commands.push('Z');
  }
  return {path:commands.join(' ')};
}

export function plan(source, brush, detail, focus, report = () => {}, type = 'illustration') {
  const {width: w, height: h} = source;
  const sample = new OffscreenCanvas(w,h);
  const ctx = sample.getContext('2d', {willReadFrequently:true});
  function pixels(blur) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.filter = 'blur(' + blur + 'px)';
    ctx.drawImage(source, 0, 0);
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, w, h).data;
  }
  const unit = Math.max(w, h) / 720;
  let seed = 72413;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const clamp = (n, max) => Math.max(0, Math.min(max - 1, n));
  const at = (x,y) => clamp(Math.round(x),w) + clamp(Math.round(y),h)*w;

  function gradient(rgb,colorEdges=false) {
    const size = w*h;
    const gray = new Float32Array(size);
    const angle = new Float32Array(size);
    const strength = new Float32Array(size);
    for (let i=0; i<size; i++) gray[i] = .299*rgb[4*i]+.587*rgb[4*i+1]+.114*rgb[4*i+2];
    const margin = Math.min(4,Math.max(1,Math.floor(Math.min(w,h)/8)));
    for (let y=margin; y<h-margin; y++) {
      for (let x=margin; x<w-margin; x++) {
        const i = y*w+x;
        let dx = gray[i-w+1]+2*gray[i+1]+gray[i+w+1]-gray[i-w-1]-2*gray[i-1]-gray[i+w-1];
        let dy = gray[i+w-1]+2*gray[i+w]+gray[i+w+1]-gray[i-w-1]-2*gray[i-w]-gray[i-w+1];
        if (colorEdges) {
          for(let c=0;c<3;c++) {
            const tl=rgb[(i-w-1)*4+c],tc=rgb[(i-w)*4+c],tr=rgb[(i-w+1)*4+c];
            const ml=rgb[(i-1)*4+c],mr=rgb[(i+1)*4+c];
            const bl=rgb[(i+w-1)*4+c],bc=rgb[(i+w)*4+c],br=rgb[(i+w+1)*4+c];
            const sx=(tr+2*mr+br-tl-2*ml-bl)*.58;
            const sy=(bl+2*bc+br-tl-2*tc-tr)*.58;
            if(sx*sx+sy*sy>dx*dx+dy*dy) {dx=sx;dy=sy;}
          }
        }
        angle[i] = Math.atan2(dy,dx);
        strength[i] = Math.hypot(dx,dy);
      }
    }
    return {angle,strength};
  }
  function sketch({angle,strength}) {
    const edges = new Uint8Array(w*h);
    const starts = [];
    const floor = 74 - detail*.38;
    for (let y=1; y<h-1; y++) {
      for (let x=1; x<w-1; x++) {
        const i = y*w+x;
        if (strength[i]<floor) continue;
        const dx = Math.round(Math.cos(angle[i]));
        const dy = Math.round(Math.sin(angle[i]));
        if (strength[i]<strength[i+dx+dy*w] || strength[i]<=strength[i-dx-dy*w]) continue;
        edges[i] = 1;
        starts.push(i);
      }
    }
    starts.sort((a,b)=>strength[b]-strength[a]);
    function trace(start) {
      const path = [];
      let current = start;
      while (path.length<150) {
        const x = current%w;
        const y = (current-x)/w;
        let next = -1;
        let score = 0;
        for (let dy=-1; dy<=1; dy++) {
          for (let dx=-1; dx<=1; dx++) {
            const near = at(x+dx,y+dy);
            if (!edges[near] || near===current) continue;
            const alignment = Math.abs(Math.sin(Math.atan2(dy,dx)-angle[current]));
            const rank = alignment * (1+strength[near]/1000);
            if (rank>score) { next = near; score = rank; }
          }
        }
        if (next<0) break;
        edges[next] = 0;
        path.push(next);
        current = next;
      }
      return path;
    }
    const marks = [];
    for (const start of starts) {
      if (!edges[start]) continue;
      edges[start] = 0;
      const path = [...trace(start).reverse(),start,...trace(start)];
      if (path.length<Math.max(4,10*unit-detail*.04)) continue;
      const points = path.map((i,j)=>{
        const neighbors = path.slice(Math.max(0,j-2),j+3);
        const point = neighbors.reduce(([x,y],p)=>[x+p%w,y+Math.floor(p/w)],[0,0]);
        return point.map(n=>n/neighbors.length+(random()-.5)*.9*unit);
      });
      const length = path.length;
      marks.push({points, length, width:Math.max(.85,1.7*unit)*(.78+random()*.55),
        color:'#302824', opacity:.61+random()*.27, pressure:random(), pace:.7+random()*.65});
    }
    marks.sort((a,b)=>b.length-a.length);
    const gestures = [];
    const distance = (a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    const budget=42+Math.round(detail*.56);
    const major=focus ? [...marks].map(mark=>{
      const point=[focus[0]*w,focus[1]*h];
      const center=mark.points[Math.floor(mark.points.length/2)];
      return {...mark,focusDistance:distance(center,point)};
    }).sort((a,b)=>(a.focusDistance-b.focusDistance)*1.4-(a.length-b.length)*.42) : marks;
    const foreground=major.slice(0,Math.round(budget*.72));
    const selectedPoints=new Set(foreground.map(mark=>mark.points));
    const candidates=focus ? [...foreground,...marks.filter(mark=>!selectedPoints.has(mark.points)).slice(0,budget-foreground.length)] :
      marks.slice(0,budget);
    const drawn=new Set(candidates.map(mark=>mark.points));
    const cleanup=marks.filter(mark=>!drawn.has(mark.points) && mark.length>=Math.max(9,15*unit))
      .slice(0,45+Math.round(detail*.65));
    const construction=major.slice(0,focus?11:17).map(mark=>({...mark,
      points:mark.points.filter((_,i)=>i%4===0).map(([x,y],i)=>[
        x+Math.sin(i*.25)*unit*1.5,y+Math.cos(i*.29)*unit*1.5]),
      opacity:.13,width:mark.width*.85,pace:.55
    })).filter(mark=>mark.points.length>1);
    let hand;
    while (candidates.length) {
      let best = Infinity;
      let selected = 0;
      let reverse = false;
      for (let i=0; hand && i<candidates.length; i++) {
        const {points,length,focusDistance} = candidates[i];
        const first = distance(hand,points[0]);
        const last = distance(hand,points.at(-1));
        const priority=focus && gestures.length<budget*.55 ? (focusDistance ?? Math.hypot(w,h))*.72 : 0;
        const score = Math.min(first,last)-length*.48+priority;
        if (score<best) {
          best = score;
          selected = i;
          reverse = last<first;
        }
      }
      const [mark] = candidates.splice(selected,1);
      if (reverse) mark.points.reverse();
      const first = mark.points[0], last = mark.points.at(-1);
      if (mark.length>36*unit && gestures.length<19 && random()<.57) {
        const offset = (1+random()*2)*Math.max(.6,unit)*(random()<.5?-1:1);
        const heading = Math.atan2(last[1]-first[1],last[0]-first[0]);
        const offsetPoints = mark.points.filter((_,i)=>i%3===0).map(([x,y],i,points)=>{
          const shift = offset*Math.sin(Math.PI*i/(points.length-1)+.45);
          return [x-Math.sin(heading)*shift,y+Math.cos(heading)*shift];
        });
        if (offsetPoints.length>2) {
          gestures.push({...mark, points:offsetPoints, width:mark.width*.68, opacity:mark.opacity*.32,
            lift: hand ? distance(hand,first) : 0, pace:.60});
          hand = offsetPoints.at(-1);
        }
      }
      gestures.push({...mark,lift:hand?distance(hand,first):0});
      hand = last;
    }
    return [...construction,...gestures,...cleanup];
  }

  function flats() {
    const step = Math.max(1,Math.ceil(Math.max(w,h)/360));
    const cols = Math.ceil(w/step), rows = Math.ceil(h/step);
    const rgb = pixels(Math.max(.4,step*.42));
    const seen = new Uint8Array(cols*rows);
    const colorAt = i=>at((i%cols+.5)*step,(Math.floor(i/cols)+.5)*step)*4;
    const dark = Uint8Array.from(seen,(_,cell)=>{
      const i=colorAt(cell);
      return .30*rgb[i]+.59*rgb[i+1]+.11*rgb[i+2]<65;
    });
    const barrier = dark.map((value,i)=>{
      const x=i%cols;
      if (value) return 1;
      return Number((x>0 && x<cols-1 && dark[i-1] && dark[i+1]) ||
        (dark[i-cols] && dark[i+cols]) || false);
    });
    const horizontal = new Uint8Array(seen.length);
    const vertical = new Uint8Array(seen.length);
    function contrast(cell,other) {
      const a=colorAt(cell), b=colorAt(other);
      return Math.abs(rgb[a]-rgb[b])+Math.abs(rgb[a+1]-rgb[b+1])+Math.abs(rgb[a+2]-rgb[b+2])>58;
    }
    for (let i=0;i<seen.length;i++) {
      if (i%cols<cols-1) horizontal[i]=contrast(i,i+1);
      if (i+cols<seen.length) vertical[i]=contrast(i,i+cols);
    }
    function crosses(a,b) {
      const i=Math.min(a,b);
      if (Math.floor(a/cols)!==Math.floor(b/cols)) {
        const x=i%cols;
        return vertical[i] || x>0 && x<cols-1 && vertical[i-1] && vertical[i+1];
      }
      return horizontal[i] || horizontal[i-cols] && horizontal[i+cols];
    }
    const fills = [];
    for (let seed=0;seed<seen.length;seed++) {
      if (seen[seed]) continue;
      const region = [seed];
      const c = colorAt(seed);
      seen[seed] = 1;
      let r=0,g=0,b=0, sumX=0,sumY=0,minX=cols,maxX=0,minY=rows,maxY=0;
      for (let i=0;i<region.length;i++) {
        const cell=region[i], x=cell%cols, y=Math.floor(cell/cols);
        const v=colorAt(cell);
        r+=rgb[v];g+=rgb[v+1];b+=rgb[v+2];
        sumX+=x;sumY+=y;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);
        minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for (const next of [x>0?cell-1:-1,x<cols-1?cell+1:-1,y>0?cell-cols:-1,y<rows-1?cell+cols:-1]) {
          if (next<0 || seen[next] || barrier[next]!==barrier[cell] || crosses(cell,next)) continue;
          const n=colorAt(next);
          const delta=Math.abs(rgb[n]-rgb[c])+Math.abs(rgb[n+1]-rgb[c+1])+Math.abs(rgb[n+2]-rgb[c+2]);
          if (delta>46) continue;
          seen[next]=1;
          region.push(next);
        }
      }
      if (region.length<Math.max(9,seen.length*.00022)) continue;
      const point=[(sumX/region.length+.5)*step,(sumY/region.length+.5)*step];
      const pigment=[r,g,b].map(n=>Math.round(n/region.length));
      const background=Number(minX===0)+Number(minY===0)+Number(maxX===cols-1)+Number(maxY===rows-1)>1;
      const roundness=Math.min(maxX-minX+1,maxY-minY+1)/Math.max(maxX-minX+1,maxY-minY+1);
      fills.push({region,point,pigment,background,roundness});
    }
    const regions=fills.sort((a,b)=>b.region.length-a.region.length).slice(0,105);
    const anchors=[];
    const reach=Math.max(w,h)*.135;
    for (const area of regions) {
      if (anchors.length>=12) break;
      if (anchors.every(({point})=>Math.hypot(point[0]-area.point[0],point[1]-area.point[1])>reach)) anchors.push(area);
    }
    function shapeAt(x,y,pigment) {
      let shape=0,best=Infinity;
      for(let i=0;i<anchors.length;i++) {
        const {point,pigment:base}=anchors[i];
        const chroma=Math.hypot((pigment[0]-pigment[1])-(base[0]-base[1]),(pigment[1]-pigment[2])-(base[1]-base[2]));
        const score=Math.hypot(x-point[0],y-point[1])+Math.min(reach*.62,chroma*reach/200);
        if (score<best) {best=score;shape=i;}
      }
      return shape;
    }
    if (focus) {
      const [fx,fy]=[focus[0]*w,focus[1]*h];
      const priority=area=>Math.hypot(area.point[0]-fx,area.point[1]-fy)+(area.background?w:0);
      regions.sort((a,b)=>priority(a)-priority(b));
    }
    const labels = new Uint16Array(seen.length);
    const orphaned = [];
    for (const [i,area] of regions.entries()) {
      area.color='rgb('+area.pigment.join(',')+')';
      for (const cell of area.region) labels[cell]=i+1;
    }
    // Keep tiny color fragments available to the coverage pass.
    for (let i=0;i<labels.length;i++) {
      if (!labels[i]) orphaned.push(i);
    }
    const fringe = new Set(orphaned);
    for (let head=0;head<orphaned.length;) {
      const cell=orphaned[head++];
      if (!fringe.delete(cell)) continue;
      const cells=[cell];
      for (const i of cells) {
        const x=i%cols;
        for (const next of [x?i-1:-1,x<cols-1?i+1:-1,i-cols,i+cols]) {
          if (fringe.has(next) && !crosses(i,next) && !contrast(i,next)) {
            fringe.delete(next);
            cells.push(next);
          }
        }
      }
      regions.push({region:cells,clip:smoothMask(cells,cols,step),fringe:true});
    }
    for (const area of regions) if (!area.clip) area.clip=smoothMask(area.region,cols,step);
    const depth = new Uint16Array(labels.length);
    const queue = [];
    for (let i=0;i<labels.length;i++) {
      const label=labels[i], x=i%cols;
      if (!label) continue;
      if (!x || x===cols-1 || labels[i-1]!==label || labels[i+1]!==label ||
          labels[i-cols]!==label || labels[i+cols]!==label) {
        depth[i]=1;
        queue.push(i);
      }
    }
    for (let head=0;head<queue.length;head++) {
      const i=queue[head], x=i%cols;
      for (const neighbor of [x?i-1:-1,x<cols-1?i+1:-1,i-cols,i+cols]) {
        if (labels[neighbor]!==labels[i] || depth[neighbor]) continue;
        depth[neighbor]=depth[i]+1;
        queue.push(neighbor);
      }
    }
    const marks=regions.filter(area=>!area.fringe).flatMap(({region,point,pigment,background,roundness,clip:fill,color})=>{
      const shape=shapeAt(...point,pigment);
      const width=Math.max(step*2.2,Math.min(52*unit,Math.sqrt(region.length)*step*.38))*brush/100;
      const lane=Math.max(step,width*.88);
      const angle=.18+(random()-.5)*.48;
      const dx=Math.cos(angle), dy=Math.sin(angle);
      const center=point[0]*dx+point[1]*dy;
      const span=Math.max(lane*2,Math.sqrt(region.length)*step);
      const bow=background ? width*.12 : span*.15*roundness;
      const offset=x=>bow*((x-center)/span)**2;
      const bands=new Map();
      for (const cell of region) {
        const x=(cell%cols+.5)*step, y=(Math.floor(cell/cols)+.5)*step;
        const along=x*dx+y*dy;
        const across=y*dx-x*dy-offset(along);
        const band=Math.round(across/lane);
        if (!bands.has(band)) bands.set(band,[]);
        bands.get(band).push({along,across,depth:depth[cell]});
      }
      const result=[];
      let reverse=false;
      for (const [,cells] of [...bands].sort(([a],[b])=>a-b)) {
        cells.sort((a,b)=>reverse?b.along-a.along:a.along-b.along);
        for (let i=0;i<cells.length;) {
          const start=i++;
          while (i<cells.length && Math.abs(cells[i].along-cells[i-1].along)<Math.max(step*2.4,width*.75)) i++;
          const a=cells[start], b=cells[i-1];
          const length=Math.abs(a.along-b.along);
          if (i-start<3 && region.length>20) continue;
          if (length<step*1.4) continue;
          const bend=(random()-.5)*Math.min(width*.65,length*.24);
          const points=Array.from({length:7},(_,j)=>{
              const t=j/6, along=a.along+(b.along-a.along)*t;
              const across=a.across+(b.across-a.across)*t+offset(along)+Math.sin(Math.PI*t)*bend;
              return [along*dx-across*dy,along*dy+across*dx];
            });
          const clearance=cells[start+Math.floor((i-start)/2)].depth;
          const localWidth=Math.max(step*1.4,step*(2*clearance-.5));
          result.push({clip:fill,points,width:Math.min(length*.74,localWidth,width*(.93+random()*.14)),color,
            opacity:.68+random()*.16,pace:.8+random()*.38,pressure:.35,
            shape,mass:region.length>=seen.length*.013});
        }
        reverse=!reverse;
      }
      return result;
    });
    return {marks,shapeAt,regions,labels,cols,step};
  }

  const photographic=type==='photo' || type==='portrait';
  const largeFlow=photographic ? gradient(pixels(Math.max(3,unit*7))) : null;

  function paint(size, blur, opacity, budget, fine) {
    const rgb = pixels(blur);
    const {angle,strength} = gradient(rgb);
    const spacing = Math.max(2.6,Math.sqrt(w*h/budget));
    const marks = [];
    for (let y=spacing/2; y<h+spacing/2; y+=spacing) {
      for (let x=spacing/2; x<w+spacing/2; x+=spacing) {
        let px = clamp(x+(random()-.5)*spacing*.6,w);
        let py = clamp(y+(random()-.5)*spacing*.6,h);
        let i = at(px,py);
        if (fine) {
          const step=spacing*.23;
          for(const [dx,dy] of [[-step,0],[step,0],[0,-step],[0,step]]) {
            const tx=clamp(x+dx,w),ty=clamp(y+dy,h),pixel=at(tx,ty);
            if(strength[pixel]>strength[i]) { px=tx;py=ty;i=pixel; }
          }
          if (strength[i]<20) continue;
        }
        const nearFace=type==='portrait' && focus &&
          Math.hypot(px-focus[0]*w, py-(focus[1]*h+Math.min(w,h)*.05))<Math.min(w,h)*.23;
        const width = size*(nearFace?(fine?.62:.53):1)*(.84+random()*.40);
        const bend = (random()-.5)*.55;
        const steps = fine ? 5+Math.floor(random()*6) : 8+Math.floor(random()*7);
        const step = Math.max(.6,width*.23);
        function direction(index) {
          if (strength[index]>22) return angle[index]+Math.PI/2+bend;
          if (largeFlow && largeFlow.strength[index]>7) return largeFlow.angle[index]+Math.PI/2+bend*.4;
          if (photographic) {
            const x=index%w, y=Math.floor(index/w);
            return .72*Math.sin(x*3.8/w)+.85*Math.cos(y*5.2/h)+bend;
          }
          return -.55+bend;
        }
        const rgbIndex = i*4;
        const colorDistance = index => Math.abs(rgb[index*4]-rgb[rgbIndex])+
          Math.abs(rgb[index*4+1]-rgb[rgbIndex+1])+Math.abs(rgb[index*4+2]-rgb[rgbIndex+2]);

        function half(sign) {
          const points = [];
          let x = px, y = py, heading = direction(i)+(sign<0?Math.PI:0);
          for (let k=0; k<steps; k++) {
            const target = direction(at(x,y));
            let turn = target-heading;
            turn = .5*Math.atan2(Math.sin(2*turn),Math.cos(2*turn));
            heading += turn*.34+bend*.07;
            x += Math.cos(heading)*step;
            y += Math.sin(heading)*step;
            if (x<0 || y<0 || x>=w || y>=h || (k>0 && colorDistance(at(x,y))>(fine?47:92))) break;
            points.push([x,y]);
          }
          return points;
        }
        const points = [...half(-1).reverse(),[px,py],...half(1)];
        if(points.length<3) continue;
        const paintedWidth=Math.min(width,(points.length-1)*step*.66);
        const color = 'rgb('+rgb.slice(rgbIndex,rgbIndex+3).join(',')+')';
        const paintColors=!fine && points.length>2 ? [0,.33,.66,1].map(t=>{
          const [x,y]=points[Math.round(t*(points.length-1))];
          const offset=Math.max(1,width*.13);
          const samples=[at(x,y),at(x-offset,y),at(x+offset,y),at(x,y-offset),at(x,y+offset)];
          return 'rgb('+[0,1,2].map(k=>Math.round(samples.reduce((sum,p)=>sum+rgb[4*p+k],0)/5)).join(',')+')';
        }) : null;
        const group = Math.floor(px/(spacing*5)) + Math.floor(py/(spacing*5))*Math.ceil(w/(spacing*5));
        marks.push({points,width:paintedWidth,color,paintColors,opacity:opacity*(.82+random()*.18),
          soft:photographic && !fine && strength[i]<44,center:[px,py],pigment:[rgb[rgbIndex],rgb[rgbIndex+1],rgb[rgbIndex+2]],edge:strength[i],pressure:.52,
          score:Math.sin(group*192.27)*.44 + random()*.47 + (fine?strength[i]/1500:0)});
      }
    }
    return marks.sort((a,b)=>b.score-a.score);
  }

  report('Строю контуры и композицию',12);
  const inkMode=type==='ink' || type==='score';
  if (inkMode) {
    const gray=pixels(Math.max(.30,unit*.45));
    const edges=gradient(gray,true);
    const staff=type==='score' ? staffGroups({width:w,height:h,data:gray}) : [];
    const rules=staff.map(({left,right,top,bottom})=>({
      points:[[left,(top+bottom)/2],[right,(top+bottom)/2]], width:Math.max(1,bottom-top+1),
      color:'#242020',opacity:.96
    }));
    for (const {left,right,top,bottom} of staff) {
      for (let y=Math.max(0,top-1);y<Math.min(h,bottom+2);y++) {
        for (let x=left;x<=right;x++) {
          const index=y*w+x;
          if (Math.abs(Math.cos(edges.angle[index]))<.40) edges.strength[index]=0;
        }
      }
    }
    const pen=sketch(edges).map(mark=>({...mark,color:'#242020',opacity:.92}));
    return {stages:[rules.length?rules:pen,rules.length?pen:[],[],[]]};
  }
  const outline = sketch(gradient(pixels(Math.max(.65,unit)),true));
  const scale = brush/100*unit;
  report('Подбираю крупные цветовые пятна',34);
  const {marks:base,shapeAt,...areas} = flats();
  report('Прокладываю траектории кисти',55);
  const middle = paint(Math.max(4,(photographic?29:30)*scale),Math.max(.35,.95*scale),photographic?.79:.90,photographic?900:475,false);
  const fine = paint(Math.max(1.8,(10-detail*.063)*scale),Math.max(.15,.28*scale),.86,150+detail*(type==='portrait'?4.5:photographic?2.6:.95),true);
  let accents = outline.slice(0,Math.round(detail/3)).map(mark=>({...mark, opacity:mark.opacity*.36}));
  if (type==='illustration') {
    const colors = pixels(.18);
    const luminance = (i)=>.299*colors[i]+.587*colors[i+1]+.114*colors[i+2];
    accents = outline.flatMap(mark=>{
      if (mark.points.length<5) return [];
      const samples = [0,.25,.5,.75,1].map(t=>{
        const [x,y]=mark.points[Math.round(t*(mark.points.length-1))];
        const center=at(x,y)*4;
        let dark=center, light=luminance(center);
        for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const neighbor=at(x+dx,y+dy)*4;
          if (luminance(neighbor)<luminance(dark)) dark=neighbor;
          light=Math.max(light,luminance(neighbor));
        }
        return {dark,contrast:light-luminance(dark)};
      });
      if (samples.filter(({dark,contrast})=>luminance(dark)<115 && contrast>19).length<3) return [];
      const paintColors=samples.map(({dark})=>'rgb('+colors.subarray(dark,dark+3).join(',')+')');
      return [{...mark,color:paintColors[2],paintColors,
        width:Math.max(.8,Math.min(2.3*unit,mark.width*.9)),opacity:.86}];
    });
  }
  const byShape=(a,b)=>a.shape-b.shape;
  const foundation=focus ? base : base.filter(mark=>mark.mass);
  const colorStudies=focus ? [] : base.filter(mark=>!mark.mass).sort(byShape);
  const tones=[], edges=[];
  for (const [pass,marks] of [middle,fine].entries()) {
    for (const mark of marks) {
      mark.shape=shapeAt(...mark.center,mark.pigment);
      const value=.30*mark.pigment[0]+.59*mark.pigment[1]+.11*mark.pigment[2];
      mark.tone=Math.min(3,Math.floor(value/64));
      mark.pass=pass;
      (pass && (mark.edge>80 || value>222)?edges:tones).push(mark);
    }
  }
  const row=mark=>Math.floor(mark.center[1]/(34*unit));
  const local=(a,b)=>byShape(a,b)||a.tone-b.tone||a.pass-b.pass||
    row(a)-row(b)||(row(a)%2 ? b.center[0]-a.center[0] : a.center[0]-b.center[0]);
  return {areas,stages:[outline,[...foundation,...colorStudies],[...tones.sort(local),...edges.sort(local),...(type==='illustration'?[]:accents)]],accents:type==='illustration'?accents:[]};
}

export function measure(mark) {
  const arc=[0];
  for (let i=1;i<mark.points.length;i++) {
    const [x,y]=mark.points[i], [px,py]=mark.points[i-1];
    arc.push(arc[i-1]+Math.hypot(x-px,y-py));
  }
  mark.arc=arc;
  return arc.at(-1);
}

export function position(mark, fraction) {
  const {points,arc}=mark;
  if (fraction>=1) return points.length-1;
  if (fraction<=0 || !arc.at(-1)) return 0;
  const distance=arc.at(-1)*fraction;
  let low=0, high=arc.length-1;
  while (high-low>1) {
    const middle=(low+high)>>1;
    if (arc[middle]<=distance) low=middle;
    else high=middle;
  }
  return low+(distance-arc[low])/(arc[high]-arc[low]);
}

export function stroke(ctx, mark, fraction = 1, opacityScale = 1) {
  if (mark.clip || mark.zone) ctx.save();
  if (mark.zone) {
    ctx.beginPath();
    ctx.ellipse(...mark.zone,0,0,Math.PI*2);
    ctx.clip();
  }
  if (mark.clip) {
    if (!clipPaths.has(mark.clip)) clipPaths.set(mark.clip,new Path2D(mark.clip.path));
    ctx.clip(clipPaths.get(mark.clip),'evenodd');
  }
  const {points,width,color,opacity} = mark;
  const distance = position(mark,fraction);
  ctx.globalAlpha = opacity*opacityScale;
  ctx.lineWidth = width;
  let pigment=color;
  if (mark.clip && !mark.solid) {
    pigment=ctx.createLinearGradient(...points[0],...points.at(-1));
    pigment.addColorStop(0,color.replace('rgb(','rgba(').replace(')',',.36)'));
    pigment.addColorStop(.21,color);
    pigment.addColorStop(.75,color);
    pigment.addColorStop(1,color.replace('rgb(','rgba(').replace(')',',.42)'));
  } else if (mark.paintColors) {
    pigment=ctx.createLinearGradient(...points[0],...points.at(-1));
    mark.paintColors.forEach((value,i)=>pigment.addColorStop(i/(mark.paintColors.length-1),value));
  }
  ctx.fillStyle = ctx.strokeStyle = pigment;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  if (mark.soft) {
    ctx.moveTo(...points[0]);
    for (let i=1;i<=Math.ceil(distance);i++) {
      const t=Math.min(1,distance-i+1);
      const [x,y]=points[i-1];
      ctx.lineTo(x+(points[i][0]-x)*t,y+(points[i][1]-y)*t);
    }
    ctx.globalAlpha=opacity*opacityScale*.28;
    ctx.stroke();
    ctx.lineWidth=width*.62;
    ctx.globalAlpha=opacity*opacityScale*.63;
    ctx.stroke();
  } else if (mark.pressure!==undefined && points.length>1) {
    // Build a single pencil silhouette so overlapping segments keep their translucency.
    const left = [], right = [];
    for (let i=0; i<=Math.ceil(distance); i++) {
      const step = Math.max(0,Math.min(i-1,points.length-2));
      const a = points[step], b = points[step+1];
      const t = Math.max(0,Math.min(1,Math.min(i,distance)-step));
      const [x,y] = [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      const before = points[Math.max(0,i-2)], after = points[Math.min(points.length-1,i+1)];
      const heading = Math.atan2(after[1]-before[1],after[0]-before[0])+Math.PI/2;
      const u = Math.min(i,distance)/(points.length-1);
      const contact=mark.clip?.55:mark.paintColors?.48:.20;
      const radius = width*.5*(contact+(1-contact)*Math.pow(Math.sin(Math.PI*u),.52))*
        (.83+.17*Math.sin(i*.49+mark.pressure*6));
      const dx = Math.cos(heading)*radius, dy = Math.sin(heading)*radius;
      left.push([x+dx,y+dy]);
      right.push([x-dx,y-dy]);
    }
    ctx.moveTo(...left[0]);
    for (const point of left) ctx.lineTo(...point);
    for (const point of right.reverse()) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fill();
  } else if (points.length===1) {
    ctx.arc(...points[0],width*.5*Math.sqrt(fraction),0,Math.PI*2);
    ctx.fill();
  } else {
    ctx.moveTo(...points[0]);
    for (let i=1; i<=Math.ceil(distance); i++) {
      const t = Math.min(1,distance-i+1);
      const [x,y] = points[i-1];
      ctx.lineTo(x+(points[i][0]-x)*t,y+(points[i][1]-y)*t);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (mark.clip || mark.zone) ctx.restore();
}
