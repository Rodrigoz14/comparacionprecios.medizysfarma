import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Los tests de integracion comparten una sola base de datos de desarrollo
    // (prisma dev, con connection_limit bajo); ejecutar los archivos en
    // paralelo agota el pool y produce errores de protocolo intermitentes.
    fileParallelism: false,
  },
});
