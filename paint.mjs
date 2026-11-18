export const paper = '#eee7da';

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
  const path=new Path2D();
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
    path.moveTo(...near(points[0],points.at(-1)));
    for(let i=0;i<points.length;i++) {
      const [x,y]=points[i];
      if(i) path.lineTo(...near(points[i],points[i-1]));
      path.quadraticCurveTo(x*step,y*step,...near(points[i],points[(i+1)%points.length]));
    }
    path.closePath();
  }
  return path;
}

export function plan(source, brush, detail) {
  const {width: w, height: h} = source;
  const sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
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

  function gradient(rgb) {
    const size = w*h;
    const gray = new Float32Array(size);
    const angle = new Float32Array(size);
    const strength = new Float32Array(size);
    for (let i=0; i<size; i++) gray[i] = .299*rgb[4*i]+.587*rgb[4*i+1]+.114*rgb[4*i+2];
    const margin = Math.min(4,Math.max(1,Math.floor(Math.min(w,h)/8)));
    for (let y=margin; y<h-margin; y++) {
      for (let x=margin; x<w-margin; x++) {
        const i = y*w+x;
        const dx = gray[i-w+1]+2*gray[i+1]+gray[i+w+1]-gray[i-w-1]-2*gray[i-1]-gray[i+w-1];
        const dy = gray[i+w-1]+2*gray[i+w]+gray[i+w+1]-gray[i-w-1]-2*gray[i-w]-gray[i-w+1];
        angle[i] = Math.atan2(dy,dx);
        strength[i] = Math.hypot(dx,dy);
      }
    }
    return {angle,strength};
  }
  function sketch({angle,strength}) {
    const edges = new Uint8Array(w*h);
    const starts = [];
    const floor = 85 - detail*.4;
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
        color:'#514740', opacity:.34+random()*.38, pressure:random(), pace:.7+random()*.65});
    }
    marks.sort((a,b)=>b.length-a.length);
    const candidates = marks.slice(0,24+Math.round(detail*.53));
    const gestures = [];
    const distance = (a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    let hand;
    while (candidates.length) {
      let best = Infinity;
      let selected = 0;
      let reverse = false;
      for (let i=0; hand && i<candidates.length; i++) {
        const {points,length} = candidates[i];
        const first = distance(hand,points[0]);
        const last = distance(hand,points.at(-1));
        const score = Math.min(first,last)-length*.48;
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
    const construction = marks.slice(0,17).map(mark=>({...mark,
      points:mark.points.filter((_,i)=>i%4===0).map(([x,y],i)=>[
        x+Math.sin(i*.25)*unit*1.5,y+Math.cos(i*.29)*unit*1.5]),
      opacity:.13,width:mark.width*.85,pace:.55
    })).filter(mark=>mark.points.length>1);
    return [...construction,...gestures];
  }

  function flats() {
    const step = Math.max(1,Math.ceil(Math.max(w,h)/360));
    const cols = Math.ceil(w/step), rows = Math.ceil(h/step);
    const rgb = pixels(Math.max(.4,step*.42));
    const seen = new Uint8Array(cols*rows);
    const colorAt = i=>at((i%cols+.5)*step,(Math.floor(i/cols)+.5)*step)*4;
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
          if (next<0 || seen[next]) continue;
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
    const marks=regions.flatMap(({region,point,pigment,background,roundness})=>{
      const fill=smoothMask(region,cols,step);
      const color='rgb('+pigment.join(',')+')';
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
        bands.get(band).push({along,across,x,y});
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
          const bend=(random()-.5)*Math.min(width*.65,length*.24);
          const points=length<=step?[[a.x,a.y],[a.x+dx*step*.55,a.y+dy*step*.55]]:
            Array.from({length:7},(_,j)=>{
              const t=j/6, along=a.along+(b.along-a.along)*t;
              const across=a.across+(b.across-a.across)*t+offset(along)+Math.sin(Math.PI*t)*bend;
              return [along*dx-across*dy,along*dy+across*dx];
            });
          result.push({clip:fill,points,width:width*(.93+random()*.14),color,
            opacity:.68+random()*.16,pace:.8+random()*.38,pressure:.35,
            shape,mass:region.length>=seen.length*.013});
        }
        reverse=!reverse;
      }
      return result;
    });
    return {marks,shapeAt};
  }

  function paint(size, blur, opacity, fine) {
    const rgb = pixels(blur);
    const {angle,strength} = gradient(rgb);
    const spacing = Math.max(2, size*(fine?.79:.65));
    const marks = [];
    for (let y=spacing/2; y<h+spacing/2; y+=spacing) {
      for (let x=spacing/2; x<w+spacing/2; x+=spacing) {
        const px = clamp(x+(random()-.5)*spacing*.7,w);
        const py = clamp(y+(random()-.5)*spacing*.7,h);
        const i = at(px,py);
        if (fine && strength[i] < 24 && random() > detail/250) continue;
        const width = size*(.84+random()*.40);
        const bend = (random()-.5)*.55;
        const steps = 3+Math.floor(random()*4);
        const step = Math.max(.6,width*.23);
        const direction = index => strength[index]>22 ? angle[index]+Math.PI/2+bend : -.55+bend;
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
        const color = 'rgb('+rgb.slice(rgbIndex,rgbIndex+3).join(',')+')';
        const group = Math.floor(px/(spacing*5)) + Math.floor(py/(spacing*5))*Math.ceil(w/(spacing*5));
        marks.push({points,width,color,opacity:opacity*(.82+random()*.18),
          center:[px,py],pigment:[rgb[rgbIndex],rgb[rgbIndex+1],rgb[rgbIndex+2]],edge:strength[i],
          score:Math.sin(group*192.27)*.44 + random()*.47 + (fine?strength[i]/1500:0)});
      }
    }
    return marks.sort((a,b)=>b.score-a.score);
  }

  const outline = sketch(gradient(pixels(Math.max(.65,unit))));
  const scale = brush/100*unit;
  const {marks:base,shapeAt} = flats();
  const middle = paint(Math.max(2.8,15*scale),Math.max(.45,1.35*scale),.72,true);
  const fine = paint(Math.max(1.8,(9-detail*.059)*scale),Math.max(.3,.60*scale),.85,true);
  const accents = outline.slice(0,Math.round(detail/3)).map(mark=>({...mark, opacity:mark.opacity*.36}));
  const byShape=(a,b)=>a.shape-b.shape;
  const foundation=base.filter(mark=>mark.mass);
  const colorStudies=base.filter(mark=>!mark.mass).sort(byShape);
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
  const local=(a,b)=>byShape(a,b)||a.tone-b.tone||a.pass-b.pass||
    Math.floor(a.center[1]/(18*unit))-Math.floor(b.center[1]/(18*unit))||a.center[0]-b.center[0];
  return [outline,[...foundation,...colorStudies],[...tones.sort(local),...edges.sort(local),...accents]];
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

export function stroke(ctx, mark, fraction = 1) {
  if (mark.clip) {
    ctx.save();
    ctx.clip(mark.clip,'evenodd');
  }
  const {points,width,color,opacity} = mark;
  const distance = position(mark,fraction);
  ctx.globalAlpha = opacity;
  ctx.lineWidth = width;
  let pigment=color;
  if (mark.clip) {
    pigment=ctx.createLinearGradient(...points[0],...points.at(-1));
    pigment.addColorStop(0,color.replace('rgb(','rgba(').replace(')',',.36)'));
    pigment.addColorStop(.21,color);
    pigment.addColorStop(.75,color);
    pigment.addColorStop(1,color.replace('rgb(','rgba(').replace(')',',.42)'));
  }
  ctx.fillStyle = ctx.strokeStyle = pigment;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  if (mark.pressure!==undefined && points.length>1) {
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
      const contact=mark.clip?.55:.20;
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
  if (mark.clip) ctx.restore();
}
