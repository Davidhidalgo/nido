import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
export function privateIpv4(ip: string) {
  const n = ip.split(".").map(Number);
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(ip) &&
    n.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) &&
    n.join(".") === ip &&
    (n[0] === 10 || (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31))
  );
}
export type PairingDevice = { address: string; name: string };
const service = "_nido-pair._tcp.local";
export function pairingAnswer(packet: Buffer, source: string): PairingDevice[] {
  if (!privateIpv4(source) || packet.length < 12 || packet.length > 9000 || !(packet[2] & 128))
    return [];
  function name(offset: number) {
    let p = offset,
      end = 0;
    const labels: string[] = [];
    const seen = new Set<number>();
    for (let depth = 0; depth < 40; depth++) {
      if (p >= packet.length || seen.has(p)) throw Error("DNS");
      seen.add(p);
      const len = packet[p++];
      if (!len) return { value: labels.join(".").toLowerCase(), end: end || p };
      if ((len & 192) === 192) {
        if (p >= packet.length) throw Error("DNS");
        const pointer = ((len & 63) << 8) | packet[p++];
        end ||= p;
        p = pointer;
      } else {
        if (len > 63 || p + len > packet.length) throw Error("DNS");
        labels.push(packet.toString("utf8", p, p + len));
        p += len;
      }
    }
    throw Error("DNS");
  }
  try {
    let p = 12;
    for (let i = 0; i < packet.readUInt16BE(4); i++) {
      p = name(p).end + 4;
      if (p > packet.length) return [];
    }
    const count = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10),
      out: PairingDevice[] = [];
    if (count > 64) return [];
    for (let i = 0; i < count; i++) {
      const owner = name(p);
      p = owner.end;
      if (p + 10 > packet.length) return [];
      const type = packet.readUInt16BE(p),
        len = packet.readUInt16BE(p + 8),
        ttl = packet.readUInt32BE(p + 4);
      p += 10;
      if (p + len > packet.length) return [];
      if (
        type === 33 &&
        len >= 7 &&
        ttl &&
        owner.value.endsWith("." + service) &&
        packet.readUInt16BE(p + 4) === 80
      ) {
        const label = owner.value.slice(0, -service.length - 1);
        if (/^nido-[0-9a-f]{6}$/.test(label)) out.push({ address: source, name: label });
      }
      p += len;
    }
    return out;
  } catch {
    return [];
  }
}
export async function discoverNote4(): Promise<PairingDevice[]> {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  const devices = new Map<string, PairingDevice>();
  return new Promise((resolve) => {
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve([...devices.values()].slice(0, 8));
    };
    const timer = setTimeout(finish, 2500);
    socket.on("error", finish);
    socket.on("message", (data, peer) => {
      for (const d of pairingAnswer(data, peer.address))
        if (devices.size < 8) devices.set(d.address, d);
    });
    socket.bind(0, () => {
      const labels = service.split(".").flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
      const head = Buffer.alloc(12);
      head.writeUInt16BE(1, 4);
      const query = Buffer.concat([head, ...labels, Buffer.from([0, 0, 12, 0x80, 1])]);
      for (const net of Object.values(networkInterfaces()).flat()) {
        if (net?.family !== "IPv4" || net.internal || !privateIpv4(net.address)) continue;
        try {
          socket.setMulticastInterface(net.address);
          socket.send(query, 5353, "224.0.0.251");
        } catch {}
      }
    });
  });
}
