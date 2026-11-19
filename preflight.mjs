import {paper,plan,stroke} from './paint.mjs?v=preflight';
import {finishPlan} from './finish.mjs?v=preflight';

self.onmessage = ({data:{bitmap,brush,detail,focus}}) => {
  const report = (label,value) => self.postMessage({label,value});
  try {
    const reference = new OffscreenCanvas(bitmap.width,bitmap.height);
    reference.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0);
    bitmap.close();
    const stages = plan(reference,brush,detail,focus,report);
    report('Рендерю пробный рисунок',72);
    const proof = new OffscreenCanvas(reference.width,reference.height);
    const ctx = proof.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.fillStyle = paper;
    ctx.fillRect(0,0,proof.width,proof.height);
    for (const marks of stages) for (const mark of marks) stroke(ctx,mark);
    report('Уточняю края, тени и блики',92);
    stages.push(finishPlan(ctx,reference,detail));
    self.postMessage({stages});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
