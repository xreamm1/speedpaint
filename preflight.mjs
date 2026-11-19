import {classify,typeNames} from './classify.mjs?v=adaptive';
import {paper,plan,stroke} from './paint.mjs?v=adaptive';
import {finishPlan} from './finish.mjs?v=adaptive';

import {correctionPaths} from './restore.mjs?v=continuous';

self.onmessage = async ({data:{bitmap,brush,detail,focus,exact,quality,requested}}) => {
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
    const {stages,areas} = plan(reference,brush,detail,focus,report,type);
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
    const photographic = type==='photo' || type==='portrait';
    for (const mark of stages[0]) stroke(ctx,mark);
    const coverage = new OffscreenCanvas(proof.width,proof.height).getContext('2d',{willReadFrequently:true});
    function baseStroke(mark) {
      stroke(ctx,mark);
      stroke(coverage,mark);
    }
    for (const mark of stages[1]) baseStroke(mark);
    report('Проверяю подмалёвок',73);
    for (let pass=0;pass<2;pass++) {
      const {data}=coverage.getImageData(0,0,proof.width,proof.height);
      for (const area of regions) {
        const gaps = area.region.filter(cell=>{
          const x=Math.min(proof.width-1,Math.floor((cell%cols+.5)*step));
          const y=Math.min(proof.height-1,Math.floor((Math.floor(cell/cols)+.5)*step));
          return data[4*(y*proof.width+x)+3]<110;
        }).sort((a,b)=>a-b);
        for (let i=0;i<gaps.length;) {
          const first=gaps[i++];
          const row=Math.floor(first/cols);
          while (i<gaps.length && gaps[i]===gaps[i-1]+1 && Math.floor(gaps[i]/cols)===row) i++;
          const left=(first%cols)*step, right=(gaps[i-1]%cols+1)*step;
          const y=(row+.5)*step;
          const mark={clip:area.clip,color:area.color,points:[[left-step,y],[right+step,y]],width:step*1.9,opacity:.94,pressure:.16};
          baseStroke(mark);
          stages[1].push(mark);
        }
      }
    }
    coverage.canvas.width=1;
    for (const mark of stages[2]) stroke(ctx,mark);
    const {width,height} = proof;
    const source = reference.getContext('2d').getImageData(0,0,width,height);
    function difference(snapshot, zone) {
      const [cx,cy,rx,ry] = zone || [0,0,1,1];
      const errors = new Float64Array(regions.length+1);
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
            edgeError+=Math.abs(delta-source.data[left+channel]+snapshot.data[left+channel])
              +Math.abs(delta-source.data[top+channel]+snapshot.data[top+channel]);
          }
          errors[labels[row+Math.floor(x/step)]] += colorError+edgeError*.45;
        }
      }
      return errors;
    }
    let best = ctx.getImageData(0,0,width,height);
    const refinements = [];
    function refine(mode, zone) {
      const errors = difference(best,zone);
      const marks = finishPlan(ctx,reference,detail,mode,areas,Boolean(focus),zone,photographic);
      if (!marks.length) return 0;
      for (const mark of marks) stroke(ctx,mark);
      const candidate = ctx.getImageData(0,0,width,height);
      const nextErrors = difference(candidate,zone);
      const accepted = marks.filter(mark=>nextErrors[mark.area]<errors[mark.area]);
      if (accepted.length!==marks.length) {
        ctx.putImageData(best,0,0);
        for (const mark of accepted) stroke(ctx,mark);
      }
      const trial = ctx.getImageData(0,0,width,height);
      const measured = difference(trial,zone);
      const previous = errors.reduce((sum,error)=>sum+error,0);
      const residual = measured.reduce((sum,error)=>sum+error,0);
      if (residual >= previous) {
        ctx.putImageData(best,0,0);
        return 0;
      }
      best = trial;
      refinements.push(...accepted);
      return (previous-residual)/previous;
    }
    const portrait = focus && (type==='portrait' || quality && requested==='auto' && type==='photo');
    const modes = portrait ? ['edge','shadow','light'] : ['edge','shadow','light','texture'];
    for (const [pass,mode] of modes.entries()) {
      report(`Уточняю детали · ${pass+1}/${modes.length}`,78+pass*3);
      refine(mode);
    }
    if (portrait) {
      // The click is the bridge of the nose. These are attention windows, not landmark detections.
      const [x,y]=[focus[0]*width,focus[1]*height];
      const scale=classification.radius ? classification.radius*width : Math.min(width,height)*.13;
      const face=[x,y+scale*.43,scale,scale*1.32];
      const eyes=[x,y-scale*.10,scale*.92,scale*.25];
      const nose=[x,y+scale*.28,scale*.33,scale*.48];
      const lips=[x,y+scale*.91,scale*.57,scale*.28];
      const hairLeft=[x-scale*1.15,y-scale*.28,scale*.65,scale*1.5];
      const hairRight=[x+scale*1.15,y-scale*.28,scale*.65,scale*1.5];
      const hairTop=[x,y-scale*1.10,scale*1.18,scale*.64];
      const groups = [
        ['Уточняю лицо',[['shadow',face],['light',face]]],
        ['Уточняю глаза, нос и губы',[['edge',eyes],['light',eyes],['shadow',nose],['edge',lips]]],
        ['Дорабатываю волосы',[['shadow',hairLeft],['shadow',hairRight],['hair',hairTop],['hair',hairLeft],['hair',hairRight]]]
      ];
      for (const [i,[label,passes]] of groups.entries()) {
        report(label,88+i*3);
        let weak=0;
        for (let round=0;round<(quality ? 5 : 2) && weak<2 && performance.now()<deadline;round++) {
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
    if (quality && performance.now()<deadline) {
      const tile = Math.max(16,Math.round(Math.min(width,height)/7));
      const weak = new Set();
      report('Исправляю самые заметные расхождения',97);
      for (let attempt=0;attempt<6 && performance.now()<deadline;attempt++) {
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
    stages.push(refinements);
    if (exact) report('Прокладываю финальные уточнения вдоль контуров',98);
    const tail = (stages[3].at(-1) || stages[2].at(-1))?.points.at(-1);
    const corrections = exact ? correctionPaths(best,source,tail) : null;
    self.postMessage({stages,corrections,type,typeName});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
