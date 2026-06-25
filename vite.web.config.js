import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    base: '/', // Web deployment typically uses root or relative paths
    define: {
        // Define a global constant to check if we are in web mode
        'import.meta.env.VITE_IS_WEB': JSON.stringify('true'),
    },
    build: {
        outDir: 'dist-web', // Separate output directory for web build
        emptyOutDir: true,
    }
});
