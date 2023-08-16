import {defineConfig} from "vite";
import EnvironmentPlugin from 'vite-plugin-environment';

export default defineConfig({
    optimizeDeps: {
        esbuildOptions: {
            define: {
                // Needed for pbkdf2 module!
                global: 'globalThis'
            }
        }
    },
    plugins: [
        EnvironmentPlugin('all')
    ]
});
