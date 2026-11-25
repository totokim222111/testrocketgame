import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-renderer', test: /node_modules[\\/]three[\\/]build[\\/]three\.module\.js/ },
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core\.js/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
});
