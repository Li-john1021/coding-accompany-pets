import Arrow from "./Arrow/index.js";
import Brush from "./Brush/index.js";
import Cancel from "./Cancel/index.js";
import Ellipse from "./Ellipse/index.js";
import Mosaic from "./Mosaic/index.js";
import Ok from "./Ok/index.js";
import Rectangle from "./Rectangle/index.js";
import Redo from "./Redo/index.js";
import Save from "./Save/index.js";
import Text from "./Text/index.js";
import Undo from "./Undo/index.js";
const operations = [
    Rectangle,
    Ellipse,
    Arrow,
    Brush,
    Text,
    Mosaic,
    '|',
    Undo,
    Redo,
    '|',
    Save,
    Cancel,
    Ok
];
export { operations as default };
