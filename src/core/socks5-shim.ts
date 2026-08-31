import { EventEmitter } from "node:events";
import net, { type Socket } from "node:net";
import dgram from "node:dgram";

/**
 * Minimal SOCKS5 server that implements the CONNECT command (proxied through
 * Mockttp for interception) and the UDP ASSOCIATE command (relayed directly,
 * unintercepted — used only for the device's plain DNS lookups). It exists
 * purely to sit in front of Mockttp: the Android companion app's on-device VPN
 * relays per-app TCP connections out as SOCKS5 CONNECT requests, and issues a
 * UDP ASSOCIATE for DNS resolution (that's the protocol hev-socks5-tunnel
 * speaks upstream), while Mockttp only understands the plain HTTP forward-proxy
 * protocol (absolute-form requests + `CONNECT host:port` for TLS tunnels).
 *
 * For every SOCKS5 CONNECT we receive, we open a *new* TCP connection to
 * Mockttp's own proxy port and issue an HTTP/1.1 `CONNECT host:port` request
 * on it, exactly as a browser configured with an HTTP(S) proxy would. Once
 * Mockttp replies "200 Connection established" we splice the two sockets
 * together and get out of the way — Mockttp still does all the actual
 * MITM/interception/rule-matching, this shim is just a protocol adapter.
 *
 * For UDP ASSOCIATE, there is nothing for Mockttp to intercept (it's raw DNS
 * packets, not HTTP), so we just open a UDP socket and forward datagrams
 * to/from their real destination, wrapping/unwrapping the SOCKS5 UDP request
 * header as required by RFC 1928 section 7. Without this, hev-socks5-tunnel's
 * DNS queries (which it always issues via UDP ASSOCIATE first) fail outright
 * with "command not supported", and the device can never resolve any hostname
 * to reach its actual HTTP(S) destination — the underlying cause behind
 * captures never appearing despite the tunnel/VPN being otherwise healthy.
 */
export interface Socks5ShimOptions {
  /** Port to listen for incoming SOCKS5 connections on (from the companion app's tunnel). */
  listenPort: number;
  /** Mockttp's own forward-proxy port, already listening on 127.0.0.1. */
  upstreamProxyPort: number;
}

type ShimEvents = {
  error: [Error];
};

const SOCKS_VERSION = 0x05;
const CMD_CONNECT = 0x01;
const CMD_UDP_ASSOCIATE = 0x03;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

export class Socks5Shim {
  private readonly events = new EventEmitter();
  private server: net.Server | undefined;

  onError(listener: (error: Error) => void) {
    this.events.on("error", listener);
  }

  private emitError(error: Error) {
    this.events.emit("error", error);
  }

