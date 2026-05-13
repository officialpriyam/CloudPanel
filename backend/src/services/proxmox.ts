import { request } from "undici";
import type { Node, VM } from "@prisma/client";
import { decryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";

export type ProxmoxVMConfig = {
  name: string;
  vmid?: number;
  cores: number;
  memoryMb: number;
  diskGb: number;
  bridge: string;
  templateStorage?: string;
  templatePath?: string;
};

export type ProxmoxVncTicket = {
  ticket: string;
  port: string;
  cert: string;
  user: string;
};

export type ProxmoxFirewallRuleInput = {
  action: "ACCEPT" | "DROP" | "REJECT";
  direction: "in" | "out";
  protocol: string;
  port?: string;
  source?: string;
  destination?: string;
  comment?: string;
  enabled?: boolean;
};

export class ProxmoxService {
  constructor(private readonly node: Node) {}

  async createVM(config: ProxmoxVMConfig): Promise<{ vmid: number; taskId: string }> {
    const vmid = config.vmid ?? (await this.nextVmid());
    const data = await this.api<{ data: string }>(
      "POST",
      `/nodes/${this.node.name}/qemu`,
      {
        vmid,
        name: config.name,
        cores: config.cores,
        memory: config.memoryMb,
        net0: `virtio,bridge=${config.bridge}`,
        scsihw: "virtio-scsi-pci",
        scsi0: `local-lvm:${config.diskGb}`,
        ide2: config.templatePath ? `${config.templateStorage ?? "local"}:iso/${config.templatePath},media=cdrom` : undefined,
        agent: 1,
        onboot: 1
      }
    );
    return { vmid, taskId: data.data };
  }

  async deleteVM(vm: Pick<VM, "proxmoxVmId">): Promise<{ taskId: string }> {
    const vmid = this.requireVmid(vm);
    const data = await this.api<{ data: string }>("DELETE", `/nodes/${this.node.name}/qemu/${vmid}`);
    return { taskId: data.data };
  }

  async startVM(vm: Pick<VM, "proxmoxVmId">): Promise<{ taskId: string }> {
    const vmid = this.requireVmid(vm);
    const data = await this.api<{ data: string }>("POST", `/nodes/${this.node.name}/qemu/${vmid}/status/start`);
    return { taskId: data.data };
  }

  async stopVM(vm: Pick<VM, "proxmoxVmId">): Promise<{ taskId: string }> {
    const vmid = this.requireVmid(vm);
    const data = await this.api<{ data: string }>("POST", `/nodes/${this.node.name}/qemu/${vmid}/status/stop`);
    return { taskId: data.data };
  }

  async rebootVM(vm: Pick<VM, "proxmoxVmId">): Promise<{ taskId: string }> {
    const vmid = this.requireVmid(vm);
    const data = await this.api<{ data: string }>("POST", `/nodes/${this.node.name}/qemu/${vmid}/status/reboot`);
    return { taskId: data.data };
  }

  async getVMStatus(vm: Pick<VM, "proxmoxVmId">) {
    const vmid = this.requireVmid(vm);
    return this.api<{ data: { status: string; cpu: number; mem: number; maxmem: number; disk: number; maxdisk: number } }>(
      "GET",
      `/nodes/${this.node.name}/qemu/${vmid}/status/current`
    );
  }

  async getNodeStats() {
    return this.api<{ data: { cpu: number; memory: { used: number; total: number }; rootfs: { used: number; total: number } } }>(
      "GET",
      `/nodes/${this.node.name}/status`
    );
  }

  async getVMList() {
    return this.api<{ data: Array<{ vmid: number; name: string; status: string; cpu: number; mem: number; maxmem: number }> }>(
      "GET",
      `/nodes/${this.node.name}/qemu`
    );
  }

  async getVncTicket(vm: Pick<VM, "proxmoxVmId">): Promise<ProxmoxVncTicket> {
    const vmid = this.requireVmid(vm);
    const result = await this.api<{ data: ProxmoxVncTicket }>(
      "POST",
      `/nodes/${this.node.name}/qemu/${vmid}/vncproxy`,
      { websocket: 1 }
    );
    return result.data;
  }

  async getVMFirewallRules(vm: Pick<VM, "proxmoxVmId">) {
    const vmid = this.requireVmid(vm);
    return this.api<{ data: Array<Record<string, unknown>> }>(
      "GET",
      `/nodes/${this.node.name}/qemu/${vmid}/firewall/rules`
    );
  }

  async createVMFirewallRule(vm: Pick<VM, "proxmoxVmId">, rule: ProxmoxFirewallRuleInput) {
    const vmid = this.requireVmid(vm);
    const result = await this.api<{ data: string | null }>(
      "POST",
      `/nodes/${this.node.name}/qemu/${vmid}/firewall/rules`,
      {
        enable: rule.enabled === false ? 0 : 1,
        type: rule.direction,
        action: rule.action,
        proto: rule.protocol === "all" ? undefined : rule.protocol,
        dport: rule.port,
        source: rule.source,
        dest: rule.destination,
        comment: rule.comment
      }
    );
    return result.data;
  }

  async deleteVMFirewallRule(vm: Pick<VM, "proxmoxVmId">, position: number) {
    const vmid = this.requireVmid(vm);
    return this.api<{ data: string | null }>(
      "DELETE",
      `/nodes/${this.node.name}/qemu/${vmid}/firewall/rules/${position}`
    );
  }

  async testConnection(): Promise<boolean> {
    await this.getNodeStats();
    return true;
  }

  private async nextVmid(): Promise<number> {
    const data = await this.api<{ data: number }>("GET", "/cluster/nextid");
    return data.data;
  }

  private requireVmid(vm: Pick<VM, "proxmoxVmId">): number {
    if (!vm.proxmoxVmId) {
      throw new AppError(409, "VM has not been provisioned in Proxmox", "VM_NOT_PROVISIONED");
    }
    return vm.proxmoxVmId;
  }

  private async api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `https://${this.node.host}:${this.node.port}/api2/json${path}`;
    const tokenSecret = decryptSecret(this.node.tokenSecretEncrypted);
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.node.tokenId}=${tokenSecret}`
    };
    let payload: string | undefined;
    if (body) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      payload = params.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const response = await request(url, {
      method,
      headers,
      body: payload,
      bodyTimeout: 30_000,
      headersTimeout: 30_000
    });
    const raw = await response.body.text();
    if (response.statusCode >= 400) {
      throw new AppError(response.statusCode, `Proxmox API error: ${raw}`, "PROXMOX_ERROR");
    }
    return JSON.parse(raw) as T;
  }
}
