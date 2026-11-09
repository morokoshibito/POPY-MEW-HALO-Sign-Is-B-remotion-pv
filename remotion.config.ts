import {Config} from '@remotion/cli/config';

// WebGL (three.js stage + post compositor) needs a GPU path in headless Chrome.
// 'angle' uses the GPU on Windows; if the picture comes out black use --gl=swangle.
Config.setChromiumOpenGlRenderer('angle');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(null);
