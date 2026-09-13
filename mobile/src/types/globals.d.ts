// React Native / Expo injects this global at bundle time. Typed as possibly
// undefined so plain Node/Jest contexts that never define it can still be
// checked safely with `typeof __DEV__ === 'undefined'`.
declare const __DEV__: boolean | undefined;
