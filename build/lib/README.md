Vendored so the web stage can be served without node_modules, which a packaged
build does not ship, and without any third-party origin — a browser shield
blocking one script is otherwise indistinguishable from the feature not working.

- pixi.min.js               pixi.js 6.5.10 (MIT)
- live2d.cubism4.min.js     pixi-live2d-display 0.4.0 (MIT)
- live2dcubismcore.min.js   Live2D Cubism Core, (C) Live2D Inc.
                            Redistributable Code under the Live2D Proprietary
                            Software License Agreement, per its own header:
                            https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html

Refresh all three if the matching dependency changes.
