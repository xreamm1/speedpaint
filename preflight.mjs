import {paper,plan,stroke} from './paint.mjs?v=portrait';
import {finishPlan} from './finish.mjs?v=portrait';

import {correctionPaths} from './restore.mjs?v=continuous';

self.onmessage = ({data:{bitmap,brush,detail,focus,exact,quality}}) => {
  const report = (label,value) => self.postMessage({label,value});
  const deadline = performance.now()+20000;
  try {
    const reference = new OffscreenCanvas(bitmap.width,bitmap.height);
    reference.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0);
    bitmap.close();
    const {stages,areas} = plan(reference,brush,detail,focus,report);
    const {regions,labels,cols,step} = areas;
    report('Рендерю пробный рисунок',72);
    const proof = new OffscreenCanvas(reference.width,reference.height);
    const ctx = proof.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.fillStyle = paper;
    ctx.fillRect(0,0,proof.width,proof.height);
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
          errors[labels[row+Math.floor(x/step)]] += Math.abs(source.data[i]-snapshot.data[i])
            + Math.abs(source.data[i+1]-snapshot.data[i+1])
            + Math.abs(source.data[i+2]-snapshot.data[i+2]);
        }
      }
      return errors;
    }
    let best = ctx.getImageData(0,0,width,height);
    const refinements = [];
    function refine(mode, zone) {
      const errors = difference(best,zone);
      const marks = finishPlan(ctx,reference,detail,mode,areas,Boolean(focus),zone);
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
    const portrait = quality && focus;
    const modes = portrait ? ['edge','shadow','light'] : ['edge','shadow','light','texture'];
    for (const [pass,mode] of modes.entries()) {
      report(`Уточняю детали · ${pass+1}/${modes.length}`,78+pass*3);
      refine(mode);
    }
    if (portrait) {
      // The click is the bridge of the nose. These are attention windows, not landmark detections.
      const [x,y]=[focus[0]*width,focus[1]*height];
      const scale=Math.min(width,height)*.13;
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
        for (let round=0;round<5 && weak<2 && performance.now()<deadline;round++) {
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
    stages.push(refinements);
    if (exact) report('Прокладываю финальные уточнения вдоль контуров',98);
    const tail = (stages[3].at(-1) || stages[2].at(-1))?.points.at(-1);
    const corrections = exact ? correctionPaths(best,source,tail) : null;
    self.postMessage({stages,corrections});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
