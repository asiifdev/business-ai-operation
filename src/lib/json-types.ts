/** A server type as it looks after `JSON.stringify`: dates become ISO strings. */
export type Jsonify<T> = T extends Date ? string : T extends Array<infer U> ? Array<Jsonify<U>> : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
