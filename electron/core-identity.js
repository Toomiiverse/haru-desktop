"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.coreIdentity = coreIdentity;
exports.protectedIdentityKey = protectedIdentityKey;
exports.assertIdentityWritable = assertIdentityWritable;
exports.coreIdentityValue = coreIdentityValue;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
let loadedPath;
let loaded;
function coreIdentity() {
    const file = process.env.HARU_CORE_IDENTITY_FILE;
    if (!file)
        return undefined; // Preserved legacy rollback runtime.
    if (file !== loadedPath) {
        if (!node_path_1.default.isAbsolute(file))
            throw Error('absolute_core_identity_required');
        const value = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        if (value.version !== 1 || typeof value.character?.identity !== 'string' || !value.character.identity.trim()
            || typeof value.character?.style !== 'string' || !value.character.style.trim()
            || !value.voice || typeof value.voice !== 'object' || Array.isArray(value.voice)
            || !value.breezeActing || typeof value.breezeActing !== 'object'
            || !Object.values(value.breezeActing).every(v => typeof v === 'string'))
            throw Error('invalid_core_identity');
        loaded = value;
        loadedPath = file;
    }
    return structuredClone(loaded);
}
function protectedIdentityKey(key) {
    return ['character', 'voice'].includes(key.split('.')[0]);
}
function assertIdentityWritable(keys) {
    if (coreIdentity() && keys.some(protectedIdentityKey))
        throw Error('core_identity_read_only');
}
function coreIdentityValue(key) {
    if (!protectedIdentityKey(key))
        return undefined;
    const profile = coreIdentity();
    if (!profile)
        return undefined;
    let value = profile;
    for (const part of key.split('.')) {
        value = value && Object.hasOwn(value, part) ? value[part] : undefined;
    }
    return { value: structuredClone(value) };
}
