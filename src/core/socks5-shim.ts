import { EventEmitter } from "node:events";
import net, { type Socket } from "node:net";

/**
 * Minimal SOCKS5 server that only implements the CONNECT command with no
 * authentication. It exists purely to sit in front of Mockttp: the Android
 * companion app's on-device VPN relays per-app TCP connections out as SOCKS5
 * CONNECT requests (that's the protocol hev-socks5-tunnel speaks upstream),
 * and Mockttp only understands the plain HTTP forward-proxy protocol
 * (absolute-form requests + `CONNECT host:port` for TLS tunnels).
 *
 * For every SOCKS5 CONNECT we receive, we open a *new* TCP connection to
 * Mockttp's own proxy port and issue an HTTP/1.1 `CONNECT host:port` request
 * on it, exactly as a browser configured with an HTTP(S) proxy would. Once
 * Mockttp replies "200 Connection established" we splice the two sockets
 * together and get out of the way — Mockttp still does all the actual
 * MITM/interception/rule-matching, this shim is just a protocol adapter.
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

    if (cmd !== CMD_CONNECT) {
      client.write(Buffer.from([SOCKS_VERSION, 0x07, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])); // command not supported
      client.destroy();
      return;
    }

    let host: string;
    if (atyp === ATYP_IPV4) {
      const addr = await readExactly(client, 4);
      host = Array.from(addr).join(".");
    } else if (atyp === ATYP_DOMAIN) {
      const lenByte = await readExactly(client, 1);
      const domain = await readExactly(client, lenByte[0]);
      host = domain.toString("utf8");
    } else if (atyp === ATYP_IPV6) {
      const addr = await readExactly(client, 16);
      const groups: string[] = [];
      for (let i = 0; i < 16; i += 2) {
        groups.push(addr.readUInt16BE(i).toString(16));
      }
      host = groups.join(":");
    } else {
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
    const socket = net.connect({ host: "127.0.0.1", port: upstreamProxyPort }, () => {
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
