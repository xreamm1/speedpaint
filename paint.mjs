export const paper = '#eee7da';

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
    for (let y=1; y<h-1; y++) {
      for (let x=1; x<w-1; x++) {
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
    return gestures;
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
          score:Math.sin(group*192.27)*.44 + random()*.47 + (fine?strength[i]/1500:0)});
      }
    }
    return marks.sort((a,b)=>b.score-a.score);
  }

  const outline = sketch(gradient(pixels(Math.max(.65,unit))));
  const scale = brush/100*unit;
  const base = paint(Math.max(4,46*scale),Math.max(1,7*scale),.99,false);
  const middle = paint(Math.max(3,22*scale),Math.max(.7,3.5*scale),.88,false);
  const fine = paint(Math.max(2.6,(13-detail*.088)*scale),Math.max(.35,1.45*scale),.82,true);
  const accents = outline.slice(0,Math.round(detail/3)).map(mark=>({...mark, opacity:mark.opacity*.36}));
  return [outline,base,[...middle,...fine,...accents]];
}

export function stroke(ctx, mark, fraction = 1) {
  const {points,width,color,opacity} = mark;
  const distance = (points.length-1)*fraction;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = width;
  ctx.fillStyle = ctx.strokeStyle = color;
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
      const radius = width*.5*(.20+.80*Math.pow(Math.sin(Math.PI*u),.52))*
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
}
