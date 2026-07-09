// Ambient module for raw-text style imports in specs
// (e.g. `import scss from './x.scss' with { loader: 'text' }`).
declare module '*.scss' {
  const content: string;
  export default content;
}
