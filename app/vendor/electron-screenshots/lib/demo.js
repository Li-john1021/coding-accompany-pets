"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const electron_1 = require("electron");
const index_js_1 = __importDefault(require("./index.js"));
electron_1.app.whenReady().then(() => {
    const screenshots = new index_js_1.default({
        lang: {
            operation_rectangle_title: '矩形2323',
        },
        singleWindow: true,
    });
    screenshots.$view.webContents.openDevTools();
    electron_1.globalShortcut.register('ctrl+shift+a', () => {
        screenshots.startCapture();
    });
    screenshots.on('windowCreated', ($win) => {
        $win.on('focus', () => {
            electron_1.globalShortcut.register('esc', () => {
                if ($win === null || $win === void 0 ? void 0 : $win.isFocused()) {
                    screenshots.endCapture();
                }
            });
        });
        $win.on('blur', () => {
            electron_1.globalShortcut.unregister('esc');
        });
    });
    // 防止不能关闭截图界面
    electron_1.globalShortcut.register('ctrl+shift+q', () => {
        electron_1.app.quit();
    });
    // 点击确定按钮回调事件
    screenshots.on('ok', (_event, buffer, bounds) => {
        console.log('capture', buffer, bounds);
    });
    // 点击取消按钮回调事件
    screenshots.on('cancel', () => {
        console.log('capture', 'cancel1');
        screenshots.setLang({
            operation_ellipse_title: 'ellipse',
            operation_rectangle_title: 'rectangle',
        });
    });
    // 点击保存按钮回调事件
    screenshots.on('save', (_event, buffer, bounds) => {
        console.log('capture', buffer, bounds);
    });
    const mainWin = new electron_1.BrowserWindow({
        show: true,
    });
    mainWin.removeMenu();
    mainWin.loadURL('https://github.com/nashaofu');
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=demo.js.map