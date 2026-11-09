import React from 'react';
import {Composition} from 'remotion';
import {Expo, Probe, Sheet} from './Check';
import {DURATION, FPS, H, SKIP, W} from './config';
import {MV} from './MV';
import {Cover} from './Cover';

export const Root: React.FC = () => (
  <>
    <Composition id="SignB" component={MV} durationInFrames={Math.round((DURATION - SKIP) * FPS)} fps={FPS} width={W} height={H} />
    {/* (v27) covers / thumbnails (stills): npx remotion still src/index.ts CoverA169 out/coverA_16x9.png (A43, B169, B43) */}
    <Composition id="CoverA169" component={Cover} durationInFrames={1} fps={FPS} width={1920} height={H} defaultProps={{spec: 'A169' as const}} />
    <Composition id="CoverA43" component={Cover} durationInFrames={1} fps={FPS} width={1440} height={H} defaultProps={{spec: 'A43' as const}} />
    <Composition id="CoverA11" component={Cover} durationInFrames={1} fps={FPS} width={1080} height={H} defaultProps={{spec: 'A11' as const}} />
    <Composition id="CoverB169" component={Cover} durationInFrames={1} fps={FPS} width={1920} height={H} defaultProps={{spec: 'B169' as const}} />
    <Composition id="CoverB43" component={Cover} durationInFrames={1} fps={FPS} width={1440} height={H} defaultProps={{spec: 'B43' as const}} />
    {/* self-check only (scripts/check.mjs); not rendered as video */}
    <Composition id="Expo" component={Expo} durationInFrames={1} fps={FPS} width={64} height={64} defaultProps={{times: [10]}} />
    <Composition id="Probe" component={Probe} durationInFrames={1} fps={FPS} width={64} height={64} defaultProps={{t0: 0, t1: DURATION, dt: 0.1}} />
    <Composition
      id="Sheet"
      component={Sheet}
      durationInFrames={1}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{t0: 0, dt: 0.1, n: 36, cols: 6}}
      calculateMetadata={({props}) => {
        const cols = props.cols ?? 6;
        const tw = Math.floor(W / cols);
        const th = Math.floor((tw * H) / W);
        return {height: Math.ceil(props.n / cols) * th};
      }}
    />
  </>
);
