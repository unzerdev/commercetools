declare module '*.scss';
declare module '*.css';

/**
 * An `*.svg` import resolves to the asset's URL (Vite emits the file, or inlines it as a `data:` URL
 * under the inline limit). Declared here because neither tsconfig pulls in `vite/client`.
 */
declare module '*.svg' {
  const src: string;
  export default src;
}
