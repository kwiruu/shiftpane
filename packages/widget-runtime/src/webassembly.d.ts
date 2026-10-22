// The part of Node's WebAssembly global the sandbox uses. @types/node leaves WebAssembly to the
// DOM library, which the main process doesn't load.
declare namespace WebAssembly {
  interface MemoryDescriptor {
    initial: number
    maximum?: number
  }
  class Memory {
    constructor(descriptor: MemoryDescriptor)
    readonly buffer: ArrayBuffer
    grow(delta: number): number
  }
}
