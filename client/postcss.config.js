/**
 * Vite picks this up automatically for every stylesheet it processes.
 * ESM syntax because client/package.json sets "type": "module".
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
