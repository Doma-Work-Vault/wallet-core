import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import nodePolyfills from 'rollup-plugin-node-polyfills';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js',
      format: 'es',
      sourcemap: true,
    },
    {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: true,
    }
  ],
  external: [
    'ethers', // Peer dependency - don't bundle
    '@vulpemventures/secp256k1-zkp' // WASM module - don't bundle
  ],
  plugins: [
    // Add Node.js polyfills for browser compatibility
    nodePolyfills({
      include: ['crypto', 'stream', 'buffer', 'util', 'process', 'events'],
      exclude: ['fs', 'path']
    }),
    // Resolve node_modules
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ['browser', 'module', 'import', 'default']
    }),
    // Convert CommonJS modules to ES6
    commonjs(),
    // Handle JSON imports
    json(),
    // Compile TypeScript
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist',
      outDir: 'dist'
    })
  ]
};

