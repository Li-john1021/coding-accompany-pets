"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const electron_1 = require("electron");
const map = new Map();
electron_1.contextBridge.exposeInMainWorld('screenshots', {
    ready: () => {
        console.log('contextBridge ready');
        electron_1.ipcRenderer.send('SCREENSHOTS:ready');
    },
    reset: () => {
        console.log('contextBridge reset');
        electron_1.ipcRenderer.send('SCREENSHOTS:reset');
    },
    save: (arrayBuffer, data) => {
        console.log('contextBridge save', arrayBuffer, data);
        electron_1.ipcRenderer.send('SCREENSHOTS:save', Buffer.from(arrayBuffer), data);
    },
    cancel: () => {
        console.log('contextBridge cancel');
        electron_1.ipcRenderer.send('SCREENSHOTS:cancel');
    },
    ok: (arrayBuffer, data) => {
        console.log('contextBridge ok', arrayBuffer, data);
        electron_1.ipcRenderer.send('SCREENSHOTS:ok', Buffer.from(arrayBuffer), data);
    },
    on: (channel, fn) => {
        var _a;
        console.log('contextBridge on', fn);
        const listener = (_event, ...args) => {
            console.log('contextBridge on', channel, fn, ...args);
            fn(...args);
        };
        const listeners = (_a = map.get(fn)) !== null && _a !== void 0 ? _a : {};
        listeners[channel] = listener;
        map.set(fn, listeners);
        electron_1.ipcRenderer.on(`SCREENSHOTS:${channel}`, listener);
    },
    off: (channel, fn) => {
        var _a;
        console.log('contextBridge off', fn);
        const listeners = (_a = map.get(fn)) !== null && _a !== void 0 ? _a : {};
        const listener = listeners[channel];
        delete listeners[channel];
        if (!listener) {
            return;
        }
        electron_1.ipcRenderer.off(`SCREENSHOTS:${channel}`, listener);
    },
});
//# sourceMappingURL=preload.js.map