  async start(options: Socks5ShimOptions): Promise<void> {
    if (this.server) {
      throw new Error("Socks5Shim already started");
    }

    const { listenPort, upstreamProxyPort } = options;

    this.server = net.createServer((socket) => {
      this.handleConnection(socket, upstreamProxyPort).catch((error) => {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
        socket.destroy();
      });
    });

    this.server.on("error", (error) => this.emitError(error));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(listenPort, "0.0.0.0", () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  getPort(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : undefined;
  }

  private async handleConnection(client: Socket, upstreamProxyPort: number): Promise<void> {
    // --- Greeting: VER, NMETHODS, METHODS[] ---
    const greeting = await readExactly(client, 2);
    const version = greeting[0];
    const methodCount = greeting[1];
    if (version !== SOCKS_VERSION) {
      client.destroy();
      return;
    }
    await readExactly(client, methodCount); // discard offered auth methods, we only support "no auth"
    client.write(Buffer.from([SOCKS_VERSION, 0x00])); // 0x00 = no authentication required

    // --- Request: VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT ---
    const header = await readExactly(client, 4);
    const [, cmd, , atyp] = header;

    if (cmd === CMD_UDP_ASSOCIATE) {
      await this.handleUdpAssociate(client, atyp);
      return;
    }

    if (cmd !== CMD_CONNECT) {
      client.write(Buffer.from([SOCKS_VERSION, 0x07, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])); // command not supported
      client.destroy();
      return;
    }

    let host: string;
    try {
      host = await readAddress(client, atyp);
    } catch {
      client.write(Buffer.from([SOCKS_VERSION, 0x08, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])); // address type not supported
      client.destroy();
      return;
    }

    const portBytes = await readExactly(client, 2);
    const port = portBytes.readUInt16BE(0);

    let upstream: Socket;
    try {
      upstream = await connectAndTunnel(upstreamProxyPort, host, port);
    } catch (error) {
      client.write(Buffer.from([SOCKS_VERSION, 0x05, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])); // connection refused
      client.destroy();
      throw error;
    }

    // Success reply — BND.ADDR/BND.PORT are unused by our client so zero-fill them.
    client.write(Buffer.from([SOCKS_VERSION, 0x00, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]));

    client.pipe(upstream);
    upstream.pipe(client);
    const cleanup = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", cleanup);
    client.on("error", cleanup);
    upstream.on("close", cleanup);
    upstream.on("error", cleanup);
  }

  /**
   * UDP ASSOCIATE (RFC 1928 §7): the client (hev-socks5-tunnel) uses this
   * purely to relay DNS queries — there's nothing here for Mockttp to
   * intercept, so we open a plain UDP socket, tell the client where to send
   * datagrams, and forward them to/from their real destination verbatim,
   * unwrapping/rewrapping the SOCKS5 UDP request header each direction.
   * The TCP control connection must stay open for the life of the
   * association (per spec) — we tear the UDP socket down when it closes.
   */
  private async handleUdpAssociate(client: Socket, _atyp: number): Promise<void> {
    // We don't care about the client's requested DST.ADDR/DST.PORT for the
    // association request itself (real destinations arrive per-datagram),
    // but we still need to consume the bytes off the wire.
    await readAddress(client, _atyp).catch(() => undefined);
    await readExactly(client, 2).catch(() => undefined);

    const udpSocket = dgram.createSocket("udp4");

    const bindError = await new Promise<Error | undefined>((resolve) => {
      udpSocket.once("error", resolve);
      udpSocket.bind(0, "127.0.0.1", () => {
        udpSocket.removeListener("error", resolve);
        resolve(undefined);
      });
    });

    if (bindError) {
      client.write(Buffer.from([SOCKS_VERSION, 0x01, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])); // general failure
      client.destroy();
      return;
    }

    const boundAddress = udpSocket.address();
    const reply = Buffer.alloc(10);
    reply[0] = SOCKS_VERSION;
    reply[1] = 0x00; // succeeded
    reply[2] = 0x00; // reserved
    reply[3] = ATYP_IPV4;
    Buffer.from([127, 0, 0, 1]).copy(reply, 4);
    reply.writeUInt16BE(boundAddress.port, 8);
    client.write(reply);

    // The tunnel opens one UDP "relay" socket per association and sends every
    // datagram (regardless of destination) from that same local address/port,
    // so we only ever see one distinct remote endpoint on udpSocket — capture
    // it on first datagram so responses know where to be sent back to.
    let clientRemote: dgram.RemoteInfo | undefined;
    // One outbound socket per real destination, so responses can be routed
    // back without ambiguity (a single shared socket can't tell "reply from
    // destination A" apart from "another wrapped request from the client").
    const destSockets = new Map<string, dgram.Socket>();

    const cleanup = () => {
      udpSocket.close();
      for (const destSocket of destSockets.values()) destSocket.close();
      destSockets.clear();
      client.destroy();
    };

    udpSocket.on("message", (message, remoteInfo) => {
      clientRemote = remoteInfo;

      // Incoming datagram from hev-socks5-tunnel, wrapped per RFC 1928 §7:
      // RSV(2) FRAG(1) ATYP(1) DST.ADDR DST.PORT(2) DATA.
      if (message.length < 4 || message[2] !== 0x00) return; // fragmented datagrams unsupported, drop

      const destAtyp = message[3];
      let offset = 4;
      let destHost: string;
      if (destAtyp === ATYP_IPV4) {
        destHost = Array.from(message.subarray(offset, offset + 4)).join(".");
        offset += 4;
      } else if (destAtyp === ATYP_DOMAIN) {
        const len = message[offset];
        offset += 1;
        destHost = message.subarray(offset, offset + len).toString("utf8");
        offset += len;
      } else if (destAtyp === ATYP_IPV6) {
        const addr = message.subarray(offset, offset + 16);
        const groups: string[] = [];
        for (let i = 0; i < 16; i += 2) groups.push(addr.readUInt16BE(i).toString(16));
        destHost = groups.join(":");
        offset += 16;
      } else {
        return;
      }
      const destPort = message.readUInt16BE(offset);
      offset += 2;
      const payload = message.subarray(offset);

      const key = `${destHost}:${destPort}`;
      let destSocket = destSockets.get(key);
      if (!destSocket) {
        destSocket = dgram.createSocket("udp4");
        destSockets.set(key, destSocket);

        destSocket.on("message", (responsePayload) => {
          if (!clientRemote) return;
          // Re-wrap the raw response with the same SOCKS5 UDP header so the
          // tunnel can associate it with the right destination.
          const addrBytes = encodeAddress(destAtyp, destHost);
          const wrapped = Buffer.concat([
            Buffer.from([0x00, 0x00, 0x00, destAtyp]),
            addrBytes,
            (() => {
              const portBuf = Buffer.alloc(2);
              portBuf.writeUInt16BE(destPort, 0);
              return portBuf;
            })(),
            responsePayload,
          ]);
          udpSocket.send(wrapped, clientRemote.port, clientRemote.address, (error) => {
            if (error) this.emitError(error);
          });
        });
        destSocket.on("error", (error) => this.emitError(error));
      }

      destSocket.send(payload, destPort, destHost, (error) => {
        if (error) this.emitError(error);
      });
    });

    client.on("close", cleanup);
    client.on("error", cleanup);
    udpSocket.on("error", cleanup);
  }
}

/** Reads a SOCKS5 ATYP-tagged address (IPv4/domain/IPv6) from a stream. */
async function readAddress(socket: Socket, atyp: number): Promise<string> {
  if (atyp === ATYP_IPV4) {
    const addr = await readExactly(socket, 4);
    return Array.from(addr).join(".");
  } else if (atyp === ATYP_DOMAIN) {
    const lenByte = await readExactly(socket, 1);
    const domain = await readExactly(socket, lenByte[0]);
    return domain.toString("utf8");
  } else if (atyp === ATYP_IPV6) {
    const addr = await readExactly(socket, 16);
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(addr.readUInt16BE(i).toString(16));
    }
    return groups.join(":");
  }
  throw new Error(`Unsupported SOCKS5 address type: ${atyp}`);
}

/** Encodes a host string back into its SOCKS5 ATYP-tagged wire representation. */
function encodeAddress(atyp: number, host: string): Buffer {
  if (atyp === ATYP_IPV4) {
    return Buffer.from(host.split(".").map(Number));
  } else if (atyp === ATYP_DOMAIN) {
    const domain = Buffer.from(host, "utf8");
    return Buffer.concat([Buffer.from([domain.length]), domain]);
  } else {
    // ATYP_IPV6
    const groups = host.split(":").map((group) => parseInt(group, 16));
    const buf = Buffer.alloc(16);
    for (let i = 0; i < groups.length; i++) buf.writeUInt16BE(groups[i], i * 2);
    return buf;
  }
}

/** Reads exactly `length` bytes from a socket, buffering partial reads. */
function readExactly(socket: Socket, length: number): Promise<Buffer> {
  if (length === 0) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    let collected = Buffer.alloc(0);

    const onReadable = () => {
      let chunk: Buffer | null;
      while (collected.length < length && (chunk = socket.read(length - collected.length) as Buffer | null) !== null) {
        collected = Buffer.concat([collected, chunk]);
      }
      if (collected.length >= length) {
        cleanup();
        resolve(collected);
      }
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Socket closed before expected bytes were received"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.removeListener("readable", onReadable);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
    };

    socket.on("readable", onReadable);
    socket.on("end", onEnd);
    socket.on("error", onError);
    onReadable();
  });
}

