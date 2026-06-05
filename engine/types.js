// JSDoc-only type definitions shared across the engine. No runtime code.

/**
 * @typedef {Object} DetectorCtx
 * @property {{category: string, app: string|null, window: string|null, system: boolean}} file
 */

/**
 * @typedef {Object} Detector
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {"info"|"notice"|"warn"|"error"|"critical"} severity
 * @property {"any"|"app"|"overwolf"} scope
 * @property {(entry: any, ctx: DetectorCtx) => boolean} match
 * @property {(entries: any[], ctx?: DetectorCtx) => object} [summarize]
 */

/**
 * @typedef {Object} Signal
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {"info"|"notice"|"warn"|"error"|"critical"} severity
 * @property {number} count
 * @property {{file: string, ts: number|null, level: string, message: string}[]} evidence
 * @property {object} [data]
 */

export {};
