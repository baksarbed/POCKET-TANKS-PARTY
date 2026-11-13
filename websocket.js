'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class SimpleWebSocket extends EventEmitter {
  constructor(socket, head = Buffer.alloc(0)) {
    super();
    this.socket = socket;
    this.readyState = OPEN;
    this.buffer = head;
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseFrames();
    });
    socket.on('close', () => this.finishClose());
    socket.on('error', () => this.finishClose());
    if (head.length) this.parseFrames();
  }

  send(value) {
    if (this.readyState !== OPEN) return;
    this.writeFrame(0x1, Buffer.from(String(value)));
  }

  close() {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSING;
    this.writeFrame(0x8, Buffer.alloc(0));
    this.socket.end();
  }

  writeFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  parseFrames() {
    while (this.buffer.length >= 2 && this.readyState !== CLOSED) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wide = this.buffer.readBigUInt64BE(2);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return this.close();
        length = Number(wide);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      let payload = this.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buffer = this.buffer.subarray(offset + maskBytes + length);

      if (opcode === 0x8) {
        if (this.readyState === OPEN) this.writeFrame(0x8, payload);
        this.readyState = CLOSING;
        this.socket.end();
        this.finishClose();
        return;
      }
      if (opcode === 0x9) { this.writeFrame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2) this.emit('message', payload);
      // Fragmented frames are intentionally unsupported in this minimal game protocol.
    }
  }

  finishClose() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit('close');
  }
}
SimpleWebSocket.OPEN = OPEN;

class WebSocketServer extends EventEmitter {
  constructor({ server }) {
    super();
    server.on('upgrade', (request, socket, head) => {
      const key = request.headers['sec-websocket-key'];
      const upgrade = String(request.headers.upgrade || '').toLowerCase();
      if (!key || upgrade !== 'websocket') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n'
      ].join('\r\n'));
      socket.setNoDelay(true);
      this.emit('connection', new SimpleWebSocket(socket, head), request);
    });
  }
}

module.exports = { WebSocket, WebSocketServer };