/** Opens a TCP connection to Mockttp's proxy port and issues an HTTP CONNECT tunnel for host:port. */
function connectAndTunnel(upstreamProxyPort: number, host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // IMPORTANT: connect via the IPv6 loopback (::1), not 127.0.0.1. On this network,
    // Netskope's local endpoint-DLP proxy driver transparently intercepts IPv4 loopback
    // connections (it answers CONNECT itself with "200 Connection Established" before our
    // own Mockttp process ever sees the request), which silently prevented every request
    // routed through this shim from being captured. IPv6 loopback isn't intercepted, so it
    // reaches Mockttp directly. See docs/troubleshooting-netskope-loopback.md for details.
    const socket = net.connect({ host: "::1", port: upstreamProxyPort }, () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });

    socket.once("error", reject);

    let responseBuffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const headerEnd = responseBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      socket.removeListener("data", onData);
      socket.removeListener("error", reject);

      const statusLine = responseBuffer.subarray(0, responseBuffer.indexOf("\r\n")).toString("utf8");
      if (!/\s2\d\d\s/.test(statusLine)) {
        socket.destroy();
        reject(new Error(`Upstream CONNECT tunnel rejected: ${statusLine}`));
        return;
      }

      // Any bytes after the header (rare for CONNECT responses) belong to the tunnel — put them back.
      const remainder = responseBuffer.subarray(headerEnd + 4);
      if (remainder.length > 0) {
        socket.unshift(remainder);
      }

      resolve(socket);
    };
    socket.on("data", onData);
  });
}
