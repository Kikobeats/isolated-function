/**
 * Profiling information about the isolated function execution
 */
export interface Profiling {
  /** Memory usage in bytes */
  memory: number
  /** Execution duration in milliseconds */
  duration: number
}

/**
 * Logging information captured from the isolated function
 */
export interface Logging {
  log?: unknown[][]
  info?: unknown[][]
  debug?: unknown[][]
  warn?: unknown[][]
  error?: unknown[][]
}

/**
 * Successful execution result
 */
export interface SuccessResult<T = unknown> {
  isFulfilled: true
  value: T
  profiling: Profiling
  logging: Logging
}

/**
 * Failed execution result
 */
export interface FailureResult {
  isFulfilled: false
  value: Error
  profiling: Profiling
  logging: Logging
}

/**
 * Execution result (success or failure)
 */
export type ExecutionResult<T = unknown> = SuccessResult<T> | FailureResult

/**
 * Options for creating an isolated function
 */
export interface IsolatedFunctionOptions {
  /** Temporary directory configuration */
  tmpdir?: () => Promise<{ cwd: string; cleanup: () => Promise<void> }>
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Memory limit in megabytes */
  memory?: number
  /** When false, errors are returned instead of thrown */
  throwError?: boolean
  /** Array of resources to allow access to */
  allow?: string[]
}

/**
 * Cleanup function to release resources
 */
export type Cleanup = () => Promise<void>

/**
 * Isolated function that can be executed with arguments
 */
export type IsolatedFn<T = unknown> = (
  ...args: unknown[]
) => Promise<SuccessResult<T> | FailureResult>

/**
 * Creates an isolated function that runs untrusted code in a separate Node.js process.
 *
 * @param snippet - The function or code string to run in isolation
 * @param options - Configuration options for the isolated function
 * @returns A tuple containing the isolated function and a cleanup function
 *
 * @example
 * ```js
 * const [sum, cleanup] = isolatedFunction((a, b) => a + b, {
 *   memory: 128,
 *   timeout: 10000
 * })
 *
 * const { value } = await sum(3, 2)
 * console.log(value) // 5
 * await cleanup()
 * ```
 *
 * @example
 * ```js
 * // With error handling
 * const [fn, cleanup] = isolatedFunction(() => {
 *   throw new Error('oh no!')
 * }, { throwError: false })
 *
 * const result = await fn()
 * if (!result.isFulfilled) {
 *   console.error(result.value)
 * }
 * await cleanup()
 * ```
 */
declare function isolatedFunction<T = unknown>(
  snippet: Function | string,
  options?: IsolatedFunctionOptions
): [IsolatedFn<T>, Cleanup]

export default isolatedFunction
