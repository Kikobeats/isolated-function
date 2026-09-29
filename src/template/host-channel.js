'use strict'

const HOST_CALL = 'globalThis.__isolated_host'
const CLOSE_HOST = 'closeIsolatedHost'

/* The template calls the returned closer. The snippet can replace the global
   or `call.close` and must not be able to keep the channel open. */
const source = methods => `
    const ${CLOSE_HOST} = (() => {
      const request = process.send.bind(process)
      const disconnect = process.disconnect.bind(process)
      const activeResources = process.getActiveResourcesInfo.bind(process)
      const onNextTurn = setImmediate.bind(globalThis)
      const countResources = () => {
        const counts = Object.create(null)
        for (const type of activeResources()) counts[type] = (counts[type] ?? 0) + 1
        return counts
      }
      const pending = new Map()
      let lastId = 0
      let closed = false

      const settle = reason => {
        for (const waiting of pending.values()) waiting.reject(new Error(reason))
        pending.clear()
      }

      process.on('message', reply => {
        const waiting = pending.get(reply && reply.id)
        if (waiting === undefined) return
        pending.delete(reply.id)
        reply.failed ? waiting.reject(new Error(reply.reason)) : waiting.resolve(reply.value)
      })

      process.on('disconnect', () => {
        closed = true
        settle('the host channel closed before answering')
      })

      /* Handles open before the snippet runs (stdio, the channel) are not
         snippet work. The set depends on the platform, so compare counts
         rather than assuming a pipe. */
      const baseline = countResources()
      let probes = 0
      const snippetIsRunning = () => {
        const counts = countResources()
        /* Each in-flight check is itself an Immediate. Those are not the snippet. */
        const immediates = Math.max(0, (counts.Immediate ?? 0) - probes)
        if (immediates > (baseline.Immediate ?? 0)) return true
        for (const type in counts) {
          if (type === 'Immediate') continue
          if (counts[type] > (baseline[type] ?? 0)) return true
        }
        return false
      }

      const call = (method, args) => {
        let armed = false
        let watch = () => {}
        const answer = new Promise((resolve, reject) => {
          if (closed) return reject(new Error('the host channel is already closed'))
          const id = ++lastId
          pending.set(id, { resolve, reject })
          request({ id, method, args })
          /* After the send flushes. A microtask still sees that write, and on
             Linux it looks like the snippet kept running. */
          const probe = () => {
            probes++
            onNextTurn(() => {
              /* This check's own Immediate is already off the list. What remains
                 of the probe count is the sibling checks still scheduled. */
              probes--
              if (closed || !pending.has(id)) return
              if (snippetIsRunning()) {
                if (armed) return
                armed = true
                request({ id, running: true })
                return
              }
              if (!armed) return
              armed = false
              request({ id, parked: true })
            })
          }
          probe()
          /* The internal catch is not an await. A later await of this same call
             checks again, and parks only once the other work is gone. */
          watch = () => {
            if (armed) probe()
          }
        })
        /* A call the snippet starts but never awaits must not take the run down
           with an unhandled rejection; awaiting it still surfaces the error. */
        answer.catch(() => {})
        const waited = {
          then (onFulfilled, onRejected) {
            watch()
            return answer.then(onFulfilled, onRejected)
          },
          catch (onRejected) {
            watch()
            return answer.catch(onRejected)
          },
          finally (onFinally) {
            watch()
            return answer.finally(onFinally)
          }
        }
        return waited
      }

      const close = () => {
        if (closed) return
        closed = true
        settle('the host channel closed')
        disconnect()
      }

      call.methods = ${JSON.stringify(methods)}
      call.close = close
      ${HOST_CALL} = call
      return close
    })()`

module.exports = { source, CLOSE_HOST }
