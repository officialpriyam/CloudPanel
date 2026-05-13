import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  turbopack: {
    root: path.join(dirname, "..")
  },
  outputFileTracingRoot: path.join(dirname, "..")
};

export default nextConfig;
