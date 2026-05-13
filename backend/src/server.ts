import WebSocket, { WebSocketServer } from "ws";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { decryptSecret } from "./lib/crypto.js";

const app = await buildApp();

await app.listen({ host: "0.0.0.0", port: env.BACKEND_PORT });
attachConsoleProxy();

function attachConsoleProxy() {
  const wss = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url ?? "", env.BACKEND_PUBLIC_URL);
    const match = url.pathname.match(/^\/api\/v1\/vms\/([^/]+)\/console\/ws$/);
    if (!match) {
      return;
    }
    const vm = await prisma.vM.findUnique({ where: { id: match[1] }, include: { node: true } });
    if (!vm?.proxmoxVmId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, client => {
      const proxmoxUrl = `wss://${vm.node.host}:${vm.node.port}/api2/json/nodes/${vm.node.name}/qemu/${vm.proxmoxVmId}/vncwebsocket?port=${url.searchParams.get("port") ?? ""}&vncticket=${encodeURIComponent(url.searchParams.get("ticket") ?? "")}`;
      const upstream = new WebSocket(proxmoxUrl, {
        headers: {
          Authorization: `PVEAPIToken=${vm.node.tokenId}=${decryptSecret(vm.node.tokenSecretEncrypted)}`
        }
      });
      upstream.onmessage = event => {
        if (client.readyState === WebSocket.OPEN) client.send(event.data);
      };
      upstream.onclose = () => client.close();
      upstream.onerror = () => client.close();
      client.on("message", data => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      });
      client.on("close", () => upstream.close());
    });
  });
}
