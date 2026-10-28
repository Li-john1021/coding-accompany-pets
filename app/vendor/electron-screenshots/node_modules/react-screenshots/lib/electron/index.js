import { jsx } from "react/jsx-runtime";
import { StrictMode } from "react";
import client from "react-dom/client";
import app from "./app.js";
client.createRoot(document.getElementById('root')).render(/*#__PURE__*/ jsx(StrictMode, {
    children: /*#__PURE__*/ jsx(app, {})
}));
