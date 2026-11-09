// Render helper. Usage (from the project folder):
//   node scripts/render.mjs full                 -> out/signb.mp4
//   node scripts/render.mjs preview              -> out/signb_preview.mp4 (half size)
//   node scripts/render.mjs range 52 63          -> out/range_52-63.mp4 (seconds)
//   node scripts/render.mjs still 64.5           -> out/still_64.5.png
// Extra arguments are passed to Remotion, e.g. --gl=swangle if the picture is black.
import {spawnSync} from 'node:child_process';

const FPS = 30;
const [mode, ...rest] = process.argv.slice(2);
const extra = rest.filter((a) => a.startsWith('--'));
const nums = rest.filter((a) => !a.startsWith('--')).map(Number);
const base = ['remotion'];
let args;
if (mode === 'full') args = [...base, 'render', 'src/index.ts', 'SignB', 'out/signb.mp4'];
else if (mode === 'preview') args = [...base, 'render', 'src/index.ts', 'SignB', 'out/signb_preview.mp4', '--scale=0.5'];
else if (mode === 'range' && nums.length === 2)
  args = [...base, 'render', 'src/index.ts', 'SignB', `out/range_${nums[0]}-${nums[1]}.mp4`, `--frames=${Math.round(nums[0] * FPS)}-${Math.round(nums[1] * FPS)}`];
else if (mode === 'still' && nums.length === 1)
  args = [...base, 'still', 'src/index.ts', 'SignB', `out/still_${nums[0]}.png`, `--frame=${Math.round(nums[0] * FPS)}`];
else {
  console.log('usage: node scripts/render.mjs full | preview | range <from s> <to s> | still <s>  [--remotion-flags]');
  process.exit(1);
}
console.log('> npx', [...args, ...extra].join(' '));
const r = spawnSync('npx', [...args, ...extra], {stdio: 'inherit', shell: process.platform === 'win32'});
process.exit(r.status ?? 1);
