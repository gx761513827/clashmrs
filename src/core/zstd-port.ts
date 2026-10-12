/** zstd 端口：core 不直接依赖 wasm，浏览器/Worker 与测试各自注入实现。 */
export interface ZstdCodec {
  compress(data: Uint8Array, level?: number): Promise<Uint8Array>;
  decompress(data: Uint8Array): Promise<Uint8Array>;
}
