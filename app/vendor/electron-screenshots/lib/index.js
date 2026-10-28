"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = __importDefault(require("node:events"));
const debug_1 = __importDefault(require("debug"));
const electron_1 = require("electron");
const fs_extra_1 = __importDefault(require("fs-extra"));
const event_js_1 = __importDefault(require("./event.js"));
const getDisplay_js_1 = __importDefault(require("./getDisplay.js"));
const padStart_js_1 = __importDefault(require("./padStart.js"));
class Screenshots extends node_events_1.default {
    constructor(opts) {
        super();
        // 截图窗口对象
        this.$win = null;
        this.$view = new electron_1.BrowserView({
            webPreferences: {
                preload: require.resolve('./preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
        });
        this.isReady = new Promise((resolve) => {
            electron_1.ipcMain.once('SCREENSHOTS:ready', () => {
                this.logger('SCREENSHOTS:ready');
                resolve();
            });
        });
        this.logger = (opts === null || opts === void 0 ? void 0 : opts.logger) || (0, debug_1.default)('electron-screenshots');
        this.singleWindow = (opts === null || opts === void 0 ? void 0 : opts.singleWindow) || false;
        this.listenIpc();
        this.$view.webContents.loadURL(`file://${require.resolve('react-screenshots/dist/electron.html')}`);
        if (opts === null || opts === void 0 ? void 0 : opts.lang) {
            this.setLang(opts.lang);
        }
    }
    /**
     * 开始截图
     */
    startCapture() {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger('startCapture');
            const display = (0, getDisplay_js_1.default)();
            const [imageUrl] = yield Promise.all([this.capture(display), this.isReady]);
            yield this.createWindow(display);
            this.$view.webContents.send('SCREENSHOTS:capture', display, imageUrl);
        });
    }
    /**
     * 结束截图
     */
    endCapture() {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger('endCapture');
            yield this.reset();
            if (!this.$win) {
                return;
            }
            // 先清除 Kiosk 模式，然后取消全屏才有效
            this.$win.setKiosk(false);
            this.$win.blur();
            this.$win.blurWebView();
            this.$win.unmaximize();
            this.$win.removeBrowserView(this.$view);
            if (this.singleWindow) {
                this.$win.hide();
            }
            else {
                this.$win.destroy();
            }
        });
    }
    /**
     * 设置语言
     */
    setLang(lang) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger('setLang', lang);
            yield this.isReady;
            this.$view.webContents.send('SCREENSHOTS:setLang', lang);
        });
    }
    reset() {
        return __awaiter(this, void 0, void 0, function* () {
            // 重置截图区域
            this.$view.webContents.send('SCREENSHOTS:reset');
            // 保证 UI 有足够的时间渲染
            yield Promise.race([
                new Promise((resolve) => {
                    setTimeout(() => resolve(), 500);
                }),
                new Promise((resolve) => {
                    electron_1.ipcMain.once('SCREENSHOTS:reset', () => resolve());
                }),
            ]);
        });
    }
    /**
     * 初始化窗口
     */
    createWindow(display) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            // 重置截图区域
            yield this.reset();
            // 复用未销毁的窗口
            if (!this.$win || ((_b = (_a = this.$win) === null || _a === void 0 ? void 0 : _a.isDestroyed) === null || _b === void 0 ? void 0 : _b.call(_a))) {
                const windowTypes = {
                    darwin: 'panel',
                    // linux 必须设置为 undefined，否则会在部分系统上不能触发focus 事件
                    // https://github.com/nashaofu/screenshots/issues/203#issuecomment-1518923486
                    linux: undefined,
                    win32: 'toolbar',
                };
                this.$win = new electron_1.BrowserWindow({
                    title: 'screenshots',
                    x: display.x,
                    y: display.y,
                    width: display.width,
                    height: display.height,
                    useContentSize: true,
                    type: windowTypes[process.platform],
                    frame: false,
                    show: false,
                    autoHideMenuBar: true,
                    transparent: true,
                    resizable: false,
                    movable: false,
                    minimizable: false,
                    maximizable: false,
                    // focusable 必须设置为 true, 否则窗口不能及时响应esc按键，输入框也不能输入
                    focusable: true,
                    skipTaskbar: true,
                    alwaysOnTop: true,
                    /**
                     * linux 下必须设置为false，否则不能全屏显示在最上层
                     * mac 下设置为false，否则可能会导致程序坞不恢复问题，且与 kiosk 模式冲突
                     */
                    fullscreen: false,
                    // mac fullscreenable 设置为 true 会导致应用崩溃
                    fullscreenable: false,
                    kiosk: true,
                    backgroundColor: '#00000000',
                    titleBarStyle: 'hidden',
                    hasShadow: false,
                    paintWhenInitiallyHidden: false,
                    // mac 特有的属性
                    roundedCorners: false,
                    enableLargerThanScreen: false,
                    acceptFirstMouse: true,
                });
                this.emit('windowCreated', this.$win);
                this.$win.on('show', () => {
                    var _a, _b;
                    (_a = this.$win) === null || _a === void 0 ? void 0 : _a.focus();
                    (_b = this.$win) === null || _b === void 0 ? void 0 : _b.setKiosk(true);
                });
                this.$win.on('closed', () => {
                    this.emit('windowClosed', this.$win);
                    this.$win = null;
                });
            }
            this.$win.setBrowserView(this.$view);
            // 适定平台
            if (process.platform === 'darwin') {
                this.$win.setWindowButtonVisibility(false);
            }
            if (process.platform !== 'win32') {
                this.$win.setVisibleOnAllWorkspaces(true, {
                    visibleOnFullScreen: true,
                    skipTransformProcessType: true,
                });
            }
            this.$win.blur();
            this.$win.setBounds(display);
            this.$view.setBounds({
                x: 0,
                y: 0,
                width: display.width,
                height: display.height,
            });
            this.$win.setAlwaysOnTop(true);
            this.$win.show();
        });
    }
    capture(display) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger('SCREENSHOTS:capture');
            try {
                const { Monitor } = yield import('node-screenshots');
                let point = {
                    x: display.x + display.width / 2,
                    y: display.y + display.height / 2,
                };
                if (process.platform === 'win32') {
                    point = electron_1.screen.screenToDipPoint(point);
                }
                const monitor = Monitor.fromPoint(point.x, point.y);
                this.logger('SCREENSHOTS:capture Monitor.fromPoint arguments %o', display);
                this.logger('SCREENSHOTS:capture Monitor.fromPoint return %o', {
                    id: monitor === null || monitor === void 0 ? void 0 : monitor.id,
                    name: monitor === null || monitor === void 0 ? void 0 : monitor.name,
                    x: monitor === null || monitor === void 0 ? void 0 : monitor.x,
                    y: monitor === null || monitor === void 0 ? void 0 : monitor.y,
                    width: monitor === null || monitor === void 0 ? void 0 : monitor.width,
                    height: monitor === null || monitor === void 0 ? void 0 : monitor.height,
                    rotation: monitor === null || monitor === void 0 ? void 0 : monitor.rotation,
                    scaleFactor: monitor === null || monitor === void 0 ? void 0 : monitor.scaleFactor,
                    frequency: monitor === null || monitor === void 0 ? void 0 : monitor.frequency,
                    isPrimary: monitor === null || monitor === void 0 ? void 0 : monitor.isPrimary,
                });
                if (!monitor) {
                    throw new Error(`Monitor.fromDisplay(${display.id}) get null`);
                }
                const image = yield monitor.captureImage();
                const buffer = yield image.toPng(true);
                return `data:image/png;base64,${buffer.toString('base64')}`;
            }
            catch (err) {
                this.logger('SCREENSHOTS:capture Monitor capture() error %o', err);
                const sources = yield electron_1.desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: {
                        width: Math.floor(display.width * display.scaleFactor),
                        height: Math.floor(display.height * display.scaleFactor),
                    },
                });
                let source;
                // Linux系统上，screen.getDisplayNearestPoint 返回的 Display 对象的 id
                // 和这里 source 对象上的 display_id(Linux上，这个值是空字符串) 或 id 的中间部分，都不一致
                // 但是，如果只有一个显示器的话，其实不用判断，直接返回就行
                if (sources.length === 1) {
                    [source] = sources;
                }
                else {
                    source = sources.find((item) => item.display_id === display.id.toString() ||
                        item.id.startsWith(`screen:${display.id}:`));
                }
                if (!source) {
                    this.logger("SCREENSHOTS:capture Can't find screen source. sources: %o, display: %o", sources, display);
                    throw new Error("Can't find screen source");
                }
                return source.thumbnail.toDataURL();
            }
        });
    }
    /**
     * 绑定ipc时间处理
     */
    listenIpc() {
        /**
         * OK事件
         */
        electron_1.ipcMain.on('SCREENSHOTS:ok', (_event, buffer, data) => {
            this.logger('SCREENSHOTS:ok buffer.length %d, data: %o', buffer.length, data);
            const event = new event_js_1.default();
            this.emit('ok', event, buffer, data);
            if (event.defaultPrevented) {
                return;
            }
            electron_1.clipboard.writeImage(electron_1.nativeImage.createFromBuffer(buffer));
            this.endCapture();
        });
        /**
         * CANCEL事件
         */
        electron_1.ipcMain.on('SCREENSHOTS:cancel', () => {
            this.logger('SCREENSHOTS:cancel');
            const event = new event_js_1.default();
            this.emit('cancel', event);
            if (event.defaultPrevented) {
                return;
            }
            this.endCapture();
        });
        /**
         * SAVE事件
         */
        electron_1.ipcMain.on('SCREENSHOTS:save', (_event, buffer, data) => __awaiter(this, void 0, void 0, function* () {
            this.logger('SCREENSHOTS:save buffer.length %d, data: %o', buffer.length, data);
            const event = new event_js_1.default();
            this.emit('save', event, buffer, data);
            if (event.defaultPrevented || !this.$win) {
                return;
            }
            const time = new Date();
            const year = time.getFullYear();
            const month = (0, padStart_js_1.default)(time.getMonth() + 1, 2, '0');
            const date = (0, padStart_js_1.default)(time.getDate(), 2, '0');
            const hours = (0, padStart_js_1.default)(time.getHours(), 2, '0');
            const minutes = (0, padStart_js_1.default)(time.getMinutes(), 2, '0');
            const seconds = (0, padStart_js_1.default)(time.getSeconds(), 2, '0');
            const milliseconds = (0, padStart_js_1.default)(time.getMilliseconds(), 3, '0');
            this.$win.setAlwaysOnTop(false);
            const { canceled, filePath } = yield electron_1.dialog.showSaveDialog(this.$win, {
                defaultPath: `${year}${month}${date}${hours}${minutes}${seconds}${milliseconds}.png`,
                filters: [
                    { name: 'Image (png)', extensions: ['png'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });
            if (!this.$win) {
                this.emit('afterSave', new event_js_1.default(), buffer, data, false); // isSaved = false
                return;
            }
            this.$win.setAlwaysOnTop(true);
            if (canceled || !filePath) {
                this.emit('afterSave', new event_js_1.default(), buffer, data, false); // isSaved = false
                return;
            }
            yield fs_extra_1.default.writeFile(filePath, buffer);
            this.emit('afterSave', new event_js_1.default(), buffer, data, true); // isSaved = true
            this.endCapture();
        }));
    }
}
exports.default = Screenshots;
//# sourceMappingURL=index.js.map