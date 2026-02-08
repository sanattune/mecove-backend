"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const prefix = () => `[${new Date().toISOString()}]`;
exports.logger = {
    info(...args) {
        console.log(prefix(), ...args);
    },
    warn(...args) {
        console.warn(prefix(), ...args);
    },
    error(...args) {
        console.error(prefix(), ...args);
    },
};
