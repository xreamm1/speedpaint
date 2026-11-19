import {whiteRibbons,ribbonGround} from './geometry.mjs?v=ribbon';
import {classify,typeNames} from './classify.mjs?v=adaptive';
import {paper,plan,stroke} from './paint.mjs?v=ribbon';
import {finishPlan} from './finish.mjs?v=ribbon';

import {correctionPaths} from './restore.mjs?v=continuous';

self.onmessage = async ({data:{bitmap,brush,detail,focus,exact,quality,requested,geometry}}) => {
  const report = (label,value) => self.postMessage({label,value});
  const deadline = performance.now()+20000;
  try {
    const reference = new OffscreenCanvas(bitmap.width,bitmap.height);
    reference.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0);
    bitmap.close();
    report('Определяю тип изображения',6);
    const classification = await classify(reference,requested,report);
    const {type} = classification;
    const typeName = typeNames[type];
    focus ??= classification.focus;
    const {stages,areas,accents = []} = plan(reference,brush,detail,focus,report,type);
    report('Рендерю пробный рисунок',72);
    const proof = new OffscreenCanvas(reference.width,reference.height);
    const ctx = proof.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.fillStyle = paper;
    ctx.fillRect(0,0,proof.width,proof.height);
    if (!areas) {
      let corrections = null;
      if (exact) {
        for (const marks of stages) for (const mark of marks) stroke(ctx,mark);
        corrections = correctionPaths(ctx.getImageData(0,0,proof.width,proof.height),
          reference.getContext('2d').getImageData(0,0,proof.width,proof.height));
      }
      self.postMessage({stages,corrections,type,typeName});
      return;
    }
    const {regions,labels,cols,step} = areas;
    const {width,height} = proof;
    const source = reference.getContext('2d').getImageData(0,0,width,height);
    const photographic = type==='photo' || type==='portrait';
    for (const mark of stages[0]) stroke(ctx,mark);
    const coverage = new OffscreenCanvas(proof.width,proof.height).getContext('2d',{willReadFrequently:true});
    function baseStroke(mark) {
      stroke(ctx,mark);
      stroke(coverage,mark);
    }
    for (const mark of stages[1]) baseStroke(mark);
    report('Проверяю подмалёвок',73);
    for (let pass=0;pass<3 && (pass===0 || performance.now()<deadline);pass++) {
      let repaired=0;
      const {data}=coverage.getImageData(0,0,proof.width,proof.height);
      for (const area of regions) {
        const gaps = new Set(area.region.filter(cell=>{
          const x=Math.min(proof.width-1,Math.floor((cell%cols+.5)*step));
          const y=Math.min(proof.height-1,Math.floor((Math.floor(cell/cols)+.5)*step));
          return data[4*(y*proof.width+x)+3]<187;
        }));
        while (gaps.size) {
          const firstGap=gaps.values().next().value;
          const connected=[firstGap];
          gaps.delete(firstGap);
          for (const cell of connected) {
            const x=cell%cols;
            for (const next of [x?cell-1:-1,x<cols-1?cell+1:-1,cell-cols,cell+cols]) {
              if (gaps.delete(next)) connected.push(next);
            }
          }
          paintGap(connected.sort((a,b)=>a-b),area);
        }
      }
      if (!repaired) break;
      function paintGap(gaps,area) {
        let minX=cols,maxX=0;
        const rows=Math.ceil(height/step);
        for (const cell of gaps) {
          minX=Math.min(minX,cell%cols);
          maxX=Math.max(maxX,cell%cols);
        }
        const vertical=Math.floor(gaps.at(-1)/cols)-Math.floor(gaps[0]/cols)>maxX-minX;
        const stride=vertical?rows:cols;
        const runs=vertical ? gaps.map(cell=>(cell%cols)*rows+Math.floor(cell/cols)).sort((a,b)=>a-b) : gaps;
        for (let i=0;i<runs.length;) {
          const first=runs[i++];
          const row=Math.floor(first/stride);
          while (i<runs.length && runs[i]===runs[i-1]+1 && Math.floor(runs[i]/stride)===row) i++;
          const left=(first%stride)*step, right=(runs[i-1]%stride+1)*step;
          const y=(row+.5)*step;
          const point=(along,across)=>vertical?[across,along]:[along,across];
          const [cx,cy]=point((left+right)/2,y);
          const px=Math.min(width-1,Math.floor(cx)), py=Math.min(height-1,Math.floor(cy));
          const sample=(py*width+px)*4;
          const color='rgb('+source.data.subarray(sample,sample+3).join(',')+')';
          const mark={clip:area.clip,color,solid:true,points:[point(left-step,y),point(right+step,y)],
            width:step*2.1,opacity:.98,pressure:.16};
          baseStroke(mark);
          stages[1].push(mark);
          repaired++;
        }
      }
    }
    coverage.canvas.width=1;
    for (const mark of stages[2]) stroke(ctx,mark);
    function difference(snapshot, zone) {
      const [cx,cy,rx,ry] = zone || [0,0,1,1];
      const errors = new Float64Array(regions.length+1);
      const lines = new Float64Array(regions.length+1);
      for (let y=0;y<height;y++) {
        const row = Math.floor(y/step)*cols;
        for (let x=0;x<width;x++) {
          if (zone && ((x-cx)/rx)**2+((y-cy)/ry)**2>1) continue;
          const i = (y*width+x)*4;
          const left = x ? i-4 : i;
          const top = y ? i-width*4 : i;
          let colorError=0, edgeError=0;
          for (let channel=0;channel<3;channel++) {
            const delta=source.data[i+channel]-snapshot.data[i+channel];
            colorError+=Math.abs(delta);
            const horizontal=source.data[i+channel]-source.data[left+channel];
            const vertical=source.data[i+channel]-source.data[top+channel];
            if (Math.abs(horizontal)>22) edgeError+=Math.abs(horizontal-snapshot.data[i+channel]+snapshot.data[left+channel]);
            if (Math.abs(vertical)>22) edgeError+=Math.abs(vertical-snapshot.data[i+channel]+snapshot.data[top+channel]);
          }
          const area=labels[row+Math.floor(x/step)];
          errors[area] += colorError+edgeError*.45;
          lines[area] += edgeError;
        }
      }
      return {errors,lines};
    }
    let best = ctx.getImageData(0,0,width,height);
    function locateEye(cx,cy,scale) {
      const luma=(x,y)=>{
        const i=(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4;
        return .299*source.data[i]+.587*source.data[i+1]+.114*source.data[i+2];
      };
      const spacing=Math.max(1,Math.round(scale*.045));
      let bestX=cx,bestY=cy,bestScore=0;
      for (let y=Math.max(0,Math.round(cy-scale*.39));y<Math.min(height,cy+scale*.32);y+=spacing) {
        for (let x=Math.max(0,Math.round(cx-scale*.28));x<Math.min(width,cx+scale*.28);x+=spacing) {
          let ridge=0, eyesWhite=0;
          for (const offset of [-2,-1,0,1,2]) {
            const px=x+offset*spacing;
            const lid=luma(px,y);
            ridge+=Math.max(0,(luma(px,y-spacing)+luma(px,y+spacing*2))/2-lid);
            eyesWhite+=Math.max(0,luma(px,y+spacing*2)-lid);
          }
          const distance=Math.hypot((x-cx)/scale,(y-cy)/scale);
          const score=(ridge*.65+eyesWhite*.35)/(1+distance*2);
          if (score>bestScore) {bestX=x;bestY=y;bestScore=score;}
        }
      }
      return [bestX,bestY+spacing,scale*.36,scale*.19];
    }
    const refinements = [];
    function refine(mode, zone) {
      const before = difference(best,zone);
      const marks = finishPlan(ctx,reference,detail,mode,areas,Boolean(focus),zone,photographic);
      if (!marks.length) return 0;
      for (const mark of marks) stroke(ctx,mark);
      const candidate = ctx.getImageData(0,0,width,height);
      const after = difference(candidate,zone);
      const accepted = marks.filter(mark=>after.errors[mark.area]<before.errors[mark.area] &&
        after.lines[mark.area]<=before.lines[mark.area]*1.002);
      if (accepted.length!==marks.length) {
        ctx.putImageData(best,0,0);
        for (const mark of accepted) stroke(ctx,mark);
      }
      const trial = ctx.getImageData(0,0,width,height);
      const measured = difference(trial,zone);
      const previous = before.errors.reduce((sum,error)=>sum+error,0);
      const residual = measured.errors.reduce((sum,error)=>sum+error,0);
      const damaged = measured.lines.some((error,area)=>error > before.lines[area]*1.01+16);
      if (residual >= previous || damaged) {
        ctx.putImageData(best,0,0);
        return 0;
      }
      best = trial;
      refinements.push(...accepted);
      return (previous-residual)/previous;
    }
    const portrait = focus && (type==='portrait' || quality && requested==='auto' && type==='photo');
    const modes = ['shadow','edge','light'];
    for (const [pass,mode] of modes.entries()) {
      report(`Уточняю детали · ${pass+1}/${modes.length}`,78+pass*3);
      refine(mode);
    }
    if (!portrait && focus && performance.now()<deadline) {
      report('Уточняю мелкие линии в выбранной области',92);
      const radius=Math.min(width,height)*.14;
      refine('feature',[focus[0]*width,focus[1]*height,radius,radius]);
    }
    let eyes = [], faceLines = [];
    if (portrait) {
      // The click is the bridge of the nose. These are attention windows, not landmark detections.
      const [x,y]=[focus[0]*width,focus[1]*height];
      const scale=classification.radius ? classification.radius*width : Math.min(width,height)*.13;
      const face=[x,y+scale*.43,scale,scale*1.32];
      eyes=[-1,1].map(side=>locateEye(x+side*scale*.46,y-scale*.10,scale));
      const nose=[x,y+scale*.28,scale*.33,scale*.48];
      const lips=[x,y+scale*.91,scale*.57,scale*.28];
      faceLines=[nose,lips];
      const hairLeft=[x-scale*1.15,y-scale*.28,scale*.65,scale*1.5];
      const hairRight=[x+scale*1.15,y-scale*.28,scale*.65,scale*1.5];
      const hairTop=[x,y-scale*1.10,scale*1.18,scale*.64];
      const groups = [
        ['Уточняю лицо',[['shadow',face],['light',face]]],
        ['Уточняю нос и губы',[['shadow',nose],['light',lips]]],
        ['Дорабатываю волосы',[['shadow',hairLeft],['shadow',hairRight],['hair',hairTop],['hair',hairLeft],['hair',hairRight]]]
      ];
      for (const [i,[label,passes]] of groups.entries()) {
        report(label,88+i*3);
        let weak=0;
        for (let round=0;round<(quality ? 5 : 2) && weak<2 && performance.now()<deadline-3000;round++) {
          let gain=0;
          for (const [mode,zone] of passes) {
            if (performance.now()>=deadline) break;
            gain += refine(mode,zone);
          }
          weak = gain<.004 ? weak+1 : 0;
        }
      }
      if (performance.now()<deadline) refine('texture',face);
    }
    if (performance.now()<deadline) refine('spark');
    if (!portrait && performance.now()<deadline) refine('texture');
    if (quality && performance.now()<(eyes.length ? deadline-3000 : deadline)) {
      const tile = Math.max(16,Math.round(Math.min(width,height)/7));
      const weak = new Set();
      report('Исправляю самые заметные расхождения',97);
      for (let attempt=0;attempt<6 && performance.now()<(eyes.length ? deadline-3000 : deadline);attempt++) {
        let worst, worstError=0;
        for (let y=0;y<height;y+=tile) for (let x=0;x<width;x+=tile) {
          if (weak.has(y*width+x)) continue;
          let error=0, count=0;
          for (let py=y+1;py<Math.min(height,y+tile);py+=3) {
            for (let px=x+1;px<Math.min(width,x+tile);px+=3) {
              const i=(py*width+px)*4;
              const edge=Math.abs(source.data[i]-source.data[i-4])+Math.abs(source.data[i]-source.data[i-width*4]);
              const delta=Math.abs(source.data[i]-best.data[i])+Math.abs(source.data[i+1]-best.data[i+1])
                +Math.abs(source.data[i+2]-best.data[i+2]);
              error += delta*(1+Math.min(2,edge/40));
              count++;
            }
          }
          if (count && error/count>worstError) {worst=[x,y];worstError=error/count;}
        }
        if (!worst || worstError<14) break;
        const [x,y]=worst;
        const zone=[x+tile/2,y+tile/2,tile*.71,tile*.71];
        let gain=0;
        for (const mode of ['edge','shadow','light','texture']) {
          if (performance.now()>=deadline) break;
          gain+=refine(mode,zone);
        }
        if (gain<.004) weak.add(y*width+x);
      }
    }
    if (!eyes.length && photographic && performance.now()<deadline) refine('feature');
    if (eyes.length) {
      report('Прорисовываю веки, радужки и блики',98);
      for (const zone of faceLines) if (performance.now()<deadline) refine('feature',zone);
      for (const mode of ['shadow','feature','iris','eye-glint']) {
        for (const eye of eyes) {
          if (performance.now()<deadline) refine(mode,eye);
        }
      }
    }
    for (const mark of accents) stroke(ctx,mark);
    if (accents.length) best = ctx.getImageData(0,0,width,height);
    const ribbons=geometry && type==='illustration' ? whiteRibbons(source) : [];
    const grounds=[];
    for (const ribbon of ribbons.filter(mark=>mark.points.length>49).slice(0,8)) {
      const mark=ribbonGround(source,ribbon);
      if (!mark) continue;
      const {x,y,w,h}=mark.ground;
      const prior=ctx.getImageData(x,y,w,h);
      stroke(ctx,mark);
      const candidate=ctx.getImageData(x,y,w,h);
      let before=0,after=0;
      for (let py=0;py<h;py++) for (let px=0;px<w;px++) {
        const src=((y+py)*width+x+px)*4, dst=(py*w+px)*4;
        for (let k=0;k<3;k++) {
          before+=Math.abs(source.data[src+k]-prior.data[dst+k]);
          after+=Math.abs(source.data[src+k]-candidate.data[dst+k]);
        }
      }
      if (after<before*.99) grounds.push(mark);
      else ctx.putImageData(prior,x,y);
    }
    for (const mark of ribbons) stroke(ctx,mark);
    if (ribbons.length) best = ctx.getImageData(0,0,width,height);
    stages.push([...refinements,...accents,...grounds,...ribbons]);
    if (exact) report('Прокладываю финальные уточнения вдоль контуров',98);
    const tail = (stages[3].at(-1) || stages[2].at(-1))?.points.at(-1);
    const corrections = exact ? correctionPaths(best,source,tail) : null;
    self.postMessage({stages,corrections,type,typeName});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
