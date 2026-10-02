// Moves the pointer of the nested KWin like a real mouse, through KWin's
// org_kde_kwin_fake_input protocol, by speaking the Wayland wire protocol
// directly. The approach follows HyprKwin's tests/e2e/fakeinput.py (GPL-3.0,
// github.com/DGBooth/HyprKwin). KWin only allows it with
// KWIN_WAYLAND_NO_PERMISSION_CHECKS=1.

import { createConnection } from "node:net";

const DISPLAY = 1;
const DISPLAY_SYNC = 0;
const DISPLAY_GET_REGISTRY = 1;
const DISPLAY_ERROR = 0;
const REGISTRY_BIND = 0;
const REGISTRY_GLOBAL = 0;
const CALLBACK_DONE = 0;
const FAKE_INPUT = "org_kde_kwin_fake_input";
const FAKE_INPUT_VERSION = 4;
const FAKE_INPUT_AUTHENTICATE = 0;
const FAKE_INPUT_POINTER_MOTION = 1;
const FAKE_INPUT_BUTTON = 2;
const FAKE_INPUT_KEYBOARD_KEY = 10;

// Linux input event codes.
export const KEY_LEFTMETA = 125;
export const BTN_LEFT = 0x110;

export class FakeInput {
  static async connect(socketPath) {
    const input = new FakeInput(socketPath);
    await input.open();
    return input;
  }

  constructor(socketPath) {
    this.socketPath = socketPath;
    this.nextId = 2;
    this.buffer = Buffer.alloc(0);
    this.globals = [];
    this.pendingSyncs = new Map();
  }

  async open() {
    this.socket = createConnection(this.socketPath);
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("data", (data) => this.receive(data));
    this.registry = this.newId();
    this.send(DISPLAY, DISPLAY_GET_REGISTRY, [uint(this.registry)]);
    await this.roundtrip();
    const global = this.globals.find((g) => g.interface === FAKE_INPUT);
    if (!global) {
      throw new Error(`${FAKE_INPUT} not offered; is KWIN_WAYLAND_NO_PERMISSION_CHECKS=1 set?`);
    }
    this.fakeInput = this.newId();
    this.send(this.registry, REGISTRY_BIND, [
      uint(global.name),
      string(FAKE_INPUT),
      uint(Math.min(global.version, FAKE_INPUT_VERSION)),
      uint(this.fakeInput),
    ]);
    this.send(this.fakeInput, FAKE_INPUT_AUTHENTICATE, [string("pi3d e2e tests"), string("tests")]);
    await this.roundtrip();
  }

  /** Moves the pointer relative to where it is, and waits until KWin has handled it. */
  async movePointer(dx, dy) {
    this.send(this.fakeInput, FAKE_INPUT_POINTER_MOTION, [fixed(dx), fixed(dy)]);
    await this.roundtrip();
  }

  /** Presses or releases a mouse button, e.g. BTN_LEFT. */
  async button(code, pressed) {
    this.send(this.fakeInput, FAKE_INPUT_BUTTON, [uint(code), uint(pressed ? 1 : 0)]);
    await this.roundtrip();
  }

  /** Presses or releases a key by its Linux key code, e.g. KEY_LEFTMETA. */
  async key(code, pressed) {
    this.send(this.fakeInput, FAKE_INPUT_KEYBOARD_KEY, [uint(code), uint(pressed ? 1 : 0)]);
    await this.roundtrip();
  }

  close() {
    this.socket.end();
  }

  newId() {
    return this.nextId++;
  }

  roundtrip() {
    const callback = this.newId();
    this.send(DISPLAY, DISPLAY_SYNC, [uint(callback)]);
    return new Promise((resolve, reject) => {
      this.pendingSyncs.set(callback, resolve);
      this.failSync = reject;
    });
  }

  send(objectId, opcode, args) {
    const body = Buffer.concat(args);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(objectId, 0);
    header.writeUInt32LE(((8 + body.length) << 16) | opcode, 4);
    this.socket.write(Buffer.concat([header, body]));
  }

  receive(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 8) {
      const objectId = this.buffer.readUInt32LE(0);
      const sizeAndOpcode = this.buffer.readUInt32LE(4);
      const size = sizeAndOpcode >>> 16;
      if (this.buffer.length < size) {
        return;
      }
      this.handle(objectId, sizeAndOpcode & 0xffff, this.buffer.subarray(8, size));
      this.buffer = this.buffer.subarray(size);
    }
  }

  handle(objectId, opcode, body) {
    if (objectId === DISPLAY && opcode === DISPLAY_ERROR) {
      const [message] = readString(body.subarray(8));
      this.failSync?.(new Error(`Wayland error: ${message}`));
    } else if (objectId === this.registry && opcode === REGISTRY_GLOBAL) {
      const name = body.readUInt32LE(0);
      const [iface, rest] = readString(body.subarray(4));
      this.globals.push({ name, interface: iface, version: rest.readUInt32LE(0) });
    } else if (this.pendingSyncs.has(objectId) && opcode === CALLBACK_DONE) {
      this.pendingSyncs.get(objectId)();
      this.pendingSyncs.delete(objectId);
    }
  }
}

function uint(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

// Wayland's 24.8 fixed-point numbers.
function fixed(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(Math.round(value * 256), 0);
  return buffer;
}

// Length including the terminating null byte, then the bytes padded to 4.
function string(text) {
  const bytes = Buffer.from(`${text}\0`, "utf8");
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(padded);
  return Buffer.concat([uint(bytes.length), padded]);
}

/** Reads one string; returns it and the rest of the buffer. */
function readString(buffer) {
  const length = buffer.readUInt32LE(0);
  const text = buffer.subarray(4, 4 + length - 1).toString("utf8");
  return [text, buffer.subarray(4 + Math.ceil(length / 4) * 4)];
}
