// Render stills at given composition seconds, reusing one browser.
// Usage: node scripts/stills.mjs <outDir> <scale> <sec> [<sec> ...]
// Env: BROWSER=/path/to/chrome (optional), GL=swangle|angle (default swangle)
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, scaleArg, ...secs] = process.argv.slice(2);
if (!outDir || !secs.length) {
  console.error('usage: node scripts/stills.mjs <outDir> <scale> <sec> [...]');
  process.exit(1);
}
fs.mkdirSync(outDir, {recursive: true});
const scale = Number(scaleArg) || 0.5;
// secs are on the code's T clock; the video starts at T = SKIP (src/config.ts)
const skipM = fs.readFileSync('src/config.ts', 'utf8').match(/export const SKIP = ([\d.]+)(?: \/ ([\d.]+))?/);
const SKIP = skipM ? Number(skipM[1]) / Number(skipM[2] || 1) : 0;
const gl = process.env.GL || 'swangle';
const browserExecutable = process.env.BROWSER || null;

const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const browser = await openBrowser('chrome', {browserExecutable, chromiumOptions: {gl}});
const composition = await selectComposition({serveUrl, id: 'SignB', puppeteerInstance: browser, browserExecutable, chromiumOptions: {gl}});
for (const s of secs) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round((Number(s) - SKIP) * composition.fps));
  const file = path.join(outDir, `t${Number(s).toFixed(2).padStart(7, '0')}.png`);
  await renderStill({composition, serveUrl, output: file, frame, scale, puppeteerInstance: browser, browserExecutable, chromiumOptions: {gl}});
  console.log(`[still] ${s}s -> ${file}`);
}
await browser.close({silent: true});
// the bundle is a 250 MB temporary folder: remove it (many runs filled the disk once)
try {
  fs.rmSync(serveUrl, {recursive: true, force: true});
} catch {}
