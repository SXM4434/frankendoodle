// Calibration sweep for fillRegionAt on a DONUT (inner disk + outer ring) — find
// (inkRadius, gapClosePx) that fill BOTH inner and outer, closed AND gapped.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const r = await build({ entryPoints:[join(__dirname,'regionFill.ts')], bundle:true, format:'esm', platform:'node', write:false, logLevel:'silent' });
const mod = await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
const { fillRegionAt } = mod;

function circle(cx,cy,rad,n=64,gapFrac=0){ // gapFrac>0 removes a fraction of the arc (open)
  const pts=[]; const skip=Math.floor(n*gapFrac);
  for(let i=0;i<=n-skip;i++){ const a=(i/n)*Math.PI*2; pts.push([cx+rad*Math.cos(a), cy+rad*Math.sin(a)]); }
  return pts;
}
const W = (d)=>{ if(!d||!d.outline||d.outline.length<3) return 0; let x0=1e9,x1=-1e9; for(const [x] of d.outline){if(x<x0)x0=x;if(x>x1)x1=x;} return +(x1-x0).toFixed(2); };

// donut in ~world coords: big r3, small r1.2, centered (0,0)
const closed = [circle(0,0,3,64,0), circle(0,0,1.2,40,0)];
const gapped = [circle(0,0,3,64,0.04), circle(0,0,1.2,40,0.04)]; // ~4% open arcs (freehand-ish)
const innerSeed=[0,0], outerSeed=[0,2.1]; // ring point between 1.2 and 3

console.log('inkR  gapPx | closed[in,out]  gapped[in,out]   (want all 4 > 0; in~2.4 out~6)');
for (const inkR of [0.02,0.05,0.08]) {
  for (const gapPx of [0.05,0.1,0.2,0.4,0.8,1.5]) {
    const o = { inkRadius:inkR, resolution:400, maxResolution:400, gapClosePx:gapPx };
    const ci = W(fillRegionAt(closed, ...innerSeed, o));
    const co = W(fillRegionAt(closed, ...outerSeed, o));
    const gi = W(fillRegionAt(gapped, ...innerSeed, o));
    const go = W(fillRegionAt(gapped, ...outerSeed, o));
    const ok = ci>0&&co>0&&gi>0&&go>0;
    console.log(`${inkR.toFixed(2)}  ${gapPx.toString().padEnd(4)} | [${ci},${co}]  [${gi},${go}] ${ok?'  <== ALL FILL':''}`);
  }
}
