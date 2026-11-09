// Self-check (stills only, no video):
//   node scripts/check.mjs probe <out.jsonl> [t0 t1 dt]   -> per-frame probe data
//   node scripts/check.mjs expo <out.jsonl> t0 t1 dt     -> face exposure vs source art (post included)
//   node scripts/check.mjs sheet <out.png> t0 dt n [cols] [scale]  -> contact sheet of n frames
// Env: BROWSER=/path/to/chrome (optional)
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

const [mode, out, ...rest] = process.argv.slice(2);
const browserExecutable = process.env.BROWSER || null;
const chromiumOptions = {gl: process.env.GL || 'swangle'};
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
const browser = await openBrowser('chrome', {browserExecutable, chromiumOptions});
const common = {serveUrl, puppeteerInstance: browser, browserExecutable, chromiumOptions, timeoutInMilliseconds: 1_800_000};
if (mode === 'probe') {
  const [t0, t1, dt] = rest.map(Number);
  const inputProps = {t0: t0 || 0, t1: t1 || 224.2, dt: dt || 0.1};
  const composition = await selectComposition({...common, id: 'Probe', inputProps});
  const lines = [];
  await renderStill({...common, composition, inputProps, output: '/tmp/probe.png', frame: 0, onBrowserLog: (l) => l.text.startsWith('P|') && lines.push(l.text.slice(2))});
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`[probe] ${lines.length} lines -> ${out}`);
} else if (mode === 'cams') {
  // node scripts/check.mjs cams <out.jsonl> [t0 t1]  -> per-frame camera of every active shot (no drawing)
  const [t0, t1] = rest.map(Number);
  const inputProps = {t0: t0 || 0, t1: t1 || 224.2, dt: 1 / 30, cams: true};
  const composition = await selectComposition({...common, id: 'Probe', inputProps});
  const lines = [];
  await renderStill({...common, composition, inputProps, output: '/tmp/probe.png', frame: 0, onBrowserLog: (l) => l.text.startsWith('C|') && lines.push(l.text.slice(2))});
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`[cams] ${lines.length} lines -> ${out}`);
} else if (mode === 'expo') {
  // node scripts/check.mjs expo <out.jsonl> t0 t1 dt  -> face exposure (final image vs source art)
  const [t0, t1, dt] = rest.map(Number);
  const times = [];
  for (let T = t0; T < t1; T += dt) times.push(Math.round(T * 1000) / 1000);
  const inputProps = {times};
  const composition = await selectComposition({...common, id: 'Expo', inputProps});
  const lines = [];
  await renderStill({...common, composition, inputProps, output: '/tmp/probe.png', frame: 0, onBrowserLog: (l) => l.text.startsWith('E|') && lines.push(l.text.slice(2))});
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`[expo] ${lines.length} lines -> ${out}`);
} else if (mode === 'sheet') {
  const [t0, dt, n, cols, scale] = rest.map(Number);
  const inputProps = {t0, dt, n, cols: cols || 6};
  const composition = await selectComposition({...common, id: 'Sheet', inputProps});
  await renderStill({...common, composition, inputProps, output: out, frame: 0, scale: scale || 0.5, onBrowserLog: (l) => l.type === 'error' && console.log('[browser]', l.text.slice(0, 300))});
  console.log(`[sheet] ${out}`);
}
await browser.close({silent: true});
// the bundle is a 250 MB temporary folder: remove it (many runs filled the disk once)
try {
  fs.rmSync(serveUrl, {recursive: true, force: true});
} catch {}
