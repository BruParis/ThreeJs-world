# Three.js World

A Three.js + TypeScript project for spherical tessellation and tectonic plate simulation.

## Requirements

### WebGL2

This application requires **WebGL2** support in your browser. Most modern browsers support it, but it may be disabled depending on your system configuration (GPU drivers, OS, or browser settings).

**To verify WebGL2 is available**, open the browser console and run:

```js
!!document.createElement('canvas').getContext('webgl2')
```

This should return `true`. If it returns `false`, WebGL2 is not available and the app will not run.

**Chrome** — check `chrome://gpu` in the address bar. Under *Graphics Feature Status*, `WebGL` should show **Hardware accelerated**. If it shows **Disabled** or **Software only**, hardware acceleration is not working.

## Development

```bash
npm install
npm run dev
```

Starts the dev server at [http://127.0.0.1:8080](http://127.0.0.1:8080) with hot module reloading.
