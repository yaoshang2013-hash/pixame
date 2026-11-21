        console.log('pixame script start');
        const roomSeeds = Object.fromEntries(window.pixameRooms.map(room => [room.id, room.seed]));
        const requestedRoom = new URLSearchParams(location.search).get('room');
        const roomId = Object.hasOwn(roomSeeds, requestedRoom) ? requestedRoom : Object.keys(roomSeeds)[0];
        const roomSelect = document.getElementById('room-select');
        const roomMessage = document.getElementById('room-message');
        const roomSwitchScreen = document.getElementById('room-switching');
        roomSelect.replaceChildren(...Object.keys(roomSeeds).map(id => new Option(id, id)));
        roomSelect.value = roomId;
        if (requestedRoom && !Object.hasOwn(roomSeeds, requestedRoom)) roomMessage.textContent = `Room unavailable; using ${roomId}.`;
        let roomSwitching = false;
        let accountInitializing = true;
        window.addEventListener('error', (e) => {
            console.error('Unhandled error:', e.message || e, e.error || e);
        });
        const bitmapGlyphWidths = new Map();
        function renderBitmapTextNode(textNode) {
            const text = textNode.nodeValue;
            if (!text || !text.trim() || !textNode.parentElement || textNode.parentElement.closest('.bitmap-text, script, style, textarea, input, select, [contenteditable="true"]')) return;
            const wrapper = document.createElement('span');
            wrapper.className = 'bitmap-text';
            const accessibleText = document.createElement('span');
            accessibleText.className = 'bitmap-text-source';
            accessibleText.textContent = text;
            wrapper.appendChild(accessibleText);
            const visualText = document.createElement('span');
            visualText.setAttribute('aria-hidden', 'true');
            for (const part of text.split(/(\s+)/)) {
                if (!part) continue;
                if (/^\s+$/.test(part)) {
                    visualText.appendChild(document.createTextNode(part));
                    continue;
                }
                const word = document.createElement('span');
                word.className = 'bitmap-word';
                for (const character of part) {
                    const code = character.codePointAt(0);
                    if (code >= 33 && code <= 126) {
                        const glyph = document.createElement('span');
                        glyph.className = 'bitmap-glyph';
                        glyph.style.width = `${(bitmapGlyphWidths.get(code) + 2) / 16}em`;
                        glyph.style.maskPosition = `${-(code % 16)}em ${-Math.floor(code / 16)}em`;
                        glyph.style.webkitMaskPosition = `${-(code % 16)}em ${-Math.floor(code / 16)}em`;
                        word.appendChild(glyph);
                    } else {
                        word.appendChild(document.createTextNode(character));
                    }
                }
                visualText.appendChild(word);
            }
            wrapper.appendChild(visualText);
            textNode.replaceWith(wrapper);
        }

        function renderBitmapText(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) {
                const textNode = walker.currentNode;
                const parent = textNode.parentElement;
                if (!parent || parent.closest('.bitmap-text, script, style, textarea, input, select, [contenteditable="true"]')) continue;
                textNodes.push(textNode);
            }
            textNodes.forEach(renderBitmapTextNode);
        }

        const bitmapFontImage = new Image();
        bitmapFontImage.onload = () => {
            const atlasCanvas = document.createElement('canvas');
            atlasCanvas.width = bitmapFontImage.naturalWidth;
            atlasCanvas.height = bitmapFontImage.naturalHeight;
            if (atlasCanvas.width !== 256 || atlasCanvas.height !== 256) {
                console.error('Unexpected bitmap font atlas size:', atlasCanvas.width, atlasCanvas.height);
                return;
            }
            const atlasContext = atlasCanvas.getContext('2d', {willReadFrequently: true});
            atlasContext.drawImage(bitmapFontImage, 0, 0);
            const pixels = atlasContext.getImageData(0, 0, 256, 256).data;
            for (let code = 33; code <= 126; code++) {
                const startX = (code % 16) * 16;
                const startY = Math.floor(code / 16) * 16;
                let width = 0;
                for (let y = 0; y < 16; y++) {
                    for (let x = 0; x < 16; x++) {
                        if (pixels[((startY + y) * 256 + startX + x) * 4 + 3] > 0) width = Math.max(width, x + 1);
                    }
                }
                bitmapGlyphWidths.set(code, width);
            }
            renderBitmapText(document.body);
            const bitmapTextObserver = new MutationObserver(records => {
                for (const record of records) {
                    record.addedNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) renderBitmapTextNode(node);
                        else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('bitmap-text')) renderBitmapText(node);
                    });
                }
            });
            bitmapTextObserver.observe(document.body, {childList: true, subtree: true});
        };
        bitmapFontImage.onerror = error => console.error('Failed to load bitmap font font/ascii.png:', error);
        bitmapFontImage.src = 'font/ascii.png';
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);

        const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
        scene.add(camera);
        camera.position.set(0, 2.5, 0);
        camera.rotation.order = 'YXZ';
        const viewCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
        const heldItemScene = new THREE.Scene();
        const heldItemCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 10);
        heldItemScene.add(heldItemCamera);
        heldItemScene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const heldItemLight = new THREE.DirectionalLight(0xffffff, 0.7);
        heldItemLight.position.set(-2, 4, 5);
        heldItemScene.add(heldItemLight);
        const perspectiveModes = ['first', 'thirdBack', 'thirdFront'];
        const settingsStorageKey = 'pixame.settings.v1';
        const defaultSettings = {cameraSensitivity: 1, mobileControlScale: 1, cameraView: 'first', mobileMode: null, shoulderSide: 'right'};
        const defaultKeybindings = {
            moveForward: ['KeyW', 'ArrowUp'],
            moveBackward: ['KeyS', 'ArrowDown'],
            moveLeft: ['KeyA', 'ArrowLeft'],
            moveRight: ['KeyD', 'ArrowRight'],
            jump: ['Space'],
            sprint: ['ShiftLeft'],
            togglePerspective: ['KeyV'],
            toggleShoulder: ['KeyC'],
            toggleFlight: ['KeyF'],
            inventory: ['KeyE'],
            blockPalette: ['KeyB'],
            hotbar1: ['Digit1'],
            hotbar2: ['Digit2'],
            hotbar3: ['Digit3'],
            hotbar4: ['Digit4'],
            hotbar5: ['Digit5'],
            hotbar6: ['Digit6'],
            hotbar7: ['Digit7'],
            hotbar8: ['Digit8']
        };
        const keybindingActions = [
            ['moveForward', 'MOVE FORWARD'], ['moveBackward', 'MOVE BACKWARD'],
            ['moveLeft', 'MOVE LEFT'], ['moveRight', 'MOVE RIGHT'],
            ['jump', 'JUMP'], ['sprint', 'SPRINT'],
            ['togglePerspective', 'CHANGE CAMERA'], ['toggleShoulder', 'SWITCH SHOULDER'],
            ['toggleFlight', 'ADMIN FLIGHT'], ['inventory', 'INVENTORY'],
            ['blockPalette', 'BLOCK PALETTE'],
            ...Array.from({length: 8}, (_, index) => [`hotbar${index + 1}`, `HOTBAR ${index + 1}`])
        ];
        function createDefaultKeybindings() {
            return Object.fromEntries(Object.entries(defaultKeybindings).map(([action, codes]) => [action, [...codes]]));
        }
        function createDefaultSettings() {
            return {...defaultSettings, keybindings: createDefaultKeybindings()};
        }
        let settingsLoadError = '';
        function loadGameSettings() {
            try {
                const saved = JSON.parse(localStorage.getItem(settingsStorageKey) || 'null');
                if (!saved || typeof saved !== 'object') return createDefaultSettings();
                const keybindings = createDefaultKeybindings();
                let invalidKeybindings = false;
                if (saved.keybindings && typeof saved.keybindings === 'object' && !Array.isArray(saved.keybindings)) {
                    for (const action of Object.keys(defaultKeybindings)) {
                        const codes = saved.keybindings[action];
                        if (codes === undefined) continue;
                        if (!Array.isArray(codes) || codes.length === 0 || codes.length > 2 ||
                            !codes.every(code => typeof code === 'string' && code.length > 0 && code.length <= 32)) {
                            invalidKeybindings = true;
                            continue;
                        }
                        keybindings[action] = [...new Set(codes)];
                    }
                    const usedCodes = new Set();
                    for (const codes of Object.values(keybindings)) {
                        for (const code of codes) {
                            if (usedCodes.has(code)) invalidKeybindings = true;
                            usedCodes.add(code);
                        }
                    }
                    if (invalidKeybindings) {
                        console.warn('Invalid saved key bindings; using defaults.');
                        settingsLoadError = 'Invalid key bindings were reset to defaults.';
                    }
                }
                return {
                    cameraSensitivity: Number.isFinite(saved.cameraSensitivity)
                        ? Math.max(0.25, Math.min(3, saved.cameraSensitivity)) : defaultSettings.cameraSensitivity,
                    mobileControlScale: Number.isFinite(saved.mobileControlScale)
                        ? Math.max(0.75, Math.min(1.4, saved.mobileControlScale)) : defaultSettings.mobileControlScale,
                    cameraView: perspectiveModes.includes(saved.cameraView) ? saved.cameraView : defaultSettings.cameraView,
                    mobileMode: typeof saved.mobileMode === 'boolean' ? saved.mobileMode : defaultSettings.mobileMode,
                    shoulderSide: saved.shoulderSide === 'left' ? 'left' : defaultSettings.shoulderSide,
                    keybindings: invalidKeybindings ? createDefaultKeybindings() : keybindings
                };
            } catch (error) {
                console.error('Failed to load game settings:', error);
                settingsLoadError = 'Settings could not be loaded.';
                return createDefaultSettings();
            }
        }
        const gameSettings = loadGameSettings();
        let perspectiveModeIndex = Math.max(0, perspectiveModes.indexOf(gameSettings.cameraView));
        function isKeyBound(action, event) {
            return gameSettings.keybindings[action].includes(event.code);
        }

        const isiPad = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
        const canPointerLock = 'pointerLockElement' in document || 'mozPointerLockElement' in document || 'webkitPointerLockElement' in document;
        const usePointerLock = canPointerLock && !isiPad;
        const wantsFullscreen = isiPad;
        let mobileMode = gameSettings.mobileMode === null
            ? window.matchMedia('(pointer: coarse)').matches
            : gameSettings.mobileMode;

        function updateMobileControlScale() {
            const shortSide = Math.min(window.innerWidth, window.innerHeight);
            const scale = gameSettings.mobileControlScale;
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            const setPixelSize = (name, value) => document.documentElement.style.setProperty(name, `${Math.round(value)}px`);
            setPixelSize('--mobile-joystick-size', clamp(shortSide * 0.28, 82, 128) * scale);
            setPixelSize('--mobile-knob-size', clamp(shortSide * 0.1, 30, 48) * scale);
            setPixelSize('--mobile-button-size', clamp(shortSide * 0.16, 50, 76) * scale);
            setPixelSize('--mobile-button-height', clamp(shortSide * 0.13, 42, 62) * scale);
            setPixelSize('--mobile-control-gap', clamp(shortSide * 0.018, 5, 10) * scale);
            setPixelSize('--mobile-control-edge', clamp(shortSide * 0.035, 10, 25));
            setPixelSize('--mobile-control-bottom', clamp(window.innerHeight * 0.14, 64, 112));
            setPixelSize('--mobile-control-font', clamp(shortSide * 0.026, 8, 12) * scale);
        }

        function enterFullscreen() {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
            else if (el.msRequestFullscreen) el.msRequestFullscreen();
        }

        const renderer = new THREE.WebGLRenderer({antialias: true});
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(innerWidth, innerHeight);
        renderer.domElement.style.position = 'fixed';
        renderer.domElement.style.inset = '0';
        renderer.domElement.style.zIndex = '0';
        renderer.domElement.style.touchAction = 'none';
        document.body.appendChild(renderer.domElement);

        function resize() {
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setSize(innerWidth, innerHeight);
            camera.aspect = innerWidth / innerHeight;
            camera.updateProjectionMatrix();
            viewCamera.aspect = innerWidth / innerHeight;
            viewCamera.updateProjectionMatrix();
            heldItemCamera.aspect = camera.aspect;
            heldItemCamera.updateProjectionMatrix();
            updateMobileControlScale();
        }

        window.addEventListener('resize', resize);
        updateMobileControlScale();

        if (wantsFullscreen) {
            enterFullscreen();
        }

        scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const sun = new THREE.DirectionalLight(0xffffff, 1.1);
        sun.position.set(5, 10, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 1024;
        sun.shadow.mapSize.height = 1024;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 50;
        sun.shadow.camera.left = -15;
        sun.shadow.camera.right = 15;
        sun.shadow.camera.top = 15;
        sun.shadow.camera.bottom = -15;
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.bias = -0.0001;
        sun.shadow.normalBias = 0.02;
        scene.add(sun);
        scene.add(sun.target);

        function updateSunForPlayer() {
            sun.target.position.copy(camera.position);
            sun.position.set(camera.position.x + 5, camera.position.y + 10, camera.position.z + 5);
        }

        const tile = 16;
        const treeSpecies = ['spruce', 'jungle', 'acacia', 'cherry', 'birch', 'dark_oak'];
        const treeBlockType = (species, part) => species === 'oak' ? part : `${species}_${part}`;
        const caveBlockTypes = ['moss_block', 'packed_ice', 'glow_mushroom', 'mushroom_stem'];
        const caveTileStart = 22 + treeSpecies.length * 3;
        const atlasTileCount = caveTileStart + caveBlockTypes.length;
        const atlasW = tile * atlasTileCount, atlasH = tile;
        const atlas = document.createElement('canvas');
        atlas.width = atlasW;
        atlas.height = atlasH;
        const actx = atlas.getContext('2d');
        actx.imageSmoothingEnabled = false;
        actx.fillStyle = '#6b4326';
        actx.fillRect(0, 0, tile, tile);
        actx.fillStyle = '#3b2b14';
        actx.fillRect(0, Math.floor(tile * 0.3125), Math.floor(tile * 0.5), Math.floor(tile * 0.1875));
        actx.fillStyle = '#2b7a2b';
        actx.fillRect(0, 0, tile, Math.floor(tile * 0.0625));
        actx.fillStyle = '#2a8b2a';
        actx.fillRect(tile, 0, tile, tile);
        actx.fillStyle = '#3bb63b';
        actx.fillRect(tile + Math.floor(tile * 0.03125), Math.floor(tile * 0.03125), Math.floor(tile * 0.1875), Math.floor(tile * 0.1875));
        actx.fillStyle = '#1e5d1e';
        actx.fillRect(tile + Math.floor(tile * 0.3125), Math.floor(tile * 0.3125), Math.floor(tile * 0.125), Math.floor(tile * 0.125));
        actx.fillStyle = '#5a341f';
        actx.fillRect(tile * 2, 0, tile, tile);
        actx.fillStyle = '#4a2a17';
        actx.fillRect(tile * 2 + Math.floor(tile * 0.25), Math.floor(tile * 0.25), Math.floor(tile * 0.1875), Math.floor(tile * 0.1875));
        actx.fillStyle = '#7a4b24';
        actx.fillRect(tile * 3, 0, tile, tile);
        actx.fillStyle = '#5c3216';
        actx.fillRect(tile * 4, 0, tile, tile);
        actx.fillStyle = '#6d3d1c';
        actx.fillRect(tile * 5, 0, tile, tile);
        actx.fillStyle = '#d5bd78';
        actx.fillRect(tile * 6, 0, tile, tile);
        actx.fillStyle = '#dcebf4';
        actx.fillRect(tile * 7, 0, tile, tile);
        actx.fillStyle = '#604027';
        actx.fillRect(tile * 8, 0, tile, tile);
        actx.fillStyle = '#604027';
        actx.fillRect(tile * 9, 0, tile, tile);
        actx.fillStyle = '#347a32';
        actx.fillRect(tile * 10, 0, tile, tile);
        actx.fillStyle = '#e4f0f7';
        actx.fillRect(tile * 11, 0, tile, tile);
        actx.fillStyle = '#777a79';
        actx.fillRect(tile * 12, 0, tile, tile);
        actx.fillStyle = '#b7834d';
        actx.fillRect(tile * 13, 0, tile, tile);
        actx.fillStyle = '#9c633b';
        actx.fillRect(tile * 14, 0, tile, tile);
        actx.fillStyle = '#704225';
        actx.fillRect(tile * 15, 0, tile, tile);
        actx.fillStyle = '#b67942';
        actx.fillRect(tile * 16, 0, tile, tile);
        actx.fillStyle = '#a87d66';
        actx.fillRect(tile * 17, 0, tile, tile);
        actx.fillStyle = '#333333';
        actx.fillRect(tile * 18, 0, tile, tile);
        actx.fillStyle = '#777a79';
        actx.fillRect(tile * 19, 0, tile * 3, tile);
        function drawTerrainTexture(index, base, accents, count = 48) {
            const offsetX = tile * index;
            actx.fillStyle = base;
            actx.fillRect(offsetX, 0, tile, tile);
            let seed = (index + 1) * 2654435761;
            function random() {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 4294967296;
            }
            for (let i = 0; i < count; i++) {
                actx.fillStyle = accents[Math.floor(random() * accents.length)];
                const x = Math.floor(random() * tile);
                const y = Math.floor(random() * tile);
                const size = random() < 0.16 ? 2 : 1;
                actx.fillRect(offsetX + x, y, size, size);
            }
        }
        drawTerrainTexture(0, '#745334', ['#60432c', '#805d3b', '#926c43', '#5a3e2a'], 46);
        for (let x = 0; x < tile; x++) {
            const edge = 2 + ((x * 7 + 3) % 3);
            actx.fillStyle = x % 4 === 0 ? '#3d7429' : '#4c8b32';
            actx.fillRect(x, 0, 1, edge);
        }
        drawTerrainTexture(1, '#4d872f', ['#3b7428', '#639b3a', '#76a944', '#407b2b'], 58);
        drawTerrainTexture(2, '#68472c', ['#55391f', '#795538', '#8a623e', '#5b3e27'], 48);
        drawTerrainTexture(3, '#725034', ['#5d4029', '#805b3b', '#8b6340', '#60422a'], 48);
        drawTerrainTexture(4, '#79563a', ['#62432b', '#8b6746', '#936b43', '#68492e'], 48);
        drawTerrainTexture(5, '#68472c', ['#55391f', '#795538', '#8a623e', '#5b3e27'], 48);
        drawTerrainTexture(6, '#d4bd7e', ['#c5ad6c', '#e3ce91', '#ead9a2', '#bca463'], 42);
        drawTerrainTexture(7, '#e8f2f6', ['#d4e4ec', '#f7fbfc', '#c4d9e3'], 28);
        drawTerrainTexture(8, '#76502f', ['#56391f', '#8a6038', '#9b7144'], 24);
        for (let x = 2; x < tile; x += 4) {
            actx.fillStyle = x % 2 ? '#51351f' : '#95693c';
            actx.fillRect(tile * 8 + x, 0, 1, tile);
        }
        drawTerrainTexture(9, '#855b34', ['#6b472b', '#a97943', '#bc8c50'], 20);
        for (const radius of [2, 4, 6]) {
            actx.strokeStyle = radius % 4 ? '#68452b' : '#b1834a';
            actx.strokeRect(tile * 9 + 8 - radius, 8 - radius, radius * 2, radius * 2);
        }
        drawTerrainTexture(10, '#3c762f', ['#2e6228', '#518a38', '#659641', '#2c5728'], 72);
        drawTerrainTexture(11, '#755234', ['#60432a', '#8b6541', '#9a7046'], 40);
        for (let x = 0; x < tile; x++) {
            const edge = 3 + ((x * 5 + 1) % 3);
            actx.fillStyle = x % 3 === 0 ? '#d9e9ef' : '#edf5f7';
            actx.fillRect(tile * 11 + x, 0, 1, edge);
        }
        drawTerrainTexture(12, '#777a79', ['#626665', '#888c89', '#969a96', '#696d6c'], 58);
        drawTerrainTexture(13, '#ae7945', ['#94643b', '#c18b50', '#d09a5a'], 32);
        for (let y = 3; y < tile; y += 5) {
            actx.fillStyle = '#805631';
            actx.fillRect(tile * 13, y, tile, 1);
        }
        drawTerrainTexture(14, '#9c633b', ['#754727', '#b17948', '#bd8952'], 30);
        drawTerrainTexture(15, '#704225', ['#573019', '#935a31', '#a36a38'], 30);
        drawTerrainTexture(16, '#b67942', ['#9b6036', '#ca8e50', '#d69a58'], 28);
        for (let p = 0; p < tile; p += 4) {
            actx.fillStyle = '#704225';
            actx.fillRect(tile * 16 + p, 0, 1, tile);
            actx.fillRect(tile * 16, p, tile, 1);
        }
        drawTerrainTexture(17, '#656966', ['#8c684e', '#a77d5d', '#493d35', '#5c5148'], 52);
        drawTerrainTexture(18, '#333638', ['#25292b', '#414546', '#525654'], 52);
        drawTerrainTexture(19, '#777a79', ['#5e6261', '#8a8e8b', '#9b9e99'], 44);
        drawTerrainTexture(20, '#696d6c', ['#555958', '#858987', '#929591'], 36);
        actx.fillStyle = '#383c3c';
        actx.fillRect(tile * 20 + 4, 4, 8, 8);
        actx.fillStyle = '#202424';
        actx.fillRect(tile * 20 + 5, 5, 6, 6);
        actx.fillStyle = '#a4a7a2';
        actx.fillRect(tile * 20 + 4, 3, 8, 1);
        drawTerrainTexture(21, '#858986', ['#6d716e', '#a0a39d', '#b0b2ac'], 36);
        actx.fillStyle = '#646866';
        actx.fillRect(tile * 21 + 7, 0, 2, tile);
        actx.fillRect(tile * 21, 7, tile, 2);
        treeSpecies.forEach((species, index) => {
            for (let part = 0; part < 3; part++) {
                actx.drawImage(atlas, (8 + part) * tile, 0, tile, tile, (22 + index * 3 + part) * tile, 0, tile, tile);
            }
        });
        caveBlockTypes.forEach((type, index) => {
            actx.drawImage(atlas, 12 * tile, 0, tile, tile, (caveTileStart + index) * tile, 0, tile, tile);
        });

        let blockTexture = new THREE.CanvasTexture(atlas);
        blockTexture.magFilter = THREE.NearestFilter;
        blockTexture.minFilter = THREE.NearestFilter;
        blockTexture.generateMipmaps = false;
        blockTexture.needsUpdate = true;

        let grassColorMap = null;
        let grassIconOverlay = null;
        const blockIconTiles = {
            grass: {side: 0, top: 1},
            dirt: {side: 3, top: 4},
            sand: {side: 6, top: 6},
            snow: {side: 11, top: 7},
            wood: {side: 8, top: 9},
            leaves: {side: 10, top: 10},
            stone: {side: 12, top: 12},
            planks: {side: 13, top: 13},
            crafting_table: {side: 14, right: 15, top: 16},
            iron_ore: {side: 17, top: 17},
            furnace: {side: 19, right: 20, top: 21}
        };
        treeSpecies.forEach((species, index) => {
            const start = 22 + index * 3;
            blockIconTiles[treeBlockType(species, 'wood')] = {side: start, top: start + 1};
            blockIconTiles[treeBlockType(species, 'leaves')] = {side: start + 2, top: start + 2};
        });
        caveBlockTypes.forEach((type, index) => {
            blockIconTiles[type] = {side: caveTileStart + index, top: caveTileStart + index};
        });

        function drawBlockIcon(canvas, type) {
            const tiles = blockIconTiles[type];
            if (!tiles || !blockTexture.image) return;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            const width = canvas.width;
            const height = canvas.height;
            let tintedOverlay = null;
            if (type === 'grass' && grassColorMap && grassIconOverlay) {
                tintedOverlay = document.createElement('canvas');
                tintedOverlay.width = grassIconOverlay.naturalWidth;
                tintedOverlay.height = grassIconOverlay.naturalHeight;
                const overlayContext = tintedOverlay.getContext('2d', {willReadFrequently: true});
                overlayContext.drawImage(grassIconOverlay, 0, 0);
                const image = overlayContext.getImageData(0, 0, tintedOverlay.width, tintedOverlay.height);
                const color = grassBiomeColor({snowWeight: 0, desertWeight: 0});
                for (let i = 0; i < image.data.length; i += 4) {
                    for (let channel = 0; channel < 3; channel++) image.data[i + channel] *= color[channel];
                }
                overlayContext.putImageData(image, 0, 0);
            }
            const drawFace = (points, tileIndex, shade) => {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(blockTexture.image, tileIndex * tile, 0, tile, tile, 0, 0, width, height);
                if (type === 'grass' && tileIndex === 0 && tintedOverlay) {
                    ctx.drawImage(tintedOverlay, 0, 0, width, height);
                }
                if (type === 'grass' && tileIndex === 1 && grassColorMap) {
                    const [r, g, b] = grassBiomeColor({snowWeight: 0, desertWeight: 0});
                    ctx.globalCompositeOperation = 'multiply';
                    ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
                    ctx.fillRect(0, 0, width, height);
                    ctx.globalCompositeOperation = 'source-over';
                }
                if (shade) {
                    ctx.fillStyle = shade;
                    ctx.fillRect(0, 0, width, height);
                }
                ctx.restore();
                ctx.beginPath();
                ctx.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(8, 13, 14, 0.7)';
                ctx.lineWidth = Math.max(1, Math.round(width / 24));
                ctx.stroke();
            };
            ctx.clearRect(0, 0, width, height);
            drawFace([[width / 2, 1], [width - 2, height * 0.26], [width / 2, height * 0.5], [2, height * 0.26]], tiles.top, 'rgba(255,255,255,0.08)');
            drawFace([[2, height * 0.26], [width / 2, height * 0.5], [width / 2, height - 3], [2, height * 0.74]], tiles.side, 'rgba(0,0,0,0.18)');
            drawFace([[width / 2, height * 0.5], [width - 2, height * 0.26], [width - 2, height * 0.74], [width / 2, height - 3]], tiles.right || tiles.side, 'rgba(0,0,0,0.38)');
        }

        function drawItemIcon(canvas, type) {
            canvas.dataset.itemIcon = type;
            if (sparkBlockDefinitions.has(type)) {
                drawSparkBlockIcon(canvas, type);
                return;
            }
            if (blockIconTiles[type]) {
                drawBlockIcon(canvas, type);
                return;
            }
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const definition = itemDefinitions[type];
            ctx.clearRect(0, 0, width, height);
            if (!definition) return;
            const image = getItemIconImage(type);
            if (image) {
                const padding = Math.max(2, Math.round(Math.min(width, height) * 0.08));
                const scale = Math.min((width - padding * 2) / image.naturalWidth, (height - padding * 2) / image.naturalHeight);
                const drawWidth = image.naturalWidth * scale;
                const drawHeight = image.naturalHeight * scale;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
                return;
            }
            const color = definition.color;
            const dark = new THREE.Color(color).multiplyScalar(0.58).getStyle();
            const light = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25).getStyle();
            if (type === 'iron_ingot') {
                ctx.fillStyle = dark;
                ctx.beginPath();
                ctx.moveTo(width * 0.25, height * 0.35);
                ctx.lineTo(width * 0.75, height * 0.35);
                ctx.lineTo(width * 0.88, height * 0.7);
                ctx.lineTo(width * 0.12, height * 0.7);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(width * 0.27, height * 0.35);
                ctx.lineTo(width * 0.73, height * 0.35);
                ctx.lineTo(width * 0.82, height * 0.58);
                ctx.lineTo(width * 0.18, height * 0.58);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = light;
                ctx.fillRect(width * 0.28, height * 0.38, width * 0.4, height * 0.06);
                return;
            }
            ctx.save();
            ctx.translate(width * 0.5, height * 0.5);
            ctx.rotate(-Math.PI / 4);
            if (type === 'sticks' || type === 'torch') {
                ctx.fillStyle = dark;
                ctx.fillRect(-3, -height * 0.34, 7, height * 0.68);
                ctx.fillStyle = light;
                ctx.fillRect(-3, -height * 0.34, 3, height * 0.68);
                if (type === 'torch') {
                    ctx.fillStyle = '#ffd86b';
                    ctx.fillRect(-7, -height * 0.43, 15, 12);
                    ctx.fillStyle = '#ee6f36';
                    ctx.fillRect(-4, -height * 0.38, 9, 6);
                }
            } else if (type === 'planks' || type === 'crafting_table') {
                ctx.fillStyle = dark;
                ctx.fillRect(-width * 0.27, -height * 0.23, width * 0.58, height * 0.5);
                ctx.fillStyle = light;
                ctx.fillRect(-width * 0.31, -height * 0.3, width * 0.58, height * 0.14);
                ctx.strokeStyle = dark;
                ctx.lineWidth = Math.max(1, width / 16);
                ctx.strokeRect(-width * 0.31, -height * 0.3, width * 0.58, height * 0.5);
                if (type === 'crafting_table') {
                    ctx.fillStyle = '#d6a05b';
                    ctx.fillRect(-width * 0.22, -height * 0.25, width * 0.4, height * 0.08);
                }
            } else {
                const isAxe = type.endsWith('_axe');
                ctx.fillStyle = '#8f5b34';
                ctx.fillRect(-3, -height * 0.35, 7, height * 0.7);
                ctx.fillStyle = dark;
                if (isAxe) {
                    ctx.beginPath();
                    ctx.moveTo(-width * 0.25, -height * 0.3);
                    ctx.lineTo(width * 0.25, -height * 0.25);
                    ctx.lineTo(width * 0.18, 2);
                    ctx.lineTo(-width * 0.2, -2);
                    ctx.closePath();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(-width * 0.34, -height * 0.24);
                    ctx.lineTo(width * 0.34, -height * 0.24);
                    ctx.lineTo(width * 0.27, -height * 0.05);
                    ctx.lineTo(-width * 0.27, -height * 0.05);
                    ctx.closePath();
                }
                ctx.fill();
                ctx.fillStyle = light;
                ctx.fillRect(-width * 0.2, -height * 0.24, width * 0.4, height * 0.07);
            }
            ctx.restore();
        }

        const sparkBlockDefinitions = new Map();
        const sparkBlockImages = new Map();
        const sparkBlockTextures = new Map();
        const sparkBlockMaterials = new Map();
        const lowSparkMaterials = new Map();
        const sparkModelMaterials = new Map();
        const sparkBlockModels = new Map();
        const sparkNamedBlockModels = new Map();
        const pendingWorldEdits = [];
        let sparkBlocksReady = false;

        function createSparkBlockTexture(image) {
            const texture = new THREE.Texture(image);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.encoding = THREE.sRGBEncoding;
            texture.needsUpdate = true;
            return texture;
        }

        function drawSparkBlockIcon(canvas, type) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#172220';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const image = getSparkBlockImage(type);
            if (!image) return;
            const padding = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.06));
            const scale = Math.min((canvas.width - padding * 2) / image.naturalWidth, (canvas.height - padding * 2) / image.naturalHeight);
            const drawWidth = image.naturalWidth * scale;
            const drawHeight = image.naturalHeight * scale;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
        }

        function getSparkBlockImage(type) {
            const definition = sparkBlockDefinitions.get(type);
            if (!definition) return null;
            let image = sparkBlockImages.get(type);
            if (!image) {
                image = new Image();
                sparkBlockImages.set(type, image);
                image.onload = () => {
                    document.querySelectorAll('.item-icon').forEach(canvas => {
                        if (canvas.dataset.itemIcon === type) drawSparkBlockIcon(canvas, type);
                    });
                    let texture = sparkBlockTextures.get(type);
                    if (!texture) {
                        texture = createSparkBlockTexture(image);
                        sparkBlockTextures.set(type, texture);
                    } else {
                        texture.image = image;
                        texture.needsUpdate = true;
                    }
                    for (const material of [sparkBlockMaterials.get(type), sparkModelMaterials.get(type)]) {
                        if (!material) continue;
                        material.map = texture;
                        material.needsUpdate = true;
                    }
                    const lowMaterial = lowSparkMaterials.get(type);
                    if (lowMaterial) applyLowDetailPixel(lowMaterial, sampleOpaquePixel(image));
                };
                image.onerror = error => console.warn(`Failed to load Spark block texture ${definition.textureUrl}`, error);
                image.src = definition.textureUrl;
            }
            return image.complete && image.naturalWidth > 0 ? image : null;
        }

        function getSparkBlockMaterial(type) {
            let material = sparkBlockMaterials.get(type);
            if (material) return material;
            material = new THREE.MeshStandardMaterial({map: blockTexture, roughness: 0.9, metalness: 0, alphaTest: 0.1});
            sparkBlockMaterials.set(type, material);
            material.map = getSparkBlockTexture(type);
            material.needsUpdate = true;
            return material;
        }

        function getSparkBlockTexture(type) {
            const image = getSparkBlockImage(type) || sparkBlockImages.get(type);
            if (!image || !image.complete || image.naturalWidth === 0) return blockTexture;
            let texture = sparkBlockTextures.get(type);
            if (!texture) {
                texture = createSparkBlockTexture(image);
                sparkBlockTextures.set(type, texture);
            }
            return texture;
        }

        function getSparkModelMaterial(type) {
            let material = sparkModelMaterials.get(type);
            if (!material) {
                material = getSparkBlockMaterial(type).clone();
                material.side = THREE.DoubleSide;
                sparkModelMaterials.set(type, material);
            }
            return material;
        }

        function getSparkModelFamily(type) {
            const parts = type.split('/');
            if (parts[0] === 'spark:furniture') return parts[1];
            if (parts[0] === 'spark:construction' && ['balustrade', 'picket_fence'].includes(parts[1])) return parts[1];
            return null;
        }

        function getSparkModel(type) {
            return sparkNamedBlockModels.get(type) || sparkBlockModels.get(getSparkModelFamily(type));
        }

        const sparkModelFaceOrder = ['east', 'west', 'up', 'down', 'south', 'north'];
        function getSparkModelFaceUv(cube, face, width, height, depth) {
            if (Array.isArray(cube.uv) && cube.uv.length >= 2) {
                const [u, v] = cube.uv;
                const faceLayout = {
                    east: [u, v + depth, depth, height],
                    west: [u + depth + width, v + depth, depth, height],
                    up: [u + depth, v, width, depth],
                    down: [u + depth + width, v, width, -depth],
                    south: [u + depth + width + depth, v + depth, width, height],
                    north: [u + depth, v + depth, width, height]
                }[face];
                return faceLayout;
            }
            const faceUv = cube.uv?.[face];
            if (!faceUv || !Array.isArray(faceUv.uv) || !Array.isArray(faceUv.uv_size)) return null;
            return [faceUv.uv[0], faceUv.uv[1], faceUv.uv_size[0], faceUv.uv_size[1]];
        }

        function createSparkModelCube(cube, bonePivot, textureSize, material, blockPosition, blockType) {
            if (!Array.isArray(cube.origin) || !Array.isArray(cube.size) ||
                cube.origin.length < 3 || cube.size.length < 3) return null;
            const origin = cube.origin.map(Number);
            const size = cube.size.map(Number);
            if (![...origin, ...size].every(Number.isFinite) || size.some(value => value < 0)) return null;
            const inflate = Number.isFinite(Number(cube.inflate)) ? Number(cube.inflate) : 0;
            const dimensions = size.map(value => Math.max(0.005, (value + inflate * 2) / 16));
            const [cubeWidth, cubeHeight, cubeDepth] = dimensions;
            const center = origin.map((value, index) => value + size[index] / 2);
            const pivot = Array.isArray(cube.pivot) && cube.pivot.length >= 3 ? cube.pivot.map(Number) : bonePivot;
            if (!pivot.every(Number.isFinite)) return null;
            const cubeGroup = new THREE.Group();
            cubeGroup.position.set(
                (pivot[0] - bonePivot[0]) / 16,
                (pivot[1] - bonePivot[1]) / 16,
                (pivot[2] - bonePivot[2]) / 16
            );
            const rotation = Array.isArray(cube.rotation) ? cube.rotation : [0, 0, 0];
            cubeGroup.rotation.set(
                THREE.MathUtils.degToRad(Number(rotation[0]) || 0),
                THREE.MathUtils.degToRad(Number(rotation[1]) || 0),
                THREE.MathUtils.degToRad(Number(rotation[2]) || 0)
            );

            const geometry = new THREE.BoxGeometry(cubeWidth, cubeHeight, cubeDepth);
            const positions = geometry.attributes.position;
            const uvs = new Float32Array(positions.count * 2);
            const width = cubeWidth;
            const height = cubeHeight;
            const depth = cubeDepth;
            const halfWidth = cubeWidth / 2;
            const halfHeight = cubeHeight / 2;
            const halfDepth = cubeDepth / 2;
            const indices = [];
            const boxIndices = geometry.index.array;
            for (let faceIndex = 0; faceIndex < sparkModelFaceOrder.length; faceIndex++) {
                const face = sparkModelFaceOrder[faceIndex];
                const uvFace = cube.mirror && face === 'east' ? 'west' :
                    cube.mirror && face === 'west' ? 'east' : face;
                const rect = getSparkModelFaceUv(cube, uvFace, size[0], size[1], size[2]);
                if (!rect || !rect.every(Number.isFinite) || rect[2] === 0 || rect[3] === 0) continue;
                for (let i = faceIndex * 6; i < faceIndex * 6 + 6; i++) indices.push(boxIndices[i]);
                for (let vertex = faceIndex * 4; vertex < faceIndex * 4 + 4; vertex++) {
                    const x = positions.getX(vertex);
                    const y = positions.getY(vertex);
                    const z = positions.getZ(vertex);
                    let uFraction, vFraction;
                    if (face === 'east') {
                        uFraction = (halfDepth - z) / depth;
                        vFraction = (halfHeight - y) / height;
                    } else if (face === 'west') {
                        uFraction = (z + halfDepth) / depth;
                        vFraction = (halfHeight - y) / height;
                    } else if (face === 'up') {
                        uFraction = (x + halfWidth) / width;
                        vFraction = (halfDepth - z) / depth;
                    } else if (face === 'down') {
                        uFraction = (x + halfWidth) / width;
                        vFraction = (z + halfDepth) / depth;
                    } else if (face === 'south') {
                        uFraction = (halfWidth - x) / width;
                        vFraction = (halfHeight - y) / height;
                    } else {
                        uFraction = (x + halfWidth) / width;
                        vFraction = (halfHeight - y) / height;
                    }
                    const pixelU = rect[0] + rect[2] * (cube.mirror ? 1 - uFraction : uFraction);
                    const pixelV = rect[1] + rect[3] * vFraction;
                    uvs[vertex * 2] = pixelU / textureSize[0];
                    uvs[vertex * 2 + 1] = 1 - pixelV / textureSize[1];
                }
            }
            geometry.clearGroups();
            geometry.setIndex(indices);
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (center[0] - pivot[0]) / 16,
                (center[1] - pivot[1]) / 16,
                (center[2] - pivot[2]) / 16
            );
            mesh.userData.worldPos = blockPosition;
            mesh.userData.blockType = blockType;
            mesh.userData.sparkBlockModel = true;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.userData.blockShadowCaster = true;
            cubeGroup.add(mesh);
            return cubeGroup;
        }

        function createSparkBlockModel(type, model, x, y, z) {
            const description = model.description || {};
            const textureSize = [
                Math.max(1, Number(description.texture_width) || 16),
                Math.max(1, Number(description.texture_height) || 16)
            ];
            const material = getSparkModelMaterial(type);
            const root = new THREE.Group();
            root.position.set(x + 0.5, y, z + 0.5);
            const bones = new Map(model.bones.map(bone => [bone.name, bone]));
            const boneGroups = new Map();
            function attachBone(name, ancestry = new Set()) {
                if (boneGroups.has(name)) return boneGroups.get(name);
                const bone = bones.get(name);
                if (!bone) return root;
                const nextAncestry = new Set(ancestry);
                if (nextAncestry.has(name)) return root;
                nextAncestry.add(name);
                const pivot = Array.isArray(bone.pivot) && bone.pivot.length >= 3 ? bone.pivot.map(Number) : [0, 0, 0];
                const parentBone = bones.has(bone.parent) ? bones.get(bone.parent) : null;
                const parentGroup = parentBone ? attachBone(parentBone.name, nextAncestry) : root;
                const parentPivot = parentBone && Array.isArray(parentBone.pivot) ? parentBone.pivot : [0, 0, 0];
                const group = new THREE.Group();
                group.position.set(
                    (pivot[0] - (Number(parentPivot[0]) || 0)) / 16,
                    (pivot[1] - (Number(parentPivot[1]) || 0)) / 16,
                    (pivot[2] - (Number(parentPivot[2]) || 0)) / 16
                );
                const rotation = Array.isArray(bone.rotation) ? bone.rotation : [0, 0, 0];
                group.rotation.set(
                    THREE.MathUtils.degToRad(Number(rotation[0]) || 0),
                    THREE.MathUtils.degToRad(Number(rotation[1]) || 0),
                    THREE.MathUtils.degToRad(Number(rotation[2]) || 0)
                );
                parentGroup.add(group);
                boneGroups.set(name, group);
                for (const cube of bone.cubes || []) {
                    const cubeGroup = createSparkModelCube(
                        cube,
                        pivot,
                        textureSize,
                        material,
                        {x, y, z},
                        type
                    );
                    if (cubeGroup) group.add(cubeGroup);
                }
                return group;
            }
            for (const bone of bones.values()) attachBone(bone.name);
            return root;
        }

        function drawAllBlockIcons() {
            document.querySelectorAll('.item-icon[data-block-icon]').forEach(canvas => drawBlockIcon(canvas, canvas.dataset.blockIcon));
            document.querySelectorAll('.item-icon[data-item-icon]').forEach(canvas => {
                if (blockIconTiles[canvas.dataset.itemIcon]) drawItemIcon(canvas, canvas.dataset.itemIcon);
            });
        }

        function tryLoadMinecraftTextures(onReady) {
            const names = [
                {key:'grassSide', src:'grass_block_side.png'},
                {key:'grassTop', src:'grass_block_top.png'},
                {key:'grassBottom', src:'dirt.png'},
                {key:'dirtSide', src:'dirt.png'},
                {key:'dirtTop', src:'dirt.png'},
                {key:'dirtBottom', src:'dirt.png'},
                {key:'sand', src:'sand.png'},
                {key:'snowTop', src:'snow.png'},
                {key:'snowSide', src:'grass_block_snow.png'},
                {key:'logSide', src:'oak_log.png'},
                {key:'logTop', src:'oak_log_top.png'},
                {key:'leaves', src:'oak_leaves.png'},
                {key:'stone', src:'stone.png'},
                {key:'ironOre', src:'iron_ore.png'},
                {key:'bedrock', src:'bedrock.png'},
                {key:'planks', src:'oak_planks.png'},
                {key:'craftingTableSide', src:'crafting_table_side.png'},
                {key:'craftingTableFront', src:'crafting_table_front.png'},
                {key:'craftingTableTop', src:'crafting_table_top.png'},
                {key:'furnaceSide', src:'furnace_side.png'},
                {key:'furnaceFront', src:'furnace_front.png'},
                {key:'furnaceTop', src:'furnace_top.png'},
                ...treeSpecies.flatMap(species => [
                    {key:`${species}Log`, src:`${species}_log.png`},
                    {key:`${species}LogTop`, src:`${species}_log_top.png`},
                    {key:`${species}Leaves`, src:`${species}_leaves.png`}
                ]),
                {key:'moss_block', src:'moss_block.png'},
                {key:'packed_ice', src:'packed_ice.png'},
                {key:'glow_mushroom', src:'red_mushroom_block.png'},
                {key:'mushroom_stem', src:'mushroom_stem.png'}
            ];
            const images = {};
            let loaded = 0;
            let failed = false;
            let done = false;
            const canUseCrossOrigin = location.protocol !== 'file:';
            const prefixes = ['assets/textures/block/'];
            function finish() {
                if (done) return;
                done = true;
                if (failed) {
                    console.warn('Texture pack not found or failed to load — using generated atlas fallback');
                } else {
                    console.log('Texture pack loaded and applied');
                }
                onReady();
            }
            function checkDone() {
                if (failed) {
                    finish();
                    return;
                }
                if (loaded !== names.length) return;
                const canvas2 = document.createElement('canvas');
                canvas2.width = atlasW;
                canvas2.height = atlasH;
                const ctx = canvas2.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                function drawTile(name, dx) {
                    const img = images[name];
                    if (!img) return;
                    const size = Math.min(img.width, img.height);
                    const sx = (img.width - size) / 2;
                    const sy = (img.height - size) / 2;
                    const temp = document.createElement('canvas');
                    temp.width = tile;
                    temp.height = tile;
                    const tctx = temp.getContext('2d');
                    tctx.imageSmoothingEnabled = false;
                    tctx.clearRect(0, 0, tile, tile);
                    tctx.drawImage(img, sx, sy, size, size, 0, 0, tile, tile);
                    ctx.drawImage(temp, dx, 0);
                }
                drawTile('grassBottom', 0);
                drawTile('grassTop', tile);
                drawTile('grassBottom', tile * 2);
                drawTile('dirtSide', tile * 3);
                drawTile('dirtTop', tile * 4);
                drawTile('dirtBottom', tile * 5);
                drawTile('sand', tile * 6);
                drawTile('snowTop', tile * 7);
                drawTile('logSide', tile * 8);
                drawTile('logTop', tile * 9);
                drawTile('leaves', tile * 10);
                drawTile('snowSide', tile * 11);
                drawTile('stone', tile * 12);
                drawTile('planks', tile * 13);
                drawTile('craftingTableSide', tile * 14);
                drawTile('craftingTableFront', tile * 15);
                drawTile('craftingTableTop', tile * 16);
                drawTile('ironOre', tile * 17);
                drawTile('bedrock', tile * 18);
                drawTile('furnaceSide', tile * 19);
                drawTile('furnaceFront', tile * 20);
                drawTile('furnaceTop', tile * 21);
                treeSpecies.forEach((species, index) => {
                    const start = 22 + index * 3;
                    drawTile(`${species}Log`, tile * start);
                    drawTile(`${species}LogTop`, tile * (start + 1));
                    drawTile(`${species}Leaves`, tile * (start + 2));
                });
                caveBlockTypes.forEach((type, index) => drawTile(type, tile * (caveTileStart + index)));
                blockTexture.image = canvas2;
                blockTexture.needsUpdate = true;
                drawAllBlockIcons();
                finish();
            }
            // attempt to load each named image, trying multiple common prefixes
            names.forEach(entry => {
                let tried = 0;
                const img = new Image();
                img.crossOrigin = canUseCrossOrigin ? 'anonymous' : '';
                function tryNextPrefix() {
                    if (tried >= prefixes.length) {
                        failed = true;
                        finish();
                        return;
                    }
                    const src = prefixes[tried] + entry.src;
                    tried++;
                    img.onload = () => {
                        if (done) return;
                        console.log('Loaded texture', entry.src, 'from', src);
                        images[entry.key] = img;
                        loaded += 1;
                        checkDone();
                    };
                    img.onerror = () => {
                        console.warn('Failed to load', src, '— trying next');
                        tryNextPrefix();
                    };
                    img.src = src;
                }
                tryNextPrefix();
            });
        }
        tryLoadMinecraftTextures(() => updateLowDetailColors());

        const blockGeo = new THREE.BoxGeometry(1, 1, 1);
        const tileU = 1 / atlasTileCount;
        const textureZoom = 1.0;
        function setFaceUV(geometry, faceIndex, tx) {
            const uv = geometry.attributes.uv.array;
            const offset = faceIndex * 8;
            const centerU = (tx + 0.5) * tileU;
            const centerV = 0.5;
            const halfU = tileU / (2.0 * textureZoom);
            const halfV = 1.0 / (2.0 * textureZoom);
            const u0 = centerU - halfU;
            const u1 = centerU + halfU;
            const v0 = centerV - halfV;
            const v1 = centerV + halfV;
            uv[offset + 0] = u1; uv[offset + 1] = v1;
            uv[offset + 2] = u0; uv[offset + 3] = v1;
            uv[offset + 4] = u1; uv[offset + 5] = v0;
            uv[offset + 6] = u0; uv[offset + 7] = v0;
        }
        function applyTextureSet(geometry, textureSet) {
            if (textureSet === 'furnace') {
                for (let face = 0; face < 6; face++) setFaceUV(geometry, face, face === 5 ? 20 : face === 2 || face === 3 ? 21 : 19);
                geometry.attributes.uv.needsUpdate = true;
                return;
            }
            if (textureSet === 'iron_ore' || textureSet === 'bedrock') {
                for (let face = 0; face < 6; face++) setFaceUV(geometry, face, textureSet === 'iron_ore' ? 17 : 18);
                geometry.attributes.uv.needsUpdate = true;
                return;
            }
            const sideTile = textureSet === 'log' ? 8 : textureSet === 'leaves' ? 10 : textureSet === 'stone' ? 12 : textureSet === 'planks' ? 13 : textureSet === 'crafting_table' ? 14 : textureSet === 'sand' ? 6 : textureSet === 'snow' ? 11 : textureSet === 'dirt' ? 3 : 0;
            const topTile = textureSet === 'log' ? 9 : textureSet === 'leaves' ? 10 : textureSet === 'stone' ? 12 : textureSet === 'planks' ? 13 : textureSet === 'crafting_table' ? 16 : textureSet === 'sand' ? 6 : textureSet === 'snow' ? 7 : textureSet === 'dirt' ? 4 : 1;
            const bottomTile = textureSet === 'log' ? 9 : textureSet === 'leaves' ? 10 : textureSet === 'stone' ? 12 : textureSet === 'planks' ? 13 : textureSet === 'crafting_table' ? 14 : textureSet === 'sand' ? 6 : textureSet === 'snow' ? 5 : textureSet === 'dirt' ? 5 : 2;
            setFaceUV(geometry, 0, sideTile);
            setFaceUV(geometry, 1, sideTile);
            setFaceUV(geometry, 4, sideTile);
            setFaceUV(geometry, 5, textureSet === 'crafting_table' ? 15 : sideTile);
            setFaceUV(geometry, 2, topTile);
            setFaceUV(geometry, 3, bottomTile);
            geometry.attributes.uv.needsUpdate = true;
        }

        const blockMat = new THREE.MeshStandardMaterial({map: blockTexture, roughness: 0.9, metalness: 0});
        const biomeBlockMat = new THREE.MeshStandardMaterial({map: blockTexture, roughness: 0.9, metalness: 0});
        const floorGroup = new THREE.Group();
        const chunkSize = PixameBiomes.chunkSize;
        const worldBottomY = -32;
        const chunkRadius = 12;
        const highDetailRadius = 80;
        const waterLevel = 1;
        const terrainChunks = new Map();
        const itemDefinitions = {
            grass: {label: 'Grass', color: '#45b83d'},
            dirt: {label: 'Dirt', color: '#765036'},
            sand: {label: 'Sand', color: '#d4bd7e'},
            snow: {label: 'Snow', color: '#e4f0f7'},
            wood: {label: 'Oak Wood', color: '#79522f'},
            leaves: {label: 'Oak Leaves', color: '#43863b'},
            stone: {label: 'Stone', color: '#777a79'},
            iron_ore: {label: 'Iron Ore', color: '#a87d66'},
            planks: {label: 'Oak Planks', color: '#b7834d'},
            sticks: {label: 'Sticks', color: '#93613a'},
            crafting_table: {label: 'Crafting Table', color: '#9c633b'},
            furnace: {label: 'Furnace', color: '#777a79'},
            iron_ingot: {label: 'Iron Ingot', color: '#d8d8d8'},
            wooden_pickaxe: {label: 'Wooden Pickaxe', color: '#b77a43'},
            stone_pickaxe: {label: 'Stone Pickaxe', color: '#83898a'},
            wooden_axe: {label: 'Wooden Axe', color: '#b77a43'},
            stone_axe: {label: 'Stone Axe', color: '#83898a'},
            wooden_sword: {label: 'Wooden Sword', color: '#b77a43'},
            stone_sword: {label: 'Stone Sword', color: '#83898a'},
            torch: {label: 'Torch', color: '#f3b44e'}
        };
        const placeableBlockTypes = new Set(['grass', 'dirt', 'sand', 'snow', 'wood', 'leaves', 'stone', 'iron_ore', 'planks', 'crafting_table', 'furnace']);
        for (const type of caveBlockTypes) {
            itemDefinitions[type] = {label: type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), color: '#888888'};
            placeableBlockTypes.add(type);
        }
        for (const species of treeSpecies) {
            const label = species.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
            for (const part of ['wood', 'leaves']) {
                const type = treeBlockType(species, part);
                itemDefinitions[type] = {label: `${label} ${part === 'wood' ? 'Wood' : 'Leaves'}`, color: part === 'wood' ? '#79522f' : '#43863b'};
                placeableBlockTypes.add(type);
            }
        }
        let sparkBlockPage = 0;
        const sparkBlocksPerPage = 48;
        const itemImageFileNames = {
            wooden_pickaxe: 'wooden_pickaxe',
            stone_pickaxe: 'stone_pickaxe',
            wooden_axe: 'wooden_axe',
            stone_axe: 'stone_axe',
            wooden_sword: 'wooden_sword',
            stone_sword: 'stone_sword'
        };
        async function loadSparkBlockDefinitions() {
            const response = await fetch('/api/spark-blocks');
            if (!response.ok) throw new Error(`Could not load Spark blocks (${response.status}).`);
            const definitions = await response.json();
            if (!Array.isArray(definitions)) throw new Error('Spark block list is invalid.');
            for (const definition of definitions) {
                if (!definition || typeof definition.type !== 'string' || !definition.type.startsWith('spark:') ||
                    typeof definition.category !== 'string' || typeof definition.label !== 'string' ||
                    typeof definition.textureUrl !== 'string' || !definition.textureUrl.startsWith('/spark/block/')) continue;
                sparkBlockDefinitions.set(definition.type, definition);
                itemDefinitions[definition.type] = {label: definition.label, color: '#777a79'};
                placeableBlockTypes.add(definition.type);
            }
            const categoryFilter = document.getElementById('spark-block-category');
            const categories = [...new Set([...sparkBlockDefinitions.values()].map(definition => definition.category))].sort();
            categoryFilter.replaceChildren(new Option('All categories', 'all'));
            categories.forEach(category => categoryFilter.add(new Option(category.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), category)));
            sparkBlocksReady = true;
            renderSparkBlockPalette();
            applyPendingWorldEdits();
        }
        const sparkBlockDefinitionsReady = loadSparkBlockDefinitions().catch(error => {
            console.error('Failed to load Spark block textures:', error);
            document.getElementById('spark-block-page-status').textContent = 'Could not load Spark blocks.';
            sparkBlocksReady = true;
            applyPendingWorldEdits();
        });
        async function loadSparkBlockModels() {
            const response = await fetch('/api/spark-block-models');
            if (!response.ok) throw new Error(`Could not load Spark block models (${response.status}).`);
            const models = await response.json();
            if (!Array.isArray(models)) throw new Error('Spark block model list is invalid.');
            for (const entry of models) {
                if (!entry || !entry.geometry || !Array.isArray(entry.geometry.bones)) continue;
                if (typeof entry.type === 'string' && entry.type.startsWith('spark:')) {
                    sparkNamedBlockModels.set(entry.type, entry.geometry);
                } else if (['armchair', 'chair', 'stool', 'table', 'balustrade', 'picket_fence'].includes(entry.family)) {
                    sparkBlockModels.set(entry.family, entry.geometry);
                }
            }
            if (sparkBlockModels.size === 0 && sparkNamedBlockModels.size === 0) {
                throw new Error('No supported Spark furniture models were found.');
            }
            const modelChunks = new Set();
            for (const [columnKey, blocks] of placedColumns) {
                const [x, z] = columnKey.split(',').map(Number);
                if ([...blocks.values()].some(type => getSparkModel(type))) {
                    modelChunks.add(`${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`);
                }
            }
            for (const chunk of terrainChunks.values()) {
                if (modelChunks.has(`${chunk.chunkX},${chunk.chunkZ}`)) {
                    rebuildTerrainChunkAt(chunk.chunkX * chunkSize, chunk.chunkZ * chunkSize);
                }
            }
        }
        const sparkBlockModelsReady = loadSparkBlockModels().catch(error => {
            console.error('Failed to load Spark block models; furniture will use cube rendering:', error);
        });
        const itemIconImageCache = new Map();
        const heldItemTextureCache = new Map();
        const heldItemModel = new THREE.Group();
        heldItemModel.position.set(0.36, -0.3, -0.72);
        heldItemModel.rotation.set(-0.2, -0.7, 1.35);
        heldItemModel.visible = false;
        heldItemCamera.add(heldItemModel);
        let heldItemModelType = null;

        function getItemIconImage(type) {
            const fileName = itemImageFileNames[type];
            if (!fileName) return null;
            let image = itemIconImageCache.get(type);
            if (!image) {
                image = new Image();
                itemIconImageCache.set(type, image);
                image.onload = () => {
                    document.querySelectorAll('.item-icon').forEach(canvas => {
                        if (canvas.dataset.itemIcon === type) drawItemIcon(canvas, type);
                    });
                    updateHeldItemModel();
                };
                image.onerror = error => {
                    console.warn(`Failed to load item texture assets/textures/item/${fileName}.png`, error);
                };
                image.src = `assets/textures/item/${fileName}.png`;
            }
            return image.complete && image.naturalWidth > 0 ? image : null;
        }

        function clearHeldItemModel() {
            const geometries = new Set();
            const materials = new Set();
            heldItemModel.children.forEach(mesh => {
                geometries.add(mesh.geometry);
                if (Array.isArray(mesh.material)) mesh.material.forEach(material => materials.add(material));
                else materials.add(mesh.material);
            });
            heldItemModel.clear();
            geometries.forEach(geometry => geometry.dispose());
            materials.forEach(material => material.dispose());
            heldItemModelType = null;
        }

        function createItemEdgeGeometry(image, size, depth) {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, width, height).data;
            const opaque = (x, y) => x >= 0 && x < width && y >= 0 && y < height &&
                pixels[(y * width + x) * 4 + 3] >= 26;
            const positions = [];
            const uvs = [];
            const indices = [];
            const modelWidth = size * width / Math.max(width, height);
            const modelHeight = size * height / Math.max(width, height);
            const addEdge = (x1, y1, x2, y2, u, v) => {
                const index = positions.length / 3;
                positions.push(x1, y1, -depth / 2, x2, y2, -depth / 2,
                    x2, y2, depth / 2, x1, y1, depth / 2);
                uvs.push(u, v, u, v, u, v, u, v);
                indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
            };
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (!opaque(x, y)) continue;
                    const left = (x / width - 0.5) * modelWidth;
                    const right = ((x + 1) / width - 0.5) * modelWidth;
                    const top = (0.5 - y / height) * modelHeight;
                    const bottom = (0.5 - (y + 1) / height) * modelHeight;
                    const u = (x + 0.5) / width;
                    const v = 1 - (y + 0.5) / height;
                    if (!opaque(x - 1, y)) addEdge(left, bottom, left, top, u, v);
                    if (!opaque(x + 1, y)) addEdge(right, top, right, bottom, u, v);
                    if (!opaque(x, y - 1)) addEdge(left, top, right, top, u, v);
                    if (!opaque(x, y + 1)) addEdge(right, bottom, left, bottom, u, v);
                }
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
            return geometry;
        }

        function updateHeldItemModel() {
            const selectedType = hotbarItems[selectedHotbarIndex]?.type;
            if (!selectedType || placeableBlockTypes.has(selectedType) || blockIconTiles[selectedType]) {
                clearHeldItemModel();
                return;
            }
            if (heldItemModelType === selectedType && heldItemModel.children.length) return;
            clearHeldItemModel();
            let image = getItemIconImage(selectedType);
            if (!image && itemImageFileNames[selectedType]) return;
            if (!image) {
                image = document.createElement('canvas');
                image.width = 32;
                image.height = 32;
                drawItemIcon(image, selectedType);
            }

            let texture = heldItemTextureCache.get(selectedType);
            if (!texture) {
                texture = new THREE.Texture(image);
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;
                texture.encoding = THREE.sRGBEncoding;
                texture.needsUpdate = true;
                heldItemTextureCache.set(selectedType, texture);
            }
            const size = 0.28;
            const depth = size / 8;
            const geometry = new THREE.PlaneGeometry(
                size * (image.naturalWidth || image.width) / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height),
                size * (image.naturalHeight || image.height) / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height)
            );
            const material = new THREE.MeshLambertMaterial({
                map: texture,
                alphaTest: 0.1,
                side: THREE.FrontSide
            });
            const edgeMaterial = material.clone();
            edgeMaterial.side = THREE.DoubleSide;
            const edges = new THREE.Mesh(createItemEdgeGeometry(image, size, depth), edgeMaterial);
            heldItemModel.add(edges);
            for (const z of [-depth / 2, depth / 2]) {
                const face = new THREE.Mesh(geometry, material);
                face.position.z = z;
                if (z < 0) face.rotation.y = Math.PI;
                heldItemModel.add(face);
            }
            heldItemModelType = selectedType;
        }

        const hotbarItems = Array(8).fill(null);
        const backpackItems = Array(27).fill(null);
        let selectedHotbarIndex = 0;
        let selectedInventoryItem = {container: 'hotbar', index: 0};
        let craftingReady = false;
        let playerInventoryOpen = false;
        let workbenchOpen = false;
        let furnaceOpen = false;
        const playerSaveKey = `pixame.player-save.v2.${roomId}`;
        let savedPlayerPosition = null;
        let playerSaveReady = false;
        let playerSaveTimer = null;
        const activeWaterCells = new Set();
        const activeTreeBlocks = new Set();
        const removedBlocks = new Set();
        const placedBlocks = new Map();
        const placedColumns = new Map();
        const waterSpreadRadius = 2;
        let currentTerrainChunkX = null;
        let currentTerrainChunkZ = null;
        let lastTerrainLodX = null;
        let lastTerrainLodZ = null;
        let lastCaveView = false;

        function readSavedSlots(savedSlots, slotCount) {
            if (!Array.isArray(savedSlots) || savedSlots.length !== slotCount) return Array(slotCount).fill(null);
            return savedSlots.map(slot => {
                if (!slot || !(itemDefinitions[slot.type] || typeof slot.type === 'string' && /^spark:[a-zA-Z0-9_/-]+$/.test(slot.type)) ||
                    !Number.isInteger(slot.count) || slot.count < 1 || slot.count > 99) return null;
                if (!itemDefinitions[slot.type]) {
                    const label = slot.type.slice(slot.type.lastIndexOf('/') + 1).replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                    itemDefinitions[slot.type] = {label, color: '#777a79'};
                }
                return {type: slot.type, count: slot.count};
            });
        }

        try {
            const savedPlayer = JSON.parse(localStorage.getItem(playerSaveKey) || 'null');
            if (savedPlayer) {
                hotbarItems.splice(0, hotbarItems.length, ...readSavedSlots(savedPlayer.hotbarItems, hotbarItems.length));
                backpackItems.splice(0, backpackItems.length, ...readSavedSlots(savedPlayer.backpackItems, backpackItems.length));
                if (Number.isInteger(savedPlayer.selectedHotbarIndex) && savedPlayer.selectedHotbarIndex >= 0 && savedPlayer.selectedHotbarIndex < hotbarItems.length) {
                    selectedHotbarIndex = savedPlayer.selectedHotbarIndex;
                    selectedInventoryItem = {container: 'hotbar', index: selectedHotbarIndex};
                }
                if (savedPlayer.position && Number.isFinite(savedPlayer.position.x) && Number.isFinite(savedPlayer.position.y) && Number.isFinite(savedPlayer.position.z)) {
                    savedPlayerPosition = savedPlayer.position;
                }
            }
        } catch (error) {
            console.error('Failed to read local player save:', error);
        }

        function savePlayerState() {
            if (!playerSaveReady) return;
            try {
                localStorage.setItem(playerSaveKey, JSON.stringify({
                    hotbarItems,
                    backpackItems,
                    selectedHotbarIndex,
                    position: {x: camera.position.x, y: camera.position.y, z: camera.position.z}
                }));
                scheduleAccountProfileSave();
            } catch (error) {
                console.error('Failed to save local player state:', error);
            }
        }

        function schedulePlayerSave() {
            if (!playerSaveReady || playerSaveTimer !== null) return;
            playerSaveTimer = window.setTimeout(() => {
                playerSaveTimer = null;
                savePlayerState();
            }, 250);
        }

        window.addEventListener('beforeunload', savePlayerState);

        const accountStorageKey = 'pixame.account-session.v1';
        const authScreen = document.getElementById('auth-screen');
        const authTitle = document.getElementById('auth-title');
        const authDescription = document.getElementById('auth-description');
        const authForm = document.getElementById('auth-form');
        const authUsername = document.getElementById('auth-username');
        const authPassword = document.getElementById('auth-password');
        const authSubmit = document.getElementById('auth-submit');
        const authSwitch = document.getElementById('auth-switch');
        const authMessage = document.getElementById('auth-message');
        const googleSignIn = document.getElementById('google-sign-in');
        let accountSession = null;
        let accountReady = false;
        let isPlayerAdmin = false;
        let flying = false;
        let profileRevision = 0;
        let signingUp = false;
        let accountProfileTimer = null;
        let profileSaveChain = Promise.resolve();
        let furnacePending = false;
        let furnaceSaveUncertain = false;

        try {
            accountSession = JSON.parse(localStorage.getItem(accountStorageKey) || 'null');
        } catch (error) {
            console.error('Failed to read account session:', error);
        }

        function playerProfile() {
            return {
                hotbarItems,
                backpackItems,
                selectedHotbarIndex,
                position: {x: camera.position.x, y: camera.position.y, z: camera.position.z}
            };
        }

        function applyPlayerProfile(profile) {
            if (!profile) return;
            hotbarItems.splice(0, hotbarItems.length, ...readSavedSlots(profile.hotbarItems, hotbarItems.length));
            backpackItems.splice(0, backpackItems.length, ...readSavedSlots(profile.backpackItems, backpackItems.length));
            if (Number.isInteger(profile.selectedHotbarIndex) && profile.selectedHotbarIndex >= 0 && profile.selectedHotbarIndex < hotbarItems.length) {
                selectedHotbarIndex = profile.selectedHotbarIndex;
                selectedInventoryItem = {container: 'hotbar', index: selectedHotbarIndex};
            }
            if (profile.position && Number.isFinite(profile.position.x) && Number.isFinite(profile.position.y) && Number.isFinite(profile.position.z)) {
                camera.position.set(profile.position.x, profile.position.y, profile.position.z);
            }
            updateHotbar();
        }

        function resetRoomPlayerProfile() {
            hotbarItems.fill(null);
            backpackItems.fill(null);
            selectedHotbarIndex = 0;
            selectedInventoryItem = {container: 'hotbar', index: 0};
            camera.position.copy(spawnPosition);
            updateHotbar();
        }

        function setAuthMode(isSignUp) {
            signingUp = isSignUp;
            authTitle.textContent = isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN';
            authDescription.textContent = isSignUp ? 'Create a local server account to keep this player across restarts.' : 'Sign in to restore this player’s saved inventory and position.';
            authSubmit.textContent = isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN';
            authSwitch.textContent = isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up';
            authPassword.autocomplete = isSignUp ? 'new-password' : 'current-password';
            authMessage.textContent = '';
        }

        function showAuth(message = '') {
            if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            if (socket.connected) socket.disconnect();
            setAdminStatus(false);
            authMessage.textContent = message;
            authScreen.hidden = false;
        }

        function hideAuth() {
            authScreen.hidden = true;
            authPassword.value = '';
            socket.auth = {token: accountSession.token};
            if (!socket.connected) socket.connect();
        }

        function setAdminStatus(enabled) {
            isPlayerAdmin = enabled === true;
            document.getElementById('admin-creative-items').hidden = !isPlayerAdmin;
            document.querySelector('[data-open-blocks]').hidden = !isPlayerAdmin;
            const button = document.getElementById('admin-flight');
            button.hidden = !isPlayerAdmin;
            document.getElementById('admin-open').hidden = !isPlayerAdmin;
            document.getElementById('mobile-down').hidden = !isPlayerAdmin;
            if (!isPlayerAdmin) document.getElementById('admin-screen').hidden = true;
            if (!isPlayerAdmin) flying = false;
            button.textContent = `FLIGHT [F]: ${flying ? 'ON' : 'OFF'}`;
            updateHotbar();
        }

        async function sendAccountProfile() {
            if (!accountSession || !accountReady || !playerSaveReady) return;
            const response = await fetch('/api/player-profile', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${accountSession.token}`, 'X-Profile-Revision': String(profileRevision), 'X-Pixame-Room': roomId},
                body: JSON.stringify(playerProfile())
            });
            if (response.status === 401) {
                accountReady = false;
                accountSession = null;
                localStorage.removeItem(accountStorageKey);
                showAuth('Your session expired. Please sign in again.');
                throw new Error('Your session expired. Please sign in again.');
            }
            if (response.status === 409) {
                accountReady = false;
                furnaceSaveUncertain = true;
                showAuth('Player data changed in another session. Sign in again.');
                throw new Error('Player profile conflict.');
            }
            if (!response.ok) throw new Error((await response.json()).error || 'Could not save player profile.');
            profileRevision = (await response.json()).revision;
        }

        function saveAccountProfile() {
            if (furnacePending || furnaceSaveUncertain) return Promise.resolve();
            const save = profileSaveChain.then(() => sendAccountProfile());
            profileSaveChain = save.catch(error => console.error('Failed to save account profile:', error));
            return save;
        }

        function scheduleAccountProfileSave() {
            if (!accountSession || !accountReady || accountProfileTimer !== null || furnacePending || furnaceSaveUncertain) return;
            accountProfileTimer = window.setTimeout(() => {
                accountProfileTimer = null;
                saveAccountProfile().catch(error => console.error('Failed to save account profile:', error));
            }, 1000);
        }

        authSwitch.addEventListener('click', () => setAuthMode(!signingUp));
        async function initializeGoogleSignIn() {
            try {
                const response = await fetch('/api/auth/google-config');
                if (!response.ok) throw new Error('Google sign-in configuration is unavailable.');
                const config = await response.json();
                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.onload = () => {
                    google.accounts.id.initialize({
                        client_id: config.clientId,
                        callback: async ({credential}) => {
                            if (authSubmit.disabled) return;
                            authSubmit.disabled = true;
                            authMessage.textContent = '';
                            try {
                                await sparkBlockDefinitionsReady;
                                const result = await fetch('/api/auth/google', {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json', 'X-Pixame-Room': roomId},
                                    body: JSON.stringify({credential})
                                });
                                const payload = await result.json();
                                if (!result.ok) throw new Error(payload.error || 'Google sign-in failed.');
                                if (!payload.profile) resetRoomPlayerProfile();
                                accountSession = {token: payload.token, username: payload.username};
                                profileRevision = payload.revision;
                                accountReady = true;
                                setAdminStatus(payload.isAdmin);
                                furnaceSaveUncertain = false;
                                localStorage.setItem(accountStorageKey, JSON.stringify(accountSession));
                                if (payload.profile) applyPlayerProfile(payload.profile);
                                await saveAccountProfile();
                                if (!accountReady) return;
                                hideAuth();
                            } catch (error) {
                                console.error('Google sign-in failed:', error);
                                authMessage.textContent = error.message;
                            } finally {
                                authSubmit.disabled = false;
                            }
                        }
                    });
                    google.accounts.id.renderButton(googleSignIn, {theme: 'outline', size: 'large'});
                };
                script.onerror = () => {
                    console.error('Failed to load Google sign-in.');
                    authMessage.textContent = 'Google sign-in could not be loaded.';
                };
                document.head.appendChild(script);
            } catch (error) {
                console.error('Failed to initialize Google sign-in:', error);
                authMessage.textContent = error.message;
            }
        }
        authForm.addEventListener('submit', async event => {
            event.preventDefault();
            authMessage.textContent = '';
            authSubmit.disabled = true;
            try {
                const response = await fetch(signingUp ? '/api/auth/signup' : '/api/auth/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-Pixame-Room': roomId},
                    body: JSON.stringify({username: authUsername.value, password: authPassword.value})
                });
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    throw new Error('The game server needs to be restarted before account login is available.');
                }
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Account request failed.');
                if (!payload.profile) resetRoomPlayerProfile();
                accountSession = {token: payload.token, username: payload.username};
                profileRevision = payload.revision;
                accountReady = true;
                setAdminStatus(payload.isAdmin);
                furnaceSaveUncertain = false;
                localStorage.setItem(accountStorageKey, JSON.stringify(accountSession));
                if (payload.profile) applyPlayerProfile(payload.profile);
                await saveAccountProfile();
                hideAuth();
            } catch (error) {
                authMessage.textContent = error.message;
            } finally {
                authSubmit.disabled = false;
            }
        });

        async function initializeAccountSession() {
            await sparkBlockDefinitionsReady;
            if (!accountSession?.token) {
                showAuth();
                return;
            }
            try {
                const response = await fetch('/api/auth/session', {headers: {Authorization: `Bearer ${accountSession.token}`, 'X-Pixame-Room': roomId}});
                if (!response.ok) throw new Error('Session expired.');
                const payload = await response.json();
                if (!payload.profile) resetRoomPlayerProfile();
                accountSession.username = payload.username;
                profileRevision = payload.revision;
                accountReady = true;
                setAdminStatus(payload.isAdmin);
                localStorage.setItem(accountStorageKey, JSON.stringify(accountSession));
                applyPlayerProfile(payload.profile);
                hideAuth();
            } catch (error) {
                accountSession = null;
                localStorage.removeItem(accountStorageKey);
                showAuth('Please sign in to continue.');
            }
        }

        function blockKey(x, y, z) {
            return `${x},${y},${z}`;
        }

        function terrainColumnKey(x, z) {
            return `${x},${z}`;
        }

        function updateHotbar() {
            const hotbar = document.getElementById('hotbar');
            hotbar.replaceChildren();
            hotbarItems.forEach((slotItem, index) => {
                const slot = document.createElement('button');
                const item = slotItem ? itemDefinitions[slotItem.type] : null;
                slot.type = 'button';
                slot.className = `hotbar-slot${index === selectedHotbarIndex ? ' selected' : ''}${item ? '' : ' empty'}`;
                slot.title = item ? `${index + 1}: ${item.label}` : `${index + 1}: Empty`;
                slot.setAttribute('aria-pressed', String(index === selectedHotbarIndex));
                slot.innerHTML = item
                    ? `<span class="slot-number">${index + 1}</span><canvas class="item-icon" data-item-icon="${slotItem.type}" width="36" height="36"></canvas><span class="item-count">${isPlayerAdmin && placeableBlockTypes.has(slotItem.type) ? '∞' : slotItem.count}</span>`
                    : `<span class="slot-number">${index + 1}</span>`;
                slot.addEventListener('click', event => {
                    event.stopPropagation();
                    selectedHotbarIndex = index;
                    updateHotbar();
                    showItemNotification();
                });
                hotbar.appendChild(slot);
                if (item) drawItemIcon(slot.querySelector('.item-icon'), slotItem.type);
            });
            if (craftingReady) refreshCraftingUI();
            if (playerInventoryOpen) refreshPlayerInventoryUI();
            if (workbenchOpen) refreshWorkbenchUI();
            if (furnaceOpen) refreshFurnaceUI();
            updateHeldItemModel();
            schedulePlayerSave();
        }

        function canStoreItem(type) {
            return [...hotbarItems, ...backpackItems].some(slot => slot?.type === type && slot.count < 99) ||
                [...hotbarItems, ...backpackItems].some(slot => slot === null);
        }

        function storeItem(type) {
            const allSlots = [hotbarItems, backpackItems];
            const existingSlot = allSlots.flat().find(slot => slot?.type === type && slot.count < 99);
            if (existingSlot) {
                existingSlot.count++;
                return true;
            }
            const container = allSlots.find(items => items.some(slot => slot === null));
            if (!container) return false;
            container[container.findIndex(slot => slot === null)] = {type, count: 1};
            return true;
        }

        function itemCount(type) {
            return [...hotbarItems, ...backpackItems].reduce((count, slot) => count + (slot?.type === type ? slot.count : 0), 0);
        }

        function canStoreItems(type, count) {
            const availableCapacity = [...hotbarItems, ...backpackItems].reduce((capacity, slot) => {
                if (slot === null) return capacity + 99;
                return capacity + (slot.type === type ? 99 - slot.count : 0);
            }, 0);
            return availableCapacity >= count;
        }

        function storeItems(type, count) {
            if (!canStoreItems(type, count)) return false;
            for (let remaining = count; remaining > 0;) {
                const existingSlot = [...hotbarItems, ...backpackItems].find(slot => slot?.type === type && slot.count < 99);
                if (existingSlot) {
                    const added = Math.min(99 - existingSlot.count, remaining);
                    existingSlot.count += added;
                    remaining -= added;
                    continue;
                }
                const container = [hotbarItems, backpackItems].find(items => items.some(slot => slot === null));
                const emptyIndex = container.findIndex(slot => slot === null);
                const added = Math.min(99, remaining);
                container[emptyIndex] = {type, count: added};
                remaining -= added;
            }
            return true;
        }

        function removeItems(type, count) {
            if (isPlayerAdmin && itemCount(type) > 0) return true;
            if (itemCount(type) < count) return false;
            for (const container of [hotbarItems, backpackItems]) {
                for (let index = 0; index < container.length && count > 0; index++) {
                    const slot = container[index];
                    if (!slot || slot.type !== type) continue;
                    const removed = Math.min(slot.count, count);
                    slot.count -= removed;
                    count -= removed;
                    if (slot.count === 0) container[index] = null;
                }
            }
            return true;
        }

        updateHotbar();

        const grassGeo = blockGeo.clone();
        applyTextureSet(grassGeo, 'grass');
        const dirtGeo = blockGeo.clone();
        applyTextureSet(dirtGeo, 'dirt');
        const sandGeo = blockGeo.clone();
        applyTextureSet(sandGeo, 'sand');
        const snowGeo = blockGeo.clone();
        applyTextureSet(snowGeo, 'snow');
        const woodGeo = blockGeo.clone();
        applyTextureSet(woodGeo, 'log');
        const stoneGeo = blockGeo.clone();
        applyTextureSet(stoneGeo, 'stone');
        const ironOreGeo = blockGeo.clone();
        applyTextureSet(ironOreGeo, 'iron_ore');
        const bedrockGeo = blockGeo.clone();
        applyTextureSet(bedrockGeo, 'bedrock');
        const planksGeo = blockGeo.clone();
        applyTextureSet(planksGeo, 'planks');
        const craftingTableGeo = blockGeo.clone();
        applyTextureSet(craftingTableGeo, 'crafting_table');
        const furnaceGeo = blockGeo.clone();
        applyTextureSet(furnaceGeo, 'furnace');
        const leavesGeo = blockGeo.clone();
        applyTextureSet(leavesGeo, 'leaves');
        const leavesMaterial = new THREE.MeshStandardMaterial({map: blockTexture, alphaTest: 0.35, roughness: 1, metalness: 0});
        const treeGeometries = Object.fromEntries(treeSpecies.map((species, index) => {
            const log = blockGeo.clone();
            const leaves = blockGeo.clone();
            const start = 22 + index * 3;
            for (let face = 0; face < 6; face++) {
                setFaceUV(log, face, face === 2 || face === 3 ? start + 1 : start);
                setFaceUV(leaves, face, start + 2);
            }
            log.attributes.uv.needsUpdate = true;
            leaves.attributes.uv.needsUpdate = true;
            return [species, {log, leaves}];
        }));
        const caveGeometries = Object.fromEntries(caveBlockTypes.map((type, index) => {
            const geometry = blockGeo.clone();
            for (let face = 0; face < 6; face++) setFaceUV(geometry, face, caveTileStart + index);
            geometry.attributes.uv.needsUpdate = true;
            return [type, geometry];
        }));
        const glowMushroomMaterial = blockMat.clone();
        glowMushroomMaterial.emissive.setHex(0x782219);
        glowMushroomMaterial.emissiveIntensity = 0.7;
        const grassSideMaterial = blockMat.clone();
        grassSideMaterial.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <color_vertex>',
                '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = vec3(1.0);\n#endif'
            );
        };
        const grassMaterials = [grassSideMaterial, grassSideMaterial, biomeBlockMat, grassSideMaterial, grassSideMaterial, grassSideMaterial];
        const grassOverlayTexture = new THREE.Texture();
        grassOverlayTexture.magFilter = THREE.NearestFilter;
        grassOverlayTexture.minFilter = THREE.NearestFilter;
        grassOverlayTexture.generateMipmaps = false;
        const grassOverlayMaterial = new THREE.MeshStandardMaterial({
            map: grassOverlayTexture, transparent: true, alphaTest: 0.1, roughness: 0.9, metalness: 0
        });
        grassOverlayMaterial.visible = false;
        const grassOverlayGeo = blockGeo.clone();
        grassOverlayGeo.scale(1.002, 1, 1.002);
        grassOverlayGeo.clearGroups();
        for (const face of [0, 1, 4, 5]) grassOverlayGeo.addGroup(face * 6, 6, 0);
        let foliageColorMap = null;
        function sampleClimateColor(map, column) {
            if (!map) return [1, 1, 1];
            const temperature = clamp01(column.temperature ?? 0.6);
            const moisture = clamp01(column.moisture ?? 0.6);
            const sample = (x, y) => {
                const px = Math.round(x * (map.width - 1));
                const py = Math.round(y * (map.height - 1));
                const offset = (py * map.width + px) * 4;
                return Array.from(map.data.slice(offset, offset + 3), channel => channel / 255);
            };
            const color = sample(1 - temperature, 1 - temperature * moisture);
            const snow = clamp01(column.snowWeight ?? 0);
            const cold = sample(0.85, 0.05);
            return color.map((channel, index) => channel * (1 - snow) + cold[index] * snow);
        }
        function grassBiomeColor(column) {
            return sampleClimateColor(grassColorMap, column);
        }
        function foliageBiomeColor(column, species) {
            if (species === 'cherry') return [1, 1, 1];
            const color = sampleClimateColor(foliageColorMap, column);
            const frost = smoothstep(0.65, 1, column.snowWeight ?? 0);
            return color.map((channel, index) => channel * (1 - frost) + [0.78, 0.9, 1][index] * frost);
        }
        const lowDetailSideTiles = {
            grass: 0, dirt: 3, sand: 6, snow: 11, wood: 8, leaves: 10,
            stone: 12, iron_ore: 17, bedrock: 18, planks: 13, crafting_table: 14, furnace: 19,
            ...Object.fromEntries(caveBlockTypes.map((type, index) => [type, caveTileStart + index]))
        };
        const lowDetailMaterials = Object.fromEntries(Object.keys(lowDetailSideTiles).map(type => [
            type, new THREE.MeshStandardMaterial({roughness: 0.9, metalness: 0})
        ]));
        const lowTreeMaterials = Object.fromEntries(treeSpecies.map(species => [species, {
            wood: new THREE.MeshStandardMaterial({roughness: 0.9, metalness: 0}),
            leaves: new THREE.MeshStandardMaterial({roughness: 0.9, metalness: 0})
        }]));
        let lowGrassBase = [1, 1, 1];
        let lowGrassOverlay = null;

        function sampleOpaquePixel(image, x = 0, y = 0, width = image.width, height = image.height) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(image, x, y, width, height, 0, 0, width, height);
            const data = context.getImageData(0, 0, width, height).data;
            // Transparent corners cannot provide a visible color; use the first visible pixel.
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] !== 0) return Array.from(data.slice(i, i + 4), channel => channel / 255);
            }
            return null;
        }

        function applyLowDetailPixel(material, pixel) {
            material.visible = !!pixel;
            if (pixel) material.color.setRGB(pixel[0], pixel[1], pixel[2]);
        }

        function lowGrassColor(column) {
            if (!lowGrassOverlay) return lowGrassBase;
            const tint = grassBiomeColor(column);
            const alpha = lowGrassOverlay[3];
            return lowGrassBase.map((channel, i) => channel * (1 - alpha) + lowGrassOverlay[i] * tint[i] * alpha);
        }

        function updateLowDetailColors() {
            for (const [type, index] of Object.entries(lowDetailSideTiles)) {
                const pixel = sampleOpaquePixel(blockTexture.image, index * tile, 0, tile, tile);
                if (type === 'grass') {
                    if (pixel) lowGrassBase = pixel.slice(0, 3);
                    lowDetailMaterials.grass.visible = !!pixel;
                } else {
                    applyLowDetailPixel(lowDetailMaterials[type], pixel);
                }
            }
            treeSpecies.forEach((species, index) => {
                const start = 22 + index * 3;
                applyLowDetailPixel(lowTreeMaterials[species].wood, sampleOpaquePixel(blockTexture.image, start * tile, 0, tile, tile));
                applyLowDetailPixel(lowTreeMaterials[species].leaves, sampleOpaquePixel(blockTexture.image, (start + 2) * tile, 0, tile, tile));
            });
            refreshGrassColors();
        }

        function getLowSparkMaterial(type) {
            let material = lowSparkMaterials.get(type);
            if (!material) {
                material = new THREE.MeshStandardMaterial({color: itemDefinitions[type].color, roughness: 0.9, metalness: 0});
                lowSparkMaterials.set(type, material);
                const image = getSparkBlockImage(type);
                if (image) applyLowDetailPixel(material, sampleOpaquePixel(image));
            }
            return material;
        }
        updateLowDetailColors();
        const waterGeo = new THREE.BoxGeometry(1, 1, 1);
        const waterCanvas = document.createElement('canvas');
        waterCanvas.width = 32;
        waterCanvas.height = 32;
        const waterContext = waterCanvas.getContext('2d');
        waterContext.fillStyle = '#3c9bc4';
        waterContext.fillRect(0, 0, 32, 32);
        const waterTexture = new THREE.CanvasTexture(waterCanvas);
        waterTexture.magFilter = THREE.NearestFilter;
        waterTexture.minFilter = THREE.NearestFilter;
        waterTexture.wrapS = THREE.RepeatWrapping;
        waterTexture.wrapT = THREE.RepeatWrapping;
        waterTexture.repeat.set(2, 2);
        const waterMaterial = new THREE.MeshStandardMaterial({
            map: waterTexture,
            color: 0xffffff,
            roughness: 0.45,
            metalness: 0,
            transparent: true,
            opacity: 0.88,
            depthWrite: false
        });

        function addBlockInstances(targetGroup, blocks, geometry, material, blockType = null, castsShadow = true) {
            if (blocks.length === 0) return;
            const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
            mesh.userData.blockRecords = blocks;
            mesh.userData.blockType = blockType;
            mesh.userData.blockShadowCaster = castsShadow;
            const matrix = new THREE.Matrix4();
            const rotation = new THREE.Quaternion();
            const position = new THREE.Vector3();
            const scale = new THREE.Vector3(1, 1, 1);
            const instanceColor = new THREE.Color();
            for (let i = 0; i < blocks.length; i++) {
                const [x, y, z, height = 1, colorR, colorG, colorB] = blocks[i];
                position.set(x + 0.5, y + height / 2, z + 0.5);
                scale.set(1, height, 1);
                matrix.compose(position, rotation, scale);
                mesh.setMatrixAt(i, matrix);
                if (colorR !== undefined) {
                    instanceColor.setRGB(colorR, colorG, colorB);
                    mesh.setColorAt(i, instanceColor);
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            targetGroup.add(mesh);
            return mesh;
        }

        function addWaterInstances(targetGroup, cells) {
            const visibleCells = [];
            for (const [x, y, z, height = 1] of cells) {
                if (height === 1) {
                    if (!placedBlocks.has(blockKey(x, y, z))) visibleCells.push([x, y, z, 1]);
                } else if (!placedBlocks.has(blockKey(x, y, z)) && !placedBlocks.has(blockKey(x, y + 1, z))) {
                    visibleCells.push([x, y, z, height]);
                } else {
                    for (let dy = 0; dy < height; dy++) {
                        if (!placedBlocks.has(blockKey(x, y + dy, z))) visibleCells.push([x, y + dy, z, 1]);
                    }
                }
            }
            if (visibleCells.length === 0) return;
            const mesh = new THREE.InstancedMesh(waterGeo, waterMaterial, visibleCells.length);
            const matrix = new THREE.Matrix4();
            const rotation = new THREE.Quaternion();
            const position = new THREE.Vector3();
            const scale = new THREE.Vector3(1, 1, 1);
            for (let i = 0; i < visibleCells.length; i++) {
                const [x, y, z, height] = visibleCells[i];
                position.set(x + 0.5, y + height / 2, z + 0.5);
                scale.set(1, height, 1);
                matrix.compose(position, rotation, scale);
                mesh.setMatrixAt(i, matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 1;
            targetGroup.add(mesh);
        }

        function createBlockMesh(worldX, worldY, worldZ, textureSet) {
            const geo = blockGeo.clone();
            applyTextureSet(geo, textureSet);
            const cube = new THREE.Mesh(geo, blockMat);
            cube.position.set(worldX + 0.5, worldY + 0.5, worldZ + 0.5);
            cube.castShadow = true;
            cube.receiveShadow = true;
            cube.userData.worldPos = {x: worldX, y: worldY, z: worldZ};
            return cube;
        }

        let terrainSeed = roomSeeds[roomId];
        function seededTerrainRandom() {
            terrainSeed = (Math.imul(terrainSeed, 1664525) + 1013904223) >>> 0;
            return terrainSeed / 4294967296;
        }

        function shuffledPermutation(size) {
            const arr = Array.from({length: size}, (_, i) => i);
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(seededTerrainRandom() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        const perm = shuffledPermutation(256).concat(shuffledPermutation(256));
        function fade(t) {
            return t * t * t * (t * (t * 6 - 15) + 10);
        }
        function lerp(a, b, t) {
            return a + t * (b - a);
        }
        function grad(hash, x, y) {
            const h = hash & 7;
            const u = h < 4 ? x : y;
            const v = h < 4 ? y : x;
            return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
        }
        function perlinNoise2D(x, y) {
            const X = Math.floor(x) & 255;
            const Y = Math.floor(y) & 255;
            const xf = x - Math.floor(x);
            const yf = y - Math.floor(y);
            const u = fade(xf);
            const v = fade(yf);
            const aa = perm[perm[X] + Y];
            const ab = perm[perm[X] + Y + 1];
            const ba = perm[perm[X + 1] + Y];
            const bb = perm[perm[X + 1] + Y + 1];
            const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
            const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
            return lerp(x1, x2, v);
        }
        function fbmNoise(x, z) {
            let total = 0;
            let amplitude = 0.5;
            let frequency = 1;
            for (let i = 0; i < 4; i++) {
                total += amplitude * perlinNoise2D(x * frequency, z * frequency);
                frequency *= 2;
                amplitude *= 0.5;
            }
            return total;
        }
        function clamp01(value) {
            return Math.max(0, Math.min(1, value));
        }

        function smoothstep(edge0, edge1, value) {
            const t = clamp01((value - edge0) / (edge1 - edge0));
            return t * t * (3 - 2 * t);
        }

        function sampleRiverField(worldX, worldZ) {
            return fbmNoise(worldX * 0.009 + 318.5, worldZ * 0.009 - 207.4);
        }

        function sampleTerrainColumn(worldX, worldZ) {
            const climate = PixameBiomes.sampleClimate(worldX, worldZ, roomSeeds[roomId]);
            const region = climate.region;
            const baseTemperature = climate.temperature;
            const moisture = climate.moisture;
            const warmWeight = smoothstep(0.58, 0.84, baseTemperature);
            const dryWeight = 1 - smoothstep(0.3, 0.7, moisture);
            const broadDesertWeight = warmWeight * dryWeight;
            const rangeWarp = fbmNoise(worldX * 0.003 + 71.4, worldZ * 0.003 - 168.2) * 48;
            const rangeCenter = Math.sin(worldX * 0.006) * 46 + Math.sin(worldX * 0.013 + 1.1) * 16;
            const rangeOffset = worldZ + rangeWarp - rangeCenter;
            const rangeDistance = Math.abs(rangeOffset - Math.round(rangeOffset / 190) * 190);
            const rangeRegion = smoothstep(-0.12, 0.3, fbmNoise(worldX * 0.004 + 101.8, worldZ * 0.004 + 28.6));
            const mountainness = (1 - smoothstep(10, 36, rangeDistance)) * rangeRegion;
            const ridgeNoise = 1 - Math.abs(fbmNoise(worldX * 0.026 - 42.7, worldZ * 0.026 + 93.1));
            const mountainRelief = mountainness * (3 + ridgeNoise * 15) * (1 - broadDesertWeight * 0.65);
            const temperature = clamp01(baseTemperature - Math.max(0, mountainRelief - 2) * 0.045);
            const snowWeight = 1 - smoothstep(0.16, 0.48, temperature);
            const desertWeight = smoothstep(0.58, 0.84, temperature) * (1 - smoothstep(0.3, 0.7, moisture)) * (1 - snowWeight);
            const grassWeight = Math.max(0, 1 - snowWeight - desertWeight);
            const terrainNoise = fbmNoise(worldX * 0.045, worldZ * 0.045);
            const rollingHills = fbmNoise(worldX * 0.014 - 48.3, worldZ * 0.014 + 72.6);
            const hillRegion = smoothstep(-0.15, 0.12, fbmNoise(worldX * 0.004 + 211, worldZ * 0.004 - 337));
            const hillShape = smoothstep(-0.3, 0.45, rollingHills);
            const baseHeight = 4 + hillRegion * Math.max(0, 1 + hillShape * 12 + terrainNoise * 2);
            const climateHeight = baseHeight * (1 - desertWeight * 0.15) + snowWeight;
            const humidRelief = (moisture - 0.5) * 1.2 * grassWeight;
            const riverField = sampleRiverField(worldX, worldZ);
            const riverNoise = Math.abs(riverField);
            const riverClimate = smoothstep(0.3, 0.58, moisture) * (1 - snowWeight) * (1 - mountainness * 0.7);
            const riverWeight = (1 - smoothstep(0.024, 0.09, riverNoise)) * riverClimate;
            const riverBankWeight = (1 - smoothstep(0.04, 0.4, riverNoise)) *
                smoothstep(0.15, 0.35, moisture) * smoothstep(0.1, 0.25, baseTemperature);
            const terrainHeight = Math.max(1, Math.round(lerp(climateHeight + mountainRelief + humidRelief, 1, riverBankWeight)));
            const isWater = riverWeight > 0.54 && mountainness < 0.45 && snowWeight < 0.6;
            const height = isWater ? -1 : terrainHeight;
            const choiceValue = Math.sin(worldX * 127.1 + worldZ * 311.7 + roomSeeds[roomId]) * 43758.5453;
            let choice = choiceValue - Math.floor(choiceValue);
            let vegetationRegion = region;
            for (const transition of climate.transitions) {
                choice -= transition.weight;
                if (choice < 0) { vegetationRegion = transition.region; break; }
            }
            const biome = isWater ? 'river'
                : mountainness > 0.52 ? 'mountain'
                : climate.transitions.length ? 'transition' : region.name;
            const surfaceType = vegetationRegion.name === 'desert' && biome !== 'mountain' ? 'sand' : 'grass';
            const secondaryRoll = Math.sin(worldX * 51.3 + worldZ * 97.7) * 15731.743;
            const regionTree = vegetationRegion.secondTree && secondaryRoll - Math.floor(secondaryRoll) < 0.5
                ? vegetationRegion.secondTree : vegetationRegion.tree;
            const treeSpecies = biome === 'river' ? null : biome === 'mountain' ? 'spruce' : regionTree;
            const treeDensity = biome === 'river' ? 0 : biome === 'mountain' ? 0.008 : vegetationRegion.density;
            const grassRed = 0.36 - moisture * 0.05;
            const grassGreen = 0.52 + moisture * 0.16;
            const grassBlue = 0.18 + moisture * 0.04;
            const color = [
                grassRed * grassWeight + 0.82 * desertWeight + 0.76 * snowWeight,
                grassGreen * grassWeight + 0.68 * desertWeight + 0.88 * snowWeight,
                grassBlue * grassWeight + 0.42 * desertWeight + 0.98 * snowWeight
            ];
            return {height, temperature, moisture, mountainness, mountainRelief, riverField, riverWeight, isWater, snowWeight, desertWeight, grassWeight, biome, surfaceType, treeSpecies, treeDensity, color};
        }

        function sampleTerrainHeight(worldX, worldZ) {
            const cellX = Math.floor(worldX);
            const cellZ = Math.floor(worldZ);
            let height = activeWaterCells.has(terrainColumnKey(cellX, cellZ)) ? -1 : sampleTerrainColumn(cellX, cellZ).height;
            while (height > 0 && removedBlocks.has(blockKey(cellX, height - 1, cellZ))) height--;
            const placed = placedColumns.get(terrainColumnKey(cellX, cellZ));
            if (placed) {
                for (const y of placed.keys()) height = Math.max(height, y + 1);
            }
            return height;
        }

        function isWaterAt(worldX, worldZ) {
            const cellX = Math.floor(worldX);
            const cellZ = Math.floor(worldZ);
            return activeWaterCells.has(terrainColumnKey(cellX, cellZ)) || sampleTerrainColumn(cellX, cellZ).isWater;
        }

        function caveProfileAt(x, z) {
            return PixameCaves.sample(x, z, roomSeeds[roomId], PixameBiomes.sampleClimate(x, z, roomSeeds[roomId]));
        }

        function isCaveAir(x, y, z) {
            return y > worldBottomY && y < -4 && PixameCaves.contains(caveProfileAt(x, z), y);
        }

        function waterSurfaceAt(worldX, feetY, worldZ) {
            const x = Math.floor(worldX), z = Math.floor(worldZ);
            if (feetY >= -1 && feetY < waterLevel && isWaterAt(worldX, worldZ) &&
                !placedBlocks.has(blockKey(x, Math.floor(feetY), z))) return waterLevel;
            if (feetY <= worldBottomY) return null;
            const cave = caveProfileAt(x, z);
            return cave?.water && feetY >= cave.floor && feetY < cave.floor + 1 &&
                !placedBlocks.has(blockKey(x, cave.floor, z)) ? cave.floor + 1 : null;
        }

        function undergroundBlockType(x, y, z) {
            if (y === worldBottomY) return 'bedrock';
            const veinX = Math.floor(x / 2);
            const veinY = Math.floor(y / 2);
            const veinZ = Math.floor(z / 2);
            const value = Math.sin(veinX * 127.1 + veinY * 311.7 + veinZ * 74.7) * 43758.5453;
            return value - Math.floor(value) < 0.1 ? 'iron_ore' : 'stone';
        }

        function addGroupedBlock(blocksByType, type, block) {
            if (!blocksByType.has(type)) blocksByType.set(type, []);
            blocksByType.get(type).push(block);
        }

        function buildTerrainChunk(chunkX, chunkZ, lod, caveDetail = false) {
            const chunkGroup = new THREE.Group();
            const highGrass = [];
            const highDirt = [];
            const highStone = [];
            const highIronOre = [];
            const highBedrock = [];
            const highSand = [];
            const highSnow = [];
            const highWood = [];
            const highPlanks = [];
            const highCraftingTables = [];
            const highFurnaces = [];
            const highLeaves = [];
            const highCaveBlocks = new Map();
            const treeBlocks = new Map();
            const highSparkBlocks = new Map();
            const highSparkModelBlocks = [];
            const lowTerrainBlocks = new Map();
            const lowPlacedBlocks = new Map();
            const lowSparkBlocks = new Map();
            const waterCells = [];
            const waterBed = [];
            const caveWaterCells = [];
            const treeKeys = [];
            const startX = chunkX * chunkSize;
            const startZ = chunkZ * chunkSize;
            if (lod === 'high') {
                const exposed = new Set();
                for (const key of removedBlocks) {
                    const [x, y, z] = key.split(',').map(Number);
                    if (y < worldBottomY || y > 0) continue;
                    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                        const bx = x + dx, by = y + dy, bz = z + dz;
                        if (bx < startX || bx >= startX + chunkSize || bz < startZ || bz >= startZ + chunkSize ||
                            by < worldBottomY || by >= 0) continue;
                        const neighborKey = blockKey(bx, by, bz);
                        if (exposed.has(neighborKey) || placedBlocks.has(neighborKey) ||
                            (by > worldBottomY && removedBlocks.has(neighborKey)) || isCaveAir(bx, by, bz)) continue;
                        if (isWaterAt(bx + 0.5, bz + 0.5) && by >= -3) continue;
                        exposed.add(neighborKey);
                        const type = undergroundBlockType(bx, by, bz);
                        (type === 'bedrock' ? highBedrock : type === 'iron_ore' ? highIronOre : highStone).push([bx, by, bz]);
                    }
                }
                if (caveDetail) {
                    const profiles = new Map();
                    const profileAt = (x, z) => {
                        const key = `${x},${z}`;
                        if (!profiles.has(key)) profiles.set(key, caveProfileAt(x, z));
                        return profiles.get(key);
                    };
                    const inside = (x, y, z) => y > worldBottomY && y < -4 && PixameCaves.contains(profileAt(x, z), y);
                    for (let x = startX - 1; x <= startX + chunkSize; x++) {
                        for (let z = startZ - 1; z <= startZ + chunkSize; z++) {
                            const cave = profileAt(x, z);
                            if (!cave) continue;
                            const ownColumn = x >= startX && x < startX + chunkSize && z >= startZ && z < startZ + chunkSize;
                            if (ownColumn && cave.water) caveWaterCells.push([x, cave.floor, z]);
                            if (ownColumn && cave.biome === 'fungal' && !cave.water &&
                                Math.abs(Math.sin(x * 91.7 + z * 173.3)) > 0.995 && cave.floor + 1 <= cave.ceiling) {
                                for (const [y, type] of [[cave.floor, 'mushroom_stem'], [cave.floor + 1, 'glow_mushroom']]) {
                                    const key = blockKey(x, y, z);
                                    if (removedBlocks.has(key) || placedBlocks.has(key)) continue;
                                    treeKeys.push(key);
                                    addGroupedBlock(highCaveBlocks, type, [x, y, z]);
                                }
                            }
                            for (let y = cave.floor; y <= cave.ceiling; y++) {
                                for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                                    const bx = x + dx, by = y + dy, bz = z + dz;
                                    if (bx < startX || bx >= startX + chunkSize || bz < startZ || bz >= startZ + chunkSize ||
                                        by < worldBottomY || by >= 0 || inside(bx, by, bz)) continue;
                                    const key = blockKey(bx, by, bz);
                                    if (exposed.has(key) || placedBlocks.has(key) || (by > worldBottomY && removedBlocks.has(key))) continue;
                                    exposed.add(key);
                                    if (by === worldBottomY) highBedrock.push([bx, by, bz]);
                                    else if (cave.biome === 'fungal') {
                                        const type = undergroundBlockType(bx, by, bz);
                                        (type === 'iron_ore' ? highIronOre : highStone).push([bx, by, bz]);
                                    } else {
                                        addGroupedBlock(highCaveBlocks, cave.biome === 'ice' ? 'packed_ice' : 'moss_block', [bx, by, bz]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            const columns = new Map();
            const waterKeys = [];
            const queue = [];
            const cellKey = (x, z) => `${x},${z}`;
            const columnAt = (x, z) => {
                const key = cellKey(x, z);
                if (!columns.has(key)) columns.set(key, sampleTerrainColumn(x, z));
                return columns.get(key);
            };
            const minX = startX - waterSpreadRadius;
            const maxX = startX + chunkSize + waterSpreadRadius;
            const minZ = startZ - waterSpreadRadius;
            const maxZ = startZ + chunkSize + waterSpreadRadius;
            const filled = new Map();

            for (let x = minX; x < maxX; x++) {
                for (let z = minZ; z < maxZ; z++) {
                    if (columnAt(x, z).isWater) {
                        const key = cellKey(x, z);
                        filled.set(key, 0);
                        queue.push([x, z, 0]);
                    }
                }
            }

            for (let i = 0; i < queue.length; i++) {
                const [x, z, distance] = queue[i];
                if (distance >= waterSpreadRadius) continue;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nextX = x + dx;
                    const nextZ = z + dz;
                    if (nextX < minX || nextX >= maxX || nextZ < minZ || nextZ >= maxZ) continue;
                    const key = cellKey(nextX, nextZ);
                    if (filled.has(key)) continue;
                    const column = columnAt(nextX, nextZ);
                    if (sampleTerrainHeight(nextX, nextZ) > 1 || column.snowWeight >= 0.6) continue;
                    filled.set(key, distance + 1);
                    queue.push([nextX, nextZ, distance + 1]);
                }
            }

            for (let x = startX; x < startX + chunkSize; x++) {
                for (let z = startZ; z < startZ + chunkSize; z++) {
                    const column = columnAt(x, z);
                    const height = column.height;
                    const isWater = filled.has(cellKey(x, z));
                    if (isWater) {
                        waterCells.push([x, -1, z, 2]);
                        waterKeys.push(cellKey(x, z));
                        if (!removedBlocks.has(blockKey(x, -3, z))) waterBed.push([x, -3, z]);
                        if (!removedBlocks.has(blockKey(x, -2, z))) waterBed.push([x, -2, z]);
                    }
                    if (isWater) continue;
                    if (lod === 'low') {
                        const type = column.surfaceType === 'sand' || column.surfaceType === 'snow' ? column.surfaceType : 'grass';
                        addGroupedBlock(lowTerrainBlocks, type, type === 'grass'
                            ? [x, 0, z, height, ...lowGrassColor(column)]
                            : [x, 0, z, height]);
                    } else {
                        for (let y = 0; y < height; y++) {
                            if (removedBlocks.has(blockKey(x, y, z))) continue;
                            if (column.surfaceType === 'sand') {
                                highSand.push([x, y, z]);
                            } else if (y === height - 1 && column.surfaceType === 'snow') {
                                highSnow.push([x, y, z]);
                            } else if (y === height - 1) {
                                const tint = grassBiomeColor(column);
                                highGrass.push([x, y, z, 1, ...tint]);
                            } else if (y < height - 3) {
                                highStone.push([x, y, z]);
                            } else {
                                highDirt.push([x, y, z]);
                            }
                        }
                    }

                    const treeValue = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
                    const treeRoll = treeValue - Math.floor(treeValue);
                    if (!column.treeSpecies || treeRoll >= column.treeDensity || x < startX + 2 || x >= startX + chunkSize - 2 || z < startZ + 2 || z >= startZ + chunkSize - 2) continue;

                    const heightValue = Math.sin(x * 269.5 + z * 183.3) * 15731.743;
                    const variation = Math.floor((heightValue - Math.floor(heightValue)) * 3);
                    const species = column.treeSpecies;
                    const trunkHeight = (species === 'jungle' ? 7 : species === 'spruce' || species === 'birch' ? 5 : 4) + variation;
                    const treeBaseY = height;
                    if (!treeBlocks.has(species)) treeBlocks.set(species, {wood: [], leaves: []});
                    const thisTree = new Set();
                    const addTreeBlock = (treeX, treeY, treeZ, type) => {
                        const key = blockKey(treeX, treeY, treeZ);
                        if (thisTree.has(key) || removedBlocks.has(key) || placedBlocks.has(key)) return;
                        thisTree.add(key);
                        treeKeys.push(key);
                        treeBlocks.get(species)[type].push(type === 'leaves'
                            ? [treeX, treeY, treeZ, 1, ...foliageBiomeColor(column, species)]
                            : [treeX, treeY, treeZ]);
                    };
                    for (let y = treeBaseY; y < treeBaseY + trunkHeight; y++) {
                        addTreeBlock(x, y, z, 'wood');
                    }
                    const branchCount = species === 'spruce' ? 2 : 3 + variation % 2;
                    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
                    const directionOffset = Math.floor((heightValue - Math.floor(heightValue)) * 4);
                    for (let i = 0; i < branchCount; i++) {
                        const [dx, dz] = directions[(i + directionOffset) % directions.length];
                        const branchY = treeBaseY + trunkHeight - 2 - (i % 2);
                        addTreeBlock(x + dx, branchY, z + dz, 'wood');
                        addTreeBlock(x + dx * 2, branchY + (i % 2), z + dz * 2, 'wood');
                        addTreeBlock(x + dx * 2, branchY + 1 + (i % 2), z + dz * 2, 'leaves');
                    }
                    const canopyLayers = species === 'spruce' ? [
                        {offset: -3, radius: 2}, {offset: -2, radius: 1}, {offset: -1, radius: 2},
                        {offset: 0, radius: 1}, {offset: 1, radius: 0}
                    ] : species === 'acacia' ? [
                        {offset: -1, radius: 2}, {offset: 0, radius: 2}, {offset: 1, radius: 1}
                    ] : [
                        {offset: -2, radius: 2},
                        {offset: -1, radius: 2},
                        {offset: 0, radius: 1},
                        {offset: 1, radius: 0}
                    ];
                    for (const layer of canopyLayers) {
                        const leafY = treeBaseY + trunkHeight + layer.offset;
                        for (let dx = -layer.radius; dx <= layer.radius; dx++) {
                            for (let dz = -layer.radius; dz <= layer.radius; dz++) {
                                if (Math.abs(dx) === layer.radius && Math.abs(dz) === layer.radius && layer.radius > 1) continue;
                                if (dx === 0 && dz === 0 && leafY < treeBaseY + trunkHeight) continue;
                                addTreeBlock(x + dx, leafY, z + dz, 'leaves');
                            }
                        }
                    }
                }
            }

            for (let x = startX; x < startX + chunkSize; x++) {
                for (let z = startZ; z < startZ + chunkSize; z++) {
                    const placed = placedColumns.get(terrainColumnKey(x, z));
                    if (!placed) continue;
                    for (const [y, type] of placed) {
                        const treeKind = treeSpecies.find(species => type === treeBlockType(species, 'wood') || type === treeBlockType(species, 'leaves'));
                        if (caveBlockTypes.includes(type)) {
                            const grouped = lod === 'high' ? highCaveBlocks : lowPlacedBlocks;
                            addGroupedBlock(grouped, type, [x, y, z]);
                        } else if (treeKind) {
                            const part = type === treeBlockType(treeKind, 'wood') ? 'wood' : 'leaves';
                            if (!treeBlocks.has(treeKind)) treeBlocks.set(treeKind, {wood: [], leaves: []});
                            treeBlocks.get(treeKind)[part].push(part === 'leaves'
                                ? [x, y, z, 1, ...foliageBiomeColor(columnAt(x, z), treeKind)] : [x, y, z]);
                        } else if (sparkBlockDefinitions.has(type)) {
                            const model = lod === 'high' && getSparkModel(type);
                            if (model) {
                                highSparkModelBlocks.push([x, y, z, type, model]);
                            } else {
                                const grouped = lod === 'low' ? lowSparkBlocks : highSparkBlocks;
                                if (!grouped.has(type)) grouped.set(type, []);
                                grouped.get(type).push([x, y, z]);
                            }
                        } else if (lod === 'low') {
                            addGroupedBlock(lowPlacedBlocks, type, type === 'grass'
                                ? [x, y, z, 1, ...lowGrassColor(columnAt(x, z))]
                                : type === 'leaves' ? [x, y, z, 1, ...foliageBiomeColor(columnAt(x, z), 'oak')]
                                : [x, y, z]);
                        } else {
                            const blocks = type === 'grass' ? highGrass : type === 'sand' ? highSand : type === 'snow' ? highSnow : type === 'wood' ? highWood : type === 'planks' ? highPlanks : type === 'crafting_table' ? highCraftingTables : type === 'furnace' ? highFurnaces : type === 'leaves' ? highLeaves : type === 'iron_ore' ? highIronOre : type === 'stone' ? highStone : highDirt;
                            blocks.push(type === 'grass' ? [x, y, z, 1, ...grassBiomeColor(columnAt(x, z))]
                                : type === 'leaves' ? [x, y, z, 1, ...foliageBiomeColor(columnAt(x, z), 'oak')]
                                : [x, y, z]);
                        }
                    }
                }
            }

            if (lod === 'high') {
                addBlockInstances(chunkGroup, highGrass, grassGeo, grassMaterials, 'grass');
                addBlockInstances(chunkGroup, highGrass, grassOverlayGeo, [grassOverlayMaterial], 'grass', false);
                addBlockInstances(chunkGroup, highDirt, dirtGeo, blockMat, 'dirt');
                addBlockInstances(chunkGroup, highStone, stoneGeo, blockMat, 'stone');
                addBlockInstances(chunkGroup, highIronOre, ironOreGeo, blockMat, 'iron_ore');
                addBlockInstances(chunkGroup, highBedrock, bedrockGeo, blockMat, 'bedrock');
                addBlockInstances(chunkGroup, highSand, sandGeo, blockMat, 'sand');
                addBlockInstances(chunkGroup, highSnow, snowGeo, blockMat, 'snow');
                addBlockInstances(chunkGroup, highWood, woodGeo, blockMat, 'wood');
                addBlockInstances(chunkGroup, highPlanks, planksGeo, blockMat, 'planks');
                addBlockInstances(chunkGroup, highCraftingTables, craftingTableGeo, blockMat, 'crafting_table');
                addBlockInstances(chunkGroup, highFurnaces, furnaceGeo, blockMat, 'furnace');
                const placedLeaves = addBlockInstances(chunkGroup, highLeaves, leavesGeo, leavesMaterial, 'leaves');
                if (placedLeaves) placedLeaves.userData.foliageSpecies = 'oak';
                for (const [type, blocks] of highSparkBlocks) {
                    addBlockInstances(chunkGroup, blocks, blockGeo, getSparkBlockMaterial(type), type);
                }
                for (const [type, blocks] of highCaveBlocks) {
                    addBlockInstances(chunkGroup, blocks, caveGeometries[type], type === 'glow_mushroom' ? glowMushroomMaterial : blockMat, type);
                }
            } else {
                for (const blocksByType of [lowTerrainBlocks, lowPlacedBlocks]) {
                    for (const [type, blocks] of blocksByType) {
                        const mesh = addBlockInstances(chunkGroup, blocks, blockGeo, lowDetailMaterials[type], type, false);
                        if (mesh && type === 'leaves') mesh.userData.foliageSpecies = 'oak';
                    }
                }
                for (const [type, blocks] of lowSparkBlocks) {
                    addBlockInstances(chunkGroup, blocks, blockGeo, getLowSparkMaterial(type), type, false);
                }
            }
            for (const [species, blocks] of treeBlocks) {
                const geometry = treeGeometries[species];
                const logGeometry = lod === 'low' ? blockGeo : geometry ? geometry.log : woodGeo;
                const leafGeometry = lod === 'low' ? blockGeo : geometry ? geometry.leaves : leavesGeo;
                const logMaterial = lod === 'low' ? (lowTreeMaterials[species]?.wood || lowDetailMaterials.wood) : blockMat;
                const leafMaterial = lod === 'low' ? (lowTreeMaterials[species]?.leaves || lowDetailMaterials.leaves) : leavesMaterial;
                addBlockInstances(chunkGroup, blocks.wood, logGeometry, logMaterial, treeBlockType(species, 'wood'), lod === 'high');
                const leaves = addBlockInstances(chunkGroup, blocks.leaves, leafGeometry, leafMaterial, treeBlockType(species, 'leaves'), lod === 'high');
                if (leaves) leaves.userData.foliageSpecies = species;
            }
            for (const [x, y, z, type, model] of highSparkModelBlocks) {
                chunkGroup.add(createSparkBlockModel(type, model, x, y, z));
            }
            addBlockInstances(chunkGroup, waterBed, lod === 'low' ? blockGeo : sandGeo, lod === 'low' ? lowDetailMaterials.sand : blockMat, 'sand', lod === 'high');
            addWaterInstances(chunkGroup, waterCells);
            addWaterInstances(chunkGroup, caveWaterCells);
            return {group: chunkGroup, lod, chunkX, chunkZ, waterKeys, treeKeys, caveDetail};
        }

        const blockShadowRadius = 24;
        function updateBlockShadowCasting() {
            const radiusSquared = blockShadowRadius * blockShadowRadius;
            for (const chunk of terrainChunks.values()) {
                const minX = chunk.chunkX * chunkSize;
                const minZ = chunk.chunkZ * chunkSize;
                const closestX = Math.max(minX, Math.min(camera.position.x, minX + chunkSize));
                const closestZ = Math.max(minZ, Math.min(camera.position.z, minZ + chunkSize));
                const dx = closestX - camera.position.x;
                const dz = closestZ - camera.position.z;
                const shouldCast = chunk.lod === 'high' && dx * dx + dz * dz <= radiusSquared;
                chunk.group.traverse(object => {
                    if (object.userData.blockShadowCaster) object.castShadow = shouldCast;
                });
            }
        }

        function updateTerrainChunks() {
            const playerChunkX = Math.floor(camera.position.x / chunkSize);
            const playerChunkZ = Math.floor(camera.position.z / chunkSize);
            const movedX = lastTerrainLodX === null ? Infinity : camera.position.x - lastTerrainLodX;
            const movedZ = lastTerrainLodZ === null ? Infinity : camera.position.z - lastTerrainLodZ;
            const crossedChunk = playerChunkX !== currentTerrainChunkX || playerChunkZ !== currentTerrainChunkZ;
            const caveView = camera.position.y < 0;
            if (!crossedChunk && caveView === lastCaveView && movedX * movedX + movedZ * movedZ < 16) return;
            if (caveView !== lastCaveView) {
                scene.fog = caveView ? new THREE.Fog(0x1b2533, 24, 55) : null;
                scene.background.setHex(caveView ? 0x1b2533 : 0x87ceeb);
            }
            lastCaveView = caveView;
            currentTerrainChunkX = playerChunkX;
            currentTerrainChunkZ = playerChunkZ;
            lastTerrainLodX = camera.position.x;
            lastTerrainLodZ = camera.position.z;

            const desiredChunks = new Set();
            for (let chunkX = playerChunkX - chunkRadius; chunkX <= playerChunkX + chunkRadius; chunkX++) {
                for (let chunkZ = playerChunkZ - chunkRadius; chunkZ <= playerChunkZ + chunkRadius; chunkZ++) {
                    const key = `${chunkX},${chunkZ}`;
                    desiredChunks.add(key);
                    const minX = chunkX * chunkSize;
                    const minZ = chunkZ * chunkSize;
                    const closestX = Math.max(minX, Math.min(camera.position.x, minX + chunkSize));
                    const closestZ = Math.max(minZ, Math.min(camera.position.z, minZ + chunkSize));
                    const distance = Math.hypot(closestX - camera.position.x, closestZ - camera.position.z);
                    const lod = distance <= highDetailRadius ? 'high' : 'low';
                    const caveDetail = lod === 'high' && caveView &&
                        Math.abs(chunkX - playerChunkX) <= 2 && Math.abs(chunkZ - playerChunkZ) <= 2;
                    const existing = terrainChunks.get(key);
                    if (existing && existing.lod === lod && existing.caveDetail === caveDetail) continue;
                    if (existing) {
                        floorGroup.remove(existing.group);
                        disposeSparkModelGeometries(existing.group);
                        for (const waterKey of existing.waterKeys) activeWaterCells.delete(waterKey);
                        for (const treeKey of existing.treeKeys) activeTreeBlocks.delete(treeKey);
                    }
                    const chunk = buildTerrainChunk(chunkX, chunkZ, lod, caveDetail);
                    floorGroup.add(chunk.group);
                    for (const waterKey of chunk.waterKeys) activeWaterCells.add(waterKey);
                    for (const treeKey of chunk.treeKeys) activeTreeBlocks.add(treeKey);
                    terrainChunks.set(key, chunk);
                    updateBlockShadowCasting();
                }
            }

            for (const [key, chunk] of terrainChunks) {
                if (!desiredChunks.has(key)) {
                    floorGroup.remove(chunk.group);
                    disposeSparkModelGeometries(chunk.group);
                    for (const waterKey of chunk.waterKeys) activeWaterCells.delete(waterKey);
                    for (const treeKey of chunk.treeKeys) activeTreeBlocks.delete(treeKey);
                    terrainChunks.delete(key);
                }
            }
            updateBlockShadowCasting();
        }

        scene.add(floorGroup);

        let playerAvatar = null;
        let avatarFactory = null;

        updateTerrainChunks();
        updateSunForPlayer();

        const grassOverlayImage = new Image();
        grassOverlayImage.onload = () => {
            grassOverlayTexture.image = grassOverlayImage;
            grassOverlayTexture.needsUpdate = true;
            grassOverlayMaterial.visible = true;
            grassIconOverlay = grassOverlayImage;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(grassOverlayImage, 0, 0);
            lowGrassOverlay = Array.from(context.getImageData(0, 0, 1, 1).data, channel => channel / 255);
            refreshGrassColors();
            drawAllBlockIcons();
        };
        grassOverlayImage.onerror = error => console.error('Failed to load grass side overlay:', error);
        grassOverlayImage.src = '/assets/textures/block/grass_block_side_overlay.png';

        function refreshGrassColors() {
            const chunks = Array.from(terrainChunks.values());
            let nextChunk = 0;
            const color = new THREE.Color();
            function updateGrassColors() {
                const deadline = performance.now() + 8;
                while (nextChunk < chunks.length && performance.now() < deadline) {
                    const chunk = chunks[nextChunk++];
                    if (terrainChunks.get(`${chunk.chunkX},${chunk.chunkZ}`) !== chunk) continue;
                    const colors = new Map();
                    for (const mesh of chunk.group.children) {
                        if (!mesh.isInstancedMesh ||
                            (mesh.userData.blockType !== 'grass' && !mesh.userData.foliageSpecies)) continue;
                        mesh.userData.blockRecords.forEach(([x, , z], index) => {
                            const species = mesh.userData.foliageSpecies;
                            const key = `${terrainColumnKey(x, z)}:${species || 'grass'}`;
                            if (!colors.has(key)) {
                                const column = sampleTerrainColumn(x, z);
                                colors.set(key, species ? foliageBiomeColor(column, species)
                                    : chunk.lod === 'low' ? lowGrassColor(column) : grassBiomeColor(column));
                            }
                            color.setRGB(...colors.get(key));
                            mesh.setColorAt(index, color);
                        });
                        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                    }
                }
                if (nextChunk < chunks.length) requestAnimationFrame(updateGrassColors);
            }
            updateGrassColors();
        }

        const grassColorMapImage = new Image();
        grassColorMapImage.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = grassColorMapImage.naturalWidth;
            canvas.height = grassColorMapImage.naturalHeight;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(grassColorMapImage, 0, 0);
            grassColorMap = context.getImageData(0, 0, canvas.width, canvas.height);
            drawAllBlockIcons();
            refreshGrassColors();
        };
        grassColorMapImage.onerror = error => console.error('Failed to load grass colormap:', error);
        grassColorMapImage.src = '/assets/textures/colormap/grass.png';
        const foliageColorMapImage = new Image();
        foliageColorMapImage.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = foliageColorMapImage.naturalWidth;
            canvas.height = foliageColorMapImage.naturalHeight;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(foliageColorMapImage, 0, 0);
            foliageColorMap = context.getImageData(0, 0, canvas.width, canvas.height);
            refreshGrassColors();
        };
        foliageColorMapImage.onerror = error => console.error('Failed to load foliage colormap:', error);
        foliageColorMapImage.src = '/assets/textures/colormap/foliage.png';

        Promise.all([
            fetch('/player.json').then(response => {
                if (!response.ok) throw new Error(`Player model request failed: ${response.status}`);
                return response.json();
            }),
            new Promise((resolve, reject) => new THREE.TextureLoader().load('/player_texture.png', resolve, undefined, reject))
        ]).then(([model, texture]) => {
            avatarFactory = createPlayerAvatarFactory(THREE, model, texture);
            playerAvatar = avatarFactory.create();
            scene.add(playerAvatar.root);
        }).catch(error => {
            console.error('Failed to load player model or skin:', error);
            roomMessage.textContent = 'Failed to load player model or skin.';
        });

        const floorTop = 1.0;
        const playerEyeHeight = 1.8;
        const playerStandOffset = 0.0;
        const playerBodyHeight = playerEyeHeight + 0.1;
        const playerRadius = 0.2;
        const spawnColumn = sampleTerrainColumn(0, 0);
        const spawnGroundY = isWaterAt(0, 0) ? waterLevel : spawnColumn.height;
        const spawnPosition = new THREE.Vector3(0.5, spawnGroundY + playerEyeHeight + playerStandOffset, 0.5);
        camera.position.copy(spawnPosition);
        if (savedPlayerPosition) camera.position.set(savedPlayerPosition.x, savedPlayerPosition.y, savedPlayerPosition.z);
        playerSaveReady = true;
        savePlayerState();

        function worldGroundEyeY(worldX, worldZ, maxFeetY) {
            const cellX = Math.floor(worldX);
            const cellZ = Math.floor(worldZ);
            const highestBlockY = Math.floor(maxFeetY - 1 + 0.001);
            for (let y = highestBlockY; y >= worldBottomY; y--) {
                if (isSolidBlockAt(cellX, y, cellZ)) {
                    return Math.round((y + 1 + playerEyeHeight + playerStandOffset) * 1000) / 1000;
                }
            }
            return -Infinity;
        }

        function createPlayerBox(position) {
            const feetY = Math.round((position.y - playerEyeHeight) * 1000) / 1000;
            return new THREE.Box3(
                new THREE.Vector3(position.x - playerRadius, feetY, position.z - playerRadius),
                new THREE.Vector3(position.x + playerRadius, feetY + playerBodyHeight, position.z + playerRadius)
            );
        }

        function createFootProbe(position) {
            const feetY = Math.round((position.y - playerEyeHeight) * 1000) / 1000;
            return new THREE.Box3(
                new THREE.Vector3(position.x - playerRadius, feetY - 0.08, position.z - playerRadius),
                new THREE.Vector3(position.x + playerRadius, feetY + 0.06, position.z + playerRadius)
            );
        }

        function createBodyProbe(position) {
            const feetY = Math.round((position.y - playerEyeHeight) * 1000) / 1000;
            const bodyRadius = Math.max(0.12, playerRadius - 0.02);
            return new THREE.Box3(
                new THREE.Vector3(position.x - bodyRadius, feetY + 0.08, position.z - bodyRadius),
                new THREE.Vector3(position.x + bodyRadius, feetY + playerBodyHeight, position.z + bodyRadius)
            );
        }

        function findHeadCollision(previousPosition, position) {
            const previousBox = createPlayerBox(previousPosition);
            const playerBox = createPlayerBox(position);
            const minBlockX = Math.floor(playerBox.min.x);
            const maxBlockX = Math.ceil(playerBox.max.x) - 1;
            const minBlockY = Math.floor(previousBox.max.y);
            const maxBlockY = Math.ceil(playerBox.max.y) - 1;
            const minBlockZ = Math.floor(playerBox.min.z);
            const maxBlockZ = Math.ceil(playerBox.max.z) - 1;
            let collision = null;
            for (let x = minBlockX; x <= maxBlockX; x++) {
                for (let y = minBlockY; y <= maxBlockY; y++) {
                    for (let z = minBlockZ; z <= maxBlockZ; z++) {
                        if (!isSolidBlockAt(x, y, z)) continue;
                        if (previousBox.max.y > y || playerBox.max.y <= y) continue;
                        const blockBox = new THREE.Box3(
                            new THREE.Vector3(x, y, z),
                            new THREE.Vector3(x + 1, y + 1, z + 1)
                        );
                        const overlapsHorizontally = playerBox.min.x < blockBox.max.x && playerBox.max.x > blockBox.min.x &&
                            playerBox.min.z < blockBox.max.z && playerBox.max.z > blockBox.min.z;
                        if (overlapsHorizontally && (!collision || y < collision.y)) collision = {x, y, z};
                    }
                }
            }
            return collision;
        }

        function canMoveTo(position, previousPosition) {
            const probe = createBodyProbe(position);
            const previousProbe = createBodyProbe(previousPosition);
            const minCellX = Math.floor(probe.min.x);
            const maxCellX = Math.floor(probe.max.x);
            const minCellZ = Math.floor(probe.min.z);
            const maxCellZ = Math.floor(probe.max.z);
            const minBlockY = Math.floor(probe.min.y);
            const maxBlockY = Math.ceil(probe.max.y) - 1;

            for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
                for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
                    const nextOverlapX = Math.max(0, Math.min(probe.max.x, cellX + 1) - Math.max(probe.min.x, cellX));
                    const nextOverlapZ = Math.max(0, Math.min(probe.max.z, cellZ + 1) - Math.max(probe.min.z, cellZ));
                    const previousOverlapX = Math.max(0, Math.min(previousProbe.max.x, cellX + 1) - Math.max(previousProbe.min.x, cellX));
                    const previousOverlapZ = Math.max(0, Math.min(previousProbe.max.z, cellZ + 1) - Math.max(previousProbe.min.z, cellZ));
                    for (let blockY = minBlockY; blockY <= maxBlockY; blockY++) {
                        if (!isSolidBlockAt(cellX, blockY, cellZ)) continue;
                        const nextOverlapY = Math.max(0, Math.min(probe.max.y, blockY + 1) - Math.max(probe.min.y, blockY));
                        const previousOverlapY = Math.max(0, Math.min(previousProbe.max.y, blockY + 1) - Math.max(previousProbe.min.y, blockY));
                        const nextOverlap = nextOverlapX * nextOverlapY * nextOverlapZ;
                        const previousOverlap = previousOverlapX * previousOverlapY * previousOverlapZ;
                        if (previousOverlap > 0 && nextOverlap <= previousOverlap + 0.0001) continue;
                        if (nextOverlap > 0) return false;
                    }
                }
            }
            return true;
        }

        function isSolidBlockAt(x, y, z) {
            const key = blockKey(x, y, z);
            if (y === worldBottomY) return true;
            if (placedBlocks.has(key)) return true;
            if (removedBlocks.has(key)) return false;
            if (activeTreeBlocks.has(key)) return true;
            if (y < -3 && y > worldBottomY) return !isCaveAir(x, y, z);
            if (isWaterAt(x + 0.5, z + 0.5)) return y === -3 || y === -2;
            const height = sampleTerrainColumn(x, z).height;
            return y > worldBottomY && y < height;
        }

        function disposeSparkModelGeometries(group) {
            group.traverse(object => {
                if (object.isMesh && object.userData.sparkBlockModel) object.geometry.dispose();
            });
        }

        function rebuildTerrainChunkAt(worldX, worldZ) {
            const chunkX = Math.floor(worldX / chunkSize);
            const chunkZ = Math.floor(worldZ / chunkSize);
            const key = `${chunkX},${chunkZ}`;
            const existing = terrainChunks.get(key);
            if (!existing) return;
            floorGroup.remove(existing.group);
            disposeSparkModelGeometries(existing.group);
            for (const waterKey of existing.waterKeys) activeWaterCells.delete(waterKey);
            for (const treeKey of existing.treeKeys) activeTreeBlocks.delete(treeKey);
            const chunk = buildTerrainChunk(chunkX, chunkZ, existing.lod, existing.caveDetail);
            floorGroup.add(chunk.group);
            for (const waterKey of chunk.waterKeys) activeWaterCells.add(waterKey);
            for (const treeKey of chunk.treeKeys) activeTreeBlocks.add(treeKey);
            terrainChunks.set(key, chunk);
        }

        function rebuildTerrainAroundEdit(x, y, z) {
            rebuildTerrainChunkAt(x, z);
            if (y > 0) return;
            if (Math.floor((x - 1) / chunkSize) !== Math.floor(x / chunkSize)) rebuildTerrainChunkAt(x - 1, z);
            if (Math.floor((x + 1) / chunkSize) !== Math.floor(x / chunkSize)) rebuildTerrainChunkAt(x + 1, z);
            if (Math.floor((z - 1) / chunkSize) !== Math.floor(z / chunkSize)) rebuildTerrainChunkAt(x, z - 1);
            if (Math.floor((z + 1) / chunkSize) !== Math.floor(z / chunkSize)) rebuildTerrainChunkAt(x, z + 1);
        }

        function applyWorldEdit(edit, rebuild = true) {
            if (!edit || !Number.isInteger(edit.x) || !Number.isInteger(edit.y) || !Number.isInteger(edit.z)) return false;
            const key = blockKey(edit.x, edit.y, edit.z);
            if (edit.removed) removedBlocks.add(key);
            else removedBlocks.delete(key);

            const oldPlacedType = placedBlocks.get(key);
            if (oldPlacedType) {
                placedBlocks.delete(key);
                const columnKey = terrainColumnKey(edit.x, edit.z);
                const column = placedColumns.get(columnKey);
                if (column) {
                    column.delete(edit.y);
                    if (column.size === 0) placedColumns.delete(columnKey);
                }
            }

            if (itemDefinitions[edit.placedType]) {
                placedBlocks.set(key, edit.placedType);
                const columnKey = terrainColumnKey(edit.x, edit.z);
                if (!placedColumns.has(columnKey)) placedColumns.set(columnKey, new Map());
                placedColumns.get(columnKey).set(edit.y, edit.placedType);
            }
            if (rebuild) rebuildTerrainAroundEdit(edit.x, edit.y, edit.z);
            return true;
        }

        function applyPendingWorldEdits() {
            if (!sparkBlocksReady || pendingWorldEdits.length === 0) return;
            const dirtyColumns = new Map();
            for (const edit of pendingWorldEdits.splice(0)) {
                if (!applyWorldEdit(edit, false)) continue;
                const key = terrainColumnKey(edit.x, edit.z);
                const previous = dirtyColumns.get(key);
                dirtyColumns.set(key, [edit.x, edit.z, previous ? Math.min(previous[2], edit.y) : edit.y]);
            }
            for (const [x, z, y] of dirtyColumns.values()) rebuildTerrainAroundEdit(x, y, z);
        }

        function currentWorldEdit(x, y, z) {
            const key = blockKey(x, y, z);
            return {
                x, y, z,
                removed: removedBlocks.has(key),
                placedType: placedBlocks.get(key) || null
            };
        }

        const blockRaycaster = new THREE.Raycaster();
        const blockReach = 5;
        blockRaycaster.far = blockReach;
        const screenCenter = new THREE.Vector2(0, 0);
        const miningDurations = {grass: 0.45, dirt: 0.4, sand: 0.35, snow: 0.35, stone: 1.5, iron_ore: 1.5, wood: 0.8, leaves: 0.2};
        let aimedBlock = null;
        let miningActive = false;
        let miningTargetKey = null;
        let miningElapsed = 0;
        let targetScanElapsed = 0;
        const crackCanvas = document.createElement('canvas');
        crackCanvas.width = 64;
        crackCanvas.height = 64;
        const crackContext = crackCanvas.getContext('2d');
        const crackTexture = new THREE.CanvasTexture(crackCanvas);
        crackTexture.magFilter = THREE.NearestFilter;
        crackTexture.minFilter = THREE.NearestFilter;
        const crackMaterial = new THREE.MeshBasicMaterial({
            map: crackTexture,
            color: 0x3a302b,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.012, 1.012, 1.012), crackMaterial);
        crackMesh.visible = false;
        crackMesh.renderOrder = 4;
        scene.add(crackMesh);
        let crackTargetKey = null;
        let crackStage = 0;
        const selectedItemLabel = document.getElementById('selected-item-label');
        const inventoryToggle = document.getElementById('inventory-toggle');
        const blockPalette = document.getElementById('block-palette');
        const playerInventory = document.getElementById('player-inventory');
        const backpackSlots = document.getElementById('backpack-slots');
        const inventoryHotbarSlots = document.getElementById('inventory-hotbar-slots');
        const playerCraftGrid = document.getElementById('player-craft-grid');
        const playerCraftOutput = document.getElementById('player-craft-output');
        const workbenchScreen = document.getElementById('workbench-screen');
        const workbenchCraftGrid = document.getElementById('workbench-craft-grid');
        const workbenchOutput = document.getElementById('workbench-output');
        const workbenchBackpackSlots = document.getElementById('workbench-backpack-slots');
        const workbenchHotbarSlots = document.getElementById('workbench-hotbar-slots');
        const furnaceScreen = document.getElementById('furnace-screen');
        const furnaceBackpackSlots = document.getElementById('furnace-backpack-slots');
        const furnaceHotbarSlots = document.getElementById('furnace-hotbar-slots');
        const furnaceStatus = document.getElementById('furnace-status');
        const furnaceSlotElements = Object.fromEntries(['input', 'fuel', 'output'].map(slot => [slot, document.getElementById(`furnace-${slot}`)]));
        let furnacePosition = null;
        let furnaceState = null;
        let furnaceTimeOffset = 0;
        let furnacePollTimer = null;
        const personalCraftingGrid = Array(4).fill(null);
        let itemNoticeTimer = null;

        function miningDurationFor(targetType) {
            const selectedType = hotbarItems[selectedHotbarIndex]?.type;
            const isAxe = selectedType === 'wooden_axe' || selectedType === 'stone_axe';
            const isPickaxe = selectedType === 'wooden_pickaxe' || selectedType === 'stone_pickaxe';
            const treePart = targetType === 'wood' || targetType === 'leaves' ||
                treeSpecies.some(species => targetType === treeBlockType(species, 'wood') || targetType === treeBlockType(species, 'leaves'));
            const baseDuration = miningDurations[targetType] || (treePart ? targetType.endsWith('leaves') ? 0.2 : 0.8 : 0.5);
            const correctTool = treePart && isAxe
                || (targetType === 'stone' || targetType === 'iron_ore' || targetType === 'furnace') && isPickaxe;
            if (!correctTool) return baseDuration;
            const multiplier = selectedType.startsWith('stone_') ? 0.3 : 0.5;
            return baseDuration * multiplier;
        }

        function showItemNotification() {
            const selected = hotbarItems[selectedHotbarIndex];
            if (!selected) {
                selectedItemLabel.hidden = true;
                return;
            }
            selectedItemLabel.textContent = `${itemDefinitions[selected.type].label.toUpperCase()} x${selected.count}`;
            selectedItemLabel.hidden = false;
            selectedItemLabel.classList.remove('is-showing');
            void selectedItemLabel.offsetWidth;
            selectedItemLabel.classList.add('is-showing');
            if (itemNoticeTimer !== null) window.clearTimeout(itemNoticeTimer);
            itemNoticeTimer = window.setTimeout(() => {
                selectedItemLabel.hidden = true;
                selectedItemLabel.classList.remove('is-showing');
                itemNoticeTimer = null;
            }, 1800);
        }

        function setBlockPaletteOpen(isOpen) {
            if (isOpen && !isPlayerAdmin) return;
            if (isOpen) resetMobileInput();
            if (isOpen && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            blockPalette.hidden = !isOpen;
            inventoryToggle.setAttribute('aria-expanded', String(isOpen));
            if (!isOpen) {
                blockPalette.classList.remove('is-opening');
                return;
            }
            blockPalette.classList.remove('is-opening');
            void blockPalette.offsetWidth;
            blockPalette.classList.add('is-opening');
        }

        const craftingGrid = Array(9).fill(null);
        const craftingRecipes = [
            {id: 'planks', label: 'Oak Planks', ingredients: {wood: 1}, output: {type: 'planks', count: 4}, pattern: ['wood']},
            ...treeSpecies.map(species => {
                const wood = treeBlockType(species, 'wood');
                return {id: `${species}_planks`, label: 'Planks', ingredients: {[wood]: 1}, output: {type: 'planks', count: 4}, pattern: [wood]};
            }),
            {id: 'sticks', label: 'Sticks', ingredients: {planks: 2}, output: {type: 'sticks', count: 4}, pattern: ['planks', 'planks']},
            {id: 'crafting_table', label: 'Crafting Table', ingredients: {planks: 4}, output: {type: 'crafting_table', count: 1}, pattern: ['planks', 'planks', 'planks', 'planks']},
            {id: 'furnace', label: 'Furnace', ingredients: {stone: 8}, output: {type: 'furnace', count: 1}, pattern: ['stone', 'stone', 'stone', 'stone', null, 'stone', 'stone', 'stone', 'stone']},
            {id: 'wooden_pickaxe', label: 'Wooden Pickaxe', ingredients: {planks: 3, sticks: 2}, output: {type: 'wooden_pickaxe', count: 1}, pattern: ['planks', 'planks', 'planks', null, 'sticks', null, null, 'sticks', null]},
            {id: 'stone_pickaxe', label: 'Stone Pickaxe', ingredients: {stone: 3, sticks: 2}, output: {type: 'stone_pickaxe', count: 1}, pattern: ['stone', 'stone', 'stone', null, 'sticks', null, null, 'sticks', null]},
            {id: 'wooden_axe', label: 'Wooden Axe', ingredients: {planks: 3, sticks: 2}, output: {type: 'wooden_axe', count: 1}, pattern: ['planks', 'planks', 'planks', 'sticks', null, 'sticks']},
            {id: 'stone_axe', label: 'Stone Axe', ingredients: {stone: 3, sticks: 2}, output: {type: 'stone_axe', count: 1}, pattern: ['stone', 'stone', 'stone', 'sticks', null, 'sticks']},
            {id: 'wooden_sword', label: 'Wooden Sword', ingredients: {planks: 2, sticks: 1}, output: {type: 'wooden_sword', count: 1}, pattern: ['planks', 'planks', 'sticks']},
            {id: 'stone_sword', label: 'Stone Sword', ingredients: {stone: 2, sticks: 1}, output: {type: 'stone_sword', count: 1}, pattern: ['stone', 'stone', 'sticks']},
            {id: 'torch', label: 'Torches', ingredients: {wood: 1, sticks: 1}, output: {type: 'torch', count: 4}, pattern: ['wood', 'sticks']},
            ...treeSpecies.map(species => {
                const wood = treeBlockType(species, 'wood');
                return {id: `${species}_torch`, label: 'Torches', ingredients: {[wood]: 1, sticks: 1}, output: {type: 'torch', count: 4}, pattern: [wood, 'sticks']};
            })
        ];
        let activePalettePage = 'blocks';

        function hasRecipeIngredients(recipe) {
            return Object.entries(recipe.ingredients).every(([type, count]) => itemCount(type) >= (isPlayerAdmin ? 1 : count));
        }

        function craftRecipe(recipe) {
            if (!hasRecipeIngredients(recipe) || !canStoreItems(recipe.output.type, recipe.output.count)) return;
            for (const [type, count] of Object.entries(recipe.ingredients)) removeItems(type, count);
            storeItems(recipe.output.type, recipe.output.count);
            updateHotbar();
            showItemNotification();
        }

        function normalizedGrid(grid) {
            const populated = grid.map((type, index) => type ? {type, x: index % 3, y: Math.floor(index / 3)} : null).filter(Boolean);
            if (populated.length === 0) return [];
            const minX = Math.min(...populated.map(item => item.x));
            const minY = Math.min(...populated.map(item => item.y));
            const maxX = Math.max(...populated.map(item => item.x));
            const maxY = Math.max(...populated.map(item => item.y));
            const output = [];
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) output.push(grid[y * 3 + x] || null);
            }
            return output;
        }

        function getManualRecipe() {
            const pattern = normalizedGrid(craftingGrid);
            return craftingRecipes.find(recipe => JSON.stringify(recipe.pattern) === JSON.stringify(pattern)) || null;
        }

        function collectManualCraft(recipe) {
            if (!recipe || !canStoreItems(recipe.output.type, recipe.output.count)) return;
            storeItems(recipe.output.type, recipe.output.count);
            craftingGrid.fill(null);
            updateHotbar();
            showItemNotification();
        }

        function refreshCraftingUI() {
            if (!craftingReady) return;
            const recipeList = document.getElementById('recipe-list');
            recipeList.replaceChildren();
            for (const recipe of craftingRecipes) {
                const button = document.createElement('button');
                const canCraft = hasRecipeIngredients(recipe) && canStoreItems(recipe.output.type, recipe.output.count);
                button.type = 'button';
                button.className = 'recipe-card';
                button.disabled = !canCraft;
                button.innerHTML = `<canvas class="item-icon" width="36" height="36"></canvas><span>${recipe.label}<br><small>${Object.entries(recipe.ingredients).map(([type, count]) => `${itemDefinitions[type].label} ×${count}`).join(' · ')}</small></span><strong class="recipe-output">×${recipe.output.count}</strong>`;
                drawItemIcon(button.querySelector('.item-icon'), recipe.output.type);
                button.addEventListener('click', () => craftRecipe(recipe));
                recipeList.appendChild(button);
            }

            const craftGrid = document.getElementById('craft-grid');
            craftGrid.replaceChildren();
            craftingGrid.forEach((type, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'craft-cell';
                button.title = type ? `Return ${itemDefinitions[type].label}` : 'Add selected item';
                if (type) {
                    button.innerHTML = '<canvas class="item-icon" width="32" height="32"></canvas><span class="cell-count">1</span>';
                    drawItemIcon(button.querySelector('.item-icon'), type);
                }
                button.addEventListener('click', () => {
                    if (craftingGrid[index]) return;
                    const selected = getSelectedInventoryStack();
                    if (!selected || selected.count < 1) return;
                    craftingGrid[index] = selected.type;
                    removeItems(selected.type, 1);
                    updateHotbar();
                });
                button.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    if (!craftingGrid[index] || !canStoreItems(craftingGrid[index], 1)) return;
                    storeItems(craftingGrid[index], 1);
                    craftingGrid[index] = null;
                    updateHotbar();
                });
                craftGrid.appendChild(button);
            });

            const craftOutput = document.getElementById('craft-output');
            const recipe = getManualRecipe();
            if (!recipe) {
                craftOutput.textContent = craftingGrid.some(Boolean) ? 'No matching recipe' : 'Add materials';
                craftOutput.onclick = null;
                craftOutput.oncontextmenu = null;
                return;
            }
            craftOutput.innerHTML = `<canvas class="item-icon" width="40" height="40"></canvas><strong>${recipe.label} ×${recipe.output.count}</strong>`;
            drawItemIcon(craftOutput.querySelector('.item-icon'), recipe.output.type);
            craftOutput.onclick = () => collectManualCraft(recipe);
            craftOutput.oncontextmenu = event => {
                event.preventDefault();
                collectManualCraft(recipe);
            };
        }

        function setPalettePage(page) {
            activePalettePage = page;
            blockPalette.querySelectorAll('[data-palette-page-content]').forEach(element => {
                element.hidden = element.dataset.palettePageContent !== page;
            });
            blockPalette.querySelectorAll('[data-palette-page]').forEach(button => {
                button.setAttribute('aria-selected', String(button.dataset.palettePage === page));
            });
            if (page === 'craft') refreshCraftingUI();
        }

        function isTextInputTarget(target) {
            return target instanceof HTMLElement && (
                target.isContentEditable ||
                target.matches('input, textarea, select')
            );
        }

        const personalCraftingRecipes = [
            {pattern: ['wood'], output: {type: 'planks', count: 4}},
            ...treeSpecies.map(species => ({pattern: [treeBlockType(species, 'wood')], output: {type: 'planks', count: 4}})),
            {pattern: ['planks', 'planks'], output: {type: 'sticks', count: 4}},
            {pattern: ['planks', 'planks', 'planks', 'planks'], output: {type: 'crafting_table', count: 1}},
            {pattern: ['wood', 'sticks'], output: {type: 'torch', count: 4}},
            ...treeSpecies.map(species => ({pattern: [treeBlockType(species, 'wood'), 'sticks'], output: {type: 'torch', count: 4}}))
        ];

        function getInventoryContainer(name) {
            return name === 'backpack' ? backpackItems : hotbarItems;
        }

        function getSelectedInventoryStack() {
            return getInventoryContainer(selectedInventoryItem.container)[selectedInventoryItem.index];
        }

        let inventoryDrag = null;
        let mobileInventorySource = null;

        function clearInventoryDrag() {
            inventoryDrag = null;
            document.querySelectorAll('.inventory-slot.dragging, .inventory-slot.drag-over').forEach(slot => {
                slot.classList.remove('dragging', 'drag-over');
            });
        }

        function moveInventoryStack(drag, containerName, index) {
            const source = getInventoryContainer(drag.containerName);
            const destinationContainer = getInventoryContainer(containerName);
            if (source[drag.index] !== drag.stack || source === destinationContainer && drag.index === index) return;
            const destination = destinationContainer[index];
            if (destination && destination.type === drag.stack.type) {
                const moved = Math.min(drag.stack.count, 99 - destination.count);
                if (!moved) return;
                destination.count += moved;
                drag.stack.count -= moved;
                if (drag.stack.count === 0) source[drag.index] = null;
            } else {
                source[drag.index] = destination;
                destinationContainer[index] = drag.stack;
            }
            selectedInventoryItem = {container: containerName, index};
            if (containerName === 'hotbar') selectedHotbarIndex = index;
            updateHotbar();
        }

        function normalizedPersonalCraftingGrid() {
            const populated = personalCraftingGrid.map((type, index) => type ? {type, x: index % 2, y: Math.floor(index / 2)} : null).filter(Boolean);
            if (populated.length === 0) return [];
            const minX = Math.min(...populated.map(item => item.x));
            const minY = Math.min(...populated.map(item => item.y));
            const maxX = Math.max(...populated.map(item => item.x));
            const maxY = Math.max(...populated.map(item => item.y));
            const pattern = [];
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) pattern.push(personalCraftingGrid[y * 2 + x] || null);
            }
            return pattern;
        }

        function getPersonalCraftingRecipe() {
            const pattern = JSON.stringify(normalizedPersonalCraftingGrid());
            return personalCraftingRecipes.find(recipe => JSON.stringify(recipe.pattern) === pattern) || null;
        }

        function renderInventorySlots(containerName, container, target) {
            target.replaceChildren();
            container.forEach((stack, index) => {
                const slot = document.createElement('button');
                slot.type = 'button';
                const selected = selectedInventoryItem.container === containerName && selectedInventoryItem.index === index;
                slot.className = `inventory-slot${selected ? ' selected' : ''}`;
                slot.draggable = !!stack;
                slot.title = stack ? `${itemDefinitions[stack.type].label} ×${stack.count}` : 'Empty slot';
                if (stack) {
                    slot.innerHTML = '<canvas class="item-icon" width="36" height="36"></canvas><span class="item-count"></span>';
                    drawItemIcon(slot.querySelector('.item-icon'), stack.type);
                    slot.querySelector('.item-count').textContent = isPlayerAdmin && placeableBlockTypes.has(stack.type) ? '∞' : stack.count;
                }
                slot.addEventListener('click', () => {
                    if (furnacePending || furnaceSaveUncertain) return;
                    if (mobileMode && mobileInventorySource) {
                        const source = mobileInventorySource;
                        mobileInventorySource = null;
                        if (source.containerName !== containerName || source.index !== index) {
                            moveInventoryStack(source, containerName, index);
                            return;
                        }
                    } else if (mobileMode && stack) {
                        mobileInventorySource = {containerName, index, stack};
                    }
                    selectedInventoryItem = {container: containerName, index};
                    if (containerName === 'hotbar') selectedHotbarIndex = index;
                    refreshPlayerInventoryUI();
                    refreshWorkbenchUI();
                    updateHotbar();
                });
                slot.addEventListener('dragstart', event => {
                    if (!stack || furnacePending || furnaceSaveUncertain) {
                        event.preventDefault();
                        return;
                    }
                    inventoryDrag = {containerName, index, stack};
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', 'pixame-inventory');
                    slot.classList.add('dragging');
                });
                slot.addEventListener('dragover', event => {
                    if (!inventoryDrag || furnacePending || furnaceSaveUncertain) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    slot.classList.add('drag-over');
                });
                slot.addEventListener('dragleave', event => {
                    if (!slot.contains(event.relatedTarget)) slot.classList.remove('drag-over');
                });
                slot.addEventListener('drop', event => {
                    event.preventDefault();
                    const drag = inventoryDrag;
                    clearInventoryDrag();
                    if (!drag || furnacePending || furnaceSaveUncertain) return;
                    moveInventoryStack(drag, containerName, index);
                });
                slot.addEventListener('dragend', clearInventoryDrag);
                target.appendChild(slot);
            });
        }

        function refreshPlayerInventoryUI() {
            renderInventorySlots('backpack', backpackItems, backpackSlots);
            renderInventorySlots('hotbar', hotbarItems, inventoryHotbarSlots);
            playerCraftGrid.replaceChildren();
            personalCraftingGrid.forEach((type, index) => {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'craft-cell';
                if (type) {
                    cell.innerHTML = '<canvas class="item-icon" width="44" height="44"></canvas><span class="cell-count">1</span>';
                    drawItemIcon(cell.querySelector('.item-icon'), type);
                }
                cell.addEventListener('click', () => {
                    mobileInventorySource = null;
                    if (personalCraftingGrid[index]) {
                        if (mobileMode && canStoreItems(personalCraftingGrid[index], 1)) {
                            storeItems(personalCraftingGrid[index], 1);
                            personalCraftingGrid[index] = null;
                            updateHotbar();
                        }
                        return;
                    }
                    const stack = getSelectedInventoryStack();
                    if (!stack || stack.count < 1) return;
                    personalCraftingGrid[index] = stack.type;
                    if (!isPlayerAdmin) {
                        stack.count--;
                        if (stack.count === 0) getInventoryContainer(selectedInventoryItem.container)[selectedInventoryItem.index] = null;
                    }
                    updateHotbar();
                });
                cell.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    if (!personalCraftingGrid[index] || !canStoreItems(personalCraftingGrid[index], 1)) return;
                    storeItems(personalCraftingGrid[index], 1);
                    personalCraftingGrid[index] = null;
                    updateHotbar();
                });
                playerCraftGrid.appendChild(cell);
            });

            const recipe = getPersonalCraftingRecipe();
            if (!recipe) {
                playerCraftOutput.textContent = personalCraftingGrid.some(Boolean) ? 'No matching recipe' : 'Add materials';
                playerCraftOutput.disabled = true;
                return;
            }
            playerCraftOutput.disabled = !canStoreItems(recipe.output.type, recipe.output.count);
            playerCraftOutput.innerHTML = `<canvas class="item-icon" width="40" height="40"></canvas><strong>${itemDefinitions[recipe.output.type].label} ×${recipe.output.count}</strong>`;
            drawItemIcon(playerCraftOutput.querySelector('.item-icon'), recipe.output.type);
        }

        playerCraftOutput.addEventListener('click', () => {
            const recipe = getPersonalCraftingRecipe();
            if (!recipe || !canStoreItems(recipe.output.type, recipe.output.count)) return;
            storeItems(recipe.output.type, recipe.output.count);
            personalCraftingGrid.fill(null);
            updateHotbar();
            showItemNotification();
        });

        function setPlayerInventoryOpen(isOpen) {
            mobileInventorySource = null;
            if (isOpen) resetMobileInput();
            if (isOpen && furnaceOpen) setFurnaceOpen(false);
            if (isOpen && workbenchOpen) setWorkbenchOpen(false);
            if (isOpen && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            playerInventory.hidden = !isOpen;
            playerInventoryOpen = isOpen;
            inventoryToggle.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) refreshPlayerInventoryUI();
        }

        function refreshWorkbenchUI() {
            if (!workbenchOpen) return;
            renderInventorySlots('backpack', backpackItems, workbenchBackpackSlots);
            renderInventorySlots('hotbar', hotbarItems, workbenchHotbarSlots);
            workbenchCraftGrid.replaceChildren();
            craftingGrid.forEach((type, index) => {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'craft-cell';
                cell.title = type ? `Return ${itemDefinitions[type].label}` : 'Add selected item';
                if (type) {
                    cell.innerHTML = '<canvas class="item-icon" width="44" height="44"></canvas><span class="cell-count">1</span>';
                    drawItemIcon(cell.querySelector('.item-icon'), type);
                }
                cell.addEventListener('click', () => {
                    mobileInventorySource = null;
                    if (craftingGrid[index]) {
                        if (mobileMode && canStoreItems(craftingGrid[index], 1)) {
                            storeItems(craftingGrid[index], 1);
                            craftingGrid[index] = null;
                            updateHotbar();
                        }
                        return;
                    }
                    const selected = getSelectedInventoryStack();
                    if (!selected || selected.count < 1) return;
                    craftingGrid[index] = selected.type;
                    removeItems(selected.type, 1);
                    updateHotbar();
                });
                cell.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    if (!craftingGrid[index] || !canStoreItems(craftingGrid[index], 1)) return;
                    storeItems(craftingGrid[index], 1);
                    craftingGrid[index] = null;
                    updateHotbar();
                });
                workbenchCraftGrid.appendChild(cell);
            });

            const recipe = getManualRecipe();
            if (!recipe) {
                workbenchOutput.textContent = craftingGrid.some(Boolean) ? 'No matching recipe' : 'Add materials';
                workbenchOutput.disabled = true;
                workbenchOutput.oncontextmenu = null;
                return;
            }
            workbenchOutput.disabled = !canStoreItems(recipe.output.type, recipe.output.count);
            workbenchOutput.innerHTML = `<canvas class="item-icon" width="40" height="40"></canvas><strong>${itemDefinitions[recipe.output.type].label} ×${recipe.output.count}</strong>`;
            drawItemIcon(workbenchOutput.querySelector('.item-icon'), recipe.output.type);
            workbenchOutput.oncontextmenu = event => {
                event.preventDefault();
                collectManualCraft(recipe);
            };
        }

        workbenchOutput.addEventListener('click', () => collectManualCraft(getManualRecipe()));

        function setWorkbenchOpen(isOpen) {
            mobileInventorySource = null;
            if (isOpen) resetMobileInput();
            if (isOpen && furnaceOpen) setFurnaceOpen(false);
            if (isOpen && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            workbenchScreen.hidden = !isOpen;
            workbenchOpen = isOpen;
            document.body.classList.toggle('workbench-open', isOpen);
            if (isOpen) {
                setPlayerInventoryOpen(false);
                setBlockPaletteOpen(false);
                refreshWorkbenchUI();
            }
        }

        let furnaceMessage = '';
        let furnaceRequestId = 0;
        let furnaceViewPending = false;
        let furnaceInventorySignature = '';

        function refreshFurnaceUI() {
            if (!furnaceOpen) return;
            const signature = JSON.stringify([hotbarItems, backpackItems, selectedInventoryItem, furnacePending, furnaceSaveUncertain]);
            if (signature !== furnaceInventorySignature) {
                furnaceInventorySignature = signature;
                renderInventorySlots('backpack', backpackItems, furnaceBackpackSlots);
                renderInventorySlots('hotbar', hotbarItems, furnaceHotbarSlots);
            }
            for (const [name, element] of Object.entries(furnaceSlotElements)) {
                const stack = furnaceState && furnaceState[name];
                element.disabled = furnacePending || furnaceSaveUncertain || !furnaceState;
                element.title = stack ? `${itemDefinitions[stack.type].label} ×${stack.count}` : `Empty ${name} slot`;
                element.replaceChildren();
                if (stack) {
                    element.innerHTML = '<canvas class="item-icon" width="44" height="44"></canvas><span class="cell-count"></span>';
                    drawItemIcon(element.querySelector('.item-icon'), stack.type);
                    element.querySelector('.cell-count').textContent = stack.count;
                }
            }
            if (furnaceMessage) furnaceStatus.textContent = furnaceMessage;
            else if (!furnaceState) furnaceStatus.textContent = 'Loading...';
            else if (furnaceState.endAt) {
                const seconds = Math.max(0, Math.ceil((furnaceState.endAt - (Date.now() + furnaceTimeOffset)) / 1000));
                furnaceStatus.textContent = `Smelting: ${seconds}s`;
            } else furnaceStatus.textContent = 'Waiting for ore and fuel';
        }

        async function requestFurnace(action, slot = null) {
            if (!furnaceOpen || !accountReady || furnaceSaveUncertain || (action === 'view' ? furnaceViewPending || furnacePending : furnacePending)) return;
            const requestId = ++furnaceRequestId;
            const position = {...furnacePosition};
            if (action === 'view') furnaceViewPending = true;
            else {
                furnaceMessage = '';
                furnacePending = true;
                if (accountProfileTimer !== null) {
                    clearTimeout(accountProfileTimer);
                    accountProfileTimer = null;
                }
                refreshFurnaceUI();
            }
            let timeout;
            try {
                if (action !== 'view') await profileSaveChain;
                const controller = new AbortController();
                timeout = setTimeout(() => controller.abort(), 10000);
                const body = {...position, action, slot};
                if (action !== 'view') {
                    body.profile = playerProfile();
                    body.revision = profileRevision;
                    body.container = selectedInventoryItem.container === 'backpack' ? 'backpackItems' : 'hotbarItems';
                    body.index = selectedInventoryItem.index;
                }
                const response = await fetch('/api/furnace', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${accountSession.token}`, 'X-Pixame-Room': roomId},
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                const data = await response.json();
                if (response.status === 401) {
                    accountReady = false;
                    accountSession = null;
                    localStorage.removeItem(accountStorageKey);
                    showAuth('Your session expired. Please sign in again.');
                }
                if (response.status === 409) {
                    accountReady = false;
                    furnaceSaveUncertain = true;
                    showAuth('Player data changed in another session. Sign in again.');
                }
                if (!response.ok) throw new Error(data.error || 'Furnace request failed.');
                if (action !== 'view') {
                    profileRevision = data.revision;
                    hotbarItems.splice(0, hotbarItems.length, ...readSavedSlots(data.profile.hotbarItems, hotbarItems.length));
                    backpackItems.splice(0, backpackItems.length, ...readSavedSlots(data.profile.backpackItems, backpackItems.length));
                    savePlayerState();
                }
                if (requestId === furnaceRequestId && furnaceOpen) {
                    furnaceState = data.furnace;
                    furnaceTimeOffset = data.serverTime - Date.now();
                    if (action !== 'view') furnaceMessage = '';
                }
                if (action !== 'view') updateHotbar();
            } catch (error) {
                console.error('Furnace request failed:', error);
                if (action !== 'view' && (error instanceof TypeError || error.name === 'AbortError' || error instanceof SyntaxError)) {
                    furnaceSaveUncertain = true;
                    furnaceMessage = 'Connection lost. Reload and sign in before continuing.';
                } else furnaceMessage = error.message;
            } finally {
                clearTimeout(timeout);
                if (action === 'view') furnaceViewPending = false;
                else {
                    furnacePending = false;
                    if (!furnaceSaveUncertain) scheduleAccountProfileSave();
                }
                refreshFurnaceUI();
            }
        }

        function setFurnaceOpen(isOpen, position = null) {
            if (furnacePending || furnaceSaveUncertain) return;
            mobileInventorySource = null;
            if (isOpen) resetMobileInput();
            if (isOpen && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            furnaceScreen.hidden = !isOpen;
            furnaceOpen = isOpen;
            document.body.classList.toggle('workbench-open', isOpen);
            clearInterval(furnacePollTimer);
            furnaceRequestId++;
            if (isOpen) {
                setWorkbenchOpen(false);
                setPlayerInventoryOpen(false);
                setBlockPaletteOpen(false);
                document.body.classList.add('workbench-open');
                furnacePosition = position;
                furnaceState = null;
                furnaceMessage = '';
                furnaceInventorySignature = '';
                requestFurnace('view');
                furnacePollTimer = setInterval(() => {
                    refreshFurnaceUI();
                    requestFurnace('view');
                }, 1000);
                refreshFurnaceUI();
            }
        }

        for (const [name, element] of Object.entries(furnaceSlotElements)) {
            element.addEventListener('click', () => {
                mobileInventorySource = null;
                requestFurnace(name === 'output' || mobileMode && furnaceState?.[name] ? 'take' : 'insert', name);
            });
            element.addEventListener('contextmenu', event => {
                event.preventDefault();
                requestFurnace('take', name);
            });
        }
        document.querySelector('[data-close-furnace]').addEventListener('click', () => setFurnaceOpen(false));

        function addPaletteBlock(type) {
            if (!isPlayerAdmin || !placeableBlockTypes.has(type)) return;
            const existingIndex = hotbarItems.findIndex(slot => slot?.type === type && slot.count < 99);
            const emptyIndex = hotbarItems.findIndex(slot => slot === null);
            const slotIndex = existingIndex >= 0 ? existingIndex : emptyIndex;
            if (slotIndex < 0) return;
            if (existingIndex >= 0) {
                hotbarItems[slotIndex].count = Math.min(99, hotbarItems[slotIndex].count + 64);
            } else {
                hotbarItems[slotIndex] = {type, count: 64};
            }

            selectedHotbarIndex = slotIndex;
            updateHotbar();
            showItemNotification();
            setBlockPaletteOpen(false);
        }

        const adminItemSelect = document.getElementById('admin-item-select');
        const adminItemMessage = document.getElementById('admin-item-message');
        adminItemSelect.addEventListener('focus', () => {
            const previous = adminItemSelect.value;
            adminItemSelect.replaceChildren();
            for (const [type, definition] of Object.entries(itemDefinitions)) {
                adminItemSelect.add(new Option(definition.label, type));
            }
            if (itemDefinitions[previous]) adminItemSelect.value = previous;
        });
        document.getElementById('admin-item-add').addEventListener('click', () => {
            if (!isPlayerAdmin) return;
            const type = adminItemSelect.value;
            if (!itemDefinitions[type]) {
                adminItemMessage.textContent = 'Select an item.';
                return;
            }
            if (!canStoreItems(type, 64)) {
                adminItemMessage.textContent = 'Not enough inventory space.';
                return;
            }
            storeItems(type, 64);
            updateHotbar();
            adminItemMessage.textContent = '';
        });

        inventoryToggle.addEventListener('click', () => {
            setPlayerInventoryOpen(playerInventory.hidden);
        });
        document.querySelector('[data-close-player-inventory]').addEventListener('click', () => setPlayerInventoryOpen(false));
        document.querySelector('[data-open-blocks]').addEventListener('click', () => {
            setPlayerInventoryOpen(false);
            setBlockPaletteOpen(true);
        });
        document.querySelector('[data-close-workbench]').addEventListener('click', () => setWorkbenchOpen(false));
        blockPalette.querySelector('.palette-close').addEventListener('click', () => setBlockPaletteOpen(false));
        blockPalette.querySelectorAll('[data-block-type]').forEach(button => {
            button.addEventListener('click', () => addPaletteBlock(button.dataset.blockType));
        });
        const sparkBlockSearch = document.getElementById('spark-block-search');
        const sparkBlockCategory = document.getElementById('spark-block-category');
        const sparkBlockGrid = document.getElementById('spark-block-grid');
        const sparkBlockPageStatus = document.getElementById('spark-block-page-status');
        const sparkBlockPrevious = document.getElementById('spark-block-previous');
        const sparkBlockNext = document.getElementById('spark-block-next');

        function renderSparkBlockPalette() {
            if (!sparkBlockGrid) return;
            const query = sparkBlockSearch.value.trim().toLowerCase();
            const category = sparkBlockCategory.value;
            const filtered = [...sparkBlockDefinitions.values()]
                .filter(definition => (category === 'all' || definition.category === category) &&
                    (!query || `${definition.category}/${definition.label}`.toLowerCase().includes(query)))
                .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
            const pageCount = Math.ceil(filtered.length / sparkBlocksPerPage);
            sparkBlockPage = Math.max(0, Math.min(sparkBlockPage, pageCount - 1));
            const start = sparkBlockPage * sparkBlocksPerPage;
            sparkBlockGrid.replaceChildren();
            for (const definition of filtered.slice(start, start + sparkBlocksPerPage)) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'palette-block';
                button.dataset.blockType = definition.type;
                button.title = `${definition.category} / ${definition.label}`;
                const icon = document.createElement('canvas');
                icon.className = 'item-icon';
                icon.width = 40;
                icon.height = 40;
                drawItemIcon(icon, definition.type);
                const label = document.createElement('span');
                label.textContent = definition.label;
                button.append(icon, label);
                button.addEventListener('click', () => addPaletteBlock(definition.type));
                sparkBlockGrid.appendChild(button);
            }
            sparkBlockPageStatus.textContent = filtered.length
                ? `${start + 1}-${Math.min(start + sparkBlocksPerPage, filtered.length)} of ${filtered.length} · page ${sparkBlockPage + 1}/${pageCount}`
                : 'No matching blocks';
            sparkBlockPrevious.disabled = sparkBlockPage === 0;
            sparkBlockNext.disabled = pageCount === 0 || sparkBlockPage >= pageCount - 1;
        }

        sparkBlockSearch.addEventListener('input', () => { sparkBlockPage = 0; renderSparkBlockPalette(); });
        sparkBlockCategory.addEventListener('change', () => { sparkBlockPage = 0; renderSparkBlockPalette(); });
        sparkBlockPrevious.addEventListener('click', () => { sparkBlockPage--; renderSparkBlockPalette(); });
        sparkBlockNext.addEventListener('click', () => { sparkBlockPage++; renderSparkBlockPalette(); });
        blockPalette.querySelectorAll('[data-palette-page]').forEach(button => {
            button.addEventListener('click', () => setPalettePage(button.dataset.palettePage));
        });
        window.addEventListener('keydown', event => {
            if (roomSwitching) return;
            if (!document.getElementById('admin-screen').hidden) return;
            if (isTextInputTarget(event.target)) return;
            if (furnacePending || furnaceSaveUncertain) return;
            if (isKeyBound('blockPalette', event)) {
                event.preventDefault();
                setPlayerInventoryOpen(false);
                setBlockPaletteOpen(blockPalette.hidden);
                return;
            }
            if (isKeyBound('inventory', event)) {
                event.preventDefault();
                if (furnaceOpen) { setFurnaceOpen(false); return; }
                if (workbenchOpen) { setWorkbenchOpen(false); return; }
                setPlayerInventoryOpen(playerInventory.hidden);
                return;
            }
            if (event.key === 'Escape' && !playerInventory.hidden) setPlayerInventoryOpen(false);
            if (event.key === 'Escape' && !workbenchScreen.hidden) setWorkbenchOpen(false);
            if (event.key === 'Escape' && !blockPalette.hidden) setBlockPaletteOpen(false);
            if (event.key === 'Escape' && furnaceOpen) setFurnaceOpen(false);
        });
        drawAllBlockIcons();
        craftingReady = true;
        setPalettePage(activePalettePage);

        function updateMiningCracks(target, progress) {
            if (!target || progress <= 0) {
                crackMesh.visible = false;
                crackTargetKey = null;
                crackStage = 0;
                return;
            }
            const targetKey = blockKey(target.x, target.y, target.z);
            const nextStage = Math.max(1, Math.min(8, Math.ceil(progress * 8)));
            crackMesh.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
            crackMesh.visible = true;
            if (targetKey === crackTargetKey && nextStage === crackStage) return;
            crackTargetKey = targetKey;
            crackStage = nextStage;
            crackContext.clearRect(0, 0, 64, 64);
            const size = 12 + Math.round(48 * nextStage / 8);
            const inset = Math.floor((64 - size) / 2);
            const border = 2 + Math.floor(nextStage / 4);
            const far = inset + size - border;
            crackContext.fillStyle = 'rgba(31, 28, 25, 0.92)';
            crackContext.fillRect(inset, inset, size, border);
            crackContext.fillRect(inset, far, size, border);
            crackContext.fillRect(inset, inset, border, size);
            crackContext.fillRect(far, inset, border, size);
            crackContext.fillStyle = 'rgba(220, 215, 196, 0.72)';
            crackContext.fillRect(inset + border, inset + border, Math.max(1, size - border * 2), 1);
            crackContext.fillRect(inset + border, inset + border, 1, Math.max(1, size - border * 2));
            crackTexture.needsUpdate = true;
        }

        function findAimedBlock() {
            const aimCamera = getAimCamera();
            blockRaycaster.setFromCamera(screenCenter, aimCamera);
            blockRaycaster.far = aimCamera === camera
                ? blockReach
                : aimCamera.position.distanceTo(viewTarget) + blockReach;
            const candidates = [];
            for (const chunk of terrainChunks.values()) {
                const minX = chunk.chunkX * chunkSize;
                const minZ = chunk.chunkZ * chunkSize;
                const bounds = new THREE.Box3(
                    new THREE.Vector3(minX, worldBottomY, minZ),
                    new THREE.Vector3(minX + chunkSize, 256, minZ + chunkSize)
                );
                if (blockRaycaster.ray.intersectsBox(bounds)) candidates.push(chunk.group);
            }
            const hits = blockRaycaster.intersectObjects(candidates, true);
            for (const hit of hits) {
                const mesh = hit.object;
                if (mesh.material === waterMaterial) continue;
                let x, y, z, type;
                if (mesh.isInstancedMesh && hit.instanceId !== undefined) {
                    const record = mesh.userData.blockRecords?.[hit.instanceId];
                    if (!record) continue;
                    [x, y, z] = record;
                    const recordHeight = record[3] || 1;
                    if (recordHeight > 1) {
                        y = Math.max(0, Math.min(recordHeight - 1, Math.floor(hit.point.y)));
                    }
                    type = mesh.userData.blockType === 'tree' ? record[7] : mesh.userData.blockType || record[7];
                    if (!type) {
                        const column = sampleTerrainColumn(x, z);
                        type = y < column.height - 1 ? 'dirt' : column.surfaceType;
                    }
                } else if (mesh.userData.worldPos) {
                    ({x, y, z} = mesh.userData.worldPos);
                    type = mesh.userData.blockType || 'grass';
                } else {
                    continue;
                }
                const normal = hit.face?.normal?.clone().transformDirection(mesh.matrixWorld);
                if (!normal) continue;
                normal.set(Math.round(normal.x), Math.round(normal.y), Math.round(normal.z));
                return {x, y, z, type, normal, aimPoint: hit.point.clone()};
            }
            return null;
        }

        let furnaceBreakPending = false;
        function performBlockAction(button, targetOverride = null, furnaceApproved = false) {
            const target = targetOverride || findAimedBlock();
            if (!target) return;
            if (button === 0) {
                if (target.type === 'bedrock' || target.y === worldBottomY) return;
                const key = blockKey(target.x, target.y, target.z);
                const placedType = placedBlocks.get(key);
                if (removedBlocks.has(key) && !placedType) return;
                const inventoryType = placedType || target.type;
                if (!canStoreItem(inventoryType)) return;
                if (placedType === 'furnace' && !furnaceApproved) {
                    if (furnaceBreakPending) return;
                    furnaceBreakPending = true;
                    socket.timeout(5000).emit('blockEdit', {
                        x: target.x, y: target.y, z: target.z, removed: removedBlocks.has(key), placedType: null
                    }, (error, result) => {
                        furnaceBreakPending = false;
                        if (error || !result?.ok) {
                            window.alert(result?.error || 'Could not break the furnace. Check your connection.');
                            return;
                        }
                        performBlockAction(0, target, true);
                    });
                    return;
                }
                if (placedType) {
                    placedBlocks.delete(key);
                    const columnKey = terrainColumnKey(target.x, target.z);
                    const column = placedColumns.get(columnKey);
                    if (column) {
                        column.delete(target.y);
                        if (column.size === 0) placedColumns.delete(columnKey);
                    }
                } else {
                    removedBlocks.add(key);
                }
                storeItem(inventoryType);
                updateHotbar();
                showItemNotification();
                rebuildTerrainAroundEdit(target.x, target.y, target.z);
                if (!furnaceApproved) socket.emit('blockEdit', currentWorldEdit(target.x, target.y, target.z));
                return;
            }

            if (button !== 2) return;
            if (target.type === 'crafting_table') {
                setWorkbenchOpen(true);
                return;
            }
            if (target.type === 'furnace') {
                setFurnaceOpen(true, {x: target.x, y: target.y, z: target.z});
                return;
            }
            const selected = hotbarItems[selectedHotbarIndex];
            if (!selected || selected.count <= 0) return;
            if (!placeableBlockTypes.has(selected.type)) return;
            const x = target.x + target.normal.x;
            const y = target.y + target.normal.y;
            const z = target.z + target.normal.z;
            const key = blockKey(x, y, z);
            if (isSolidBlockAt(x, y, z)) return;

            const playerBox = createPlayerBox(camera.position);
            const newBlockBox = new THREE.Box3(
                new THREE.Vector3(x, y, z),
                new THREE.Vector3(x + 1, y + 1, z + 1)
            );
            if (boxesOverlapStrict(playerBox, newBlockBox)) return;

            placedBlocks.set(key, selected.type);
            const columnKey = terrainColumnKey(x, z);
            if (!placedColumns.has(columnKey)) placedColumns.set(columnKey, new Map());
            placedColumns.get(columnKey).set(y, selected.type);
            if (!isPlayerAdmin) {
                selected.count--;
                if (selected.count === 0) hotbarItems[selectedHotbarIndex] = null;
            }
            updateHotbar();
            rebuildTerrainAroundEdit(x, y, z);
            socket.emit('blockEdit', currentWorldEdit(x, y, z));
        }

        renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

        // ==========================================
        // 🌐 【联机核心第二步】连接服务器 & 渲染其他玩家
        // ==========================================
        const socket = io({autoConnect: false, query: {room: roomId}});
        socket.on('moderationAction', ({message}) => {
            accountReady = false;
            accountSession = null;
            localStorage.removeItem(accountStorageKey);
            showAuth(message);
        });
        socket.on('connect_error', error => {
            if (error.message === 'Sign in is required or your account is banned.') {
                accountReady = false;
                accountSession = null;
                localStorage.removeItem(accountStorageKey);
                showAuth(error.message);
            } else {
                roomMessage.textContent = `Connection failed: ${error.message}`;
            }
        });
        const otherPlayers = {};

        function loadRemotePlayer(id) {
            if (!avatarFactory) return;
            const avatar = avatarFactory.create();
            otherPlayers[id] = { avatar, lastPosition: null, animation: {} };
            scene.add(avatar.root);
        }

        function updateRemotePlayer(remotePlayer, playerData) {
            const position = new THREE.Vector3(playerData.x, playerData.y - playerEyeHeight, playerData.z);
            const isMoving = remotePlayer.lastPosition &&
                Math.hypot(remotePlayer.lastPosition.x - position.x, remotePlayer.lastPosition.z - position.z) > 0.01;
            remotePlayer.avatar.root.position.copy(position);
            avatarFactory.setFacingYaw(remotePlayer.avatar, playerData.yaw || 0);
            remotePlayer.lastPosition = position;
            remotePlayer.animation = {
                moving: !!isMoving,
                forwardMove: Number.isFinite(playerData.forwardMove) ? playerData.forwardMove : (isMoving ? 1 : 0),
                strafeMove: Number.isFinite(playerData.strafeMove) ? playerData.strafeMove : 0,
                sprinting: !!playerData.sprinting,
                mining: !!playerData.mining,
                swimming: !!playerData.swimming,
                floating: !!playerData.floating,
                flying: !!playerData.flying,
                grounded: playerData.grounded !== false,
                verticalSpeed: Number.isFinite(playerData.verticalSpeed) ? playerData.verticalSpeed : 0
            };
        }

        socket.on('state', (serverPlayers) => {
            for (let id in serverPlayers) {
                if (id === socket.id) continue;
                const pData = serverPlayers[id];
                if (!otherPlayers[id]) {
                    loadRemotePlayer(id);
                }
                if (otherPlayers[id]) updateRemotePlayer(otherPlayers[id], pData);
            }
        });

        socket.on('blockEdit', edit => {
            if (!sparkBlocksReady) {
                pendingWorldEdits.push(edit);
                return;
            }
            applyWorldEdit(edit);
        });

        socket.on('worldEdits', edits => {
            if (!sparkBlocksReady) {
                pendingWorldEdits.push(...edits);
                return;
            }
            const dirtyColumns = new Map();
            for (const edit of edits) {
                if (!applyWorldEdit(edit, false)) continue;
                const key = terrainColumnKey(edit.x, edit.z);
                const previous = dirtyColumns.get(key);
                dirtyColumns.set(key, [edit.x, edit.z, previous ? Math.min(previous[2], edit.y) : edit.y]);
            }
            for (const [x, z, y] of dirtyColumns.values()) rebuildTerrainAroundEdit(x, y, z);
        });

        socket.on('playerDisconnected', (id) => {
            if (otherPlayers[id]) {
                if (otherPlayers[id].avatar) scene.remove(otherPlayers[id].avatar.root);
                delete otherPlayers[id];
            }
        });
        // ==========================================

        function boxesOverlapStrict(a, b) {
            return a.min.x < b.max.x && a.max.x > b.min.x &&
                   a.min.y < b.max.y && a.max.y > b.min.y &&
                   a.min.z < b.max.z && a.max.z > b.min.z;
        }

        function isSupported(position) {
            const supportEyeY = worldGroundEyeY(position.x, position.z, position.y - playerEyeHeight);
            return Math.abs(position.y - supportEyeY) < 0.25;
        }

        const clock = new THREE.Clock();
        let playerSaveElapsed = 0;
        const speed = 4;
        const jumpSpeed = 8;
        const gravity = 20;
        let velocityY = 0;
        let grounded = true;
        const move = { forward: false, back: false, left: false, right: false, sprint: false, flyUp: false, flyDown: false };
        const mobileControls = document.getElementById('mobile-controls');
        const mobileModeToggle = document.getElementById('mobile-mode-toggle');
        const settingsButton = document.getElementById('settings-button');
        const settingsScreen = document.getElementById('settings-screen');
        const settingsMessage = document.getElementById('settings-message');
        const cameraSensitivityInput = document.getElementById('camera-sensitivity');
        const cameraSensitivityValue = document.getElementById('camera-sensitivity-value');
        const mobileControlSizeInput = document.getElementById('mobile-control-size');
        const mobileControlSizeValue = document.getElementById('mobile-control-size-value');
        const cameraPerspectiveSelect = document.getElementById('camera-perspective');
        const shoulderSideRow = document.getElementById('shoulder-side-row');
        const shoulderSideSelect = document.getElementById('shoulder-side');
        const keybindingsList = document.getElementById('keybindings-list');
        const mobileJoystick = document.getElementById('mobile-joystick');
        const mobileKnob = document.getElementById('mobile-joystick-knob');
        const mobileSprint = document.getElementById('mobile-sprint');
        const mobileShoulderToggle = document.getElementById('mobile-shoulder-toggle');
        let joystickPointer = null;
        let lookPointer = null;
        let pendingKeybinding = null;

        function keyLabel(code) {
            const labels = {
                ArrowUp: 'UP ARROW', ArrowDown: 'DOWN ARROW',
                ArrowLeft: 'LEFT ARROW', ArrowRight: 'RIGHT ARROW',
                Space: 'SPACE', ShiftLeft: 'LEFT SHIFT', ShiftRight: 'RIGHT SHIFT',
                ControlLeft: 'LEFT CTRL', ControlRight: 'RIGHT CTRL',
                AltLeft: 'LEFT ALT', AltRight: 'RIGHT ALT'
            };
            if (labels[code]) return labels[code];
            if (/^Key[A-Z]$/.test(code)) return code.slice(3);
            if (/^Digit[0-9]$/.test(code)) return code.slice(5);
            return code;
        }

        function renderKeybindings() {
            keybindingsList.replaceChildren();
            for (const [action, label] of keybindingActions) {
                const row = document.createElement('div');
                row.className = 'keybinding-row';
                const actionLabel = document.createElement('span');
                actionLabel.textContent = label;
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.keybinding = action;
                button.setAttribute('aria-pressed', String(pendingKeybinding === action));
                button.textContent = pendingKeybinding === action
                    ? 'PRESS KEY…'
                    : gameSettings.keybindings[action].map(keyLabel).join(' / ');
                row.append(actionLabel, button);
                keybindingsList.append(row);
            }
        }

        function updateShoulderToggleButton() {
            const shoulder = gameSettings.shoulderSide.toUpperCase();
            mobileShoulderToggle.textContent = `SHOULDER: ${shoulder}`;
            mobileShoulderToggle.hidden = !mobileMode || perspectiveModes[perspectiveModeIndex] !== 'thirdBack';
        }

        function setShoulderSide(side) {
            gameSettings.shoulderSide = side === 'left' ? 'left' : 'right';
            shoulderSideSelect.value = gameSettings.shoulderSide;
            updateShoulderToggleButton();
            saveGameSettings();
        }

        function resetMobileInput() {
            joystickPointer = null;
            lookPointer = null;
            move.forward = move.back = move.left = move.right = false;
            move.sprint = move.flyUp = move.flyDown = false;
            mobileKnob.style.transform = '';
            mobileSprint.setAttribute('aria-pressed', 'false');
            miningActive = false;
            miningElapsed = 0;
            miningTargetKey = null;
            updateMiningCracks(null, 0);
        }

        function updateMobileMode() {
            resetMobileInput();
            mobileControls.hidden = !mobileMode;
            document.body.classList.toggle('mobile-mode', mobileMode);
            mobileModeToggle.setAttribute('aria-pressed', String(mobileMode));
            mobileModeToggle.textContent = `MOBILE: ${mobileMode ? 'ON' : 'OFF'}`;
            updateShoulderToggleButton();
            if (mobileMode && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        function saveGameSettings() {
            try {
                localStorage.setItem(settingsStorageKey, JSON.stringify(gameSettings));
                settingsMessage.textContent = '';
                return true;
            } catch (error) {
                console.error('Failed to save game settings:', error);
                settingsMessage.textContent = 'Could not save settings.';
                return false;
            }
        }
        function setSettingsOpen(open) {
            if (open) {
                resetMobileInput();
                look.dragging = false;
                if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
                settingsScreen.hidden = false;
                settingsMessage.textContent = settingsLoadError;
            } else {
                pendingKeybinding = null;
                renderKeybindings();
                settingsScreen.hidden = true;
            }
            settingsButton.setAttribute('aria-expanded', String(open));
        }
        function renderSettings() {
            cameraSensitivityInput.value = String(Math.round(gameSettings.cameraSensitivity * 100));
            cameraSensitivityValue.textContent = `${cameraSensitivityInput.value}%`;
            mobileControlSizeInput.value = String(Math.round(gameSettings.mobileControlScale * 100));
            mobileControlSizeValue.textContent = `${mobileControlSizeInput.value}%`;
            cameraPerspectiveSelect.value = perspectiveModes[perspectiveModeIndex];
            shoulderSideSelect.value = gameSettings.shoulderSide;
            shoulderSideRow.hidden = perspectiveModes[perspectiveModeIndex] !== 'thirdBack';
            updateShoulderToggleButton();
            renderKeybindings();
        }
        renderSettings();
        settingsButton.addEventListener('click', () => setSettingsOpen(settingsScreen.hidden));
        document.getElementById('settings-close').addEventListener('click', () => setSettingsOpen(false));
        cameraSensitivityInput.addEventListener('input', () => {
            gameSettings.cameraSensitivity = Number(cameraSensitivityInput.value) / 100;
            cameraSensitivityValue.textContent = `${cameraSensitivityInput.value}%`;
            saveGameSettings();
        });
        mobileControlSizeInput.addEventListener('input', () => {
            gameSettings.mobileControlScale = Number(mobileControlSizeInput.value) / 100;
            mobileControlSizeValue.textContent = `${mobileControlSizeInput.value}%`;
            updateMobileControlScale();
            saveGameSettings();
        });
        cameraPerspectiveSelect.addEventListener('change', () => {
            perspectiveModeIndex = perspectiveModes.indexOf(cameraPerspectiveSelect.value);
            gameSettings.cameraView = cameraPerspectiveSelect.value;
            renderSettings();
            saveGameSettings();
        });
        shoulderSideSelect.addEventListener('change', () => setShoulderSide(shoulderSideSelect.value));
        keybindingsList.addEventListener('click', event => {
            const button = event.target.closest('button[data-keybinding]');
            if (!button) return;
            pendingKeybinding = button.dataset.keybinding;
            const actionLabel = keybindingActions.find(([action]) => action === pendingKeybinding)?.[1];
            settingsMessage.textContent = `Press a key for ${actionLabel}. Escape cancels.`;
            renderKeybindings();
        });
        window.addEventListener('keydown', event => {
            if (!pendingKeybinding) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.code === 'Escape') {
                pendingKeybinding = null;
                settingsMessage.textContent = '';
                renderKeybindings();
                return;
            }
            if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) {
                settingsMessage.textContent = 'Choose a non-modifier key.';
                return;
            }
            const conflict = keybindingActions.find(([action]) =>
                action !== pendingKeybinding && gameSettings.keybindings[action].includes(event.code)
            );
            if (conflict) {
                settingsMessage.textContent = `${keyLabel(event.code)} is already assigned to ${conflict[1]}.`;
                return;
            }
            gameSettings.keybindings[pendingKeybinding] = [event.code];
            pendingKeybinding = null;
            renderKeybindings();
            saveGameSettings();
        }, true);
        mobileModeToggle.addEventListener('click', () => {
            mobileMode = !mobileMode;
            gameSettings.mobileMode = mobileMode;
            updateMobileMode();
            saveGameSettings();
        });
        mobileShoulderToggle.addEventListener('click', () => {
            if (!canUseMobileControls()) return;
            setShoulderSide(gameSettings.shoulderSide === 'right' ? 'left' : 'right');
        });
        document.getElementById('settings-reset').addEventListener('click', () => {
            Object.assign(gameSettings, createDefaultSettings());
            mobileMode = gameSettings.mobileMode === null
                ? window.matchMedia('(pointer: coarse)').matches
                : gameSettings.mobileMode;
            perspectiveModeIndex = 0;
            pendingKeybinding = null;
            renderSettings();
            updateMobileControlScale();
            updateMobileMode();
            saveGameSettings();
        });
        updateMobileMode();

        function canUseMobileControls() {
            return mobileMode && accountReady && authScreen.hidden && !roomSwitching &&
                !playerInventoryOpen && !workbenchOpen && !furnaceOpen && blockPalette.hidden &&
                settingsScreen.hidden && document.getElementById('admin-screen').hidden;
        }

        function updateMobileJoystick(event) {
            const rect = mobileJoystick.getBoundingClientRect();
            const dx = event.clientX - (rect.left + rect.width / 2);
            const dy = event.clientY - (rect.top + rect.height / 2);
            const radius = rect.width * 0.32;
            const distance = Math.hypot(dx, dy);
            const scale = distance > radius ? radius / distance : 1;
            mobileKnob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
            move.left = dx < -radius * 0.25;
            move.right = dx > radius * 0.25;
            move.forward = dy < -radius * 0.25;
            move.back = dy > radius * 0.25;
        }
        mobileJoystick.addEventListener('pointerdown', event => {
            if (!canUseMobileControls() || joystickPointer !== null) return;
            event.preventDefault();
            joystickPointer = event.pointerId;
            mobileJoystick.setPointerCapture(event.pointerId);
            updateMobileJoystick(event);
        });
        mobileJoystick.addEventListener('pointermove', event => {
            if (event.pointerId === joystickPointer) updateMobileJoystick(event);
        });
        function releaseJoystick(event) {
            if (event.pointerId !== joystickPointer) return;
            joystickPointer = null;
            mobileKnob.style.transform = '';
            move.forward = move.back = move.left = move.right = false;
        }
        mobileJoystick.addEventListener('pointerup', releaseJoystick);
        mobileJoystick.addEventListener('pointercancel', releaseJoystick);
        mobileSprint.addEventListener('click', () => {
            if (!canUseMobileControls()) return;
            move.sprint = !move.sprint;
            mobileSprint.setAttribute('aria-pressed', String(move.sprint));
        });

        function jump() {
            if (flying) {
                move.flyUp = true;
                return;
            }
            const feetY = camera.position.y - playerEyeHeight;
            if (grounded) {
                velocityY = jumpSpeed;
                grounded = false;
            } else if (waterSurfaceAt(camera.position.x, feetY, camera.position.z) !== null) {
                velocityY = Math.max(velocityY, jumpSpeed * 0.75);
            }
        }

        function startMining() {
            startHeldItemSwing();
            aimedBlock = findAimedBlock();
            miningActive = !!aimedBlock && aimedBlock.type !== 'bedrock';
            miningTargetKey = aimedBlock ? blockKey(aimedBlock.x, aimedBlock.y, aimedBlock.z) : null;
            miningElapsed = 0;
            updateMiningCracks(null, 0);
        }
        function stopMining() {
            miningActive = false;
            miningElapsed = 0;
            miningTargetKey = null;
            updateMiningCracks(null, 0);
        }
        function bindMobileHold(id, start, stop) {
            const button = document.getElementById(id);
            button.addEventListener('pointerdown', event => {
                if (!canUseMobileControls()) return;
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                start();
            });
            button.addEventListener('pointerup', stop);
            button.addEventListener('pointercancel', stop);
        }
        bindMobileHold('mobile-jump', jump, () => { move.flyUp = false; });
        bindMobileHold('mobile-down', () => { if (flying) move.flyDown = true; }, () => { move.flyDown = false; });
        bindMobileHold('mobile-mine', startMining, stopMining);
        document.getElementById('mobile-place').addEventListener('click', () => {
            if (canUseMobileControls()) performBlockAction(2);
        });
        function toggleAdminFlight() {
            if (!isPlayerAdmin || !accountReady || !authScreen.hidden || roomSwitching) return;
            flying = !flying;
            velocityY = 0;
            grounded = false;
            move.flyUp = false;
            move.flyDown = false;
            document.getElementById('admin-flight').textContent = `FLIGHT [F]: ${flying ? 'ON' : 'OFF'}`;
        }
        document.getElementById('admin-flight').addEventListener('click', toggleAdminFlight);
        const look = { dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0 };
        let thirdPersonYaw = look.yaw;
        let previousPerspectiveMode = perspectiveModes[perspectiveModeIndex];
        const shoulderOffset = 0.85;
        const shoulderHeightOffset = 0.35;
        let localAimDirection = null;
        const heldItemSwingDuration = 0.32;
        let heldItemSwingElapsed = heldItemSwingDuration;
        let heldItemWalkPhase = 0;
        let heldItemWalkAmount = 0;

        function startHeldItemSwing() {
            if (heldItemSwingElapsed >= heldItemSwingDuration) heldItemSwingElapsed = 0;
        }

        function updateHeldItemAnimation(dt, horizontalDistance, canAnimate) {
            const walking = canAnimate && grounded && horizontalDistance > 0.00001;
            if (walking) heldItemWalkPhase += horizontalDistance * 9;
            heldItemWalkAmount += ((walking ? 1 : 0) - heldItemWalkAmount) * (1 - Math.exp(-12 * dt));
            if (!canAnimate) heldItemSwingElapsed = heldItemSwingDuration;
            else if (miningActive && heldItemSwingElapsed >= heldItemSwingDuration) startHeldItemSwing();
            const swing = heldItemSwingElapsed < heldItemSwingDuration
                ? Math.sin(Math.PI * heldItemSwingElapsed / heldItemSwingDuration)
                : 0;
            heldItemSwingElapsed = Math.min(heldItemSwingDuration, heldItemSwingElapsed + dt);
            const bob = Math.sin(heldItemWalkPhase) * heldItemWalkAmount;
            const baseX = Math.min(0.36, 0.72 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * 0.72);
            heldItemModel.position.set(
                baseX + bob * 0.012 - swing * 0.075,
                -0.3 + Math.abs(bob) * 0.012 - swing * 0.045,
                -0.72 - swing * 0.035
            );
            heldItemModel.rotation.set(
                -0.2 - swing * 0.55,
                -0.7 + bob * 0.035 + swing * 0.16,
                1.35 + bob * 0.04 - swing * 0.35
            );
        }

        function updateCameraRotation() {
            look.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, look.pitch));
            camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
        }

        function updateLocalAvatarAim(target) {
            if (perspectiveModes[perspectiveModeIndex] !== 'thirdBack') {
                localAimDirection = null;
                return;
            }
            const cosPitch = Math.cos(look.pitch);
            const dx = target && target.aimPoint
                ? target.aimPoint.x - camera.position.x
                : -Math.sin(look.yaw) * cosPitch;
            const dy = target && target.aimPoint
                ? target.aimPoint.y - camera.position.y
                : Math.sin(look.pitch);
            const dz = target && target.aimPoint
                ? target.aimPoint.z - camera.position.z
                : -Math.cos(look.yaw) * cosPitch;
            const length = Math.hypot(dx, dy, dz);
            localAimDirection = length > 0.0001
                ? {x: dx / length, y: dy / length, z: dz / length}
                : null;
        }

        const viewDirection = new THREE.Vector3();
        const viewRight = new THREE.Vector3();
        const viewTarget = new THREE.Vector3();
        const viewRayDirection = new THREE.Vector3();
        const viewRaycaster = new THREE.Raycaster();
        const thirdPersonAimHeight = 1.5;
        const thirdPersonFaceHeight = 1.75;
        function updateThirdPersonFollow(dt) {
            const perspectiveMode = perspectiveModes[perspectiveModeIndex];
            if (perspectiveMode === 'first' || previousPerspectiveMode === 'first') {
                thirdPersonYaw = look.yaw;
            } else {
                const difference = Math.atan2(
                    Math.sin(look.yaw - thirdPersonYaw),
                    Math.cos(look.yaw - thirdPersonYaw)
                );
                thirdPersonYaw += difference * (1 - Math.exp(-8 * dt));
            }
            previousPerspectiveMode = perspectiveMode;
        }

        function updatePerspectiveCamera() {
            const perspectiveMode = perspectiveModes[perspectiveModeIndex];
            const isOverShoulder = perspectiveMode === 'thirdBack';
            const authScreen = document.getElementById('auth-screen');
            heldItemModel.visible = perspectiveMode === 'first' && !playerInventoryOpen && !workbenchOpen && !furnaceOpen && blockPalette.hidden && authScreen.hidden;
            if (playerAvatar) {
                playerAvatar.root.visible = perspectiveMode !== 'first';
                playerAvatar.root.position.set(camera.position.x, camera.position.y - playerEyeHeight, camera.position.z);
                avatarFactory.setFacingYaw(
                    playerAvatar,
                    perspectiveMode === 'thirdFront' ? thirdPersonYaw : look.yaw
                );
            }
            if (perspectiveMode === 'first') return camera;

            const directionMultiplier = perspectiveMode === 'thirdBack' ? -1 : 1;
            const cosPitch = Math.cos(look.pitch);
            viewDirection.set(
                -Math.sin(thirdPersonYaw) * cosPitch,
                Math.sin(look.pitch),
                -Math.cos(thirdPersonYaw) * cosPitch
            ).normalize();
            viewRight.crossVectors(viewDirection, camera.up).normalize().multiplyScalar(-directionMultiplier);
            viewTarget.set(
                camera.position.x,
                camera.position.y - playerEyeHeight +
                    (isOverShoulder ? thirdPersonAimHeight : thirdPersonFaceHeight),
                camera.position.z
            );
            if (isOverShoulder) {
                viewTarget.addScaledVector(viewRight, shoulderOffset * (gameSettings.shoulderSide === 'left' ? -1 : 1));
            }
            const viewDistance = 4.4;
            viewRayDirection.copy(viewDirection).multiplyScalar(directionMultiplier);
            viewRaycaster.set(viewTarget, viewRayDirection);
            viewRaycaster.far = viewDistance;

            const playerChunkX = Math.floor(viewTarget.x / chunkSize);
            const playerChunkZ = Math.floor(viewTarget.z / chunkSize);
            const terrainCandidates = [];
            for (let chunkX = playerChunkX - 1; chunkX <= playerChunkX + 1; chunkX++) {
                for (let chunkZ = playerChunkZ - 1; chunkZ <= playerChunkZ + 1; chunkZ++) {
                    const chunk = terrainChunks.get(`${chunkX},${chunkZ}`);
                    if (chunk) terrainCandidates.push(chunk.group);
                }
            }
            const obstruction = terrainCandidates.length > 0
                ? viewRaycaster.intersectObjects(terrainCandidates, true)[0]
                : null;
            let safeDistance = viewDistance;
            if (obstruction) {
                safeDistance = Math.max(0.35, obstruction.distance - 0.3);
            }
            viewCamera.position.copy(viewTarget).addScaledVector(viewRayDirection, safeDistance);
            if (isOverShoulder) viewCamera.position.y += shoulderHeightOffset;
            viewCamera.lookAt(viewTarget);
            viewCamera.updateMatrixWorld(true);
            return viewCamera;
        }

        function getAimCamera() {
            const aimCamera = perspectiveModes[perspectiveModeIndex] === 'first'
                ? camera
                : updatePerspectiveCamera();
            aimCamera.updateMatrixWorld(true);
            return aimCamera;
        }

        window.addEventListener('keydown', e => {
            if (roomSwitching) return;
            if (!settingsScreen.hidden) {
                if (e.key === 'Escape') setSettingsOpen(false);
                return;
            }
            if (!document.getElementById('admin-screen').hidden) return;
            if (isTextInputTarget(e.target)) return;
            if (furnaceOpen || furnaceSaveUncertain) return;
            if (isKeyBound('toggleFlight', e) && !e.repeat && !playerInventoryOpen && !workbenchOpen && blockPalette.hidden) {
                toggleAdminFlight();
                return;
            }
            if (isKeyBound('togglePerspective', e) && !e.repeat) {
                e.preventDefault();
                perspectiveModeIndex = (perspectiveModeIndex + 1) % perspectiveModes.length;
                gameSettings.cameraView = perspectiveModes[perspectiveModeIndex];
                renderSettings();
                saveGameSettings();
                return;
            }
            if (isKeyBound('toggleShoulder', e) && !e.repeat &&
                perspectiveModes[perspectiveModeIndex] === 'thirdBack') {
                setShoulderSide(gameSettings.shoulderSide === 'right' ? 'left' : 'right');
                return;
            }
            for (let index = 0; index < 8; index++) {
                if (!isKeyBound(`hotbar${index + 1}`, e)) continue;
                selectedHotbarIndex = index;
                updateHotbar();
                showItemNotification();
                return;
            }
            if (isKeyBound('moveForward', e)) move.forward = true;
            if (isKeyBound('moveBackward', e)) move.back = true;
            if (isKeyBound('moveLeft', e)) move.left = true;
            if (isKeyBound('moveRight', e)) move.right = true;
            if (isKeyBound('sprint', e)) {
                if (flying) move.flyDown = true;
                else move.sprint = true;
            }
            if (isKeyBound('jump', e)) {
                if (flying) e.preventDefault();
                jump();
            }
        });

        window.addEventListener('keyup', e => {
            if (isKeyBound('moveForward', e)) move.forward = false;
            if (isKeyBound('moveBackward', e)) move.back = false;
            if (isKeyBound('moveLeft', e)) move.left = false;
            if (isKeyBound('moveRight', e)) move.right = false;
            if (isKeyBound('sprint', e)) { move.sprint = false; move.flyDown = false; }
            if (isKeyBound('jump', e)) move.flyUp = false;
        });

        renderer.domElement.addEventListener('mousedown', e => {
            if (mobileMode) return;
            if (e.button === 0) {
                if (!authScreen.hidden || playerInventoryOpen || workbenchOpen || furnaceOpen || !blockPalette.hidden) return;
                startMining();
            }
            if (e.button === 2) {
                e.preventDefault();
                performBlockAction(2);
            }
            if (usePointerLock) {
                if (e.button === 0) renderer.domElement.requestPointerLock?.();
                return;
            }
            if (e.button !== 0) return;
            look.dragging = true;
            look.lastX = e.clientX;
            look.lastY = e.clientY;
        });

        renderer.domElement.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch' || !canUseMobileControls() || lookPointer !== null) return;
            event.preventDefault();
            lookPointer = event.pointerId;
            look.lastX = event.clientX;
            look.lastY = event.clientY;
            renderer.domElement.setPointerCapture(event.pointerId);
        });
        renderer.domElement.addEventListener('pointermove', event => {
            if (event.pointerId !== lookPointer) return;
            look.yaw -= (event.clientX - look.lastX) * 0.004 * gameSettings.cameraSensitivity;
            look.pitch -= (event.clientY - look.lastY) * 0.004 * gameSettings.cameraSensitivity;
            look.lastX = event.clientX;
            look.lastY = event.clientY;
            updateCameraRotation();
        });
        renderer.domElement.addEventListener('pointerup', event => {
            if (event.pointerId === lookPointer) lookPointer = null;
        });
        renderer.domElement.addEventListener('pointercancel', event => {
            if (event.pointerId === lookPointer) lookPointer = null;
        });

        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === renderer.domElement;
            if (locked) {
                document.addEventListener('mousemove', onPointerLockMove);
            } else {
                document.removeEventListener('mousemove', onPointerLockMove);
            }
        });

        function onPointerLockMove(e) {
            look.yaw -= e.movementX * 0.002 * gameSettings.cameraSensitivity;
            look.pitch -= e.movementY * 0.002 * gameSettings.cameraSensitivity;
            updateCameraRotation();
        }

        window.addEventListener('mouseup', e => {
            look.dragging = false;
            if (e.button === 0) {
                stopMining();
            }
        });
        window.addEventListener('blur', () => {
            resetMobileInput();
        });
        window.addEventListener('mousemove', e => {
            if (!look.dragging) return;
            const dx = e.clientX - look.lastX;
            const dy = e.clientY - look.lastY;
            look.lastX = e.clientX;
            look.lastY = e.clientY;
            look.yaw -= dx * 0.002 * gameSettings.cameraSensitivity;
            look.pitch -= dy * 0.002 * gameSettings.cameraSensitivity;
            updateCameraRotation();
        });

        function animate() {
            requestAnimationFrame(animate);
            if (roomSwitching) return;
            const dt = Math.min(clock.getDelta(), 0.05);
            updateThirdPersonFollow(dt);
            playerSaveElapsed += dt;
            if (playerSaveElapsed >= 1) {
                playerSaveElapsed = 0;
                savePlayerState();
            }
            for (const remotePlayer of Object.values(otherPlayers)) {
                if (avatarFactory) avatarFactory.update(remotePlayer.avatar, remotePlayer.animation, dt);
            }
            targetScanElapsed += dt;
            if (targetScanElapsed >= 0.08) {
                const nextTarget = findAimedBlock();
                const nextKey = nextTarget ? blockKey(nextTarget.x, nextTarget.y, nextTarget.z) : null;
                if (miningActive && nextKey !== miningTargetKey) {
                    miningTargetKey = nextKey;
                    miningElapsed = 0;
                    miningActive = !!nextTarget && nextTarget.type !== 'bedrock';
                }
                aimedBlock = nextTarget;
                updateLocalAvatarAim(nextTarget);
                if (!miningActive) updateMiningCracks(null, 0);
                targetScanElapsed = 0;
            }
            if (miningActive && aimedBlock) {
                miningElapsed += dt;
                const duration = miningDurationFor(aimedBlock.type);
                const progress = Math.min(1, miningElapsed / duration);
                updateMiningCracks(aimedBlock, progress);
                if (progress >= 1) {
                    performBlockAction(0, aimedBlock);
                    miningActive = false;
                    miningElapsed = 0;
                    miningTargetKey = null;
                    aimedBlock = findAimedBlock();
                    updateMiningCracks(null, 0);
                }
            }
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
            const moveDir = new THREE.Vector3();
            const previousX = camera.position.x;
            const previousZ = camera.position.z;
            if (move.forward) moveDir.add(forward);
            if (move.back) moveDir.sub(forward);
            if (move.left) moveDir.sub(right);
            if (move.right) moveDir.add(right);
            const isMoving = moveDir.lengthSq() > 0;
            const forwardMove = Number(move.forward) - Number(move.back);
            const strafeMove = Number(move.right) - Number(move.left);

            const feetY = camera.position.y - playerEyeHeight;
            const waterSurface = waterSurfaceAt(camera.position.x, feetY, camera.position.z);
            const inWater = waterSurface !== null;
            const supportEyeY = worldGroundEyeY(camera.position.x, camera.position.z, feetY);
            const waterImmersion = inWater ? clamp01((waterSurface - feetY) / playerBodyHeight) : 0;
            if (grounded) {
                if (!isSupported(camera.position)) {
                    grounded = false;
                } else {
                    velocityY = 0;
                }
            }
            const waterAnimation = !flying && inWater
                ? playerWaterPose(waterSurface, feetY, camera.position.y, grounded)
                : 'none';
            const swimming = waterAnimation === 'swimming';
            const floating = waterAnimation === 'floating';
            if (playerAvatar) avatarFactory.update(playerAvatar, {
                moving: isMoving,
                forwardMove,
                strafeMove,
                mining: miningActive,
                sprinting: move.sprint,
                swimming,
                floating,
                flying: flying && isPlayerAdmin,
                grounded,
                verticalSpeed: velocityY,
                aimDirection: localAimDirection
            }, dt);

            if (moveDir.lengthSq() > 0) {
                const movementSpeed = speed * (move.sprint ? 1.55 : 1);
                moveDir.normalize().multiplyScalar(movementSpeed * (1 - waterImmersion * 0.5) * dt);
            }
            if (moveDir.lengthSq() > 0) {
                const nextX = camera.position.clone();
                nextX.x += moveDir.x;
                nextX.y = camera.position.y;
                if (canMoveTo(nextX, camera.position)) {
                    camera.position.x = nextX.x;
                }

                const nextZ = camera.position.clone();
                nextZ.z += moveDir.z;
                nextZ.y = camera.position.y;
                if (canMoveTo(nextZ, camera.position)) {
                    camera.position.z = nextZ.z;
                }
            }

            if (flying && isPlayerAdmin) {
                grounded = false;
                velocityY = speed * ((move.flyUp ? 1 : 0) - (move.flyDown ? 1 : 0));
            }
            if (!grounded) {
                const currentFeetY = camera.position.y - playerEyeHeight;
                const currentWaterSurface = waterSurfaceAt(camera.position.x, currentFeetY, camera.position.z);
                const immersion = currentWaterSurface !== null ? clamp01((currentWaterSurface - currentFeetY) / playerBodyHeight) : 0;
                if (!flying) {
                    velocityY += (-gravity + gravity * 2.4 * immersion) * dt;
                    velocityY *= Math.exp(-7 * immersion * dt);
                }
                const nextY = camera.position.y + velocityY * dt;
                const nextPos = camera.position.clone();
                nextPos.y = nextY;
                const nextFeetY = nextY - playerEyeHeight;
                const landingEyeY = worldGroundEyeY(camera.position.x, camera.position.z, currentFeetY);
                const collision = velocityY > 0 ? findHeadCollision(camera.position, nextPos) : null;
                if (collision) {
                    camera.position.y = collision.y - playerBodyHeight + playerEyeHeight;
                    velocityY = 0;
                } else if (velocityY <= 0 && nextFeetY <= landingEyeY - playerEyeHeight) {
                    camera.position.y = landingEyeY;
                    velocityY = 0;
                    grounded = true;
                } else {
                    camera.position.y = nextY;
                }
            }

            updateTerrainChunks();

            if (camera.position.y < worldBottomY - 5) {
                camera.position.copy(spawnPosition);
                velocityY = 0;
                grounded = true;
            }

            const horizontalDistance = Math.hypot(camera.position.x - previousX, camera.position.z - previousZ);
            const canAnimateHeldItem = perspectiveModes[perspectiveModeIndex] === 'first' &&
                authScreen.hidden && !playerInventoryOpen && !workbenchOpen && !furnaceOpen && blockPalette.hidden;
            updateHeldItemAnimation(dt, horizontalDistance, canAnimateHeldItem);

            if (socket.connected) socket.emit('move', {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                yaw: look.yaw,
                forwardMove,
                strafeMove,
                sprinting: move.sprint,
                mining: miningActive,
                swimming,
                floating,
                flying: flying && isPlayerAdmin,
                grounded,
                verticalSpeed: velocityY
            });

            updateSunForPlayer();
            renderer.render(scene, updatePerspectiveCamera());
            if (heldItemModel.visible && heldItemModel.children.length) {
                renderer.autoClear = false;
                renderer.clearDepth();
                renderer.render(heldItemScene, heldItemCamera);
                renderer.autoClear = true;
            }
        }

        updateCameraRotation();
        animate();
        const adminScreen = document.getElementById('admin-screen');
        const adminMessage = document.getElementById('admin-message');
        async function adminRequest(url, body) {
            const response = await fetch(url, {
                method: body ? 'POST' : 'GET',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${accountSession.token}`, 'X-Pixame-Room': roomId},
                ...(body ? {body: JSON.stringify(body)} : {})
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Administrator request failed.');
            return data;
        }
        async function refreshAdminPanel() {
            if (!isPlayerAdmin) return;
            const status = await adminRequest('/api/admin/status');
            const roomList = document.getElementById('admin-room-list');
            const playerList = document.getElementById('admin-player-list');
            const banList = document.getElementById('admin-ban-list');
            roomList.replaceChildren();
            playerList.replaceChildren();
            banList.replaceChildren();
            const appendAction = (list, label, actionText, handler) => {
                const row = document.createElement('div');
                const text = document.createElement('span');
                text.textContent = label;
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = actionText;
                button.addEventListener('click', () => runAdminAction(handler));
                row.append(text, button);
                list.appendChild(row);
            };
            for (const [id, info] of Object.entries(status.rooms)) {
                if (!info.active) continue;
                appendAction(roomList, id, 'ARCHIVE', () => {
                    if (!window.confirm(`Archive ${id}? Its saves will be kept.`)) return Promise.resolve();
                    return adminRequest('/api/admin/rooms/archive', {id});
                });
            }
            for (const player of status.online) {
                appendAction(playerList, `${player.username} (${player.accountId.slice(0, 8)}) - ${player.room}`, 'KICK',
                    () => adminRequest('/api/admin/moderation', {action: 'kick', accountId: player.accountId}));
                appendAction(playerList, '', 'BAN', () => {
                    const input = document.getElementById('admin-ban-hours').value;
                    const hours = Number(input);
                    if (!input || !Number.isFinite(hours) || hours < 0 || hours > 87600) throw new Error('Enter ban hours, or 0 for permanent.');
                    return adminRequest('/api/admin/moderation', {action: 'ban', accountId: player.accountId, hours: hours === 0 ? null : hours});
                });
            }
            for (const ban of status.bans) {
                const expiry = ban.until === null ? 'permanent' : new Date(ban.until).toLocaleString();
                appendAction(banList, `${ban.accountId.slice(0, 8)} - ${expiry}`, 'UNBAN',
                    () => adminRequest('/api/admin/moderation', {action: 'unban', accountId: ban.accountId}));
            }
            const available = await adminRequest('/api/rooms');
            for (const id of Object.keys(roomSeeds)) delete roomSeeds[id];
            for (const room of available) roomSeeds[room.id] = room.seed;
            roomSelect.replaceChildren(...available.map(room => new Option(room.id, room.id)));
            roomSelect.value = roomId;
        }
        async function runAdminAction(action) {
            try {
                adminMessage.textContent = '';
                await action();
                await refreshAdminPanel();
            } catch (error) {
                console.error('Administrator action failed:', error);
                adminMessage.textContent = error.message;
            }
        }
        document.getElementById('admin-open').addEventListener('click', () => {
            if (!isPlayerAdmin) return;
            if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            for (const key of Object.keys(move)) move[key] = false;
            miningActive = false;
            adminScreen.hidden = false;
            runAdminAction(() => Promise.resolve());
        });
        document.getElementById('admin-close').addEventListener('click', () => { adminScreen.hidden = true; });
        document.getElementById('admin-refresh').addEventListener('click', () => runAdminAction(() => Promise.resolve()));
        document.getElementById('admin-room-create').addEventListener('click', () => runAdminAction(() =>
            adminRequest('/api/admin/rooms', {id: document.getElementById('admin-room-name').value})));
        roomSelect.addEventListener('change', async () => {
            const nextRoom = roomSelect.value;
            if (!Object.hasOwn(roomSeeds, nextRoom) || nextRoom === roomId) return;
            if (accountInitializing || authSubmit.disabled || furnacePending || furnaceSaveUncertain) {
                roomMessage.textContent = 'Wait for the current operation to finish before switching rooms.';
                roomSelect.value = roomId;
                return;
            }
            if (personalCraftingGrid.some(Boolean) || craftingGrid.some(Boolean)) {
                roomMessage.textContent = 'Return or craft the items in your crafting grids before switching.';
                roomSelect.value = roomId;
                return;
            }
            roomSwitching = true;
            roomSwitchScreen.hidden = false;
            roomMessage.textContent = '';
            try {
                if (accountReady) {
                    if (!socket.connected) throw new Error('Connect to the server before switching rooms.');
                    await new Promise((resolve, reject) => {
                        socket.timeout(5000).emit('roomSwitchBarrier', (error, result) => {
                            if (error || !result?.ok) reject(new Error(result?.error || 'Could not confirm room changes. Try again.'));
                            else resolve();
                        });
                    });
                    if (playerSaveTimer !== null) {
                        clearTimeout(playerSaveTimer);
                        playerSaveTimer = null;
                    }
                    savePlayerState();
                    if (accountProfileTimer !== null) {
                        clearTimeout(accountProfileTimer);
                        accountProfileTimer = null;
                    }
                    await saveAccountProfile();
                    if (!accountReady) throw new Error('Sign in before switching rooms.');
                }
                const url = new URL(location.href);
                url.searchParams.set('room', nextRoom);
                location.assign(url.href);
            } catch (error) {
                console.error('Failed to switch rooms:', error);
                roomMessage.textContent = error.message;
                roomSelect.value = roomId;
                roomSwitching = false;
                roomSwitchScreen.hidden = true;
            }
        });
        initializeAccountSession().finally(() => { accountInitializing = false; }).then(initializeGoogleSignIn);
