/** Declares Vite raw-loader imports for modal HTML templates. */
declare module '*.html?raw' {
    /** Contains raw file contents as a string. */
    const content: string;
    export default content;
}
