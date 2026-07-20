/**
 * Shared onnxruntime-web session plumbing for the live-composite local
 * engines (RVM matting / Depth Anything V2 深度淨化)。
 *
 * Execution-provider negotiation is deliberately identical for every ONNX
 * engine: WebGPU first, then single-threaded WASM (numThreads=1 so no
 * SharedArrayBuffer / COOP-COEP headers are required). Each candidate must
 * pass a MANDATORY warmup inference, not just session creation — JSEP
 * resolves unsupported ops lazily at RUN time (2026-07-20 field bug:
 * AveragePool ceil_mode blew up on the first real frame while create() had
 * succeeded). If both execution providers fail, an explicit error carrying
 * both reasons is thrown — there is deliberately NO silent fallback.
 */

/** onnxruntime-web fetches its .wasm binaries from here (self-hosted, no CDN). */
export const ORT_WASM_ASSET_PATH = '/onnxruntime/'

export type OnnxExecutionProvider = 'webgpu' | 'wasm'

/**
 * Minimal structural view of onnxruntime-web used by the engines. Tests pass
 * a fake module implementing this shape instead of loading the real runtime.
 */
export interface OnnxTensor {
  readonly data: unknown
  readonly dims: readonly number[]
  dispose?: () => void
}

export interface OnnxSession {
  run: (feeds: Record<string, OnnxTensor>) => Promise<Record<string, OnnxTensor>>
  release: () => Promise<void>
}

export interface OnnxModule {
  env: { wasm: { numThreads?: number; wasmPaths?: string } }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OnnxTensor
  InferenceSession: {
    create: (path: string, options: { executionProviders: OnnxExecutionProvider[] }) => Promise<OnnxSession>
  }
}

export interface NegotiateOnnxOptions {
  /** Mandatory warmup inference; a throw marks the candidate EP as failed. */
  warmup: (ort: OnnxModule, session: OnnxSession) => Promise<void>
  /** Builds the explicit dual-failure error message from the joined reasons. */
  buildFailureError: (joinedFailures: string) => string
}

export async function negotiateOnnxSession(
  ort: OnnxModule,
  modelPath: string,
  options: NegotiateOnnxOptions,
): Promise<{ session: OnnxSession; ep: OnnxExecutionProvider }> {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = ORT_WASM_ASSET_PATH
  const failures: string[] = []
  for (const ep of ['webgpu', 'wasm'] as const) {
    let session: OnnxSession | null = null
    try {
      session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] })
      await options.warmup(ort, session)
      return { session, ep }
    } catch (error) {
      failures.push(`${ep}：${error instanceof Error ? error.message : String(error)}`)
      try {
        await session?.release()
      } catch {
        // Failed-warmup session teardown is best-effort; the EP failure above
        // is what we report.
      }
    }
  }
  throw new Error(options.buildFailureError(failures.join('；')))
}
