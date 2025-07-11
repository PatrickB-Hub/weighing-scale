# A Little Balance

A browser physics study: a classic brass balance, five calibrated weights and eight original gummy bears. Built with TypeScript, SCSS, Three.js and Rapier. Desktop first, with a responsive mobile layout and keyboard-accessible placement controls.

## Run

Use Node.js 22.12+

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. `npm run build` produces `dist/`; `npm run preview` serves that production build locally. Publish the contents of `dist/` to a static host. Assets use Vite's base URL; for a subdirectory, build with `npm run build -- --base=/your-path/`. The host must serve `.glb` and JavaScript assets and allow WebAssembly compilation. No server, API key or account is required. No remote deployment has been configured.

## Play

- Drag a bear or weight in the scene, then release it above a pan. Drag the background to rotate the camera.
- On touch or keyboard, select an object in the tray, then choose **Left pan** or **Right pan**. The return arrow puts the selected object back on the table.
- **Escape** cancels a pickup. **Reset** returns everything to its starting position; the crosshair restores the camera.
- **Equal measures** places 20 g on each side. **Two for one** balances two 10 g bears against one 20 g weight.
- The readout counts objects actually supported by each pan, including stacks. It excludes objects in your hand and can change briefly during a bounce.
- The system's reduced-motion preference disables decorative gummy wobble and camera easing while retaining the physical balance.
